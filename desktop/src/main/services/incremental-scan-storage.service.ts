import type {
  ScanMode,
  ScannerUsageDetails,
  TokenUsageRecord,
  TokenUsageSession,
} from '../../shared/models'
import { formatLocalTimestampFromMs, timestampEpochMs } from '../lib/date-utils'
import { eventTimestampMs, SCAN_LOOKBACK_MS } from '../scanners/incremental-utils'
import type { ScannerScanContext } from '../scanners/types'
import { insertRecords } from './data-storage.service'
import { SCANNER_REVISION } from './incremental-scan.constants'
import { openDatabase } from './sqlite-storage.service'
import { insertApiCallRows, insertSessionRows } from './usage-detail-storage.service'

interface ScanAgentStateRow {
  agent: string
  initialized: number
  scanner_revision: number
  event_watermark_ms: number
  last_success_ms: number
  last_full_success_ms: number
  last_mode: string
}

interface AggregateRow {
  parent_session_id: string | null
  root_session_id: string | null
  sub_agent_name: string | null
  project_path: string | null
  started_at: string
  ended_at: string
  started_at_ms: number | null
  ended_at_ms: number | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  reasoning_tokens: number
  api_call_count: number
}

interface StoredSessionMetaRow {
  title: string | null
  parent_session_id: string | null
  root_session_id: string | null
  sub_agent_name: string | null
  project_path: string | null
}

export interface AgentScanPlan {
  context: ScannerScanContext
  /** 首次基线会把用户请求的 incremental 提升为 full。 */
  effectiveMode: ScanMode
}

export function buildAgentScanPlan(
  agent: string,
  requestedMode: ScanMode,
  scanStartedAtMs: number,
): AgentScanPlan {
  if (requestedMode === 'full') {
    return {
      effectiveMode: 'full',
      context: { mode: 'full', scanStartedAtMs },
    }
  }

  const state = getAgentScanState(agent)
  if (!state || state.initialized !== 1 || state.scanner_revision !== SCANNER_REVISION) {
    return {
      effectiveMode: 'full',
      context: { mode: 'full', scanStartedAtMs },
    }
  }

  // 有事件时从已提交的事件水位回看；无事件的 Agent 才退回上次成功扫描时间。
  // 两个水位都只在成功事务末尾推进，系统时钟回拨时以当前时间为上限。
  const persistedWatermarkMs =
    state.event_watermark_ms > 0 ? state.event_watermark_ms : state.last_success_ms
  const watermarkMs = Math.min(persistedWatermarkMs, scanStartedAtMs)
  const sinceMs = Math.max(1, watermarkMs - SCAN_LOOKBACK_MS)
  return {
    effectiveMode: 'incremental',
    context: { mode: 'incremental', sinceMs, scanStartedAtMs },
  }
}

export function getAgentScanState(agent: string): ScanAgentStateRow | null {
  const row = openDatabase()
    .prepare('SELECT * FROM scan_agent_state WHERE agent = ?')
    .get(agent) as ScanAgentStateRow | undefined
  return row ?? null
}

/**
 * 单 Agent 原子提交：窗口 API 对账、受影响聚合重建、扫描水位推进要么全部成功，
 * 要么全部回滚。scanner 的 sessions 只作为标题/关系元数据，token 汇总以完整 API 表为准。
 */
