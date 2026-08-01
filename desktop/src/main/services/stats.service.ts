/**
 * 统计服务（对应 Java StatsService.java，319 行 → TypeScript）
 *
 * 聚合统计统一基于扫描后落库的 usage_api_calls 明细表。
 * 一条 API 跨天时，整条用量归属到 API 开始时间所在的本地日期。
 *
 * 日期比较统一使用字符串字典序（ISO 日期天然支持），
 * 与 Java String.compareTo 完全等价 —— 见 date-utils.isInRange。
 */
import type {
  AgentModelStats,
  ComparisonPair,
  Comparisons,
  DailyStats,
  HourlyUsageStats,
  ModelAgentStats,
  ModelStats,
  MonthlyStats,
  Overview,
  PageResult,
  TokenUsageApiCall,
  TokenUsageRecord,
  TokenUsageSession,
  TokenUsageUserSession,
  UsageApiCallFilter,
  UsageApiRecordFilter,
  UsageApiRecordPageFilter,
  UsageDetailFilter,
  UsageDetailPageFilter,
  UsageTrendStats,
} from '../../shared/models'
import {
  calcChange,
  isInRange,
  isValidDateStr,
  lastMondayStr,
  lastMonthEndStr,
  lastMonthSameDayStr,
  lastMonthStartStr,
  lastSundayStr,
  lastWeekSameDayStr,
  thisMondayStr,
  thisMonthStartStr,
  todayStr,
  yesterdayStr,
} from '../lib/date-utils'
import { hourFromTimestamp } from '../scanners/detail-utils'
import {
  listAgentModelAggregates,
  listDailyAgentModelAggregates,
  listMinuteUsageTrend,
  listUsageApiCalls,
  listUsageApiCallsByDate,
  listUsageApiRecords,
  listUsageApiRecordsPage,
  listUsageSessions,
  listUserUsageSessions,
  listUserUsageSessionsPage,
} from './usage-detail-storage.service'

// 与 Java StatsService 一致的默认日期范围
const DEFAULT_FROM = '2020-01-01'
const DEFAULT_TO = '2099-12-31'

function hasValidDate(record: { date: string }): boolean {
  return isValidDateStr(record.date || '')
}

/**
 * 每日统计（按 agent 分组）— 对应 Java getDailyStats
 * 返回按 date 升序（对应 Java TreeMap 自然排序）
 */
export function getDailyStats(from: string, to: string): DailyStats[] {
  const records = getApiAggregateRecords(from, to)
  const dailyAgentTokens: Record<string, Record<string, number>> = {}

  for (const record of records) {
    if (!hasValidDate(record)) continue
    if (!dailyAgentTokens[record.date]) dailyAgentTokens[record.date] = {}
    dailyAgentTokens[record.date][record.agent] =
      (dailyAgentTokens[record.date][record.agent] || 0) + record.totalTokens
  }

  return Object.keys(dailyAgentTokens)
    .sort()
    .map((date) => {
      const agentTokens = dailyAgentTokens[date]
      const totalTokens = Object.values(agentTokens).reduce((a, b) => a + b, 0)
      return { date, agentTokens, totalTokens }
    })
}

/**
 * 每日统计（按 model 分组）— 对应 Java getDailyModelStats
 * 返回按 date 升序
 */
export function getDailyModelStats(from: string, to: string): DailyStats[] {
  const records = getApiAggregateRecords(from, to)
  const dailyModelTokens: Record<string, Record<string, number>> = {}

  for (const record of records) {
    if (!hasValidDate(record)) continue
    if (!dailyModelTokens[record.date]) dailyModelTokens[record.date] = {}
    dailyModelTokens[record.date][record.model] =
      (dailyModelTokens[record.date][record.model] || 0) + record.totalTokens
  }

  return Object.keys(dailyModelTokens)
    .sort()
    .map((date) => {
      const agentTokens = dailyModelTokens[date]
      const totalTokens = Object.values(agentTokens).reduce((a, b) => a + b, 0)
      return { date, agentTokens, totalTokens }
    })
}

