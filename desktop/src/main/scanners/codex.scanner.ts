/**
 * Codex Scanner（对应 Codex 本地 rollout/thread-store 数据结构）
 *
 * 会话索引优先读取 Codex SQLite 状态库的 threads 表，逐 API/token 明细仍解析
 * rollout JSONL 中的 event_msg:token_count。状态库只保存会话级累计值，不能直接
 * 当作 API 明细或日聚合事实源。
 *
 * 落库前会把 input/cache 与 output/reasoning 拆成互斥分桶，
 * totalTokens 始终由五个内部分项求和。
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'fs'
import { createHash } from 'crypto'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'path'
import type { Dirent } from 'fs'
import Database from 'better-sqlite3'
import type {
  AgentScanner,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
  TokenUsageSession,
  ScannerScanContext,
} from './types'
import { readByteSnippet, readUtf8Lines } from '../lib/line-reader'
import { timestampEpochMs } from '../lib/date-utils'
import {
  getCodexArchivedSessionsDir,
  getCodexCleanupArchiveDir,
  getCodexHomeDir,
  getCodexSessionIndexFile,
  getCodexSessionsDir,
  getCodexStateDbCandidates,
} from '../lib/paths'
import {
  applySessionTitles,
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  timestampFromValue,
  timestampsFromValue,
} from './detail-utils'
import {
  addCodexUsage,
  assertCodexCumulativeMatches,
  codexUsageSum,
  codexUsageSignature,
  emptyCodexUsage,
  hasTokenUsage,
  normalizeCodexUsageExclusive,
  readCodexUsage,
  subtractCodexUsage,
  type CodexUsageSnapshot,
} from './codex-usage'
import {
  applyCodexSessionRelations,
  readCodexSessionRelation,
  type CodexSessionRelation,
} from './codex-session-relation'
import {
  isApiCallInWindow,
  isIncrementalContext,
  normalizeScanContext,
  shouldScanFile,
} from './incremental-utils'
import { extractProjectPath } from './project-path'
import {
  getSourceStatesByType,
  type ScanSourceStateRow,
  type ScanSourceStateUpdate,
} from '../services/scan-source-state.service'

type DbValue = number | string | bigint | Uint8Array | null

interface CodexThreadMeta {
  sessionId: string
  rolloutPath: string
  title: string
  model: string
  createdAt: number
  updatedAt: number
}

interface ParseContext {
  sessionFile: string
  rootDir: string
  fallbackDate: string
  sessionId?: string
  title?: string
  model?: string
}

interface ParsedCodexSession extends CodexSessionRelation {
  sessionId: string
  title: string
  apiCalls: TokenUsageApiCall[]
}

interface CodexParserCheckpointState {
  sessionId: string
  sessionMetaSeen: boolean
  copiedSessionMetaSeen: boolean
  currentModel: string
  sessionDate: string
  sessionTitle: string
  projectPath: string
  parentSessionId: string
  forkedFromSessionId: string
  historyMode: string
  subAgentHistoryStartOrdinal: number | null
  subAgentName: string
  isThreadSpawnSubAgent: boolean
  subAgentBoundaryApplied: boolean
  previousAcceptedCumulative: string
  previousCumulativeSum: number
  previousCumulative: CodexUsageSnapshot | null
  cumulativeSegmentBaseline: CodexUsageSnapshot
  completedCumulative: CodexUsageSnapshot
  acceptedUsage: CodexUsageSnapshot
  inheritedCumulativeBaseline: CodexUsageSnapshot | null
  lastEventMs: number
}

interface CodexParserCheckpoint {
  offset: number
  prefix: string
  state: CodexParserCheckpointState
}

interface CodexFileCursor {
  version: 4
  endOffset: number
  checkpoints: CodexParserCheckpoint[]
  smallPrefixHash?: string
}

interface PendingCursorCommit {
  sourceId: string
  filePath: string
  size: number
  mtimeMs: number
  eventWatermarkMs: number
  cursor: CodexFileCursor
}

const CODEX_CHECKPOINT_BYTES = 4 * 1024 * 1024
const CODEX_MAX_CHECKPOINTS = 64
const CODEX_CHECKPOINT_PREFIX_CHARS = 96
const CODEX_MAX_LINE_BYTES = 4 * 1024 * 1024
const CODEX_ROLLOUT_CURSOR_VERSION = 4

export class CodexScanner implements AgentScanner {
  readonly agentName = 'codex'

  private readonly sourceStates = new Map<string, ScanSourceStateRow>()
  private sourceStatesLoaded: boolean
  private pendingCursorCommits: PendingCursorCommit[] = []

  constructor(sourceStates?: readonly ScanSourceStateRow[]) {
    this.sourceStatesLoaded = sourceStates !== undefined
    for (const state of sourceStates ?? []) this.sourceStates.set(state.source_id, state)
  }

  isAvailable(): boolean {
    return (
      getCodexStateDbCandidates().some(hasCodexThreadsTable) ||
      existsSync(getCodexSessionsDir()) ||
      existsSync(getCodexArchivedSessionsDir())
    )
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  /** 游标只在用量扫描成功后交给落库事务。 */
  takeScanStateUpdates(): ScanSourceStateUpdate[] {
    const commits = this.pendingCursorCommits
    this.pendingCursorCommits = []
    return commits.map((commit) => ({
      agent: this.agentName,
      source_id: commit.sourceId,
      source_type: 'codex-rollout',
      source_scope: '',
      current_path: commit.filePath,
      source_size: commit.size,
      source_mtime_ms: commit.mtimeMs,
      cursor_offset: commit.cursor.endOffset,
      cursor_json: JSON.stringify(commit.cursor),
      fingerprint: '',
      event_watermark_ms: commit.eventWatermarkMs,
    }))
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    const records: TokenUsageRecord[] = []
    const sessions: TokenUsageSession[] = []
    const apiCalls: TokenUsageApiCall[] = []
    this.pendingCursorCommits = []
    if (!this.isAvailable()) return { records, sessions, apiCalls }

    if (isIncrementalContext(scanContext) && !this.sourceStatesLoaded) {
      for (const state of getSourceStatesByType(this.agentName, 'codex-rollout')) {
        this.sourceStates.set(state.source_id, state)
      }
      this.sourceStatesLoaded = true
    }

    const sessionIndexTitles = readSessionIndexTitles()
    const titleBySessionId = new Map<string, string>()
    const relationBySessionId = new Map<string, CodexSessionRelation>()
    const apiCallById = new Map<string, TokenUsageApiCall>()
    const acceptedSourceIds = new Set<string>()

    for (const parseContext of this.collectRolloutContexts(scanContext)) {
      const sourceId = codexRolloutSourceId(parseContext.sessionFile, parseContext.sessionId)
      if (acceptedSourceIds.has(sourceId)) continue
      acceptedSourceIds.add(sourceId)
      const parsed = this.parseRolloutWithCursor(parseContext, scanContext)
      if (!parsed) continue
      const existingRelation = relationBySessionId.get(parsed.sessionId)
      relationBySessionId.set(parsed.sessionId, {
        parentSessionId: parsed.parentSessionId || existingRelation?.parentSessionId,
        subAgentName: parsed.subAgentName || existingRelation?.subAgentName,
        isThreadSpawn: parsed.isThreadSpawn || existingRelation?.isThreadSpawn,
      })
      const title = sessionIndexTitles.get(parsed.sessionId) || parseContext.title || parsed.title
      if (title) titleBySessionId.set(parsed.sessionId, title)
      for (const apiCall of parsed.apiCalls) apiCallById.set(apiCall.apiCallId, apiCall)
    }

    apiCalls.push(...apiCallById.values())
    applyCodexSessionRelations(apiCalls, relationBySessionId)
    const detailSessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    applySessionTitles(detailSessions, titleBySessionId)
    sessions.push(...detailSessions)
    records.push(...buildRecordsFromSessions(this.agentName, detailSessions))

    return { records, sessions, apiCalls }
  }

  private collectRolloutContexts(scanContext: ScannerScanContext): ParseContext[] {
    const contexts: ParseContext[] = []
    const visitedFiles = new Set<string>()

    for (const meta of readThreadMetadata(scanContext)) {
      if (!meta.rolloutPath || !existsSync(meta.rolloutPath)) continue
      const canonical = canonicalPath(meta.rolloutPath)
      if (visitedFiles.has(canonical)) continue
      visitedFiles.add(canonical)
      contexts.push({
        sessionFile: meta.rolloutPath,
        rootDir: getCodexHomeDir(),
        fallbackDate: dateFromThreadMeta(meta),
        sessionId: meta.sessionId,
        title: meta.title,
        model: meta.model,
      })
    }

    contexts.push(...this.buildDirectoryFallbackContexts(visitedFiles, scanContext))
    return selectPreferredCodexRollouts(contexts)
  }

  private parseRolloutWithCursor(
    context: ParseContext,
    scanContext: ScannerScanContext,
  ): ParsedCodexSession | null {
    const file = context.sessionFile
    let fileStat: import('fs').Stats
    try {
      fileStat = statSync(file)
    } catch (error) {
      throw new Error(`Codex rollout 文件不可读 (${file}): ${(error as Error).message}`)
    }

    const sourceId = codexRolloutSourceId(file, context.sessionId)
    const stored = isIncrementalContext(scanContext) ? this.sourceStates.get(sourceId) : undefined
    const cursor = stored ? decodeCodexCursor(stored.cursor_json) : null
    let resume: { startOffset: number; state: CodexParserCheckpointState } | null = null

    const storedMatchesFile =
      stored !== undefined && canonicalPath(stored.current_path) === canonicalPath(file)
    if (stored && cursor && storedMatchesFile && isIncrementalContext(scanContext)) {
      if (
        fileStat.size === stored.source_size &&
        fileStat.mtimeMs === stored.source_mtime_ms &&
        cursor.endOffset === stored.source_size &&
        stored.event_watermark_ms > 0 &&
        stored.event_watermark_ms < scanContext.sinceMs
      ) {
        this.registerCursorCommit(sourceId, file, fileStat, cursor, stored.event_watermark_ms)
        return null
      }
      resume = selectCodexResumePoint(file, fileStat.size, cursor, scanContext.sinceMs)
    }

    const outcome = this.parseSessionFile(context, scanContext, resume)
    const checkpoints: CodexParserCheckpoint[] = []
    if (resume && cursor) {
      for (const checkpoint of cursor.checkpoints) {
        if (checkpoint.offset < resume.startOffset) {
          checkpoints.push(checkpoint)
        }
      }
    }
    checkpoints.push(...outcome.checkpoints)
    checkpoints.push({ offset: outcome.endOffset, prefix: '', state: outcome.finalState })

    const uniqueCheckpoints = new Map<number, CodexParserCheckpoint>()
    for (const checkpoint of checkpoints) uniqueCheckpoints.set(checkpoint.offset, checkpoint)
    const sortedCheckpoints = [...uniqueCheckpoints.values()].sort((a, b) => a.offset - b.offset)
    const trimmed = sortedCheckpoints.slice(-CODEX_MAX_CHECKPOINTS)
    const newCursor: CodexFileCursor = {
      version: CODEX_ROLLOUT_CURSOR_VERSION,
      endOffset: outcome.endOffset,
      checkpoints: trimmed,
    }
    if (!trimmed.some((checkpoint) => checkpoint.prefix)) {
      const prefixHash = computeCodexPrefixHash(file, outcome.endOffset)
      if (prefixHash) newCursor.smallPrefixHash = prefixHash
    }
    this.registerCursorCommit(sourceId, file, fileStat, newCursor, outcome.finalState.lastEventMs)
    return outcome.session
  }

  private registerCursorCommit(
    sourceId: string,
    filePath: string,
    fileStat: import('fs').Stats,
    cursor: CodexFileCursor,
    eventWatermarkMs: number,
  ): void {
    this.pendingCursorCommits.push({
      sourceId,
      filePath,
      size: cursor.endOffset,
      mtimeMs: fileStat.mtimeMs,
      eventWatermarkMs,
      cursor,
    })
  }

  private buildDirectoryFallbackContexts(
    visitedFiles: Set<string>,
    scanContext: ScannerScanContext,
  ): ParseContext[] {
    const contexts: ParseContext[] = []
    const sessionsDir = getCodexSessionsDir()
    const archivedDir = getCodexArchivedSessionsDir()
    const cleanupArchiveDir = getCodexCleanupArchiveDir()

    if (existsSync(sessionsDir)) {
      for (const file of listJsonlFiles(sessionsDir)) {
        if (visitedFiles.has(canonicalPath(file))) continue
        if (!shouldScanFile(file, scanContext)) continue
        contexts.push({
          sessionFile: file,
          rootDir: sessionsDir,
          fallbackDate: dateFromSessionPath(sessionsDir, file),
        })
      }
    }

    if (existsSync(archivedDir)) {
      for (const file of listJsonlFiles(archivedDir)) {
        if (visitedFiles.has(canonicalPath(file))) continue
        if (!shouldScanFile(file, scanContext)) continue
        contexts.push({
          sessionFile: file,
          rootDir: archivedDir,
          fallbackDate: 'unknown',
        })
      }
    }

    if (existsSync(cleanupArchiveDir)) {
      for (const file of listJsonlFiles(cleanupArchiveDir)) {
        if (visitedFiles.has(canonicalPath(file))) continue
        if (!shouldScanFile(file, scanContext)) continue
        contexts.push({
          sessionFile: file,
          rootDir: cleanupArchiveDir,
          fallbackDate: 'unknown',
        })
      }
    }

    return contexts
  }

  /**
   * 解析单个 Codex rollout JSONL。
   * last_token_usage 是最近一次 API 快照；total_token_usage 是当前计数段累计值，
   * 同一 rollout 内也可能因 Codex 应用重启而重新起算。
   * Codex 会重复写入相同累计快照，因此只在累计值变化时接纳 last_token_usage，
   * 并在文件解析结束后用最终累计值校验所有明细之和。
   */
  private parseSessionFile(
    context: ParseContext,
    scanContext: ScannerScanContext,
    resume: { startOffset: number; state: CodexParserCheckpointState } | null,
  ): {
    session: ParsedCodexSession
    checkpoints: CodexParserCheckpoint[]
    endOffset: number
    finalState: CodexParserCheckpointState
  } {
    const apiCalls: TokenUsageApiCall[] = []
    const fallbackSessionId = relative(context.rootDir, context.sessionFile).split(sep).join('/')
    let sessionId = context.sessionId || fallbackSessionId
    let sessionMetaSeen = false
    let copiedSessionMetaSeen = false
    let currentModel = context.model || 'unknown'
    let sessionDate = context.fallbackDate
    let sessionTitle = context.title || ''
    let parentSessionId = ''
    let subAgentName = ''
    let projectPath = ''
    let isThreadSpawnSubAgent = false
    let forkedFromSessionId = ''
    let historyMode = ''
    let subAgentHistoryStartOrdinal: number | null = null
    let previousAcceptedCumulative = ''
    let previousCumulativeSum = -1
    let previousCumulative: CodexUsageSnapshot | null = null
    let cumulativeSegmentBaseline = emptyCodexUsage()
    let completedCumulative = emptyCodexUsage()
    let finalCumulative: CodexUsageSnapshot | null = null
    let acceptedUsage = emptyCodexUsage()
    let inheritedCumulativeBaseline: CodexUsageSnapshot | null = null
    let subAgentBoundaryApplied = false
    let lastEventMs = 0

    if (resume) {
      const state = resume.state
      sessionId = state.sessionId || sessionId
      sessionMetaSeen = state.sessionMetaSeen
      copiedSessionMetaSeen = state.copiedSessionMetaSeen
      currentModel = state.currentModel || currentModel
      sessionDate = state.sessionDate || sessionDate
      sessionTitle = state.sessionTitle
      projectPath = state.projectPath
      parentSessionId = state.parentSessionId
      forkedFromSessionId = state.forkedFromSessionId
      historyMode = state.historyMode
      subAgentHistoryStartOrdinal = state.subAgentHistoryStartOrdinal
      subAgentName = state.subAgentName
      isThreadSpawnSubAgent = state.isThreadSpawnSubAgent
      subAgentBoundaryApplied = state.subAgentBoundaryApplied
      previousAcceptedCumulative = state.previousAcceptedCumulative
      previousCumulativeSum = state.previousCumulativeSum
      previousCumulative = state.previousCumulative
      cumulativeSegmentBaseline = state.cumulativeSegmentBaseline
      completedCumulative = state.completedCumulative
      acceptedUsage = state.acceptedUsage
      inheritedCumulativeBaseline = state.inheritedCumulativeBaseline
      lastEventMs = state.lastEventMs
    }

    const snapshotState = (): CodexParserCheckpointState => ({
      sessionId,
      sessionMetaSeen,
      copiedSessionMetaSeen,
      currentModel,
      sessionDate,
      sessionTitle,
      projectPath,
      parentSessionId,
      forkedFromSessionId,
      historyMode,
      subAgentHistoryStartOrdinal,
      subAgentName,
      isThreadSpawnSubAgent,
      subAgentBoundaryApplied,
      previousAcceptedCumulative,
      previousCumulativeSum,
      previousCumulative: previousCumulative ? { ...previousCumulative } : null,
      cumulativeSegmentBaseline: { ...cumulativeSegmentBaseline },
      completedCumulative: { ...completedCumulative },
      acceptedUsage: { ...acceptedUsage },
      inheritedCumulativeBaseline: inheritedCumulativeBaseline
        ? { ...inheritedCumulativeBaseline }
        : null,
      lastEventMs,
    })

    const resetInheritedUsage = (): void => {
      apiCalls.length = 0
      previousAcceptedCumulative = ''
      previousCumulativeSum = -1
      previousCumulative = null
      cumulativeSegmentBaseline = emptyCodexUsage()
      completedCumulative = emptyCodexUsage()
      finalCumulative = null
      acceptedUsage = emptyCodexUsage()
      inheritedCumulativeBaseline = null
    }

    const checkpoints: CodexParserCheckpoint[] = []
    const startOffset = resume?.startOffset ?? 0
    let lastCheckpointOffset = startOffset
    let endOffset = startOffset

    try {
      for (const { line, byteOffset, byteLength, truncated } of readUtf8Lines(
        context.sessionFile,
        256 * 1024,
        startOffset,
        CODEX_MAX_LINE_BYTES,
      )) {
        endOffset = byteOffset + byteLength
        if (byteOffset - lastCheckpointOffset >= CODEX_CHECKPOINT_BYTES) {
          checkpoints.push({
            offset: byteOffset,
            prefix: line.slice(0, CODEX_CHECKPOINT_PREFIX_CHARS),
            state: snapshotState(),
          })
          lastCheckpointOffset = byteOffset
        }
        if (truncated) continue
        if (line.length === 0) continue
        if (!isCodexRelevantLine(line)) continue
        let obj: unknown
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }
        if (!isObject(obj)) continue
        const type = readString(obj.type)
        const ordinal = readCodexOrdinal(obj.ordinal)

        if (type === 'session_meta') {
          const payload = obj.payload
          if (isObject(payload)) {
            if (!sessionMetaSeen) {
              // 官方 recorder 以文件中的第一个 SessionMeta 为 rollout 身份；fork
              // 复制进来的父 SessionMeta 只能视为历史，不能覆盖子线程 ID/关系。
              sessionMetaSeen = true
              sessionId = readString(payload.id) || sessionId
              projectPath = extractProjectPath(payload) || projectPath
              const relation = readCodexSessionRelation(payload)
              parentSessionId = relation.parentSessionId || parentSessionId
              subAgentName = relation.subAgentName || subAgentName
              isThreadSpawnSubAgent = relation.isThreadSpawn || isThreadSpawnSubAgent
              forkedFromSessionId = readString(payload.forked_from_id)
              historyMode = readString(payload.history_mode)
              subAgentHistoryStartOrdinal = readCodexOrdinal(payload.subagent_history_start_ordinal)
            } else {
              copiedSessionMetaSeen = true
            }
          }
        }

        // paginated rollout 明确给出子线程自有历史的起始 ordinal。起点之前是
        // 继承自父线程的投影，不能用于模型、标题或 token 归属。
        if (subAgentHistoryStartOrdinal !== null && !subAgentBoundaryApplied) {
          if (ordinal === null || ordinal < subAgentHistoryStartOrdinal) continue
          resetInheritedUsage()
          subAgentBoundaryApplied = true
        }

        if (type === 'turn_context') {
          const payload = obj.payload
          if (isObject(payload)) {
            projectPath = projectPath || extractProjectPath(payload) || ''
            sessionTitle = preferSessionTitle(
              sessionTitle,
              readString(payload.summary) || readString(payload.name),
            )
            currentModel = readString(payload.model) || currentModel
            const currentDate = readCodexDate(payload.current_date)
            if (currentDate) sessionDate = currentDate
          }
        }

        // Codex fork 子 Agent 时会把父会话历史复制到新 rollout。通信元数据标记了
        // 子 Agent 真正开始工作的边界；边界前的 token_count 已在父会话统计过。
        if (
          type === 'inter_agent_communication_metadata' &&
          (isThreadSpawnSubAgent || Boolean(forkedFromSessionId) || copiedSessionMetaSeen) &&
          !subAgentBoundaryApplied
        ) {
          resetInheritedUsage()
          subAgentBoundaryApplied = true
        }

        if (type === 'event_msg') {
          const payload = obj.payload
          if (isObject(payload) && payload.type === 'user_message') {
            sessionTitle = keepFirstSessionTitle(sessionTitle, readString(payload.message))
          }
          if (isObject(payload) && payload.type === 'token_count') {
            const eventMs = codexEventTimestampMs(obj.timestamp)
            if (eventMs > lastEventMs) lastEventMs = eventMs
            const info = payload.info
            if (!isObject(info) || !isObject(info.last_token_usage)) continue
            const cumulative = readCodexUsage(info.total_token_usage)
            const cumulativeSignature = cumulative ? codexUsageSignature(cumulative) : ''
            if (cumulativeSignature && cumulativeSignature === previousAcceptedCumulative) {
              continue
            }

            const { timestamp, rawTimestamp } = timestampsFromValue(obj.timestamp, sessionDate)
            const usage = readCodexUsage(info.last_token_usage)
            if (!usage || !hasTokenUsage(usage)) continue

            if (cumulative && previousCumulativeSum >= 0) {
              const cumulativeSum = codexUsageSum(cumulative)
              const beginsNewCumulativeSegment = sameCodexUsage(cumulative, usage)
              const cumulativeWentBack = cumulativeSum < previousCumulativeSum
              // Codex 的累计计数器会在应用重启等边界重新起算。新计数段的首个调用
              // 可能比上一段总量更大，因此不能只靠“累计值下降”识别重置；
              // total_token_usage 与 last_token_usage 完全相等同样表示当前累计仅含本次调用。
              if (beginsNewCumulativeSegment || cumulativeWentBack) {
                const looksStale =
                  cumulativeSum * 100 >= previousCumulativeSum * 98 ||
                  cumulativeSum + 2 * codexUsageSum(usage) >= previousCumulativeSum
                if (!beginsNewCumulativeSegment && looksStale) continue
                if (previousCumulative) {
                  completedCumulative = addCodexUsage(
                    completedCumulative,
                    normalizeCodexUsageExclusive(
                      subtractCodexUsageOrThrow(
                        previousCumulative,
                        cumulativeSegmentBaseline,
                        context.sessionFile,
                      ),
                    ),
                  )
                }
                // 回退后 Codex 可能从旧累计快照续算，而不是从 0 开始。该基线已在
                // 前一计数段统计过；当前段结束时只校验并计入基线之后的新增量。
                cumulativeSegmentBaseline = subtractCodexUsageOrThrow(
                  cumulative,
                  usage,
                  context.sessionFile,
                )
              }
            }

            if (cumulative) finalCumulative = cumulative
            const exclusiveUsage = normalizeCodexUsageExclusive(usage)
            if (
              usage.cacheReadTokens > usage.inputTokens ||
              usage.cacheReadTokens + usage.cacheWriteTokens > usage.inputTokens ||
              usage.reasoningTokens > usage.outputTokens ||
              (cumulative !== null &&
                (cumulative.cacheReadTokens + cumulative.cacheWriteTokens >
                  cumulative.inputTokens ||
                  cumulative.reasoningTokens > cumulative.outputTokens))
            ) {
              throw new Error(
                `Codex token 字段重叠关系无效 (${context.sessionFile}, ${rawTimestamp || timestamp})`,
              )
            }
            acceptedUsage = addCodexUsage(acceptedUsage, exclusiveUsage)
            if (
              (isThreadSpawnSubAgent || Boolean(forkedFromSessionId) || subAgentBoundaryApplied) &&
              !inheritedCumulativeBaseline &&
              cumulative
            ) {
              inheritedCumulativeBaseline = subtractCodexUsage(
                normalizeCodexUsageExclusive(cumulative),
                acceptedUsage,
              )
            }
            const apiCall: TokenUsageApiCall = {
              agent: this.agentName,
              apiCallId: codexApiCallId(
                sessionId,
                timestamp,
                currentModel,
                cumulativeSignature,
                usage,
              ),
              sessionId,
              ...(projectPath ? { projectPath } : {}),
              date: dateFromTimestamp(timestamp, sessionDate),
              rawTimestamp,
              timestamp,
              hour: hourFromTimestamp(timestamp),
              model: currentModel,
              inputTokens: exclusiveUsage.inputTokens,
              outputTokens: exclusiveUsage.outputTokens,
              cacheReadTokens: exclusiveUsage.cacheReadTokens,
              cacheWriteTokens: exclusiveUsage.cacheWriteTokens,
              totalTokens:
                exclusiveUsage.inputTokens +
                exclusiveUsage.outputTokens +
                exclusiveUsage.cacheReadTokens +
                exclusiveUsage.cacheWriteTokens +
                exclusiveUsage.reasoningTokens,
              reasoningTokens: exclusiveUsage.reasoningTokens,
            }
            // 累计校验使用 acceptedUsage；窗口外 API 对象无需留在数组中。
            if (isApiCallInWindow(apiCall, scanContext)) apiCalls.push(apiCall)
            if (cumulativeSignature) {
              previousAcceptedCumulative = cumulativeSignature
              if (cumulative) {
                previousCumulativeSum = codexUsageSum(cumulative)
                previousCumulative = cumulative
              }
            }
          }
        }
      }
    } catch (e) {
      throw new Error(`Codex rollout 文件不可读 (${context.sessionFile}): ${(e as Error).message}`)
    }

    if (finalCumulative) {
      assertCodexCumulativeMatches(
        context.sessionFile,
        acceptedUsage,
        addCodexUsage(
          completedCumulative,
          normalizeCodexUsageExclusive(
            subtractCodexUsageOrThrow(
              finalCumulative,
              cumulativeSegmentBaseline,
              context.sessionFile,
            ),
          ),
        ),
        isThreadSpawnSubAgent || Boolean(forkedFromSessionId) || subAgentBoundaryApplied
          ? inheritedCumulativeBaseline
          : null,
      )
    }
    const finalState = snapshotState()
    return {
      session: {
        sessionId,
        title: sessionTitle,
        apiCalls,
        ...(parentSessionId ? { parentSessionId } : {}),
        ...(subAgentName ? { subAgentName } : {}),
        ...(isThreadSpawnSubAgent ? { isThreadSpawn: true } : {}),
      },
      checkpoints,
      endOffset,
      finalState,
    }
  }
}

