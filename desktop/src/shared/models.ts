/**
 * Token 用量记录（对应 Java: TokenUsageRecord.java）
 * 跨 Scanner 的核心数据模型
 */
export interface TokenUsageRecord {
  costSummary?: import('./usage-cost').UsageCostRollup
  agent: string
  date: string // "yyyy-MM-dd" 或 "unknown"
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  reasoningTokens: number
  cost: number
}

/** 关闭主窗口后的全局行为；主进程持久化，所有 renderer 共用同一份偏好。 */
export type CloseBehavior = 'ask' | 'background' | 'quit'

/** 单次 API 的原生生成计时或明确标注的响应均速估算，时长均为毫秒。 */
export interface GenerationTiming {
  /** 默认是原生流速；响应均速估算不能混用流输出时长。 */
  speedKind?: 'response-estimate'
  /** 日志中可观察的响应区间，包含首输出等待和其他客户端开销。 */
  responseDurationMs?: number
  /** 累计用量来源携带的原生单次调用身份；逐调用用量默认使用外层身份。 */
  apiCallId?: string
  /** 个别来源只有响应落库排序时间，不能标为精确生成完成时间。 */
  timeSource?: 'recorded'
  completedAtMs: number
  timeToFirstTokenMs?: number
  streamDurationMs?: number
  /** 与流计时范围一致的输出量，包含该范围内的推理 Token。 */
  generatedTokens?: number
}

/** 会话最近一条原生计时样本或带响应均速估算的用量记录。 */
export interface LatestGeneration {
  speedKind?: 'response-estimate'
  responseDurationMs?: number
  timeSource?: 'recorded'
  apiCallId: string
  sessionId: string
  model: string
  completedAtMs: number
  timeToFirstTokenMs?: number
  streamDurationMs?: number
  generatedTokens?: number
  tokensPerSecond?: number
}

/** 原生轮级首 Token，身份与单次 API 计时分开；每个会话仅保留最近有效一轮。 */
export interface LatestTurnFirstToken {
  sessionId: string
  turnId: string
  completedAtMs: number
  timeToFirstTokenMs: number
}

/**
 * 会话级 Token 用量汇总。
 * 一条记录代表某个智能体中一个会话在某个模型下的汇总用量。
 */
export interface TokenUsageSession {
  latestGeneration?: LatestGeneration
  latestTurnFirstToken?: LatestTurnFirstToken
  turns?: { count: number; complete: boolean }
  costSummary?: import('./usage-cost').UsageCostRollup
  agent: string
  sessionId: string
  /** 子会话所属的直接父会话；顶层用户会话为空。 */
  parentSessionId?: string
  /** 用户新建的顶层会话 ID；旧数据默认等于 sessionId。 */
  rootSessionId?: string
  /** 子 agent / 子任务名称；仅子会话有值。 */
  subAgentName?: string
  /** 会话运行时的真实工作目录；仅在数据源明确提供时记录。 */
  projectPath?: string
  title?: string
  date: string
  startedAt: string
  endedAt: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  reasoningTokens: number
  apiCallCount: number
  apiCallCountComplete?: boolean
  cost?: number
}

/**
 * 会话内单次 API / prompt 轮次的 Token 用量明细。
 */
export interface TokenUsageApiCall {
  generationTiming?: GenerationTiming
  /** 来源明确标记的请求身份；自动任务与用户请求分别保留。 */
  turn?: { id: string; userInitiated: boolean; complete?: false }
  evidence?: import('./usage-cost').UsageEvidence
  costAssessment?: import('./usage-cost').UsageCostAssessment
  agent: string
  apiCallId: string
  sessionId: string
  parentSessionId?: string
  rootSessionId?: string
  subAgentName?: string
  /** 本轮调用所属的真实工作目录；仅在数据源明确提供时记录。 */
  projectPath?: string
  role?: string
  date: string
  /** 数据源提供的原始时间值；数字时间戳按原始十进制字符串保存。 */
  rawTimestamp: string
  /** 采集时转换成系统时区的固定格式时间，供排序与界面直接展示。 */
  timestamp: string
  hour: number
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  reasoningTokens: number
}

/** 通用分页请求；页码从 1 开始。 */
export interface PaginationRequest {
  page?: number
  pageSize?: number
}

