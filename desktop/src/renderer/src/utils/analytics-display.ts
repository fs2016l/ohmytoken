import type { UsageAnalytics, AnalyticsTrendValue, AnalyticsTrendPoint } from '@shared/analytics'
import type { UsageCostRollup, CostCurrency } from '@shared/usage-cost'
import type { ExchangeRateSnapshot, MoneyRange } from '@shared/cost-currency'
import { convertMoney } from '../../../shared/cost-currency'

export function calendarDays(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`),
    end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
  const count = Math.min(36600, Math.round((end - start) / 86400000) + 1)
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  )
}
export function displayedMoney(
  totals: UsageCostRollup['totals'] | null | undefined,
  currency: CostCurrency,
  snapshot: ExchangeRateSnapshot | null,
): MoneyRange | null {
  if (!totals) return null
  const result: MoneyRange = { currency, min: 0, max: 0 }
  for (const value of totals) {
    const converted = convertMoney(value, currency, snapshot)
    if (!converted) return null
    result.min += converted.min
    result.max += converted.max
  }
  return result
}
export function summaryMoney(
  summary: UsageCostRollup | undefined,
  currency: CostCurrency,
  snapshot: ExchangeRateSnapshot | null,
): MoneyRange | null {
  if (!summary || (summary.totalRecords > 0 && !summary.pricedRecords)) return null
  return displayedMoney(summary.totals, currency, snapshot)
}
export interface TokenBarPoint {
  key: string
  title: string
  value: number
  models: Array<{ id: string; name: string; value: number }>
  otherTokens: number
}

export function tokenBars(data: UsageAnalytics | null, model?: string): TokenBarPoint[] {
  if (!data) return []
  const names = new Map(data.models.map((item) => [item.id, item.name]))
  const buckets = new Map<string, { title: string; value: number; models: Map<string, number> }>()
  function add(key: string, title: string, point?: AnalyticsTrendPoint): void {
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { title, value: 0, models: new Map() }
      buckets.set(key, bucket)
    }
    if (!point) return
    bucket.value += model === undefined ? point.total.tokens : point.models[model]?.tokens || 0
    const models =
      model === undefined ? Object.entries(point.models) : [[model, point.models[model]] as const]
    for (const [id, usage] of models) {
      if (usage?.tokens > 0) bucket.models.set(id, (bucket.models.get(id) || 0) + usage.tokens)
    }
  }
  if (data.from === data.to && data.hours.length && data.hourlyComplete) {
    const hours = new Map(data.hours.map((hour) => [hour.key, hour]))
    for (let hour = 0; hour < 24; hour++) {
      const key = `${String(hour).padStart(2, '0')}:00`
      add(key, `${data.from} ${key}`, hours.get(`${data.from}T${key.slice(0, 2)}`))
    }
  } else {
    const values = new Map(data.days.map((day) => [day.key, day]))
    const days = calendarDays(data.from, data.to),
      byMonth = days.length > 62
    for (const day of days) {
      const key = byMonth ? day.slice(0, 7) : day
      add(key, key, values.get(day))
    }
  }
  return [...buckets].map(([key, bucket]) => {
    // Rank after combining the entire bucket, so monthly tooltips never lose smaller daily models.
    const models = [...bucket.models]
      .map(([id, value]) => ({ id, name: names.get(id) || id, value }))
      .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    return {
      key,
      title: bucket.title,
      value: bucket.value,
      models: models.slice(0, 10),
      otherTokens: models.slice(10).reduce((sum, item) => sum + item.value, 0),
    }
  })
}
export function trendMetric(
  value: AnalyticsTrendValue | undefined,
  metric: 'tokens' | 'cost' | 'calls' | 'turns',
  currency: CostCurrency,
  snapshot: ExchangeRateSnapshot | null,
): number | null {
  if (!value) return 0
  if (metric === 'tokens') return value.tokens
  if (metric === 'calls') return value.calls || (value.callsComplete ? 0 : null)
  if (metric === 'turns') return value.turns || (value.turnsComplete ? 0 : null)
  return value.costPartial && !value.costs?.length
    ? null
    : (displayedMoney(value.costs, currency, snapshot)?.min ?? null)
}