function codexApiCallId(
  sessionId: string,
  timestamp: string,
  model: string,
  cumulativeSignature: string,
  usage: CodexUsageSnapshot,
): string {
  const identity = [
    sessionId,
    timestamp,
    model,
    cumulativeSignature,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
    usage.reasoningTokens,
    usage.reportedTotalTokens,
  ].join('\u0000')
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 32)
  return `${sessionId}:${digest}`
}

function codexEventTimestampMs(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    return 0
  }
  const timestamp = timestampEpochMs(value)
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0
}

function codexRolloutSourceId(file: string, explicitSessionId?: string): string {
  if (explicitSessionId) return `id:${explicitSessionId}`
  const stem = basename(file).replace(/\.jsonl$/i, '')
  const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(stem)
  if (uuid) return `id:${uuid[1].toLowerCase()}`
  const digest = createHash('sha256').update(canonicalPath(file)).digest('hex').slice(0, 32)
  return `path:${digest}`
}

/** 同一线程可能同时保留旧 rollout 与续写后的完整副本；优先读取字节数最大的版本。 */
function selectPreferredCodexRollouts(contexts: ParseContext[]): ParseContext[] {
  const selected = new Map<string, { context: ParseContext; size: number; index: number }>()
  for (const [index, context] of contexts.entries()) {
    const sourceId = codexRolloutSourceId(context.sessionFile, context.sessionId)
    let size = -1
    try {
      size = statSync(context.sessionFile).size
    } catch {
      // 真正解析时会抛出带文件路径的明确错误。
    }
    const current = selected.get(sourceId)
    if (!current) {
      selected.set(sourceId, { context, size, index })
    } else if (size > current.size) {
      selected.set(sourceId, {
        context: mergeCodexParseContext(context, current.context),
        size,
        index: current.index,
      })
    } else {
      current.context = mergeCodexParseContext(current.context, context)
    }
  }
  return [...selected.values()]
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.context)
}

