export interface NumberFormatOptions {
  compact?: boolean
  decimals?: number
  currency?: string
  percent?: boolean
}

const formatters = new Map<string, Intl.NumberFormat>()
export function formatNumber(
  value: number | null | undefined,
  options: NumberFormatOptions = {},
): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const decimals = Math.min(2, Math.max(0, options.decimals ?? 2))
  const key = `${options.currency || ''}:${decimals}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: 0,
      ...(options.currency
        ? {
            style: 'currency' as const,
            currency: options.currency,
            currencyDisplay: 'narrowSymbol' as const,
          }
        : {}),
    })
    formatters.set(key, formatter)
  }
  if (options.currency && value > 0 && value < 0.01)
    return `<${formatNumber(0.01, { ...options, decimals: 2 })}`
  let divisor = 1
  let suffix = ''
  if (options.compact) {
    const absolute = Math.abs(value)
    if (absolute >= 1e9) {
      divisor = 1e9
      suffix = 'B'
    } else if (absolute >= 1e6) {
      divisor = 1e6
      suffix = 'M'
    } else if (absolute >= 1e3) {
      divisor = 1e3
      suffix = 'K'
    }
    // Rounding 999.999K should promote to 1M rather than displaying 1,000K.
    if (Math.abs(value / divisor) >= 1000 - 0.5 * 10 ** -decimals && divisor < 1e9) {
      divisor *= 1000
      suffix = divisor === 1e9 ? 'B' : divisor === 1e6 ? 'M' : 'K'
    }
  }
  const rounded = Math.round((value / divisor) * 10 ** decimals) / 10 ** decimals
  return `${formatter.format(Object.is(rounded, -0) ? 0 : rounded)}${suffix}${options.percent ? '%' : ''}`
}

export function combinedCache(usage: {
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
}): number | null {
  if (usage.cacheReadTokens == null && usage.cacheWriteTokens == null) return null
  return (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}
