/**
 * OpenCode Scanner（对应 Java OpenCodeScanner.java）
 *
 * 扫描 OpenCode 的 sqlite 数据库（session 表），按 date+model 聚合。
 *
 * 关键点：
 *  - schema 版本差异 → 用 PRAGMA table_info 动态检测列存在性
 *  - model 列存的是 JSON {"id":"...","providerID":"..."} → 提取 id 字段
 *  - OpenCode 的 tokens_input 已排除 cache（adjustedInputTokens），tokens_output 已排除 reasoning
 *    所以 totalTokens = input + output + reasoning + cacheRead + cacheWrite
 *    （唯一一个把 reasoning 加进 total 的 scanner）
 *  - MiniMax Code 会启动自带的 OpenCode runtime，并把内部会话写入同一 OpenCode 数据库；
 *    session.directory 位于 ~/.mavis/agents 或 ~/.minimax/agents 的会话不属于独立 OpenCode，
 *    需要在会话/API 明细生成前排除，避免与 MiniMaxCodeScanner 重复统计
 *  - cost 列单独聚合，按相同 date|model key 合并到记录
 */
import { existsSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'path'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
  TokenUsageSession,
} from './types'
import { getOpencodeDbCandidates } from '../lib/paths'
import { formatDateFromMs } from '../lib/date-utils'
import Database from 'better-sqlite3'
import {
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  timestampFromValue,
  timestampsFromValue,
} from './detail-utils'
import { isIncrementalContext, normalizeScanContext } from './incremental-utils'
import { normalizeCollectedProjectPath } from './project-path'

/** better-sqlite3 查询值类型 */
type DbValue = number | string | bigint | Uint8Array | null

export class OpenCodeScanner implements AgentScanner {
  readonly agentName = 'opencode'

