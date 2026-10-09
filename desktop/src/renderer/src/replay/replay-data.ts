import type { UsageAnalytics, AnalyticsTrendPoint, AnalyticsTrendValue } from '@shared/analytics'
import type { ExchangeRateSnapshot } from '@shared/cost-currency'
import type { ReplayOptions, ReplaySnapshot, ReplaySummary } from '@shared/replay'
import { validReplayOptions } from '@shared/replay'
import { agentColors, agentNames, modelPalette } from '../config/agents'
import { displayedMoney, summaryMoney, trendMetric } from '../utils/analytics-display'

const OTHER = '\u0000other'
const safeTokens = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0)
export function createReplaySnapshot(
  data: UsageAnalytics,
  options: ReplayOptions,
  exchange: ExchangeRateSnapshot | null = null,
): ReplaySnapshot {
  if (!validReplayOptions(options)) throw new Error('invalid-options')
  if (data.from !== options.from || data.to !== options.to) throw new Error('stale-data')
  const hourly = options.from === options.to && data.hourlyComplete
  const source = hourly ? data.hours : data.days
  const rows = new Map(source.map((point) => [point.key, point]))
  const measure = options.measure ?? 'tokens'
  const currency = options.currency ?? 'USD'
  const valueOf = (value?: AnalyticsTrendValue): number =>
    safeTokens(trendMetric(value, measure, currency, exchange) ?? 0)
  const notes = new Set<NonNullable<ReplaySnapshot['notes']>[number]>()
  const totals = new Map<string, number>()
  const keys: string[] = []
  if (hourly) {
    for (let hour = 0; hour < 24; hour++)
      keys.push(`${options.from}T${String(hour).padStart(2, '0')}`)
  } else {
    for (let at = Date.parse(options.from); at <= Date.parse(options.to); at += 86400000)
      keys.push(new Date(at).toISOString().slice(0, 10))
  }
  for (const key of keys)
    for (const [id, value] of Object.entries(rows.get(key)?.[options.dimension] ?? {}))
      totals.set(id, (totals.get(id) ?? 0) + valueOf(value))
  const ordered = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  // Bound drawing cost while keeping every token in an explicitly labelled remainder.
  const ids = ordered.slice(0, 63).map(([id]) => id)
  const selected = new Set(ids)
  if (ordered.length > ids.length) ids.push(OTHER)
  const values = (point?: AnalyticsTrendPoint): number[] =>
    ids.map((id) =>
      id === OTHER
        ? Object.entries(point?.[options.dimension] ?? {}).reduce(
            (sum, [key, value]) => sum + (selected.has(key) ? 0 : valueOf(value)),
            0,
          )
        : valueOf(point?.[options.dimension]?.[id]),
    )
  const points = keys.map((key) => {
    const row = rows.get(key)
    const cost = trendMetric(row?.total, 'cost', currency, exchange)
    return {
      key,
      values: values(row),
      summary: {
        tokens: safeTokens(row?.total.tokens ?? 0),
        cost,
        costMax:
          cost === null
            ? null
            : row
              ? (displayedMoney(row.total.costs, currency, exchange)?.max ?? null)
              : 0,
        turns: trendMetric(row?.total, 'turns', currency, exchange),
        calls: trendMetric(row?.total, 'calls', currency, exchange),
      },
    }
  })
  const totalValue = points.reduce((sum, point) => sum + point.values.reduce((a, b) => a + b, 0), 0)
  const totalTokens = keys.reduce(
    (sum, key) =>
      sum +
      Object.values(rows.get(key)?.[options.dimension] ?? {}).reduce(
        (total, value) => total + safeTokens(value.tokens),
        0,
      ),
    0,
  )
  // The token conservation check remains independent of the selected chart measure.
  if (
    !Number.isFinite(data.summary.totalTokens) ||
    data.summary.totalTokens < 0 ||
    Math.abs(totalTokens - data.summary.totalTokens) > Math.max(1e-6, totalTokens * 1e-12)
  )
    throw new Error('incomplete-data')
  const money = summaryMoney(data.summary.costSummary, currency, exchange)
  const summary = {
    tokens: totalTokens,
    cost: money?.min ?? null,
    costMax: money?.max ?? null,
    turns: data.summary.turns.count || (data.summary.turns.complete ? 0 : null),
    calls: data.summary.apiCallCount || (data.summary.apiCallCountComplete ? 0 : null),
  }
  let available =
    measure === 'tokens' || (measure === 'cost' ? summary.cost : summary[measure]) !== null
  for (const key of keys) {
    const row = rows.get(key)
    if (!row) continue
    for (const value of Object.values(row[options.dimension] ?? {})) {
      if (
        (measure === 'calls' && !value.callsComplete) ||
        (measure === 'turns' && !value.turnsComplete)
      )
        notes.add('partial')
      if (measure === 'cost') {
        const cost = displayedMoney(value.costs, currency, exchange)
        if (value.costPartial || !cost) notes.add('partial')
        if (cost && cost.max > cost.min + 1e-9) notes.add('range')
        // Missing exchange rates must never turn an unconvertible amount into zero.
        if (value.costs?.length && !cost) available = false
      }
    }
  }
  if (!available) notes.add('unavailable')
  if (options.template === 'summary') {
    const cost = data.summary.costSummary
    if (
      !data.summary.turns.complete ||
      !data.summary.apiCallCountComplete ||
      !money ||
      (cost && cost.pricedRecords < cost.totalRecords)
    )
      notes.add('partial')
    if (money && money.max > money.min + 1e-9) notes.add('range')
  }
  const projectNames = new Map(data.projects?.map((project) => [project.id, project.name]) ?? [])
  return {
    options: { ...options },
    capturedAt: Date.now(),
    granularity: hourly ? 'hour' : 'day',
    series: ids.map((id, index) => ({
      id,
      name:
        id === OTHER
          ? options.language === 'zh'
            ? '其他'
            : 'Other'
          : options.dimension === 'agents'
            ? agentNames[id] || id
            : options.dimension === 'projects'
              ? projectNames.get(id) ||
                id ||
                (options.language === 'zh' ? '未归属项目' : 'Unassigned project')
              : id,
      color:
        id === OTHER
          ? '#8593aa'
          : options.dimension === 'agents'
            ? agentColors[id] || modelPalette[index % modelPalette.length]
            : modelPalette[index % modelPalette.length],
    })),
    points,
    totalTokens,
    totalValue,
    available,
    notes: [...notes],
    summary,
  }
}

