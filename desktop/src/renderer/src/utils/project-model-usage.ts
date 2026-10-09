import type { AnalyticsModelUsage } from '@shared/analytics'
import type { CostCurrency } from '@shared/usage-cost'
import type { ExchangeRateSnapshot } from '@shared/cost-currency'
import { combineCostRollups } from '../../../shared/cost-rollup'
import { summaryMoney } from './analytics-display'

function combineModels(
  models: AnalyticsModelUsage[],
  id: string,
  name: string,
): AnalyticsModelUsage {
  const summaries = models.flatMap((model) => (model.costSummary ? [model.costSummary] : []))
  return {
    id,
    name,
    totalTokens: models.reduce((sum, model) => sum + model.totalTokens, 0),
    costSummary:
      summaries.length && summaries.length === models.length
        ? combineCostRollups(summaries, summaries[0].catalogVersion)
        : undefined,
  }
}

/** Combine the same model across every project included in Other / unassigned. */
export function mergeProjectModels(models: AnalyticsModelUsage[]): AnalyticsModelUsage[] {
  const groups = new Map<string, AnalyticsModelUsage[]>()
  for (const model of models) {
    const items = groups.get(model.id) || []
    items.push(model)
    groups.set(model.id, items)
  }
  return [...groups].map(([id, items]) => combineModels(items, id, items[0].name))
}

export function projectModelSlices(
  models: AnalyticsModelUsage[],
  metric: 'tokens' | 'cost',
  currency: CostCurrency,
  snapshot: ExchangeRateSnapshot | null,
) {
  const value = (model: AnalyticsModelUsage): number =>
    metric === 'tokens'
      ? model.totalTokens
      : (summaryMoney(model.costSummary, currency, snapshot)?.min ?? 0)
  const sorted = [...models].sort((a, b) => value(b) - value(a) || a.id.localeCompare(b.id))
  const result = sorted
    .slice(0, 10)
    .map((model) => ({ ...model, other: false, value: value(model) }))
  if (sorted.length > 10) {
    const remaining = sorted.slice(10)
    result.push({
      ...combineModels(remaining, '', ''),
      other: true,
      value: remaining.reduce((sum, model) => sum + value(model), 0),
    })
  }
  return result
}
