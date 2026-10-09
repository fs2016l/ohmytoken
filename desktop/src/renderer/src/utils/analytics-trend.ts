import type { AnalyticsTrendPoint, AnalyticsTrendValue, UsageAnalytics } from '@shared/analytics'
import type { CostCurrency } from '@shared/usage-cost'
import type { ExchangeRateSnapshot } from '@shared/cost-currency'
import { validDate } from '@shared/calendar-date'
import { calendarDays, trendMetric } from './analytics-display'
import { matchPreset } from './date-range'
export { validDate } from '@shared/calendar-date'

export type AnalyticsMetric = 'tokens' | 'cost' | 'calls' | 'turns'
export type AnalyticsDimensionKey = 'total' | 'agents' | 'models'
export type AnalyticsGranularity = 'day' | 'week' | 'month'
export type ComparisonMode = 'none' | 'previous' | 'year' | 'custom'
export type ComparisonRange = { mode: ComparisonMode; from: string; to: string }
export function shiftDate(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}
/** Calendar comparisons keep matching dates; custom ranges keep their day offsets. */
export function comparisonDay(
  day: string,
  current: { from: string; to: string },
  comparison: { from: string; to: string },
  mode: ComparisonMode = 'custom',
): string | null {
  if (
    ![day, current.from, current.to, comparison.from, comparison.to].every(validDate) ||
    day < current.from ||
    day > current.to ||
    comparison.from > comparison.to
  )
    return null
  if (
    mode === 'previous' &&
    comparison.from === previousMonth(current.from) &&
    comparison.to === previousMonth(current.to)
  ) {
    const aligned = previousMonth(day)
    // A shorter month has no matching 29th/30th/31st; do not repeat its last day.
    return aligned.slice(-2) === day.slice(-2) &&
      aligned >= comparison.from &&
      aligned <= comparison.to
      ? aligned
      : null
  }
  const offset = (Date.parse(day) - Date.parse(current.from)) / 86400000
  const aligned = shiftDate(comparison.from, offset)
  return aligned <= comparison.to ? aligned : null
}
function previousYear(value: string): string {
  const date = new Date(`${value}T00:00:00Z`),
    month = date.getUTCMonth()
  date.setUTCFullYear(date.getUTCFullYear() - 1)
  if (date.getUTCMonth() !== month) date.setUTCDate(0)
  return date.toISOString().slice(0, 10)
}
function shiftMonth(value: string, offset: number): string {
  const date = new Date(`${value}T00:00:00Z`),
    month = (date.getUTCMonth() + offset + 12) % 12
  date.setUTCMonth(date.getUTCMonth() + offset)
  if (date.getUTCMonth() !== month) date.setUTCDate(0)
  return date.toISOString().slice(0, 10)
}
function previousMonth(value: string): string {
  return shiftMonth(value, -1)
}
export function comparisonDates(
  current: { from: string; to: string },
  comparison: ComparisonRange,
  now = new Date(),
): { from: string; to: string } | null {
  if (comparison.mode === 'none') return null
  if (comparison.mode === 'custom')
    return validDate(comparison.from) &&
      validDate(comparison.to) &&
      comparison.from <= comparison.to
      ? { from: comparison.from, to: comparison.to }
      : null
  if (!validDate(current.from) || !validDate(current.to) || current.from > current.to) return null
  if (comparison.mode === 'year')
    return { from: previousYear(current.from), to: previousYear(current.to) }
  const count = Math.round((Date.parse(current.to) - Date.parse(current.from)) / 86400000) + 1
  if (count === 1) return { from: shiftDate(current.from, -1), to: shiftDate(current.to, -1) }
  // Recognize the dates themselves so manual and calendar selections match shortcuts.
  const monthToDate = matchPreset(current.from, current.to, now) === 'month'
  if (!monthToDate && count <= 7)
    return { from: shiftDate(current.from, -7), to: shiftDate(current.to, -7) }
  // Inclusive calendar month: stop before the same date next month, or on its clamped month end.
  const nextMonth = shiftMonth(current.from, 1)
  const withinMonth =
    current.to < nextMonth ||
    (current.to === nextMonth && nextMonth.slice(-2) !== current.from.slice(-2))
  if (monthToDate || withinMonth)
    return { from: previousMonth(current.from), to: previousMonth(current.to) }
  return { from: shiftDate(current.from, -count), to: shiftDate(current.from, -1) }
}
export function mergeTrendValues(values: AnalyticsTrendValue[]): AnalyticsTrendValue {
  const result: AnalyticsTrendValue = {
    tokens: 0,
    calls: 0,
    callsComplete: true,
    turns: 0,
    turnsComplete: true,
    costs: [],
    costPartial: false,
  }
  for (const value of values) {
    result.tokens += value.tokens
    result.calls += value.calls
    result.turns += value.turns
    result.callsComplete &&= value.callsComplete
    result.turnsComplete &&= value.turnsComplete
    result.costPartial ||= value.costPartial
    if (!value.costs) result.costs = null
    else if (result.costs)
      for (const total of value.costs) {
        let entry = result.costs.find((item) => item.currency === total.currency)
        if (!entry) {
          entry = { currency: total.currency, min: 0, max: 0 }
          result.costs.push(entry)
        }
        entry.min += total.min
        entry.max += total.max
      }
  }
  return result
}
export function trendPoints(
  data: UsageAnalytics,
  granularity: AnalyticsGranularity,
  dailyOnly = false,
): AnalyticsTrendPoint[] {
  if (granularity === 'day' && !dailyOnly && data.from === data.to && data.hourlyComplete) {
    const byHour = new Map(data.hours.map((point) => [point.key, point]))
    return Array.from({ length: 24 }, (_, hour) => {
      const key = `${data.from}T${String(hour).padStart(2, '0')}`
      return (
        byHour.get(key) || {
          key,
          total: mergeTrendValues([]),
          agents: {},
          models: {},
          projects: {},
        }
      )
    })
  }
  const byDate = new Map(data.days.map((point) => [point.key, point]))
  const groups = new Map<string, AnalyticsTrendPoint[]>()
  for (const date of calendarDays(data.from, data.to)) {
    const key =
      granularity === 'month'
        ? date.slice(0, 7)
        : granularity === 'week'
          ? shiftDate(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7))
          : date
    const values = groups.get(key) || []
    const point = byDate.get(date)
    if (point) values.push(point)
    groups.set(key, values)
  }
  return [...groups].map(([key, values]) => {
    const dimensions = (
      dimension: 'agents' | 'models' | 'projects',
    ): Record<string, AnalyticsTrendValue> =>
      Object.fromEntries(
        [...new Set(values.flatMap((value) => Object.keys(value[dimension] ?? {})))].map((id) => [
          id,
          mergeTrendValues(
            values.flatMap((value) => (value[dimension]?.[id] ? [value[dimension][id]] : [])),
          ),
        ]),
      )
    return {
      key,
      total: mergeTrendValues(values.map((value) => value.total)),
      agents: dimensions('agents'),
      models: dimensions('models'),
      projects: dimensions('projects'),
    }
  })
}
export function trendSeriesValues(
  points: AnalyticsTrendPoint[],
  dimension: AnalyticsDimensionKey,
  id: string,
  named: string[],
  metric: AnalyticsMetric,
  currency: CostCurrency,
  snapshot: ExchangeRateSnapshot | null,
): Array<number | null> {
  return points.map((point) => {
    const value =
      id === 'total' || dimension === 'total'
        ? point.total
        : id === 'other'
          ? mergeTrendValues(
              Object.entries(point[dimension])
                .filter(([key]) => !named.includes(key))
                .map(([, value]) => value),
            )
          : point[dimension][id.slice(6)]
    return trendMetric(value, metric, currency, snapshot)
  })
}
