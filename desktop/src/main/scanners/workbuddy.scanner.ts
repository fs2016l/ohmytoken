/**
 * WorkBuddy Scanner（对应 Java WorkBuddyScanner.java）
 *
 * 三个数据源合并：
 *  1. DB sessions 表（~/.workbuddy/workbuddy.db）：id → (created_at, model, title/custom_title)
 *     `SELECT id, model, created_at, title/custom_title FROM sessions WHERE model IS NOT NULL`
 *  2. Projects JSONL（~/.workbuddy/projects 下递归的 .jsonl 文件）：
 *     providerData.usage/rawUsage，每行对应一次模型 API 调用明细
 *  3. Traces 目录（~/.workbuddy/traces/<pid>/*.json）：
 *     trace.modelInfo.{totalInputTokens, totalOutputTokens, totalCachedTokens}
 *
 * model 解析优先级：jsonl providerData → trace.modelInfo.models[0] → sessions[sessionId].model → "unknown"
 * model 名称去掉 "custom-local:" 前缀
 *
 * Projects JSONL 与 trace 按根会话协调：JSONL 覆盖对应根，trace 补充其他根。
 * trace 的 totalInputTokens 已含缓存，需拆为互斥的 fresh input 与 cache read。
 */
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, relative, sep } from 'path'
import type { Dirent } from 'fs'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'
import { getWorkBuddyDb, getWorkBuddyProjectsDir, getWorkBuddyTracesDir } from '../lib/paths'
import { formatDateFromMs } from '../lib/date-utils'
import Database from 'better-sqlite3'
import {
  applySessionTitles,
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  timestampFromValue,
  timestampsFromValue,
} from './detail-utils'
import { normalizeScanContext } from './incremental-utils'
import { loadWorkBuddyProjectScan, normalizeWorkBuddyModel } from './workbuddy-jsonl'
import { extractProjectPath, normalizeCollectedProjectPath } from './project-path'
import { tokenBuckets, tokenCount } from './token-usage'

/** better-sqlite3 查询值类型 */
type DbValue = number | string | bigint | Uint8Array | null

interface SessionInfo {
  date: string
  model: string
  startedAt: string
  title?: string
  projectPath?: string
}

interface TraceApiCallEntry {
  apiCall: TokenUsageApiCall
  sourceSessionId: string | null
}

export class WorkBuddyScanner implements AgentScanner {
  readonly agentName = 'workbuddy'

  isAvailable(): boolean {
    return (
      existsSync(getWorkBuddyDb()) ||
      existsSync(getWorkBuddyProjectsDir()) ||
      existsSync(getWorkBuddyTracesDir())
    )
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const records: TokenUsageRecord[] = []
    const scanContext = normalizeScanContext(context)

    // 1. 从 sessions 表获取 session 信息（id → date, model）
    const sessions = await this.loadSessions()
    const projectScan = loadWorkBuddyProjectScan(this.agentName, sessions, scanContext)
    const traceApiCallEntries = this.loadTraceApiCalls(sessions, scanContext)
    const apiCalls = reconcileApiCallSources(
      projectScan.apiCalls,
      traceApiCallEntries,
      projectScan.coveredRootSessionIds,
    )
    const coveredDetailedSessions = new Set(projectScan.coveredRootSessionIds)
    for (const apiCall of apiCalls) {
      coveredDetailedSessions.add(apiCall.rootSessionId ?? apiCall.sessionId)
      coveredDetailedSessions.add(apiCall.sessionId)
    }
    apiCalls.push(
      ...this.loadSessionUsageApiCalls(sessions).filter(
        (apiCall) => !coveredDetailedSessions.has(apiCall.sessionId),
      ),
    )
    // project JSONL 已在解析时按事件窗口过滤。trace 是会持续改写的累计快照：
    // 只要文件 mtime 命中窗口，就保留其原始 startedAt 与稳定文件 ID做 upsert；
    // 不把 mtime 冒充事件时间，从而不会误删窗口外的旧日期/模型分组。

    if (apiCalls.length === 0) return { records, sessions: [], apiCalls }

    const detailSessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    const titleBySessionId = new Map<string, string>()
    for (const [sessionId, session] of sessions) {
      if (session.title) titleBySessionId.set(sessionId, session.title)
    }
    applySessionTitles(detailSessions, titleBySessionId)
    records.push(...buildRecordsFromSessions(this.agentName, detailSessions))

    return { records, sessions: detailSessions, apiCalls }
  }

