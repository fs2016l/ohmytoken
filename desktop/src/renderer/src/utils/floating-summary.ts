import type { UsageTrendStats } from '@shared/models'
import type { TokenPlanProviderId, TokenPlanWindowUsage } from '@shared/token-plan'
import { groupQuotaWindows } from './quota-window-display'

/** 收起状态显示展开列表中排在最前面的额度：主额度里周期最短的窗口。 */
export function compactQuotaWindow(
  windows: TokenPlanWindowUsage[],
  providerId: TokenPlanProviderId,
): TokenPlanWindowUsage | null {
  const { groups } = groupQuotaWindows(windows, providerId, (en) => en)
  return groups[0]?.windows[0] ?? windows[0] ?? null
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