function mergeCodexParseContext(preferred: ParseContext, metadata: ParseContext): ParseContext {
  return {
    ...preferred,
    fallbackDate:
      preferred.fallbackDate !== 'unknown' ? preferred.fallbackDate : metadata.fallbackDate,
    sessionId: preferred.sessionId || metadata.sessionId,
    title: metadata.title || preferred.title,
    model: preferred.model || metadata.model,
  }
}

function decodeCodexCursor(json: string): CodexFileCursor | null {
  try {
    const parsed: unknown = JSON.parse(json)
    if (!isObject(parsed) || parsed.version !== CODEX_ROLLOUT_CURSOR_VERSION) return null
    if (!Number.isSafeInteger(parsed.endOffset) || (parsed.endOffset as number) < 0) return null
    if (!Array.isArray(parsed.checkpoints)) return null
    const checkpoints: CodexParserCheckpoint[] = []
    for (const item of parsed.checkpoints) {
      if (!isObject(item) || !Number.isSafeInteger(item.offset) || !isObject(item.state)) continue
      if ((item.offset as number) < 0 || (item.offset as number) > (parsed.endOffset as number))
        continue
      checkpoints.push(item as unknown as CodexParserCheckpoint)
    }
    if (checkpoints.length === 0) return null
    return {
      version: CODEX_ROLLOUT_CURSOR_VERSION,
      endOffset: parsed.endOffset as number,
      checkpoints: checkpoints.sort((left, right) => left.offset - right.offset),
      ...(typeof parsed.smallPrefixHash === 'string'
        ? { smallPrefixHash: parsed.smallPrefixHash }
        : {}),
    }
  } catch {
    return null
  }
}