  private resolveDbPath(): string | null {
    return getOpencodeDbCandidates().find(existsSync) ?? null
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
    const sessions: TokenUsageSession[] = []
    const apiCalls: TokenUsageApiCall[] = []
    const dbPath = this.resolveDbPath()
    if (!dbPath) return { records, sessions, apiCalls: [] }

    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true })
      db.exec('PRAGMA busy_timeout = 5000')

      // 验证 session 表存在
      const tableRows = queryAll(
        db,
        "SELECT name FROM sqlite_master WHERE type='table' AND name='session'",
      )
      if (tableRows.length === 0) throw new Error('session 表不存在')

      // 动态检测列（对应 Java DatabaseMetaData.getColumns）
      const columns = new Set<string>()
      for (const row of queryAll(db, 'PRAGMA table_info(session)')) {
        const name = row.name
        if (typeof name === 'string') columns.add(name.toLowerCase())
      }

      const has = (...names: string[]) => names.every((n) => columns.has(n))
      const hasInput = has('tokens_input')
      const hasOutput = has('tokens_output')
      const hasReasoning = has('tokens_reasoning')
      const hasCacheRead = has('tokens_cache_read')
      const hasCacheWrite = has('tokens_cache_write')
      const hasCost = has('cost')
      const hasModel = has('model')
      const hasTimeCreated = has('time_created')
      const hasSessionTimeUpdated = has('time_updated')
      const hasTitle = has('title')
      const hasParentId = has('parent_id')
      const hasDirectory = has('directory')
      const subAgentColumn = firstExistingColumn(columns, ['agent', 'agent_name', 'sub_agent_name'])

      // 动态构建 SELECT（与 Java 完全一致）
      const selectCols: string[] = ['id']
      if (hasParentId) selectCols.push('parent_id')
      if (hasTitle) selectCols.push('title')
      if (hasDirectory) selectCols.push('directory')
      if (subAgentColumn) selectCols.push(subAgentColumn)
      if (hasModel) selectCols.push('model')
      if (hasTimeCreated) selectCols.push('time_created')
      if (hasSessionTimeUpdated) selectCols.push('time_updated')
      if (hasInput) selectCols.push('tokens_input')
      if (hasOutput) selectCols.push('tokens_output')
      if (hasReasoning) selectCols.push('tokens_reasoning')
      if (hasCacheRead) selectCols.push('tokens_cache_read')
      if (hasCacheWrite) selectCols.push('tokens_cache_write')
      if (hasCost) selectCols.push('cost')
      const sql = `SELECT ${selectCols.join(', ')} FROM session`
      const sessionRows = queryAll(db, sql)
      const miniMaxRuntimeSessionIds = new Set<string>()
      const recentSessionIds = new Set<string>()
      for (const row of sessionRows) {
        const sessionId = dbString(row.id)
        const directory = hasDirectory ? dbString(row.directory) : ''
        if (sessionId && isMiniMaxRuntimeDirectory(directory)) {
          miniMaxRuntimeSessionIds.add(sessionId)
        }
      }

      const parentBySessionId = new Map<string, string>()
      for (const row of sessionRows) {
        const rowSessionId = dbString(row.id)
        if (miniMaxRuntimeSessionIds.has(rowSessionId)) continue
        const parentSessionId = hasParentId ? dbString(row.parent_id) : ''
        if (rowSessionId && parentSessionId) parentBySessionId.set(rowSessionId, parentSessionId)
      }

      for (const row of sessionRows) {
        const rowSessionId = dbString(row.id)
        if (miniMaxRuntimeSessionIds.has(rowSessionId)) continue

        const input = hasInput ? toLong(row.tokens_input) : 0
        const output = hasOutput ? toLong(row.tokens_output) : 0
        const reasoning = hasReasoning ? toLong(row.tokens_reasoning) : 0
        const cacheRd = hasCacheRead ? toLong(row.tokens_cache_read) : 0
        const cacheWr = hasCacheWrite ? toLong(row.tokens_cache_write) : 0
        const cost = hasCost ? toNumber(row.cost) : 0
        const created = hasTimeCreated ? toLong(row.time_created) : 0
        const updated = hasSessionTimeUpdated ? toLong(row.time_updated) : 0
        if (
          isIncrementalContext(scanContext) &&
          rowSessionId &&
          Math.max(created, updated) >= scanContext.sinceMs
        )
          recentSessionIds.add(rowSessionId)

        // 解析 model JSON {"id":"...","providerID":"..."} → 提取 id
        let model = 'unknown'
        if (hasModel) {
          const modelJson = typeof row.model === 'string' ? row.model : ''
          if (modelJson) {
            try {
              const mj = JSON.parse(modelJson)
              if (mj && typeof mj.id === 'string' && mj.id !== null) {
                model = mj.id
              }
            } catch {
              // 非 JSON：去掉 JSON 字符后清理
              model = modelJson.replace(/["{}[\]]/g, '').trim()
            }
          }
        }

        // time_created 是 epoch 毫秒
        const date = created > 0 ? formatDateFromMs(created) : 'unknown'
        const timestamp = timestampFromValue(created, date)
        const sessionId = rowSessionId || `${date}:${model}`
        const parentSessionId = parentBySessionId.get(sessionId) ?? ''
        const rootSessionId = resolveRootSessionId(sessionId, parentBySessionId)
        const subAgentName = subAgentColumn ? dbString(row[subAgentColumn]) : ''
        const title = hasTitle && typeof row.title === 'string' ? row.title.trim() : ''
        const projectPath = hasDirectory
          ? normalizeCollectedProjectPath(dbString(row.directory))
          : undefined

        const session: TokenUsageSession = {
          agent: this.agentName,
          sessionId,
          date,
          startedAt: timestamp,
          endedAt: timestamp,
          model,
          inputTokens: input,
          outputTokens: output,
          cacheReadTokens: cacheRd,
          cacheWriteTokens: cacheWr,
          reasoningTokens: reasoning,
          // OpenCode: tokens_input 已排除 cache，tokens_output 已排除 reasoning
          // 所以 total 需要加回 reasoning 和 cache
          totalTokens: input + output + reasoning + cacheRd + cacheWr,
          apiCallCount: 0,
        }
        if (cost > 0) session.cost = cost
        if (parentSessionId) session.parentSessionId = parentSessionId
        if (rootSessionId !== sessionId || parentSessionId) session.rootSessionId = rootSessionId
        if (subAgentName) session.subAgentName = subAgentName
        if (projectPath) session.projectPath = projectPath
        if (title) session.title = title
        sessions.push(session)
      }

      const sessionMeta = new Map(sessions.map((session) => [session.sessionId, session]))
      const candidateSessionIds = hasSessionTimeUpdated ? recentSessionIds : null
      for (const call of this.readMessageApiCalls(
        db,
        sessionMeta,
        miniMaxRuntimeSessionIds,
        candidateSessionIds,
        scanContext,
      )) {
        apiCalls.push(call)
      }
      sessions.length = 0
      sessions.push(...buildSessionsFromApiCalls(this.agentName, apiCalls))
      const sessionKeys = new Set(
        sessions.map((session) => `${session.sessionId}|${session.date}|${session.model}`),
      )
      for (const session of sessions) {
        const meta = sessionMeta.get(session.sessionId)
        if (!meta) continue
        if (meta.parentSessionId) session.parentSessionId = meta.parentSessionId
        if (meta.rootSessionId) session.rootSessionId = meta.rootSessionId
        if (meta.subAgentName) session.subAgentName = meta.subAgentName
        if (meta.projectPath) session.projectPath = meta.projectPath
        if (meta.title) session.title = meta.title
      }
      // 全量扫描保留无 API 明细的会话元数据；增量批次只返回窗口内实际受影响的会话，
      // 避免每次刷新都把全部历史 session 带入持久化层。
      if (!isIncrementalContext(scanContext)) {
        for (const meta of sessionMeta.values()) {
          const key = `${meta.sessionId}|${meta.date}|${meta.model}`
          if (sessionKeys.has(key)) continue
          sessions.push({
            ...meta,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
            apiCallCount: 0,
          })
        }
      }
      records.push(
        ...buildRecordsFromSessions(
          this.agentName,
          sessions.filter((session) => session.totalTokens > 0),
        ),
      )
    } catch (e) {
      throw new Error(`OpenCode 扫描失败: ${(e as Error).message}`)
    } finally {
      if (db) db.close()
    }

    return { records, sessions, apiCalls }
  }

  private readMessageApiCalls(
    db: Database.Database,
    sessionById: Map<string, TokenUsageSession>,
    excludedSessionIds: ReadonlySet<string>,
    candidateSessionIds: ReadonlySet<string> | null,
    context: ScannerScanContext,
  ): TokenUsageApiCall[] {
    const rows = queryAll(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='message'",
    )
    if (rows.length === 0) return []

    const columns = new Set<string>()
    for (const row of queryAll(db, 'PRAGMA table_info(message)')) {
      const name = row.name
      if (typeof name === 'string') columns.add(name.toLowerCase())
    }
    const has = (...names: string[]) => names.every((name) => columns.has(name))
    if (!has('id', 'session_id', 'data')) return []

    const hasTimeCreated = has('time_created')
    const hasTimeUpdated = has('time_updated')
    const selectCols = ['id', 'session_id', 'data']
    if (hasTimeCreated) selectCols.push('time_created')
    if (hasTimeUpdated) selectCols.push('time_updated')

    const byId = new Map<string, TokenUsageApiCall>()
    const consume = (whereSql: string, orderColumn: string, params: QueryParam[] = []): void => {
      const statement = db.prepare(
        `SELECT ${selectCols.join(', ')}
         FROM message${whereSql}
         ORDER BY ${orderColumn} ASC, id ASC`,
      )
      // iterate() 保持结果逐行解码，避免把大型 message.data 全量驻留在 JS 堆中。
      for (const rawRow of statement.iterate(...params)) {
        const row = rawRow as Record<string, DbValue>
        const sessionId = dbString(row.session_id)
        if (excludedSessionIds.has(sessionId)) continue
        const apiCall = this.rowToApiCall(row, sessionById, hasTimeCreated, hasTimeUpdated)
        if (apiCall) byId.set(apiCall.apiCallId, apiCall)
      }
    }

    if (!isIncrementalContext(context)) {
      const orderColumn = hasTimeCreated ? 'time_created' : hasTimeUpdated ? 'time_updated' : 'id'
      consume('', orderColumn)
      return [...byId.values()]
    }

    if (candidateSessionIds !== null) {
      // OpenCode 自带 (session_id, time_created, id) 索引。先从小型 session 表找
      // 最近有变化的会话，再逐会话读取，可避免 3GB 级 message.data 全表扫描。
      for (const sessionId of candidateSessionIds) {
        if (excludedSessionIds.has(sessionId)) continue
        let queriedBySourceTime = false
        if (hasTimeCreated) {
          consume(' WHERE session_id = ? AND time_created >= ?', 'time_created', [
            sessionId,
            context.sinceMs,
          ])
          queriedBySourceTime = true
        }
        if (hasTimeUpdated) {
          // 即使消息很早创建，只要本窗口内更新了 token/data，也必须用稳定 ID upsert。
          consume(
            ' WHERE session_id = ? AND time_updated >= ?',
            hasTimeCreated ? 'time_created' : 'time_updated',
            [sessionId, context.sinceMs],
          )
          queriedBySourceTime = true
        }
        if (!queriedBySourceTime) consume(' WHERE session_id = ?', 'id', [sessionId])
      }
      return [...byId.values()]
    }

    // 老 session schema 没有 time_updated 时，退回两个独立范围查询；不使用 OR，
    // 让具备对应索引的版本仍能走索引，并保持更新过的旧消息不被事件时间过滤。
    let queriedBySourceTime = false
    if (hasTimeCreated) {
      consume(' WHERE time_created >= ?', 'time_created', [context.sinceMs])
      queriedBySourceTime = true
    }
    if (hasTimeUpdated) {
      consume(' WHERE time_updated >= ?', 'time_updated', [context.sinceMs])
      queriedBySourceTime = true
    }
    if (!queriedBySourceTime) consume('', 'id')

    return [...byId.values()]
  }

  private rowToApiCall(
    row: Record<string, DbValue>,
    sessionById: Map<string, TokenUsageSession>,
    hasTimeCreated: boolean,
    hasTimeUpdated: boolean,
  ): TokenUsageApiCall | null {
    const sessionId = typeof row.session_id === 'string' ? row.session_id : 'unknown'
    const session = sessionById.get(sessionId)
    const data = parseObject(row.data)
    const role = readString(data, 'role')
    const timestampValue =
      readNestedNumber(data, ['time', 'created']) ??
      (hasTimeCreated ? row.time_created : null) ??
      (hasTimeUpdated ? row.time_updated : null)
    const { timestamp, rawTimestamp } = timestampsFromValue(
      timestampValue,
      session?.date ?? 'unknown',
    )
    const model =
      readString(data, 'modelID') || readString(data, 'model') || session?.model || 'unknown'
    const tokens = readObject(data, 'tokens')
    const input = readTokenNumber(tokens, 'input')
    const output = readTokenNumber(tokens, 'output')
    const reasoning = readTokenNumber(tokens, 'reasoning')
    const cache = readObject(tokens, 'cache')
    const cacheRead = readTokenNumber(cache, 'read')
    const cacheWrite = readTokenNumber(cache, 'write')
    const totalFromData = readTokenNumber(tokens, 'total')
    const total =
      totalFromData > 0 ? totalFromData : input + output + reasoning + cacheRead + cacheWrite
    if (total <= 0) return null
    const apiCallId =
      typeof row.id === 'string' && row.id.length > 0 ? row.id : `${sessionId}:${timestamp}`

    const apiCall: TokenUsageApiCall = {
      agent: this.agentName,
      apiCallId,
      sessionId,
      date: dateFromTimestamp(timestamp, session?.date ?? 'unknown'),
      rawTimestamp,
      timestamp,
      hour: hourFromTimestamp(timestamp),
      model,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      totalTokens: total,
      reasoningTokens: reasoning,
    }
    if (session?.parentSessionId) apiCall.parentSessionId = session.parentSessionId
    const rootSessionId = session?.rootSessionId ?? sessionId
    if (rootSessionId !== sessionId || session?.parentSessionId) {
      apiCall.rootSessionId = rootSessionId
    }
    if (session?.subAgentName) apiCall.subAgentName = session.subAgentName
    if (session?.projectPath) apiCall.projectPath = session.projectPath
    if (role) apiCall.role = role
    return apiCall
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

function firstExistingColumn(columns: Set<string>, candidates: string[]): string | null {
  return candidates.find((candidate) => columns.has(candidate)) ?? null
}

function dbString(value: DbValue): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * MiniMax Code 的内置 OpenCode runtime 使用 ~/.mavis/agents 或 ~/.minimax/agents
 * 作为 agent 工作目录。这些会话属于 MiniMax Code，不应再次归入独立 OpenCode。
 *
 * 只按目录归属判断，不按 provider/model 判断，避免误删用户在独立 OpenCode 中
 * 正常调用 MiniMax 模型的记录。
 */
function isMiniMaxRuntimeDirectory(directory: string): boolean {
  if (!directory) return false
  const roots = [join(homedir(), '.mavis', 'agents'), join(homedir(), '.minimax', 'agents')]
  return roots.some((root) => isPathInside(directory, root))
}

function isPathInside(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizePathForComparison(candidate)
  const normalizedRoot = normalizePathForComparison(root)
  const pathFromRoot = relative(normalizedRoot, normalizedCandidate)
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
  )
}

function normalizePathForComparison(value: string): string {
  const normalized = normalize(resolve(value))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function resolveRootSessionId(sessionId: string, parentBySessionId: Map<string, string>): string {
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

function toNumber(v: DbValue): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'bigint') return Number(v) || 0
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function parseObject(value: DbValue): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return isObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function readObject(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key]
  return isObject(value) ? value : {}
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  if (typeof value === 'string') return value
  if (isObject(value)) {
    const id = value.id
    if (typeof id === 'string') return id
  }
  return ''
}

function readTokenNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key]
  if (typeof value === 'number') return Math.trunc(value) || 0
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function readNestedNumber(source: Record<string, unknown>, path: string[]): number | null {
  let current: unknown = source
  for (const key of path) {
    if (!isObject(current)) return null
    current = current[key]
  }
  if (typeof current === 'number' && Number.isFinite(current)) return current
  if (typeof current === 'string') {
    const parsed = Number.parseInt(current, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
