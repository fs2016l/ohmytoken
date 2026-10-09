import type { PriceCard, TokenRates } from './price-catalog'
import type { VendorRule } from './vendor-rules'
import type { ModelVendor } from '../../shared/usage-cost'
import { compileModelPatterns } from './model-patterns'
import { compileBrandPatterns } from '../../shared/model-brand-patterns'

export interface ModelCatalogDocument {
  schemaVersion: 1 | 2 | 3
  vendors: VendorRule[]
  namespaces: Record<string, ModelVendor>
  models: PriceCard[]
}

export interface ModelCatalogPublication {
  version: number
  publishedAt: string
  catalog: ModelCatalogDocument
}

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置对象不合法')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some((key) => !fields.includes(key))) throw new Error('配置包含未知字段')
  return result
}

function rows(value: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new Error('配置数组长度不合法')
  return value
}

function name(value: unknown, max = 256): string {
  if (typeof value !== 'string' || value.length > max || !/^[a-z0-9][a-z0-9._/-]*$/i.test(value))
    throw new Error('模型或规则名称不合法')
  return value.toLowerCase()
}

function modelName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256 || !/^[a-z0-9][a-z0-9._/-]*$/i.test(value))
    throw new Error('模型名称不合法')
  return value
}

function names(value: unknown, max = 200): string[] {
  return rows(value, 0, max).map((item) => name(item))
}

function number(value: unknown, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9)
    throw new Error('单价或阈值不合法')
  if (integer && !Number.isSafeInteger(value)) throw new Error('阈值必须是整数')
  return value
}

function rates(value: unknown): TokenRates {
  const row = record(value, ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h'])
  const parsed: TokenRates = { input: number(row.input), output: number(row.output) }
  for (const key of ['cacheRead', 'cacheWrite', 'cacheWrite1h'] as const)
    if (row[key] !== undefined) parsed[key] = number(row[key])
  return parsed
}

function source(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 2048) throw new Error('参考链接不合法')
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname
  )
    throw new Error('参考链接必须是 HTTPS URL')
  return value
}

function priceCard(value: unknown, vendors: Set<string>): PriceCard {
  const row = record(value, [
    'id',
    'aliases',
    'matchPatterns',
    'vendor',
    'currency',
    'source',
    'priceNote',
    'rates',
    'tiers',
    'periods',
  ])
  const vendor = name(row.vendor, 32)
  if (!vendors.has(vendor)) throw new Error('模型厂商不存在')
  if (row.currency !== 'USD' && row.currency !== 'CNY') throw new Error('币种不合法')
  const card: PriceCard = {
    id: modelName(row.id),
    vendor,
    currency: row.currency,
    rates: rows(row.rates, 0, 10).map(rates),
  }
  if (row.aliases !== undefined) card.aliases = names(row.aliases)
  if (row.matchPatterns !== undefined)
    card.matchPatterns = rows(row.matchPatterns, 0, 8).map((value) => {
      if (typeof value !== 'string') throw new Error('模型正则必须是字符串')
      return value
    })
  if (row.source !== undefined) card.source = source(row.source)
  if (row.priceNote !== undefined) {
    if (typeof row.priceNote !== 'string' || !row.priceNote.trim() || row.priceNote.length > 1000)
      throw new Error('价格说明长度不合法')
    card.priceNote = row.priceNote
  }
  if (row.tiers !== undefined)
    card.tiers = rows(row.tiers, 0, 50).map((value) => {
      const tier = record(value, ['fromInput', 'fromOutput', 'rates'])
      return {
        fromInput: number(tier.fromInput, true),
        ...(tier.fromOutput === undefined ? {} : { fromOutput: number(tier.fromOutput, true) }),
        rates: rows(tier.rates, 1, 10).map(rates),
      }
    })
  if (row.periods !== undefined) {
    let previous = -Infinity
    card.periods = rows(row.periods, 1, 100).map((value) => {
      const period = record(value, ['from', 'source', 'rates', 'peak'])
      if (typeof period.from !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(period.from))
        throw new Error('价格时段时间不合法')
      const time = Date.parse(period.from)
      if (!Number.isFinite(time) || time <= previous) throw new Error('价格时段顺序不合法')
      previous = time
      // Build optional peak rates without accepting arbitrary fields.
      let peakValue: NonNullable<NonNullable<PriceCard['periods']>[number]['peak']> | undefined
      if (period.peak !== undefined) {
        const candidate = record(period.peak, ['utcWeekdays', 'utcHours', 'rates'])
        const utcWeekdays = rows(candidate.utcWeekdays, 1, 7).map((day) => {
          const n = number(day, true)
          if (n > 6) throw new Error('星期不合法')
          return n
        })
        const utcHours = rows(candidate.utcHours, 1, 24).map((range): [number, number] => {
          const pair = rows(range, 2, 2)
          const from = number(pair[0]),
            to = number(pair[1])
          if (to > 24 || from >= to) throw new Error('高峰时段不合法')
          return [from, to]
        })
        peakValue = { utcWeekdays, utcHours, rates: rates(candidate.rates) }
      }
      return {
        from: period.from,
        rates: rates(period.rates),
        ...(period.source === undefined ? {} : { source: source(period.source) }),
        ...(peakValue ? { peak: peakValue } : {}),
      }
    })
  }
  return card
}