function selectCodexResumePoint(
  file: string,
  fileSize: number,
  cursor: CodexFileCursor,
  sinceMs: number,
): { startOffset: number; state: CodexParserCheckpointState } | null {
  if (fileSize < cursor.endOffset) return null

  let chosenIndex = -1
  for (let index = 0; index < cursor.checkpoints.length; index += 1) {
    const checkpoint = cursor.checkpoints[index]
    if (checkpoint.offset > fileSize) break
    if ((checkpoint.state.lastEventMs ?? 0) <= sinceMs) chosenIndex = index
    else break
  }
  if (chosenIndex < 0) return null

  // 最终 EOF 检查点没有行前缀；优先退到最近一个可直接校验的行边界。
  let chosen = cursor.checkpoints[chosenIndex]
  while (!chosen.prefix && chosenIndex > 0) {
    chosenIndex -= 1
    chosen = cursor.checkpoints[chosenIndex]
  }
  if (chosen.prefix) {
    const snippet = readByteSnippet(file, chosen.offset)
    if (!snippet || !snippet.startsWith(chosen.prefix)) return null
  } else if (
    !cursor.smallPrefixHash ||
    computeCodexPrefixHash(file, cursor.endOffset) !== cursor.smallPrefixHash
  ) {
    return null
  }
  return { startOffset: chosen.offset, state: chosen.state }
}

