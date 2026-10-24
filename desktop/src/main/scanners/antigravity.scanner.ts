import { existsSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import { usageEvidence } from '../cost/usage-evidence'
import { getAntigravityDataDir } from '../lib/paths'
import {
  applySessionTitles,
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  resolveRootSessionId,
  timestampsFromValue,
} from './detail-utils'
import { eventTimestampMs, isIncrementalContext, normalizeScanContext } from './incremental-utils'
import {
  ANTIGRAVITY_SOURCE_TYPE,
  antigravitySourceState,
  conversationFiles,
  shouldScanAntigravitySource,
  transcriptFiles,
} from './antigravity-sources'
import {
  getSourceStatesByType,
  type ScanSourceStateRow,
  type ScanSourceStateUpdate,
} from '../services/scan-source-state.service'
import { normalizeCollectedProjectPath } from './project-path'
import { tokenBuckets } from './token-usage'
import {
  antigravityGenerationTiming,
  completeAntigravityGenerationTiming,
} from './antigravity-generation-timing'
import {
  decodeAntigravityGeneration,
  decodeAntigravityStepMetadata,
  hasUsage,
  inconsistentBuckets,
  sameUsage,
  usageIdentity,
  type AntigravityGeneration,
  type AntigravityStepMetadata,
  type AntigravityUsage,
} from './antigravity-protobuf'
import {
  antigravityTurnForStep,
  antigravityUserInputSteps,
  readAntigravityTranscript,
} from './antigravity-transcript'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'

type DbRow = Record<string, unknown>
type SessionInfo = { title?: string; projectPath?: string; parentSessionId?: string; name?: string }
type Conversation = {
  steps: Map<number, AntigravityStepMetadata>
  generations: Array<{ idx: number; metadata: AntigravityGeneration }>
}

export class AntigravityScanner implements AgentScanner {
  readonly agentName = 'antigravity'
  private readonly dataDirectory: () => string
  private readonly sourceStates: readonly ScanSourceStateRow[] | undefined
  private pendingSourceStates: ScanSourceStateUpdate[] = []

  constructor(
    dataDirectory: () => string = getAntigravityDataDir,
    sourceStates?: readonly ScanSourceStateRow[],
  ) {
    this.dataDirectory = dataDirectory
    this.sourceStates = sourceStates
  }

  isAvailable(): boolean {
    try {
      const root = this.dataDirectory()
      return conversationFiles(root).size > 0 || transcriptFiles(root).size > 0
    } catch {
      return false
    }
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  takeScanStateUpdates(): ScanSourceStateUpdate[] {
    const updates = this.pendingSourceStates
    this.pendingSourceStates = []
    return updates
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    this.pendingSourceStates = []
    const scanContext = normalizeScanContext(context)
    // 每轮从成功提交的状态开始；失败或回滚的扫描不能让下一次错误跳过来源。
    const storedStates = new Map(
      (isIncrementalContext(scanContext)
        ? (this.sourceStates ?? getSourceStatesByType(this.agentName, ANTIGRAVITY_SOURCE_TYPE))
        : []
      ).map((state) => [state.source_id, state]),
    )
    const updates: ScanSourceStateUpdate[] = []
    const root = this.dataDirectory()
    const dbFiles = conversationFiles(root)
    const transcripts = transcriptFiles(root)
    const summaries = readSummaries(join(root, 'conversation_summaries.db'))
    const parentIds = new Map<string, string>()
    const titles = new Map<string, string>()
    for (const [id, info] of summaries) {
      if (info.parentSessionId) parentIds.set(id, info.parentSessionId)
      if (info.title) titles.set(id, info.title)
    }
    const sessionIds = [...new Set([...dbFiles.keys(), ...transcripts.keys()])].sort()
    const completeSessionIds: string[] = []
    const calls = new Map<string, TokenUsageApiCall>()
    scanContext.reportProgress?.({ unit: 'files', completed: 0, total: sessionIds.length })
    for (const [index, id] of sessionIds.entries()) {
      const dbFile = dbFiles.get(id)
      try {
        const transcript = transcripts.get(id)
        // 保存读取前的状态：读取期间又写入的数据会在下次扫描时重新检查。
        const state = antigravitySourceState(root, id, dbFile, transcript, [
          summaries.get(id),
          resolveRootSessionId(id, parentIds),
        ])
        if (shouldScanAntigravitySource(state, storedStates.get(state.source_id), scanContext)) {
          const conversation = dbFile ? readConversation(dbFile) : emptyConversation()
          const sessionCalls = new Map<string, TokenUsageApiCall>()
          this.collectConversation(id, conversation, transcript, sessionCalls)
          for (const call of sessionCalls.values()) {
            calls.set(call.apiCallId, call)
            state.event_watermark_ms = Math.max(state.event_watermark_ms, eventTimestampMs(call))
          }
          completeSessionIds.push(id)
          updates.push(state)
        }
      } catch (error) {
        throw new Error(
          `Antigravity 会话不可读 (${dbFile ?? transcripts.get(id)}): ${message(error)}`,
        )
      }
      scanContext.reportProgress?.({
        unit: 'files',
        completed: index + 1,
        total: sessionIds.length,
      })
    }
    const apiCalls = [...calls.values()]
    for (const call of apiCalls) {
      const info = summaries.get(call.sessionId)
      if (info?.projectPath) call.projectPath = info.projectPath
      if (info?.parentSessionId) {
        call.parentSessionId = info.parentSessionId
        call.rootSessionId = resolveRootSessionId(call.sessionId, parentIds)
        if (info.name) call.subAgentName = info.name
        // 子代理由父会话派发，其输入不是新的用户请求。
        if (call.turn) call.turn = { ...call.turn, userInitiated: false }
      }
    }
    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    applySessionTitles(sessions, titles)
    this.pendingSourceStates = updates
    return {
      apiCalls,
      sessions,
      records: buildRecordsFromSessions(this.agentName, sessions),
      completeSessionIds,
    }
  }

  private collectConversation(
    sessionId: string,
    conversation: Conversation,
    transcript: string | undefined,
    calls: Map<string, TokenUsageApiCall>,
  ): void {
    const rows = transcript ? readAntigravityTranscript(transcript) : []
    const userSteps = antigravityUserInputSteps(conversation.steps, rows)
    const withTurn = (call: TokenUsageApiCall, step: number | undefined): TokenUsageApiCall => {
      const turn = antigravityTurnForStep(userSteps, step)
      if (turn) call.turn = turn
      return call
    }
    const coveredSteps = new Set<number>()
    const generationForStep = new Map<number, { id: string; metadata: AntigravityGeneration }>()
    const authoritative = new Set<string>()
    const identities = new Set<string>()
    const requests = new Map<
      string,
      {
        id: string
        call: TokenUsageApiCall
        usage: AntigravityUsage
        metadata: AntigravityGeneration
        toolCall: boolean
      }
    >()
    for (const { idx, metadata } of conversation.generations) {
      const linkedSteps = metadata.stepIndices
        .map((step) => conversation.steps.get(step))
        .filter((step): step is AntigravityStepMetadata => step !== undefined)
      const toolCall = linkedSteps.some((step) => step.toolCall)
      const primaryStepIndex = metadata.stepIndices[0]
      let id = primaryStepIndex === undefined ? `generation:${idx}` : `step:${primaryStepIndex}`
      const step = linkedSteps.find((step) => hasUsage(step.usage)) ?? linkedSteps[0]
      const usage = hasUsage(metadata.usage) ? metadata.usage : step?.usage
      const request = usageIdentity(usage)
      const duplicate = request ? requests.get(request) : undefined
      if (duplicate) id = duplicate.id
      else {
        if (identities.has(id)) id += `:generation:${idx}`
        identities.add(id)
      }
      for (const stepIndex of metadata.stepIndices) {
        coveredSteps.add(stepIndex)
        if (!generationForStep.has(stepIndex)) generationForStep.set(stepIndex, { id, metadata })
      }
      if (!hasUsage(usage)) continue
      const conflict = linkedSteps.some(
        (step) => hasUsage(step.usage) && !sameUsage(step.usage!, usage!),
      )
      const call = withTurn(
        this.apiCall(sessionId, id, usage!, metadata, linkedSteps, conflict),
        primaryStepIndex,
      )
      if (duplicate) {
        const previousModelId = duplicate.call.evidence?.modelId
        const currentModelId = call.evidence?.modelId
        const duplicateConflict =
          !sameUsage(duplicate.usage, usage!) ||
          (previousModelId && currentModelId && previousModelId !== currentModelId) ||
          conflict ||
          call.evidence?.bucketQuality === 'uncertain'
        duplicate.toolCall ||= toolCall
        if (duplicateConflict) duplicate.call.evidence!.bucketQuality = 'uncertain'
        else if (duplicate.call.evidence?.bucketQuality !== 'uncertain')
          duplicate.call.generationTiming = completeAntigravityGenerationTiming(
            duplicate.call.generationTiming,
            call.generationTiming,
            duplicate.toolCall,
          )
        if (!previousModelId && currentModelId) {
          duplicate.call.model = call.model
          duplicate.call.evidence!.modelId = currentModelId
          duplicate.call.evidence!.modelSource = 'response'
          duplicate.metadata = metadata
        }
        continue
      }
      calls.set(call.apiCallId, call)
      authoritative.add(call.apiCallId)
      if (request) requests.set(request, { id, call, usage: usage!, metadata, toolCall })
    }
    for (const [idx, step] of conversation.steps) {
      if (coveredSteps.has(idx) || !hasUsage(step.usage)) continue
      const request = usageIdentity(step.usage)
      const duplicate = request ? requests.get(request) : undefined
      if (duplicate) {
        if (!sameUsage(duplicate.usage, step.usage!) || inconsistentBuckets(step.usage!))
          duplicate.call.evidence!.bucketQuality = 'uncertain'
        generationForStep.set(idx, { id: duplicate.id, metadata: duplicate.metadata })
        continue
      }
      const call = withTurn(
        this.apiCall(sessionId, `step:${idx}`, step.usage!, {}, [step], false),
        idx,
      )
      calls.set(call.apiCallId, call)
      authoritative.add(call.apiCallId)
      if (request)
        requests.set(request, {
          id: `step:${idx}`,
          call,
          usage: step.usage!,
          metadata: { stepIndices: [idx] },
          toolCall: !!step.toolCall,
        })
    }
    for (const row of rows) {
      const usage = row.usage
      if (!hasUsage(usage)) continue
      const idx = row.stepIndex
      const generation = idx === undefined ? undefined : generationForStep.get(idx)
      const id = generation?.id ?? (idx === undefined ? `line:${row.byteOffset}` : `step:${idx}`)
      const apiCallId = `antigravity:${sessionId}:${id}`
      if (authoritative.has(apiCallId)) continue
      const step = idx === undefined ? undefined : conversation.steps.get(idx)
      // JSONL 兜底没有可核对的流窗口，只保留原生首 Token。
      const timingMetadata = { ...generation?.metadata, streamDurationMs: undefined }
      const call = withTurn(
        this.apiCall(sessionId, id, usage!, timingMetadata, step ? [step] : [], true),
        idx,
      )
      const collected = timestampsFromValue(row.createdAt, 'unknown')
      if (!call.rawTimestamp && collected.rawTimestamp) {
        Object.assign(call, collected)
        call.date = dateFromTimestamp(call.timestamp)
        call.hour = hourFromTimestamp(call.timestamp)
      }
      calls.set(apiCallId, call)
    }
  }

  private apiCall(
    sessionId: string,
    id: string,
    usage: AntigravityUsage,
    generation: Partial<AntigravityGeneration>,
    linkedSteps: readonly AntigravityStepMetadata[],
    uncertain: boolean,
  ): TokenUsageApiCall {
    const apiCallId = `antigravity:${sessionId}:${id}`
    const step = linkedSteps.find((linked) => hasUsage(linked.usage)) ?? linkedSteps[0]
    const reasoningTokens = Math.min(usage.outputTokens, usage.thinkingTokens)
    const outputTokens = usage.outputTokens - reasoningTokens
    const inconsistent = inconsistentBuckets(usage)
    // 思考在首个可见片段前生成，流窗口只对应可见正文；计量不确定时不计算速度。
    const visibleTokens = uncertain || inconsistent ? undefined : outputTokens
    const modelId = generation.responseModel
    const model = modelId ?? generation.displayName ?? 'unknown'
    const collected = timestampsFromValue(generation.startedAtMs ?? step?.createdAtMs, 'unknown')
    return {
      agent: this.agentName,
      apiCallId,
      sessionId,
      role: 'assistant',
      ...collected,
      date: dateFromTimestamp(collected.timestamp),
      hour: hourFromTimestamp(collected.timestamp),
      model,
      generationTiming: antigravityGenerationTiming(generation, step, linkedSteps, visibleTokens),
      ...tokenBuckets({
        inputTokens: usage.inputTokens,
        outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        reasoningTokens,
      }),
      evidence: usageEvidence({
        modelId,
        modelSource: modelId ? 'response' : 'session',
        bucketQuality: uncertain || inconsistent ? 'uncertain' : 'verified',
      }),
    }
  }
}

function readConversation(file: string): Conversation {
  return withReadonlyDatabase(file, (db) => {
    const result = emptyConversation()
    const tables = tableNames(db)
    if (!tables.has('gen_metadata') && !tables.has('steps'))
      throw new Error('缺少 Antigravity 用量表')
    if (tables.has('steps')) {
      requireColumns(db, 'steps', ['idx', 'metadata'])
      for (const row of db
        .prepare('SELECT idx, metadata FROM steps ORDER BY idx')
        .iterate() as Iterable<DbRow>) {
        const idx = count(row.idx)
        if (idx === undefined) throw new Error('steps.idx 无效')
        result.steps.set(idx, decodeAntigravityStepMetadata(blob(row.metadata)))
      }
    }
    if (tables.has('gen_metadata')) {
      requireColumns(db, 'gen_metadata', ['idx', 'data'])
      for (const row of db
        .prepare('SELECT idx, data FROM gen_metadata ORDER BY idx')
        .iterate() as Iterable<DbRow>) {
        const idx = count(row.idx)
        if (idx === undefined) throw new Error('gen_metadata.idx 无效')
        result.generations.push({ idx, metadata: decodeAntigravityGeneration(blob(row.data)) })
      }
    }
    return result
  })
}

function readSummaries(file: string): Map<string, SessionInfo> {
  const summaries = new Map<string, SessionInfo>()
  if (!existsSync(file)) return summaries
  try {
    return withReadonlyDatabase(file, (db) => {
      if (!tableNames(db).has('conversation_summaries')) return summaries
      const columns = columnNames(db, 'conversation_summaries')
      const idColumn = columns.has('conversation_id') ? 'conversation_id' : 'id'
      if (!columns.has(idColumn)) throw new Error('conversation_summaries 缺少会话 ID')
      const select = (name: string): string => (columns.has(name) ? name : `NULL AS ${name}`)
      const sql = `SELECT ${idColumn} AS id, ${select('title')}, ${select('workspace_uris')},
        ${select('parent_conversation_id')}, ${select('agent_name')} FROM conversation_summaries`
      for (const row of db.prepare(sql).iterate() as Iterable<DbRow>) {
        const id = text(row.id)
        if (!id) continue
        summaries.set(id, {
          title: text(row.title),
          parentSessionId: text(row.parent_conversation_id),
          name: text(row.agent_name),
          projectPath: workspacePath(row.workspace_uris),
        })
      }
      return summaries
    })
  } catch (error) {
    throw new Error(`Antigravity 会话摘要不可读 (${file}): ${message(error)}`)
  }
}

function withReadonlyDatabase<T>(file: string, read: (db: Database.Database) => T): T {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    // 普通只读连接保留 SQLite 的 WAL 可见性；一个 deferred 事务读取一致快照。
    return db.transaction(() => read(db))()
  } finally {
    db.close()
  }
}

function tableNames(db: Database.Database): Set<string> {
  return new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as DbRow[])
      .map((row) => text(row.name))
      .filter((name): name is string => name !== undefined),
  )
}

