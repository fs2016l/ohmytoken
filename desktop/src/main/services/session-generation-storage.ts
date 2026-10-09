import type Database from 'better-sqlite3'
import type { LatestGeneration, TokenUsageApiCall } from '../../shared/models'
import {
  generationSample,
  latestGeneration,
  normalizeLatestGeneration,
  parseLatestGeneration,
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
  })
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
  })()
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
        speed_kind, response_duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent, session_id) DO UPDATE SET
        api_call_id = excluded.api_call_id, model = excluded.model,
        completed_at_ms = excluded.completed_at_ms,
        time_to_first_token_ms = excluded.time_to_first_token_ms,
        stream_duration_ms = excluded.stream_duration_ms,
        generated_tokens = excluded.generated_tokens,
        tokens_per_second = excluded.tokens_per_second, time_source = excluded.time_source,
        speed_kind = excluded.speed_kind, response_duration_ms = excluded.response_duration_ms`)
    let changed = 0
    for (const [sessionId, sample] of latest) {
      const row = read.get(agent, sessionId) as SessionGenerationRow | undefined
      const previous = row && sessionGenerationFromRow(row)
      const next =
        preserveExistingFields && previous && sameCompletedApi(previous, sample)
          ? selectSample(sample, previous)
          : selectSample(previous, sample)
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
      )
      changed++
    }
    return changed
  })()
}

/** 同一次已完成调用晚补字段，不混合不同调用的首字和流速。 */
function selectSample(
  previous: LatestGeneration | undefined,
  sample: LatestGeneration,
): LatestGeneration {
  if (previous && sameCompletedApi(previous, sample)) {
    const combined = { ...previous, ...sample }
    if (previous.streamDurationMs && sample.speedKind === 'response-estimate') {
      combined.streamDurationMs = previous.streamDurationMs
      combined.generatedTokens = previous.generatedTokens
      combined.tokensPerSecond = previous.tokensPerSecond
    }
    if (combined.streamDurationMs && combined.generatedTokens !== undefined) {
      delete combined.speedKind
      delete combined.responseDurationMs
      if (combined.generatedTokens > 0)
        combined.tokensPerSecond = (combined.generatedTokens * 1000) / combined.streamDurationMs
      else delete combined.tokensPerSecond
    } else if (
      combined.speedKind === 'response-estimate' &&
      combined.generatedTokens !== undefined
    ) {
      if (combined.generatedTokens > 0)
        combined.tokensPerSecond = (combined.generatedTokens * 1000) / combined.responseDurationMs!
      else delete combined.tokensPerSecond
    }
    return normalizeLatestGeneration(combined)!
  }
  return latestGeneration(previous, sample)!
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