export function persistAgentScan(
  agent: string,
  context: ScannerScanContext,
  details: ScannerUsageDetails,
): void {
  const db = openDatabase()
  const persist = db.transaction(() => {
    const oldState = getAgentScanState(agent)
    const sessionKeys = new Set<string>()
    const recordKeys = new Set<string>()
    const oldMetadata = new Map<string, StoredSessionMetaRow>()

    if (context.mode === 'full') {
      db.prepare('DELETE FROM usage_api_calls WHERE agent = ?').run(agent)
      db.prepare('DELETE FROM usage_sessions WHERE agent = ?').run(agent)
      db.prepare('DELETE FROM usage_records WHERE agent = ?').run(agent)
    } else {
      inheritStoredRootRelations(agent, details)
      const sinceMs = context.sinceMs ?? 1
      const oldRows = db
        .prepare(
          `SELECT session_id, date, model
           FROM usage_api_calls
           WHERE agent = ? AND event_timestamp_ms >= ?`,
        )
        .all(agent, sinceMs) as Array<{ session_id: string; date: string; model: string }>

      // api_call_id 是 (agent, api_call_id) 主键。同一个来源事件被修正后，可能从
      // 窗口外的旧 session/date/model 移动到本批新键；窗口 DELETE 不会碰到那条旧行。
      // 插入前先抓取旧归属，确保 REPLACE 后旧会话和旧日汇总也会被重建，而不是残留。
      const findExistingByApiCallId = db.prepare(
        `SELECT session_id, date, model
         FROM usage_api_calls
         WHERE agent = ? AND api_call_id = ?`,
      )
      for (const call of details.apiCalls) {
        const existing = findExistingByApiCallId.get(agent, call.apiCallId) as
          { session_id: string; date: string; model: string } | undefined
        if (existing) oldRows.push(existing)
      }

      for (const row of oldRows) {
        sessionKeys.add(sessionKey(row.session_id, row.date, row.model))
        recordKeys.add(recordKey(row.date, row.model))
      }
      collectStoredMetadata(agent, oldRows, oldMetadata)
      db.prepare('DELETE FROM usage_api_calls WHERE agent = ? AND event_timestamp_ms >= ?').run(
        agent,
        sinceMs,
      )
    }

    for (const call of details.apiCalls) {
      sessionKeys.add(sessionKey(call.sessionId, call.date, call.model))
      recordKeys.add(recordKey(call.date, call.model))
    }
    for (const session of details.sessions) {
      sessionKeys.add(sessionKey(session.sessionId, session.date, session.model))
      recordKeys.add(recordKey(session.date, session.model))
    }

    insertApiCallRows(details.apiCalls)
    rebuildSessions(agent, sessionKeys, details.sessions, oldMetadata)
    rebuildRecords(agent, recordKeys, details.records)

    const previousEventWatermark = oldState?.event_watermark_ms ?? 0
    const batchEventWatermark = details.apiCalls.reduce(
      (max, call) => Math.max(max, eventTimestampMs(call)),
      0,
    )
    const eventWatermark =
      context.mode === 'full'
        ? batchEventWatermark
        : Math.max(previousEventWatermark, batchEventWatermark)
    const previousFullSuccess = oldState?.last_full_success_ms ?? 0
    db.prepare(
      `INSERT INTO scan_agent_state
        (agent, initialized, scanner_revision, event_watermark_ms, last_success_ms,
         last_full_success_ms, last_mode)
       VALUES (?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(agent) DO UPDATE SET
         initialized = excluded.initialized,
         scanner_revision = excluded.scanner_revision,
         event_watermark_ms = excluded.event_watermark_ms,
         last_success_ms = excluded.last_success_ms,
         last_full_success_ms = excluded.last_full_success_ms,
         last_mode = excluded.last_mode`,
    ).run(
      agent,
      SCANNER_REVISION,
      eventWatermark,
      context.scanStartedAtMs,
      context.mode === 'full' ? context.scanStartedAtMs : previousFullSuccess,
      context.mode,
    )
  })
  persist()
}

/**
 * 增量批次可能只包含活跃的孙级子 Agent，祖先 rollout 不一定落在窗口内。
 * 提交前借助已保存的父会话关系补齐真正 root，避免同一用户任务被拆成多个会话。
 */
