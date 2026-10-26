/** 读取 Qwen Code 转录并生成统一用量记录。 */
import { readdirSync, statSync } from 'fs'
import { basename, dirname, join, relative, sep } from 'path'
import type { Dirent } from 'fs'
import { usageEvidence } from '../cost/usage-evidence'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'
import { getQwenProjectsDirCandidates } from '../lib/paths'
import { readUtf8Lines } from '../lib/line-reader'
import {
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  timestampsFromValue,
} from './detail-utils'
import {
  isApiCallInWindow,
  isIncrementalContext,
  normalizeScanContext,
  shouldScanFile,
} from './incremental-utils'
import { normalizeGeminiStyleUsage, type ExclusiveTokenUsage } from './gemini-style-usage'
import { conversationTurn, isUserPrompt, type ConversationTurn } from './conversation-turn'
import { LatestTurnTracker, turnStatusFromReason } from './latest-turn-tracker'
import { createProjectPathLookup } from './project-metadata'
import { extractProjectPath } from './project-path'
import { QwenGenerationTiming, type QwenTimingCandidate } from './qwen-generation-timing'
import { claimSourcePath } from './source-path'

export class QwenScanner implements AgentScanner {
  private readonly latestTurns = new LatestTurnTracker()
  readonly agentName = 'qwen'
  private readonly projectDirs: (projects?: readonly string[]) => readonly string[]

  constructor(
    projectDirs: (projects?: readonly string[]) => readonly string[] = getQwenProjectsDirCandidates,
  ) {
    this.projectDirs = projectDirs
  }

  isAvailable(): boolean {
    return this.projectDirs().some((dir) => isDirectory(dir) && listQwenJsonlFiles(dir).length > 0)
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    this.latestTurns.clear()
    const scanContext = normalizeScanContext(context)
    const records: TokenUsageRecord[] = []
    const apiCalls: TokenUsageApiCall[] = []
    const messageIdentities = new Map<TokenUsageApiCall, string>()
    const visitedFiles = new Set<string>()
    const pending = [...this.projectDirs()].reverse()
    const visited = new Set<string>()
    const projects = new Set<string>()
    for (const projectsDir of pending) {
      if (visited.has(projectsDir)) continue
      visited.add(projectsDir)
      if (!isDirectory(projectsDir)) continue
      const projectPathFor = createProjectPathLookup(dirname(projectsDir))
      for (const file of listQwenJsonlFiles(projectsDir)) {
        if (!claimSourcePath(visitedFiles, file)) continue
        if (!shouldScanFile(file, scanContext)) continue
        try {
          this.parseFile(
            file,
            projectsDir,
            scanContext,
            apiCalls,
            projectPathFor(file),
            (project) => projects.add(project),
            messageIdentities,
          )
        } catch (e) {
          throw new Error(`Qwen 会话文件不可读 (${file}): ${(e as Error).message}`)
        }
      }
      for (const call of apiCalls) if (call.projectPath) projects.add(call.projectPath)
      for (const candidate of this.projectDirs([...projects]))
        if (!visited.has(candidate)) pending.push(candidate)
    }

    if (this.projectDirs === getQwenProjectsDirCandidates)
      getQwenProjectsDirCandidates([...projects], true)
    deduplicateQwenCalls(apiCalls, messageIdentities)

    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    records.push(...buildRecordsFromSessions(this.agentName, sessions))
    return { records, sessions, apiCalls, latestTurns: this.latestTurns.values() }
  }

