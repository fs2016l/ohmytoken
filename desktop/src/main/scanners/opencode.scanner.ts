/** 读取 OpenCode 本地记录并生成统一扫描结果。 */
import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'path'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
  TokenUsageSession,
} from './types'
import { getOpencodeDbCandidates, getOpencodeMessageDirCandidates } from '../lib/paths'
import { formatDateFromMs } from '../lib/date-utils'
import Database from 'better-sqlite3'
import {
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  resolveRootSessionId,
  timestampFromValue,
  timestampsFromValue,
} from './detail-utils'
import {
  isApiCallInWindow,
  isIncrementalContext,
  normalizeScanContext,
  shouldScanFile,
} from './incremental-utils'
import { normalizeCollectedProjectPath } from './project-path'
import { tokenBuckets, tokenCount } from './token-usage'

/** better-sqlite3 查询值类型 */
type DbValue = number | string | bigint | Uint8Array | null

interface OpenCodeCallMeta {
  embeddedId: string
  fingerprint: string
}

interface OpenCodeParsedCall {
  call: TokenUsageApiCall
  meta: OpenCodeCallMeta
}

interface OpenCodeAccumulatedCall extends OpenCodeParsedCall {
  workspaceConflict: boolean
}

class OpenCodeAccumulator {
  private readonly entries: OpenCodeAccumulatedCall[] = []
  private readonly fingerprintIndices = new Map<string, number[]>()

  ingest(parsed: OpenCodeParsedCall): void {
    const candidates = this.fingerprintIndices.get(parsed.meta.fingerprint) ?? []
    const matchingIndex = candidates.find((index) => {
      const existingId = this.entries[index].meta.embeddedId
      return !(existingId && parsed.meta.embeddedId && existingId !== parsed.meta.embeddedId)
    })
    if (matchingIndex !== undefined) {
      const existing = this.entries[matchingIndex]
      if (!existing.meta.embeddedId && parsed.meta.embeddedId) {
        existing.meta.embeddedId = parsed.meta.embeddedId
        existing.call.apiCallId = parsed.call.apiCallId
      }
      mergeOpenCodeWorkspace(existing, parsed.call.projectPath)
      return
    }

    const index = this.entries.length
    this.entries.push({ ...parsed, workspaceConflict: false })
    this.fingerprintIndices.set(parsed.meta.fingerprint, [...candidates, index])
  }

  values(): TokenUsageApiCall[] {
    const byId = new Map<string, OpenCodeAccumulatedCall>()
    for (const entry of this.entries) {
      const current = byId.get(entry.call.apiCallId)
      if (!current) {
        byId.set(entry.call.apiCallId, entry)
        continue
      }
      mergeOpenCodeWorkspace(current, entry.call.projectPath)
      if (
        entry.call.totalTokens > current.call.totalTokens ||
        (entry.call.totalTokens === current.call.totalTokens &&
          entry.call.timestamp > current.call.timestamp)
      ) {
        const projectPath = current.workspaceConflict ? undefined : current.call.projectPath
        current.call = { ...entry.call, ...(projectPath ? { projectPath } : {}) }
        if (!projectPath) delete current.call.projectPath
      }
    }
    return [...byId.values()].map((entry) => entry.call)
  }
}

function mergeOpenCodeWorkspace(entry: OpenCodeAccumulatedCall, incoming?: string): void {
  if (entry.workspaceConflict || !incoming) return
  const current = entry.call.projectPath
  if (!current) {
    entry.call.projectPath = incoming
  } else if (current !== incoming) {
    entry.workspaceConflict = true
    delete entry.call.projectPath
  }
}

export class OpenCodeScanner implements AgentScanner {
  readonly agentName = 'opencode'

  private resolveDbPaths(): string[] {
    return getOpencodeDbCandidates().filter(existsSync)
  }

