/**
 * MiniMax Code Scanner（对应 Java MiniMaxCodeScanner.java）
 *
 * 扫描 MiniMax Code 的 sqlite 数据库：
 * - Windows/macOS 3.x：local_runtime_token_usage + local_runtime_sessions
 * - 旧版兼容：token_usage + sessions
 *
 * 必须列：ts, input_tokens, output_tokens（缺失则放弃扫描）
 * 可选列：model, reasoning_tokens, cache_read_tokens, cache_write_tokens
 *
 * totalTokens = input + output + cacheRead + cacheWrite + reasoning（MiniMax 官方 raw.total 口径）
 * 注意：cache_read_tokens 是独立列，未含在 input_tokens 中，与 Codex 不同，不可照搬 input+output 口径
 */
import { existsSync, readFileSync } from 'fs'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'
import { getMavisConfigCandidates, getMavisDbCandidates } from '../lib/paths'
import { formatDateFromMs } from '../lib/date-utils'
import Database from 'better-sqlite3'
import { usageEvidence } from '../cost/usage-evidence'
import {
  applySessionTitles,
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  hourFromTimestamp,
  timestampsFromValue,
} from './detail-utils'
import { isIncrementalContext, normalizeScanContext } from './incremental-utils'
import { extractProjectPath, normalizeCollectedProjectPath } from './project-path'
import { tokenBuckets } from './token-usage'
import { readMiniMaxLatestGenerations } from './minimax-generation-timing'
import { latestGeneration } from '../../shared/generation-timing'
import type { LatestGeneration } from '../../shared/models'

/** better-sqlite3 查询值类型 */
type DbValue = number | string | bigint | Uint8Array | null

type SessionMetadata = {
  titles: Map<string, string>
  projectPaths: Map<string, string>
  /** 旧版 sessions.session_type 的用户白名单；null 表示不按白名单过滤。 */
  userSessionIds: Set<string> | null
  /** 新版 record.origin 的显式非用户会话；null 表示不按黑名单过滤。 */
  nonUserSessionIds: Set<string> | null
  /** 最近变化或仍在运行的会话；消息写入不一定推进会话更新时间。 */
  timingSessionIds: Set<string>
}

type UsageTableName = 'token_usage' | 'local_runtime_token_usage'

export class MiniMaxCodeScanner implements AgentScanner {
  readonly agentName = 'minimax-code'

