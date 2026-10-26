/**
 * Codex Scanner（对应 Codex 本地 rollout/thread-store 数据结构）
 *
 * 会话索引优先读取 Codex SQLite 状态库的 threads 表，逐 API/token 明细仍解析
 * rollout JSONL 中的 token_usage_record，兼容旧 event_msg:token_count。状态库只保存会话级累计值，不能直接
 * 当作 API 明细或日聚合事实源。
 *
 * 落库前会把 input/cache 与 output/reasoning 拆成互斥分桶，
 * totalTokens 始终由五个内部分项求和。
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'fs'
import { createHash } from 'crypto'
import { conversationTurn, type ConversationTurn } from './conversation-turn'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'path'
import type { Dirent } from 'fs'
import Database from 'better-sqlite3'
import { parseCodexFiles, ParserWorkerUnavailableError } from './codex-parse-pool'
import { usageEvidence } from '../cost/usage-evidence'
import type {
  AgentScanner,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
  TokenUsageSession,
  ScannerScanContext,
} from './types'
import { readByteSnippet } from '../lib/line-reader'
import { readCodexLineBatches } from './codex-rollout-reader'
import { CodexResponseUsage, type PendingCodexResponseUsage } from './codex-response-usage'
import { timestampEpochMs } from '../lib/date-utils'
import type { LatestTurnFirstToken } from '../../shared/models'
import { codexRecentStartMs } from '../../shared/codex-scan-scope'
import { latestTurnFirstToken, normalizeLatestTurnFirstToken } from '../../shared/turn-timing'
import type { SessionTurnState } from '../../shared/models'
import { LatestTurnTracker } from './latest-turn-tracker'
import { codexTurnFirstToken } from './codex-turn-timing'
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
  CodexGenerationEstimate,
  type CodexGenerationEstimateState,
} from './codex-generation-timing'
import { isApiCallInWindow, isIncrementalContext, normalizeScanContext } from './incremental-utils'
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

export interface ParseContext {
  sessionFile: string
  rootDir: string
  fallbackDate: string
  sessionId?: string
  title?: string
  model?: string
}

export interface ParsedCodexSession extends CodexSessionRelation {
  latestTurn?: SessionTurnState
  sessionId: string
  title: string
  apiCalls: TokenUsageApiCall[]
  apiCallReplacements?: ScannerUsageDetails['apiCallReplacements']
  latestTurnFirstToken?: LatestTurnFirstToken
}

interface CodexParserCheckpointState {
  latestTurn?: SessionTurnState
  pendingResponses?: PendingCodexResponseUsage[]
  responseUsageIncomplete?: boolean
  latestTurnFirstToken?: LatestTurnFirstToken
  generationEstimate?: CodexGenerationEstimateState
  currentTurnId?: string
  turn?: ConversationTurn
  modelFromTurn: boolean
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
  /** 子线程创建时间；迁移边界前据此区分父线程复制的轮次与自有轮次。 */
  threadCreatedMs: number
  subAgentOwnHistoryStarted: boolean
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
  version: 11
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
const CODEX_ROLLOUT_CURSOR_VERSION = 11

export class CodexScanner implements AgentScanner {
  readonly agentName = 'codex'

  private readonly sourceStates = new Map<string, ScanSourceStateRow>()
  private sourceStatesLoaded: boolean
  private pendingCursorCommits: PendingCursorCommit[] = []
  private parsedSourceUpdates: ScanSourceStateUpdate[] = []

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
    const parsedUpdates = this.parsedSourceUpdates
    this.parsedSourceUpdates = []
    return [
      ...parsedUpdates,
      ...commits.map((commit) => ({
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
      })),
    ]
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = codexReadContext(normalizeScanContext(context))
    const records: TokenUsageRecord[] = []
    const sessions: TokenUsageSession[] = []
    const apiCalls: TokenUsageApiCall[] = []
    this.pendingCursorCommits = []
    this.parsedSourceUpdates = []
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
    const replacements = new Map<string, string>()
    const turnFirstTokens = new Map<string, LatestTurnFirstToken>()
    const latestTurns = new Map<string, SessionTurnState>()
    const acceptedSourceIds = new Set<string>()

