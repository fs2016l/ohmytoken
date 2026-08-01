import { existsSync, readdirSync } from 'fs'
import type { Dirent } from 'fs'
import { join, relative, sep } from 'path'
import type { ScannerScanContext, TokenUsageApiCall } from './types'
import { getWorkBuddyProjectsDir } from '../lib/paths'
import { readUtf8Lines } from '../lib/line-reader'
import { dateFromTimestamp, hourFromTimestamp, timestampsFromValue } from './detail-utils'
import {
  isApiCallInWindow,
  isIncrementalContext,
  normalizeScanContext,
  shouldScanFile,
} from './incremental-utils'
import { parseWorkBuddyProviderUsage } from './workbuddy-usage'

export interface WorkBuddySessionInfo {
  date: string
  model: string
}

interface ProjectPathInfo {
  sessionId: string | null
  parentSessionId: string | null
  rootSessionId: string | null
  subAgentName: string | null
}

export interface WorkBuddyProjectScanResult {
  apiCalls: TokenUsageApiCall[]
  /** 根会话级来源仲裁：存在 project 明细的根不能再混入 trace 聚合。 */
  coveredRootSessionIds: Set<string>
}

export function loadWorkBuddyProjectApiCalls(
  agentName: string,
  sessions: ReadonlyMap<string, WorkBuddySessionInfo>,
  context?: ScannerScanContext,
): TokenUsageApiCall[] {
  return loadWorkBuddyProjectScan(agentName, sessions, context).apiCalls
}

export function loadWorkBuddyProjectScan(
  agentName: string,
  sessions: ReadonlyMap<string, WorkBuddySessionInfo>,
  context?: ScannerScanContext,
): WorkBuddyProjectScanResult {
  const projectsDir = getWorkBuddyProjectsDir()
  if (!existsSync(projectsDir)) return { apiCalls: [], coveredRootSessionIds: new Set() }

  const scanContext = normalizeScanContext(context)
  const apiCalls: TokenUsageApiCall[] = []
  const coveredRootSessionIds = new Set<string>()
  for (const jsonlFile of listFiles(projectsDir, '.jsonl').sort()) {
    // 增量模式不读取窗口外文件，但仍可从路径识别其根会话来源，避免同根 trace
    // 在 project 文件未变化时被误当成新增明细。
    if (isIncrementalContext(scanContext)) {
      const rootSessionId = projectPathInfo(projectsDir, jsonlFile).rootSessionId
      if (rootSessionId) coveredRootSessionIds.add(rootSessionId)
    }
    if (!shouldScanFile(jsonlFile, scanContext)) continue
    apiCalls.push(
      ...parseProjectJsonlFile(agentName, projectsDir, jsonlFile, sessions, scanContext),
    )
  }
  const deduplicated = deduplicateApiCalls(apiCalls)
  for (const apiCall of deduplicated) {
    coveredRootSessionIds.add(apiCall.rootSessionId ?? apiCall.sessionId)
  }
  return { apiCalls: deduplicated, coveredRootSessionIds }
}

export function normalizeWorkBuddyModel(model: string): string {
  return model.startsWith('custom-local:') ? model.substring('custom-local:'.length) : model
}

function parseProjectJsonlFile(
  agentName: string,
  projectsDir: string,
  jsonlFile: string,
  sessions: ReadonlyMap<string, WorkBuddySessionInfo>,
  context: ScannerScanContext,
): TokenUsageApiCall[] {
  const pathInfo = projectPathInfo(projectsDir, jsonlFile)
  const apiCalls: TokenUsageApiCall[] = []
  const relativeFile = relative(projectsDir, jsonlFile).split(sep).join('/')
  try {
    for (const { line, lineIndex } of readUtf8Lines(jsonlFile)) {
      const apiCall = parseProjectJsonlLine({
        agentName,
        relativeFile,
        index: lineIndex,
        line,
        pathInfo,
        sessions,
      })
      if (apiCall && isApiCallInWindow(apiCall, context)) apiCalls.push(apiCall)
    }
  } catch (e) {
    throw new Error(`WorkBuddy project 文件不可读 (${jsonlFile}): ${(e as Error).message}`)
  }
  return apiCalls
}

