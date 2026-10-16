import type { TokenPlanWindowUsage } from '../../shared/token-plan'
import { balanceValue, object, type DiscoveredConnection, type JsonObject } from './types'

type Balance = Pick<TokenPlanWindowUsage, 'id' | 'label' | 'remaining' | 'unit' | 'details'> & {
  used?: number
}

function currency(value: unknown): 'CNY' | 'USD' {
  if (value !== 'CNY' && value !== 'USD') throw new Error('invalid_response')
  return value
}

function amount(value: unknown): number {
  const result = typeof value === 'string' ? balanceValue(value) : null
  if (result === null) throw new Error('invalid_response')
  return result
}

function entries(value: unknown): JsonObject[] {
  if (!Array.isArray(value) || value.length > 150) throw new Error('invalid_response')
  return value.map(object)
}

/** API-key totals and Harness recharge/bonus wallets describe different budgets; never infer a percentage. */
export function deepSeekBalances(connection: DiscoveredConnection, body: JsonObject): Balance[] {
  if (connection.public.authType === 'api-key') {
    if (typeof body.is_available !== 'boolean' || body.error) throw new Error('invalid_response')
    const seen = new Set<string>()
    return entries(body.balance_infos).map((row) => {
      const unit = currency(row.currency)
      if (seen.has(unit)) throw new Error('invalid_response')
      seen.add(unit)
      const details = [
        ['topped_up_balance', 'Recharge balance'],
        ['granted_balance', 'Granted balance'],
      ].flatMap(([key, name]) => (row[key] === undefined ? [] : [{ name, used: amount(row[key]) }]))
      return {
        id: `deepseek:${unit}:balance`,
        label: 'Account balance',
        remaining: amount(row.total_balance),
        unit,
        details,
      }
    })
  }
  const data = object(body.data)
  if (body.code !== 0 || data.biz_code !== 0) throw new Error('invalid_response')
  const summary = object(data.biz_data)
  const wallets: Balance[] = [
    ['normal_wallets', 'Recharge balance'],
    ['bonus_wallets', 'Granted balance'],
  ].flatMap(([key, label]) => {
    const seen = new Set<string>()
    return entries(summary[key]).map((row) => {
      const unit = currency(row.currency)
      if (seen.has(unit)) throw new Error('invalid_response')
      seen.add(unit)
      return {
        id: `deepseek:${unit}:${key}`,
        label,
        remaining: amount(row.balance),
        unit,
        details: [],
      }
    })
  })
  if (!wallets.length) throw new Error('invalid_response')
  const seen = new Set<string>()
  const costs: Balance[] =
    summary.total_costs === undefined
      ? []
      : entries(summary.total_costs).map((row) => {
          const unit = currency(row.currency)
          const used = amount(row.amount)
          if (seen.has(unit) || used < 0) throw new Error('invalid_response')
          seen.add(unit)
          return {
            id: `deepseek:${unit}:total-costs`,
            label: 'Total spending',
            used,
            remaining: null,
            unit,
            details: [],
          }
        })
  return [...wallets, ...costs]
}