/** 通用分页响应。 */
export interface PageResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** 会话明细查询过滤条件 */
export interface UsageDetailFilter {
  onlyFavorites?: boolean
  agents?: string[]
  models?: string[]
  projectIds?: string[]
  agent?: string
  model?: string
  rootSessionId?: string
  projectId?: string
  /** 仅包含用户已保存项目目录覆盖的记录。 */
  trackedProjectsOnly?: boolean
  /** 多关键词会话搜索；空格分词、任意词匹配。 */
  query?: string
  from?: string
  to?: string
}

export interface UsageDetailPageFilter extends UsageDetailFilter, PaginationRequest {}

export type SessionSort =
  | 'title'
  | 'agent'
  | 'model'
  | 'tokens'
  | 'input'
  | 'output'
  | 'cache'
  | 'reasoning'
  | 'cost'
  | 'calls'
  | 'turns'
  | 'change'
  | 'recent'
export interface SessionWorkspaceFilter extends UsageDetailPageFilter {
  sortBy?: SessionSort
  sortDirection?: 'asc' | 'desc'
  /** Display exchange rate, used only for comparable cost ordering. */
  costExchangeRate?: number
  /** Token baseline for the same root and filters in a different calendar range. */
  comparison?: { from: string; to: string }
}
export interface SessionWorkspaceSummary {
  totalTokens: number
  apiCallCount: number
  apiCallCountComplete: boolean
  costSummary?: import('./usage-cost').UsageCostRollup
}
export interface SessionWorkspacePage extends PageResult<TokenUsageUserSession> {
  summary: SessionWorkspaceSummary
}

/** API 明细查询过滤条件 */
export interface UsageApiCallFilter {
  agent: string
  sessionId: string
  model?: string
  rootSessionId?: string
  projectId?: string
  trackedProjectsOnly?: boolean
  from?: string
  to?: string
}

/** API 明细通用查询过滤条件，可按用户级 root 会话或原始 session 查询。 */
export interface UsageApiRecordFilter {
  agent?: string
  sessionId?: string
  rootSessionId?: string
  model?: string
  models?: string[]
  projectId?: string
  projectIds?: string[]
  trackedProjectsOnly?: boolean
  from?: string
  to?: string
}

export interface UsageApiRecordPageFilter extends UsageApiRecordFilter, PaginationRequest {}

/** 用户级会话里的子会话条目。 */
export interface TokenUsageSessionChild extends TokenUsageSession {
  parentSessionId: string
  rootSessionId: string
}

/** 用户新建的顶层会话，children 承载子 agent / 子会话数据。 */
export interface TokenUsageUserSession extends TokenUsageSession {
  rootSessionId: string
  /** Participants ordered by their latest activity in the selected scope, newest first. */
  agents: string[]
  models: string[]
  modelTotals?: Record<string, number>
  children: TokenUsageSessionChild[]
  comparisonTokens?: number
}

/** 小时级统计（agentTokens 字段沿用 DailyStats 的前端数据结构） */
export interface HourlyUsageStats {
  hour: number
  label: string
  agentTokens: Record<string, number>
  totalTokens: number
}

/** Token 趋势中的单个时间桶。 */
export interface MinuteUsagePoint {
  /** 对齐到时间桶的 Unix 毫秒时间戳。 */
  timestamp: number
  dimensionTokens: Record<string, number>
  totalTokens: number
}

/**
 * 可缩放 Token 趋势。
 *
 * points 只包含有用量的秒；界面按可视范围合并，空闲区间按需补零。
 */
