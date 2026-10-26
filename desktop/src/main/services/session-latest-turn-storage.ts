import type Database from 'better-sqlite3'
import type {
  LatestSessionTurn,
  SessionTurnState,
  TokenUsageApiCall,
  TokenUsageSession,
} from '../../shared/models'
import type { UsageCostRollup } from '../../shared/usage-cost'
import { combineCostRollups } from '../../shared/cost-rollup'
import {
  generationSample,
  latestGeneration,
  normalizeLatestGeneration,
} from '../../shared/generation-timing'
import { eventTimestampMs } from '../scanners/incremental-utils'
import { normalizeLatestSessionTurn } from '../../shared/session-turn-view'
import { aggregateSessionUsage, decodeMeterData, type SessionDataRow } from './session-usage-codec'
import { sessionGenerationFromRow, type SessionGenerationRow } from './session-generation-storage'

export interface SessionTurnUsage extends LatestSessionTurn {
  userInitiated: boolean
  apiCallIds: string[]
}

export function makeSessionTurnUsage(
  calls: readonly TokenUsageApiCall[],
  costSummary: UsageCostRollup,
): SessionTurnUsage {
  const first = calls[0]
  const result: SessionTurnUsage = {
    sessionId: first.sessionId,
    turnId: first.turn!.id,
    startedAtMs: 0,
    updatedAtMs: 0,
    usageAvailable: true,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    apiCallCount: calls.length,
    apiCallCountComplete: true,
    models: [first.model],
    modelTotals: {},
    costSummary,
    userInitiated: calls.every((call) => call.turn?.userInitiated),
    apiCallIds: calls.flatMap((call) => [
      call.apiCallId,
      ...(call.generationTiming?.apiCallId ? [call.generationTiming.apiCallId] : []),
    ]),
  }
  for (const call of calls) {
    const time = eventTimestampMs(call)
    if (time > 0) {
      result.startedAtMs = result.startedAtMs ? Math.min(result.startedAtMs, time) : time
      result.updatedAtMs = Math.max(result.updatedAtMs, time)
    }
    for (const field of [
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'reasoningTokens',
      'totalTokens',
    ] as const)
      result[field] += call[field]
    result.apiCallCountComplete &&= call.evidence?.granularity !== 'aggregate'
    result.modelTotals[call.model] = (result.modelTotals[call.model] ?? 0) + call.totalTokens
    result.latestGeneration = latestGeneration(result.latestGeneration, generationSample(call))
  }
  return result
}

