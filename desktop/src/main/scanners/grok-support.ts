import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync } from 'fs'
import type { Dirent } from 'fs'
import { dirname, join } from 'path'
import { getGrokSessionsDir } from '../lib/paths'
import { dateFromTimestamp, hourFromTimestamp, timestampsFromValue } from './detail-utils'
import { isApiCallInWindow } from './incremental-utils'
import { normalizeCollectedProjectPath } from './project-path'
import { splitInclusiveTokenBuckets, tokenBuckets } from './token-usage'
import type { ScannerScanContext, TokenUsageApiCall } from './types'

export const GROK_UNKNOWN_MODEL = 'grok-unknown'

export interface GrokSessionMeta {
  model: string
  projectPath?: string
}

interface GrokSplitUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
}

/** 将原始计数转换为内部互斥分项。 */
export function splitGrokUsage(
  rawInput: number,
  rawOutput: number,
  cacheRead: number,
  cacheWrite: number,
  reasoning: number,
  reportedTotal: number,
): GrokSplitUsage | null {
  const raw = tokenBuckets({
    inputTokens: rawInput,
    outputTokens: rawOutput,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    reasoningTokens: reasoning,
  })
  if (raw.totalTokens <= 0) return null

  // Grok 常规口径中 input 含 cache，output 含 reasoning；当来源总量
  // 明确不等于 rawInput + rawOutput 时，视为已经互斥的新 schema。
  if (reportedTotal <= 0 || reportedTotal === raw.inputTokens + raw.outputTokens) {
    return splitInclusiveTokenBuckets({
      inputTokens: raw.inputTokens,
      outputTokens: raw.outputTokens,
      cacheReadTokens: raw.cacheReadTokens,
      cacheWriteTokens: raw.cacheWriteTokens,
      reasoningTokens: raw.reasoningTokens,
    })
  }
  return raw
}

/** 从会话记录路径取得会话标识。 */
export function grokSessionIdFromUpdatesFile(file: string): string {
  const parts = file.split(/[\\/]/)
  const updatesIndex = parts.lastIndexOf('updates.jsonl')
  if (updatesIndex < 1) return ''
  return parts[updatesIndex - 1] || ''
}