function computeCodexPrefixHash(file: string, length: number): string {
  const hash = createHash('sha256')
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    const buffer = Buffer.allocUnsafe(256 * 1024)
    let remaining = Math.max(0, length)
    let position = 0
    while (remaining > 0) {
      const bytesToRead = Math.min(buffer.length, remaining)
      const bytesRead = readSync(fd, buffer, 0, bytesToRead, position)
      if (bytesRead <= 0) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
      remaining -= bytesRead
    }
    if (remaining > 0) return ''
    return hash.digest('hex')
  } catch {
    return ''
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // 文件读取失败时保留原始异常结果。
      }
    }
  }
}

function readThreadMetadata(context: ScannerScanContext): CodexThreadMeta[] {
  const readErrors: string[] = []
  for (const dbPath of getCodexStateDbCandidates()) {
    try {
      const metadata = readThreadMetadataFromDb(dbPath, context)
      if (metadata) return metadata
    } catch (e) {
      readErrors.push((e as Error).message)
    }
  }
  if (readErrors.length > 0) throw new Error(readErrors.join('; '))
  return []
}

function readThreadMetadataFromDb(
  dbPath: string,
  context: ScannerScanContext,
): CodexThreadMeta[] | null {
  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true })
    db.exec('PRAGMA busy_timeout = 5000')
    const columns = readThreadColumns(db)
    if (!columns) return null

    const selectCols = ['id', 'rollout_path']
    if (columns.has('title')) selectCols.push('title')
    if (columns.has('model')) selectCols.push('model')
    if (columns.has('created_at_ms')) {
      selectCols.push('created_at_ms AS scanner_created_at')
    } else if (columns.has('created_at')) {
      selectCols.push('created_at AS scanner_created_at')
    }
    if (columns.has('updated_at_ms')) {
      selectCols.push('updated_at_ms AS scanner_updated_at')
    } else if (columns.has('updated_at')) {
      selectCols.push('updated_at AS scanner_updated_at')
    }

    let whereSql = ''
    const params: Array<number> = []
    if (isIncrementalContext(context)) {
      if (columns.has('updated_at_ms')) {
        whereSql = ' WHERE updated_at_ms >= ?'
        params.push(context.sinceMs)
      } else if (columns.has('updated_at')) {
        whereSql = ' WHERE updated_at >= ?'
        params.push(Math.floor(context.sinceMs / 1000))
      }
    }

    return queryAll(db, `SELECT ${selectCols.join(', ')} FROM threads${whereSql}`, params)
      .map((row) => ({
        sessionId: dbString(row.id),
        rolloutPath: resolveCodexPath(dbString(row.rollout_path), dbPath),
        title: dbString(row.title),
        model: normalizeModel(row.model),
        createdAt: normalizeEpochMilliseconds(row.scanner_created_at),
        updatedAt: normalizeEpochMilliseconds(row.scanner_updated_at),
      }))
      .filter((meta) => meta.sessionId.length > 0 && meta.rolloutPath.length > 0)
  } catch (e) {
    throw new Error(`Codex 状态库不可读 (${dbPath}): ${(e as Error).message}`)
  } finally {
    if (db) db.close()
  }
}