  isAvailable(): boolean {
    return (
      this.resolveDbPaths().length > 0 ||
      getOpencodeLegacyMessageDirs().some((dir) => existsSync(dir))
    )
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    const records: TokenUsageRecord[] = []
    const sessions: TokenUsageSession[] = []
    const apiCalls: TokenUsageApiCall[] = []
    const dbPaths = this.resolveDbPaths()
    const sessionMeta = new Map<string, TokenUsageSession>()
    const miniMaxRuntimeSessionIds = new Set<string>()
    const accumulator = new OpenCodeAccumulator()
    const dbErrors: string[] = []
    let parsedDbCount = 0
    let legacyParsedCount = 0

    for (const dbPath of dbPaths) {
      let db: Database.Database | null = null
      try {
        const dbMiniMaxRuntimeSessionIds = new Set<string>()
        const dbRecentSessionIds = new Set<string>()
        db = new Database(dbPath, { readonly: true })
        db.exec('PRAGMA busy_timeout = 5000')

        // session 表只提供元数据；早期库可以只有 message 表。
        const tableRows = queryAll(
          db,
          "SELECT name FROM sqlite_master WHERE type='table' AND name='session'",
        )
        if (tableRows.length > 0) {
          this.readSessionTable(db, scanContext, {
            sessionMeta,
            miniMaxRuntimeSessionIds: dbMiniMaxRuntimeSessionIds,
            recentSessionIds: dbRecentSessionIds,
          })
          for (const sessionId of dbMiniMaxRuntimeSessionIds) {
            miniMaxRuntimeSessionIds.add(sessionId)
          }
        }

        // 合并可用表中的消息，并按消息标识折叠重复项
        this.readSessionMessageApiCalls(
          db,
          sessionMeta,
          dbMiniMaxRuntimeSessionIds,
          dbRecentSessionIds,
          scanContext,
          dbPath,
          accumulator,
        )
        this.readMessageApiCalls(
          db,
          sessionMeta,
          dbMiniMaxRuntimeSessionIds,
          dbRecentSessionIds,
          scanContext,
          dbPath,
          accumulator,
        )
        parsedDbCount += 1
      } catch (e) {
        dbErrors.push(`${dbPath}: ${(e as Error).message}`)
      } finally {
        if (db) db.close()
      }
    }

    // 将文件记录补入尚未出现的消息
    try {
      for (const parsed of this.readLegacyJsonApiCalls(
        sessionMeta,
        miniMaxRuntimeSessionIds,
        scanContext,
      )) {
        accumulator.ingest(parsed)
        legacyParsedCount += 1
      }
    } catch (e) {
      dbErrors.push(`storage/message: ${(e as Error).message}`)
    }

    if (parsedDbCount === 0 && legacyParsedCount === 0 && dbErrors.length > 0) {
      throw new Error(`OpenCode 扫描失败: ${dbErrors.join('; ')}`)
    }
    if (dbErrors.length > 0) {
      console.warn(`[opencode-scanner] 部分数据源跳过: ${dbErrors.join('; ')}`)
    }

    apiCalls.push(...accumulator.values())
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

    return { records, sessions, apiCalls }
  }

