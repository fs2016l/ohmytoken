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
import { existsSync } from 'fs'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'
import { getMavisDbCandidates } from '../lib/paths'
import { formatDateFromMs } from '../lib/date-utils'
import Database from 'better-sqlite3'
import {
  applySessionTitles,
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  hourFromTimestamp,
  timestampsFromValue,
} from './detail-utils'
import {
  filterApiCallsForContext,
  isIncrementalContext,
  normalizeScanContext,
} from './incremental-utils'

/** better-sqlite3 查询值类型 */
type DbValue = number | string | bigint | Uint8Array | null

type SessionMetadata = {
  titles: Map<string, string>
  userSessionIds: Set<string> | null
}

type UsageTableName = 'token_usage' | 'local_runtime_token_usage'

export class MiniMaxCodeScanner implements AgentScanner {
  readonly agentName = 'minimax-code'

  private resolveDbPath(): string | null {
    return getMavisDbCandidates().find(existsSync) ?? null
  }

  isAvailable(): boolean {
    return this.resolveDbPath() !== null
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    const records: TokenUsageRecord[] = []
    const apiCalls: TokenUsageApiCall[] = []
    const titleBySessionId = new Map<string, string>()
    const dbPath = this.resolveDbPath()
    if (!dbPath) return { records, sessions: [], apiCalls }

    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true })
      db.exec('PRAGMA busy_timeout = 5000')

      const usageTable = resolveUsageTable(db)
      if (!usageTable) {
        throw new Error('兼容的用量表不存在（token_usage / local_runtime_token_usage）')
      }

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

      // 必须列检查
      if (!hasTs || !hasInput || !hasOutput) {
        throw new Error(`${usageTable} 表缺少 ts/input_tokens/output_tokens 必要列`)
      }

      const sessionMetadata =
        usageTable === 'local_runtime_token_usage'
          ? readRuntimeSessionMetadata(db)
          : readLegacySessionMetadata(db)

      // 动态构建 SELECT
      const selectCols: string[] = ['rowid AS __rowid', 'ts']
      if (hasModel) selectCols.push('model')
      if (hasSessionId) selectCols.push('session_id')
      if (hasConversationId) selectCols.push('conversation_id')
      if (hasThreadId) selectCols.push('thread_id')
      if (hasChatId) selectCols.push('chat_id')
      if (titleColumn) selectCols.push(titleColumn)
      if (hasId) selectCols.push('id')
      if (hasRequestId) selectCols.push('request_id')
      if (hasMessageId) selectCols.push('message_id')
      if (hasInput) selectCols.push('input_tokens')
      if (hasOutput) selectCols.push('output_tokens')
      if (hasReasoning) selectCols.push('reasoning_tokens')
      if (hasCacheRead) selectCols.push('cache_read_tokens')
      if (hasCacheWrite) selectCols.push('cache_write_tokens')
      const whereSql = isIncrementalContext(scanContext) ? ' WHERE ts >= ?' : ''
      const params: QueryParam[] = isIncrementalContext(scanContext) ? [scanContext.sinceMs] : []
      const sql = `SELECT ${selectCols.join(', ')} FROM ${usageTable}${whereSql}`

      for (const row of queryAll(db, sql, params)) {
        const ts = toLong(row.ts)
        let model = hasModel && typeof row.model === 'string' ? row.model : 'unknown'
        if (!model) model = 'unknown'

        const input = hasInput ? toLong(row.input_tokens) : 0
        const output = hasOutput ? toLong(row.output_tokens) : 0
        const reasoning = hasReasoning ? toLong(row.reasoning_tokens) : 0
        const cacheRd = hasCacheRead ? toLong(row.cache_read_tokens) : 0
        const cacheWr = hasCacheWrite ? toLong(row.cache_write_tokens) : 0

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
        const sessionId = sourceSessionId ?? `aggregate:${date}:${model}`
        const rowId =
          firstString(row.id, row.request_id, row.message_id) ?? String(toLong(row.__rowid))
        const sessionTitle = sourceSessionId ? sessionMetadata.titles.get(sourceSessionId) : ''
        const tokenUsageTitle = titleColumn ? dbString(row[titleColumn]) : ''
        const title = sessionTitle || tokenUsageTitle
        if (sourceSessionId && title && !titleBySessionId.has(sourceSessionId)) {
          titleBySessionId.set(sourceSessionId, title)
        }

        apiCalls.push({
          agent: this.agentName,
          apiCallId: rowId,
          sessionId,
          date,
          rawTimestamp,
          timestamp,
          hour: hourFromTimestamp(timestamp),
          model,
          inputTokens: input,
          outputTokens: output,
          cacheReadTokens: cacheRd,
          cacheWriteTokens: cacheWr,
          // MiniMax 官方口径 total = input + output + cacheRead + cacheWrite + reasoning
          // 已用 token_usage.raw 字段验证：raw.total == 五项之和（全表 162/162 行吻合）
          totalTokens: input + output + cacheRd + cacheWr + reasoning,
          reasoningTokens: reasoning,
        })
      }
    } catch (e) {
      throw new Error(`MiniMax Code 扫描失败: ${(e as Error).message}`)
    } finally {
      if (db) db.close()
    }

    const batchApiCalls = filterApiCallsForContext(apiCalls, scanContext)
    const sessions = buildSessionsFromApiCalls(this.agentName, batchApiCalls)
    applySessionTitles(sessions, titleBySessionId)
    records.push(...buildRecordsFromSessions(this.agentName, sessions))

    return {
      records,
      sessions,
      apiCalls: batchApiCalls,
    }
  }
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
  if (names.has('token_usage')) return 'token_usage'
  if (names.has('local_runtime_token_usage')) return 'local_runtime_token_usage'
  return null
}

