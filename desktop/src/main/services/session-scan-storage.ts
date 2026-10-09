import type Database from 'better-sqlite3'
import type { ScannerUsageDetails, TokenUsageApiCall } from '../../shared/models'
import type { ScannerScanContext } from '../scanners/types'
import { eventTimestampMs } from '../scanners/incremental-utils'
import { callFromCostRow, type CostRow } from '../cost/cost-cache'
import {
  aggregateSessionUsage,
  decodeMeterData,
  sessionUsageKey,
  type SessionDataRow,
} from './session-usage-codec'
import {
  readSessionMetadata,
  rebuildSessionDays,
  removeSessionUsage,
  storeSessionUsage,
} from './session-usage-storage'
import { usageCallTime } from './usage-call-time'

/** 来源事件主键仍参与对账；窗口外被更正的旧归属也一起撤销。 */
export function persistSessionScan(
  db: Database.Database,
  agent: string,
  context: ScannerScanContext,
  details: ScannerUsageDetails,
): void {
  const full = context.mode === 'full' && !context.preserveHistory
  if (!full) migrateAgentMeterData(db, agent)
  const metadata = full ? new Map() : readSessionMetadata(db, agent)
  const fresh = new Map(
    details.sessions.map((row) => [sessionUsageKey(row.sessionId, row.date, row.model), row]),
  )
  const incoming = new Set(details.apiCalls.map((call) => call.apiCallId))
  const changed = new Map<string, TokenUsageApiCall[]>()
  const keyOf = (call: TokenUsageApiCall): string =>
    sessionUsageKey(call.sessionId, usageCallTime(call).date, call.model)
  if (full) {
    for (const table of [
      'usage_cost_cache',
      'usage_api_calls',
      'usage_session_data',
      'usage_session_projects',
      'usage_sessions',
      'usage_records',
    ])
      db.prepare(`DELETE FROM ${table} WHERE agent = ?`).run(agent)
  } else {
    const scanWindow = !context.preserveHistory
    const since = context.sinceMs ?? 1
    const rows = db
      .prepare('SELECT * FROM usage_session_data WHERE agent = ?')
      .iterate(agent) as Iterable<SessionDataRow>
    for (const row of rows) {
      const calls = decodeMeterData(row)
      const kept = calls.filter(
        (call) => !incoming.has(call.apiCallId) && !(scanWindow && eventTimestampMs(call) >= since),
      )
      if (kept.length !== calls.length)
        changed.set(sessionUsageKey(row.session_id, row.date, row.model), kept)
    }
  }
  const read = db.prepare(
    'SELECT * FROM usage_session_data WHERE agent = ? AND session_id = ? AND date = ? AND model = ?',
  )
  if (!full)
    for (const [key, scanned] of fresh) {
      if (changed.has(key)) continue
      const old = metadata.get(key)
      if (
        !old ||
        !(
          ['title', 'parentSessionId', 'rootSessionId', 'subAgentName', 'projectPath'] as const
        ).some((field) => scanned[field] && scanned[field] !== old[field])
      )
        continue
      const row = read.get(agent, ...JSON.parse(key)) as SessionDataRow | undefined
      if (row) changed.set(key, decodeMeterData(row))
    }
  for (const call of details.apiCalls) {
    const key = keyOf(call)
    let calls = changed.get(key)
    if (!calls) {
      const row = full
        ? undefined
        : (read.get(agent, ...JSON.parse(key)) as SessionDataRow | undefined)
      calls = row ? decodeMeterData(row) : []
      changed.set(key, calls)
    }
    calls.push(call)
  }
  let completed = 0
  for (const [key, calls] of changed) {
    if (calls.length) {
      const old = metadata.get(key)
      const scanned = fresh.get(key)
      const info = {
        ...old,
        ...Object.fromEntries(
          Object.entries(scanned ?? {}).filter(([, value]) => value !== undefined),
        ),
        title: scanned?.title || old?.title,
      }
      storeSessionUsage(db, aggregateSessionUsage(calls, info))
    } else removeSessionUsage(db, agent, JSON.parse(key))
    completed++
    if (completed % 64 === 0 || completed === changed.size)
      context.reportProgress?.({ unit: 'sessions', completed, total: changed.size })
  }
  if (changed.size || full) rebuildSessionDays(db, agent)
}

/** 升级只转换本地已保存的计量数据，原日志已经删除的历史也能保留。 */
function migrateAgentMeterData(db: Database.Database, agent: string): void {
  if (!db.prepare('SELECT 1 FROM usage_api_calls WHERE agent = ? LIMIT 1').get(agent)) return
  if (db.prepare('SELECT 1 FROM usage_session_data WHERE agent = ? LIMIT 1').get(agent))
    throw new Error('同一来源存在两种计量存储，已停止转换')
  const metadata = readSessionMetadata(db, agent)
  const groups = new Map<string, TokenUsageApiCall[]>()
  for (const row of db
    .prepare('SELECT * FROM usage_api_calls WHERE agent = ?')
    .iterate(agent) as Iterable<CostRow>) {
    const contextRow = row as CostRow & {
      project_path?: string
      parent_session_id?: string
      root_session_id?: string
      sub_agent_name?: string
    }
    const call = {
      ...callFromCostRow(row),
      projectPath: contextRow.project_path || undefined,
      parentSessionId: contextRow.parent_session_id || undefined,
      rootSessionId: contextRow.root_session_id || undefined,
      subAgentName: contextRow.sub_agent_name || undefined,
    }
    const key = sessionUsageKey(call.sessionId, call.date, call.model)
    const calls = groups.get(key) ?? []
    calls.push(call)
    groups.set(key, calls)
  }
  db.prepare('DELETE FROM usage_api_calls WHERE agent = ?').run(agent)
  db.prepare('DELETE FROM usage_cost_cache WHERE agent = ?').run(agent)
  for (const [key, calls] of groups)
    storeSessionUsage(db, aggregateSessionUsage(calls, metadata.get(key)))
  rebuildSessionDays(db, agent)
}
