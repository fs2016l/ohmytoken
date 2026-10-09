/**
 * 统计服务（对应 Java StatsService.java，319 行 → TypeScript）
 *
 * 日统计读取已保存的会话汇总，秒级趋势读取会话时间序列。
 * 用量按来源事件时间归属到本地日期，无法推算生成过程中的每秒消耗。
 *
 * 日期比较统一使用字符串字典序（ISO 日期天然支持），
 * 与 Java String.compareTo 完全等价 —— 见 date-utils.isInRange。
 */
import { readModelCostRollups, readWithUsageCosts } from './usage-cost.service'
import { canonicalModelName, PRICE_CATALOG_VERSION } from '../cost/price-catalog'
import { combineCostRollups } from '../../shared/cost-rollup'
import { openDatabase } from './sqlite-storage.service'
import { hasProjectScope } from './session-project-scope'
import { refreshProjectUsageMetadata } from './session-project-metadata'
import { readUsageHours, readUsageSeconds } from './session-usage-trend'
import type {
  AgentModelStats,
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
  summarizeComparisons,
  summarizeDaily,
  summarizeModels,
  summarizeMonths,
  summarizeOverview,
} from '../../shared/scan-preview'
import {
  listAgentModelAggregates,
  listDailyAgentModelAggregates,
  listUsageApiCalls,
  listUsageApiRecords,
  listUsageApiRecordsPage,
  listUsageSessions,
  listUserUsageSessions,
  listUserUsageSessionsPage,
} from './usage-detail-storage.service'

// 与 Java StatsService 一致的默认日期范围
const DEFAULT_FROM = '2020-01-01'
const DEFAULT_TO = '2099-12-31'

/**
 * 每日统计（按 agent 分组）— 对应 Java getDailyStats
 * 返回按 date 升序（对应 Java TreeMap 自然排序）
 */
export function getDailyStats(from: string, to: string): DailyStats[] {
  return summarizeDaily(getApiAggregateRecords(from, to), 'agent')
}

/**
 * 每日统计（按 model 分组）— 对应 Java getDailyModelStats
 * 返回按 date 升序
 */
export function getDailyModelStats(from: string, to: string): DailyStats[] {
  return summarizeDaily(getApiAggregateRecords(from, to), 'model')
}

/**
 * 每月统计（按 agent 分组）— 对应 Java getMonthlyStats
 * month 取 date 前 7 字符（yyyy-MM）；返回按 month 升序
 */
export function getMonthlyStats(from: string, to: string): MonthlyStats[] {
  return summarizeMonths(getApiAggregateRecords(), from, to)
}

/**
 * 模型维度统计 — 对应 Java getModelStats
 * 返回按 model 升序；每个 model 含 agentTokens / 总体 total+input+output
 */
export function getModelStats(from: string, to: string): ModelStats[] {
  return summarizeModels(
    listAgentModelAggregates({ from, to }).map((row) => ({
      ...row,
      model: canonicalModelName(row.model),
    })),
  )
}

/**
 * 指定 agent 下各 model 的明细，按 totalTokens 降序
 * 对应 Java getAgentModelStats(agent, from, to)
 */
export async function getAgentModelStats(
  agent: string,
  from?: string | null,
  to?: string | null,
): Promise<AgentModelStats[]> {
  const effectiveFrom = from ?? DEFAULT_FROM
  const effectiveTo = to ?? DEFAULT_TO
  const records = await getPricedModelAggregates({ agent, from: effectiveFrom, to: effectiveTo })
  return groupModelAggregates(records).map((record) => ({
    model: record.model,
    costSummary: record.costSummary,
    totalTokens: record.totalTokens,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    reasoningTokens: record.reasoningTokens,
  }))
}

/**
 * 指定 model 下各 agent 的明细，按 totalTokens 降序
 * 对应 Java getModelAgentStats(model, from, to)
 */
export async function getModelAgentStats(
  model: string,
  from?: string | null,
  to?: string | null,
): Promise<ModelAgentStats[]> {
  const effectiveFrom = from ?? DEFAULT_FROM
  const effectiveTo = to ?? DEFAULT_TO
  const records = await getPricedModelAggregates({ model, from: effectiveFrom, to: effectiveTo })
  return groupModelAggregates(records).map((record) => ({
    agent: record.agent,
    costSummary: record.costSummary,
    totalTokens: record.totalTokens,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    reasoningTokens: record.reasoningTokens,
  }))
}

async function getPricedModelAggregates(
  filter: Pick<UsageDetailFilter, 'agent' | 'model' | 'from' | 'to'>,
) {
  return readWithUsageCosts(() => {
    const costs = readModelCostRollups(filter)
    return listAgentModelAggregates(filter).map((record) => {
      const cost = costs.get(JSON.stringify([record.agent, record.model]))
      return {
        ...record,
        costSummary: cost?.totalTokens === record.totalTokens ? cost : undefined,
      }
    })
  })
}

