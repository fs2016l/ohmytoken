import type Database from 'better-sqlite3'
import type { LatestGeneration, TokenUsageApiCall } from '../../shared/models'
import {
  composeLatestGeneration,
  generationFirstToken,
  generationSample,
  generationSpeedRank,
  latestFirstToken,
  latestGeneration,
  normalizeLatestFirstToken,
  normalizeLatestGeneration,
  parseLatestGeneration,
  splitLatestGeneration,
} from '../../shared/generation-timing'

export interface SessionGenerationRow {
  agent: string
  session_id: string
  api_call_id: string
  model: string
  completed_at_ms: number
  time_to_first_token_ms: number | null
  stream_duration_ms: number | null
  generated_tokens: number | null
  tokens_per_second: number | null
  time_source: string | null
  speed_kind?: string | null
  response_duration_ms?: number | null
  ttft_kind?: string | null
  speed_excluded?: number | null
  first_token?: string | null
}

export function sessionGenerationFromRow(row: SessionGenerationRow): LatestGeneration | undefined {
  return normalizeLatestGeneration({
    sessionId: row.session_id,
    apiCallId: row.api_call_id,
    model: row.model,
    completedAtMs: row.completed_at_ms,
    timeToFirstTokenMs: row.time_to_first_token_ms ?? undefined,
    streamDurationMs: row.stream_duration_ms ?? undefined,
    generatedTokens: row.generated_tokens ?? undefined,
    tokensPerSecond: row.tokens_per_second ?? undefined,
    timeSource: row.time_source ?? undefined,
    speedKind: row.speed_kind ?? undefined,
    responseDurationMs: row.response_duration_ms ?? undefined,
    ttftKind: row.ttft_kind ?? undefined,
    speedExcluded: row.speed_excluded ? true : undefined,
    firstToken: parseFirstToken(row.first_token),
  })
}

function parseFirstToken(value: string | null | undefined): LatestGeneration['firstToken'] {
  if (!value) return undefined
  try {
    return normalizeLatestFirstToken(JSON.parse(value))
  } catch {
    return undefined
  }
}

/** 与日期/模型用量分区独立，重建统计不会删除已取得的计时证据。 */
export function ensureSessionGenerationSchema(db: Database.Database): void {
  if (
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usage_session_generation'",
      )
      .get()
  ) {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(usage_session_generation)').all() as { name: string }[]).map(
        ({ name }) => name,
      ),
    )
    db.transaction(() => {
      if (!columns.has('speed_kind'))
        db.exec('ALTER TABLE usage_session_generation ADD COLUMN speed_kind TEXT')
      if (!columns.has('response_duration_ms'))
        db.exec('ALTER TABLE usage_session_generation ADD COLUMN response_duration_ms REAL')
      if (!columns.has('ttft_kind'))
        db.exec('ALTER TABLE usage_session_generation ADD COLUMN ttft_kind TEXT')
      if (!columns.has('first_token'))
        db.exec('ALTER TABLE usage_session_generation ADD COLUMN first_token TEXT')
      if (!columns.has('speed_excluded'))
        db.exec('ALTER TABLE usage_session_generation ADD COLUMN speed_excluded INTEGER')
      resetChangedGenerationSemantics(db)
    })()
    return
  }
  db.transaction(() => {
    db.exec(`CREATE TABLE usage_session_generation (
      agent TEXT NOT NULL, session_id TEXT NOT NULL, api_call_id TEXT NOT NULL,
      model TEXT NOT NULL, completed_at_ms INTEGER NOT NULL,
      time_to_first_token_ms REAL, stream_duration_ms REAL,
      generated_tokens INTEGER, tokens_per_second REAL, time_source TEXT,
      speed_kind TEXT, response_duration_ms REAL,
      ttft_kind TEXT, speed_excluded INTEGER, first_token TEXT,
      PRIMARY KEY (agent, session_id)
    )`)
    // 升级仅读取旧分组缓存，不解压历史调用，也不强制重扫来源。
    for (const table of ['usage_sessions', 'usage_session_projects']) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      if (!columns.some(({ name }) => name === 'latest_generation')) continue
      const grouped = new Map<string, LatestGeneration[]>()
      for (const row of db
        .prepare(
          `SELECT agent, latest_generation FROM ${table} WHERE latest_generation IS NOT NULL`,
        )
        .iterate() as Iterable<{ agent: string; latest_generation: string }>) {
        const sample = parseLatestGeneration(row.latest_generation)
        if (!sample) continue
        const samples = grouped.get(row.agent) ?? []
        samples.push(sample)
        grouped.set(row.agent, samples)
      }
      for (const [agent, samples] of grouped) storeLatestGenerationSamples(db, agent, samples)
    }
    resetChangedGenerationSemantics(db)
  })()
}