function emptySessionMetadata(): SessionMetadata {
  return {
    titles: new Map<string, string>(),
    userSessionIds: null,
  }
}

function readLegacySessionMetadata(db: Database.Database): SessionMetadata {
  const metadata: SessionMetadata = {
    titles: new Map<string, string>(),
    userSessionIds: null,
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
  const selectCols = ['session_id']
  if (hasTitle) selectCols.push('title')
  if (hasSessionType) {
    selectCols.push('session_type')
    metadata.userSessionIds = new Set<string>()
  }

  for (const row of queryAll(db, `SELECT ${selectCols.join(', ')} FROM sessions`)) {
    const sessionId = dbString(row.session_id)
    if (!sessionId) continue

    if (hasTitle) {
      const title = dbString(row.title)
      if (title) metadata.titles.set(sessionId, title)
    }
    if (metadata.userSessionIds && toLong(row.session_type) === 0) {
      metadata.userSessionIds.add(sessionId)
    }
  }

  return metadata
}

function readRuntimeSessionMetadata(db: Database.Database): SessionMetadata {
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
  if (!columns.has('session_id') || !columns.has('record_json')) return metadata

  const userSessionIds = new Set<string>()
  let hasOriginMetadata = false
  for (const row of queryAll(db, 'SELECT session_id, record_json FROM local_runtime_sessions')) {
    const sessionId = dbString(row.session_id)
    const recordJson = dbString(row.record_json)
    if (!sessionId || !recordJson) continue

    let record: unknown
    try {
      record = JSON.parse(recordJson)
    } catch {
      continue
    }
    if (!isObject(record)) continue

    const title = typeof record.title === 'string' ? record.title.trim() : ''
    if (title) metadata.titles.set(sessionId, title)

    if (typeof record.origin === 'string') {
      hasOriginMetadata = true
      if (record.origin === 'user') userSessionIds.add(sessionId)
    }
  }
  if (hasOriginMetadata) metadata.userSessionIds = userSessionIds
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
