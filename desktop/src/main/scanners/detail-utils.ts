import type { TokenUsageApiCall, TokenUsageRecord, TokenUsageSession } from '../../shared/models'
import { formatDateFromMs, localTimestampFromValue } from '../lib/date-utils'

type TokenTotals = Pick<
  TokenUsageRecord,
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'totalTokens'
  | 'reasoningTokens'
  | 'cost'
>

export function hourFromTimestamp(timestamp: string): number {
  const parsed = Date.parse(timestamp)
  if (Number.isFinite(parsed)) return clampHour(new Date(parsed).getHours())
  const match = /T(\d{2}):/.exec(timestamp)
  if (match) return clampHour(Number.parseInt(match[1], 10))
  return 0
}

export interface CollectedTimestamp {
  /** 数据源中的原始值，供后续增量扫描使用。 */
  rawTimestamp: string
  /** 系统本地时区时间，固定为 yyyy-MM-ddTHH:mm:ss.SSS。 */
  timestamp: string
}

export function timestampsFromValue(value: unknown, fallbackDate: string): CollectedTimestamp {
  const sourceValue =
    typeof value === 'string'
      ? value
      : (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint'
        ? String(value)
        : ''
  return {
    rawTimestamp: sourceValue,
    timestamp: localTimestampFromValue(
      typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
        ? value
        : undefined,
      fallbackDate,
    ),
  }
}

export function timestampFromValue(value: unknown, fallbackDate: string): string {
  return timestampsFromValue(value, fallbackDate).timestamp
}

export function dateFromTimestamp(timestamp: string, fallbackDate = 'unknown'): string {
  const parsed = Date.parse(timestamp)
  if (Number.isFinite(parsed)) return formatDateFromMs(parsed)
  const candidate = timestamp.substring(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : fallbackDate
}

export function buildSessionsFromApiCalls(
  agent: string,
  apiCalls: TokenUsageApiCall[],
): TokenUsageSession[] {
  const grouped = new Map<string, TokenUsageSession>()

  for (const call of apiCalls) {
    const key = `${call.sessionId}|${call.date}|${call.model}`
    const current = grouped.get(key)
    if (!current) {
      const rootSessionId = call.rootSessionId ?? call.sessionId
      const session: TokenUsageSession = {
        agent,
        sessionId: call.sessionId,
        date: call.date,
        startedAt: call.timestamp,
        endedAt: call.timestamp,
        model: call.model,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        cacheReadTokens: call.cacheReadTokens,
        cacheWriteTokens: call.cacheWriteTokens,
        totalTokens: call.totalTokens,
        reasoningTokens: call.reasoningTokens,
        apiCallCount: 1,
      }
      if (call.parentSessionId) session.parentSessionId = call.parentSessionId
      if (rootSessionId !== call.sessionId || call.parentSessionId) {
        session.rootSessionId = rootSessionId
      }
      if (call.subAgentName) session.subAgentName = call.subAgentName
      if (call.projectPath) session.projectPath = call.projectPath
      grouped.set(key, session)
      continue
    }

    current.startedAt = earlierTimestamp(current.startedAt, call.timestamp)
    current.endedAt = laterTimestamp(current.endedAt, call.timestamp)
    current.inputTokens += call.inputTokens
    current.outputTokens += call.outputTokens
    current.cacheReadTokens += call.cacheReadTokens
    current.cacheWriteTokens += call.cacheWriteTokens
    current.totalTokens += call.totalTokens
    current.reasoningTokens += call.reasoningTokens
    current.apiCallCount += 1
    if (!current.projectPath && call.projectPath) current.projectPath = call.projectPath
  }

  return [...grouped.values()]
}

export function applySessionTitles(
  sessions: TokenUsageSession[],
  titleBySessionId: Map<string, string>,
): void {
  for (const session of sessions) {
    if (session.title?.trim()) continue
    const title = titleBySessionId.get(session.sessionId)?.trim()
    if (title) session.title = title
  }
}

export function buildRecordsFromSessions(
  agent: string,
  sessions: TokenUsageSession[],
): TokenUsageRecord[] {
  const grouped = new Map<string, TokenTotals>()

  for (const session of sessions) {
    const key = `${session.date}|${session.model}`
    const current = grouped.get(key) ?? emptyTotals()
    current.inputTokens += session.inputTokens
    current.outputTokens += session.outputTokens
    current.cacheReadTokens += session.cacheReadTokens
    current.cacheWriteTokens += session.cacheWriteTokens
    current.totalTokens += session.totalTokens
    current.reasoningTokens += session.reasoningTokens
    current.cost += session.cost ?? 0
    grouped.set(key, current)
  }

  return [...grouped.entries()].map(([key, totals]) => {
    const sepIdx = key.indexOf('|')
    return {
      agent,
      date: sepIdx >= 0 ? key.substring(0, sepIdx) : key,
      model: sepIdx >= 0 ? key.substring(sepIdx + 1) : 'unknown',
      ...totals,
    }
  })
}

function emptyTotals(): TokenTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cost: 0,
  }
}

function earlierTimestamp(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return a <= b ? a : b
}

function laterTimestamp(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0
  if (hour < 0) return 0
  if (hour > 23) return 23
  return Math.trunc(hour)
}
