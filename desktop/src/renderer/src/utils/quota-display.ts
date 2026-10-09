import type { TokenPlanWindowUsage } from '@shared/token-plan'

export function quotaRemainingPercent(row: TokenPlanWindowUsage): number | null {
  if (!row.available || row.unlimited) return null
  const amount =
    row.remaining ??
    (row.limit !== null && row.used !== null ? Math.max(0, row.limit - row.used) : null)
  const value =
    amount !== null && row.limit !== null && row.limit > 0
      ? (amount / row.limit) * 100
      : row.remainingPercent
  return value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value))
}