export function ensureLatestTurnSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS usage_turn_usage (
    agent TEXT NOT NULL, session_id TEXT NOT NULL, date TEXT NOT NULL, model TEXT NOT NULL,
    turn_id TEXT NOT NULL, user_initiated INTEGER NOT NULL, first_ms INTEGER NOT NULL,
    last_ms INTEGER NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (agent, session_id, date, model, turn_id)
  );
  CREATE INDEX IF NOT EXISTS idx_turn_usage_session ON usage_turn_usage(agent, session_id, first_ms);
  CREATE TABLE IF NOT EXISTS usage_latest_turn_state (
    agent TEXT NOT NULL, session_id TEXT NOT NULL, turn_id TEXT NOT NULL,
    started_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, status TEXT, payload TEXT,
    PRIMARY KEY (agent, session_id)
  )`)
  const columns = db.prepare('PRAGMA table_info(usage_latest_turn_state)').all() as Array<{
    name: string
  }>
  if (!columns.some((column) => column.name === 'payload'))
    db.exec('ALTER TABLE usage_latest_turn_state ADD COLUMN payload TEXT')
}

/** Rebuilt only with the affected usage partition; never reread a session's API history. */
export function writeSessionTurnUsage(
  db: Database.Database,
  session: TokenUsageSession,
  turns: readonly SessionTurnUsage[],
): void {
  const key = [session.agent, session.sessionId, session.date, session.model]
  const previous = new Map(
    (
      db
        .prepare(
          'SELECT turn_id, payload FROM usage_turn_usage WHERE agent=? AND session_id=? AND date=? AND model=?',
        )
        .all(...key) as Array<{ turn_id: string; payload: string }>
    ).map((row) => [row.turn_id, JSON.parse(row.payload) as LatestSessionTurn]),
  )
  db.prepare(
    'DELETE FROM usage_turn_usage WHERE agent=? AND session_id=? AND date=? AND model=?',
  ).run(...key)
  const write = db.prepare('INSERT INTO usage_turn_usage VALUES (?,?,?,?,?,?,?,?,?)')
  for (const turn of turns) {
    const { apiCallIds, userInitiated, ...value } = turn
    const prior = normalizeLatestGeneration(previous.get(turn.turnId)?.latestGeneration)
    if (prior && apiCallIds.includes(prior.apiCallId)) {
      if (prior.firstToken && !apiCallIds.includes(prior.firstToken.apiCallId))
        delete prior.firstToken
      value.latestGeneration = latestGeneration(prior, value.latestGeneration)
    }
    write.run(
      ...key,
      turn.turnId,
      userInitiated ? 1 : 0,
      turn.startedAtMs,
      turn.updatedAtMs,
      JSON.stringify(value),
    )
  }
  db.prepare(
    'UPDATE usage_session_data SET turn_usage_ready=1 WHERE agent=? AND session_id=? AND date=? AND model=? AND turn_usage_ready=0',
  ).run(...key)
}

/** Upgrade saved request ownership once, including sessions whose source files no longer exist. */
function backfillSavedTurns(db: Database.Database, source: string, args: string[]): void {
  const rows = db
    .prepare(
      `${source} SELECT d.* FROM usage_session_data d JOIN selected USING(agent,session_id)
    WHERE d.turn_usage_ready=0`,
    )
    .all(...args) as SessionDataRow[]
  if (!rows.length) return
  db.transaction(() => {
    const readSample = db.prepare(
      'SELECT * FROM usage_session_generation WHERE agent=? AND session_id=?',
    )
    for (const row of rows) {
      let value: ReturnType<typeof aggregateSessionUsage>
      try {
        value = aggregateSessionUsage(decodeMeterData(row))
      } catch {
        // A damaged or unknown legacy blob must not prevent reading the existing session totals.
        db.prepare(
          'UPDATE usage_session_data SET turn_usage_ready=1 WHERE agent=? AND session_id=? AND date=? AND model=?',
        ).run(row.agent, row.session_id, row.date, row.model)
        continue
      }
      const stored = readSample.get(row.agent, row.session_id) as SessionGenerationRow | undefined
      for (const turn of value.turnUsage ?? []) {
        const sample = stored ? sessionGenerationFromRow(stored) : undefined
        if (!sample || !turn.apiCallIds.includes(sample.apiCallId)) continue
        if (sample.firstToken && !turn.apiCallIds.includes(sample.firstToken.apiCallId))
          delete sample.firstToken
        turn.latestGeneration = latestGeneration(turn.latestGeneration, sample)
      }
      writeSessionTurnUsage(db, value.session, value.turnUsage ?? [])
    }
  })()
}

export function storeLatestTurnStates(
  db: Database.Database,
  agent: string,
  states: readonly SessionTurnState[] = [],
): void {
  const write = db.prepare(`INSERT INTO usage_latest_turn_state VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(agent, session_id) DO UPDATE SET turn_id=excluded.turn_id,
      started_at_ms=excluded.started_at_ms, updated_at_ms=excluded.updated_at_ms, status=excluded.status, payload=excluded.payload
    WHERE excluded.started_at_ms > started_at_ms OR
      (excluded.turn_id = turn_id AND (excluded.updated_at_ms > updated_at_ms OR
        excluded.updated_at_ms = updated_at_ms AND (excluded.status IS NOT status OR excluded.payload IS NOT payload)))`)
  for (const state of states) {
    if (
      !state.sessionId ||
      !state.turnId ||
      !Number.isSafeInteger(state.startedAtMs) ||
      state.startedAtMs <= 0 ||
      !Number.isSafeInteger(state.updatedAtMs) ||
      state.updatedAtMs < state.startedAtMs
    )
      continue
    const sample = normalizeLatestGeneration(state.latestGeneration)
    const scopedSample =
      sample?.sessionId === state.sessionId && sample.completedAtMs >= state.startedAtMs
        ? sample
        : undefined
    if (scopedSample?.firstToken && scopedSample.firstToken.completedAtMs < state.startedAtMs)
      delete scopedSample.firstToken
    write.run(
      agent,
      state.sessionId,
      state.turnId,
      state.startedAtMs || state.updatedAtMs,
      state.updatedAtMs,
      state.status ?? null,
      scopedSample || state.reportedUsage
        ? JSON.stringify({ latestGeneration: scopedSample, reportedUsage: state.reportedUsage })
        : null,
    )
  }
}

const identity = (value: { agent: string; sessionId: string }): string =>
  JSON.stringify([value.agent, value.sessionId])

/** Compact turn/model rows, including all days of a turn, independent of list date filters. */
export function readLatestSessionTurns(
  db: Database.Database,
  sessions: readonly { agent: string; sessionId: string; parentSessionId?: string }[],
): Map<string, LatestSessionTurn> {
  const result = new Map<string, LatestSessionTurn>()
  const selected = [...new Map(sessions.map((s) => [identity(s), s])).values()]
  for (let offset = 0; offset < selected.length; offset += 200) {
    const batch = selected.slice(offset, offset + 200)
    const values = batch.map(() => '(?,?)').join(',')
    const args = batch.flatMap((s) => [s.agent, s.sessionId])
    const source = `WITH selected(agent,session_id) AS (VALUES ${values})`
    backfillSavedTurns(db, source, args)
    const rows = db
      .prepare(`${source} SELECT u.* FROM usage_turn_usage u JOIN selected USING(agent,session_id)`)
      .all(...args) as Array<{
      agent: string
      session_id: string
      turn_id: string
      user_initiated: number
      first_ms: number
      payload: string
    }>
    const states = db
      .prepare(
        `${source} SELECT s.* FROM usage_latest_turn_state s JOIN selected USING(agent,session_id)`,
      )
      .all(...args) as Array<{
      agent: string
      session_id: string
      turn_id: string
      started_at_ms: number
      updated_at_ms: number
      status: SessionTurnState['status'] | null
      payload: string | null
    }>
    for (const session of batch) {
      const candidates = rows.filter(
        (row) =>
          row.agent === session.agent &&
          row.session_id === session.sessionId &&
          row.first_ms > 0 &&
          (session.parentSessionId || row.user_initiated),
      )
      const firsts = new Map<string, number>()
      for (const row of candidates)
        firsts.set(
          row.turn_id,
          Math.min(firsts.get(row.turn_id) ?? Infinity, row.first_ms || Infinity),
        )
      const latest = [...firsts].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]
      const native = states.find(
        (s) => s.agent === session.agent && s.session_id === session.sessionId,
      )
      const useNative =
        native && (!latest || latest[0] === native.turn_id || latest[1] <= native.updated_at_ms)
      const turnId = useNative ? native.turn_id : latest?.[0]
      if (!turnId) continue
      const pieces = candidates
        .filter((r) => r.turn_id === turnId)
        .map((r) => JSON.parse(r.payload) as LatestSessionTurn)
      const value: LatestSessionTurn = {
        sessionId: session.sessionId,
        turnId,
        startedAtMs: useNative ? native.started_at_ms : latest![1],
        updatedAtMs: useNative ? native.updated_at_ms : 0,
        ...(useNative && native.status ? { status: native.status } : {}),
        usageAvailable: pieces.length > 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        apiCallCount: 0,
        apiCallCountComplete: pieces.length > 0,
        models: [],
        modelTotals: {},
      }
      for (const piece of pieces) {
        for (const field of [
          'inputTokens',
          'outputTokens',
          'cacheReadTokens',
          'cacheWriteTokens',
          'reasoningTokens',
          'totalTokens',
          'apiCallCount',
        ] as const)
          value[field] += piece[field]
        value.apiCallCountComplete &&= piece.apiCallCountComplete
        value.updatedAtMs = Math.max(value.updatedAtMs, piece.updatedAtMs)
        for (const [model, tokens] of Object.entries(piece.modelTotals))
          value.modelTotals[model] = (value.modelTotals[model] ?? 0) + tokens
        value.latestGeneration = latestGeneration(value.latestGeneration, piece.latestGeneration)
      }
      value.models = Object.keys(value.modelTotals).sort(
        (a, b) => value.modelTotals[b] - value.modelTotals[a] || a.localeCompare(b),
      )
      if (useNative && native.payload) {
        try {
          const payload = JSON.parse(native.payload)
          value.latestGeneration = latestGeneration(
            value.latestGeneration,
            normalizeLatestGeneration(payload.latestGeneration),
          )
          if (!pieces.length && payload.reportedUsage) {
            const reported = normalizeLatestSessionTurn(
              { ...value, ...payload.reportedUsage, usageAvailable: true },
              session.sessionId,
            )
            if (reported)
              Object.assign(value, reported, { costSummary: payload.reportedUsage.costSummary })
          }
        } catch {
          /* keep valid call samples */
        }
      }
      const costs = pieces.flatMap((p) => (p.costSummary ? [p.costSummary] : []))
      if (costs.length) value.costSummary = combineCostRollups(costs, costs[0].catalogVersion)
      result.set(identity(session), value)
    }
  }
  return result
}

export function attachLatestSessionTurns(
  db: Database.Database,
  sessions: TokenUsageSession[],
): void {
  const targets = sessions.flatMap((s) => [
    s,
    ...(('children' in s ? s.children : []) as TokenUsageSession[]),
  ])
  const turns = readLatestSessionTurns(db, targets)
  for (const session of targets) {
    const turn = turns.get(identity(session))
    if (
      turn &&
      session.latestTurnFirstToken?.turnId === turn.turnId &&
      session.latestTurnFirstToken.sessionId === session.sessionId
    )
      turn.latestTurnFirstToken = session.latestTurnFirstToken
    session.latestTurn = turn
  }
}

export function mergeStagedTurnStates(
  db: Database.Database,
  agents: string[],
  schema: string,
): void {
  if (!/^scan_staging(?:_\d+)?$/.test(schema)) throw new Error('Invalid staging schema')
  for (const agent of agents) {
    const rows = db
      .prepare(`SELECT * FROM ${schema}.usage_latest_turn_state WHERE agent=?`)
      .all(agent) as Array<{
      session_id: string
      turn_id: string
      started_at_ms: number
      updated_at_ms: number
      status: SessionTurnState['status'] | null
      payload: string | null
    }>
    storeLatestTurnStates(
      db,
      agent,
      rows.map((r) => ({
        sessionId: r.session_id,
        turnId: r.turn_id,
        startedAtMs: r.started_at_ms,
        updatedAtMs: r.updated_at_ms,
        ...(r.status ? { status: r.status } : {}),
        ...(r.payload ? JSON.parse(r.payload) : {}),
      })),
    )
  }
}
