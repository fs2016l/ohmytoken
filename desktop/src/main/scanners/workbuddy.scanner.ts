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
import { normalizeScanContext, shouldScanFile } from './incremental-utils'
import { loadWorkBuddyProjectScan, normalizeWorkBuddyModel } from './workbuddy-jsonl'

/** better-sqlite3 查询值类型 */
type DbValue = number | string | bigint | Uint8Array | null

interface SessionInfo {
  date: string
  model: string
  startedAt: string
  title?: string
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
        if (!shouldScanFile(traceFile, context)) continue
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
          input = toLong(mi.totalInputTokens)
          output = toLong(mi.totalOutputTokens)
          cached = toLong(mi.totalCachedTokens)
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
        const apiCall: TokenUsageApiCall = {
          agent: this.agentName,
          apiCallId: relative(tracesDir, traceFile).split(sep).join('/'),
          sessionId: effectiveSessionId,
          date,
          rawTimestamp,
          timestamp,
          hour: hourFromTimestamp(timestamp),
          model,
          inputTokens: freshInput,
          outputTokens: output,
          cacheReadTokens: cached,
          cacheWriteTokens: 0,
          totalTokens: freshInput + cached + output,
          reasoningTokens: 0,
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
      const selectCols = ['id', 'model', 'created_at']
      if (titleColumn) selectCols.push(titleColumn)
      if (customTitleColumn && customTitleColumn !== titleColumn) selectCols.push(customTitleColumn)

      for (const row of queryAll(
        db,
        `SELECT ${selectCols.join(', ')} FROM sessions WHERE model IS NOT NULL`,
      )) {
        const id = typeof row.id === 'string' ? row.id : null
        const model = typeof row.model === 'string' ? row.model : null
        const createdAt = toLong(row.created_at)
        if (id === null || model === null) continue
        const date = createdAt > 0 ? formatDateFromMs(createdAt) : 'unknown'
        const rawTitle = titleColumn ? dbString(row[titleColumn]) : ''
        const customTitle = customTitleColumn ? dbString(row[customTitleColumn]) : ''
        const title = cleanWorkBuddyTitle(customTitle || rawTitle)
        sessions.set(id, {
          date,
          model,
          startedAt: timestampFromValue(createdAt, date),
          ...(title ? { title } : {}),
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

/** 将值转为整数（兼容 DB 值与 JSON 解析值） */
function toLong(v: unknown): number {
  if (typeof v === 'number') return Math.trunc(v) || 0
  if (typeof v === 'bigint') return Number(v) || 0
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function dbString(value: DbValue): string {
  return typeof value === 'string' ? value.trim() : ''
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