  private parseFile(
    file: string,
    projectsDir: string,
    context: ScannerScanContext,
    apiCalls: TokenUsageApiCall[],
    projectPath?: string,
    observeProject?: (path: string) => void,
    messageIdentities?: Map<TokenUsageApiCall, string>,
  ): void {
    const fallbackSessionId = qwenPathSessionId(file, projectsDir)
    let fallbackMtime = 0
    try {
      fallbackMtime = statSync(file).mtimeMs
    } catch {
      fallbackMtime = 0
    }
    let messageIndex = 0
    let turn: ConversationTurn | undefined
    let currentPromptId: unknown
    const timings = new QwenGenerationTiming()
    const candidates: QwenTimingCandidate[] = []
    if (projectPath) observeProject?.(projectPath)

    for (const { line, lineIndex } of readUtf8Lines(file)) {
      if (!line) continue
      let obj: unknown
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      if (!isObject(obj)) continue
      timings.record(obj, fallbackSessionId)
      projectPath = extractProjectPath(obj) ?? projectPath
      if (projectPath) observeProject?.(projectPath)
      if (obj.type === 'user' && isObject(obj.message) && isUserPrompt(obj.message.parts)) {
        if (!obj.provenance || obj.provenance === 'real_user') {
          turn = conversationTurn(obj.uuid ?? `user:${lineIndex}`, obj.isSidechain !== true)
          currentPromptId = obj.promptId
          if (turn?.userInitiated)
            this.latestTurns.start(
              typeof obj.sessionId === 'string' ? obj.sessionId : fallbackSessionId,
              turn.id,
              obj.timestamp,
              typeof currentPromptId === 'string',
            )
        }
      }
      if (obj.type === 'system' && obj.subtype === 'turn_result' && isObject(obj.systemPayload)) {
        const payload = obj.systemPayload
        const status = turnStatusFromReason(payload.state)
        if (
          status &&
          turn?.userInitiated &&
          currentPromptId &&
          payload.promptId === currentPromptId
        )
          this.latestTurns.finish(
            typeof obj.sessionId === 'string' ? obj.sessionId : fallbackSessionId,
            status,
            payload.endedAt,
            turn?.id,
          )
      }
      if (obj.type !== 'assistant') continue
      const usageMetadata = obj.usageMetadata
      if (!isObject(usageMetadata)) continue

      // Qwen 的 cache 是 prompt 子集；不同后端对 candidates 是否包含 thoughts 的
      // 口径不一致，因此必须使用 totalTokenCount 锚定后再拆成互斥分桶。
      const usage = normalizeGeminiStyleUsage({
        input: tokenValue(usageMetadata, ['promptTokenCount', 'prompt_tokens', 'input']),
        output: tokenValue(usageMetadata, ['candidatesTokenCount', 'completion_tokens', 'output']),
        cached: tokenValue(usageMetadata, ['cachedContentTokenCount', 'cached_tokens', 'cached']),
        thoughts: tokenValue(usageMetadata, ['thoughtsTokenCount', 'thoughts_tokens', 'thoughts']),
        // toolUsePromptTokenCount 是 prompt 的组成明细；官方 total 也只按
        // prompt + thoughts + candidates 计算，不能再把它作为额外输入累加。
        tool: 0,
        reportedTotal: tokenValue(usageMetadata, ['totalTokenCount', 'total_tokens', 'total']),
        inputIncludesCache: true,
        outputIncludesThoughts: true,
      })
      if (!usage) continue

      const sessionId =
        (typeof obj.sessionId === 'string' && obj.sessionId.trim()) || fallbackSessionId
      const model = typeof obj.model === 'string' && obj.model.trim() ? obj.model.trim() : 'unknown'
      const timestampValue =
        typeof obj.timestamp === 'string' && obj.timestamp
          ? obj.timestamp
          : typeof obj.timestamp === 'number' && Number.isFinite(obj.timestamp) && obj.timestamp > 0
            ? obj.timestamp
            : fallbackMtime

      const call = qwenApiCall(
        this.agentName,
        `qwen:${sessionId}:${messageIndex}`,
        sessionId,
        model,
        timestampValue,
        usage,
        turn,
        projectPath,
      )
      if (typeof obj.uuid === 'string' && obj.uuid) messageIdentities?.set(call, obj.uuid)
      candidates.push({
        call,
        parentUuid: typeof obj.parentUuid === 'string' ? obj.parentUuid : '',
      })
      messageIndex += 1
    }
    timings.apply(candidates)
    for (const { call } of candidates) {
      if (
        isApiCallInWindow(call, context) ||
        (isIncrementalContext(context) &&
          call.generationTiming &&
          call.generationTiming.completedAtMs >= context.sinceMs)
      )
        apiCalls.push(call)
    }
  }
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** 同一会话的迁移副本沿用原调用身份；有歧义的尾部分支不能静默覆盖。 */
function deduplicateQwenCalls(
  calls: TokenUsageApiCall[],
  identities: Map<TokenUsageApiCall, string>,
): void {
  const byId = new Map<string, TokenUsageApiCall>()
  const byMessage = new Map<string, string>()
  for (const call of calls) {
    const previous = byId.get(call.apiCallId)
    const uuid = identities.get(call)
    const previousUuid = previous && identities.get(previous)
    if (uuid) {
      const messageKey = JSON.stringify([call.sessionId, uuid])
      const previousId = byMessage.get(messageKey)
      if (previousId && previousId !== call.apiCallId)
        throw new Error(`Qwen 同一消息的调用序号发生变化，已中止扫描: ${call.apiCallId}`)
      byMessage.set(messageKey, call.apiCallId)
    }
    if (
      previous &&
      ((uuid && previousUuid && uuid !== previousUuid) ||
        [
          'model',
          'timestamp',
          'inputTokens',
          'outputTokens',
          'cacheReadTokens',
          'cacheWriteTokens',
          'reasoningTokens',
          'totalTokens',
        ].some((key) => previous[key] !== call[key]))
    )
      throw new Error(`Qwen 同一调用存在不同转录，已中止扫描: ${call.apiCallId}`)
    byId.set(call.apiCallId, call)
  }
  calls.length = 0
  for (const call of byId.values()) calls.push(call)
}

function qwenApiCall(
  agentName: string,
  apiCallId: string,
  sessionId: string,
  model: string,
  timestampValue: string | number,
  usage: ExclusiveTokenUsage,
  turn?: ConversationTurn,
  projectPath?: string,
): TokenUsageApiCall {
  const { timestamp, rawTimestamp } = timestampsFromValue(timestampValue, 'unknown')
  const apiCall: TokenUsageApiCall = {
    ...(projectPath ? { projectPath } : {}),
    turn,
    agent: agentName,
    apiCallId,
    sessionId,
    date: dateFromTimestamp(timestamp, 'unknown'),
    rawTimestamp,
    timestamp,
    hour: hourFromTimestamp(timestamp),
    model,
    inputTokens: usage.inputTokens,
    evidence: usageEvidence({ bucketQuality: usage.bucketQuality }),
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens,
  }
  return apiCall
}

/** 生成会话标识；优先采用记录内提供的 ID。 */
function qwenPathSessionId(file: string, projectsDir: string): string {
  const parts = relative(projectsDir, file).split(sep)
  const stem = basename(file).replace(/\.jsonl$/i, '')
  const project = parts.length >= 3 ? parts[parts.length - 3] : ''
  return project ? `${project}-${stem}` : stem
}

function tokenValue(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function listQwenJsonlFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      throw new Error(`Qwen projects 目录不可读 (${dir}): ${(e as Error).message}`)
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full)
    }
  }
  walk(root)
  return out.sort()
}
