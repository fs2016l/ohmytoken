import type Database from 'better-sqlite3'
import type { UsageCostSummary } from '../../shared/usage-cost'
import { combineCostRollups } from '../../shared/cost-rollup'
import { PRICE_CATALOG_VERSION, priceCatalogReferenceDate } from './price-catalog'
import { needsEvidenceRecovery } from './evidence-recovery'
import { refreshCostCache } from './cost-cache'
import { aggregateCallCosts, parseCostRollup, type CostRollupRow } from './cost-rollup-storage'

export { migrateCostSchema } from './cost-schema'
export { refreshCostCache, callFromCostRow } from './cost-cache'

export async function readCostSummary(
  db: Database.Database,
  filter: { from?: string; to?: string; agent?: string } = {},
): Promise<UsageCostSummary> {
  const clauses: string[] = []
  const params: string[] = []
  for (const [name, operator, value] of [
    ['date', '>=', filter.from],
    ['date', '<=', filter.to],
    ['agent', '=', filter.agent],
  ] as const) {
    if (typeof value === 'string' && value.length > 0 && value.length <= 100) {
      clauses.push(`${name} ${operator} ?`)
      params.push(value)
    }
  }
  const snapshot = db.transaction((): UsageCostSummary | undefined => {
    const rows = db
      .prepare(
        `SELECT cost_revision, cost_summary FROM usage_records
      ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}`,
      )
      .all(...params) as CostRollupRow[]
    const rollups = rows.map(parseCostRollup)
    if (rollups.some((rollup) => !rollup)) return undefined
    let combined = combineCostRollups(
      rollups.map((rollup) => rollup!),
      PRICE_CATALOG_VERSION,
    )
    const sourceCount = db
      .prepare(
        `SELECT COALESCE(SUM(calls), 0) AS n FROM (
        SELECT agent, date, 1 AS calls FROM usage_api_calls
        UNION ALL SELECT s.agent, s.date, s.api_call_count AS calls FROM usage_sessions s
        WHERE EXISTS (SELECT 1 FROM usage_session_data d WHERE d.agent = s.agent)
      ) ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}`,
      )
      .get(...params) as { n: number }
    // 仅在旧库缺少日汇总行时读取未覆盖的调用；正常查看直接使用日汇总。
    if (combined.totalRecords !== sourceCount.n) {
      const orphaned = aggregateCallCosts(
        db,
        [
          ...clauses.map((clause) => 'a.' + clause),
          `NOT EXISTS (SELECT 1 FROM usage_records r WHERE r.agent = a.agent AND r.date = a.date AND r.model = a.model)`,
        ].join(' AND '),
        params,
      )
      if (!orphaned) return undefined
      combined = combineCostRollups([combined, orphaned], PRICE_CATALOG_VERSION)
      if (combined.totalRecords !== sourceCount.n) return undefined
    }
    return {
      ...combined,
      checkedAt: priceCatalogReferenceDate(),
      recoveryPending: (
        db.prepare('SELECT DISTINCT agent FROM usage_records').all() as Array<{ agent: string }>
      ).some(({ agent }) => needsEvidenceRecovery(db, agent)),
    }
  })
  while (db.open) {
    await refreshCostCache(db)
    if (!db.open) break
    const result = snapshot()
    if (result) return result
  }
  throw new Error('Usage database is closed')
}
