/** 读取 Zed 线程库并生成托管模型的统一用量记录。 */
import { existsSync } from 'fs'
import { createRequire } from 'module'
import Database from 'better-sqlite3'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'
import { getZedThreadsDbCandidates } from '../lib/paths'
import { formatDateFromMs } from '../lib/date-utils'
import {
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  timestampsFromValue,
} from './detail-utils'
import { normalizeScanContext } from './incremental-utils'
import { normalizeCollectedProjectPath } from './project-path'
import { tokenBuckets } from './token-usage'

const ZED_HOSTED_PROVIDER = 'zed.dev'
/** zstd 解码后的单条线程上限，超过时跳过该记录。 */
const MAX_ZED_THREAD_JSON_BYTES = 32 * 1024 * 1024

export class ZedScanner implements AgentScanner {
  readonly agentName = 'zed'

  private resolveDbPath(): string | null {
    return getZedThreadsDbCandidates().find(existsSync) ?? null
  }

  isAvailable(): boolean {
    return this.resolveDbPath() !== null
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    void scanContext
    const records: TokenUsageRecord[] = []
    const apiCalls: TokenUsageApiCall[] = []
    const dbPath = this.resolveDbPath()
    if (!dbPath) return { records, sessions: [], apiCalls }

    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true })
      db.exec('PRAGMA busy_timeout = 5000')

      const tables = queryAll(
        db,
        "SELECT name FROM sqlite_master WHERE type='table' AND name='threads'",
      )
      if (tables.length === 0) return { records, sessions: [], apiCalls }

      const columns = new Set<string>()
      for (const row of queryAll(db, 'PRAGMA table_info(threads)')) {
        const name = row.name
        if (typeof name === 'string') columns.add(name.toLowerCase())
      }
      if (!columns.has('id') || !columns.has('data')) return { records, sessions: [], apiCalls }

      const selectCols = ['id', 'data']
      if (columns.has('data_type')) selectCols.push('data_type')
      if (columns.has('updated_at')) selectCols.push('updated_at')
      if (columns.has('created_at')) selectCols.push('created_at')
      if (columns.has('folder_paths')) selectCols.push('folder_paths')
      if (columns.has('folder_paths_order')) selectCols.push('folder_paths_order')

      for (const row of queryAll(db, `SELECT ${selectCols.join(', ')} FROM threads`)) {
        const threadId = dbString(row.id)
        if (!threadId) continue

        let threadJson: unknown
        try {
          threadJson = decodeZedThreadPayload(row.data_type, row.data)
        } catch {
          continue
        }
        if (!isObject(threadJson)) continue
        if (threadJson.imported === true) continue

        const model = isObject(threadJson.model) ? threadJson.model : null
        const provider = model && typeof model.provider === 'string' ? model.provider.trim() : ''
        if (provider.toLowerCase() !== ZED_HOSTED_PROVIDER) continue
        const modelId = model && typeof model.model === 'string' ? model.model.trim() : ''
        if (!modelId) continue

        const usage = zedThreadUsage(threadJson)
        if (!usage) continue

        const timestampValue =
          normalizeZedTimestamp(row.created_at) ||
          normalizeZedTimestamp(row.updated_at) ||
          zedJsonTimestamp(threadJson)
        const fallbackDate = timestampValue > 0 ? formatDateFromMs(timestampValue) : 'unknown'
        const { timestamp, rawTimestamp } = timestampsFromValue(
          timestampValue > 0 ? timestampValue : undefined,
          fallbackDate,
        )
        const buckets = tokenBuckets(usage)
        const projectPath = zedProjectPath(row.folder_paths, row.folder_paths_order)

        apiCalls.push({
          agent: this.agentName,
          apiCallId: `zed:${threadId}`,
          sessionId: threadId,
          date: dateFromTimestamp(timestamp, fallbackDate),
          rawTimestamp,
          timestamp,
          hour: hourFromTimestamp(timestamp),
          model: modelId,
          ...(projectPath ? { projectPath } : {}),
          ...buckets,
        })
      }
    } catch (e) {
      throw new Error(`Zed 扫描失败: ${(e as Error).message}`)
    } finally {
      if (db) db.close()
    }

    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    records.push(...buildRecordsFromSessions(this.agentName, sessions))
    return { records, sessions, apiCalls }
  }
}

type DbValue = number | string | bigint | Uint8Array | Buffer | null

