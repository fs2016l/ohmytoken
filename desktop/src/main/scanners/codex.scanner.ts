/**
 * Codex Scanner（对应 Codex 本地 rollout/thread-store 数据结构）
 *
 * 会话索引优先读取 Codex SQLite 状态库的 threads 表，逐 API/token 明细仍解析
 * rollout JSONL 中的 event_msg:token_count。状态库只保存会话级累计值，不能直接
 * 当作 API 明细或日聚合事实源。
 *
 * totalTokens = input + output（cached_input_tokens 已含在 input_tokens 中，不重复加）。
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { createHash } from 'crypto'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'path'
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
import { readUtf8Lines } from '../lib/line-reader'
import {
  getCodexArchivedSessionsDir,
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
  codexUsageSignature,
  emptyCodexUsage,
  hasTokenUsage,
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

export class CodexScanner implements AgentScanner {
  readonly agentName = 'codex'

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

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    const records: TokenUsageRecord[] = []
    const sessions: TokenUsageSession[] = []
    const apiCalls: TokenUsageApiCall[] = []
    if (!this.isAvailable()) return { records, sessions, apiCalls }

    const sessionIndexTitles = readSessionIndexTitles()
    const titleBySessionId = new Map<string, string>()
    const relationBySessionId = new Map<string, CodexSessionRelation>()
    const visitedFiles = new Set<string>()
    const acceptedSessionIds = new Set<string>()

    for (const meta of readThreadMetadata(scanContext)) {
      if (!meta.rolloutPath || !existsSync(meta.rolloutPath)) continue
      const parsed = this.parseSessionFile(
        {
          sessionFile: meta.rolloutPath,
          rootDir: getCodexHomeDir(),
          fallbackDate: dateFromThreadMeta(meta),
          sessionId: meta.sessionId,
          title: sessionIndexTitles.get(meta.sessionId) || meta.title || '',
          model: meta.model,
        },
        scanContext,
      )
      visitedFiles.add(canonicalPath(meta.rolloutPath))
      if (acceptedSessionIds.has(parsed.sessionId)) continue
      acceptedSessionIds.add(parsed.sessionId)
      relationBySessionId.set(parsed.sessionId, parsed)
      const title = sessionIndexTitles.get(parsed.sessionId) || meta.title || parsed.title
      if (title) titleBySessionId.set(parsed.sessionId, title)
      apiCalls.push(...parsed.apiCalls)
    }

    for (const parseContext of this.buildDirectoryFallbackContexts(visitedFiles, scanContext)) {
      const parsed = this.parseSessionFile(parseContext, scanContext)
      if (acceptedSessionIds.has(parsed.sessionId)) continue
      acceptedSessionIds.add(parsed.sessionId)
      relationBySessionId.set(parsed.sessionId, parsed)
      const title = sessionIndexTitles.get(parsed.sessionId) || parsed.title
      if (title) titleBySessionId.set(parsed.sessionId, title)
      apiCalls.push(...parsed.apiCalls)
    }

    applyCodexSessionRelations(apiCalls, relationBySessionId)
    const detailSessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    applySessionTitles(detailSessions, titleBySessionId)
    sessions.push(...detailSessions)
    records.push(...buildRecordsFromSessions(this.agentName, detailSessions))

    return { records, sessions, apiCalls }
  }

  private buildDirectoryFallbackContexts(
    visitedFiles: Set<string>,
    scanContext: ScannerScanContext,
  ): ParseContext[] {
    const contexts: ParseContext[] = []
    const sessionsDir = getCodexSessionsDir()
    const archivedDir = getCodexArchivedSessionsDir()

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

    return contexts
  }

  /**
   * 解析单个 Codex rollout JSONL。
   * last_token_usage 是最近一次 API 快照；total_token_usage 是会话累计值。
   * Codex 会重复写入相同累计快照，因此只在累计值变化时接纳 last_token_usage，
   * 并在文件解析结束后用最终累计值校验所有明细之和。
   */
  private parseSessionFile(
    context: ParseContext,
    scanContext: ScannerScanContext,
  ): ParsedCodexSession {
    const apiCalls: TokenUsageApiCall[] = []
    const fallbackSessionId = relative(context.rootDir, context.sessionFile).split(sep).join('/')
    let sessionId = context.sessionId || fallbackSessionId
    let currentModel = context.model || 'unknown'
    let sessionDate = context.fallbackDate
    let sessionTitle = context.title || ''
    let parentSessionId = ''
    let subAgentName = ''
    let projectPath = ''
    let isThreadSpawnSubAgent = false
    let previousAcceptedCumulative = ''
    let finalCumulative: CodexUsageSnapshot | null = null
    let acceptedUsage = emptyCodexUsage()
    let inheritedCumulativeBaseline: CodexUsageSnapshot | null = null
    let subAgentBoundaryApplied = false

    try {
      for (const { line } of readUtf8Lines(context.sessionFile)) {
        if (line.length === 0) continue
        let obj: unknown
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }
        if (!isObject(obj)) continue
        const type = readString(obj.type)

        if (type === 'session_meta') {
          const payload = obj.payload
          if (isObject(payload)) {
            if (!context.sessionId) sessionId = readString(payload.id) || sessionId
            projectPath = projectPath || extractProjectPath(payload) || ''
            const relation = readCodexSessionRelation(payload)
            parentSessionId = relation.parentSessionId || parentSessionId
            subAgentName = relation.subAgentName || subAgentName
            isThreadSpawnSubAgent = relation.isThreadSpawn || isThreadSpawnSubAgent
          }
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
          isThreadSpawnSubAgent &&
          !subAgentBoundaryApplied
        ) {
          apiCalls.length = 0
          previousAcceptedCumulative = ''
          finalCumulative = null
          acceptedUsage = emptyCodexUsage()
          inheritedCumulativeBaseline = null
          subAgentBoundaryApplied = true
        }

        if (type === 'event_msg') {
          const payload = obj.payload
          if (isObject(payload) && payload.type === 'user_message') {
            sessionTitle = keepFirstSessionTitle(sessionTitle, readString(payload.message))
          }
          if (isObject(payload) && payload.type === 'token_count') {
            const info = payload.info
            if (!isObject(info) || !isObject(info.last_token_usage)) continue
            const cumulative = readCodexUsage(info.total_token_usage)
            if (cumulative) finalCumulative = cumulative
            const cumulativeSignature = cumulative ? codexUsageSignature(cumulative) : ''
            if (cumulativeSignature && cumulativeSignature === previousAcceptedCumulative) {
              continue
            }

            const { timestamp, rawTimestamp } = timestampsFromValue(obj.timestamp, sessionDate)
            const usage = readCodexUsage(info.last_token_usage)
            if (!usage || !hasTokenUsage(usage)) continue
            acceptedUsage = addCodexUsage(acceptedUsage, usage)
            if (isThreadSpawnSubAgent && !inheritedCumulativeBaseline && cumulative) {
              inheritedCumulativeBaseline = subtractCodexUsage(cumulative, acceptedUsage)
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
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadTokens: usage.cacheReadTokens,
              cacheWriteTokens: 0,
              totalTokens: usage.inputTokens + usage.outputTokens,
              reasoningTokens: usage.reasoningTokens,
            }
            // 累计校验使用 acceptedUsage；窗口外 API 对象无需留在数组中。
            if (isApiCallInWindow(apiCall, scanContext)) apiCalls.push(apiCall)
            if (cumulativeSignature) previousAcceptedCumulative = cumulativeSignature
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
        finalCumulative,
        isThreadSpawnSubAgent ? inheritedCumulativeBaseline : null,
      )
    }
    return {
      sessionId,
      title: sessionTitle,
      apiCalls,
      ...(parentSessionId ? { parentSessionId } : {}),
      ...(subAgentName ? { subAgentName } : {}),
      ...(isThreadSpawnSubAgent ? { isThreadSpawn: true } : {}),
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
    usage.reasoningTokens,
  ].join('\u0000')
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 32)
  return `${sessionId}:${digest}`
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
