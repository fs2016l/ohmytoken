export const TOKEN_PLAN_PROVIDER_IDS = [
  'minimax',
  'zhipu',
  'openai',
  'anthropic',
  'kimi',
  'google',
  'xai',
] as const

export type TokenPlanProviderId = (typeof TOKEN_PLAN_PROVIDER_IDS)[number]
export type TokenPlanErrorCode =
  | 'not_connected'
  | 'expired'
  | 'invalid_credential'
  | 'permission_denied'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'network_error'
  | 'region_restricted'
  | 'region_unknown'
  | 'unsupported'

export interface TokenPlanConnection {
  id: string
  providerId: TokenPlanProviderId
  region: 'cn' | 'global'
  sources: string[]
  accountLabel: string | null
  authType: 'oauth' | 'api-key' | 'client'
  state: 'ready' | 'expired' | 'unsupported'
  scope: 'account' | 'project'
  identity?: 'account' | 'credential'
  connectionCount?: number
}

export interface TokenPlanWindowUsage {
  id: string
  label: string
  kind: 'model' | 'tool' | 'balance'
  windowMinutes: number | null
  available: boolean
  unlimited: boolean
  usedPercent: number | null
  remainingPercent: number | null
  used: number | null
  limit: number | null
  remaining: number | null
  unit: 'tokens' | 'requests' | 'credits' | 'USD' | 'CNY' | null
  startsAt: number | null
  resetsAt: number | null
  details: Array<{ name: string; used: number }>
}

export interface TokenPlanInformation {
  product: string
  tier: string | null
  tierSource: 'provider' | 'login' | null
  expiresAt: number | null
  renewalAt: number | null
  parallelLimit: number | null
}

export interface TokenPlanUsageSnapshot {
  connectionId: string
  providerId: TokenPlanProviderId
  status: 'ok' | 'partial' | 'error'
  observedAt: number | null
  checkedAt: number
  stale: boolean
  plan: TokenPlanInformation
  models: string[]
  windows: TokenPlanWindowUsage[]
  errorCode: TokenPlanErrorCode | null
  retryAt: number | null
}

export interface TokenPlanDiscoveryIssue {
  source: string
  reason: 'unreadable' | 'invalid_config' | 'unsupported' | 'scope_missing'
}

export interface TokenPlanInventory {
  connections: TokenPlanConnection[]
  snapshots: TokenPlanUsageSnapshot[]
  checkedSources: string[]
  issues: TokenPlanDiscoveryIssue[]
  discoveredAt: number
}

export const QUOTA_REFRESH_INTERVALS = [0, 30_000, 60_000, 300_000, 900_000] as const
export type QuotaRefreshInterval = (typeof QUOTA_REFRESH_INTERVALS)[number]

export interface TokenPlanMonitorState {
  revision: number
  inventory: TokenPlanInventory
  refreshInterval: QuotaRefreshInterval
  discovering: boolean
  refreshing: string[]
  error: string
}