/**
 * 每月统计（按 agent 分组）— 对应 Java getMonthlyStats
 * month 取 date 前 7 字符（yyyy-MM）；返回按 month 升序
 */
export function getMonthlyStats(from: string, to: string): MonthlyStats[] {
  const records = getApiAggregateRecords()
  const monthlyAgentTokens: Record<string, Record<string, number>> = {}

  for (const record of records) {
    if (!hasValidDate(record)) continue
    const month = record.date.substring(0, 7) // yyyy-MM
    if (!isInRange(month, from, to)) continue
    if (!monthlyAgentTokens[month]) monthlyAgentTokens[month] = {}
    monthlyAgentTokens[month][record.agent] =
      (monthlyAgentTokens[month][record.agent] || 0) + record.totalTokens
  }

  return Object.keys(monthlyAgentTokens)
    .sort()
    .map((month) => {
      const agentTokens = monthlyAgentTokens[month]
      const totalTokens = Object.values(agentTokens).reduce((a, b) => a + b, 0)
      return { month, agentTokens, totalTokens }
    })
}

/**
 * 模型维度统计 — 对应 Java getModelStats
 * 返回按 model 升序；每个 model 含 agentTokens / 总体 total+input+output
 */
export function getModelStats(from: string, to: string): ModelStats[] {
  const records = listAgentModelAggregates({ from, to })
  const modelAgentTokens: Record<string, Record<string, number>> = {}
  const modelTotals: Record<string, { total: number; input: number; output: number }> = {}

  for (const record of records) {
    if (!modelAgentTokens[record.model]) modelAgentTokens[record.model] = {}
    modelAgentTokens[record.model][record.agent] =
      (modelAgentTokens[record.model][record.agent] || 0) + record.totalTokens

    if (!modelTotals[record.model]) modelTotals[record.model] = { total: 0, input: 0, output: 0 }
    modelTotals[record.model].total += record.totalTokens
    modelTotals[record.model].input += record.inputTokens
    modelTotals[record.model].output += record.outputTokens
  }

  return Object.keys(modelAgentTokens)
    .sort()
    .map((model) => {
      const totals = modelTotals[model]
      return {
        model,
        agentTokens: modelAgentTokens[model],
        totalTokens: totals.total,
        inputTokens: totals.input,
        outputTokens: totals.output,
      }
    })
}

/**
 * 指定 agent 下各 model 的明细，按 totalTokens 降序
 * 对应 Java getAgentModelStats(agent, from, to)
 */
export function getAgentModelStats(
  agent: string,
  from?: string | null,
  to?: string | null,
): AgentModelStats[] {
  const effectiveFrom = from ?? DEFAULT_FROM
  const effectiveTo = to ?? DEFAULT_TO
  return listAgentModelAggregates({ agent, from: effectiveFrom, to: effectiveTo }).map(
    (record) => ({
      model: record.model,
      totalTokens: record.totalTokens,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cacheReadTokens: record.cacheReadTokens,
      cacheWriteTokens: record.cacheWriteTokens,
      reasoningTokens: record.reasoningTokens,
    }),
  )
}

/**
 * 指定 model 下各 agent 的明细，按 totalTokens 降序
 * 对应 Java getModelAgentStats(model, from, to)
 */
export function getModelAgentStats(
  model: string,
  from?: string | null,
  to?: string | null,
): ModelAgentStats[] {
  const effectiveFrom = from ?? DEFAULT_FROM
  const effectiveTo = to ?? DEFAULT_TO
  return listAgentModelAggregates({ model, from: effectiveFrom, to: effectiveTo }).map(
    (record) => ({
      agent: record.agent,
      totalTokens: record.totalTokens,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cacheReadTokens: record.cacheReadTokens,
      cacheWriteTokens: record.cacheWriteTokens,
      reasoningTokens: record.reasoningTokens,
    }),
  )
}

/**
 * 总览 — 对应 Java getOverview(from, to)
 * 包含 grandTotal / agentTotals / modelTotals / 今日本周本月用量 / 日期范围
 */
