export type CostCurrency = 'USD' | 'CNY'
export type ModelVendor =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'alibaba'
  | 'zhipu'
  | 'deepseek'
  | 'minimax'
  | 'moonshot'
  | 'xiaomi'
  | 'xai'
  | 'bytedance'
  | 'tencent'
  | 'unknown'
  | (string & {})

/** 保存调用当时的模型、Token 分桶和计价依据。 */
export interface UsageEvidence {
  granularity?: 'request' | 'aggregate'
  modelSource?: 'response' | 'session' | 'current-config'
  /** 原始调用模型 ID；model 使用展示名称时，计价仍以此 ID 为准。 */
  modelId?: string
  /** 展示名是扫描时的本地配置快照，不作为历史模型版本或价格的依据。 */
  modelDisplayNameSource?: 'current-config'
  bucketQuality?: 'verified' | 'uncertain'
  cacheWrite5mTokens?: number
  cacheWrite1hTokens?: number
  reportedCost?: { amount: number; currency: CostCurrency }
}

export interface ModelAttribution {
  vendor: ModelVendor
  vendorBasis: 'catalog' | 'model-name' | 'unknown'
}

export type CostReason =
  | 'model-unpriced'
  | 'model-not-historical'
  | 'uncertain-buckets'
  | 'invalid-tokens'
  | 'missing-bucket-rate'
  | 'cache-duration'
  | 'request-size'
  | 'price-variants'
  | 'pricing-time-unknown'
  | 'historical-price-unavailable'

export interface UsageCostAssessment {
  identity: ModelAttribution
  status: 'estimated' | 'range' | 'unpriced'
  currency?: CostCurrency
  min?: number
  max?: number
  reason?: CostReason
  priceCard?: string
  source?: string
  pricingPeriod?: 'flat' | 'peak' | 'off-peak'
  pricingEffectiveFrom?: string
  reportedCost?: { amount: number; currency: CostCurrency }
}

export interface UsageCostGroup extends UsageCostAssessment {
  agent: string
  model: string
  records: number
  tokens: number
}

export interface UsageCostSummary {
  catalogVersion: string
  checkedAt: string
  totalRecords: number
  pricedRecords: number
  totalTokens: number
  pricedTokens: number
  vendorRecords: number
  legacyRecords: number
  recoveryPending: boolean
  totals: Array<{ currency: CostCurrency; min: number; max: number }>
  groups: UsageCostGroup[]
}

/** 原币费用汇总；显示币种和汇率不参与持久化。 */
export type UsageCostRollup = Omit<UsageCostSummary, 'checkedAt' | 'recoveryPending'>
