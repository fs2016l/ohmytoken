/**
 * Z Code Scanner（智谱 GLM Coding Plan）。
 *
 * 新版 Z Code 以 ~/.zcode/cli/db/db.sqlite 的 model_usage 为权威用量表。
 * input_tokens 已包含缓存输入，computed_total_tokens 才是总量口径，不能
 * 再把 cache_read 加一次。全量扫描还会补齐升级前仅存在于 message 的历史记录。
 */
import { existsSync } from 'fs'
import Database from 'better-sqlite3'
import { formatDateFromMs } from '../lib/date-utils'
import { getZCodeDbCandidates } from '../lib/paths'
import {
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  timestampsFromValue,
} from './detail-utils'
import { isIncrementalContext, normalizeScanContext } from './incremental-utils'
import {
  parseJsonObject,
  parseZCodeModel,
  readJsonObject,
  readJsonString,
  readJsonTimestamp,
  readJsonToken,
} from './zcode-json'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
  TokenUsageSession,
} from './types'

type DbValue = number | string | bigint | Uint8Array | null | undefined
type QueryParam = string | number | bigint | null

interface ModelUsageReadResult {
  apiCalls: TokenUsageApiCall[]
  referencedMessageIds: Set<string>
}

export class ZCodeScanner implements AgentScanner {
  readonly agentName = 'zcode'

  private resolveDbPath(): string | null {
    return getZCodeDbCandidates().find(existsSync) ?? null
  }

