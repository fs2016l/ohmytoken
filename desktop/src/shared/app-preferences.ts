import type { CostCurrency } from './usage-cost'

export type AppLanguage = 'zh' | 'en'

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'zh' || value === 'en'
}

export function defaultCostCurrency(language: AppLanguage): CostCurrency {
  return language === 'zh' ? 'CNY' : 'USD'
}
