/** 读取 Hermes 状态库并生成统一用量记录。 */
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import Database from 'better-sqlite3'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'
import { getHermesStateDbCandidates } from '../lib/paths'
import { formatDateFromMs } from '../lib/date-utils'
import {
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  timestampsFromValue,
} from './detail-utils'
import { normalizeScanContext } from './incremental-utils'
import { tokenBuckets } from './token-usage'

export class HermesScanner implements AgentScanner {
  readonly agentName = 'hermes'

  private resolveDbPaths(): string[] {
    return getHermesStateDbCandidates().filter(existsSync)
  }

  isAvailable(): boolean {
    return this.resolveDbPaths().length > 0
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    void scanContext
    const records: TokenUsageRecord[] = []
    const apiCalls: TokenUsageApiCall[] = []
    const dbPaths = this.resolveDbPaths()
    if (dbPaths.length === 0) return { records, sessions: [], apiCalls }

    const seenApiCallIds = new Set<string>()
    for (const dbPath of dbPaths) {
      let db: Database.Database | null = null
      try {
        db = new Database(dbPath, { readonly: true })
        db.exec('PRAGMA busy_timeout = 5000')
        this.readDb(db, dbPath, apiCalls, seenApiCallIds)
      } catch (e) {
        throw new Error(`Hermes 扫描失败 (${dbPath}): ${(e as Error).message}`)
      } finally {
        if (db) db.close()
      }
    }

    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    records.push(...buildRecordsFromSessions(this.agentName, sessions))
    return { records, sessions, apiCalls }
  }

  private readDb(
    db: Database.Database,
    dbPath: string,
    apiCalls: TokenUsageApiCall[],
    seenApiCallIds: Set<string>,
  ): void {
    const tables = new Set(
      queryAll(db, "SELECT name FROM sqlite_master WHERE type='table'").map((row) =>
        dbString(row.name),
      ),
    )
    if (!tables.has('sessions')) return

    const sessionColumns = tableColumns(db, 'sessions')
    const hasPerModel =
      tables.has('session_model_usage') &&
      hasColumns(tableColumns(db, 'session_model_usage'), 'session_id', 'model')
    const coveredSessionIds = new Set<string>()

    if (hasPerModel) {
      const smuColumns = tableColumns(db, 'session_model_usage')
      const tokenColumns = [
        'input_tokens',
        'output_tokens',
        'cache_read_tokens',
        'cache_write_tokens',
        'reasoning_tokens',
      ].filter((name) => smuColumns.has(name))
      const sumCol = (name: string): string => (smuColumns.has(name) ? `SUM(smu.${name})` : '0')
      // per-model 表只有五个分桶齐全时才可作为权威明细；
      // 旧 schema 缺列时整库回退 sessions，避免部分分桶被静默丢失。
      if (tokenColumns.length === 5) {
        const groupProvider = smuColumns.has('billing_provider') ? ', smu.billing_provider' : ''
        const having = tokenColumns.map((name) => `SUM(COALESCE(smu.${name}, 0)) > 0`).join(' OR ')
        const sql = `
          SELECT
            smu.session_id AS session_id,
            smu.model AS model,
            ${smuColumns.has('billing_provider') ? 'smu.billing_provider' : 'NULL'} AS billing_provider,
            ${sessionColumns.has('started_at') ? 's.started_at' : 'NULL'} AS started_at,
            ${sumCol('input_tokens')} AS input_tokens,
            ${sumCol('output_tokens')} AS output_tokens,
            ${sumCol('cache_read_tokens')} AS cache_read_tokens,
            ${sumCol('cache_write_tokens')} AS cache_write_tokens,
            ${sumCol('reasoning_tokens')} AS reasoning_tokens
          FROM session_model_usage smu
          JOIN sessions s ON s.id = smu.session_id
          WHERE smu.model IS NOT NULL AND TRIM(smu.model) != ''
          GROUP BY smu.session_id, smu.model${groupProvider}
          HAVING ${having}
        `
        try {
          for (const row of queryAll(db, sql)) {
            const call = this.rowToApiCall(row, dbPath, seenApiCallIds)
            if (call) {
              apiCalls.push(call)
              coveredSessionIds.add(call.sessionId)
            }
          }
        } catch {
          // 旧版/预览版 schema 曾出现列不完整；此时整库回退会话总量。
          coveredSessionIds.clear()
        }
      }
    }

    // 仅为尚未生成模型明细的会话补充汇总记录
    const totalCol = (name: string): string =>
      sessionColumns.has(name) ? `COALESCE(${name}, 0)` : '0'
    const fallbackSql = `
      SELECT
        id AS session_id,
        ${sessionColumns.has('model') ? 'model' : 'NULL'} AS model,
        ${sessionColumns.has('billing_provider') ? 'billing_provider' : 'NULL'} AS billing_provider,
        ${sessionColumns.has('started_at') ? 'started_at' : 'NULL'} AS started_at,
        ${totalCol('input_tokens')} AS input_tokens,
        ${totalCol('output_tokens')} AS output_tokens,
        ${totalCol('cache_read_tokens')} AS cache_read_tokens,
        ${totalCol('cache_write_tokens')} AS cache_write_tokens,
        ${totalCol('reasoning_tokens')} AS reasoning_tokens
      FROM sessions
      WHERE ${sessionColumns.has('model') ? "model IS NOT NULL AND TRIM(model) != ''" : '1=1'}
        AND (${totalCol('input_tokens')} > 0 OR ${totalCol('output_tokens')} > 0
          OR ${totalCol('cache_read_tokens')} > 0 OR ${totalCol('cache_write_tokens')} > 0
          OR ${totalCol('reasoning_tokens')} > 0)
    `
    for (const row of queryAll(db, fallbackSql)) {
      const sessionId = dbString(row.session_id)
      if (!sessionId || coveredSessionIds.has(sessionId)) continue
      const call = this.rowToApiCall(row, dbPath, seenApiCallIds)
      if (call) apiCalls.push(call)
    }
  }