interface ZedFourBucketUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** 汇总线程中可用的请求计数。 */
function zedThreadUsage(thread: Record<string, unknown>): ZedFourBucketUsage | null {
  const requestUsage = thread.request_token_usage
  if (requestUsage !== undefined && requestUsage !== null) {
    const summed = sumZedRequestUsage(requestUsage)
    if (summed && summedTotal(summed) > 0) return summed
  }
  const cumulative = thread.cumulative_token_usage
  if (isObject(cumulative)) {
    const usage = zedUsageFromValue(cumulative)
    if (usage && summedTotal(usage) > 0) return usage
  }
  return null
}

function sumZedRequestUsage(value: unknown): ZedFourBucketUsage | null {
  let items: unknown[] = []
  if (Array.isArray(value)) items = value
  else if (isObject(value)) items = Object.values(value)
  else return null

  const total: ZedFourBucketUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  for (const item of items) {
    if (!isObject(item)) continue
    const usage = zedUsageFromValue(item)
    if (!usage || summedTotal(usage) <= 0) continue
    total.inputTokens += usage.inputTokens
    total.outputTokens += usage.outputTokens
    total.cacheReadTokens += usage.cacheReadTokens
    total.cacheWriteTokens += usage.cacheWriteTokens
  }
  return total
}

function zedUsageFromValue(value: Record<string, unknown>): ZedFourBucketUsage | null {
  const inputTokens = zedTokenField(value, 'input_tokens')
  const outputTokens = zedTokenField(value, 'output_tokens')
  const cacheReadTokens = zedTokenField(value, 'cache_read_input_tokens')
  const cacheWriteTokens = zedTokenField(value, 'cache_creation_input_tokens')
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens <= 0) return null
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
}

function summedTotal(usage: ZedFourBucketUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

function zedTokenField(value: Record<string, unknown>, field: string): number {
  const raw = value[field]
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.trunc(raw))
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed)) return Math.max(0, parsed)
  }
  return 0
}

/** 按 data_type 解码线程内容。 */
function decodeZedThreadPayload(dataType: DbValue, data: DbValue): unknown {
  const type = typeof dataType === 'string' ? dataType.toLowerCase() : 'json'
  if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data)) {
    if (typeof data === 'string') {
      if (Buffer.byteLength(data, 'utf8') > MAX_ZED_THREAD_JSON_BYTES) {
        throw new Error('json payload too large')
      }
      return JSON.parse(data)
    }
    return null
  }
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
  if (type === 'json' || type === '') {
    if (bytes.length > MAX_ZED_THREAD_JSON_BYTES) throw new Error('json payload too large')
    return JSON.parse(bytes.toString('utf8'))
  }
  if (type === 'zstd') {
    const decompressed = zstdDecompress(bytes)
    if (decompressed.length > MAX_ZED_THREAD_JSON_BYTES) {
      throw new Error('zstd payload too large')
    }
    return JSON.parse(decompressed.toString('utf8'))
  }
  return null
}

function zedProjectPath(pathsValue: DbValue, orderValue: DbValue): string | undefined {
  const paths = dbString(pathsValue)
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
  if (paths.length === 0) return undefined
  const order = dbString(orderValue)
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 0 && value < paths.length)
  return normalizeCollectedProjectPath(paths[order[0] ?? 0])
}

function zstdDecompress(bytes: Buffer): Buffer {
  // 当前运行时不支持 zstd 时，由调用方跳过该记录
  const nodeRequire = createRequire(__filename)
  const zlib = nodeRequire('zlib') as typeof import('zlib') & {
    zstdDecompressSync?: (input: Uint8Array) => Uint8Array
  }
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('zstd unsupported')
  }
  return Buffer.from(zlib.zstdDecompressSync(bytes))
}

function zedJsonTimestamp(thread: Record<string, unknown>): number {
  for (const key of ['updated_at', 'created_at', 'updatedAt', 'createdAt']) {
    const value = thread[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value < 1e12 ? value * 1000 : value
    }
    if (typeof value === 'string' && value) {
      const parsed = Date.parse(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return 0
}

function normalizeZedTimestamp(value: DbValue): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value === 'bigint' && value > 0n) {
    const num = Number(value)
    return num < 1e12 ? num * 1000 : num
  }
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim()
    if (/^\d+$/.test(text)) {
      const num = Number.parseInt(text, 10)
      return num < 1e12 ? num * 1000 : num
    }
    const parsed = Date.parse(text.replace(' ', 'T'))
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function queryAll(db: Database.Database, sql: string): Record<string, DbValue>[] {
  return db.prepare(sql).all() as Record<string, DbValue>[]
}

function dbString(value: DbValue): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