export function getOverview(from?: string | null, to?: string | null): Overview {
  const effectiveFrom = from ?? DEFAULT_FROM
  const effectiveTo = to ?? DEFAULT_TO
  const records = getApiAggregateRecords(effectiveFrom, effectiveTo)

  const agentTotals: Record<string, number> = {}
  const modelTotals: Record<string, number> = {}
  let grandTotal = 0

  for (const record of records) {
    if (!hasValidDate(record)) continue
    agentTotals[record.agent] = (agentTotals[record.agent] || 0) + record.totalTokens
    modelTotals[record.model] = (modelTotals[record.model] || 0) + record.totalTokens
    grandTotal += record.totalTokens
  }

  // 计算 今日 / 本周（周一起） / 本月（1 号起）用量
  // 对应 Java：LocalDate.now() / now.with(DayOfWeek.MONDAY) / now.withDayOfMonth(1)
  const today = todayStr()
  const thisMonday = thisMondayStr()
  const thisMonthStart = thisMonthStartStr()

  const todayUsage = sumTokensForDate(records, today)
  const weekUsage = sumTokensInRange(records, thisMonday, today)
  const monthUsage = sumTokensInRange(records, thisMonthStart, today)

  const overview: Overview = {
    grandTotal,
    agentTotals,
    modelTotals,
    totalRecords: records.length,
    todayUsage,
    weekUsage,
    monthUsage,
  }

  // 对应 Java：dateFrom/dateTo 只在有有效日期记录时输出（取最小/最大日期）
  const dated = records.filter(hasValidDate).map((r) => r.date)
  if (dated.length > 0) {
    dated.sort()
    overview.dateFrom = dated[0]
    overview.dateTo = dated[dated.length - 1]
  }

  return overview
}

/**
 * 环比对比 — 对应 Java getComparisons()
 * todayVsYesterday / weekVsLastWeek(+同期) / monthVsLastMonth(+同期)
 * 每项含 currentTokens / previousTokens / change（百分比，一位小数）
 *
 * 口径说明：
 * - 较上周 / 较上月：本周(至今) vs 上周完整7天 / 本月(至今) vs 上月完整月 —— 口径不对等，反映"总量差距"
 * - 较上周同期 / 较上月同期：本周(至今) vs 上周同期(上周一~上周今天对应日) / 本月(至今) vs 上月同期 —— 天数对等，反映"同期环比"
 */
export function getComparisons(): Comparisons {
  const allRecords = getApiAggregateRecords()
  const today = todayStr()
  const yesterday = yesterdayStr()

  // 本周（周一起至今）vs 上周完整（上周一~上周日）+ 上周同期（上周一~上周今天对应日）
  const thisMonday = thisMondayStr()
  const lastMonday = lastMondayStr()
  const lastSunday = lastSundayStr()
  const lastWeekSameDay = lastWeekSameDayStr()

  // 本月（1号至今）vs 上月完整（上月1号~上月末）+ 上月同期（上月1号~上月今天对应日，clamp 到月末）
  const thisMonthStart = thisMonthStartStr()
  const lastMonthStart = lastMonthStartStr()
  const lastMonthEnd = lastMonthEndStr()
  const lastMonthSameDay = lastMonthSameDayStr()

  const todayTokens = sumTokensForDate(allRecords, today)
  const yesterdayTokens = sumTokensForDate(allRecords, yesterday)
  const thisWeekTokens = sumTokensInRange(allRecords, thisMonday, today)
  const lastWeekTokens = sumTokensInRange(allRecords, lastMonday, lastSunday)
  const lastWeekSamePeriodTokens = sumTokensInRange(allRecords, lastMonday, lastWeekSameDay)
  const thisMonthTokens = sumTokensInRange(allRecords, thisMonthStart, today)
  const lastMonthTokens = sumTokensInRange(allRecords, lastMonthStart, lastMonthEnd)
  const lastMonthSamePeriodTokens = sumTokensInRange(allRecords, lastMonthStart, lastMonthSameDay)

  return {
    todayVsYesterday: buildComparison(todayTokens, yesterdayTokens),
    weekVsLastWeek: buildComparison(thisWeekTokens, lastWeekTokens),
    weekVsLastWeekSamePeriod: buildComparison(thisWeekTokens, lastWeekSamePeriodTokens),
    monthVsLastMonth: buildComparison(thisMonthTokens, lastMonthTokens),
    monthVsLastMonthSamePeriod: buildComparison(thisMonthTokens, lastMonthSamePeriodTokens),
  }
}

