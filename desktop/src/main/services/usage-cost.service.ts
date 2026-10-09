import type { UsageCostRollup, UsageCostSummary } from '../../shared/usage-cost'
import type { UsageDetailFilter } from '../../shared/models'
import { combineCostRollups } from '../../shared/cost-rollup'
import { parseCostRollup, type CostRollupRow } from '../cost/cost-rollup-storage'
import { openDatabase } from './sqlite-storage.service'
import { readCostSummary } from '../cost/cost-storage'
import { refreshCostCache } from '../cost/cost-cache'
import { PRICE_CATALOG_VERSION } from '../cost/price-catalog'
import { modelSqlSelection } from './model-identity.service'

/** 与明细统计共用当前读事务，只合并筛选范围内的日费用摘要。 */
export function readModelCostRollups(
  filter: Pick<UsageDetailFilter, 'agent' | 'model' | 'from' | 'to'>,
): Map<string, UsageCostRollup> {
  const clauses: string[] = []
  const params: string[] = []
  for (const [field, operator, value] of [
    ['agent', '=', filter.agent],
    ['date', '>=', filter.from],
    ['date', '<=', filter.to],
  ]) {
    if (!value) continue
    clauses.push(`${field} ${operator} ?`)
    params.push(value)
  }
  if (filter.model) {
    const selection = modelSqlSelection('model', [filter.model])
    clauses.push(selection.sql)
    params.push(...selection.params)
  }
  const rows = openDatabase()
    .prepare(
      `SELECT agent, model, cost_revision, cost_summary FROM usage_records
      ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}`,
    )
    .iterate(...params) as Iterable<CostRollupRow & { agent: string; model: string }>
  const grouped = new Map<string, UsageCostRollup[]>()
  for (const row of rows) {
    const rollup = parseCostRollup(row)
    if (!rollup) continue
    const key = JSON.stringify([row.agent, row.model])
    const values = grouped.get(key) ?? []
    values.push(rollup)
    grouped.set(key, values)
  }
  return new Map(
    [...grouped].map(([key, values]) => [key, combineCostRollups(values, PRICE_CATALOG_VERSION)]),
  )
}

export async function readWithUsageCosts<T>(read: () => T): Promise<T> {
  const db = openDatabase()
  const snapshot = db.transaction(() => {
    for (const table of ['usage_sessions', 'usage_records']) {
      if (
        db
          .prepare(
            `SELECT 1 FROM ${table} WHERE cost_revision IS NULL OR cost_revision != ? OR cost_summary IS NULL LIMIT 1`,
          )
          .get(PRICE_CATALOG_VERSION)
      )
        return undefined
    }
    return { value: read() }
  })
  while (db.open) {
    await refreshCostCache(db)
    if (!db.open) break
    const result = snapshot()
    if (result) return result.value
  }
  throw new Error('Usage database is closed')
}

export async function getUsageCostSummary(params?: {
  from?: string
  to?: string
  agent?: string
}): Promise<UsageCostSummary> {
  return readCostSummary(openDatabase(), params && typeof params === 'object' ? params : {})
}
