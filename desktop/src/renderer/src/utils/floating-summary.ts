import type { UsageTrendStats } from '@shared/models'
import type { TokenPlanWindowUsage } from '@shared/token-plan'
import { quotaRemainingPercent } from './quota-display'

/** Show the most constrained model window, with its own period label beside it. */
export function compactQuotaWindow(windows: TokenPlanWindowUsage[]): TokenPlanWindowUsage | null {
  const model = windows.filter((row) => row.kind === 'model')
  const candidates = model.length ? model : windows
  return (
    [...candidates].sort((a, b) => {
      const left = quotaRemainingPercent(a)
      const right = quotaRemainingPercent(b)
      return (left ?? Infinity) - (right ?? Infinity)
    })[0] ?? null
  )
}

/** Time-based bins retain idle gaps and bound rendering work even for second-level histories. */
export function compactTokenLine(stats: UsageTrendStats): string {
  const bins = Array<number>(40).fill(0)
  const span = Math.max(1, stats.to - stats.from)
  for (const point of stats.points) {
    if (point.timestamp < stats.from || point.timestamp > stats.to) continue
    const index = Math.min(39, Math.floor(((point.timestamp - stats.from) / span) * 40))
    bins[index] += Math.max(0, point.totalTokens)
  }
  const maximum = Math.max(1, ...bins)
  return bins
    .map(
      (value, index) =>
        `${index ? 'L' : 'M'}${((index / 39) * 160).toFixed(1)},${(46 - (value / maximum) * 42).toFixed(1)}`,
    )
    .join(' ')
}
