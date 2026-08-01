/** 当前桌面端支持的套餐厂商。 */
export const TOKEN_PLAN_PROVIDER_IDS = ['minimax', 'zhipu'] as const

export type TokenPlanProviderId = (typeof TOKEN_PLAN_PROVIDER_IDS)[number]

export const TOKEN_PLAN_WINDOW_IDS = ['5h', '7d'] as const

export type TokenPlanWindowId = (typeof TOKEN_PLAN_WINDOW_IDS)[number]

export type TokenPlanUnavailableReason = 'not_returned_by_api'

export type TokenPlanErrorCode =
  | 'not_configured'
  | 'invalid_credential'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'network_error'

export interface TokenPlanCredentialInput {
  providerId: TokenPlanProviderId
  apiKey: string
}

export interface TokenPlanCredentialStatus {
  providerId: TokenPlanProviderId
  configured: boolean
  updatedAt: number | null
}

export interface TokenPlanWindowUsage {
  id: TokenPlanWindowId
  available: boolean
  /** 已用百分比，范围 0-100。厂商只返回剩余百分比时由主进程换算。 */
  usedPercent: number | null
  remainingPercent: number | null
  used: number | null
  limit: number | null
  remaining: number | null
  unit: 'requests' | 'tokens' | 'credits' | null
  startsAt: number | null
  resetsAt: number | null
  unavailableReason: TokenPlanUnavailableReason | null
}

export interface TokenPlanExtraQuotaDetail {
  name: string
  used: number
}

/** 不能混入模型窗口的额外额度，例如智谱每月 MCP 工具调用次数。 */
export interface TokenPlanExtraQuota {
  id: string
  label: string
  used: number
  limit: number
  remaining: number
  unit: 'requests'
  resetsAt: number | null
  details: TokenPlanExtraQuotaDetail[]
}

export interface TokenPlanUsageSnapshot {
  providerId: TokenPlanProviderId
  status: 'ok' | 'partial' | 'error'
  keyVerified: boolean
  queriedAt: number
  planName: string | null
  modelCount: number | null
  models: string[]
  windows: TokenPlanWindowUsage[]
  extraQuotas: TokenPlanExtraQuota[]
  errorCode: TokenPlanErrorCode | null
}
