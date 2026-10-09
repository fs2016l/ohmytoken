import type { CostCurrency } from './usage-cost'

export const EXCHANGE_RATE_SOURCE = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

export interface ExchangeRateSnapshot {
  base: 'USD'
  rates: { USD: 1; CNY: number }
  asOf: string
  fetchedAt: string
  source: 'ECB' | 'manual'
  sourceUrl?: string | null
  revision: number
}

export interface ExchangeRateState {
  snapshot: ExchangeRateSnapshot | null
  refreshFailed: boolean
}

export interface MoneyRange {
  currency: CostCurrency
  min: number
  max: number
}

/** 全程保留精度，先折合 USD，再转换展示币种；仅在最终排版时取小数。 */
export function convertMoney(
  cost: MoneyRange,
  currency: CostCurrency,
  snapshot: ExchangeRateSnapshot | null,
): MoneyRange | null {
  if (
    !Number.isFinite(cost.min) ||
    !Number.isFinite(cost.max) ||
    cost.min < 0 ||
    cost.max < cost.min
  )
    return null
  if (cost.currency === currency) return { ...cost }
  const rate = snapshot?.rates.CNY
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null
  const divisor = cost.currency === 'USD' ? 1 : rate
  const multiplier = currency === 'USD' ? 1 : rate
  const result = {
    currency,
    min: (cost.min / divisor) * multiplier,
    max: (cost.max / divisor) * multiplier,
  }
  return Number.isFinite(result.min) && Number.isFinite(result.max) ? result : null
}

export function sumMoneyInUsd(
  costs: readonly MoneyRange[],
  snapshot: ExchangeRateSnapshot | null,
): MoneyRange | null {
  const total: MoneyRange = { currency: 'USD', min: 0, max: 0 }
  for (const cost of costs) {
    const usd = convertMoney(cost, 'USD', snapshot)
    if (!usd) return null
    total.min += usd.min
    total.max += usd.max
  }
  return Number.isFinite(total.min) && Number.isFinite(total.max) ? total : null
}