export interface UsageTrendStats {
  from: number
  to: number
  groupBy: 'agent' | 'model'
  bucketMinutes: number
  bucketSeconds?: number
  points: MinuteUsagePoint[]
  dimensionTotals: Record<string, number>
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

/** Scanner 详细扫描结果，records 保持旧日聚合口径 */
export interface ScannerUsageDetails {
  records: TokenUsageRecord[]
  sessions: TokenUsageSession[]
  apiCalls: TokenUsageApiCall[]
  /** 原生响应自带计时和用量，但没有与用量表共享的请求 ID 时独立传递。 */
  latestGenerations?: LatestGeneration[]
  /** 不与某次 API 共用边界的原生轮级首 Token。 */
  latestTurnFirstTokens?: LatestTurnFirstToken[]
}

/** 扫描模式：默认增量；full 仅用于首次基线或用户显式恢复。 */
export type ScanMode = 'incremental' | 'full'

export interface ScanOptions {
  mode?: ScanMode
}

/**
 * 扫描结果（对应 Java: ScanResult.java）
 */
export interface ScanResult {
  scanTime: string // ISO_LOCAL_DATE_TIME
  mode?: ScanMode
  /** 本次增量扫描最早回看到的时间；全量扫描为空。 */
  incrementalFrom?: string
  totalRecords: number
  records: TokenUsageRecord[]
  scannedAgents: string[]
  errors: string[]
  detectedAgents: string[]
}

/**
 * 每日统计（对应 Java: DailyStats.java）
 */
export interface DailyStats {
  date: string
  agentTokens: Record<string, number>
  totalTokens: number
}

export interface UsageTurnStats {
  turns: number
  coveredSessions: number
  unknownSessions: number
  dimensions: Record<string, number>
  days: Array<{ date: string; turns: number; dimensions: Record<string, number> }>
}

/**
 * 每月统计（对应 Java: MonthlyStats.java）
 */
export interface MonthlyStats {
  month: string
  agentTokens: Record<string, number>
  totalTokens: number
}

/**
 * 模型统计（对应 Java: ModelStats.java）
 */
export interface ModelStats {
  model: string
  agentTokens: Record<string, number>
  totalTokens: number
  inputTokens: number
  outputTokens: number
}

/**
 * Agent-Model 统计（对应 Java: AgentModelStats.java）
 */
export interface AgentModelStats {
  model: string
  costSummary?: import('./usage-cost').UsageCostRollup
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

/**
 * Model-Agent 统计（对应 Java: ModelAgentStats.java）
 */
export interface ModelAgentStats {
  agent: string
  costSummary?: import('./usage-cost').UsageCostRollup
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

/** 用户保存的项目目录。path 保留用于界面展示，normalizedPath 用于归属匹配。 */
export interface TrackedProject {
  notes?: string
  id: string
  name: string
  path: string
  normalizedPath: string
  createdAt: number
  source?: 'manual' | 'discovered'
  ignored?: boolean
  directories?: string[]
}

export interface ProjectUsageStat {
  projectId: string
  name: string
  path: string
  source?: 'manual' | 'discovered'
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

export interface ProjectWorkspaceItem extends ProjectUsageStat {
  notes: string
  /** Participants ordered by their latest activity in the selected scope, newest first. */
  agents: string[]
  agentTotals: Record<string, number>
  models: string[]
  modelTotals: Record<string, number>
  sessionCount: number
  apiCallCount: number
  apiCallCountComplete: boolean
  costSummary?: import('./usage-cost').UsageCostRollup
  turns: { count: number; complete: boolean }
  lastActivity: string
}
export interface ProjectWorkspacePage extends PageResult<ProjectWorkspaceItem> {
  summary: SessionWorkspaceSummary & { sessionCount: number }
}

export interface ProjectDailyStats {
  date: string
  projectTokens: Record<string, number>
  totalTokens: number
}

export interface ProjectHourlyStats {
  hour: number
  label: string
  projectTokens: Record<string, number>
  totalTokens: number
}

export interface ProjectUsageOverview {
  projects: ProjectUsageStat[]
  daily: ProjectDailyStats[]
  /** 单日模式下返回完整 24 小时桶；其他日期范围为空数组。 */
  hourly: ProjectHourlyStats[]
}

export interface ProjectUsageDetail {
  byModel: AgentModelStats[]
  byAgent: ModelAgentStats[]
}

/**
 * 总览数据（对应 Java: StatsService.getOverview()）
 */
export interface Overview {
  grandTotal: number
  agentTotals: Record<string, number>
  modelTotals: Record<string, number>
  totalRecords: number
  todayUsage: number
  weekUsage: number
  monthUsage: number
  dateFrom?: string
  dateTo?: string
}

/**
 * 环比对比数据（对应 Java: StatsService.getComparisons()）
 */
export interface ComparisonPair {
  currentTokens: number
  previousTokens: number
  change: number // 百分比，一位小数
}

export interface Comparisons {
  todayVsYesterday: ComparisonPair
  /** 本周(周一起至今) vs 上周(完整周一~周日) —— "较上周" */
  weekVsLastWeek: ComparisonPair
  /** 本周(周一起至今) vs 上周同期(上周一~上周今天对应日) —— "较上周同期" */
  weekVsLastWeekSamePeriod: ComparisonPair
  /** 本月(1号至今) vs 上月(完整1号~月末) —— "较上月" */
  monthVsLastMonth: ComparisonPair
  /** 本月(1号至今) vs 上月同期(上月1号~上月今天对应日) —— "较上月同期" */
  monthVsLastMonthSamePeriod: ComparisonPair
}