  private resolveDbPaths(): string[] {
    const seen = new Set<string>()
    return getMavisDbCandidates().filter((candidate) => {
      if (!existsSync(candidate)) return false
      const key = databaseSourceKey(candidate)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  isAvailable(): boolean {
    return this.resolveDbPaths().length > 0
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    const records: TokenUsageRecord[] = []
    const apiCalls: TokenUsageApiCall[] = []
    const titleBySessionId = new Map<string, string>()
    const generationBySessionId = new Map<string, LatestGeneration>()
    const dbPaths = this.resolveDbPaths()
    if (dbPaths.length === 0) return { records, sessions: [], apiCalls }

    const failures: string[] = []
    const dedup = createMiniMaxDedupState()
    let recognizedDatabaseCount = 0
    for (const dbPath of dbPaths) {
      try {
        const result = this.scanDatabase(
          dbPath,
          scanContext,
          dedup,
          readMiniMaxConfiguredModel(dbPath),
        )
        if (!result.recognized) {
          failures.push(`${dbPath}: 未找到兼容的用量表`)
          continue
        }
        recognizedDatabaseCount += 1
        apiCalls.push(...result.apiCalls)
        for (const sample of result.latestGenerations) {
          generationBySessionId.set(
            sample.sessionId,
            latestGeneration(generationBySessionId.get(sample.sessionId), sample)!,
          )
        }
        for (const [sessionId, title] of result.titles) {
          if (!titleBySessionId.has(sessionId)) titleBySessionId.set(sessionId, title)
        }
      } catch (error) {
        failures.push(`${dbPath}: ${(error as Error).message}`)
      }
    }

    if (recognizedDatabaseCount === 0) {
      throw new Error(`MiniMax Code 扫描失败: ${failures.join('; ')}`)
    }
    if (scanContext.strict && failures.length)
      throw new Error(`MiniMax Code 来源读取不完整: ${failures.join('; ')}`)

    // 用量仍按原请求时间进入批次；计时独立回填，不把历史 API 重播到用量窗口。
    const batchApiCalls = apiCalls
    const sessions = buildSessionsFromApiCalls(this.agentName, batchApiCalls)
    applySessionTitles(sessions, titleBySessionId)
    for (const session of sessions)
      session.latestGeneration = generationBySessionId.get(session.sessionId)
    records.push(...buildRecordsFromSessions(this.agentName, sessions))

    return {
      records,
      sessions,
      apiCalls: batchApiCalls,
      latestGenerations: [...generationBySessionId.values()],
    }
  }

  private scanDatabase(
    dbPath: string,
    scanContext: ScannerScanContext,
    dedup: MiniMaxDedupState,
    configuredModel: string,
  ): {
    recognized: boolean
    apiCalls: TokenUsageApiCall[]
    titles: Map<string, string>
    latestGenerations: LatestGeneration[]
  } {
    const apiCalls: TokenUsageApiCall[] = []
    const titles = new Map<string, string>()
    let latestGenerations: LatestGeneration[] = []
    const pendingContentFingerprints = new Set<string>()
    const pendingIdentityFingerprints = new Set<string>()
    const sourceKey = databaseSourceKey(dbPath)
    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true })
      db.exec('PRAGMA busy_timeout = 5000')

      const usageTable = resolveUsageTable(db)
      if (!usageTable) return { recognized: false, apiCalls, titles, latestGenerations }
      const callIdPrefix = databaseCallIdPrefix(dbPath, usageTable)

      // 动态检测列
      const columns = new Map<string, string>()
      for (const row of queryAll(db, `PRAGMA table_info(${usageTable})`)) {
        const name = row.name
        if (typeof name === 'string') columns.set(name.toLowerCase(), name)
      }

      const has = (...names: string[]) => names.every((n) => columns.has(n.toLowerCase()))
      const hasModel = has('model')
      const hasTs = has('ts')
      const hasInput = has('input_tokens')
      const hasOutput = has('output_tokens')
      const hasReasoning = has('reasoning_tokens')
      const hasCacheRead = has('cache_read_tokens')
      const hasCacheWrite = has('cache_write_tokens')
      const hasSessionId = has('session_id')
      const hasConversationId = has('conversation_id')
      const hasThreadId = has('thread_id')
      const hasChatId = has('chat_id')
      const hasId = has('id')
      const hasRequestId = has('request_id')
      const hasMessageId = has('message_id')
      const titleColumn = firstExistingColumn(columns, [
        'title',
        'session_title',
        'conversation_title',
        'conversationTitle',
        'name',
        'summary',
      ])
      const projectPathColumn = firstExistingColumn(columns, [
        'directory',
        'cwd',
        'workspace_path',
        'workspace',
        'project_path',
      ])

      // 必须列检查
      if (!hasTs || !hasInput || !hasOutput) {
        throw new Error(`${usageTable} 表缺少 ts/input_tokens/output_tokens 必要列`)
      }

      const sessionMetadata =
        usageTable === 'local_runtime_token_usage'
          ? readRuntimeSessionMetadata(db, scanContext)
          : readLegacySessionMetadata(db)

      // 动态构建 SELECT
      const selectCols: string[] = ['rowid AS __rowid', 'ts']
      if (hasModel) selectCols.push('model')
      if (hasSessionId) selectCols.push('session_id')
      if (has('turn_id')) selectCols.push('turn_id')
      if (hasConversationId) selectCols.push('conversation_id')
      if (hasThreadId) selectCols.push('thread_id')
      if (hasChatId) selectCols.push('chat_id')
      if (titleColumn) selectCols.push(titleColumn)
      if (projectPathColumn) selectCols.push(projectPathColumn)
      if (hasId) selectCols.push('id')
      if (hasRequestId) selectCols.push('request_id')
      if (hasMessageId) selectCols.push('message_id')
      if (hasInput) selectCols.push('input_tokens')
      if (hasOutput) selectCols.push('output_tokens')
      if (hasReasoning) selectCols.push('reasoning_tokens')
      if (hasCacheRead) selectCols.push('cache_read_tokens')
      if (hasCacheWrite) selectCols.push('cache_write_tokens')
      const selectSql = `SELECT ${selectCols.join(', ')} FROM ${usageTable}`
      const sql = isIncrementalContext(scanContext) ? `${selectSql} WHERE ts >= ?` : selectSql
      const params: QueryParam[] = isIncrementalContext(scanContext) ? [scanContext.sinceMs] : []

      const usageRows = queryAll(db, sql, params)
      if (usageTable === 'local_runtime_token_usage') {
        const timingSessionIds = new Set(sessionMetadata.timingSessionIds)
        for (const row of usageRows) {
          const sessionId = dbString(row.session_id)
          if (sessionId) timingSessionIds.add(sessionId)
        }
        latestGenerations = [
          ...readMiniMaxLatestGenerations(
            db,
            [...timingSessionIds].filter((id) => !sessionMetadata.nonUserSessionIds?.has(id)),
            configuredModel,
          ).values(),
        ]
      }
      for (const row of usageRows) {
        const ts = toLong(row.ts)
        const rowModel = hasModel && typeof row.model === 'string' ? row.model.trim() : ''
        // 新版 runtime 的 model 列常为 NULL；config.yaml 的 defaultModel 是最后的模型依据。
        const model = rowModel || configuredModel || 'unknown'
        const modelFromConfig = rowModel === '' && configuredModel !== ''

        const buckets = tokenBuckets({
          inputTokens: hasInput ? row.input_tokens : 0,
          outputTokens: hasOutput ? row.output_tokens : 0,
          reasoningTokens: hasReasoning ? row.reasoning_tokens : 0,
          cacheReadTokens: hasCacheRead ? row.cache_read_tokens : 0,
          cacheWriteTokens: hasCacheWrite ? row.cache_write_tokens : 0,
        })
        if (buckets.totalTokens <= 0) continue

        const date = ts > 0 ? formatDateFromMs(ts) : 'unknown'
        const { timestamp, rawTimestamp } = timestampsFromValue(ts, date)
        const sourceSessionId = firstString(
          row.session_id,
          row.conversation_id,
          row.thread_id,
          row.chat_id,
        )
        if (
          sourceSessionId &&
          sessionMetadata.userSessionIds &&
          !sessionMetadata.userSessionIds.has(sourceSessionId)
        ) {
          continue
        }
        // 新版 record.json 已无 origin 字段；仅显式标记的非用户会话排除，未知格式照常计量。
        if (sourceSessionId && sessionMetadata.nonUserSessionIds?.has(sourceSessionId)) {
          continue
        }
        const sessionId = sourceSessionId ?? `aggregate:${date}:${model}`
        const stableRowId = firstString(row.id, row.request_id, row.message_id)
        const rowId = stableRowId ?? String(toLong(row.__rowid))
        const sessionTitle = sourceSessionId ? sessionMetadata.titles.get(sourceSessionId) : ''
        const tokenUsageTitle = titleColumn ? dbString(row[titleColumn]) : ''
        const title = sessionTitle || tokenUsageTitle
        if (sourceSessionId && title && !titles.has(sourceSessionId)) {
          titles.set(sourceSessionId, title)
        }

        const contentFingerprint = usageFingerprint(
          sourceSessionId,
          ts,
          model,
          buckets.inputTokens,
          buckets.outputTokens,
          buckets.cacheReadTokens,
          buckets.cacheWriteTokens,
          buckets.reasoningTokens,
        )
        const identityFingerprint = stableRowId
          ? usageIdentityFingerprint(sourceSessionId, stableRowId)
          : ''
        if (
          isDuplicateFromAnotherDatabase(dedup.contentSources, contentFingerprint, sourceKey) ||
          (identityFingerprint &&
            isDuplicateFromAnotherDatabase(dedup.identitySources, identityFingerprint, sourceKey))
        ) {
          continue
        }
        pendingContentFingerprints.add(contentFingerprint)
        if (identityFingerprint) pendingIdentityFingerprints.add(identityFingerprint)

        const projectPath =
          (projectPathColumn ? normalizeCollectedProjectPath(row[projectPathColumn]) : undefined) ||
          (sourceSessionId ? sessionMetadata.projectPaths.get(sourceSessionId) : '')

        apiCalls.push({
          agent: this.agentName,
          apiCallId: `${callIdPrefix}:${rowId}`,
          sessionId,
          ...(projectPath ? { projectPath } : {}),
          date,
          rawTimestamp,
          timestamp,
          hour: hourFromTimestamp(timestamp),
          model,
          evidence: usageEvidence({
            bucketQuality: hasInput && hasOutput ? 'verified' : 'uncertain',
            modelSource: modelFromConfig ? 'current-config' : 'response',
          }),
          // MiniMax 官方口径 total = input + output + cacheRead + cacheWrite + reasoning
          // 已用 token_usage.raw 字段验证：raw.total == 五项之和（全表 162/162 行吻合）
          ...buckets,
        })
      }
    } finally {
      if (db) db.close()
    }
    for (const fingerprint of pendingContentFingerprints) {
      dedup.contentSources.set(fingerprint, sourceKey)
    }
    for (const fingerprint of pendingIdentityFingerprints) {
      dedup.identitySources.set(fingerprint, sourceKey)
    }
    return { recognized: true, apiCalls, titles, latestGenerations }
  }
}

