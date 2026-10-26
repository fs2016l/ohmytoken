import type { UsageTrendStats } from '@shared/models'

export interface TokenSparklineInsets {
  left: number
  right: number
  top: number
  bottom: number
}
export const tokenSparklineInset: TokenSparklineInsets = { left: 5, right: 12, top: 6, bottom: 4 }
export const tokenSparklinePalette = {
  light: { start: '#8f6bf0', end: '#43a4e8', core: '#f4edff' },
  dark: { start: '#b697ff', end: '#72ceff', core: '#fff5ff' },
} as const

/** Both floating views share fixed time buckets, including idle gaps. */
export function tokenSparklineBins(stats: UsageTrendStats): number[] {
  const bins = Array<number>(40).fill(0)
  const span = Math.max(1, stats.to - stats.from)
  for (const point of stats.points) {
    if (
      !Number.isFinite(point.timestamp) ||
      !Number.isFinite(point.totalTokens) ||
      point.timestamp < stats.from ||
      point.timestamp > stats.to
    )
      continue
    const index = Math.min(39, Math.floor(((point.timestamp - stats.from) / span) * 40))
    bins[index] += Math.max(0, point.totalTokens)
  }
  return bins
}

export function tokenSparklineMaximum(values: readonly number[]): number {
  return Math.max(1, ...values) * 1.18
}

/** Position samples like the compact curve; retain real bucket boundaries for hover readouts. */
export function tokenSparklineSamples(stats: UsageTrendStats) {
  const bins = tokenSparklineBins(stats)
  const span = Math.max(0, stats.to - stats.from)
  return bins.map((value, index) => ({
    value,
    position: stats.from + (span * index) / (bins.length - 1),
    from: stats.from + (span * index) / bins.length,
    to: stats.from + (span * (index + 1)) / bins.length,
  }))
}

export function tokenSparklineGeometry(
  values: readonly number[],
  width: number,
  height: number,
  insets: TokenSparklineInsets = tokenSparklineInset,
) {
  const maximum = tokenSparklineMaximum(values)
  const left = insets.left
  const right = Math.max(left + 1, width - insets.right)
  const bottom = height - insets.bottom
  const points = values.map((value, index) => [
    left + (index * (right - left)) / Math.max(1, values.length - 1),
    bottom - (Math.max(0, value) / maximum) * (bottom - insets.top),
  ])
  const slopes = points.slice(1).map((point, index) => {
    const previous = points[index]!
    return (point[1]! - previous[1]!) / (point[0]! - previous[0]!)
  })
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0] ?? 0
    if (index === points.length - 1) return slopes.at(-1) ?? 0
    const a = slopes[index - 1]!
    const b = slopes[index]!
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b)
  })
  const number = (value: number): string => value.toFixed(2)
  let line = points.length ? `M${points[0]!.map(number).join(',')}` : ''
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!
    const b = points[index]!
    const dx = (b[0]! - a[0]!) / 3
    line += ` C${number(a[0]! + dx)},${number(a[1]! + tangents[index - 1]! * dx)} ${number(b[0]! - dx)},${number(b[1]! - tangents[index]! * dx)} ${number(b[0]!)},${number(b[1]!)}`
  }
  return {
    line,
    area: line ? `${line} L${number(right)},${height} L${left},${height} Z` : '',
    last: points.at(-1) ?? [right, bottom],
  }
}
