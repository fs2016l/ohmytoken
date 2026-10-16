import type { TokenPlanWindowUsage } from '@shared/token-plan'

export interface DeepSeekAmounts {
  currency: 'CNY' | 'USD'
  recharge: number | null
  granted: number | null
  total: number | null
  spent: number | null
}

/** Wallets and cumulative spending share a currency, but never form a quota percentage. */
export function deepSeekAmounts(windows: TokenPlanWindowUsage[]): DeepSeekAmounts[] {
  const groups = new Map<DeepSeekAmounts['currency'], DeepSeekAmounts>()
  for (const row of windows) {
    if (row.kind !== 'balance' || (row.unit !== 'CNY' && row.unit !== 'USD')) continue
    if (!row.available) continue
    const values = groups.get(row.unit) ?? {
      currency: row.unit,
      recharge: null,
      granted: null,
      total: null,
      spent: null,
    }
    if (row.label === 'Recharge balance') values.recharge = row.remaining
    if (row.label === 'Granted balance') values.granted = row.remaining
    if (row.label === 'Total spending') values.spent = row.used
    if (row.label === 'Account balance') {
      values.total = row.remaining
      for (const detail of row.details) {
        if (detail.name === 'Recharge balance') values.recharge = detail.used
        if (detail.name === 'Granted balance') values.granted = detail.used
      }
    }
    groups.set(row.unit, values)
  }
  return [...groups.values()]
}

/** 每个币种的余额项：分项齐全时为充值与赠送，只有总额时为可用余额；累计消费另列。 */
export function deepSeekReadings(
  row: DeepSeekAmounts,
): Array<{ key: 'recharge' | 'granted' | 'total'; value: number | null }> {
  if (row.recharge === null && row.granted === null && row.total !== null)
    return [{ key: 'total', value: row.total }]
  return [
    { key: 'recharge', value: row.recharge },
    { key: 'granted', value: row.granted },
  ]
}

export function deepSeekMoney(value: number | null, currency: DeepSeekAmounts['currency']): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: value !== 0 && Math.abs(value) < 0.01 ? 8 : 2,
  }).format(value)
}
