import builtinCatalog from './builtin-model-catalog.json' with { type: 'json' }
import type { CostCurrency, ModelVendor } from '../../shared/usage-cost'
import type { ModelCatalogPublication } from './model-catalog-document'
import { getActiveVendorRules } from './vendor-rules'
import { compileModelPatterns, uniquePatternMatch, type ModelPattern } from './model-patterns'

/** 内置计算结构版本；COM 价目表更新不提升此值，历史费用由用户手动全量扫描重算。 */
export const PRICE_CATALOG_VERSION = '2026-09-26.1'
/** 首次离线回退目录的参考日期。 */
export const PRICE_CHECKED_AT = '2026-09-26'

/** 每百万 Token 的标准 API 参考价；缺失单价与免费必须区分。 */
export interface TokenRates {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
  cacheWrite1h?: number
}

export interface PriceCard {
  id: string
  aliases?: string[]
  matchPatterns?: string[]
  vendor: ModelVendor
  currency: CostCurrency
  source?: string
  /** Reference scope and caveats; this never changes token accounting. */
  priceNote?: string
  rates: TokenRates[]
  tiers?: Array<{ fromInput: number; fromOutput?: number; rates: TokenRates[] }>
  periods?: PricePeriod[]
}

export interface PricePeriod {
  from: string
  source?: string
  rates: TokenRates
  peak?: {
    utcWeekdays: number[]
    utcHours: Array<[number, number]>
    rates: TokenRates
  }
}

// The offline snapshot uses exactly the same document as the COM publishing template.
const cards = new Map<string, PriceCard>()
for (const card of builtinCatalog.models as PriceCard[])
  for (const name of [card.id, ...(card.aliases ?? [])]) cards.set(name.toLowerCase(), card)

export const priceNamespaces: Record<string, ModelVendor> = builtinCatalog.namespaces

let activeCards: Map<string, PriceCard> | undefined
let activePatterns: ModelPattern[] | undefined
let builtInPatterns: ModelPattern[] | undefined
let activeCompactCards: Map<string, Set<PriceCard>> | undefined
let builtInCompactCards: Map<string, Set<PriceCard>> | undefined
let activeNamespaces: Record<string, ModelVendor> | undefined
let activePublishedAt: string | undefined
let catalogRevision = 0
let matcherRules: ReturnType<typeof getActiveVendorRules> | undefined
let numberedMatchers: Array<{ vendor: ModelVendor; family: string; pattern: RegExp }> = []
const inferredCards = new Map<string, PriceCard | undefined>()
let inferenceRules = getActiveVendorRules()

export function activatePriceCatalog(publication: ModelCatalogPublication): void {
  const patterns = compileModelPatterns(publication.catalog.models)
  const next = new Map<string, PriceCard>()
  for (const card of publication.catalog.models)
    for (const name of [card.id, ...(card.aliases ?? [])]) next.set(name.toLowerCase(), card)
  activeCards = next
  inferredCards.clear()
  activePatterns = patterns
  activeCompactCards = compactCards(next)
  activeNamespaces = publication.catalog.namespaces
  activePublishedAt = publication.publishedAt.slice(0, 10)
  catalogRevision++
}

export function useBuiltInPriceCatalog(): void {
  activeCards = undefined
  inferredCards.clear()
  activePatterns = undefined
  activeCompactCards = undefined
  activeNamespaces = undefined
  activePublishedAt = undefined
  catalogRevision++
}

export function priceCatalogRevision(): number {
  return catalogRevision
}

function compactKey(value: string): string {
  // Keep dots and digits: GLM-5.3 and a hypothetical GLM-53 must remain distinct.
  return value.replace(/[-_\s]+/g, '')
}

function compactCards(catalog: Map<string, PriceCard>): Map<string, Set<PriceCard>> {
  const result = new Map<string, Set<PriceCard>>()
  for (const [name, card] of catalog) {
    const key = compactKey(name)
    let matches = result.get(key)
    if (!matches) {
      matches = new Set()
      result.set(key, matches)
    }
    matches.add(card)
  }
  return result
}