/** 收集日志解析所需的会话模型信息。 */
export function readGrokSessionMetadata(): Map<string, GrokSessionMeta> {
  const map = new Map<string, GrokSessionMeta>()
  const sessionsDir = getGrokSessionsDir()
  let workspaces: Dirent[] = []
  try {
    workspaces = readdirSync(sessionsDir, { withFileTypes: true })
  } catch {
    return map
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue
    const projectPath = decodeGrokProjectPath(workspace.name)
    let sessionDirs: Dirent[] = []
    try {
      sessionDirs = readdirSync(join(sessionsDir, workspace.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory()) continue
      const sessionId = sessionDir.name
      const dirPath = join(sessionsDir, workspace.name, sessionId)
      const model = readGrokSessionModel(dirPath) || GROK_UNKNOWN_MODEL
      map.set(sessionId, { model, ...(projectPath ? { projectPath } : {}) })
    }
  }
  return map
}

function decodeGrokProjectPath(encoded: string): string | undefined {
  try {
    return normalizeCollectedProjectPath(decodeURIComponent(encoded))
  } catch {
    return undefined
  }
}

function readGrokSessionModel(dirPath: string): string {
  const summaryPath = join(dirPath, 'summary.json')
  if (existsSync(summaryPath)) {
    try {
      const summary: unknown = JSON.parse(readFileSync(summaryPath, 'utf8'))
      if (isObject(summary)) {
        for (const key of ['current_model_id', 'model_id', 'model']) {
          const value = summary[key]
          if (typeof value === 'string' && value.trim()) return value.trim()
        }
      }
    } catch {
      // 继续尝试下一种结构
    }
  }
  const signalsPath = join(dirPath, 'signals.json')
  if (existsSync(signalsPath)) {
    try {
      const signals: unknown = JSON.parse(readFileSync(signalsPath, 'utf8'))
      if (isObject(signals)) {
        const primary = signals.primaryModelId
        if (typeof primary === 'string' && primary.trim()) return primary.trim()
        const modelsUsed = signals.modelsUsed
        if (Array.isArray(modelsUsed) && typeof modelsUsed[0] === 'string' && modelsUsed[0]) {
          return modelsUsed[0]
        }
      }
    } catch {
      // 继续尝试下一种结构
    }
  }
  return ''
}

export function createGrokCall(
  agent: string,
  apiCallId: string,
  sessionId: string,
  model: string,
  timestampValue: string | number,
  usage: GrokSplitUsage,
  projectPath?: string,
): TokenUsageApiCall {
  const { timestamp, rawTimestamp } = timestampsFromValue(timestampValue, 'unknown')
  return {
    agent,
    apiCallId,
    sessionId,
    ...(projectPath ? { projectPath } : {}),
    date: dateFromTimestamp(timestamp, 'unknown'),
    rawTimestamp,
    timestamp,
    hour: hourFromTimestamp(timestamp),
    model: model.trim() || GROK_UNKNOWN_MODEL,
    ...usage,
  }
}

export function extractGrokModel(value: Record<string, unknown>): string {
  for (const path of [
    ['params', 'update', '_meta', 'modelId'],
    ['params', '_meta', 'modelId'],
    ['params', 'update', 'modelId'],
    ['ctx', 'model_id'],
    ['ctx', 'modelId'],
    ['ctx', 'model'],
    ['modelId'],
    ['model'],
  ]) {
    const model = nestedValue(value, path)
    if (typeof model === 'string' && model.trim()) return model.trim()
  }
  return ''
}

export function extractGrokTimestamp(value: Record<string, unknown>): string | number {
  for (const path of [
    ['params', '_meta', 'agentTimestampMs'],
    ['params', 'update', '_meta', 'agentTimestampMs'],
    ['params', '_meta', 'timestampMs'],
    ['params', 'timestamp'],
    ['timestamp'],
    ['ts'],
  ]) {
    const timestamp = nestedValue(value, path)
    if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) {
      return timestamp
    }
    if (typeof timestamp === 'string' && timestamp.trim()) return timestamp.trim()
  }
  return 0
}