function hasCodexThreadsTable(dbPath: string): boolean {
  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true })
    return readThreadColumns(db) !== null
  } catch {
    return false
  } finally {
    if (db) db.close()
  }
}

function readThreadColumns(db: Database.Database): Set<string> | null {
  const tableRows = queryAll(
    db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name='threads'",
  )
  if (tableRows.length === 0) return null

  const columns = new Set<string>()
  for (const row of queryAll(db, 'PRAGMA table_info(threads)')) {
    const name = row.name
    if (typeof name === 'string') columns.add(name.toLowerCase())
  }
  return columns.has('id') && columns.has('rollout_path') ? columns : null
}

function readSessionIndexTitles(): Map<string, string> {
  const titles = new Map<string, string>()
  const indexFile = getCodexSessionIndexFile()
  if (!existsSync(indexFile)) return titles

  let text: string
  try {
    text = readFileSync(indexFile, 'utf8')
  } catch (e) {
    throw new Error(`Codex 会话索引不可读 (${indexFile}): ${(e as Error).message}`)
  }

  for (const line of text.split('\n')) {
    if (!line) continue
    let obj: unknown
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(obj)) continue
    const id = readString(obj.id)
    const title = readString(obj.thread_name)
    if (id && title) titles.set(id, title)
  }

  return titles
}