  private loadTraceApiCalls(
    sessions: Map<string, SessionInfo>,
    context: ScannerScanContext,
  ): TraceApiCallEntry[] {
    void context
    const entries: TraceApiCallEntry[] = []
    const tracesDir = getWorkBuddyTracesDir()
    if (!existsSync(tracesDir)) return entries

    let pidDirs: Dirent[] = []
    try {
      pidDirs = readdirSync(tracesDir, { withFileTypes: true })
    } catch (e) {
      throw new Error(`WorkBuddy traces 目录不可读: ${(e as Error).message}`)
    }

    for (const pidDir of pidDirs) {
      if (!pidDir.isDirectory()) continue
      const pidFullPath = join(tracesDir, pidDir.name)

      let jsonFiles: Dirent[] = []
      try {
        jsonFiles = readdirSync(pidFullPath, { withFileTypes: true })
      } catch (e) {
        throw new Error(`WorkBuddy traces 子目录不可读 (${pidFullPath}): ${(e as Error).message}`)
      }

      for (const jf of jsonFiles) {
        if (!jf.isFile() || !jf.name.endsWith('.json')) continue
        const traceFile = join(pidFullPath, jf.name)
        // trace 是累计快照；每次扫描全部元数据，才能正确阻止
        // session_usage 在未改写的旧 trace 上二次补算。
        let text: string
        try {
          text = readFileSync(traceFile, 'utf8')
        } catch (e) {
          throw new Error(`WorkBuddy trace 文件不可读 (${traceFile}): ${(e as Error).message}`)
        }
        let root: unknown
        try {
          root = JSON.parse(text)
        } catch (e) {
          throw new Error(`WorkBuddy trace JSON 无法解析 (${traceFile}): ${(e as Error).message}`)
        }
        if (!isObject(root) || !isObject(root.trace)) continue

        const trace = root.trace
        const sessionId = jsonString(trace.sessionId)
        const rootSessionId = jsonString(trace.rootSessionId)

        // 从 modelInfo 获取 token 数据
        let input = 0
        let output = 0
        let cached = 0
        let model: string | null = null

        if (isObject(trace.modelInfo)) {
          const mi = trace.modelInfo
          input = tokenCount(mi.totalInputTokens)
          output = tokenCount(mi.totalOutputTokens)
          cached = Math.min(tokenCount(mi.totalCachedTokens), input)
          if (Array.isArray(mi.models) && mi.models.length > 0) {
            model = typeof mi.models[0] === 'string' ? mi.models[0] : null
          }
        }

        // model 回退到 session
        if (model === null && sessionId !== null && sessions.has(sessionId)) {
          model = sessions.get(sessionId)!.model
        }
        if (model === null) model = 'unknown'
        model = normalizeWorkBuddyModel(model)

        // API 归属按 trace.startedAt 的开始时间计算，session 创建日只做回退。
        let fallbackDate: string | null = null
        if (sessionId !== null && sessions.has(sessionId)) {
          fallbackDate = sessions.get(sessionId)!.date
        }
        const startedAt = typeof trace.startedAt === 'string' ? trace.startedAt : ''
        if (fallbackDate === null && startedAt) {
          const ms = Date.parse(startedAt)
          if (Number.isFinite(ms)) {
            fallbackDate = formatDateFromMs(ms)
          }
        }
        if (fallbackDate === null) continue

        // 跳过无 token 数据的 trace
        if (input === 0 && output === 0 && cached === 0) continue

        const { timestamp, rawTimestamp } = timestampsFromValue(startedAt, fallbackDate)
        const date = dateFromTimestamp(timestamp, fallbackDate)
        const effectiveSessionId = sessionId ?? `aggregate:${date}:${model}`
        const freshInput = freshWorkBuddyInputTokens(input, cached)
        const buckets = tokenBuckets({
          inputTokens: freshInput,
          outputTokens: output,
          cacheReadTokens: cached,
        })
        const projectPath =
          extractProjectPath(root) || (sessionId ? sessions.get(sessionId)?.projectPath : undefined)
        const apiCall: TokenUsageApiCall = {
          agent: this.agentName,
          apiCallId: relative(tracesDir, traceFile).split(sep).join('/'),
          sessionId: effectiveSessionId,
          ...(projectPath ? { projectPath } : {}),
          date,
          rawTimestamp,
          timestamp,
          hour: hourFromTimestamp(timestamp),
          model,
          ...buckets,
        }
        const effectiveRootSessionId = rootSessionId ?? sessionId
        if (effectiveRootSessionId && effectiveRootSessionId !== effectiveSessionId) {
          apiCall.rootSessionId = effectiveRootSessionId
        }
        entries.push({ apiCall, sourceSessionId: sessionId })
      }
    }

    return entries
  }