function inheritStoredRootRelations(agent: string, details: ScannerUsageDetails): void {
  const db = openDatabase()
  const findRoot = db.prepare(`
    SELECT
      COALESCE(NULLIF(root_session_id, ''), session_id) AS root_session_id,
      NULLIF(project_path, '') AS project_path
    FROM usage_sessions
    WHERE agent = ? AND session_id = ?
    ORDER BY ended_at_ms DESC, started_at_ms DESC, ended_at DESC
    LIMIT 1
  `)
  const metadataCache = new Map<string, { rootSessionId: string; projectPath: string }>()
  const storedMetadata = (sessionId: string): { rootSessionId: string; projectPath: string } => {
    const cached = metadataCache.get(sessionId)
    if (cached) return cached
    const row = findRoot.get(agent, sessionId) as
      { root_session_id?: string; project_path?: string } | undefined
    const metadata = {
      rootSessionId: row?.root_session_id?.trim() || '',
      projectPath: row?.project_path?.trim() || '',
    }
    metadataCache.set(sessionId, metadata)
    return metadata
  }

  for (const item of [...details.apiCalls, ...details.sessions]) {
    const parentSessionId = item.parentSessionId?.trim()
    if (!parentSessionId) continue
    const parentMeta = storedMetadata(parentSessionId)
    const existingMeta = storedMetadata(item.sessionId)
    const resolvedRoot = parentMeta.rootSessionId || existingMeta.rootSessionId
    if (resolvedRoot && resolvedRoot !== item.sessionId) item.rootSessionId = resolvedRoot
    if (!item.projectPath) {
      item.projectPath = parentMeta.projectPath || existingMeta.projectPath || undefined
    }
  }
}

function collectStoredMetadata(
  agent: string,
  rows: Array<{ session_id: string; date: string; model: string }>,
  target: Map<string, StoredSessionMetaRow>,
): void {
  if (rows.length === 0) return
  const db = openDatabase()
  const get = db.prepare(
    `SELECT title, parent_session_id, root_session_id, sub_agent_name, project_path
     FROM usage_sessions
     WHERE agent = ? AND session_id = ? AND date = ? AND model = ?`,
  )
  for (const row of rows) {
    const key = sessionKey(row.session_id, row.date, row.model)
    if (target.has(key)) continue
    const metadata = get.get(agent, row.session_id, row.date, row.model) as
      StoredSessionMetaRow | undefined
    if (metadata) target.set(key, metadata)
  }
}