  isAvailable(): boolean {
    return this.resolveDbPath() !== null
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    const dbPath = this.resolveDbPath()
    if (!dbPath) return { records: [], sessions: [], apiCalls: [] }

    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true })
      db.exec('PRAGMA busy_timeout = 5000')

      const sessionById = readSessionMetadata(db, this.agentName)
      const modelUsageColumns = tableColumns(db, 'model_usage')
      const apiCalls: TokenUsageApiCall[] = []

      if (isUsableModelUsageSchema(modelUsageColumns)) {
        const modelUsage = this.readModelUsageApiCalls(
          db,
          modelUsageColumns,
          sessionById,
          scanContext,
        )
        apiCalls.push(...modelUsage.apiCalls)

        // 新版增量只读 model_usage。全量额外补齐迁移前没有对应
        // model_usage 行的历史 assistant message。
        if (!isIncrementalContext(scanContext)) {
          apiCalls.push(
            ...this.readMessageApiCalls(
              db,
              sessionById,
              scanContext,
              modelUsage.referencedMessageIds,
            ),
          )
        }
      } else {
        apiCalls.push(...this.readMessageApiCalls(db, sessionById, scanContext, new Set()))
      }

      const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
      const sessionIdsWithUsage = new Set(sessions.map((session) => session.sessionId))
      for (const session of sessions) {
        const meta = sessionById.get(session.sessionId)
        if (!meta) continue
        if (meta.parentSessionId) session.parentSessionId = meta.parentSessionId
        if (meta.rootSessionId) session.rootSessionId = meta.rootSessionId
        if (meta.title) session.title = meta.title
      }

      if (!isIncrementalContext(scanContext)) {
        for (const meta of sessionById.values()) {
          if (!sessionIdsWithUsage.has(meta.sessionId)) sessions.push(meta)
        }
      }

      const records = buildRecordsFromSessions(
        this.agentName,
        sessions.filter((session) => session.totalTokens > 0),
      )
      return { records, sessions, apiCalls }
    } catch (error) {
      throw new Error(`ZCode 扫描失败: ${(error as Error).message}`)
    } finally {
      db?.close()
    }
  }

  private readModelUsageApiCalls(
    db: Database.Database,
    columns: Set<string>,
    sessionById: ReadonlyMap<string, TokenUsageSession>,
    context: ScannerScanContext,
  ): ModelUsageReadResult {
    const selectColumns = [
      'id',
      'session_id',
      ...optionalColumns(columns, [
        'logical_request_id',
        'attempt_index',
        'assistant_message_id',
        'query_source',
        'model_id',
        'agent',
        'started_at',
        'completed_at',
        'input_tokens',
        'output_tokens',
        'reasoning_tokens',
        'cache_creation_input_tokens',
        'cache_read_input_tokens',
        'provider_total_tokens',
        'computed_total_tokens',
      ]),
    ]
    const byId = new Map<string, TokenUsageApiCall>()
    const referencedMessageIds = new Set<string>()
    const hasStartedAt = columns.has('started_at')
    const hasCompletedAt = columns.has('completed_at')

    const consume = (whereSql: string, orderColumn: string, params: QueryParam[] = []): void => {
      const statement = db.prepare(
        `SELECT ${selectColumns.join(', ')}
         FROM model_usage${whereSql}
         ORDER BY ${orderColumn} ASC, id ASC`,
      )
      for (const rawRow of statement.iterate(...params)) {
        const row = rawRow as Record<string, DbValue>
        const call = this.modelUsageRowToApiCall(row, sessionById)
        if (!call) continue
        byId.set(call.apiCallId, call)
        const messageId = dbString(row.assistant_message_id)
        if (messageId) referencedMessageIds.add(messageId)
      }
    }

    if (!isIncrementalContext(context)) {
      consume('', hasStartedAt ? 'started_at' : hasCompletedAt ? 'completed_at' : 'id')
    } else {
      let queried = false
      if (hasStartedAt) {
        consume(' WHERE started_at >= ?', 'started_at', [context.sinceMs])
        queried = true
      }
      if (hasCompletedAt) {
        // 长请求可能在窗口之前开始、窗口内才完成，仍用稳定 ID 更新。
        consume(' WHERE completed_at >= ?', 'completed_at', [context.sinceMs])
        queried = true
      }
      if (!queried) consume('', 'id')
    }

    return { apiCalls: [...byId.values()], referencedMessageIds }
  }

  private modelUsageRowToApiCall(
    row: Record<string, DbValue>,
    sessionById: ReadonlyMap<string, TokenUsageSession>,
  ): TokenUsageApiCall | null {
    const sourceId =
      dbString(row.id) ||
      [dbString(row.logical_request_id), dbInteger(row.attempt_index)].filter(Boolean).join(':')
    if (!sourceId) return null

    const sessionId = dbString(row.session_id) || `zcode:${sourceId}`
    const session = sessionById.get(sessionId)
    const input = dbToken(row.input_tokens)
    const output = dbToken(row.output_tokens)
    const reasoning = dbToken(row.reasoning_tokens)
    const cacheRead = dbToken(row.cache_read_input_tokens)
    const cacheWrite = dbToken(row.cache_creation_input_tokens)
    const computedTotal = dbToken(row.computed_total_tokens)
    const providerTotal = dbToken(row.provider_total_tokens)
    const total =
      computedTotal > 0
        ? computedTotal
        : providerTotal > 0
          ? providerTotal
          : input + output + reasoning
    if (total <= 0) return null

    const timestampValue =
      positiveDbValue(row.started_at) ?? positiveDbValue(row.completed_at) ?? null
    const fallbackDate = session?.date ?? 'unknown'
    const { timestamp, rawTimestamp } = timestampsFromValue(timestampValue, fallbackDate)
    const parentSessionId = session?.parentSessionId
    const rootSessionId = session?.rootSessionId ?? sessionId
    const subAgentName = dbString(row.agent)
    const querySource = dbString(row.query_source)

    return {
      agent: this.agentName,
      apiCallId: `model-usage:${sourceId}`,
      sessionId,
      ...(parentSessionId ? { parentSessionId } : {}),
      ...(rootSessionId !== sessionId || parentSessionId ? { rootSessionId } : {}),
      ...(subAgentName ? { subAgentName } : {}),
      ...(querySource ? { role: querySource } : {}),
      date: dateFromTimestamp(timestamp, fallbackDate),
      rawTimestamp,
      timestamp,
      hour: hourFromTimestamp(timestamp),
      model: dbString(row.model_id) || session?.model || 'unknown',
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      totalTokens: total,
      reasoningTokens: reasoning,
    }
  }

  private readMessageApiCalls(
    db: Database.Database,
    sessionById: ReadonlyMap<string, TokenUsageSession>,
    context: ScannerScanContext,
    excludedMessageIds: ReadonlySet<string>,
  ): TokenUsageApiCall[] {
    const columns = tableColumns(db, 'message')
    if (!columns || !hasColumns(columns, 'id', 'session_id', 'data')) return []

    const hasTimeCreated = columns.has('time_created')
    const hasTimeUpdated = columns.has('time_updated')
    const selectColumns = [
      'id',
      'session_id',
      'data',
      ...optionalColumns(columns, ['time_created', 'time_updated']),
    ]
    const byId = new Map<string, TokenUsageApiCall>()

    const consume = (whereSql: string, orderColumn: string, params: QueryParam[] = []): void => {
      const statement = db.prepare(
        `SELECT ${selectColumns.join(', ')}
         FROM message${whereSql}
         ORDER BY ${orderColumn} ASC, id ASC`,
      )
      for (const rawRow of statement.iterate(...params)) {
        const row = rawRow as Record<string, DbValue>
        const sourceId = dbString(row.id)
        if (sourceId && excludedMessageIds.has(sourceId)) continue
        const call = this.messageRowToApiCall(row, sessionById, hasTimeCreated, hasTimeUpdated)
        if (call) byId.set(call.apiCallId, call)
      }
    }

    if (!isIncrementalContext(context)) {
      consume('', hasTimeCreated ? 'time_created' : hasTimeUpdated ? 'time_updated' : 'id')
    } else {
      let queried = false
      if (hasTimeCreated) {
        consume(' WHERE time_created >= ?', 'time_created', [context.sinceMs])
        queried = true
      }
      if (hasTimeUpdated) {
        consume(' WHERE time_updated >= ?', 'time_updated', [context.sinceMs])
        queried = true
      }
      if (!queried) consume('', 'id')
    }

    return [...byId.values()]
  }

  private messageRowToApiCall(
    row: Record<string, DbValue>,
    sessionById: ReadonlyMap<string, TokenUsageSession>,
    hasTimeCreated: boolean,
    hasTimeUpdated: boolean,
  ): TokenUsageApiCall | null {
    const data = parseJsonObject(row.data)
    if (readJsonString(data, 'role') !== 'assistant') return null

    const tokens = readJsonObject(data, 'tokens')
    const input = readJsonToken(tokens, 'input')
    const output = readJsonToken(tokens, 'output')
    const reasoning = readJsonToken(tokens, 'reasoning')
    const cache = readJsonObject(tokens, 'cache')
    const cacheRead = readJsonToken(cache, 'read')
    const cacheWrite = readJsonToken(cache, 'write')
    const sourceTotal = readJsonToken(tokens, 'total')
    // Z Code 的 input 包含 cache 输入；无 total 时不能再加 cache。
    const total = sourceTotal > 0 ? sourceTotal : input + output + reasoning
    if (total <= 0) return null

    const sourceId = dbString(row.id)
    const sessionId = dbString(row.session_id) || `zcode-message:${sourceId || 'unknown'}`
    const session = sessionById.get(sessionId)
    const fallbackDate = session?.date ?? 'unknown'
    const timestampValue =
      readJsonTimestamp(data, ['time', 'created']) ??
      (hasTimeCreated ? positiveDbValue(row.time_created) : null) ??
      (hasTimeUpdated ? positiveDbValue(row.time_updated) : null)
    const { timestamp, rawTimestamp } = timestampsFromValue(timestampValue, fallbackDate)
    const parentSessionId = session?.parentSessionId
    const rootSessionId = session?.rootSessionId ?? sessionId

    return {
      agent: this.agentName,
      apiCallId: `message:${sourceId || `${sessionId}:${rawTimestamp || timestamp}`}`,
      sessionId,
      ...(parentSessionId ? { parentSessionId } : {}),
      ...(rootSessionId !== sessionId || parentSessionId ? { rootSessionId } : {}),
      role: 'assistant',
      date: dateFromTimestamp(timestamp, fallbackDate),
      rawTimestamp,
      timestamp,
      hour: hourFromTimestamp(timestamp),
      model:
        readJsonString(data, 'modelID') ||
        readJsonString(data, 'model') ||
        session?.model ||
        'unknown',
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      totalTokens: total,
      reasoningTokens: reasoning,
    }
  }
}