  /**
   * session_usage 是会话级累计快照，只用来补充没有 projects/trace 明细的会话。
   * ID 按会话保持稳定，使 updated_at 跨过增量回看窗口时仍会替换旧快照。
   */
  private loadSessionUsageApiCalls(
    sessions: ReadonlyMap<string, SessionInfo>,
  ): TokenUsageApiCall[] {
    const dbPath = getWorkBuddyDb()
    if (!existsSync(dbPath)) return []
    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true })
      db.exec('PRAGMA busy_timeout = 5000')
      if (!tableExists(db, 'session_usage')) return []
      const columns = tableColumnNames(db, 'session_usage')
      if (!['session_id', 'used', 'updated_at'].every((name) => columns.has(name))) return []

      const apiCalls: TokenUsageApiCall[] = []
      for (const row of queryAll(
        db,
        `SELECT session_id, used, updated_at
         FROM session_usage
         WHERE used IS NOT NULL AND used > 0
           AND updated_at IS NOT NULL AND updated_at > 0`,
      )) {
        const sessionId = dbString(row.session_id)
        const used = tokenCount(row.used)
        const updatedAt = normalizeWorkBuddyTimestamp(row.updated_at)
        if (!sessionId || used <= 0 || updatedAt <= 0) continue
        const session = sessions.get(sessionId)
        const model = normalizeWorkBuddyModel(session?.model || 'auto')
        const fallbackDate = formatDateFromMs(updatedAt)
        const { timestamp, rawTimestamp } = timestampsFromValue(updatedAt, fallbackDate)
        apiCalls.push({
          agent: this.agentName,
          apiCallId: `workbuddy-usage:${sessionId}`,
          sessionId,
          ...(session?.projectPath ? { projectPath: session.projectPath } : {}),
          date: dateFromTimestamp(timestamp, fallbackDate),
          rawTimestamp,
          timestamp,
          hour: hourFromTimestamp(timestamp),
          model,
          ...tokenBuckets({ inputTokens: used }),
        })
      }
      return apiCalls
    } catch (e) {
      throw new Error(`WorkBuddy session_usage 不可读: ${(e as Error).message}`)
    } finally {
      if (db) db.close()
    }
  }

  /** 从 workbuddy.db 的 sessions 表加载 session 信息。
   *
   * L8 修复：区分 'file missing' 和 'DB corrupt' 两种情况：
   *  - 文件不存在 → 返回空 map（正常情况，调用方 short-circuit）
   *  - 文件存在但读取失败（DB 损坏）→ 抛 Error('WorkBuddy DB 不可读')，
   *    让 scan.service 的 errors 数组捕获并反馈给 UI，避免用户误以为无数据
   */
  private async loadSessions(): Promise<Map<string, SessionInfo>> {
    const sessions = new Map<string, SessionInfo>()
    const dbPath = getWorkBuddyDb()

    // 文件不存在视为正常（用户未使用 WorkBuddy），返回空 map
    if (!existsSync(dbPath)) return sessions

    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true })
      db.exec('PRAGMA busy_timeout = 5000')
      if (!tableExists(db, 'sessions')) return sessions
      const columns = new Map<string, string>()
      for (const row of queryAll(db, 'PRAGMA table_info(sessions)')) {
        const name = row.name
        if (typeof name === 'string') columns.set(name.toLowerCase(), name)
      }
      const titleColumn = firstExistingColumn(columns, [
        'title',
        'session_title',
        'conversation_title',
        'conversationTitle',
        'name',
        'summary',
      ])
      const customTitleColumn = firstExistingColumn(columns, ['custom_title', 'customTitle'])
      const projectPathColumn = firstExistingColumn(columns, [
        'directory',
        'cwd',
        'workspace_path',
        'workspace',
        'project_path',
      ])
      const idColumn = firstExistingColumn(columns, ['id', 'session_id'])
      if (!idColumn) return sessions
      const modelColumn = firstExistingColumn(columns, ['model', 'model_id', 'model_name'])
      const createdAtColumn = firstExistingColumn(columns, [
        'created_at',
        'createdAt',
        'start_time',
      ])
      const selectCols = [
        `${idColumn} AS id`,
        modelColumn ? `${modelColumn} AS model` : 'NULL AS model',
        createdAtColumn ? `${createdAtColumn} AS created_at` : 'NULL AS created_at',
      ]
      if (titleColumn) selectCols.push(titleColumn)
      if (customTitleColumn && customTitleColumn !== titleColumn) selectCols.push(customTitleColumn)
      if (projectPathColumn) selectCols.push(projectPathColumn)

      for (const row of queryAll(db, `SELECT ${selectCols.join(', ')} FROM sessions`)) {
        const id = dbString(row.id)
        const model = normalizeWorkBuddyModel(dbString(row.model) || 'auto')
        const createdAt = normalizeWorkBuddyTimestamp(row.created_at)
        if (!id) continue
        const date = createdAt > 0 ? formatDateFromMs(createdAt) : 'unknown'
        const rawTitle = titleColumn ? dbString(row[titleColumn]) : ''
        const customTitle = customTitleColumn ? dbString(row[customTitleColumn]) : ''
        const title = cleanWorkBuddyTitle(customTitle || rawTitle)
        const projectPath = projectPathColumn
          ? normalizeCollectedProjectPath(row[projectPathColumn])
          : undefined
        sessions.set(id, {
          date,
          model,
          startedAt: timestampFromValue(createdAt, date),
          ...(title ? { title } : {}),
          ...(projectPath ? { projectPath } : {}),
        })
      }
    } catch (e) {
      // 文件存在但读取失败 = DB 损坏，抛错让 scan.service 捕获并反馈给 UI
      // （而非返回空 map 让用户误以为无数据）
      throw new Error(`WorkBuddy DB 不可读: ${(e as Error).message}`)
    } finally {
      if (db) db.close()
    }
    return sessions
  }
}

