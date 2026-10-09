import type { TokenPlanErrorCode } from './token-plan'

export const QUOTA_DETAIL_SOURCES = [
  'codex-activity',
  'codex-analytics',
  'codex-distribution',
  'glm-models',
  'glm-tools',
  'minimax-billing',
  'claude-extra',
  'gemini-account',
  'grok-billing',
  'grok-settings',
] as const
export type QuotaDetailSourceId = (typeof QUOTA_DETAIL_SOURCES)[number]
export type QuotaMetricUnit =
  | 'tokens'
  | 'requests'
  | 'turns'
  | 'threads'
  | 'days'
  | 'seconds'
  | 'ms'
  | 'percent'
  | 'ratio'
  | 'credits'
  | 'USD'
  | 'CNY'
  | 'count'
  | 'unknown'
export interface QuotaMetric {
  key: string
  value: number
  unit: QuotaMetricUnit
  label?: string
}
export interface QuotaDetailRow {
  id: string
  time: string | null
  label: string
  category: string | null
  metrics: QuotaMetric[]
}
export interface QuotaDetailSource {
  id: QuotaDetailSourceId
  status: 'ok' | 'partial' | 'error' | 'unsupported'
  checkedAt: number
  observedAt: number | null
  providerAsOf: number | null
  stale: boolean
  errorCode: TokenPlanErrorCode | null
  retryAt: number | null
  granularity: 'day' | 'hour' | 'event' | 'month' | 'snapshot' | 'unknown'
  timeZone: string | null
  metrics: QuotaMetric[]
  rows: QuotaDetailRow[]
  nextCursor: string | null
  totalRows: number | null
  notes: string[]
}
export interface QuotaDetailQuery {
  startDate: string
  endDate: string
  source?: QuotaDetailSourceId
  cursor?: string
  force?: boolean
}
export interface QuotaDetails {
  connectionId: string
  startDate: string
  endDate: string
  sources: QuotaDetailSource[]
}