  /** 读取生成扫描结果所需的会话元数据。 */
  private readSessionTable(
    db: Database.Database,
    scanContext: ScannerScanContext,
    sink: {
      sessionMeta: Map<string, TokenUsageSession>
      miniMaxRuntimeSessionIds: Set<string>
      recentSessionIds: Set<string>
    },
  ): void {
    // 动态检测当前表结构
    const columns = new Set<string>()
    for (const row of queryAll(db, 'PRAGMA table_info(session)')) {
      const name = row.name
      if (typeof name === 'string') columns.add(name.toLowerCase())
    }

    const has = (...names: string[]) => names.every((n) => columns.has(n))
    const hasModel = has('model')
    const hasTimeCreated = has('time_created')
    const hasSessionTimeUpdated = has('time_updated')
    const hasTitle = has('title')
    const hasParentId = has('parent_id')
    const hasDirectory = has('directory')
    const subAgentColumn = firstExistingColumn(columns, ['agent', 'agent_name', 'sub_agent_name'])

    // 动态构建 SELECT
    const selectCols: string[] = ['id']
    if (hasParentId) selectCols.push('parent_id')
    if (hasTitle) selectCols.push('title')
    if (hasDirectory) selectCols.push('directory')
    if (subAgentColumn) selectCols.push(subAgentColumn)
    if (hasModel) selectCols.push('model')
    if (hasTimeCreated) selectCols.push('time_created')
    if (hasSessionTimeUpdated) selectCols.push('time_updated')
    const sessionRows = queryAll(db, `SELECT ${selectCols.join(', ')} FROM session`)

    const parentBySessionId = new Map<string, string>()
    for (const row of sessionRows) {
      const rowSessionId = dbString(row.id)
      if (!rowSessionId) continue
      const directory = hasDirectory ? dbString(row.directory) : ''
      if (isMiniMaxRuntimeDirectory(directory)) {
        sink.miniMaxRuntimeSessionIds.add(rowSessionId)
        continue
      }
      const parentSessionId = hasParentId ? dbString(row.parent_id) : ''
      if (parentSessionId) parentBySessionId.set(rowSessionId, parentSessionId)
    }

    for (const row of sessionRows) {
      const rowSessionId = dbString(row.id)
      if (!rowSessionId || sink.miniMaxRuntimeSessionIds.has(rowSessionId)) continue

      const created = hasTimeCreated ? toLong(row.time_created) : 0
      const updated = hasSessionTimeUpdated ? toLong(row.time_updated) : 0
      if (isIncrementalContext(scanContext) && Math.max(created, updated) >= scanContext.sinceMs) {
        sink.recentSessionIds.add(rowSessionId)
      }

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
      const parentSessionId = parentBySessionId.get(rowSessionId) ?? ''
      const rootSessionId = resolveRootSessionId(rowSessionId, parentBySessionId)
      const subAgentName = subAgentColumn ? dbString(row[subAgentColumn]) : ''
      const title = hasTitle && typeof row.title === 'string' ? row.title.trim() : ''
      const projectPath = hasDirectory
        ? normalizeCollectedProjectPath(dbString(row.directory))
        : undefined

      const session: TokenUsageSession = {
        agent: this.agentName,
        sessionId: rowSessionId,
        date,
        startedAt: timestamp,
        endedAt: timestamp,
        model,
        // session 表的 token 列只用于兼容展示，不参与聚合（聚合以 message 明细为准）
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        apiCallCount: 0,
      }
      if (parentSessionId) session.parentSessionId = parentSessionId
      if (rootSessionId !== rowSessionId || parentSessionId) session.rootSessionId = rootSessionId
      if (subAgentName) session.subAgentName = subAgentName
      if (projectPath) session.projectPath = projectPath
      if (title) session.title = title
      if (!sink.sessionMeta.has(rowSessionId)) sink.sessionMeta.set(rowSessionId, session)
    }
  }

  /** 从 session_message 表读取消息。 */
  private readSessionMessageApiCalls(
    db: Database.Database,
    sessionById: Map<string, TokenUsageSession>,
    excludedSessionIds: ReadonlySet<string>,
    candidateSessionIds: ReadonlySet<string>,
    context: ScannerScanContext,
    dbPath: string,
    accumulator: OpenCodeAccumulator,
  ): void {
    const tables = queryAll(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='session_message'",
    )
    if (tables.length === 0) return

    const columns = new Set<string>()
    for (const row of queryAll(db, 'PRAGMA table_info(session_message)')) {
      const name = row.name
      if (typeof name === 'string') columns.add(name.toLowerCase())
    }
    const has = (...names: string[]) => names.every((name) => columns.has(name))
    if (!has('id', 'session_id', 'data', 'type')) return
    const hasTimeCreated = has('time_created')
    const hasTimeUpdated = has('time_updated')

    const selectCols = ['id', 'session_id', 'data']
    if (hasTimeCreated) selectCols.push('time_created')
    if (hasTimeUpdated) selectCols.push('time_updated')

    const consume = (whereSql: string, params: QueryParam[] = []): void => {
      // 在查询阶段排除无关记录
      const statement = db.prepare(
        `SELECT ${selectCols.join(', ')}
         FROM session_message${whereSql ? `${whereSql} AND` : ' WHERE'} type = 'assistant'
         ORDER BY id ASC, session_id ASC`,
      )
      for (const rawRow of statement.iterate(...params)) {
        const row = rawRow as Record<string, DbValue>
        const sessionId = dbString(row.session_id)
        if (excludedSessionIds.has(sessionId)) continue
        const parsed = this.rowToApiCall(
          row,
          sessionById,
          true,
          openCodeSourceNamespace(dbPath, 'session_message'),
        )
        if (parsed) accumulator.ingest(parsed)
      }
    }

    if (!isIncrementalContext(context)) {
      consume('')
      return
    }

    if (candidateSessionIds.size > 0) {
      for (const sessionId of candidateSessionIds) {
        if (excludedSessionIds.has(sessionId)) continue
        let queriedBySourceTime = false
        if (hasTimeCreated) {
          consume(' WHERE session_id = ? AND time_created >= ?', [sessionId, context.sinceMs])
          queriedBySourceTime = true
        }
        if (hasTimeUpdated) {
          consume(' WHERE session_id = ? AND time_updated >= ?', [sessionId, context.sinceMs])
          queriedBySourceTime = true
        }
        if (!queriedBySourceTime) consume(' WHERE session_id = ?', [sessionId])
      }
      return
    }

    let queriedBySourceTime = false
    if (hasTimeCreated) {
      consume(' WHERE time_created >= ?', [context.sinceMs])
      queriedBySourceTime = true
    }
    if (hasTimeUpdated) {
      consume(' WHERE time_updated >= ?', [context.sinceMs])
      queriedBySourceTime = true
    }
    if (!queriedBySourceTime) consume('')
  }

