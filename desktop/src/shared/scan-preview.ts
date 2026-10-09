import type {
  Comparisons,
  DailyStats,
  HourlyUsageStats,
  ModelStats,
  MonthlyStats,
  Overview,
  TokenUsageRecord,
} from './models'
import type { ScanPreview } from './scan-progress'

const FIRST_DATE = '2020-01-01'
const LAST_DATE = '2099-12-31'

function dateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function summarizeOverview(records: TokenUsageRecord[], now = new Date()): Overview {
  const result: Overview = {
    grandTotal: 0,
    agentTotals: {},
    modelTotals: {},
    totalRecords: records.length,
    todayUsage: 0,
    weekUsage: 0,
    monthUsage: 0,
  }
  const today = dateString(now)
  const monday = new Date(now)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const weekStart = dateString(monday)
  const monthStart = today.slice(0, 7) + '-01'
  for (const row of records) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue
    result.grandTotal += row.totalTokens
    result.agentTotals[row.agent] = (result.agentTotals[row.agent] || 0) + row.totalTokens
    result.modelTotals[row.model] = (result.modelTotals[row.model] || 0) + row.totalTokens
    if (row.date === today) result.todayUsage += row.totalTokens
    if (row.date >= weekStart && row.date <= today) result.weekUsage += row.totalTokens
    if (row.date >= monthStart && row.date <= today) result.monthUsage += row.totalTokens
    if (!result.dateFrom || row.date < result.dateFrom) result.dateFrom = row.date
    if (!result.dateTo || row.date > result.dateTo) result.dateTo = row.date
  }
  return result
}

export function summarizeDaily(
  records: TokenUsageRecord[],
  groupBy: 'agent' | 'model',
): DailyStats[] {
  const days = new Map<string, DailyStats>()
  for (const row of records) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue
    let day = days.get(row.date)
    if (!day) {
      day = { date: row.date, totalTokens: 0, agentTokens: {} }
      days.set(row.date, day)
    }
    day.totalTokens += row.totalTokens
    day.agentTokens[row[groupBy]] = (day.agentTokens[row[groupBy]] || 0) + row.totalTokens
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function summarizeModels(
  records: Pick<
    TokenUsageRecord,
    'agent' | 'model' | 'totalTokens' | 'inputTokens' | 'outputTokens'
  >[],
): ModelStats[] {
  const models = new Map<string, ModelStats>()
  for (const row of records) {
    let model = models.get(row.model)
    if (!model) {
      model = { model: row.model, agentTokens: {}, totalTokens: 0, inputTokens: 0, outputTokens: 0 }
      models.set(row.model, model)
    }
    model.totalTokens += row.totalTokens
    model.inputTokens += row.inputTokens
    model.outputTokens += row.outputTokens
    model.agentTokens[row.agent] = (model.agentTokens[row.agent] || 0) + row.totalTokens
  }
  return [...models.keys()].sort().map((key) => models.get(key)!)
}

export function summarizeMonths(
  records: TokenUsageRecord[],
  from: string,
  to: string,
): MonthlyStats[] {
  return summarizeDaily(
    records
      .filter(
        (row) =>
          /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
          row.date.slice(0, 7) >= from &&
          row.date.slice(0, 7) <= to,
      )
      .map((row) => ({ ...row, date: row.date.slice(0, 7) + '-01' })),
    'agent',
  ).map(({ date, ...row }) => ({ ...row, month: date.slice(0, 7) }))
}

export function summarizeComparisons(records: TokenUsageRecord[], now = new Date()): Comparisons {
  const date = (offset: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + offset)
    return dateString(d)
  }
  const sum = (from: string, to = from) =>
    records.reduce(
      (total, row) =>
        total +
        (/^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.date >= from && row.date <= to
          ? row.totalTokens
          : 0),
      0,
    )
  const pair = (currentTokens: number, previousTokens: number) => ({
    currentTokens,
    previousTokens,
    change: previousTokens
      ? Math.round(((currentTokens - previousTokens) * 1000) / previousTokens) / 10
      : 0,
  })
  const weekday = (now.getDay() + 6) % 7
  const today = date(0)
  const lastEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  const lastStart = dateString(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const lastSame = dateString(
    new Date(lastEnd.getFullYear(), lastEnd.getMonth(), Math.min(now.getDate(), lastEnd.getDate())),
  )
  const week = sum(date(-weekday), today)
  const month = sum(today.slice(0, 7) + '-01', today)
  return {
    todayVsYesterday: pair(sum(today), sum(date(-1))),
    weekVsLastWeek: pair(week, sum(date(-weekday - 7), date(-weekday - 1))),
    weekVsLastWeekSamePeriod: pair(week, sum(date(-weekday - 7), date(-7))),
    monthVsLastMonth: pair(month, sum(lastStart, dateString(lastEnd))),
    monthVsLastMonthSamePeriod: pair(month, sum(lastStart, lastSame)),
  }
}

export function buildScanPreviewDashboard(
  preview: ScanPreview,
  from = '',
  to = '',
  now = new Date(),
) {
  const all = preview.records.filter((row) => row.date >= FIRST_DATE && row.date <= LAST_DATE)
  const selected = all.filter(
    (row) => row.date >= (from || FIRST_DATE) && row.date <= (to || LAST_DATE),
  )
  const dailyStats = summarizeDaily(selected, 'agent')
  const days = dailyStats.filter((row) => row.totalTokens > 0)
  const hourDate = from && from === to ? from : days.length === 1 ? days[0].date : null
  const hourly = (groupBy: 'agent' | 'model'): HourlyUsageStats[] => {
    if (!hourDate) return []
    const buckets: HourlyUsageStats[] = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      agentTokens: {},
      totalTokens: 0,
    }))
    for (const row of preview.hourly) {
      if (row.date !== hourDate) continue
      const bucket = buckets[Math.max(0, Math.min(23, Math.trunc(row.hour) || 0))]
      bucket.totalTokens += row.totalTokens
      bucket.agentTokens[row[groupBy]] = (bucket.agentTokens[row[groupBy]] || 0) + row.totalTokens
    }
    return buckets
  }
  return {
    overview: summarizeOverview(selected, now),
    overviewFixed: summarizeOverview(all, now),
    dailyStats,
    dailyModelStats: summarizeDaily(selected, 'model'),
    modelStats: summarizeModels(selected),
    monthlyStats: summarizeMonths(
      all,
      (from || FIRST_DATE).slice(0, 7),
      (to || LAST_DATE).slice(0, 7),
    ),
    hourlyAgentStats: hourly('agent'),
    hourlyModelStats: hourly('model'),
    fixedDaily: summarizeDaily(all, 'agent'),
    comparisons: summarizeComparisons(all, now),
  }
}