export interface ReplayTimeline {
  snapshot: ReplaySnapshot
  values: number[][]
  ranks: number[][]
  maximum: number
  summaries?: ReplaySummary[]
}
export function createReplayTimeline(snapshot: ReplaySnapshot): ReplayTimeline {
  const values = [snapshot.series.map(() => 0)]
  for (const point of snapshot.points)
    values.push(
      point.values.map(
        (value, i) => value + (snapshot.options.metric === 'cumulative' ? values.at(-1)![i] : 0),
      ),
    )
  const ranks = values.map((row) => {
    const result: number[] = []
    row
      .map((value, index) => ({ value, index }))
      .sort((a, b) => b.value - a.value || a.index - b.index)
      .forEach((entry, rank) => {
        result[entry.index] = rank
      })
    return result
  })
  let summaries: ReplaySummary[] | undefined
  if (snapshot.summary && snapshot.points.every((point) => point.summary)) {
    const overall = snapshot.summary
    summaries = [
      {
        tokens: 0,
        cost: overall.cost === null ? null : 0,
        costMax: overall.costMax === null ? null : 0,
        turns: overall.turns === null ? null : 0,
        calls: overall.calls === null ? null : 0,
      },
    ]
    for (const point of snapshot.points) {
      const current = point.summary!,
        previous = summaries.at(-1)!
      const amount = (key: Exclude<keyof ReplaySummary, 'tokens'>): number | null => {
        if (overall[key] === null) return null
        return snapshot.options.metric === 'cumulative'
          ? (previous[key] ?? 0) + (current[key] ?? 0)
          : current[key]
      }
      summaries.push({
        tokens: current.tokens + (snapshot.options.metric === 'cumulative' ? previous.tokens : 0),
        cost: amount('cost'),
        costMax: amount('costMax'),
        turns: amount('turns'),
        calls: amount('calls'),
      })
    }
  }
  return {
    snapshot,
    values,
    ranks,
    maximum: Math.max(1, ...values.map((row) => row.reduce((a, b) => a + b, 0))),
    summaries,
  }
}
export function replayPosition(seconds: number, duration: number): number {
  // Opening breath and a readable final hold, independent of the machine's render speed.
  return Math.max(0, Math.min(1, (seconds - 0.8) / (duration - 2.6)))
}
export function sampleReplay(timeline: ReplayTimeline, progress: number) {
  const position = Math.max(0, Math.min(1, progress)) * (timeline.values.length - 1)
  const before = Math.floor(position),
    after = Math.min(before + 1, timeline.values.length - 1)
  const mix = position - before
  const ease = mix * mix * (3 - 2 * mix)
  const values = timeline.values[before].map(
    (value, i) => value + (timeline.values[after][i] - value) * mix,
  )
  let summary: ReplaySummary | undefined
  if (timeline.summaries) {
    const a = timeline.summaries[before],
      b = timeline.summaries[after]
    const amount = (key: keyof ReplaySummary): number | null => {
      if (mix === 0) return a[key]
      if (mix === 1) return b[key]
      const from = a[key],
        to = b[key]
      return from === null || to === null ? null : from + (to - from) * mix
    }
    summary = {
      tokens: amount('tokens')!,
      cost: amount('cost'),
      costMax: amount('costMax'),
      turns: amount('turns'),
      calls: amount('calls'),
    }
  }
  return {
    values,
    total: values.reduce((a, b) => a + b, 0),
    position,
    summary,
    key:
      timeline.snapshot.points[
        Math.max(0, Math.min(Math.ceil(position) - 1, timeline.snapshot.points.length - 1))
      ]?.key ?? timeline.snapshot.options.from,
    ranks: timeline.ranks[before].map((rank, i) => rank + (timeline.ranks[after][i] - rank) * ease),
  }
}
