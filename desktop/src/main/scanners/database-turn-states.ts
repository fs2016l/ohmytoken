import type Database from 'better-sqlite3'
import type { SessionTurnState, LatestGeneration, TokenUsageApiCall } from '../../shared/models'
import { timestampEpochMs } from '../lib/date-utils'
import { turnStatusFromReason } from './latest-turn-tracker'
import { isUserPrompt } from './conversation-turn'
import { openCodeTurnReader } from './opencode-turns'
import { splitInclusiveTokenBuckets } from './token-usage'
import { reportedTurnUsage } from './reported-turn-usage'
import { gooseGenerationTimingReader } from './goose-generation-timing'
import { generationSample, latestGeneration } from '../../shared/generation-timing'
import { timestampsFromValue, dateFromTimestamp, hourFromTimestamp } from './detail-utils'

type Row = Record<string, unknown>
function columns(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name),
  )
}
function supports(db: Database.Database, table: string, names: string[]): boolean {
  const found = columns(db, table)
  return names.every((name) => found.has(name))
}
function time(value: unknown): number {
  return typeof value === 'number' || typeof value === 'string' ? timestampEpochMs(value) : 0
}

/** Read the durable request receipt, not the session's last idle state. */
export function readMiniMaxTurnStates(
  db: Database.Database,
  samples: readonly LatestGeneration[] = [],
): SessionTurnState[] {
  if (
    !supports(db, 'local_runtime_turn_ingress', [
      'turn_id',
      'session_id',
      'status',
      'accepted_at_ms',
      'completed_at_ms',
    ]) ||
    !supports(db, 'local_runtime_message_rows', ['id', 'session_id', 'turn_id', 'role', 'source'])
  )
    return []
  const rows = db
    .prepare(
      `SELECT i.* FROM local_runtime_turn_ingress i JOIN
    (SELECT session_id, turn_id, MAX(id) AS last_user FROM local_runtime_message_rows
      WHERE role='user' AND source='api' AND turn_id IS NOT NULL GROUP BY session_id, turn_id) u
    ON u.session_id=i.session_id AND u.turn_id=i.turn_id
    ORDER BY i.accepted_at_ms, u.last_user`,
    )
    .all() as Row[]
  const states: SessionTurnState[] = rows.flatMap((row) => {
    const startedAtMs = time(row.accepted_at_ms)
    if (!startedAtMs || typeof row.session_id !== 'string' || typeof row.turn_id !== 'string')
      return []
    const status = row.status === 'accepted' ? 'running' : turnStatusFromReason(row.status)
    return [
      {
        sessionId: row.session_id,
        turnId: row.turn_id,
        startedAtMs,
        updatedAtMs: time(row.completed_at_ms) || startedAtMs,
        ...(status ? { status } : {}),
      },
    ]
  })
  if (supports(db, 'local_runtime_message_rows', ['session_id', 'msg_id', 'turn_id'])) {
    const read = db.prepare(
      'SELECT turn_id FROM local_runtime_message_rows WHERE session_id=? AND msg_id=? LIMIT 1',
    )
    for (const sample of samples) {
      const prefix = `minimax-message:${sample.sessionId}:`
      if (!sample.apiCallId.startsWith(prefix)) continue
      const row = read.get(sample.sessionId, sample.apiCallId.slice(prefix.length)) as
        { turn_id: string } | undefined
      const state = states.find(
        (state) => state.sessionId === sample.sessionId && state.turnId === row?.turn_id,
      )
      if (state) state.latestGeneration = sample
    }
  }
  return states
}

export function readZCodeTurnStates(db: Database.Database): SessionTurnState[] {
  if (
    !supports(db, 'turn_usage', [
      'session_id',
      'turn_id',
      'user_message_id',
      'status',
      'started_at',
      'completed_at',
    ])
  )
    return []
  const rows = db
    .prepare(
      'SELECT session_id,turn_id,user_message_id,status,started_at,completed_at FROM turn_usage ORDER BY started_at',
    )
    .all() as Row[]
  return rows.flatMap((row) => {
    const startedAtMs = time(row.started_at)
    if (
      !startedAtMs ||
      typeof row.session_id !== 'string' ||
      typeof row.user_message_id !== 'string' ||
      !row.user_message_id
    )
      return []
    const status = ['started', 'running', 'pending'].includes(String(row.status))
      ? ('running' as const)
      : turnStatusFromReason(row.status)
    return [
      {
        sessionId: row.session_id,
        turnId: row.user_message_id,
        startedAtMs,
        updatedAtMs: time(row.completed_at) || startedAtMs,
        ...(status ? { status } : {}),
      },
    ]
  })
}

/** v2 has an explicit idle outcome after a user message; tool/API completion is ignored. */
export function readOpenCodeTurnStates(db: Database.Database): SessionTurnState[] {
  if (!supports(db, 'session_message', ['id', 'session_id', 'type', 'seq', 'time_created', 'data']))
    return []
  const rows = db
    .prepare(
      `SELECT id,session_id,type,seq,time_created,data FROM session_message
    WHERE type IN ('user','idle') ORDER BY session_id,seq`,
    )
    .iterate() as Iterable<Row>
  const states = new Map<string, SessionTurnState>()
  const readTurn = supports(db, 'part', ['id', 'message_id', 'data'])
    ? openCodeTurnReader(db, 'session_message')
    : undefined
  for (const row of rows) {
    if (typeof row.session_id !== 'string') continue
    const timestamp = time(row.time_created)
    if (!timestamp) continue
    if (row.type === 'user' && typeof row.id === 'string') {
      if (readTurn && readTurn(row.session_id, row.id)?.id !== row.id) continue
      states.set(row.session_id, {
        sessionId: row.session_id,
        turnId: row.id,
        startedAtMs: timestamp,
        updatedAtMs: timestamp,
        status: 'running',
      })
    } else {
      const state = states.get(row.session_id)
      if (!state || timestamp < state.startedAtMs) continue
      let data: Row
      try {
        data = JSON.parse(String(row.data)) as Row
      } catch {
        continue
      }
      const status = turnStatusFromReason(data.outcome)
      if (status) {
        state.status = status
        state.updatedAtMs = timestamp
      }
    }
  }
  return [...states.values()]
}

