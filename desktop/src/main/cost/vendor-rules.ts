import builtinCatalog from './builtin-model-catalog.json' with { type: 'json' }
import type { ModelVendor } from '../../shared/usage-cost'

export interface VendorRule {
  vendor: Exclude<ModelVendor, 'unknown'>
  families?: string[]
  numberedFamilies?: string[]
  exact?: string[]
  /** COM brand grouping only; deliberately excluded from vendor/price attribution. */
  brandMatchPatterns?: string[]
}

export const VENDOR_RULES_VERSION = '2026-09-26.1'

/** 家族规则只确定名称归属；价格仍由单独的型号及明确别名匹配。 */
export const vendorRules: VendorRule[] = builtinCatalog.vendors

let activeRules: readonly VendorRule[] | undefined

export function activateVendorRules(rules: readonly VendorRule[]): void {
  activeRules = rules
}

export function getActiveVendorRules(): readonly VendorRule[] {
  return activeRules ?? vendorRules
}

export function modelNameVendor(
  model: string,
  rules: readonly VendorRule[] = getActiveVendorRules(),
): ModelVendor {
  if (model.length > 256) return 'unknown'
  const key = (model.trim().toLowerCase().split('/').at(-1) ?? '').replace(/[\s_]+/g, '-')
  const matches = new Set<ModelVendor>()
  for (const rule of rules) {
    const numbered = (family: string): boolean => {
      if (!key.startsWith(family)) return false
      const suffix = key.slice(family.length).replace(/^-/, '')
      return /^\d/.test(suffix)
    }
    if (
      rule.exact?.includes(key) ||
      rule.numberedFamilies?.some(numbered) ||
      rule.families?.some(
        (family) => key === family || key.startsWith(`${family}-`) || numbered(family),
      )
    )
      matches.add(rule.vendor)
  }
  return matches.size === 1 ? [...matches][0] : 'unknown'
}