function parseProjectJsonlLine(params: {
  agentName: string
  relativeFile: string
  index: number
  line: string
  pathInfo: ProjectPathInfo
  sessions: ReadonlyMap<string, WorkBuddySessionInfo>
}): TokenUsageApiCall | null {
  const line = params.line.trim()
  if (!line) return null

  let root: unknown
  try {
    root = JSON.parse(line)
  } catch {
    return null
  }
  if (!isObject(root)) return null

  const providerData = objectValue(root.providerData)
  if (providerData === null) return null

  const usage = parseWorkBuddyProviderUsage(providerData)
  if (usage === null) return null

  const sessionId = jsonlSessionId(root, params.pathInfo, params.relativeFile, params.index)
  const sessionInfo = params.sessions.get(sessionId) ?? null
  const fallbackDate = sessionInfo?.date ?? 'unknown'
  const { timestamp, rawTimestamp } = timestampsFromValue(root.timestamp, fallbackDate)
  const date = dateFromTimestamp(timestamp, fallbackDate)
  if (date === 'unknown') return null

  const model = normalizeWorkBuddyModel(
    firstString(
      providerData.model,
      providerData.requestModelName,
      providerData.requestModelId,
      sessionInfo?.model,
    ) ?? 'unknown',
  )
  const rootSessionId = params.pathInfo.rootSessionId ?? sessionId
  const apiCall: TokenUsageApiCall = {
    agent: params.agentName,
    apiCallId: sourceApiCallId(
      params.agentName,
      sessionId,
      root,
      providerData,
      params.relativeFile,
      params.index,
    ),
    sessionId,
    date,
    rawTimestamp,
    timestamp,
    hour: hourFromTimestamp(timestamp),
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens,
  }
  const parentSessionId = params.pathInfo.parentSessionId ?? undefined
  if (parentSessionId && parentSessionId !== sessionId) apiCall.parentSessionId = parentSessionId
  if (rootSessionId !== sessionId || parentSessionId) apiCall.rootSessionId = rootSessionId
  if (params.pathInfo.subAgentName) apiCall.subAgentName = params.pathInfo.subAgentName
  const role = firstString(root.role, root.type)
  if (role) apiCall.role = role
  return apiCall
}

function sourceApiCallId(
  agentName: string,
  sessionId: string,
  root: Record<string, unknown>,
  providerData: Record<string, unknown>,
  relativeFile: string,
  index: number,
): string {
  const sourceId =
    firstString(providerData.messageId, providerData.traceId, root.traceId, root.id) ??
    `${relativeFile}:${index + 1}`
  return `${agentName}:${sessionId}:${sourceId}`
}

function deduplicateApiCalls(apiCalls: TokenUsageApiCall[]): TokenUsageApiCall[] {
  const byId = new Map<string, TokenUsageApiCall>()
  for (const apiCall of apiCalls) {
    const current = byId.get(apiCall.apiCallId)
    if (!current || isPreferredApiCall(apiCall, current)) byId.set(apiCall.apiCallId, apiCall)
  }
  return [...byId.values()]
}

function isPreferredApiCall(candidate: TokenUsageApiCall, current: TokenUsageApiCall): boolean {
  const candidateCompleteness = usageCompleteness(candidate)
  const currentCompleteness = usageCompleteness(current)
  if (candidateCompleteness !== currentCompleteness) {
    return candidateCompleteness > currentCompleteness
  }
  if (candidate.totalTokens !== current.totalTokens) {
    return candidate.totalTokens > current.totalTokens
  }
  return apiCallSignature(candidate) > apiCallSignature(current)
}

function usageCompleteness(apiCall: TokenUsageApiCall): number {
  return [
    apiCall.inputTokens,
    apiCall.outputTokens,
    apiCall.cacheReadTokens,
    apiCall.cacheWriteTokens,
    apiCall.reasoningTokens,
  ].filter((value) => value > 0).length
}

function apiCallSignature(apiCall: TokenUsageApiCall): string {
  return [
    apiCall.timestamp,
    apiCall.sessionId,
    apiCall.model,
    apiCall.inputTokens,
    apiCall.outputTokens,
    apiCall.cacheReadTokens,
    apiCall.cacheWriteTokens,
    apiCall.reasoningTokens,
  ].join('\u0000')
}

function jsonlSessionId(
  root: Record<string, unknown>,
  pathInfo: ProjectPathInfo,
  relativeFile: string,
  index: number,
): string {
  if (pathInfo.subAgentName && pathInfo.sessionId) return pathInfo.sessionId
  return (
    stringValue(root.sessionId) ?? pathInfo.sessionId ?? `aggregate:${relativeFile}:${index + 1}`
  )
}

function listFiles(root: string, extension: string): string[] {
  const files: string[] = []
  let entries: Dirent[] = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch (e) {
    throw new Error(`WorkBuddy projects 目录不可读 (${root}): ${(e as Error).message}`)
  }

  for (const entry of entries) {
    const fullPath = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath, extension))
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(fullPath)
    }
  }
  return files
}

function projectPathInfo(projectsDir: string, file: string): ProjectPathInfo {
  const parts = relative(projectsDir, file).split(sep)
  const empty: ProjectPathInfo = {
    sessionId: null,
    parentSessionId: null,
    rootSessionId: null,
    subAgentName: null,
  }
  if (parts.length < 2) return empty

  const second = parts[1]
  if (second.endsWith('.jsonl')) {
    const sessionId = second.substring(0, second.length - '.jsonl'.length)
    return { ...empty, sessionId, rootSessionId: sessionId }
  }

  const rootSessionId = second || null
  const fileName = parts[parts.length - 1] ?? ''
  const subAgentName = fileName.endsWith('.jsonl')
    ? fileName.substring(0, fileName.length - '.jsonl'.length)
    : null
  const sessionId =
    rootSessionId && subAgentName ? `${rootSessionId}:${subAgentName}` : rootSessionId
  return {
    sessionId,
    parentSessionId: rootSessionId,
    rootSessionId,
    subAgentName,
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = stringValue(value)
    if (text) return text
  }
  return null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
