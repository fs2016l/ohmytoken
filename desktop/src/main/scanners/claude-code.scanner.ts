/**
 * Claude Code Scanner（对应 Java ClaudeCodeScanner.java）
 *
 * 扫描 ~/.claude/projects 目录下所有 .jsonl，按 type==assistant 的 message.usage 聚合 token。
 * - Anthropic API 的 4 个 token 字段互斥：total = input + output + cacheRead + cacheWrite
 * - 按 message.id 去重（同一消息可能被多个 jsonl 引用）
 * - "<synthetic>" 模型、input/output 均为 0 的记录会被过滤
 * - 子代理转录缺最终 usage 时，用父线程 Agent 结果的末次 usage 补齐唯一对应调用的 output
 */
import { readdirSync, statSync } from 'fs'
import { basename, join, relative, sep } from 'path'
import type {
  AgentScanner,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
  ScannerScanContext,
} from './types'
import { readUtf8Lines } from '../lib/line-reader'
import { getClaudeDesktopSessionRoots, getClaudeProjectsDirCandidates } from '../lib/paths'
import { extractDate } from '../lib/date-utils'
import {
  applySessionTitles,
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  resolveRootSessionId,
  timestampsFromValue,
} from './detail-utils'
import { isApiCallInWindow, normalizeScanContext, shouldScanFile } from './incremental-utils'
import { extractProjectPath } from './project-path'
import { tokenBucketSum, tokenBuckets, type TokenBuckets } from './token-usage'
import { usageEvidence } from '../cost/usage-evidence'
import { conversationTurn, isUserPrompt, type ConversationTurn } from './conversation-turn'
import { LatestTurnTracker } from './latest-turn-tracker'
import { ClaudeResponseEstimator } from './claude-generation-timing'
import { readClaudeDesktopSessions } from './claude-desktop-sessions'
import { latestGeneration } from '../../shared/generation-timing'
import type { LatestGeneration } from '../../shared/models'
import { claimSourcePath } from './source-path'

export class ClaudeCodeScanner implements AgentScanner {
  readonly agentName = 'claude-code'
  private readonly projectsDir?: string
  private readonly desktopSessionRoots: () => readonly string[]

  constructor(
    projectsDir?: string,
    desktopSessionRoots: () => readonly string[] = getClaudeDesktopSessionRoots,
  ) {
    this.projectsDir = projectsDir
    this.desktopSessionRoots = desktopSessionRoots
  }

  isAvailable(): boolean {
    return this.projectRoots().some((dir) => isDirectory(dir) && listJsonlFiles(dir).length > 0)
  }