export function parseModelCatalogPublication(value: unknown): ModelCatalogPublication {
  const publication = record(value, ['version', 'publishedAt', 'catalog'])
  if (
    typeof publication.version !== 'number' ||
    !Number.isSafeInteger(publication.version) ||
    publication.version < 1
  )
    throw new Error('配置版本不合法')
  if (
    typeof publication.publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(publication.publishedAt))
  )
    throw new Error('发布日期不合法')
  const root = record(publication.catalog, ['schemaVersion', 'vendors', 'namespaces', 'models'])
  if (root.schemaVersion !== 1 && root.schemaVersion !== 2 && root.schemaVersion !== 3)
    throw new Error('不支持的配置格式')
  const vendors = rows(root.vendors, 1, 100).map((value): VendorRule => {
    const row = record(value, [
      'vendor',
      'families',
      'numberedFamilies',
      'exact',
      'brandMatchPatterns',
    ])
    if (row.brandMatchPatterns !== undefined && root.schemaVersion !== 3)
      throw new Error('品牌正则需要 schemaVersion 3')
    return {
      vendor: name(row.vendor, 32),
      ...(row.families === undefined ? {} : { families: names(row.families) }),
      ...(row.numberedFamilies === undefined
        ? {}
        : { numberedFamilies: names(row.numberedFamilies) }),
      ...(row.exact === undefined ? {} : { exact: names(row.exact) }),
      ...(row.brandMatchPatterns === undefined
        ? {}
        : { brandMatchPatterns: rows(row.brandMatchPatterns, 0, 8) as string[] }),
    }
  })
  compileBrandPatterns(vendors.map((rule) => ({ matchPatterns: rule.brandMatchPatterns })))
  const vendorSet = new Set(vendors.map((rule) => rule.vendor))
  if (vendors.some((rule) => !/^[a-z][a-z0-9-]*$/.test(rule.vendor)))
    throw new Error('厂商标识不合法')
  if (vendorSet.size !== vendors.length) throw new Error('厂商标识重复')
  if (!root.namespaces || typeof root.namespaces !== 'object' || Array.isArray(root.namespaces))
    throw new Error('命名空间配置不合法')
  const rawNamespaces = root.namespaces as Record<string, unknown>
  if (Object.keys(rawNamespaces).length > 200) throw new Error('命名空间过多')
  const namespaces: Record<string, ModelVendor> = {}
  for (const [key, value] of Object.entries(rawNamespaces)) {
    const namespace = name(key, 32)
    if (!/^[a-z][a-z0-9-]*$/.test(namespace)) throw new Error('命名空间不合法')
    const vendor = name(value, 32)
    if (!vendorSet.has(vendor)) throw new Error('命名空间厂商不存在')
    namespaces[namespace] = vendor
  }
  const models = rows(root.models, 1, 2000).map((item) => priceCard(item, vendorSet))
  if (
    root.schemaVersion === 1 &&
    models.some((model) => model.matchPatterns !== undefined || model.priceNote !== undefined)
  )
    throw new Error('正则匹配及价格说明需要 schemaVersion 2')
  compileModelPatterns(models)
  const modelNames = new Set<string>()
  for (const model of models)
    for (const modelName of [model.id, ...(model.aliases ?? [])]) {
      const key = modelName.toLowerCase()
      if (modelNames.has(key)) throw new Error('模型名称或别名重复')
      modelNames.add(key)
    }
  return {
    version: publication.version as number,
    publishedAt: publication.publishedAt,
    catalog: { schemaVersion: root.schemaVersion, vendors, namespaces, models },
  }
}
