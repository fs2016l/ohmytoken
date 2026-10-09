import type Database from 'better-sqlite3'
import type { UsageCostAssessment, UsageCostRollup } from '../../shared/usage-cost'
import { summarizeCostGroups } from '../../shared/cost-rollup'
import { PRICE_CATALOG_VERSION } from './price-catalog'

export interface CostRollupRow {
  cost_revision: string | null
  cost_summary: string | null
}

export function parseCostRollup(row: CostRollupRow): UsageCostRollup | undefined {
  if (row.cost_revision !== PRICE_CATALOG_VERSION || !row.cost_summary) return undefined
  const result = JSON.parse(row.cost_summary) as UsageCostRollup
  return result.catalogVersion === PRICE_CATALOG_VERSION ? result : undefined
}

/** 只汇总已按当前版本计价的逐次记录；过期缓存使本次汇总保持待更新。 */
export function aggregateCallCosts(
  db: Database.Database,
  where: string,
  params: (string | number)[],
): UsageCostRollup | undefined {
  const rows = db
    .prepare(
      `SELECT a.agent, a.model, c.group_json,
    COUNT(*) AS records, SUM(a.total_tokens) AS tokens,
    SUM(a.usage_evidence IS NULL) AS legacy_records,
    SUM(c.min_cost) AS min_cost, SUM(c.max_cost) AS max_cost,
    SUM(c.revision IS NULL OR c.revision != ?) AS pending
    FROM usage_api_calls a LEFT JOIN usage_cost_cache c
      ON c.agent = a.agent AND c.api_call_id = a.api_call_id
    WHERE ${where}
    GROUP BY a.agent, a.model, c.group_json`,
    )
    .all(PRICE_CATALOG_VERSION, ...params) as Array<{
    agent: string
    model: string
    group_json: string | null
    records: number
    tokens: number
    legacy_records: number
    min_cost: number | null
    max_cost: number | null
    pending: number
  }>
  if (rows.some((row) => row.pending > 0)) return undefined
  return summarizeCostGroups(
    rows.map((row) => ({
      ...(JSON.parse(row.group_json!) as UsageCostAssessment),
      agent: row.agent,
      model: row.model,
      records: row.records,
      tokens: row.tokens,
      min: row.min_cost ?? undefined,
      max: row.max_cost ?? undefined,
    })),
    PRICE_CATALOG_VERSION,
    rows.reduce((sum, row) => sum + row.legacy_records, 0),
  )
}

export function refreshCostRollupBatch(db: Database.Database): number {
  let updated = 0
  for (const table of ['usage_sessions', 'usage_records'] as const) {
    const rows = db
      .prepare(
        `SELECT rowid, * FROM ${table}
      WHERE cost_revision IS NULL OR cost_revision != ? OR cost_summary IS NULL LIMIT 32`,
      )
      .all(PRICE_CATALOG_VERSION) as Array<{
      rowid: number
      agent: string
      session_id?: string
      date: string
      model: string
    }>
    const write = db.prepare(
      `UPDATE ${table} SET cost_revision = ?, cost_summary = ? WHERE rowid = ?`,
    )
    for (const row of rows) {
      const where =
        'a.agent = ? AND a.date = ? AND a.model = ?' +
        (table === 'usage_sessions' ? ' AND a.session_id = ?' : '')
      const params = [
        row.agent,
        row.date,
        row.model,
        ...(table === 'usage_sessions' ? [row.session_id!] : []),
      ]
      const rollup = aggregateCallCosts(db, where, params)
      if (!rollup) continue
      write.run(PRICE_CATALOG_VERSION, JSON.stringify(rollup), row.rowid)
      updated++
    }
  }
  return updated
}