function columnNames(
  db: Database.Database,
  table: 'steps' | 'gen_metadata' | 'conversation_summaries',
): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as DbRow[])
      .map((row) => text(row.name))
      .filter((name): name is string => name !== undefined),
  )
}

function requireColumns(
  db: Database.Database,
  table: 'steps' | 'gen_metadata',
  expected: string[],
): void {
  const columns = columnNames(db, table)
  if (expected.some((column) => !columns.has(column))) throw new Error(`${table} 用量字段不兼容`)
}

function emptyConversation(): Conversation {
  return { steps: new Map(), generations: [] }
}

function blob(value: unknown): Uint8Array {
  if (value === null) return new Uint8Array()
  if (!(value instanceof Uint8Array)) throw new Error('用量 metadata 不是 protobuf BLOB')
  return value
}

function count(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined
  return value
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

function workspacePath(value: unknown): string | undefined {
  const raw = text(value)
  if (!raw) return undefined
  if (/^file:\/\//i.test(raw)) return normalizeCollectedProjectPath(raw)
  try {
    const paths: unknown = JSON.parse(raw)
    if (Array.isArray(paths))
      for (const path of paths) {
        const normalized = normalizeCollectedProjectPath(path)
        if (normalized) return normalized
      }
  } catch {
    return undefined
  }
  return undefined
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