interface MiniMaxDedupState {
  contentSources: Map<string, string>
  identitySources: Map<string, string>
}

/** 从 config.yaml 文本提取顶层 defaultModel；嵌套键与损坏内容一律返回空串。 */
export function miniMaxDefaultModelFromText(text: string): string {
  const match = /^defaultModel:[ \t]*(.+)$/m.exec(text)
  const value = match?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? ''
  return value
}

/** 读取 config.yaml 顶层 defaultModel 作为 model 为空用量行的兜底；保留 minimax/ 命名空间。 */
function readMiniMaxConfiguredModel(dbPath: string): string {
  for (const candidate of getMavisConfigCandidates(dbPath)) {
    try {
      const model = miniMaxDefaultModelFromText(readFileSync(candidate, 'utf8'))
      if (model) return model
    } catch {
      // 配置缺失或不可读时继续尝试下一个候选。
    }
  }
  return ''
}

function createMiniMaxDedupState(): MiniMaxDedupState {
  return {
    contentSources: new Map<string, string>(),
    identitySources: new Map<string, string>(),
  }
}

function databaseSourceKey(dbPath: string): string {
  return process.platform === 'win32' ? dbPath.toLowerCase() : dbPath
}

function databaseCallIdPrefix(dbPath: string, usageTable: UsageTableName): string {
  if (usageTable === 'local_runtime_token_usage') return 'runtime'
  const normalizedPath = dbPath.replaceAll('\\', '/').toLowerCase()
  return normalizedPath.includes('/.mavis/') ? 'legacy-mavis' : 'legacy-minimax'
}

