/** 读取 Goose 会话数据库并生成统一用量记录。 */
import { existsSync } from 'fs'
import Database from 'better-sqlite3'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'
import { getGooseSessionsDbCandidates } from '../lib/paths'
import { formatDateFromMs } from '../lib/date-utils'
import {
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  timestampsFromValue,
} from './detail-utils'
import { normalizeScanContext } from './incremental-utils'
import { tokenBuckets, tokenCount } from './token-usage'

export class GooseScanner implements AgentScanner {
  readonly agentName = 'goose'

  private resolveDbPath(): string | null {
    return getGooseSessionsDbCandidates().find(existsSync) ?? null
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
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'",
      )
      if (tables.length === 0) return { records, sessions: [], apiCalls }

      const columns = new Set<string>()
      for (const row of queryAll(db, 'PRAGMA table_info(sessions)')) {
        const name = row.name
        if (typeof name === 'string') columns.add(name.toLowerCase())
      }
      if (!columns.has('id')) return { records, sessions: [], apiCalls }

      const select = (name: string): string => (columns.has(name) ? name : 'NULL AS ' + name)
      const sql = `
        SELECT
          id,
          ${select('model_config_json')},
          ${select('created_at')},
          ${select('total_tokens')},
          ${select('input_tokens')},
          ${select('output_tokens')},
          ${select('accumulated_total_tokens')},
          ${select('accumulated_input_tokens')},
          ${select('accumulated_output_tokens')}
        FROM sessions
      `

      for (const row of queryAll(db, sql)) {
        const sessionId = dbString(row.id)
        if (!sessionId) continue
        const modelConfigJson = dbString(row.model_config_json)
        if (!modelConfigJson) continue

        const input = pickValue(row.accumulated_input_tokens, row.input_tokens)
        const output = pickValue(row.accumulated_output_tokens, row.output_tokens)
        const total = pickValue(row.accumulated_total_tokens, row.total_tokens)
        if (input <= 0 && output <= 0 && total <= 0) continue

        // 把尚未分配的正差额纳入内部补充分项
        const buckets = tokenBuckets({
          inputTokens: input,
          outputTokens: output,
          // Goose 没有独立的 reasoning 列；只把总量中可证明的正差额归入推理。
          reasoningTokens: total > input + output ? total - input - output : 0,
        })
        const model = gooseModelFromConfig(modelConfigJson)
        const createdAtValue = parseGooseCreatedAt(row.created_at)
        const hasCreatedAt =
          (typeof createdAtValue === 'number' && createdAtValue > 0) ||
          (typeof createdAtValue === 'string' && createdAtValue.length > 0)
        const fallbackDate =
          typeof createdAtValue === 'number' && createdAtValue > 0
            ? formatDateFromMs(createdAtValue)
            : 'unknown'
        const { timestamp, rawTimestamp } = timestampsFromValue(
          hasCreatedAt ? createdAtValue : undefined,
          fallbackDate,
        )

        apiCalls.push({
          agent: this.agentName,
          apiCallId: `goose:${sessionId}`,
          sessionId,
          date: dateFromTimestamp(timestamp, fallbackDate),
          rawTimestamp,
          timestamp,
          hour: hourFromTimestamp(timestamp),
          model,
          ...buckets,
        })
      }
    } catch (e) {
      throw new Error(`Goose 扫描失败: ${(e as Error).message}`)
    } finally {
      if (db) db.close()
    }

    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    records.push(...buildRecordsFromSessions(this.agentName, sessions))
    return { records, sessions, apiCalls }
  }
}

type DbValue = number | string | bigint | Uint8Array | null

function queryAll(db: Database.Database, sql: string): Record<string, DbValue>[] {
  return db.prepare(sql).all() as Record<string, DbValue>[]
}

function dbString(value: DbValue): string {
  return typeof value === 'string' ? value.trim() : ''
}

function pickValue(primary: DbValue, fallback: DbValue): number {
  const primaryNumber = toTokenNumber(primary)
  // accumulated_* 只要非 NULL 就是权威快照；0 也不得回退到旧字段。
  if (primaryNumber !== null) return primaryNumber
  const fallbackNumber = toTokenNumber(fallback)
  return Math.max(0, fallbackNumber ?? 0)
}

function toTokenNumber(value: DbValue): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return tokenCount(value)
  if (typeof value === 'bigint') return tokenCount(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return tokenCount(parsed)
  }
  return null
}

function gooseModelFromConfig(modelConfigJson: string): string {
  try {
    const parsed: unknown = JSON.parse(modelConfigJson)
    if (parsed && typeof parsed === 'object') {
      const config = parsed as Record<string, unknown>
      for (const key of ['model_name', 'model', 'name']) {
        const value = config[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
      }
    }
  } catch {
    // 无法解析结构时保留清理后的值
  }
  const cleaned = modelConfigJson.replace(/["{}[\]]/g, '').trim()
  return cleaned || 'unknown'
}

/** 将数据库时间值转换为 epoch 毫秒，失败返回 0。 */
function parseGooseCreatedAt(value: DbValue): string | number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value === 'bigint' && value > 0n) {
    const num = Number(value)
    return num < 1e12 ? num * 1000 : num
  }
  if (typeof value !== 'string') return 0
  const text = value.trim()
  if (!text) return 0
  if (/^\d+$/.test(text)) {
    const num = Number.parseInt(text, 10)
    return num < 1e12 ? num * 1000 : num
  }
  // Goose 的 SQLite 无时区 created_at 按 UTC 写入。
  const normalized = text.replace(' ', 'T')
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
  const parsed = Date.parse(hasZone ? normalized : `${normalized}Z`)
  if (Number.isFinite(parsed)) return parsed
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : NaN
  return Number.isFinite(dateOnly) ? dateOnly : 0
}