  /** 从 message 表读取消息。 */
  private readMessageApiCalls(
    db: Database.Database,
    sessionById: Map<string, TokenUsageSession>,
    excludedSessionIds: ReadonlySet<string>,
    candidateSessionIds: ReadonlySet<string>,
    context: ScannerScanContext,
    dbPath: string,
    accumulator: OpenCodeAccumulator,
  ): void {
    const rows = queryAll(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='message'",
    )
    if (rows.length === 0) return

    const columns = new Set<string>()
    for (const row of queryAll(db, 'PRAGMA table_info(message)')) {
      const name = row.name
      if (typeof name === 'string') columns.add(name.toLowerCase())
    }
    const has = (...names: string[]) => names.every((name) => columns.has(name))
    if (!has('id', 'session_id', 'data')) return

    const hasTimeCreated = has('time_created')
    const hasTimeUpdated = has('time_updated')
    const selectCols = ['id', 'session_id', 'data']
    if (hasTimeCreated) selectCols.push('time_created')
    if (hasTimeUpdated) selectCols.push('time_updated')

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
        const parsed = this.rowToApiCall(
          row,
          sessionById,
          false,
          openCodeSourceNamespace(dbPath, 'message'),
        )
        if (parsed) accumulator.ingest(parsed)
      }
    }

    if (!isIncrementalContext(context)) {
      const orderColumn = hasTimeCreated ? 'time_created' : hasTimeUpdated ? 'time_updated' : 'id'
      consume('', orderColumn)
      return
    }

    if (candidateSessionIds.size > 0) {
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
      return
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
  }

  /** 从逐消息文件中补充数据库未包含的记录。 */
  private readLegacyJsonApiCalls(
    sessionById: Map<string, TokenUsageSession>,
    excludedSessionIds: ReadonlySet<string>,
    context: ScannerScanContext,
  ): OpenCodeParsedCall[] {
    const out: OpenCodeParsedCall[] = []
    for (const messagesDir of getOpencodeLegacyMessageDirs()) {
      if (!existsSync(messagesDir)) continue
      for (const file of listFilesRecursive(messagesDir, '.json')) {
        if (!shouldScanFile(file, context)) continue
        let text: string
        try {
          text = readFileSync(file, 'utf8')
        } catch {
          continue
        }
        let data: unknown
        try {
          data = JSON.parse(text)
        } catch {
          continue
        }
        if (!isObject(data)) continue
        if (readString(data, 'role') !== 'assistant') continue

        const sessionId =
          readString(data, 'sessionID') || basename(dirname(file)) || 'unknown-session'
        if (excludedSessionIds.has(sessionId)) continue
        const session = sessionById.get(sessionId)
        const tokens = readObject(data, 'tokens')
        const input = optionalTokenNumber(tokens, 'input')
        const output = optionalTokenNumber(tokens, 'output')
        if (input === null || output === null) continue
        const cache = readObject(tokens, 'cache')
        const cacheRead = optionalTokenNumberOrZero(cache, 'read')
        const cacheWrite = optionalTokenNumberOrZero(cache, 'write')
        if (cacheRead === null || cacheWrite === null) continue
        const buckets = tokenBuckets({
          inputTokens: input,
          outputTokens: output,
          cacheReadTokens: cacheRead,
          cacheWriteTokens: cacheWrite,
          reasoningTokens: optionalTokenNumber(tokens, 'reasoning') ?? 0,
        })
        if (buckets.totalTokens <= 0) continue

        const timestampValue =
          readNestedNumber(data, ['time', 'created']) ?? positiveFileMtimeMs(file)
        if (timestampValue === null) continue
        const { timestamp, rawTimestamp } = timestampsFromValue(
          timestampValue,
          session?.date ?? 'unknown',
        )
        const model = resolveOpenCodeModel(data) || session?.model || 'unknown'
        const provider = resolveOpenCodeProvider(data)
        const messageId = readString(data, 'id').trim()
        const apiCallId = messageId || legacyJsonApiCallId(file)
        const embeddedProjectPath = normalizeCollectedProjectPath(readObject(data, 'path').root)
        if (embeddedProjectPath && isMiniMaxRuntimeDirectory(embeddedProjectPath)) continue
        const projectPath = session?.projectPath || embeddedProjectPath
        const subAgentName = resolveOpenCodeAgent(data) || session?.subAgentName

        const apiCall: TokenUsageApiCall = {
          agent: this.agentName,
          apiCallId,
          sessionId,
          date: dateFromTimestamp(timestamp, session?.date ?? 'unknown'),
          rawTimestamp,
          timestamp,
          hour: hourFromTimestamp(timestamp),
          model,
          ...buckets,
        }
        if (session?.parentSessionId) apiCall.parentSessionId = session.parentSessionId
        const rootSessionId = session?.rootSessionId ?? sessionId
        if (rootSessionId !== sessionId || session?.parentSessionId) {
          apiCall.rootSessionId = rootSessionId
        }
        if (subAgentName) apiCall.subAgentName = subAgentName
        if (projectPath) apiCall.projectPath = projectPath
        const cost = readCost(data.cost)
        apiCall.role = 'assistant'
        if (!isApiCallInWindow(apiCall, context)) continue
        out.push({
          call: apiCall,
          meta: {
            embeddedId: messageId,
            fingerprint: openCodeFingerprint(
              data,
              timestampValue,
              model,
              provider,
              buckets,
              cost,
              subAgentName,
            ),
          },
        })
      }
    }
    return out
  }

  private rowToApiCall(
    row: Record<string, DbValue>,
    sessionById: Map<string, TokenUsageSession>,
    missingRoleIsAssistant: boolean,
    sourceNamespace: string,
  ): OpenCodeParsedCall | null {
    const data = parseObject(row.data)
    const sessionId = dbString(row.session_id) || readString(data, 'sessionID').trim()
    if (!sessionId) return null
    const session = sessionById.get(sessionId)
    const role = readString(data, 'role') || (missingRoleIsAssistant ? 'assistant' : '')
    if (role !== 'assistant') return null
    const timestampValue =
      readNestedNumber(data, ['time', 'created']) ??
      positiveDbNumber(row.time_created) ??
      positiveDbNumber(row.time_updated)
    if (timestampValue === null) return null
    const { timestamp, rawTimestamp } = timestampsFromValue(
      timestampValue,
      session?.date ?? 'unknown',
    )
    const model = resolveOpenCodeModel(data) || session?.model || 'unknown'
    const provider = resolveOpenCodeProvider(data)
    const tokens = readObject(data, 'tokens')
    if (Object.keys(tokens).length === 0) return null
    const input = optionalTokenNumber(tokens, 'input')
    const output = optionalTokenNumber(tokens, 'output')
    if (input === null || output === null) return null
    const cache = readObject(tokens, 'cache')
    const cacheRead = optionalTokenNumberOrZero(cache, 'read')
    const cacheWrite = optionalTokenNumberOrZero(cache, 'write')
    if (cacheRead === null || cacheWrite === null) return null
    const buckets = tokenBuckets({
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      reasoningTokens: optionalTokenNumber(tokens, 'reasoning') ?? 0,
    })
    if (buckets.totalTokens <= 0) return null
    const rowId = dbString(row.id) || stableObjectHash(data)
    // SQLite 的 message.id 本身就是 OpenCode 的稳定消息主键；优先沿用它，
    // 这样 JSON/SQLite、多数据库迁移副本与数据库换路径后仍能收敛到同一调用。
    const messageId = readString(data, 'id').trim() || dbString(row.id)
    const apiCallId = messageId || `${sourceNamespace}:${rowId}`
    const embeddedProjectPath = normalizeCollectedProjectPath(readObject(data, 'path').root)
    if (embeddedProjectPath && isMiniMaxRuntimeDirectory(embeddedProjectPath)) return null
    const projectPath = session?.projectPath || embeddedProjectPath
    const subAgentName = resolveOpenCodeAgent(data) || session?.subAgentName
    const cost = readCost(data.cost)

    const apiCall: TokenUsageApiCall = {
      agent: this.agentName,
      apiCallId,
      sessionId,
      date: dateFromTimestamp(timestamp, session?.date ?? 'unknown'),
      rawTimestamp,
      timestamp,
      hour: hourFromTimestamp(timestamp),
      model,
      ...buckets,
    }
    if (session?.parentSessionId) apiCall.parentSessionId = session.parentSessionId
    const rootSessionId = session?.rootSessionId ?? sessionId
    if (rootSessionId !== sessionId || session?.parentSessionId) {
      apiCall.rootSessionId = rootSessionId
    }
    if (subAgentName) apiCall.subAgentName = subAgentName
    if (projectPath) apiCall.projectPath = projectPath
    apiCall.role = role
    return {
      call: apiCall,
      meta: {
        embeddedId: messageId,
        fingerprint: openCodeFingerprint(
          data,
          timestampValue,
          model,
          provider,
          buckets,
          cost,
          subAgentName,
        ),
      },
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

function firstExistingColumn(columns: Set<string>, candidates: string[]): string | null {
  return candidates.find((candidate) => columns.has(candidate)) ?? null
}

function dbString(value: DbValue): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 返回逐消息文件目录候选。 */
function getOpencodeLegacyMessageDirs(): string[] {
  const seen = new Set<string>()
  return getOpencodeMessageDirCandidates().filter((dir) => {
    const key = process.platform === 'win32' ? resolve(dir).toLowerCase() : resolve(dir)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function legacyJsonApiCallId(file: string): string {
  return `opencode-legacy:${createHash('sha256').update(file).digest('hex').substring(0, 24)}`
}

function openCodeSourceNamespace(dbPath: string, table: string): string {
  const dbHash = createHash('sha256').update(dbPath).digest('hex').substring(0, 16)
  return `opencode:${dbHash}:${table}`
}

function resolveOpenCodeModel(data: Record<string, unknown>): string {
  return (readString(data, 'modelID') || readString(data, 'model')).trim()
}

function resolveOpenCodeProvider(data: Record<string, unknown>): string {
  const direct = readString(data, 'providerID').trim()
  if (direct) return direct
  const model = readObject(data, 'model')
  return readString(model, 'providerID').trim() || 'unknown'
}

function resolveOpenCodeAgent(data: Record<string, unknown>): string | undefined {
  const value = (readString(data, 'mode') || readString(data, 'agent')).trim()
  return value || undefined
}

function readCost(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return value
}

function openCodeFingerprint(
  data: Record<string, unknown>,
  created: number,
  model: string,
  provider: string,
  buckets: ReturnType<typeof tokenBuckets>,
  cost: number | null,
  agent?: string,
): string {
  return stableObjectHash({
    created,
    completed: readNestedNumber(data, ['time', 'completed']),
    model,
    provider,
    input: buckets.inputTokens,
    output: buckets.outputTokens,
    cacheRead: buckets.cacheReadTokens,
    cacheWrite: buckets.cacheWriteTokens,
    reasoning: buckets.reasoningTokens,
    cost,
    agent: agent ?? null,
  })
}

function stableObjectHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function listFilesRecursive(root: string, extension: string): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith(extension)) files.push(full)
    }
  }
  walk(root)
  return files.sort()
}

/** 排除归属于 MiniMax Code 内置运行时的会话。 */
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

function optionalTokenNumber(source: Record<string, unknown>, key: string): number | null {
  if (!(key in source)) return null
  const value = source[key]
  if (typeof value === 'number' && Number.isFinite(value)) return tokenCount(value)
  if (typeof value === 'bigint') return tokenCount(value)
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return tokenCount(value)
  }
  return null
}

/** 老版本未写入某个可选分桶时按 0；字段存在但损坏时拒绝该条记录。 */
function optionalTokenNumberOrZero(source: Record<string, unknown>, key: string): number | null {
  return key in source ? optionalTokenNumber(source, key) : 0
}

function positiveDbNumber(value: DbValue | undefined): number | null {
  if (value === undefined) return null
  const parsed = toLong(value)
  return parsed > 0 ? parsed : null
}

function positiveFileMtimeMs(file: string): number | null {
  try {
    const value = statSync(file).mtimeMs
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
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