/** 会话级明细查询 */
export function getUsageSessions(filter: UsageDetailFilter): TokenUsageSession[] {
  return listUsageSessions(filter)
}

/** 用户级会话查询：子会话按 root 会话归并到 children 内。 */
export function getUserUsageSessions(filter: UsageDetailFilter): TokenUsageUserSession[] {
  return listUserUsageSessions(filter)
}

export function getUserUsageSessionsPage(
  filter: UsageDetailPageFilter,
): PageResult<TokenUsageUserSession> {
  return listUserUsageSessionsPage(filter)
}

/** 会话内 API / prompt 轮次明细查询 */
export function getUsageApiCalls(filter: UsageApiCallFilter): TokenUsageApiCall[] {
  return listUsageApiCalls(filter)
}

/** API / prompt 轮次通用查询，可按 root 会话、原始 session、模型和日期过滤。 */
export function getUsageApiRecords(filter: UsageApiRecordFilter): TokenUsageApiCall[] {
  return listUsageApiRecords(filter)
}

export function getUsageApiRecordsPage(
  filter: UsageApiRecordPageFilter,
): PageResult<TokenUsageApiCall> {
  return listUsageApiRecordsPage(filter)
}

/**
 * 24 小时统计。
 * 只使用 usage_api_calls，不从 usage_records 日聚合反推小时数据。
 */
export function getHourlyUsageStats(params: {
  date: string
  groupBy: 'agent' | 'model'
}): HourlyUsageStats[] {
  const buckets: HourlyUsageStats[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    agentTokens: {},
    totalTokens: 0,
  }))

  const addToBucket = (hourValue: number, key: string, tokens: number): void => {
    const hour = clampHour(hourValue)
    buckets[hour].agentTokens[key] = (buckets[hour].agentTokens[key] || 0) + tokens
    buckets[hour].totalTokens += tokens
  }

  const calls = listUsageApiCallsByDate(params.date)
  for (const call of calls) {
    const key = params.groupBy === 'agent' ? call.agent : call.model
    addToBucket(hourFromApiCall(call), key, call.totalTokens)
  }

  return buckets
}

/** 最近一段时间的分钟级 Token 趋势，供悬浮窗连续时间轴使用。 */
export function getUsageTrendStats(params: {
  from: number
  to: number
  groupBy: 'agent' | 'model'
}): UsageTrendStats {
  return listMinuteUsageTrend(params.from, params.to, params.groupBy)
}

// ===== 内部工具 =====

/** 构建单个对比项（对应 Java buildComparison） */
function buildComparison(current: number, previous: number): ComparisonPair {
  return {
    currentTokens: current,
    previousTokens: previous,
    change: calcChange(current, previous),
  }
}

/** 精确匹配某一天的 totalTokens 求和（对应 Java sumTokensForDate） */
function sumTokensForDate(records: TokenUsageRecord[], date: string): number {
  return records
    .filter((r) => hasValidDate(r) && r.date === date)
    .reduce((sum, r) => sum + r.totalTokens, 0)
}

/** 闭区间日期范围内的 totalTokens 求和（对应 Java sumTokensInRange） */
function sumTokensInRange(records: TokenUsageRecord[], from: string, to: string): number {
  return records
    .filter((r) => hasValidDate(r) && isInRange(r.date, from, to))
    .reduce((sum, r) => sum + r.totalTokens, 0)
}

function getApiAggregateRecords(from = DEFAULT_FROM, to = DEFAULT_TO): TokenUsageRecord[] {
  return listDailyAgentModelAggregates(from, to)
}

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0
  if (hour < 0) return 0
  if (hour > 23) return 23
  return Math.trunc(hour)
}

function hourFromApiCall(call: TokenUsageApiCall): number {
  if (call.timestamp && Number.isFinite(Date.parse(call.timestamp))) {
    return hourFromTimestamp(call.timestamp)
  }
  return call.hour
}