  private rowToApiCall(
    row: Record<string, DbValue>,
    dbPath: string,
    seenApiCallIds: Set<string>,
  ): TokenUsageApiCall | null {
    const sessionId = dbString(row.session_id)
    if (!sessionId) return null
    const model = dbString(row.model) || 'unknown'
    const provider = dbString(row.billing_provider)
    const providerIdentity =
      row.billing_provider === null ? '<null>' : provider.length > 0 ? provider : '<empty>'
    const buckets = tokenBuckets({
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      reasoningTokens: row.reasoning_tokens,
    })
    if (buckets.totalTokens <= 0) return null

    const dbNamespace = createHash('sha256').update(dbPath).digest('hex').substring(0, 16)
    const apiCallId = `hermes:${dbNamespace}:${sessionId}:${model}:${providerIdentity}`
    if (seenApiCallIds.has(apiCallId)) return null
    seenApiCallIds.add(apiCallId)

    const startedAtValue = normalizeEpochValue(row.started_at)
    const fallbackDate = startedAtValue > 0 ? formatDateFromMs(startedAtValue) : 'unknown'
    const { timestamp, rawTimestamp } = timestampsFromValue(
      startedAtValue > 0 ? startedAtValue : undefined,
      fallbackDate,
    )

    return {
      agent: this.agentName,
      apiCallId,
      sessionId,
      date: dateFromTimestamp(timestamp, fallbackDate),
      rawTimestamp,
      timestamp,
      hour: hourFromTimestamp(timestamp),
      model,
      ...buckets,
    }
  }
}

type DbValue = number | string | bigint | Uint8Array | null

function queryAll(db: Database.Database, sql: string): Record<string, DbValue>[] {
  return db.prepare(sql).all() as Record<string, DbValue>[]
}

function tableColumns(db: Database.Database, table: string): Set<string> {
  const columns = new Set<string>()
  // 表名由本模块内部固定值提供
  for (const row of queryAll(db, `PRAGMA table_info(${table})`)) {
    const name = row.name
    if (typeof name === 'string') columns.add(name.toLowerCase())
  }
  return columns
}

function hasColumns(columns: Set<string>, ...names: string[]): boolean {
  return names.every((name) => columns.has(name))
}

function dbString(value: DbValue): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeEpochValue(value: DbValue): number {
  let ms = 0
  if (typeof value === 'number' && Number.isFinite(value)) ms = value
  else if (typeof value === 'bigint') ms = Number(value)
  else if (typeof value === 'string' && value.trim()) {
    const text = value.trim()
    if (/^\d+(\.\d+)?$/.test(text)) {
      ms = Number.parseFloat(text)
    } else {
      const parsed = Date.parse(text.replace(' ', 'T'))
      return Number.isFinite(parsed) ? parsed : 0
    }
  }
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return ms < 1e12 ? ms * 1000 : ms
}