function rebuildSessions(
  agent: string,
  keys: Set<string>,
  scannedSessions: TokenUsageSession[],
  oldMetadata: Map<string, StoredSessionMetaRow>,
): void {
  const db = openDatabase()
  const scannedMetadata = new Map(
    scannedSessions.map((session) => [
      sessionKey(session.sessionId, session.date, session.model),
      session,
    ]),
  )
  const remove = db.prepare(
    'DELETE FROM usage_sessions WHERE agent = ? AND session_id = ? AND date = ? AND model = ?',
  )
  const aggregate = db.prepare(
    `SELECT
       MAX(NULLIF(parent_session_id, '')) AS parent_session_id,
       MAX(COALESCE(NULLIF(root_session_id, ''), session_id)) AS root_session_id,
       MAX(NULLIF(sub_agent_name, '')) AS sub_agent_name,
       MAX(NULLIF(project_path, '')) AS project_path,
       MIN(timestamp) AS started_at,
       MAX(timestamp) AS ended_at,
       MIN(CASE WHEN event_timestamp_ms > 0 THEN event_timestamp_ms END) AS started_at_ms,
       MAX(event_timestamp_ms) AS ended_at_ms,
       COALESCE(SUM(input_tokens), 0) AS input_tokens,
       COALESCE(SUM(output_tokens), 0) AS output_tokens,
       COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
       COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
       COALESCE(SUM(total_tokens), 0) AS total_tokens,
       COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
       COUNT(*) AS api_call_count
     FROM usage_api_calls
     WHERE agent = ? AND session_id = ? AND date = ? AND model = ?`,
  )

  const rebuilt: TokenUsageSession[] = []
  for (const key of keys) {
    const [sessionId, date, model] = splitKey(key)
    remove.run(agent, sessionId, date, model)
    const row = aggregate.get(agent, sessionId, date, model) as AggregateRow
    if (!row || row.api_call_count <= 0) continue
    const fresh = scannedMetadata.get(key)
    const old = oldMetadata.get(key)
    const parentSessionId =
      fresh?.parentSessionId ?? row.parent_session_id ?? old?.parent_session_id
    const rootSessionId =
      fresh?.rootSessionId ?? row.root_session_id ?? old?.root_session_id ?? sessionId
    const subAgentName = fresh?.subAgentName ?? row.sub_agent_name ?? old?.sub_agent_name
    const projectPath = fresh?.projectPath ?? row.project_path ?? old?.project_path
    rebuilt.push({
      agent,
      sessionId,
      ...(parentSessionId ? { parentSessionId } : {}),
      ...(rootSessionId !== sessionId || parentSessionId ? { rootSessionId } : {}),
      ...(subAgentName ? { subAgentName } : {}),
      ...(projectPath ? { projectPath } : {}),
      ...(fresh?.title || old?.title ? { title: fresh?.title || old?.title || undefined } : {}),
      date,
      startedAt:
        row.started_at || (row.started_at_ms ? formatLocalTimestampFromMs(row.started_at_ms) : ''),
      endedAt: row.ended_at || (row.ended_at_ms ? formatLocalTimestampFromMs(row.ended_at_ms) : ''),
      model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      totalTokens: row.total_tokens,
      reasoningTokens: row.reasoning_tokens,
      apiCallCount: row.api_call_count,
    })
  }
  insertSessionRows(rebuilt)
}

function rebuildRecords(
  agent: string,
  keys: Set<string>,
  scannerRecords: TokenUsageRecord[],
): void {
  const db = openDatabase()
  const remove = db.prepare('DELETE FROM usage_records WHERE agent = ? AND date = ? AND model = ?')
  const aggregate = db.prepare(
    `SELECT
       COALESCE(SUM(input_tokens), 0) AS input_tokens,
       COALESCE(SUM(output_tokens), 0) AS output_tokens,
       COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
       COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
       COALESCE(SUM(total_tokens), 0) AS total_tokens,
       COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
       COUNT(*) AS api_call_count
     FROM usage_api_calls
     WHERE agent = ? AND date = ? AND model = ?`,
  )
  const rebuilt: TokenUsageRecord[] = []
  for (const key of keys) {
    const [date, model] = splitKey(key)
    remove.run(agent, date, model)
    const row = aggregate.get(agent, date, model) as AggregateRow
    if (!row || row.api_call_count <= 0) continue
    rebuilt.push({
      agent,
      date,
      model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      totalTokens: row.total_tokens,
      reasoningTokens: row.reasoning_tokens,
      cost: 0,
    })
  }

  // 兼容只实现旧 records、没有 API 明细的第三方 scanner。
  if (keys.size === 0 && scannerRecords.length > 0) rebuilt.push(...scannerRecords)
  insertRecords(rebuilt)
}

function sessionKey(sessionId: string, date: string, model: string): string {
  return [sessionId, date, model].join('\u0000')
}

function recordKey(date: string, model: string): string {
  return [date, model].join('\u0000')
}

function splitKey(key: string): string[] {
  return key.split('\u0000')
}

export function incrementalFromDisplay(context: ScannerScanContext): string | undefined {
  return context.mode === 'incremental' && context.sinceMs
    ? formatLocalTimestampFromMs(context.sinceMs)
    : undefined
}

export function apiCallEventTimestampMs(rawTimestamp: string, timestamp: string): number {
  return timestampEpochMs(rawTimestamp) || timestampEpochMs(timestamp)
}