    const contexts = this.collectRolloutContexts(scanContext).filter((context) => {
      const sourceId = codexRolloutSourceId(context.sessionFile)
      if (acceptedSourceIds.has(sourceId)) return false
      acceptedSourceIds.add(sourceId)
      return true
    })
    const workerOptions = scanContext.parserWorkers
    const mergeSession = (parsed: ParsedCodexSession | null, parseContext: ParseContext): void => {
      if (!parsed) return
      if (parsed.latestTurn) {
        const previous = latestTurns.get(parsed.sessionId)
        if (
          !previous ||
          parsed.latestTurn.startedAtMs > previous.startedAtMs ||
          (parsed.latestTurn.turnId === previous.turnId &&
            parsed.latestTurn.updatedAtMs >= previous.updatedAtMs)
        )
          latestTurns.set(parsed.sessionId, parsed.latestTurn)
      }
      const existingRelation = relationBySessionId.get(parsed.sessionId)
      relationBySessionId.set(parsed.sessionId, {
        parentSessionId: parsed.parentSessionId || existingRelation?.parentSessionId,
        subAgentName: parsed.subAgentName || existingRelation?.subAgentName,
        isThreadSpawn: parsed.isThreadSpawn || existingRelation?.isThreadSpawn,
      })
      const title = sessionIndexTitles.get(parsed.sessionId) || parseContext.title || parsed.title
      if (title) titleBySessionId.set(parsed.sessionId, title)
      for (const apiCall of parsed.apiCalls) apiCallById.set(apiCall.apiCallId, apiCall)
      for (const replacement of parsed.apiCallReplacements ?? [])
        replacements.set(replacement.previousApiCallId, replacement.apiCallId)
      const latest = latestTurnFirstToken(
        turnFirstTokens.get(parsed.sessionId),
        parsed.latestTurnFirstToken,
      )
      if (latest) turnFirstTokens.set(parsed.sessionId, latest)
    }
    let parsedInParallel = false
    if (
      workerOptions &&
      workerOptions.concurrency > 1 &&
      contexts.length >= 8 &&
      existsSync(workerOptions.entry)
    ) {
      try {
        await parseCodexFiles(
          contexts.map((file) => ({
            file,
            state: this.sourceStates.get(codexRolloutSourceId(file.sessionFile)),
          })),
          scanContext,
          workerOptions,
          (result, index) => {
            this.parsedSourceUpdates.push(...result.sourceStates)
            mergeSession(result.session, contexts[index])
          },
        )
        parsedInParallel = true
      } catch (error) {
        if (!(error instanceof ParserWorkerUnavailableError)) throw error
        this.parsedSourceUpdates = []
        titleBySessionId.clear()
        relationBySessionId.clear()
        apiCallById.clear()
        replacements.clear()
        turnFirstTokens.clear()
        console.warn('[codex] 日志解析线程不可用，本轮使用顺序解析')
      }
    }
    let processedFiles = 0
    if (!parsedInParallel) {
      for (const parseContext of contexts) {
        scanContext.reportProgress?.({
          unit: 'files',
          completed: processedFiles,
          total: contexts.length,
        })
        processedFiles++
        mergeSession(await this.parseRolloutWithCursor(parseContext, scanContext), parseContext)
      }
    }

    scanContext.reportProgress?.({
      unit: 'files',
      completed: contexts.length,
      total: contexts.length,
    })
    // 完整历史可超过 JS 的函数参数数量上限，不能展开后传给 push。
    for (const [previous, current] of replacements)
      if (apiCallById.has(current)) apiCallById.delete(previous)
    for (const call of apiCallById.values()) apiCalls.push(call)
    applyCodexSessionRelations(apiCalls, relationBySessionId)
    const detailSessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    applySessionTitles(detailSessions, titleBySessionId)
    sessions.push(...detailSessions)
    records.push(...buildRecordsFromSessions(this.agentName, detailSessions))

