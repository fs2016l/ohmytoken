import type { UsageDetailFilter } from './models'
import type { UsageCostRollup } from './usage-cost'

export const ANALYTICS_BUCKETS = ['input', 'output', 'cache', 'reasoning'] as const
export type AnalyticsBucket = (typeof ANALYTICS_BUCKETS)[number]
export type AnalyticsBucketCosts = Record<AnalyticsBucket, UsageCostRollup | undefined>
export interface AnalyticsTokens {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
}
export interface AnalyticsMetrics extends AnalyticsTokens {
  lastActiveAt?: string
  apiCallCount: number
  apiCallCountComplete: boolean
  sessionCount: number
  sessionCountComplete: boolean
  turns: { count: number; complete: boolean }
  costSummary?: UsageCostRollup
}
export interface AnalyticsDimension extends AnalyticsMetrics {
  id: string
  name: string
}
export type AnalyticsModelUsage = Pick<
  AnalyticsDimension,
  'id' | 'name' | 'totalTokens' | 'costSummary'
>
export interface AnalyticsTrendValue {
  tokens: number
  calls: number
  callsComplete: boolean
  turns: number
  turnsComplete: boolean
  costs: UsageCostRollup['totals'] | null
  costPartial: boolean
}
export interface AnalyticsTrendPoint {
  key: string
  total: AnalyticsTrendValue
  agents: Record<string, AnalyticsTrendValue>
  models: Record<string, AnalyticsTrendValue>
  projects: Record<string, AnalyticsTrendValue>
}
export interface UsageAnalytics {
  from: string
  to: string
  summary: AnalyticsMetrics
  agents: AnalyticsDimension[]
  models: AnalyticsDimension[]
  modelAgents: Record<string, AnalyticsDimension[]>
  projectAgents: Record<string, AnalyticsDimension[]>
  projectModels: Record<string, AnalyticsModelUsage[]>
  projects: AnalyticsDimension[]
  dates: AnalyticsDimension[]
  days: AnalyticsTrendPoint[]
  hours: AnalyticsTrendPoint[]
  /** True only when the explicitly requested single-day scope has complete hourly buckets. */
  hourlyComplete: boolean
  bucketCosts: AnalyticsBucketCosts
}
export type UsageAnalyticsFilter = Pick<
  UsageDetailFilter,
  'from' | 'to' | 'agent' | 'agents' | 'model' | 'models' | 'projectId' | 'projectIds' | 'query'
>
