import type { MinuteUsagePoint } from '@shared/models'

export function visibleUsagePoints(
  points: readonly MinuteUsagePoint[],
  range: { from: number; to: number; visibleFrom: number; visibleTo: number; bucketMs: number },
): MinuteUsagePoint[] {
  const bucketMs = Math.max(1000, Math.round(range.bucketMs))
  const buckets = new Map<number, MinuteUsagePoint>()
  for (const point of points) {
    if (
      point.timestamp < range.visibleFrom - bucketMs ||
      point.timestamp > range.visibleTo + bucketMs
    )
      continue
    const start = Math.max(range.from, Math.floor(point.timestamp / bucketMs) * bucketMs)
    const row = buckets.get(start) ?? { timestamp: start, dimensionTokens: {}, totalTokens: 0 }
    row.totalTokens += point.totalTokens
    for (const [dimension, tokens] of Object.entries(point.dimensionTokens))
      row.dimensionTokens[dimension] = (row.dimensionTokens[dimension] ?? 0) + tokens
    buckets.set(start, row)
  }
  const empty = (timestamp: number): void => {
    if (!buckets.has(timestamp))
      buckets.set(timestamp, { timestamp, dimensionTokens: {}, totalTokens: 0 })
  }
  // 只补有用量区间两侧的零值，长时间空闲不会生成几十万个图表点。
  for (const start of [...buckets.keys()]) {
    if (start - bucketMs >= range.visibleFrom) empty(start - bucketMs)
    if (start + bucketMs <= range.visibleTo) empty(start + bucketMs)
  }
  empty(range.from)
  empty(range.to)
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp)
}