/** 执行 SELECT，返回对象数组（列名 → 值） */
function queryAll(db: Database.Database, sql: string): Record<string, DbValue>[] {
  return db.prepare(sql).all() as Record<string, DbValue>[]
}

function tableExists(db: Database.Database, table: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(table) !== undefined
  )
}

function tableColumnNames(db: Database.Database, table: string): Set<string> {
  return new Set(
    queryAll(db, `PRAGMA table_info(${table})`)
      .map((row) => dbString(row.name).toLowerCase())
      .filter(Boolean),
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function dbString(value: DbValue): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeWorkBuddyTimestamp(value: DbValue): number {
  const parsed = tokenCount(value)
  if (parsed <= 0) return 0
  return parsed <= 10_000_000_000 ? parsed * 1000 : parsed
}

function cleanWorkBuddyTitle(value: string): string {
  return value
    .replace(/@[a-zA-Z][\w-]*#\d+:"([^"]*)"/g, '$1')
    .replace(/@[a-zA-Z][\w-]*#\d+:([^\s]+)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function freshWorkBuddyInputTokens(inputTokens: number, cacheReadTokens: number): number {
  return Math.max(0, inputTokens - cacheReadTokens)
}

function reconcileApiCallSources(
  projectApiCalls: TokenUsageApiCall[],
  traceEntries: TraceApiCallEntry[],
  knownProjectRoots = new Set<string>(),
): TokenUsageApiCall[] {
  if (projectApiCalls.length === 0 && knownProjectRoots.size === 0) {
    return traceEntries.map((entry) => entry.apiCall)
  }

  const coveredRoots = new Set(knownProjectRoots)
  for (const apiCall of projectApiCalls) {
    coveredRoots.add(apiCall.rootSessionId ?? apiCall.sessionId)
  }
  const uncoveredTraceApiCalls = traceEntries
    .filter(
      (entry) =>
        entry.sourceSessionId !== null &&
        !coveredRoots.has(entry.apiCall.rootSessionId ?? entry.apiCall.sessionId),
    )
    .map((entry) => entry.apiCall)
  return [...projectApiCalls, ...uncoveredTraceApiCalls]
}

function jsonString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstExistingColumn(columns: Map<string, string>, names: string[]): string | null {
  for (const name of names) {
    const actual = columns.get(name.toLowerCase())
    if (actual) return actual
  }
  return null
}