function compactMatch(key: string, vendor?: ModelVendor): PriceCard | undefined {
  const index = activeCompactCards ?? (builtInCompactCards ??= compactCards(cards))
  const matches = [...(index.get(compactKey(key)) ?? [])].filter(
    (card) => !vendor || card.vendor === vendor,
  )
  return matches.length === 1 ? matches[0] : undefined
}

export function priceCatalogReferenceDate(): string {
  return activePublishedAt ?? PRICE_CHECKED_AT
}

function normalizedNumberedPrice(key: string, expectedVendor?: ModelVendor): PriceCard | undefined {
  const spelling = key.replace(/[\s_]+/g, '-')
  const matches = new Set<PriceCard>()
  for (const { vendor, family, pattern } of activeNumberedMatchers()) {
    if (expectedVendor && vendor !== expectedVendor) continue
    // Only a declared numbered family can convert gpt5-6 / gpt-5-6 to gpt-5.6.
    const match = pattern.exec(spelling)
    if (!match) continue
    const normalized = `${family}-${match[1]}.${match[2]}${match[3]}`
    const card = (activeCards ?? cards).get(normalized)
    if (card?.vendor === vendor) matches.add(card)
  }
  return matches.size === 1 ? [...matches][0] : undefined
}

function activeNumberedMatchers(): typeof numberedMatchers {
  const rules = getActiveVendorRules()
  if (rules !== matcherRules) {
    matcherRules = rules
    numberedMatchers = rules.flatMap((rule) =>
      (rule.numberedFamilies ?? []).map((family) => {
        const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return {
          vendor: rule.vendor,
          family,
          pattern: new RegExp(`^${escaped}-?(\\d+)[-.](\\d+)(.*)$`),
        }
      }),
    )
  }
  return numberedMatchers
}

export function findPriceCard(model: string): PriceCard | undefined {
  const key = model.trim().toLowerCase()
  if (key.length > 256) return undefined
  const catalog = activeCards ?? cards
  const direct = catalog.get(key)
  if (direct) return direct
  const rules = getActiveVendorRules()
  if (inferenceRules !== rules) {
    inferredCards.clear()
    inferenceRules = rules
  }
  if (inferredCards.has(key)) return inferredCards.get(key)
  const result = inferPriceCard(key)
  if (inferredCards.size >= 4096) inferredCards.delete(inferredCards.keys().next().value!)
  inferredCards.set(key, result)
  return result
}

function inferPriceCard(key: string): PriceCard | undefined {
  const catalog = activeCards ?? cards
  const namespaces = activeNamespaces ?? priceNamespaces
  const parts = key.split('/')
  const patterns = activePatterns ?? (builtInPatterns ??= compileModelPatterns(priceCatalogCards()))
  if (parts.length === 1)
    return compactMatch(key) ?? normalizedNumberedPrice(key) ?? uniquePatternMatch(key, patterns)
  if (parts.length !== 2) return undefined
  const vendor = namespaces[parts[0]]
  if (vendor) {
    const card =
      catalog.get(parts[1]) ??
      compactMatch(parts[1], vendor) ??
      normalizedNumberedPrice(parts[1], vendor)
    // A known namespace must never be used to disguise another vendor's exact model.
    if (card) return card.vendor === vendor ? card : undefined
    return uniquePatternMatch(parts[1], patterns, vendor)
  }
  // Unknown routing prefixes are accepted only by an explicitly published full-name pattern.
  return uniquePatternMatch(key, patterns)
}

/** Display and statistics identity; the scanner's original model name stays in SQLite. */
export function canonicalModelName(model: string): string {
  return findPriceCard(model)?.id ?? model
}

export function priceCatalogCards(): PriceCard[] {
  return [...new Set(cards.values())]
}