/**
 * 计时口径变化且来源每次扫描都能完整重读时，按 Agent 清除一次旧样本，由下一次扫描重建；
 * 同一 API 的合并会保留旧字段，不能靠新样本覆盖。版本记录在独立表中，与列迁移解耦。
 */
const GENERATION_SEMANTICS_REVISIONS: Readonly<Record<string, number>> = {
  // 1：旧样本把整块下发的工具调用间隔当流时长，分子还包含首个片段前生成的思考。
  // 2：短于最短窗口的纯文本响应不再作为流速样本。
  antigravity: 2,
}

function resetChangedGenerationSemantics(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS usage_session_generation_revision (
    agent TEXT PRIMARY KEY, revision INTEGER NOT NULL
  )`)
  const read = db.prepare('SELECT revision FROM usage_session_generation_revision WHERE agent = ?')
  for (const [agent, revision] of Object.entries(GENERATION_SEMANTICS_REVISIONS)) {
    const stored = (read.get(agent) as { revision: number } | undefined)?.revision ?? 0
    if (stored >= revision) continue
    db.prepare('DELETE FROM usage_session_generation WHERE agent = ?').run(agent)
    db.prepare(
      `INSERT INTO usage_session_generation_revision (agent, revision) VALUES (?, ?)
      ON CONFLICT(agent) DO UPDATE SET revision = excluded.revision`,
    ).run(agent, revision)
  }
}

/** 一批扫描先选出每会话最新样本；历史 API 不逐条写 SQL。 */
export function storeLatestGenerationCalls(
  db: Database.Database,
  agent: string,
  calls: readonly TokenUsageApiCall[],
  nativeSamples: readonly LatestGeneration[] = [],
): number {
  const samples = new Map<string, LatestGeneration>()
  for (const call of calls) {
    if (call.agent !== agent) continue
    const sample = generationSample(call)
    if (sample) samples.set(sample.sessionId, selectSample(samples.get(sample.sessionId), sample))
  }
  for (const value of nativeSamples) {
    const sample = normalizeLatestGeneration(value)
    if (sample) samples.set(sample.sessionId, selectSample(samples.get(sample.sessionId), sample))
  }
  return storeLatestGenerationSamples(db, agent, [...samples.values()])
}

export function storeLatestGenerationSamples(
  db: Database.Database,
  agent: string,
  samples: readonly LatestGeneration[],
  preserveExistingFields = false,
): number {
  const latest = new Map<string, LatestGeneration>()
  for (const value of samples) {
    const sample = normalizeLatestGeneration(value)
    if (!sample) continue
    latest.set(sample.sessionId, selectSample(latest.get(sample.sessionId), sample))
  }
  if (!agent || !latest.size) return 0
  return db.transaction(() => {
    const read = db.prepare(
      'SELECT * FROM usage_session_generation WHERE agent = ? AND session_id = ?',
    )
    const write = db.prepare(`INSERT INTO usage_session_generation
      (agent, session_id, api_call_id, model, completed_at_ms, time_to_first_token_ms,
        stream_duration_ms, generated_tokens, tokens_per_second, time_source,
        speed_kind, response_duration_ms, ttft_kind, speed_excluded, first_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent, session_id) DO UPDATE SET
        api_call_id = excluded.api_call_id, model = excluded.model,
        completed_at_ms = excluded.completed_at_ms,
        time_to_first_token_ms = excluded.time_to_first_token_ms,
        stream_duration_ms = excluded.stream_duration_ms,
        generated_tokens = excluded.generated_tokens,
        tokens_per_second = excluded.tokens_per_second, time_source = excluded.time_source,
        speed_kind = excluded.speed_kind, response_duration_ms = excluded.response_duration_ms,
        ttft_kind = excluded.ttft_kind, speed_excluded = excluded.speed_excluded,
        first_token = excluded.first_token`)
    let changed = 0
    for (const [sessionId, sample] of latest) {
      const row = read.get(agent, sessionId) as SessionGenerationRow | undefined
      const previous = row && sessionGenerationFromRow(row)
      const next = selectSample(previous, sample, preserveExistingFields)
      if (JSON.stringify(previous) === JSON.stringify(next)) continue
      write.run(
        agent,
        sessionId,
        next.apiCallId,
        next.model,
        next.completedAtMs,
        next.timeToFirstTokenMs ?? null,
        next.streamDurationMs ?? null,
        next.generatedTokens ?? null,
        next.tokensPerSecond ?? null,
        next.timeSource ?? null,
        next.speedKind ?? null,
        next.responseDurationMs ?? null,
        next.ttftKind ?? null,
        next.speedExcluded ? 1 : null,
        next.firstToken ? JSON.stringify(next.firstToken) : null,
      )
      changed++
    }
    return changed
  })()
}

/**
 * 速度样本与首 Token 调用分别取最近值，再组合成一行：速度样本缺首字时沿用旧行或本批中
 * 最近一次有首字的调用；全量暂存合并时同一调用以主库已有字段优先。
 */
function selectSample(
  previous: LatestGeneration | undefined,
  sample: LatestGeneration,
  preserveExistingFields = false,
): LatestGeneration {
  const [previousMain] = splitLatestGeneration(previous)
  const [sampleMain] = splitLatestGeneration(sample)
  const main =
    preserveExistingFields &&
    previousMain &&
    sampleMain &&
    sameCompletedApi(previousMain, sampleMain)
      ? selectMain(sampleMain, previousMain)
      : selectMain(previousMain, sampleMain)
  return composeLatestGeneration(
    splitLatestGeneration(main)[0],
    latestFirstToken(generationFirstToken(previous), generationFirstToken(sample)),
  )!
}

const SPEED_FIELDS = [
  'speedKind',
  'responseDurationMs',
  'streamDurationMs',
  'generatedTokens',
  'tokensPerSecond',
] as const

/** 同一次已完成调用晚补字段，不混合不同调用的首字和流速。 */
function selectMain(
  previous: LatestGeneration | undefined,
  sample: LatestGeneration | undefined,
): LatestGeneration | undefined {
  if (!sample) return previous
  if (!previous || !sameCompletedApi(previous, sample)) return latestGeneration(previous, sample)
  const combined: LatestGeneration = { ...previous, ...sample }
  const previousRank = generationSpeedRank(previous)
  const sampleRank = generationSpeedRank(sample)
  // 较弱的估算不能替换同一调用已有的原生流或推导流区间。
  if (sampleRank && previousRank > sampleRank)
    for (const field of SPEED_FIELDS) {
      if (previous[field] === undefined) delete combined[field]
      else Object.assign(combined, { [field]: previous[field] })
    }
  // 原生首 Token 不被同一调用的推导值覆盖；新值缺少估算标记时也不能沿用旧标记。
  if (sample.timeToFirstTokenMs !== undefined) {
    if (previous.timeToFirstTokenMs !== undefined && !previous.ttftKind && sample.ttftKind) {
      combined.timeToFirstTokenMs = previous.timeToFirstTokenMs
      delete combined.ttftKind
    } else if (!sample.ttftKind) delete combined.ttftKind
  }
  if (combined.streamDurationMs && combined.generatedTokens !== undefined) {
    delete combined.speedKind
    delete combined.responseDurationMs
    if (combined.generatedTokens > 0)
      combined.tokensPerSecond = (combined.generatedTokens * 1000) / combined.streamDurationMs
    else delete combined.tokensPerSecond
  } else if (combined.speedKind !== undefined && combined.generatedTokens !== undefined) {
    if (combined.generatedTokens > 0)
      combined.tokensPerSecond = (combined.generatedTokens * 1000) / combined.responseDurationMs!
    else delete combined.tokensPerSecond
  }
  return normalizeLatestGeneration(combined)!
}

function sameCompletedApi(previous: LatestGeneration, sample: LatestGeneration): boolean {
  return (
    previous.apiCallId === sample.apiCallId &&
    previous.sessionId === sample.sessionId &&
    previous.model === sample.model &&
    previous.completedAtMs === sample.completedAtMs
  )
}

/** 全量暂存仅合并新样本，主库已有的更晚样本与未回读样本都保留。 */
export function mergeStagedGenerationSamples(
  db: Database.Database,
  agents: string[],
  schema: string,
): void {
  if (!db.inTransaction || !/^scan_staging(?:_\d+)?$/.test(schema))
    throw new Error('计时样本归并必须在扫描替换事务中执行')
  if (
    !db
      .prepare(
        `SELECT 1 FROM ${schema}.sqlite_master WHERE type = 'table' AND name = 'usage_session_generation'`,
      )
      .get()
  )
    return
  const read = db.prepare(`SELECT * FROM ${schema}.usage_session_generation WHERE agent = ?`)
  for (const agent of agents) {
    const samples: LatestGeneration[] = []
    for (const row of read.iterate(agent) as Iterable<SessionGenerationRow>) {
      const sample = sessionGenerationFromRow(row)
      if (sample) samples.push(sample)
    }
    storeLatestGenerationSamples(db, agent, samples, true)
  }
}