type PricedModelAggregate = Awaited<ReturnType<typeof getPricedModelAggregates>>[number]

function groupModelAggregates(records: PricedModelAggregate[]): PricedModelAggregate[] {
  const groups = new Map<
    string,
    {
      value: PricedModelAggregate
      costs: NonNullable<PricedModelAggregate['costSummary']>[]
      missing: boolean
    }
  >()
  for (const row of records) {
    const model = canonicalModelName(row.model)
    const key = JSON.stringify([row.agent, model])
    let group = groups.get(key)
    if (!group) {
      group = {
        value: {
          ...row,
          model,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          costSummary: undefined,
        },
        costs: [],
        missing: false,
      }
      groups.set(key, group)
    }
    group.value.totalTokens += row.totalTokens
    group.value.inputTokens += row.inputTokens
    group.value.outputTokens += row.outputTokens
    group.value.cacheReadTokens += row.cacheReadTokens
    group.value.cacheWriteTokens += row.cacheWriteTokens
    group.value.reasoningTokens += row.reasoningTokens
    if (row.costSummary) group.costs.push(row.costSummary)
    else group.missing = true
  }
  return [...groups.values()]
    .map(({ value, costs, missing }) => ({
      ...value,
      costSummary: missing ? undefined : combineCostRollups(costs, PRICE_CATALOG_VERSION),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model))
}

/**
 * 总览 — 对应 Java getOverview(from, to)
 * 包含 grandTotal / agentTotals / modelTotals / 今日本周本月用量 / 日期范围
 */
export function getOverview(from?: string | null, to?: string | null): Overview {
  return summarizeOverview(getApiAggregateRecords(from ?? DEFAULT_FROM, to ?? DEFAULT_TO))
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
  return summarizeComparisons(getApiAggregateRecords())
}

/** 会话级明细查询 */
export async function getUsageSessions(filter: UsageDetailFilter): Promise<TokenUsageSession[]> {
  if (hasProjectScope(filter)) await refreshProjectUsageMetadata(openDatabase())
  return readWithUsageCosts(() => listUsageSessions(filter))
}

/** 用户级会话查询：子会话按 root 会话归并到 children 内。 */
export async function getUserUsageSessions(
  filter: UsageDetailFilter,
): Promise<TokenUsageUserSession[]> {
  if (hasProjectScope(filter)) await refreshProjectUsageMetadata(openDatabase())
  return readWithUsageCosts(() => listUserUsageSessions(filter))
}

export async function getUserUsageSessionsPage(
  filter: UsageDetailPageFilter,
): Promise<PageResult<TokenUsageUserSession>> {
  if (hasProjectScope(filter)) await refreshProjectUsageMetadata(openDatabase())
  return readWithUsageCosts(() => listUserUsageSessionsPage(filter))
}

/** 会话内 API / prompt 轮次明细查询 */
export function getUsageApiCalls(filter: UsageApiCallFilter): TokenUsageApiCall[] {
  return listUsageApiCalls(filter).map((call) => ({
    ...call,
    model: canonicalModelName(call.model),
  }))
}

/** API / prompt 轮次通用查询，可按 root 会话、原始 session、模型和日期过滤。 */
export function getUsageApiRecords(filter: UsageApiRecordFilter): TokenUsageApiCall[] {
  return listUsageApiRecords(filter).map((call) => ({
    ...call,
    model: canonicalModelName(call.model),
  }))
}

export function getUsageApiRecordsPage(
  filter: UsageApiRecordPageFilter,
): PageResult<TokenUsageApiCall> {
  const page = listUsageApiRecordsPage(filter)
  return {
    ...page,
    items: page.items.map((call) => ({ ...call, model: canonicalModelName(call.model) })),
  }
}

/**
 * 24 小时统计。
 * 使用秒级用量汇总，不从每日总量反推小时分布。
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

  const calls = readUsageHours(openDatabase(), params.date)
  for (const call of calls) {
    const key = params.groupBy === 'agent' ? call.agent : canonicalModelName(call.model)
    addToBucket(call.hour, key, call.totalTokens)
  }

  return buckets
}

/** 最近一段时间的秒级 Token 趋势，供悬浮窗连续时间轴使用。 */
export function getUsageTrendStats(params: {
  from: number
  to: number
  groupBy: 'agent' | 'model'
}): UsageTrendStats {
  return readUsageSeconds(openDatabase(), params.from, params.to, params.groupBy)
}

// ===== 内部工具 =====

function getApiAggregateRecords(from = DEFAULT_FROM, to = DEFAULT_TO): TokenUsageRecord[] {
  return listDailyAgentModelAggregates(from, to).map((row) => ({
    ...row,
    model: canonicalModelName(row.model),
  }))
}

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0
  if (hour < 0) return 0
  if (hour > 23) return 23
  return Math.trunc(hour)
}
