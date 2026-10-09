import { refreshSessionCosts } from '../services/session-usage-storage'
import type Database from 'better-sqlite3'
import type { TokenUsageApiCall } from '../../shared/models'
import type { UsageCostAssessment } from '../../shared/usage-cost'
import { estimateUsageCost } from './estimate-cost'
import { parseUsageEvidence } from './usage-evidence'
import { PRICE_CATALOG_VERSION } from './price-catalog'
import { refreshCostRollupBatch } from './cost-rollup-storage'

export interface CostRow {
  agent: string
  api_call_id: string
  session_id: string
  date: string
  timestamp: string
  raw_timestamp: string
  hour: number
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  usage_evidence: string | null
}

export function callFromCostRow(row: CostRow): TokenUsageApiCall {
  return {
    agent: row.agent,
    apiCallId: row.api_call_id,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    reasoningTokens: row.reasoning_tokens,
    totalTokens: row.total_tokens,
    evidence: parseUsageEvidence(row.usage_evidence),
    sessionId: row.session_id,
    date: row.date,
    timestamp: row.timestamp,
    rawTimestamp: row.raw_timestamp,
    hour: row.hour,
  }
}

const statements = new WeakMap<
  Database.Database,
  { read: Database.Statement; write: Database.Statement }
>()

function cacheStatements(db: Database.Database) {
  let cached = statements.get(db)
  if (!cached) {
    cached = {
      read: db.prepare(`SELECT group_json, min_cost, max_cost FROM usage_cost_cache
        WHERE agent = ? AND api_call_id = ? AND revision = ?`),
      write: db.prepare(`INSERT OR REPLACE INTO usage_cost_cache
        (agent, api_call_id, revision, group_json, min_cost, max_cost) VALUES (?, ?, ?, ?, ?, ?)`),
    }
    statements.set(db, cached)
  }
  return cached
}

export function writeCallCost(db: Database.Database, row: CostRow): UsageCostAssessment {
  const assessment = estimateUsageCost(callFromCostRow(row))
  const { min, max, reportedCost: _reported, ...group } = assessment
  cacheStatements(db).write.run(
    row.agent,
    row.api_call_id,
    PRICE_CATALOG_VERSION,
    JSON.stringify(group),
    min ?? null,
    max ?? null,
  )
  return assessment
}

/** 调用详情与总览共用同一份缓存；缺失时仅计算当前读取的调用。 */
export function readCallCost(db: Database.Database, row: CostRow): UsageCostAssessment {
  const cached = cacheStatements(db).read.get(row.agent, row.api_call_id, PRICE_CATALOG_VERSION) as
    | {
        group_json: string
        min_cost: number | null
        max_cost: number | null
      }
    | undefined
  if (!cached) return writeCallCost(db, row)
  return {
    ...(JSON.parse(cached.group_json) as UsageCostAssessment),
    min: cached.min_cost ?? undefined,
    max: cached.max_cost ?? undefined,
    reportedCost: parseUsageEvidence(row.usage_evidence)?.reportedCost,
  }
}

const pending = new WeakMap<Database.Database, Promise<void>>()

/** 每批事务结束后归还事件循环，旧版本费用全部更新后再发布汇总。 */
export function refreshCostCache(db: Database.Database): Promise<void> {
  const existing = pending.get(db)
  if (existing) return existing
  const work = rebuildCache(db).finally(() => pending.delete(db))
  pending.set(db, work)
  return work
}

async function rebuildCache(db: Database.Database): Promise<void> {
  await refreshSessionCosts(db)
  const read = db.prepare(`SELECT a.rowid, a.* FROM usage_api_calls a
    LEFT JOIN usage_cost_cache c ON c.agent = a.agent AND c.api_call_id = a.api_call_id
    WHERE a.rowid > ? AND (c.revision IS NULL OR c.revision != ?) ORDER BY a.rowid LIMIT 256`)
  let cursor = 0
  let readingCalls = true
  const write = (rows: Array<CostRow & { rowid: number }>) => {
    for (const row of rows) writeCallCost(db, row)
    cursor = rows.at(-1)?.rowid ?? 0
    return rows.length
  }
  const batch = db.transaction(() => {
    if (readingCalls) {
      const rows = read.all(cursor, PRICE_CATALOG_VERSION) as Array<CostRow & { rowid: number }>
      if (rows.length) return write(rows)
      readingCalls = false
    }
    const updated = refreshCostRollupBatch(db)
    if (updated) return updated
    // 其他读取或扫描可能在让出事件循环时修改早于游标的记录。
    const remaining = read.all(0, PRICE_CATALOG_VERSION) as Array<CostRow & { rowid: number }>
    if (!remaining.length) return 0
    readingCalls = true
    return write(remaining)
  })
  while (db.open && batch.immediate() > 0) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}