    return {
      records,
      sessions,
      apiCalls,
      ...(replacements.size
        ? {
            apiCallReplacements: [...replacements]
              .filter(([, id]) => apiCallById.has(id))
              .map(([previousApiCallId, apiCallId]) => ({ previousApiCallId, apiCallId })),
          }
        : {}),
      latestTurnFirstTokens: [...turnFirstTokens.values()],
      latestTurns: [...latestTurns.values()],
    }
  }

  private collectRolloutContexts(scanContext: ScannerScanContext): ParseContext[] {
    const contexts: ParseContext[] = []
    const visitedFiles = new Set<string>()

    for (const meta of readThreadMetadata(scanContext)) {
      if (!meta.rolloutPath || !existsSync(meta.rolloutPath)) continue
      if (
        scanContext.codexScope === 'recent' &&
        !this.shouldScanRolloutFile(meta.rolloutPath, scanContext, meta.updatedAt)
      )
        continue
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
    return contexts
  }

  /** 单文件解析入口；工作线程与顺序扫描共用同一套游标和证据规则。 */
  async parseRolloutWithCursor(
    context: ParseContext,
    scanContext: ScannerScanContext,
  ): Promise<ParsedCodexSession | null> {
    scanContext = codexReadContext(scanContext)
    const file = context.sessionFile
    const compressed = file.endsWith('.jsonl.zst')
    if (compressed && scanContext.codexScope === 'recent') return null
    let fileStat: import('fs').Stats
    try {
      fileStat = statSync(file)
    } catch (error) {
      throw new Error(`Codex rollout 文件不可读 (${file}): ${(error as Error).message}`)
    }

    const sourceId = codexRolloutSourceId(file)
    const stored = isIncrementalContext(scanContext) ? this.sourceStates.get(sourceId) : undefined
    const cursor = stored ? decodeCodexCursor(stored.cursor_json) : null
    let resume: { startOffset: number; state: CodexParserCheckpointState } | null = null

    const storedMatchesFile =
      stored !== undefined && canonicalPath(stored.current_path) === canonicalPath(file)
    if (stored && cursor && storedMatchesFile && isIncrementalContext(scanContext)) {
      if (
        fileStat.size === stored.source_size &&
        fileStat.mtimeMs === stored.source_mtime_ms &&
        (compressed || cursor.endOffset === stored.source_size) &&
        stored.event_watermark_ms > 0 &&
        stored.event_watermark_ms < scanContext.sinceMs
      ) {
        this.registerCursorCommit(sourceId, file, fileStat, cursor, stored.event_watermark_ms)
        return null
      }
      if (!compressed) {
        resume = selectCodexResumePoint(file, fileStat.size, cursor, scanContext.sinceMs)
      }
    }

    const outcome = await this.parseSessionFile(context, scanContext, resume)
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
    if (!compressed && !trimmed.some((checkpoint) => checkpoint.prefix)) {
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
      size: filePath.endsWith('.jsonl.zst') ? fileStat.size : cursor.endOffset,
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
        if (!this.shouldScanRolloutFile(file, scanContext)) continue
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
        if (!this.shouldScanRolloutFile(file, scanContext)) continue
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
        if (!this.shouldScanRolloutFile(file, scanContext)) continue
        contexts.push({
          sessionFile: file,
          rootDir: cleanupArchiveDir,
          fallbackDate: 'unknown',
        })
      }
    }

    return contexts
  }

  private shouldScanRolloutFile(
    file: string,
    context: ScannerScanContext,
    updatedAtMs = 0,
  ): boolean {
    if (context.codexScope === 'recent' && file.endsWith('.jsonl.zst')) return false
    if (!isIncrementalContext(context)) return true
    const stored = this.sourceStates.get(codexRolloutSourceId(file))
    if (context.codexScope === 'recent') {
      if (updatedAtMs >= context.sinceMs || (stored?.event_watermark_ms ?? 0) >= context.sinceMs)
        return true
      // 目录日期也能识别保留了旧 mtime 的导入文件；旧会话续写则按 mtime/线程更新时间读取。
      const date = dateFromSessionPath(getCodexSessionsDir(), file)
      if (date !== 'unknown') {
        const endOfDay = new Date(`${date}T00:00:00`)
        endOfDay.setDate(endOfDay.getDate() + 1)
        if (endOfDay.getTime() > context.sinceMs) return true
      }
      try {
        const current = statSync(file)
        return (
          current.mtimeMs >= context.sinceMs ||
          (!!stored &&
            (current.size !== stored.source_size || current.mtimeMs !== stored.source_mtime_ms))
        )
      } catch {
        return true
      }
    }
    // 入库按事件时间替换窗口。旧 rollout 的 mtime 可能早于其中的调用时间，
    // 即使线程索引已指向续写文件，也必须重读窗口内的旧文件；未知来源先解析一次。
    // 首次近期扫描例外：窗口前未写过的文件留给随后的历史补扫，避免先解压全部归档。
    if (!stored && context.deferHistory) {
      try {
        return statSync(file).mtimeMs >= context.sinceMs
      } catch {
        return true
      }
    }
    if (!stored || stored.event_watermark_ms >= context.sinceMs) return true
    try {
      const current = statSync(file)
      return (
        current.mtimeMs >= context.sinceMs ||
        current.size !== stored.source_size ||
        current.mtimeMs !== stored.source_mtime_ms
      )
    } catch {
      // 无法确认来源未变时交给解析器，读取失败会中止本轮，避免提交不完整的窗口。
      return true
    }
  }

  /**
   * 解析单个 Codex rollout JSONL。
   * 原生 token_usage_record 按 thread_id / response_id 认领；旧快照与其配对后
   * 沿用原生身份，回填事务同时撤销已保存的旧快照身份。
   * last_token_usage 是最近一次 API 快照；total_token_usage 是当前计数段累计值，
   * 同一 rollout 内也可能因 Codex 应用重启而重新起算。
   * Codex 会重复写入相同累计快照，因此只在累计值变化时接纳 last_token_usage，
   * 累计值用于识别重复与重置，不能代替逐次调用的原始用量。
   */
  private async parseSessionFile(
    context: ParseContext,
    scanContext: ScannerScanContext,
    resume: { startOffset: number; state: CodexParserCheckpointState } | null,
  ): Promise<{
    session: ParsedCodexSession
    checkpoints: CodexParserCheckpoint[]
    endOffset: number
    finalState: CodexParserCheckpointState
  }> {
    const apiCalls: TokenUsageApiCall[] = []
    const responseCalls = new Map<string, TokenUsageApiCall>()
    const responseUsage = new CodexResponseUsage(resume?.state.pendingResponses)
    const replacements = new Map<string, string>()
    const fallbackSessionId = relative(context.rootDir, context.sessionFile).split(sep).join('/')
    let sessionId = context.sessionId || fallbackSessionId
    let sessionMetaSeen = false
    let copiedSessionMetaSeen = false
    let currentModel = context.model || 'unknown'
    let currentTurnId = ''
    let modelFromTurn = false
    let sessionDate = context.fallbackDate
    let sessionTitle = context.title || ''
    let parentSessionId = ''
    let subAgentName = ''
    let projectPath = ''
    let isThreadSpawnSubAgent = false
    let forkedFromSessionId = ''
    let historyMode = ''
    let subAgentHistoryStartOrdinal: number | null = null
    let threadCreatedMs = 0
    let subAgentOwnHistoryStarted = false
    let previousAcceptedCumulative = ''
    let previousCumulativeSum = -1
    let previousCumulative: CodexUsageSnapshot | null = null
    let cumulativeSegmentBaseline = emptyCodexUsage()
    let completedCumulative = emptyCodexUsage()
    let acceptedUsage = emptyCodexUsage()
    let inheritedCumulativeBaseline: CodexUsageSnapshot | null = null
    let subAgentBoundaryApplied = false
    let lastEventMs = 0
    let turn: ConversationTurn | undefined
    let turnFirstToken = normalizeLatestTurnFirstToken(resume?.state.latestTurnFirstToken)
    const latestTurn = new LatestTurnTracker(resume?.state.latestTurn)
    const generationEstimate = new CodexGenerationEstimate(resume?.state.generationEstimate)

    if (resume) {
      const state = resume.state
      sessionId = state.sessionId || sessionId
      sessionMetaSeen = state.sessionMetaSeen
      copiedSessionMetaSeen = state.copiedSessionMetaSeen
      currentModel = state.currentModel || currentModel
      modelFromTurn = state.modelFromTurn
      sessionDate = state.sessionDate || sessionDate
      sessionTitle = state.sessionTitle
      projectPath = state.projectPath
      parentSessionId = state.parentSessionId
      forkedFromSessionId = state.forkedFromSessionId
      historyMode = state.historyMode
      subAgentHistoryStartOrdinal = state.subAgentHistoryStartOrdinal
      threadCreatedMs = state.threadCreatedMs
      subAgentOwnHistoryStarted = state.subAgentOwnHistoryStarted
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
      turn = state.turn
      currentTurnId = state.currentTurnId ?? ''
    }

    const snapshotState = (): CodexParserCheckpointState => ({
      latestTurn: latestTurn.get(sessionId),
      pendingResponses: responseUsage.snapshot(),
      responseUsageIncomplete: !responseUsage.checkpointComplete,
      latestTurnFirstToken: turnFirstToken,
      generationEstimate: generationEstimate.snapshot(),
      currentTurnId,
      turn,
      sessionId,
      sessionMetaSeen,
      copiedSessionMetaSeen,
      currentModel,
      modelFromTurn,
      sessionDate,
      sessionTitle,
      projectPath,
      parentSessionId,
      forkedFromSessionId,
      historyMode,
      subAgentHistoryStartOrdinal,
      threadCreatedMs,
      subAgentOwnHistoryStarted,
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
      latestTurn.clear()
      turnFirstToken = undefined
      generationEstimate.reset()
      apiCalls.length = 0
      turn = undefined
      currentTurnId = ''
      previousAcceptedCumulative = ''
      previousCumulativeSum = -1
      previousCumulative = null
      cumulativeSegmentBaseline = emptyCodexUsage()
      completedCumulative = emptyCodexUsage()
      acceptedUsage = emptyCodexUsage()
      inheritedCumulativeBaseline = null
    }

    const checkpoints: CodexParserCheckpoint[] = []
    const startOffset = resume?.startOffset ?? 0
    let lastCheckpointOffset = startOffset
    let endOffset = startOffset

    try {
      batches: for await (const batch of readCodexLineBatches(
        context.sessionFile,
        startOffset,
        CODEX_MAX_LINE_BYTES,
      )) {
        for (const { line, prefix, byteOffset, byteLength, truncated, terminated } of batch) {
          endOffset = byteOffset + byteLength
          if (byteOffset - lastCheckpointOffset >= CODEX_CHECKPOINT_BYTES) {
            checkpoints.push({
              offset: byteOffset,
              prefix: (prefix ?? line).slice(0, CODEX_CHECKPOINT_PREFIX_CHARS).split('').join(''),
              state: snapshotState(),
            })
            if (checkpoints.length > CODEX_MAX_CHECKPOINTS) checkpoints.shift()
            lastCheckpointOffset = byteOffset
          }
          if (truncated) continue
          if (line.length === 0) continue
          let tailObject: unknown
          if (terminated === false) {
            try {
              tailObject = JSON.parse(line)
            } catch {
              // 不提交未写完行的尾部游标；后续追加时从该行开头恢复。
              endOffset = byteOffset
              break batches
            }
          }
          if (isCodexModelOutputLine(line)) {
            // 只识别原生 ResponseItem 的类型，不解析或保留模型正文。
            generationEstimate.modelOutput(
              sessionId,
              currentTurnId || turn?.id || '',
              CODEX_TOOL_CALL_LINE.test(line),
            )
          }
          if (!isCodexRelevantLine(line)) continue
          let obj: unknown
          try {
            obj = tailObject ?? JSON.parse(line)
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
                threadCreatedMs = uuidV7Ms(sessionId) || codexEventTimestampMs(payload.timestamp)
                projectPath = extractProjectPath(payload) || projectPath
                const relation = readCodexSessionRelation(payload)
                parentSessionId = relation.parentSessionId || parentSessionId
                subAgentName = relation.subAgentName || subAgentName
                isThreadSpawnSubAgent = relation.isThreadSpawn || isThreadSpawnSubAgent
                forkedFromSessionId = readString(payload.forked_from_id)
                historyMode = readString(payload.history_mode)
                subAgentHistoryStartOrdinal = readCodexOrdinal(
                  payload.subagent_history_start_ordinal,
                )
              } else {
                copiedSessionMetaSeen = true
              }
            }
          }

          // 迁移可能将旧子 Agent 的全部上下文置于界面投影边界之前。独立逐请求
          // 用量有 thread_id，按原生归属读取，不受界面 ordinal 边界影响。
          if (type === 'turn_context' && isObject(obj.payload)) {
            const model = readString(obj.payload.model)
            if (model) {
              currentModel = model
              modelFromTurn = true
            }
          }
          if (type === 'token_usage_record') {
            const payload = obj.payload
            if (!isObject(payload))
              throw new Error(`Codex 原生请求记录无效 (${context.sessionFile})`)
            const owner = readString(payload.thread_id)
            const responseId = readString(payload.response_id)
            if (!owner || !responseId || !isObject(payload.usage))
              throw new Error(`Codex 原生请求身份或用量缺失 (${context.sessionFile})`)
            if (owner !== sessionId) continue
            const usage = readCodexUsage(payload.usage)
            if (!usage || !hasTokenUsage(usage)) continue
            assertCodexUsageBuckets(usage, context.sessionFile)
            const eventMs = codexEventTimestampMs(obj.timestamp)
            lastEventMs = Math.max(lastEventMs, eventMs)
            const { timestamp, rawTimestamp } = timestampsFromValue(obj.timestamp, sessionDate)
            const exclusive = normalizeCodexUsageExclusive(usage)
            const responseTurnId = readString(payload.turn_id) || currentTurnId
            const call: TokenUsageApiCall = {
              agent: this.agentName,
              apiCallId: `${sessionId}:response:${createHash('sha256').update(responseId).digest('hex').slice(0, 32)}`,
              sessionId,
              ...(projectPath ? { projectPath } : {}),
              turn:
                turn?.id === responseTurnId
                  ? turn
                  : isThreadSpawnSubAgent
                    ? conversationTurn(responseTurnId, false)
                    : undefined,
              date: dateFromTimestamp(timestamp, sessionDate),
              rawTimestamp,
              timestamp,
              hour: hourFromTimestamp(timestamp),
              model: currentModel,
              evidence: usageEvidence({ modelSource: modelFromTurn ? 'response' : 'session' }),
              inputTokens: exclusive.inputTokens,
              outputTokens: exclusive.outputTokens,
              cacheReadTokens: exclusive.cacheReadTokens,
              cacheWriteTokens: exclusive.cacheWriteTokens,
              reasoningTokens: exclusive.reasoningTokens,
              totalTokens: usage.inputTokens + usage.outputTokens,
            }
            if (isApiCallInWindow(call, scanContext)) responseCalls.set(call.apiCallId, call)
            responseUsage.add(codexUsageSignature(usage), responseTurnId, call)
            continue
          }

          // 官方迁移把旧子 Agent 的全部记录都放在界面投影边界之前，其中既有父线程复制来的
          // 轮次，也有子线程自己的轮次。复制轮次早于子线程创建，自有轮次的 UUIDv7 ID 不早于
          // 创建时间；边界前从首个自有轮次起按常规规则统计。原生 rollout 的边界前只有继承
          // 上下文，旧 token_count 仍然排除，不用累计差额推造 API 调用。
          if (subAgentHistoryStartOrdinal !== null && !subAgentBoundaryApplied) {
            const inherited = ordinal === null || ordinal < subAgentHistoryStartOrdinal
            if (inherited && !subAgentOwnHistoryStarted)
              subAgentOwnHistoryStarted = startsOwnCodexTurn(type, obj.payload, threadCreatedMs)
            if (inherited && !subAgentOwnHistoryStarted) {
              const payload = obj.payload
              if (type === 'event_msg' && isObject(payload) && payload.type === 'token_count') {
                const info = payload.info
                const usage = isObject(info) ? readCodexUsage(info.last_token_usage) : null
                const response = usage
                  ? responseUsage.match(codexUsageSignature(usage), readString(payload.turn_id))
                  : undefined
                if (response && usage) {
                  const { timestamp } = timestampsFromValue(obj.timestamp, sessionDate)
                  const cumulative = readCodexUsage(isObject(info) ? info.total_token_usage : null)
                  if (isApiCallInWindow(response, scanContext)) {
                    responseCalls.set(response.apiCallId, response)
                    replacements.set(
                      codexApiCallId(
                        sessionId,
                        timestamp,
                        currentModel,
                        cumulative ? codexUsageSignature(cumulative) : '',
                        usage,
                      ),
                      response.apiCallId,
                    )
                  }
                }
              }
              continue
            }
            if (!inherited) {
              // 迁移后的续写跨过边界时，边界前已统计的自有轮次保持连续。
              if (!subAgentOwnHistoryStarted) resetInheritedUsage()
              subAgentBoundaryApplied = true
            }
          }

          if (type === 'turn_context') {
            const payload = obj.payload
            if (isObject(payload)) {
              currentTurnId = readString(payload.turn_id) || currentTurnId
              projectPath = projectPath || extractProjectPath(payload) || ''
              sessionTitle = preferSessionTitle(
                sessionTitle,
                readString(payload.summary) || readString(payload.name),
              )
              const currentDate = readCodexDate(payload.current_date)
              if (currentDate) sessionDate = currentDate
            }
          }

          // Codex fork 子 Agent 时会把父会话历史复制到新 rollout。通信元数据标记了
          // 子 Agent 真正开始工作的边界；边界前的 token_count 已在父会话统计过。
          // 带官方投影边界的 rollout 已按轮次归属，后续通信不能清空自有轮次。
          if (
            subAgentHistoryStartOrdinal === null &&
            type === 'inter_agent_communication_metadata' &&
            (isThreadSpawnSubAgent || Boolean(forkedFromSessionId) || copiedSessionMetaSeen) &&
            !subAgentBoundaryApplied
          ) {
            resetInheritedUsage()
            subAgentBoundaryApplied = true
          }

          if (type !== 'event_msg') {
            generationEstimate.observe(obj, sessionId, currentTurnId || turn?.id || '')
          }
          if (type === 'event_msg') {
            const payload = obj.payload
            if (isObject(payload) && payload.type === 'task_started') {
              currentTurnId = readString(payload.turn_id)
              turn = undefined
            }
            if (
              isObject(payload) &&
              payload.type === 'item_completed' &&
              isObject(payload.item) &&
              payload.item.type === 'UserMessage'
            ) {
              turn = conversationTurn(
                readString(payload.turn_id) ||
                  currentTurnId ||
                  readString(payload.item.client_id) ||
                  readString(payload.item.id),
                !isThreadSpawnSubAgent,
              )
            }
            if (isObject(payload) && payload.type === 'user_message') {
              sessionTitle = keepFirstSessionTitle(sessionTitle, readString(payload.message))
              turn = conversationTurn(
                currentTurnId ||
                  readString(payload.client_id) ||
                  `user:${readString(obj.timestamp)}:${ordinal ?? byteOffset}`,
                !isThreadSpawnSubAgent,
              )
            }
            generationEstimate.observe(obj, sessionId, currentTurnId || turn?.id || '')
            if (
              isObject(payload) &&
              (payload.type === 'user_message' ||
                (payload.type === 'item_completed' &&
                  isObject(payload.item) &&
                  payload.item.type === 'UserMessage'))
            )
              latestTurn.start(sessionId, turn?.id, obj.timestamp)
            if (isObject(payload) && payload.type === 'task_complete')
              latestTurn.finish(
                sessionId,
                'completed',
                obj.timestamp,
                readString(payload.turn_id) || turn?.id,
              )
            if (isObject(payload) && payload.type === 'turn_aborted')
              latestTurn.finish(
                sessionId,
                'interrupted',
                obj.timestamp,
                readString(payload.turn_id) || turn?.id,
              )
            const firstToken = codexTurnFirstToken(obj, sessionId, currentTurnId)
            if (firstToken) turnFirstToken = latestTurnFirstToken(turnFirstToken, firstToken)
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
              const physicalProgress =
                !cumulative ||
                !previousCumulative ||
                cumulative.inputTokens + cumulative.outputTokens !==
                  previousCumulative.inputTokens + previousCumulative.outputTokens

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
                  // 回退后可能从已有快照续算。保留计数段基线，供增量检查点恢复状态。
                  cumulativeSegmentBaseline = subtractCodexUsageOrThrow(
                    cumulative,
                    usage,
                    context.sessionFile,
                  )
                }
              }

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
                (isThreadSpawnSubAgent ||
                  Boolean(forkedFromSessionId) ||
                  subAgentBoundaryApplied) &&
                !inheritedCumulativeBaseline &&
                cumulative
              ) {
                inheritedCumulativeBaseline = subtractCodexUsage(
                  normalizeCodexUsageExclusive(cumulative),
                  acceptedUsage,
                )
              }
              const apiCall: TokenUsageApiCall = {
                turn,
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
                evidence: usageEvidence({
                  modelSource: modelFromTurn ? 'response' : 'session',
                }),
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
              const timing =
                !readString(payload.thread_id) || readString(payload.thread_id) === sessionId
                  ? generationEstimate.accept(
                      sessionId,
                      currentTurnId || turn?.id || '',
                      eventMs,
                      usage.outputTokens,
                      physicalProgress,
                      readString(payload.turn_id),
                    )
                  : undefined
              if (timing) apiCall.generationTiming = timing
              // 已接受用量进入检查点；窗口外 API 对象无需留在数组中。
              const response = responseUsage.match(
                codexUsageSignature(usage),
                readString(payload.turn_id) || currentTurnId || turn?.id || '',
              )
              if (response) {
                if (timing) response.generationTiming = timing
                if (apiCall.turn) response.turn = apiCall.turn
                if (
                  isApiCallInWindow(apiCall, scanContext) ||
                  isApiCallInWindow(response, scanContext)
                ) {
                  responseCalls.set(response.apiCallId, response)
                  replacements.set(apiCall.apiCallId, response.apiCallId)
                }
              } else if (isApiCallInWindow(apiCall, scanContext)) apiCalls.push(apiCall)
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
      }
    } catch (e) {
      throw new Error(`Codex rollout 文件不可读 (${context.sessionFile}): ${(e as Error).message}`)
    }

    // 累计快照会随上下文恢复、压缩和补发事件变化，不能据此否定已记录的请求。
    // 单次分桶仍逐条校验；快照仅用于重复与重置判断，不把差额生成额外调用。
    const finalState = snapshotState()
    for (const call of responseCalls.values()) apiCalls.push(call)
    return {
      session: {
        sessionId,
        title: sessionTitle,
        apiCalls,
        ...(replacements.size
          ? {
              apiCallReplacements: [...replacements].map(([previousApiCallId, apiCallId]) => ({
                previousApiCallId,
                apiCallId,
              })),
            }
          : {}),
        latestTurn: latestTurn.get(sessionId),
        ...(turnFirstToken ? { latestTurnFirstToken: turnFirstToken } : {}),
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

/** 同一线程的不同文件可能各有独立尾部，游标不能按线程或文件名中的 UUID 合并。 */
function codexRolloutSourceId(file: string): string {
  const logicalFile = file.endsWith('.jsonl.zst') ? file.slice(0, -4) : file
  const digest = createHash('sha256').update(canonicalPath(logicalFile)).digest('hex').slice(0, 32)
  return `path:${digest}`
}

/** 读取窗口独立于落库模式：全量刷新仍原子替换，但 Codex 可只重建最近一个月。 */
function codexReadContext(context: ScannerScanContext): ScannerScanContext {
  if (context.codexScope !== 'recent') return context
  return {
    ...context,
    mode: 'incremental',
    sinceMs: Math.max(context.sinceMs ?? 0, codexRecentStartMs(context.scanStartedAtMs)),
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
    if (checkpoint.state.responseUsageIncomplete) continue
    if ((checkpoint.state.lastEventMs ?? 0) < sinceMs) chosenIndex = index
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
  if (isAbsolute(value)) return existingCodexRollout(normalize(value))
  const homeCandidate = join(getCodexHomeDir(), value)
  const homeRollout = existingCodexRollout(homeCandidate)
  if (existsSync(homeRollout)) return normalize(homeRollout)
  const sqliteCandidate = join(dirname(dbPath), value)
  const sqliteRollout = existingCodexRollout(sqliteCandidate)
  return normalize(existsSync(sqliteRollout) ? sqliteRollout : homeRollout)
}

function existingCodexRollout(file: string): string {
  if (file.endsWith('.jsonl.zst') && existsSync(file.slice(0, -4))) return file.slice(0, -4)
  if (file.endsWith('.jsonl') && !existsSync(file) && existsSync(`${file}.zst`))
    return `${file}.zst`
  return file
}

function canonicalPath(value: string): string {
  // SQLite 线程索引可能保存 Windows 扩展路径，同一文件的目录遍历结果没有前缀。
  const logical =
    process.platform === 'win32'
      ? value.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '')
      : value
  const path = resolve(logical)
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
  /"type":\s*"(session_meta|turn_context|event_msg|inter_agent_communication_metadata|token_usage_record)"/
const CODEX_TOOL_OUTPUT_LINE = /"type":\s*"(function_call_output|custom_tool_call_output)"/
const CODEX_MODEL_OUTPUT_LINE =
  /"payload":\s*\{\s*"type":\s*"(reasoning|function_call|custom_tool_call)"/
/** 工具调用只在参数完整后落盘，没有可用作首字的开始时间。 */
const CODEX_TOOL_CALL_LINE = /"payload":\s*\{\s*"type":\s*"(function_call|custom_tool_call)"/
const CODEX_ASSISTANT_MESSAGE_LINE = /"payload":\s*\{\s*"type":\s*"message"/

function isCodexModelOutputLine(line: string): boolean {
  return (
    /"type":\s*"response_item"/.test(line) &&
    (CODEX_MODEL_OUTPUT_LINE.test(line) ||
      (CODEX_ASSISTANT_MESSAGE_LINE.test(line) && /"role":\s*"assistant"/.test(line)))
  )
}

function isCodexRelevantLine(line: string): boolean {
  return CODEX_RELEVANT_LINE.test(line) || CODEX_TOOL_OUTPUT_LINE.test(line)
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

function assertCodexUsageBuckets(usage: CodexUsageSnapshot, sessionFile: string): void {
  if (
    usage.cacheReadTokens + usage.cacheWriteTokens > usage.inputTokens ||
    usage.reasoningTokens > usage.outputTokens
  )
    throw new Error(`Codex token 字段重叠关系无效 (${sessionFile})`)
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

/** UUIDv7 的前 48 位是毫秒时间；迁移合成的 rollout-N 等其他 ID 无法据此判断先后。 */
function uuidV7Ms(value: string): number {
  const match = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(
    value,
  )
  return match ? Number.parseInt(match[1] + match[2], 16) : 0
}

/** 子线程创建后才生成的轮次属于它自己；复制自父线程的轮次一定更早。 */
function startsOwnCodexTurn(type: string, payload: unknown, threadCreatedMs: number): boolean {
  if (threadCreatedMs <= 0 || !isObject(payload)) return false
  const marker =
    type === 'turn_context' ||
    (type === 'event_msg' && (payload.type === 'task_started' || payload.type === 'token_count'))
  return marker && uuidV7Ms(readString(payload.turn_id)) >= threadCreatedMs
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
      } else if (e.isFile()) {
        if (e.name.endsWith('.jsonl')) out.push(full)
        else if (e.name.endsWith('.jsonl.zst') && !existsSync(full.slice(0, -4))) out.push(full)
      }
    }
  }
  walk(root, true)
  return out.sort()
}