function readSessionMetadata(db: Database.Database, agent: string): Map<string, TokenUsageSession> {
  const columns = tableColumns(db, 'session')
  if (!columns || !columns.has('id')) return new Map()

  const selectColumns = [
    'id',
    ...optionalColumns(columns, ['parent_id', 'title', 'model', 'time_created', 'time_updated']),
  ]
  const rows = queryAll(db, `SELECT ${selectColumns.join(', ')} FROM session`)
  const parentBySessionId = new Map<string, string>()
  for (const row of rows) {
    const sessionId = dbString(row.id)
    const parentSessionId = dbString(row.parent_id)
    if (sessionId && parentSessionId) parentBySessionId.set(sessionId, parentSessionId)
  }

  const result = new Map<string, TokenUsageSession>()
  for (const row of rows) {
    const sessionId = dbString(row.id)
    if (!sessionId) continue
    const created = dbInteger(row.time_created)
    const updated = dbInteger(row.time_updated)
    const date = created > 0 ? formatDateFromMs(created) : 'unknown'
    const startedAt = timestampsFromValue(created > 0 ? created : null, date).timestamp
    const endedAt = timestampsFromValue(updated > 0 ? updated : created || null, date).timestamp
    const parentSessionId = parentBySessionId.get(sessionId) ?? ''
    const rootSessionId = resolveRootSessionId(sessionId, parentBySessionId)
    const title = dbString(row.title)

    result.set(sessionId, {
      agent,
      sessionId,
      ...(parentSessionId ? { parentSessionId } : {}),
      ...(rootSessionId !== sessionId || parentSessionId ? { rootSessionId } : {}),
      ...(title ? { title } : {}),
      date,
      startedAt,
      endedAt,
      model: parseZCodeModel(row.model),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0,
      apiCallCount: 0,
    })
  }
  return result
}