export function readGooseLatestTurn(
  db: Database.Database,
  sessionId: string,
  fallbackModel: string,
): SessionTurnState | undefined {
  if (
    !supports(db, 'messages', [
      'session_id',
      'role',
      'message_id',
      'timestamp',
      'content_json',
      'metadata_json',
    ])
  )
    return undefined
  const cols = columns(db, 'messages')
  const order = cols.has('id') ? 'id' : 'rowid'
  const rows = db
    .prepare(
      `SELECT ${order} AS ordering,message_id,role,timestamp,content_json,metadata_json FROM messages
    WHERE session_id=? ORDER BY ${order} DESC`,
    )
    .iterate(sessionId) as Iterable<Row>
  const after: Row[] = []
  let user: Row | undefined
  for (const row of rows) {
    if (row.role === 'user') {
      let content: unknown
      try {
        content = JSON.parse(String(row.content_json))
      } catch {
        content = undefined
      }
      if (
        Array.isArray(content) &&
        !content.some(
          (part) =>
            part &&
            typeof part === 'object' &&
            ['toolResponse', 'systemNotification', 'actionRequired'].includes(String(part.type)),
        ) &&
        isUserPrompt(content)
      ) {
        user = row
        break
      }
    }
    after.push(row)
  }
  if (!user) return undefined
  const timestamp = (row: Row): number => {
    if (typeof row.timestamp !== 'string') return 0
    const value = row.timestamp.trim().replace(' ', 'T')
    return time(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : value + 'Z')
  }
  const start = timestamp(user)
  if (!start) return undefined
  const state: SessionTurnState = {
    sessionId,
    turnId: `user:${String(user.message_id || user.ordering)}`,
    startedAtMs: start,
    updatedAtMs: start,
  }
  const calls: TokenUsageApiCall[] = []
  const readTiming = gooseGenerationTimingReader(db)
  for (const row of after.reverse()) {
    if (row.role !== 'assistant') continue
    let metadata: Record<string, unknown>
    try {
      metadata = JSON.parse(String(row.metadata_json))
    } catch {
      continue
    }
    const usage = metadata?.usage as Record<string, unknown> | undefined
    if (
      !usage ||
      !Number.isSafeInteger(usage.inputTokens) ||
      Number(usage.inputTokens) < 0 ||
      !Number.isSafeInteger(usage.outputTokens) ||
      Number(usage.outputTokens) < 0
    )
      continue
    const inference = metadata.inference as Record<string, unknown> | undefined
    const model =
      typeof inference?.resolvedModel === 'string'
        ? inference.resolvedModel
        : typeof inference?.requestedModel === 'string'
          ? inference.requestedModel
          : fallbackModel
    const at = timestamp(row)
    if (!at || at < start) continue
    const converted = timestampsFromValue(at, 'unknown')
    const call: TokenUsageApiCall = {
      agent: 'goose',
      sessionId,
      apiCallId: `goose-message:${String(row.message_id || row.ordering)}`,
      turn: { id: state.turnId, userInitiated: true },
      model,
      date: dateFromTimestamp(converted.timestamp),
      hour: hourFromTimestamp(converted.timestamp),
      timestamp: converted.timestamp,
      rawTimestamp: converted.rawTimestamp,
      ...splitInclusiveTokenBuckets({
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
      }),
    }
    const timing = readTiming(sessionId, model)
    if (timing?.apiCallId === call.apiCallId) call.generationTiming = timing
    state.latestGeneration = latestGeneration(state.latestGeneration, generationSample(call))
    state.updatedAtMs = Math.max(state.updatedAtMs, at)
    calls.push(call)
  }
  state.reportedUsage = reportedTurnUsage(calls)
  return state
}

/** Hermes' message token_count is text length, not billed API usage. Keep it out of the counters. */
export function readHermesLatestTurns(db: Database.Database): SessionTurnState[] {
  if (!supports(db, 'messages', ['id', 'session_id', 'role', 'timestamp'])) return []
  const cols = columns(db, 'messages')
  const where = [
    "role='user'",
    ...(cols.has('active') ? ['active=1'] : []),
    ...(cols.has('_compressed_summary') ? ['_compressed_summary=0'] : []),
  ]
  const rows = db
    .prepare(
      `SELECT id,session_id,timestamp FROM messages WHERE ${where.join(' AND ')} ORDER BY id`,
    )
    .iterate() as Iterable<Row>
  const result = new Map<string, SessionTurnState>()
  for (const row of rows) {
    const at = time(row.timestamp)
    if (!at || typeof row.session_id !== 'string') continue
    result.set(row.session_id, {
      sessionId: row.session_id,
      turnId: `message:${String(row.id)}`,
      startedAtMs: at,
      updatedAtMs: at,
    })
  }
  return [...result.values()]
}