  private projectRoots(): readonly string[] {
    return this.projectsDir ? [this.projectsDir] : getClaudeProjectsDirCandidates()
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const latestTurns = new LatestTurnTracker()
    const scanContext = normalizeScanContext(context)
    const records: TokenUsageRecord[] = []
    const apiCalls: TokenUsageApiCall[] = []
    const visitedFiles = new Set<string>()
    const jsonlFiles = [...this.projectRoots()].reverse().flatMap((projectsDir) =>
      isDirectory(projectsDir)
        ? listJsonlFiles(projectsDir)
            .filter(
              (file) => claimSourcePath(visitedFiles, file) && shouldScanFile(file, scanContext),
            )
            .map((file) => ({ file, projectsDir }))
        : [],
    )

    const seenIds = new Map<string, TokenUsageApiCall>()
    const titleBySessionId = new Map<string, string>()
    // 客户端显示的标题：/rename 或桌面端生成的 custom-title 优先于 agent-name，同类取最后一次。
    const customTitleBySessionId = new Map<string, string>()
    const agentNameBySessionId = new Map<string, string>()
    const generationBySessionId = new Map<string, LatestGeneration>()
    // 旧版子代理转录常缺最终 usage 快照；父线程的 Agent 结果保留其末次响应的完整用量。
    const callsByAgentId = new Map<string, Set<TokenUsageApiCall>>()
    const agentFinalUsages = new Map<string, AgentFinalUsage[]>()

    for (const { file, projectsDir } of jsonlFiles) {
      // 子代理转录可能带自己的名称，不能覆盖主会话标题。
      const subagentFile = relative(projectsDir, file).split(sep).includes('subagents')
      const agentId = subagentFile ? agentIdFromFile(file) : ''
      const estimator = new ClaudeResponseEstimator()
      const fileApiCalls = new Set<TokenUsageApiCall>()
      let turn: ConversationTurn | undefined
      const messageTurns = new Map<string, ConversationTurn>()
      let fileScopedTitle = ''
      let fileScopedTitleFromSummary = false
      let explicitSessionId = ''
      let fileScopedProjectPath = ''
      try {
        for (const { line, lineIndex } of readUtf8Lines(file)) {
          const hasTokenUsage = line.includes('input_tokens') || line.includes('output_tokens')
          if (
            !hasTokenUsage &&
            !mayContainSessionTitle(line) &&
            !line.includes('"stop_reason"') &&
            !line.includes('"isApiErrorMessage"')
          ) {
            continue
          }
          let obj: unknown
          try {
            obj = JSON.parse(line)
          } catch {
            continue
          }
          if (!isObject(obj)) continue
          fileScopedProjectPath = fileScopedProjectPath || extractProjectPath(obj) || ''

          const sessionId = sessionIdFromObject(obj, file, projectsDir)
          estimator.observe(sessionId, obj)
          if (hasExplicitSessionId(obj) && !explicitSessionId) explicitSessionId = sessionId
          if (!subagentFile && obj.type === 'custom-title' && readString(obj.customTitle))
            customTitleBySessionId.set(sessionId, readString(obj.customTitle))
          if (!subagentFile && obj.type === 'agent-name' && readString(obj.agentName))
            agentNameBySessionId.set(sessionId, readString(obj.agentName))
          const title = extractClaudeTitle(obj)
          if (title) {
            if (hasExplicitSessionId(obj)) {
              setSessionTitle(titleBySessionId, sessionId, title, obj.type === 'summary')
            } else if (obj.type === 'summary' || !fileScopedTitle) {
              fileScopedTitle = title
              fileScopedTitleFromSummary = obj.type === 'summary'
            }
          }

          const realUserInput =
            obj.type === 'user' &&
            isObject(obj.message) &&
            isUserPrompt(obj.message.content) &&
            obj.isMeta !== true &&
            obj.isCompactSummary !== true
          if (realUserInput) {
            turn = conversationTurn(
              typeof obj.uuid === 'string' ? obj.uuid : `user:${lineIndex}`,
              obj.isSidechain !== true,
            )
            if (!subagentFile && turn?.userInitiated)
              latestTurns.start(sessionId, turn.id, obj.timestamp)
          }
          if (obj.type === 'user') collectAgentFinalUsage(agentFinalUsages, obj.toolUseResult)
          const ownerTurn =
            typeof obj.parentUuid === 'string' && !realUserInput
              ? (messageTurns.get(obj.parentUuid) ?? turn)
              : turn
          if (typeof obj.uuid === 'string' && ownerTurn) messageTurns.set(obj.uuid, ownerTurn)
          if (obj.type !== 'assistant') continue

          const msg = obj.message
          if (!isObject(msg)) continue
          if (!subagentFile && ownerTurn?.userInitiated) {
            if (obj.isApiErrorMessage === true || obj.error !== undefined)
              latestTurns.finish(sessionId, 'failed', obj.timestamp, ownerTurn?.id)
            else if (['end_turn', 'stop_sequence', 'refusal'].includes(String(msg.stop_reason)))
              latestTurns.finish(sessionId, 'completed', obj.timestamp, ownerTurn?.id)
            else if (
              msg.stop_reason === 'max_tokens' ||
              msg.stop_reason === 'model_context_window_exceeded'
            )
              latestTurns.finish(sessionId, 'interrupted', obj.timestamp, ownerTurn?.id)
            else if (msg.stop_reason === 'pause_turn')
              latestTurns.finish(sessionId, 'waiting', obj.timestamp, ownerTurn?.id)
          }
          const usage = msg.usage
          if (!isObject(usage)) continue

          const model: string = typeof msg.model === 'string' ? msg.model : 'unknown'
          if (model === '<synthetic>') continue

          const buckets = tokenBuckets({
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.cache_read_input_tokens,
            cacheWriteTokens: usage.cache_creation_input_tokens,
          })
          if (buckets.totalTokens === 0) continue

          const rawTimestamp =
            typeof obj.timestamp === 'string' || typeof obj.timestamp === 'number'
              ? obj.timestamp
              : undefined
          const messageCreatedAt = typeof msg.created_at === 'string' ? msg.created_at : undefined
          const fallbackDate = extractDate(rawTimestamp, messageCreatedAt)
          const { timestamp, rawTimestamp: sourceTimestamp } = timestampsFromValue(
            rawTimestamp ?? messageCreatedAt,
            fallbackDate,
          )
          const msgId: string = typeof msg.id === 'string' ? msg.id : ''
          const apiCallId = msgId || `${sessionId}:${lineIndex}`

          const apiCall: TokenUsageApiCall = {
            turn: ownerTurn,
            agent: this.agentName,
            apiCallId,
            sessionId,
            ...(fileScopedProjectPath ? { projectPath: fileScopedProjectPath } : {}),
            date: dateFromTimestamp(timestamp, fallbackDate),
            rawTimestamp: sourceTimestamp,
            timestamp,
            hour: hourFromTimestamp(timestamp),
            model,
            // Anthropic API 的四个字段是互斥分桶。
            evidence: usageEvidence({
              cache5m: isObject(usage.cache_creation)
                ? usage.cache_creation.ephemeral_5m_input_tokens
                : undefined,
              cache1h: isObject(usage.cache_creation)
                ? usage.cache_creation.ephemeral_1h_input_tokens
                : undefined,
            }),
            ...buckets,
          }
          // 大型活跃 JSONL 仍需从头流式读取以提取标题与稳定行号，但窗口外明细
          // 在解析当下就丢弃，避免先构造整段历史 API 数组再二次过滤。
          if (!isApiCallInWindow(apiCall, scanContext)) continue

          // 只让窗口内调用参与去重；否则同 ID 的窗口外历史副本可能先占位，
          // 错误压掉后续窗口内的更新副本。
          if (msgId) {
            const existing = seenIds.get(msgId)
            if (existing) {
              mergeClaudeDuplicate(existing, apiCall)
              fileApiCalls.add(existing)
              continue
            }
            seenIds.set(msgId, apiCall)
          }
          apiCalls.push(apiCall)
          fileApiCalls.add(apiCall)
        }
      } catch (e) {
        throw new Error(`Claude Code 会话文件不可读 (${file}): ${(e as Error).message}`)
      }
      if (agentId && fileApiCalls.size) {
        const agentCalls = callsByAgentId.get(agentId) ?? new Set<TokenUsageApiCall>()
        for (const call of fileApiCalls) agentCalls.add(call)
        callsByAgentId.set(agentId, agentCalls)
      }
      // 计时独立于用量窗口；晚写完的消息可补样本而不重播旧 API。
      for (const call of fileApiCalls) {
        const timing = estimator.timingFor(call.sessionId, call.apiCallId)
        if (
          timing &&
          (!call.generationTiming || timing.completedAtMs >= call.generationTiming.completedAtMs)
        )
          call.generationTiming = timing
      }
      for (const sample of estimator.latest())
        generationBySessionId.set(
          sample.sessionId,
          latestGeneration(generationBySessionId.get(sample.sessionId), sample)!,
        )
      if (fileScopedTitle) {
        const fallbackSessionId = relative(projectsDir, file).split(sep).join('/')
        setSessionTitle(
          titleBySessionId,
          explicitSessionId || fallbackSessionId,
          fileScopedTitle,
          fileScopedTitleFromSummary,
        )
      }
    }

    recoverAgentFinalUsage(callsByAgentId, agentFinalUsages)

    // 桌面端侧边会话有独立 JSONL，父会话关系与侧栏标题只保存在桌面端元数据中。
    const desktopSessions = readClaudeDesktopSessions(this.desktopSessionRoots())
    const parentBySessionId = new Map<string, string>()
    for (const [sessionId, info] of desktopSessions)
      if (info.parentSessionId) parentBySessionId.set(sessionId, info.parentSessionId)
    for (const call of apiCalls) {
      const parentSessionId = parentBySessionId.get(call.sessionId)
      if (!parentSessionId) continue
      call.parentSessionId = parentSessionId
      call.rootSessionId = resolveRootSessionId(call.sessionId, parentBySessionId)
    }
    for (const [sessionId, title] of agentNameBySessionId) titleBySessionId.set(sessionId, title)
    for (const [sessionId, title] of customTitleBySessionId) titleBySessionId.set(sessionId, title)
    for (const [sessionId, info] of desktopSessions)
      if (info.title) titleBySessionId.set(sessionId, info.title)
    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    applySessionTitles(sessions, titleBySessionId)
    for (const session of sessions)
      session.latestGeneration = generationBySessionId.get(session.sessionId)
    records.push(...buildRecordsFromSessions(this.agentName, sessions))

    return {
      records,
      sessions,
      apiCalls,
      latestGenerations: [...generationBySessionId.values()],
      latestTurns: latestTurns.values(),
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

/** Claude 流式写入会为同一 message.id 保存多个逐步增长的 usage 快照。 */
function mergeClaudeDuplicate(kept: TokenUsageApiCall, incoming: TokenUsageApiCall): void {
  kept.turn ??= incoming.turn
  const keptTotal = kept.totalTokens
  const incomingTotal = incoming.totalTokens
  kept.inputTokens = Math.max(kept.inputTokens, incoming.inputTokens)
  kept.outputTokens = Math.max(kept.outputTokens, incoming.outputTokens)
  kept.cacheReadTokens = Math.max(kept.cacheReadTokens, incoming.cacheReadTokens)
  kept.cacheWriteTokens = Math.max(kept.cacheWriteTokens, incoming.cacheWriteTokens)
  kept.reasoningTokens = Math.max(kept.reasoningTokens, incoming.reasoningTokens)
  kept.totalTokens =
    kept.inputTokens +
    kept.outputTokens +
    kept.cacheReadTokens +
    kept.cacheWriteTokens +
    kept.reasoningTokens
  if (
    incomingTotal > keptTotal ||
    (incomingTotal === keptTotal && incoming.timestamp > kept.timestamp)
  ) {
    kept.date = incoming.date
    kept.rawTimestamp = incoming.rawTimestamp
    kept.timestamp = incoming.timestamp
    kept.hour = incoming.hour
    kept.model = incoming.model
    kept.evidence = incoming.evidence
    kept.projectPath = incoming.projectPath || kept.projectPath
  }
}

interface AgentFinalUsage {
  model: string
  buckets: TokenBuckets
}

function agentIdFromFile(file: string): string {
  return /^agent-(.+)\.jsonl$/.exec(basename(file))?.[1] ?? ''
}

/** Agent 工具结果里的 usage 只是子代理末次响应，不是整个子代理的累计用量。 */
function collectAgentFinalUsage(target: Map<string, AgentFinalUsage[]>, result: unknown): void {
  if (!isObject(result) || !isObject(result.usage)) return
  const agentId = readString(result.agentId)
  if (!agentId) return
  const usage = result.usage
  const buckets = tokenBuckets({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
  })
  if (buckets.outputTokens === 0) return
  const model = readString(result.resolvedModel)
  const usages = target.get(agentId) ?? []
  // fork 会复制父转录中的同一结果；继续运行的同一子代理则会产生新的末次响应。
  if (
    !usages.some(
      (item) =>
        item.model === model &&
        item.buckets.inputTokens === buckets.inputTokens &&
        item.buckets.outputTokens === buckets.outputTokens &&
        item.buckets.cacheReadTokens === buckets.cacheReadTokens &&
        item.buckets.cacheWriteTokens === buckets.cacheWriteTokens,
    )
  )
    usages.push({ model, buckets })
  target.set(agentId, usages)
}

/**
 * 只补 output：同一子代理内模型与其余三桶唯一相等的调用才认定为同一次响应，
 * 有歧义或无法对应时保持转录原值。
 */
function recoverAgentFinalUsage(
  callsByAgentId: Map<string, Set<TokenUsageApiCall>>,
  agentFinalUsages: Map<string, AgentFinalUsage[]>,
): void {
  for (const [agentId, usages] of agentFinalUsages) {
    const calls = callsByAgentId.get(agentId)
    if (!calls) continue
    for (const { model, buckets } of usages) {
      const matches = [...calls].filter(
        (call) =>
          (!model || call.model === model) &&
          call.inputTokens === buckets.inputTokens &&
          call.cacheReadTokens === buckets.cacheReadTokens &&
          call.cacheWriteTokens === buckets.cacheWriteTokens,
      )
      if (matches.length !== 1 || matches[0].outputTokens >= buckets.outputTokens) continue
      matches[0].outputTokens = buckets.outputTokens
      matches[0].totalTokens = tokenBucketSum(matches[0])
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sessionIdFromObject(
  obj: Record<string, unknown>,
  file: string,
  projectsDir: string,
): string {
  return hasExplicitSessionId(obj)
    ? (obj.sessionId as string)
    : relative(projectsDir, file).split(sep).join('/')
}

function hasExplicitSessionId(obj: Record<string, unknown>): boolean {
  return typeof obj.sessionId === 'string' && obj.sessionId.length > 0
}

function mayContainSessionTitle(line: string): boolean {
  return (
    line.includes('"summary"') ||
    line.includes('"lastPrompt"') ||
    line.includes('"type":"user"') ||
    line.includes('"type": "user"') ||
    line.includes('"type":"last-prompt"') ||
    line.includes('"type": "last-prompt"') ||
    line.includes('"customTitle"') ||
    line.includes('"agentName"')
  )
}

function extractClaudeTitle(obj: Record<string, unknown>): string {
  if (obj.type === 'summary') return readString(obj.summary)
  if (obj.type === 'last-prompt') return readString(obj.lastPrompt) || readString(obj.content)

  const msg = isObject(obj.message) ? obj.message : null
  const isUserMessage = obj.type === 'user' || msg?.role === 'user'
  if (!isUserMessage || msg === null) return ''
  return textFromContent(msg.content)
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!Array.isArray(value)) return ''
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) return item.trim()
    if (isObject(item) && typeof item.text === 'string' && item.text.trim()) return item.text.trim()
  }
  return ''
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function setSessionTitle(
  titleBySessionId: Map<string, string>,
  sessionId: string,
  title: string,
  replace = false,
): void {
  if (!title || (!replace && titleBySessionId.has(sessionId))) return
  titleBySessionId.set(sessionId, title)
}

/** 递归收集目录下所有 .jsonl 文件（按路径排序，保证遍历顺序稳定） */
function listJsonlFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, isRoot = false): void => {
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      const scope = isRoot ? 'projects 目录' : `子目录 (${dir})`
      throw new Error(`Claude Code ${scope}不可读: ${(e as Error).message}`)
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        out.push(full)
      }
    }
  }
  walk(root, true)
  // 用平台分隔符排序，与 Java Path 自然顺序对齐
  return out.sort((a, b) => a.split(sep).join('/').localeCompare(b.split(sep).join('/')))
}