function isUsableModelUsageSchema(columns: Set<string> | null): columns is Set<string> {
  if (!columns || !hasColumns(columns, 'id', 'session_id')) return false
  const hasTimestamp = columns.has('started_at') || columns.has('completed_at')
  const hasUsage =
    columns.has('computed_total_tokens') ||
    columns.has('provider_total_tokens') ||
    columns.has('input_tokens') ||
    columns.has('output_tokens')
  return hasTimestamp && hasUsage
}

function tableColumns(db: Database.Database, table: string): Set<string> | null {
  const exists = queryAll(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [
    table,
  ])
  if (exists.length === 0) return null
  const columns = new Set<string>()
  for (const row of queryAll(db, `PRAGMA table_info(${table})`)) {
    const name = dbString(row.name).toLowerCase()
    if (name) columns.add(name)
  }
  return columns
}

function queryAll(
  db: Database.Database,
  sql: string,
  params: QueryParam[] = [],
): Record<string, DbValue>[] {
  return db.prepare(sql).all(...params) as Record<string, DbValue>[]
}

function optionalColumns(columns: ReadonlySet<string>, candidates: string[]): string[] {
  return candidates.filter((column) => columns.has(column))
}

function hasColumns(columns: ReadonlySet<string>, ...names: string[]): boolean {
  return names.every((name) => columns.has(name))
}

function dbString(value: DbValue): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return ''
}

function dbInteger(value: DbValue): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0
  if (typeof value === 'bigint') return Number(value) || 0
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function dbToken(value: DbValue): number {
  return Math.max(0, dbInteger(value))
}

function positiveDbValue(value: DbValue): number | string | bigint | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'bigint' && value > 0n) return value
  if (typeof value === 'string' && Number.parseInt(value, 10) > 0) return value
  return null
}

function resolveRootSessionId(
  sessionId: string,
  parentBySessionId: ReadonlyMap<string, string>,
): string {
  let current = sessionId
  const seen = new Set<string>()
  while (true) {
    if (seen.has(current)) return sessionId
    seen.add(current)
    const parent = parentBySessionId.get(current)
    if (!parent) return current
    current = parent
  }
}