function queryAll(
  db: Database.Database,
  sql: string,
  params: Array<number | string> = [],
): Record<string, DbValue>[] {
  return db.prepare(sql).all(...params) as Record<string, DbValue>[]
}

function resolveCodexPath(value: string, dbPath: string): string {
  if (!value) return ''
  if (isAbsolute(value)) return normalize(value)
  const homeCandidate = join(getCodexHomeDir(), value)
  if (existsSync(homeCandidate)) return normalize(homeCandidate)
  const sqliteCandidate = join(dirname(dbPath), value)
  return normalize(existsSync(sqliteCandidate) ? sqliteCandidate : homeCandidate)
}

function canonicalPath(value: string): string {
  const path = resolve(value)
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function dateFromThreadMeta(meta: CodexThreadMeta): string {
  const timestamp = timestampFromValue(meta.createdAt || meta.updatedAt, 'unknown')
  return dateFromTimestamp(timestamp, 'unknown')
}

function normalizeEpochMilliseconds(value: unknown): number {
  const timestamp = toLong(value)
  if (timestamp <= 0) return 0
  if (timestamp < 100_000_000_000) return timestamp * 1000
  if (timestamp >= 100_000_000_000_000_000) return Math.trunc(timestamp / 1_000_000)
  if (timestamp >= 100_000_000_000_000) return Math.trunc(timestamp / 1000)
  return timestamp
}

function dateFromSessionPath(root: string, file: string): string {
  const parts = relative(root, file).split(sep)
  if (parts.length < 4) return 'unknown'
  const [y, m, d] = parts
  if (!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) {
    return 'unknown'
  }
  const yearNum = Number.parseInt(y, 10)
  const monthNum = Number.parseInt(m, 10)
  const dayNum = Number.parseInt(d, 10)
  const constructed = new Date(yearNum, monthNum - 1, dayNum)
  if (
    constructed.getFullYear() !== yearNum ||
    constructed.getMonth() !== monthNum - 1 ||
    constructed.getDate() !== dayNum
  ) {
    return 'unknown'
  }
  return `${y}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
}

function readCodexDate(value: unknown): string {
  if (typeof value !== 'string') return ''
  const candidate = value.substring(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : ''
}

function normalizeModel(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (isObject(parsed)) return readString(parsed.id) || trimmed
    } catch {
      return trimmed
    }
    return trimmed
  }
  if (isObject(value)) return readString(value.id)
  return ''
}

/** 将可能是 number/string/bigint 的值转为整数（对应 Java JsonNode.asLong(0)） */
function toLong(v: unknown): number {
  if (typeof v === 'number') return Math.trunc(v) || 0
  if (typeof v === 'bigint') return Number(v) || 0
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function dbString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function keepFirstSessionTitle(current: string, next: string): string {
  return current || next
}

function preferSessionTitle(current: string, next: string): string {
  return next || current
}

const CODEX_RELEVANT_LINE =
  /"type":\s*"(session_meta|turn_context|event_msg|inter_agent_communication_metadata)"/

function isCodexRelevantLine(line: string): boolean {
  return CODEX_RELEVANT_LINE.test(line)
}

function sameCodexUsage(left: CodexUsageSnapshot, right: CodexUsageSnapshot): boolean {
  return (
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.cacheReadTokens === right.cacheReadTokens &&
    left.cacheWriteTokens === right.cacheWriteTokens &&
    left.reasoningTokens === right.reasoningTokens
  )
}

function subtractCodexUsageOrThrow(
  total: CodexUsageSnapshot,
  baseline: CodexUsageSnapshot,
  sessionFile: string,
): CodexUsageSnapshot {
  const delta = subtractCodexUsage(total, baseline)
  if (delta) return delta
  throw new Error(`Codex token 累计基线无效 (${sessionFile})`)
}

function readCodexOrdinal(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const ordinal = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(ordinal) && ordinal >= 0 ? ordinal : null
}

/** 递归收集目录下所有 .jsonl 文件（按路径排序，保证遍历顺序稳定） */
function listJsonlFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, isRoot = false): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      const scope = isRoot ? 'sessions 目录' : `子目录 (${dir})`
      throw new Error(`Codex ${scope}不可读: ${(e as Error).message}`)
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
  return out.sort()
}