function usageFingerprint(
  sessionId: string | null,
  timestampMs: number,
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  reasoning: number,
): string {
  return JSON.stringify([
    sessionId ?? '',
    timestampMs,
    model,
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
  ])
}

function usageIdentityFingerprint(sessionId: string | null, rowId: string): string {
  return JSON.stringify([sessionId ?? '', rowId])
}

function isDuplicateFromAnotherDatabase(
  sources: Map<string, string>,
  fingerprint: string,
  sourceKey: string,
): boolean {
  const previousSource = sources.get(fingerprint)
  return Boolean(previousSource && previousSource !== sourceKey)
}

/** 执行 SELECT，返回对象数组（列名 → 值） */
type QueryParam = string | number | bigint | null

function queryAll(
  db: Database.Database,
  sql: string,
  params: QueryParam[] = [],
): Record<string, DbValue>[] {
  return db.prepare(sql).all(...params) as Record<string, DbValue>[]
}

function resolveUsageTable(db: Database.Database): UsageTableName | null {
  const rows = queryAll(
    db,
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('token_usage', 'local_runtime_token_usage')`,
  )
  const names = new Set(
    rows.map((row) => dbString(row.name)).filter((name): name is UsageTableName => Boolean(name)),
  )
  if (names.has('local_runtime_token_usage')) return 'local_runtime_token_usage'
  if (names.has('token_usage')) return 'token_usage'
  return null
}

function emptySessionMetadata(): SessionMetadata {
  return {
    titles: new Map<string, string>(),
    projectPaths: new Map<string, string>(),
    userSessionIds: null,
    nonUserSessionIds: null,
    timingSessionIds: new Set(),
  }
}

function readLegacySessionMetadata(db: Database.Database): SessionMetadata {
  const metadata: SessionMetadata = {
    titles: new Map<string, string>(),
    projectPaths: new Map<string, string>(),
    userSessionIds: null,
    nonUserSessionIds: null,
    timingSessionIds: new Set(),
  }
  const tableRows = queryAll(
    db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'",
  )
  if (tableRows.length === 0) return metadata

  const columns = new Set<string>()
  for (const row of queryAll(db, 'PRAGMA table_info(sessions)')) {
    const name = row.name
    if (typeof name === 'string') columns.add(name.toLowerCase())
  }
  if (!columns.has('session_id')) return metadata

  const hasTitle = columns.has('title')
  const hasSessionType = columns.has('session_type')
  const projectPathColumn = [
    'directory',
    'cwd',
    'workspace_path',
    'workspace',
    'project_path',
  ].find((column) => columns.has(column))
  const selectCols = ['session_id']
  if (hasTitle) selectCols.push('title')
  if (hasSessionType) {
    selectCols.push('session_type')
    metadata.userSessionIds = new Set<string>()
  }
  if (projectPathColumn) selectCols.push(projectPathColumn)

  for (const row of queryAll(db, `SELECT ${selectCols.join(', ')} FROM sessions`)) {
    const sessionId = dbString(row.session_id)
    if (!sessionId) continue

    if (hasTitle) {
      const title = dbString(row.title)
      if (title) metadata.titles.set(sessionId, title)
    }
    if (projectPathColumn) {
      const projectPath = normalizeCollectedProjectPath(row[projectPathColumn])
      if (projectPath) metadata.projectPaths.set(sessionId, projectPath)
    }
    if (metadata.userSessionIds && toLong(row.session_type) === 0) {
      metadata.userSessionIds.add(sessionId)
    }
  }

  return metadata
}

export function readRuntimeSessionMetadata(
  db: Database.Database,
  scanContext?: ScannerScanContext,
): SessionMetadata {
  const metadata = emptySessionMetadata()
  const tableRows = queryAll(
    db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name='local_runtime_sessions'",
  )
  if (tableRows.length === 0) return metadata

  const columns = new Set<string>()
  for (const row of queryAll(db, 'PRAGMA table_info(local_runtime_sessions)')) {
    const name = row.name
    if (typeof name === 'string') columns.add(name.toLowerCase())
  }
  if (!columns.has('session_id')) return metadata

  const hasTitleColumn = columns.has('title')
  const hasRecordColumn = columns.has('record_json')
  const incremental = scanContext && isIncrementalContext(scanContext)
  const nonUserSessionIds = new Set<string>()
  let hasOriginMetadata = false
  const sessionColumns = [
    'session_id',
    ...(hasRecordColumn ? ['record_json'] : []),
    ...(hasTitleColumn ? ['title'] : []),
    ...['updated_at_ms', 'status'].filter((name) => columns.has(name)),
  ].join(', ')
  for (const row of queryAll(db, `SELECT ${sessionColumns} FROM local_runtime_sessions`)) {
    const sessionId = dbString(row.session_id)
    if (!sessionId) continue
    if (!incremental || toLong(row.updated_at_ms) >= (scanContext?.sinceMs ?? 1))
      metadata.timingSessionIds.add(sessionId)
    if (['started', 'running'].includes(dbString(row.status).toLowerCase()))
      metadata.timingSessionIds.add(sessionId)
    // 新版 runtime 将当前标题保存在独立列，record_json 可能没有 title 或仍是旧值。
    const columnTitle = hasTitleColumn ? dbString(row.title) : ''
    if (columnTitle) metadata.titles.set(sessionId, columnTitle)
    const recordJson = dbString(row.record_json)
    if (!recordJson) continue

    let record: unknown
    try {
      record = JSON.parse(recordJson)
    } catch {
      continue
    }
    if (!isObject(record)) continue
    if (
      typeof record.status === 'string' &&
      ['started', 'running'].includes(record.status.toLowerCase())
    )
      metadata.timingSessionIds.add(sessionId)

    if (!columnTitle) {
      const title = typeof record.title === 'string' ? record.title.trim() : ''
      if (title) metadata.titles.set(sessionId, title)
    }
    const projectPath = extractProjectPath(record)
    if (projectPath) metadata.projectPaths.set(sessionId, projectPath)

    // 新版 record.json 已无 origin 字段；只有显式非用户会话进入排除集，未知格式照常计量。
    if (typeof record.origin === 'string') {
      hasOriginMetadata = true
      if (record.origin !== 'user') nonUserSessionIds.add(sessionId)
    }
  }
  if (hasOriginMetadata) metadata.nonUserSessionIds = nonUserSessionIds
  return metadata
}

/** 将 DB 值转为整数 */
function toLong(v: DbValue): number {
  if (typeof v === 'number') return Math.trunc(v) || 0
  if (typeof v === 'bigint') return Number(v) || 0
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function firstString(...values: DbValue[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function dbString(value: DbValue): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function firstExistingColumn(columns: Map<string, string>, names: string[]): string | null {
  for (const name of names) {
    const actual = columns.get(name.toLowerCase())
    if (actual) return actual
  }
  return null
}