export function extractGrokTotal(value: Record<string, unknown>): number | null {
  for (const path of [
    ['params', '_meta', 'totalTokens'],
    ['params', 'update', '_meta', 'totalTokens'],
    ['params', 'update', 'totalTokens'],
    ['params', 'totalTokens'],
    ['usage', 'totalTokens'],
    ['totalTokens'],
  ]) {
    const total = nestedValue(value, path)
    if (typeof total === 'number' && Number.isFinite(total)) return Math.trunc(total)
    if (typeof total === 'string' && total.trim()) {
      const parsed = Number.parseInt(total, 10)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

export function extractGrokEventId(value: Record<string, unknown>): string {
  for (const path of [
    ['params', '_meta', 'eventId'],
    ['params', 'update', '_meta', 'eventId'],
    ['params', 'update', 'eventId'],
  ]) {
    const eventId = nestedValue(value, path)
    if (typeof eventId === 'string' && eventId.trim()) return eventId.trim()
  }
  return ''
}

export function extractUnifiedGrokEventId(value: Record<string, unknown>): string {
  for (const path of [
    ['event_id'],
    ['eventId'],
    ['id'],
    ['uuid'],
    ['ctx', 'event_id'],
    ['ctx', 'eventId'],
    ['ctx', 'id'],
    ['ctx', 'uuid'],
    ['ctx', 'request_id'],
  ]) {
    const eventId = nestedValue(value, path)
    if (typeof eventId === 'string' && eventId.trim()) return eventId.trim()
  }
  return ''
}

function nestedValue(source: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = source
  for (const key of path) {
    if (!isObject(current)) return undefined
    current = current[key]
  }
  return current
}

export function stableJsonHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').substring(0, 24)
}

export function grokCallTimestampMs(call: TokenUsageApiCall): number {
  const parsed = Date.parse(call.timestamp)
  return Number.isFinite(parsed) ? parsed : 0
}

export function appendGrokSignalsCall(
  agent: string,
  updatesFile: string,
  sessionId: string,
  fallbackModel: string,
  fallbackMtime: number,
  projectPath: string | undefined,
  context: ScannerScanContext,
  calls: TokenUsageApiCall[],
): void {
  const signalsFile = join(dirname(updatesFile), 'signals.json')
  if (!existsSync(signalsFile)) return
  let signals: unknown
  try {
    signals = JSON.parse(readFileSync(signalsFile, 'utf8'))
  } catch {
    return
  }
  if (!isObject(signals)) return

  const before = nonNegativeNumber(signals.totalTokensBeforeCompaction)
  const total = nonNegativeNumber(signals.totalTokens)
  const effectiveTotal =
    signals.contextTokensUsed === undefined
      ? before + total
      : Math.max(total, before + nonNegativeNumber(signals.contextTokensUsed))
  const coveredTotal = calls.reduce((sum, call) => sum + call.totalTokens, 0)
  const extra = effectiveTotal - coveredTotal
  if (extra <= 0) return

  const models = Array.isArray(signals.modelsUsed) ? signals.modelsUsed : []
  const model =
    (typeof signals.primaryModelId === 'string' && signals.primaryModelId.trim()) ||
    (typeof models[0] === 'string' && models[0].trim()) ||
    fallbackModel
  const latest = calls.reduce<TokenUsageApiCall | null>(
    (current, call) =>
      !current || grokCallTimestampMs(call) >= grokCallTimestampMs(current) ? call : current,
    null,
  )
  const call = createGrokCall(
    agent,
    `grok:${sessionId}:signals`,
    sessionId,
    model,
    latest?.timestamp || fallbackMtime,
    tokenBuckets({ inputTokens: extra }),
    projectPath,
  )
  if (isApiCallInWindow(call, context)) calls.push(call)
}

export function reconcileGrokSources(
  unifiedCalls: TokenUsageApiCall[],
  updateCalls: TokenUsageApiCall[],
): TokenUsageApiCall[] {
  const unified = deduplicateGrokCalls(unifiedCalls)
  const updates = deduplicateGrokCalls(updateCalls)
  const coverage = new Map<string, number>()
  for (const call of unified) {
    const key = grokCoverageKey(call)
    coverage.set(key, (coverage.get(key) ?? 0) + 1)
  }
  const unmatchedUpdates = updates.filter((call) => {
    const key = grokCoverageKey(call)
    const remaining = coverage.get(key) ?? 0
    if (remaining <= 0) return true
    coverage.set(key, remaining - 1)
    return false
  })
  return [...unified, ...unmatchedUpdates]
}

function grokCoverageKey(call: TokenUsageApiCall): string {
  // 两条数据链对同一次推理的分桶口径可能不同；会话与完成时间才是跨源锚点。
  // 用计数消费同一锚点，仍可保留同毫秒内确实存在的多次调用。
  return `${call.sessionId}|${grokCallTimestampMs(call)}`
}

function deduplicateGrokCalls(calls: TokenUsageApiCall[]): TokenUsageApiCall[] {
  const byId = new Map<string, TokenUsageApiCall>()
  for (const call of calls) byId.set(call.apiCallId, call)
  return [...byId.values()]
}

function nonNegativeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value))
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return Math.max(0, parsed)
  }
  return 0
}

export function firstNumber(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}

export function numberOrNegative(source: Record<string, unknown>, key: string): number {
  const value = source[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value === undefined || value === null) return 0
  return -1
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function listGrokUpdatesFiles(sessionsDir: string): string[] {
  const out: string[] = []
  if (!existsSync(sessionsDir)) return out
  const walk = (dir: string, isRoot = false): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      if (isRoot) throw new Error(`Grok sessions 目录不可读: ${(e as Error).message}`)
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name === 'updates.jsonl') out.push(full)
    }
  }
  walk(sessionsDir, true)
  return out.sort()
}
