/**
 * 会话级与 API 轮次级 Token 明细持久化服务。
 * 旧的 usage_records 日聚合表保持不变，本服务只读写新增明细表。
 */
import type {
  LatestGeneration,
  LatestTurnFirstToken,
  PageResult,
  TokenUsageApiCall,
  TokenUsageRecord,
  TokenUsageSession,
  TokenUsageSessionChild,
  TokenUsageUserSession,
  UsageApiCallFilter,
  UsageApiRecordFilter,
  UsageApiRecordPageFilter,
  UsageDetailFilter,
  UsageDetailPageFilter,
  UsageTrendStats,
} from '../../shared/models'
import { hasExplicitTimezone, localTimestampFromValue, timestampEpochMs } from '../lib/date-utils'
import { openDatabase } from './sqlite-storage.service'
import { canonicalModelName } from '../cost/price-catalog'
import { modelSqlSelection } from './model-identity.service'
import { ensureLocalFavoriteSchema } from './local-favorite-schema'
import {
  buildProjectSqlFilter,
  buildTrackedProjectsSqlFilter,
  projectOwnerSql,
} from './project.service'
import {
  searchableSessionTitleSql,
  USAGE_SESSION_SEARCH_CONTENT_VIEW,
} from './session-title-search'
import { workspaceSearchKeywords } from '../../shared/workspace-search'
import { orderByLatestActivity, updateLatestActivity } from '../../shared/usage-activity'
import { evidenceForCall, parseUsageEvidence } from '../cost/usage-evidence'
import { readCallCost, writeCallCost } from '../cost/cost-cache'
import type { CostRollupRow } from '../cost/cost-rollup-storage'
import { hasProjectScope, readSessionCost, sessionSourceSql } from './session-project-scope'
import { combineCostRollups, unpricedCostRollup } from '../../shared/cost-rollup'
import { PRICE_CATALOG_VERSION } from '../cost/price-catalog'
import { usageCallTime } from './usage-call-time'
import { attachSessionTurns } from './session-turns'
import { attachSessionGeneration } from './session-generation-read'
import { storeLatestTurnFirstTokens } from './session-turn-timing-storage'
import {
  storeLatestGenerationCalls,
  storeLatestGenerationSamples,
} from './session-generation-storage'

interface UsageSessionRow extends CostRollupRow {
  cost_groups?: string | null
  agent: string
  session_id: string
  parent_session_id: string | null
  root_session_id: string | null
  sub_agent_name: string | null
  project_path: string | null
  title: string | null
  date: string
  started_at: string
  ended_at: string
  started_at_ms: number
  ended_at_ms: number
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  reasoning_tokens: number
  api_call_count: number
  api_count_complete?: number
}

interface UsageApiCallRow {
  usage_evidence: string | null
  agent: string
  api_call_id: string
  session_id: string
  parent_session_id: string | null
  root_session_id: string | null
  sub_agent_name: string | null
  project_path: string | null
  role: string | null
  date: string
  raw_timestamp: string
  timestamp: string
  event_timestamp_ms: number
  source_scope: string
  hour: number
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  reasoning_tokens: number
}

interface UsageAggregateRow {
  agent: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  reasoning_tokens: number
}

interface UsageTrendAggregateRow {
  bucket_ms: number
  dimension: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  reasoning_tokens: number
}

export interface UsageAgentModelAggregate {
  agent: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  reasoningTokens: number
}

type MutableUserSession = TokenUsageUserSession & {
  missingCost: boolean
  agentActivity: Map<string, number>
  modelActivity: Map<string, number>
  modelTokenMap: Map<string, number>
}

interface UserSessionPageKey {
  agent: string
  root_session_id: string
  match_score?: number
}

interface NormalizedPagination {
  page: number
  pageSize: number
  totalPages: number
  offset: number
}

type QueryParam = string | number

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_DAILY_AGGREGATE_RANGES = 8

interface DailyAggregateCache {
  dataVersion: number
  totalChanges: number
  ranges: Map<string, TokenUsageRecord[]>
}

const dailyAggregateCaches = new WeakMap<ReturnType<typeof openDatabase>, DailyAggregateCache>()

export function saveUsageSessions(sessions: TokenUsageSession[]): void {
  if (sessions.length === 0) return
  const db = openDatabase()
  const insertMany = db.transaction((rows: TokenUsageSession[]) => {
    insertSessionRows(rows)
    const latest = new Map<string, LatestGeneration[]>()
    const turnFirstTokens = new Map<string, LatestTurnFirstToken[]>()
    for (const row of rows) {
      if (row.latestTurnFirstToken?.sessionId === row.sessionId) {
        const samples = turnFirstTokens.get(row.agent) ?? []
        samples.push(row.latestTurnFirstToken)
        turnFirstTokens.set(row.agent, samples)
      }
      if (!row.latestGeneration || row.latestGeneration.sessionId !== row.sessionId) continue
      const samples = latest.get(row.agent) ?? []
      samples.push(row.latestGeneration)
      latest.set(row.agent, samples)
    }
    for (const [agent, samples] of latest) storeLatestGenerationSamples(db, agent, samples)
    for (const [agent, samples] of turnFirstTokens) storeLatestTurnFirstTokens(db, agent, samples)
  })
  insertMany(sessions)
}

export function saveUsageApiCalls(apiCalls: TokenUsageApiCall[]): void {
  if (apiCalls.length === 0) return
  const db = openDatabase()
  const insertMany = db.transaction((rows: TokenUsageApiCall[]) => {
    insertApiCallRows(rows)
    storeApiCallGenerations(db, rows)
  })
  insertMany(apiCalls)
}

function storeApiCallGenerations(
  db: ReturnType<typeof openDatabase>,
  apiCalls: TokenUsageApiCall[],
): void {
  const grouped = new Map<string, TokenUsageApiCall[]>()
  for (const call of apiCalls) {
    const calls = grouped.get(call.agent) ?? []
    calls.push(call)
    grouped.set(call.agent, calls)
  }
  for (const [agent, calls] of grouped) storeLatestGenerationCalls(db, agent, calls)
}

export function replaceUsageDetailsForAgents(
  agents: string[],
  sessions: TokenUsageSession[],
  apiCalls: TokenUsageApiCall[],
): void {
  const uniqueAgents = [...new Set(agents)].filter(Boolean)
  if (uniqueAgents.length === 0) return
  const db = openDatabase()
  const replaceMany = db.transaction((agentNames: string[]) => {
    const placeholders = agentNames.map(() => '?').join(', ')
    db.prepare(`DELETE FROM usage_sessions WHERE agent IN (${placeholders})`).run(...agentNames)
    db.prepare(`DELETE FROM usage_api_calls WHERE agent IN (${placeholders})`).run(...agentNames)
    insertSessionRows(sessions.filter((session) => agentNames.includes(session.agent)))
    const scopedCalls = apiCalls.filter((apiCall) => agentNames.includes(apiCall.agent))
    insertApiCallRows(scopedCalls)
    storeApiCallGenerations(db, scopedCalls)
  })
  replaceMany(uniqueAgents)
}

export function insertSessionRows(sessions: TokenUsageSession[]): void {
  if (sessions.length === 0) return
  const db = openDatabase()
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO usage_sessions
      (agent, session_id, parent_session_id, root_session_id, sub_agent_name, project_path,
       title, date,
       started_at, ended_at, model, input_tokens, output_tokens, cache_read_tokens,
       cache_write_tokens, total_tokens, reasoning_tokens, api_call_count,
       started_at_ms, ended_at_ms)
    VALUES
      (@agent, @session_id, @parent_session_id, @root_session_id, @sub_agent_name,
       @project_path, @title, @date, @started_at, @ended_at, @model, @input_tokens, @output_tokens,
       @cache_read_tokens, @cache_write_tokens, @total_tokens, @reasoning_tokens,
       @api_call_count, @started_at_ms, @ended_at_ms)
  `)
  for (const row of sessions) {
    const startedAt = row.startedAt ? localTimestampFromValue(row.startedAt, row.date) : ''
    const endedAt = row.endedAt ? localTimestampFromValue(row.endedAt, row.date) : ''
    stmt.run({
      agent: row.agent,
      session_id: row.sessionId,
      parent_session_id: row.parentSessionId ?? null,
      root_session_id: row.rootSessionId ?? row.sessionId,
      sub_agent_name: row.subAgentName ?? null,
      project_path: row.projectPath ?? null,
      title: row.title ?? null,
      date: row.date,
      started_at: startedAt,
      ended_at: endedAt,
      started_at_ms: timestampEpochMs(row.startedAt),
      ended_at_ms: timestampEpochMs(row.endedAt),
      model: row.model,
      input_tokens: row.inputTokens,
      output_tokens: row.outputTokens,
      cache_read_tokens: row.cacheReadTokens,
      cache_write_tokens: row.cacheWriteTokens,
      total_tokens: row.totalTokens,
      reasoning_tokens: row.reasoningTokens,
      api_call_count: row.apiCallCount,
    })
  }
}

export function insertApiCallRows(
  apiCalls: TokenUsageApiCall[],
  reportProgress?: (completed: number) => void,
): void {
  if (apiCalls.length === 0) return
  const db = openDatabase()
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO usage_api_calls
      (agent, api_call_id, session_id, parent_session_id, root_session_id, sub_agent_name,
       project_path, role, date, raw_timestamp, timestamp, hour, model, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, total_tokens, reasoning_tokens,
       event_timestamp_ms, source_scope, usage_evidence)
    VALUES
      (@agent, @api_call_id, @session_id, @parent_session_id, @root_session_id,
       @sub_agent_name, @project_path, @role, @date, @raw_timestamp, @timestamp, @hour, @model,
       @input_tokens, @output_tokens, @cache_read_tokens, @cache_write_tokens,
       @total_tokens, @reasoning_tokens, @event_timestamp_ms, @source_scope, @usage_evidence)
  `)
  let completed = 0
  for (const row of apiCalls) {
    const { timestamp, ...timeParts } = usageCallTime(row)
    const stored = {
      agent: row.agent,
      api_call_id: row.apiCallId,
      session_id: row.sessionId,
      parent_session_id: row.parentSessionId ?? null,
      root_session_id: row.rootSessionId ?? row.sessionId,
      sub_agent_name: row.subAgentName ?? null,
      project_path: row.projectPath ?? null,
      role: row.role ?? null,
      date: timeParts.date,
      raw_timestamp: row.rawTimestamp ?? (hasExplicitTimezone(row.timestamp) ? row.timestamp : ''),
      timestamp,
      event_timestamp_ms: timestampEpochMs(row.rawTimestamp) || timestampEpochMs(row.timestamp),
      source_scope: row.rootSessionId ?? row.sessionId,
      usage_evidence: JSON.stringify(evidenceForCall(row)),
      hour: timeParts.hour,
      model: row.model,
      input_tokens: row.inputTokens,
      output_tokens: row.outputTokens,
      cache_read_tokens: row.cacheReadTokens,
      cache_write_tokens: row.cacheWriteTokens,
      total_tokens: row.totalTokens,
      reasoning_tokens: row.reasoningTokens,
    }
    stmt.run(stored)
    writeCallCost(db, stored)
    completed++
    if (completed % 256 === 0 || completed === apiCalls.length) reportProgress?.(completed)
  }
}

export function listUsageSessions(filter: UsageDetailFilter): TokenUsageSession[] {
  const sessions = selectSessionRows(filter).map(rowToSession)
  attachSessionGeneration(openDatabase(), sessions)
  for (const session of sessions)
    attachSessionTurns(openDatabase(), [session], {
      ...filter,
      from: session.date,
      to: session.date,
      model: session.model,
    })
  return sessions
}

export function listUserUsageSessions(filter: UsageDetailFilter): TokenUsageUserSession[] {
  const rows = selectSessionRows(filter)
  const sessions = buildUserSessions(rows)
  attachSessionTurns(openDatabase(), sessions, filter)
  return sessions
}

export function listUserUsageSessionsPage(
  filter: UsageDetailPageFilter,
): PageResult<TokenUsageUserSession> {
  const db = openDatabase()
  const { whereSql, params } = buildSessionWhere(filter)
  const source = sessionSourceSql(filter)
  const rootExpression = "COALESCE(NULLIF(root_session_id, ''), session_id)"
  const search = buildSessionSearchScore(filter.query, hasProjectScope(filter))
  const searchColumn = search.scoreSql ? `, (${search.scoreSql}) AS match_score` : ''
  const searchHaving = search.scoreSql ? 'HAVING match_score > 0' : ''
  const countRow = db
    .prepare(
      `${source} SELECT COUNT(*) AS total FROM (
        SELECT agent, ${rootExpression}${searchColumn}
        FROM usage_sessions
        ${search.joinSql}
        ${whereSql}
        GROUP BY agent, ${rootExpression}
        ${searchHaving}
      )`,
    )
    .get(...search.params, ...params) as { total?: number } | undefined
  const total = Number(countRow?.total || 0)
  const pagination = normalizePagination(filter.page, filter.pageSize, total)
  if (total === 0) return createPageResult([], pagination, total)

  const pageKeys = db
    .prepare(
      `${source} SELECT
        agent,
        ${rootExpression} AS root_session_id,
        ${search.scoreSql ? `(${search.scoreSql})` : '0'} AS match_score,
        MAX(
          CASE
            WHEN ended_at_ms > 0 THEN ended_at_ms
            WHEN started_at_ms > 0 THEN started_at_ms
            ELSE 0
          END
        ) AS recent_ms,
        MAX(COALESCE(NULLIF(ended_at, ''), NULLIF(started_at, ''), date)) AS recent_value,
        SUM(total_tokens) AS grouped_total
      FROM usage_sessions
      ${search.joinSql}
      ${whereSql}
      GROUP BY agent, ${rootExpression}
      ${searchHaving}
      ORDER BY match_score DESC, recent_ms DESC, recent_value DESC, grouped_total DESC,
               agent ASC, root_session_id ASC
      LIMIT ? OFFSET ?`,
    )
    .all(
      ...search.params,
      ...params,
      pagination.pageSize,
      pagination.offset,
    ) as UserSessionPageKey[]

  if (pageKeys.length === 0) return createPageResult([], pagination, total)

  const pageWhere = pageKeys.map(() => `(agent = ? AND ${rootExpression} = ?)`).join(' OR ')
  const pageParams = pageKeys.flatMap((key) => [key.agent, key.root_session_id])
  const rows = db
    .prepare(
      `${source} SELECT * FROM usage_sessions
      ${whereSql}
      ${whereSql ? 'AND' : 'WHERE'} (${pageWhere})
      ORDER BY ended_at_ms DESC, started_at_ms DESC, date DESC,
               ended_at DESC, started_at DESC, total_tokens DESC`,
    )
    .all(...params, ...pageParams) as UsageSessionRow[]
  const byKey = new Map(
    buildUserSessions(rows).map((session) => [
      groupKey(session.agent, session.rootSessionId),
      session,
    ]),
  )
  const items = pageKeys.flatMap((key) => {
    const session = byKey.get(groupKey(key.agent, key.root_session_id))
    return session ? [session] : []
  })
  attachSessionTurns(db, items, filter)
  return createPageResult(items, pagination, total)
}

export function listUsageApiCalls(filter: UsageApiCallFilter): TokenUsageApiCall[] {
  return listUsageApiRecords(filter)
}

/** Materialize only selected roots after workspace filtering and ordering. */
export function readUserSessionsByKeys(
  filter: UsageDetailFilter,
  keys: Array<{ agent: string; rootSessionId: string }>,
): TokenUsageUserSession[] {
  if (!keys.length) return []
  const db = openDatabase()
  const { whereSql, params } = buildSessionWhere(filter)
  const root = "COALESCE(NULLIF(root_session_id, ''), session_id)"
  const selected = keys.map(() => `(agent = ? AND ${root} = ?)`).join(' OR ')
  const rows = db
    .prepare(
      `${sessionSourceSql(filter)} SELECT * FROM usage_sessions ${whereSql}
    ${whereSql ? 'AND' : 'WHERE'} (${selected})
    ORDER BY ended_at_ms DESC, started_at_ms DESC, date DESC, ended_at DESC`,
    )
    .all(...params, ...keys.flatMap((key) => [key.agent, key.rootSessionId])) as UsageSessionRow[]
  const sessions = new Map(
    buildUserSessions(rows).map((session) => [
      groupKey(session.agent, session.rootSessionId),
      session,
    ]),
  )
  const ordered = keys.flatMap((key) => sessions.get(groupKey(key.agent, key.rootSessionId)) ?? [])
  attachSessionTurns(db, ordered, filter)
  return ordered
}

export function listUsageApiRecords(filter: UsageApiRecordFilter): TokenUsageApiCall[] {
  return readApiSnapshot(() => selectUsageApiRecords(filter))
}

function selectUsageApiRecords(filter: UsageApiRecordFilter): TokenUsageApiCall[] {
  const db = openDatabase()
  const { whereSql, params } = buildApiCallWhere(filter)

  const sql = `
    SELECT * FROM usage_api_calls
    ${whereSql}
    ORDER BY timestamp DESC, api_call_id DESC
  `
  const rows = db.prepare(sql).all(...params) as UsageApiCallRow[]
  return rows.map(rowToApiCall)
}

export function listUsageApiRecordsPage(
  filter: UsageApiRecordPageFilter,
): PageResult<TokenUsageApiCall> {
  return readApiSnapshot(() => selectUsageApiRecordsPage(filter))
}

function selectUsageApiRecordsPage(
  filter: UsageApiRecordPageFilter,
): PageResult<TokenUsageApiCall> {
  const db = openDatabase()
  const { whereSql, params } = buildApiCallWhere(filter)
  const countRow = db
    .prepare(`SELECT COUNT(*) AS total FROM usage_api_calls ${whereSql}`)
    .get(...params) as { total?: number } | undefined
  const total = Number(countRow?.total || 0)
  const pagination = normalizePagination(filter.page, filter.pageSize, total)
  if (total === 0) return createPageResult([], pagination, total)

  const rows = db
    .prepare(
      `SELECT * FROM usage_api_calls
      ${whereSql}
      ORDER BY timestamp DESC, api_call_id DESC
      LIMIT ? OFFSET ?`,
    )
    .all(...params, pagination.pageSize, pagination.offset) as UsageApiCallRow[]
  return createPageResult(rows.map(rowToApiCall), pagination, total)
}

export function listAgentModelAggregates(
  filter: Pick<UsageApiRecordFilter, 'agent' | 'model' | 'from' | 'to'>,
): UsageAgentModelAggregate[] {
  const db = openDatabase()
  const { whereSql, params } = buildApiCallWhere(filter)
  const rows = db
    .prepare(
      `SELECT
        agent,
        model,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens,
        SUM(cache_write_tokens) AS cache_write_tokens,
        SUM(total_tokens) AS total_tokens,
        SUM(reasoning_tokens) AS reasoning_tokens
      FROM usage_token_totals
      ${whereSql}
      GROUP BY agent, model
      ORDER BY total_tokens DESC, model ASC, agent ASC`,
    )
    .all(...params) as UsageAggregateRow[]
  return rows.map((row) => ({
    agent: row.agent,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    totalTokens: row.total_tokens,
    reasoningTokens: row.reasoning_tokens,
  }))
}

export function listDailyAgentModelAggregates(from: string, to: string): TokenUsageRecord[] {
  const db = openDatabase()
  // 事务内可能读取尚未提交的数据，不能与普通查询共享结果。
  if (db.inTransaction) return queryDailyAgentModelAggregates(db, from, to)

  const dataVersion = db.pragma('data_version', { simple: true }) as number
  const { totalChanges } = db.prepare('SELECT total_changes() AS totalChanges').get() as {
    totalChanges: number
  }
  let cache = dailyAggregateCaches.get(db)
  if (cache?.dataVersion !== dataVersion || cache.totalChanges !== totalChanges) {
    cache = { dataVersion, totalChanges, ranges: new Map() }
    dailyAggregateCaches.set(db, cache)
  }

  const key = JSON.stringify([from, to])
  const cached = cache.ranges.get(key)
  if (cached) return cached.map((row) => ({ ...row }))

  const rows = queryDailyAgentModelAggregates(db, from, to)
  // 扫描在其他进程提交时 data_version 会变化；查询期间有提交则不缓存这一批结果。
  if (db.pragma('data_version', { simple: true }) === dataVersion) {
    if (cache.ranges.size >= MAX_DAILY_AGGREGATE_RANGES) {
      const oldest = cache.ranges.keys().next().value
      if (oldest !== undefined) cache.ranges.delete(oldest)
    }
    cache.ranges.set(
      key,
      rows.map((row) => ({ ...row })),
    )
  } else {
    dailyAggregateCaches.delete(db)
  }
  return rows
}

function queryDailyAgentModelAggregates(
  db: ReturnType<typeof openDatabase>,
  from: string,
  to: string,
): TokenUsageRecord[] {
  const rows = db
    .prepare(
      `SELECT
        agent,
        date,
        model,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens,
        SUM(cache_write_tokens) AS cache_write_tokens,
        SUM(total_tokens) AS total_tokens,
        SUM(reasoning_tokens) AS reasoning_tokens
      FROM usage_token_totals
      WHERE date >= ? AND date <= ?
      GROUP BY agent, date, model
      ORDER BY date ASC, agent ASC, model ASC`,
    )
    .all(from, to) as Array<UsageAggregateRow & { date: string }>
  return rows.map((row) => ({
    agent: row.agent,
    date: row.date,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    totalTokens: row.total_tokens,
    reasoningTokens: row.reasoning_tokens,
    cost: 0,
  }))
}

export function listUsageApiCallsByDate(date: string): TokenUsageApiCall[] {
  return readApiSnapshot(() => selectUsageApiCallsByDate(date))
}

function selectUsageApiCallsByDate(date: string): TokenUsageApiCall[] {
  const db = openDatabase()
  const rows = db
    .prepare('SELECT * FROM usage_api_calls WHERE date = ? ORDER BY hour ASC, timestamp ASC')
    .all(date) as UsageApiCallRow[]
  return rows.map(rowToApiCall)
}

/** 分钟级趋势查询，完整保留所选时间范围内每一分钟的零值桶。 */
export function listMinuteUsageTrend(
  fromMs: number,
  toMs: number,
  groupBy: 'agent' | 'model',
): UsageTrendStats {
  const minuteMs = 60_000
  const rangeFrom = Math.min(fromMs, toMs)
  const rangeTo = Math.max(fromMs, toMs)
  const firstBucket = Math.floor(rangeFrom / minuteMs) * minuteMs
  const lastBucket = Math.floor(rangeTo / minuteMs) * minuteMs
  const dimensionColumn = groupBy === 'model' ? 'model' : 'agent'
  const db = openDatabase()
  const rows = db
    .prepare(
      `SELECT
        event_timestamp_ms - (event_timestamp_ms % ${minuteMs}) AS bucket_ms,
        ${dimensionColumn} AS dimension,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens,
        SUM(cache_write_tokens) AS cache_write_tokens,
        SUM(total_tokens) AS total_tokens,
        SUM(reasoning_tokens) AS reasoning_tokens
      FROM usage_api_calls
      WHERE event_timestamp_ms >= ? AND event_timestamp_ms <= ?
      GROUP BY bucket_ms, ${dimensionColumn}
      ORDER BY bucket_ms ASC, total_tokens DESC`,
    )
    .all(rangeFrom, rangeTo) as UsageTrendAggregateRow[]

  const pointByTimestamp = new Map<
    number,
    { dimensionTokens: Record<string, number>; totalTokens: number }
  >()
  const dimensionTotals: Record<string, number> = {}
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let totalTokens = 0
  let reasoningTokens = 0

  for (const row of rows) {
    const timestamp = Number(row.bucket_ms)
    if (!Number.isFinite(timestamp)) continue
    const dimension = row.dimension || 'unknown'
    const tokens = Number(row.total_tokens) || 0
    const point = pointByTimestamp.get(timestamp) ?? { dimensionTokens: {}, totalTokens: 0 }
    point.dimensionTokens[dimension] = (point.dimensionTokens[dimension] || 0) + tokens
    point.totalTokens += tokens
    pointByTimestamp.set(timestamp, point)
    dimensionTotals[dimension] = (dimensionTotals[dimension] || 0) + tokens
    inputTokens += Number(row.input_tokens) || 0
    outputTokens += Number(row.output_tokens) || 0
    cacheReadTokens += Number(row.cache_read_tokens) || 0
    cacheWriteTokens += Number(row.cache_write_tokens) || 0
    totalTokens += tokens
    reasoningTokens += Number(row.reasoning_tokens) || 0
  }

  const points: UsageTrendStats['points'] = []
  for (let timestamp = firstBucket; timestamp <= lastBucket; timestamp += minuteMs) {
    const point = pointByTimestamp.get(timestamp)
    points.push({
      timestamp,
      dimensionTokens: point?.dimensionTokens ?? {},
      totalTokens: point?.totalTokens ?? 0,
    })
  }

  return {
    from: rangeFrom,
    to: rangeTo,
    groupBy,
    bucketMinutes: 1,
    points,
    dimensionTotals,
    totalTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
  }
}

function selectSessionRows(filter: UsageDetailFilter): UsageSessionRow[] {
  const db = openDatabase()
  const { whereSql, params } = buildSessionWhere(filter)

  const sql = `
    ${sessionSourceSql(filter)}
    SELECT * FROM usage_sessions
    ${whereSql}
    ORDER BY ended_at_ms DESC, started_at_ms DESC, date DESC,
             ended_at DESC, started_at DESC, total_tokens DESC
  `
  return db.prepare(sql).all(...params) as UsageSessionRow[]
}

function buildUserSessions(rows: UsageSessionRow[]): TokenUsageUserSession[] {
  if (rows.length === 0) return []

  const sessions = rows.map(rowToSession)
  const rootMeta = loadRootSessionMeta(sessions)
  const grouped = new Map<string, MutableUserSession>()

  for (const session of sessions) {
    const rootSessionId = session.rootSessionId ?? session.sessionId
    const key = groupKey(session.agent, rootSessionId)
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, createUserSession(session, rootMeta.get(key), rootSessionId))
    } else {
      mergeIntoUserSession(existing, session)
    }
  }

  const userSessions = [...grouped.values()]
    .map((session) => {
      session.children.sort(compareSessionRecent)
      session.agents = orderByLatestActivity(session.agentActivity)
      session.models = orderByLatestActivity(session.modelActivity)
      session.modelTotals = Object.fromEntries(session.modelTokenMap)
      const {
        missingCost,
        agentActivity: _agentActivity,
        modelActivity: _modelActivity,
        modelTokenMap: _modelTokenMap,
        ...cleanSession
      } = session
      if (missingCost && !cleanSession.costSummary?.pricedRecords)
        cleanSession.costSummary = undefined
      return cleanSession
    })
    .sort(compareUserSessionRecent)
  attachSessionGeneration(openDatabase(), userSessions, true)
  return userSessions
}

export function buildSessionWhere(filter: UsageDetailFilter): {
  whereSql: string
  params: QueryParam[]
} {
  const clauses: string[] = []
  const params: QueryParam[] = []
  if (filter.onlyFavorites === true) {
    ensureLocalFavoriteSchema(openDatabase())
    clauses.push(`EXISTS (SELECT 1 FROM local_favorites f WHERE f.entity_type = 'session'
      AND f.agent = usage_sessions.agent
      AND f.entity_id = COALESCE(NULLIF(usage_sessions.root_session_id, ''), usage_sessions.session_id))`)
  }
  addEqualsFilter(clauses, params, 'agent', filter.agent)
  if (filter.model) {
    const selection = modelSqlSelection('model', [filter.model])
    clauses.push(selection.sql)
    params.push(...selection.params)
  }
  addSelectionFilters(clauses, params, filter)
  if (filter.rootSessionId) {
    clauses.push("COALESCE(NULLIF(root_session_id, ''), session_id) = ?")
    params.push(filter.rootSessionId)
  }
  addProjectFilter(clauses, params, filter.projectId, filter.trackedProjectsOnly)
  addDateFilters(clauses, params, filter.from, filter.to)
  return { whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

function addSelectionFilters(
  clauses: string[],
  params: QueryParam[],
  filter: Pick<UsageDetailFilter, 'agents' | 'models' | 'projectIds'>,
): void {
  for (const [column, values] of [
    ['agent', filter.agents],
    ['model', filter.models],
  ] as const) {
    if (!values?.length) continue
    if (
      !Array.isArray(values) ||
      values.length > 256 ||
      values.some((value) => typeof value !== 'string')
    )
      throw new Error('Invalid session filter')
    if (column === 'model') {
      const selection = modelSqlSelection(column, values)
      clauses.push(selection.sql)
      params.push(...selection.params)
    } else {
      clauses.push(`${column} IN (${values.map(() => '?').join(',')})`)
      params.push(...values)
    }
  }
  if (filter.projectIds?.length) {
    if (
      !Array.isArray(filter.projectIds) ||
      filter.projectIds.length > 256 ||
      filter.projectIds.some((value) => typeof value !== 'string')
    )
      throw new Error('Invalid project filter')
    const projects = filter.projectIds.map((id) => buildProjectSqlFilter(id, 'project_path'))
    clauses.push(`(${projects.map((project) => project.clause || '0 = 1').join(' OR ')})`)
    params.push(...projects.flatMap((project) => project.params))
  }
}

function buildApiCallWhere(filter: UsageApiRecordFilter): {
  whereSql: string
  params: QueryParam[]
} {
  const clauses: string[] = []
  const params: QueryParam[] = []
  addEqualsFilter(clauses, params, 'agent', filter.agent)
  addEqualsFilter(clauses, params, 'session_id', filter.sessionId)
  addSelectionFilters(clauses, params, filter)
  if (filter.rootSessionId) {
    clauses.push("COALESCE(NULLIF(root_session_id, ''), session_id) = ?")
    params.push(filter.rootSessionId)
  }
  if (filter.model) {
    const selection = modelSqlSelection('model', [filter.model])
    clauses.push(selection.sql)
    params.push(...selection.params)
  }
  addProjectFilter(clauses, params, filter.projectId, filter.trackedProjectsOnly)
  addDateFilters(clauses, params, filter.from, filter.to)
  return { whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

function addEqualsFilter(
  clauses: string[],
  params: QueryParam[],
  column: string,
  value: string | undefined,
): void {
  if (!value) return
  clauses.push(`${column} = ?`)
  params.push(value)
}

function addDateFilters(
  clauses: string[],
  params: QueryParam[],
  from: string | undefined,
  to: string | undefined,
): void {
  if (from) {
    clauses.push('date >= ?')
    params.push(from)
  }
  if (to) {
    clauses.push('date <= ?')
    params.push(to)
  }
}

function addProjectFilter(
  clauses: string[],
  params: QueryParam[],
  projectId: string | undefined,
  trackedProjectsOnly: boolean | undefined,
): void {
  if (!projectId && !trackedProjectsOnly) return
  const projectFilter = projectId
    ? buildProjectSqlFilter(projectId, 'project_path')
    : buildTrackedProjectsSqlFilter('project_path')
  if (!projectFilter.clause) return
  clauses.push(projectFilter.clause)
  params.push(...projectFilter.params)
}

interface SessionSearchScore {
  scoreSql: string
  joinSql: string
  params: QueryParam[]
}

const TITLE_KEYWORD_SCORE = 180
const METADATA_KEYWORD_SCORE = 100
const ALL_TITLE_KEYWORDS_BONUS = 160
const ORDERED_TITLE_KEYWORDS_BONUS = 60
const TITLE_PREFIX_BONUS = 30
const SEARCH_METADATA_FIELDS = [
  'model',
  'agent',
  'sub_agent_name',
  'session_id',
  'root_session_id',
] as const

const FTS_ROW_MATCH_SQL = `EXISTS (
  SELECT 1 FROM usage_sessions_fts
  WHERE usage_sessions_fts.rowid = usage_sessions.rowid
    AND usage_sessions_fts MATCH ?
)`

const SEARCH_CONTENT_ALIAS = 'usage_session_search_content'

/**
 * 搜索按空格拆成 OR 关键词，并在 root 会话级累计相关性：
 * - 正常标题命中高于模型、Agent、子 Agent 和会话 ID；
 * - 多关键词同时出现在同一标题、保持输入顺序或靠近标题开头时继续加分；
 * - 超长标题和明显完整对话由 FTS 内容视图统一置空，不参与召回与评分。
 * 长词优先走 trigram FTS5，再用统一规范化文本匹配，忽略中英文字间空格和大小写。
 * 项目和分析页复用同一 root 召回；最终仍在 SQLite 内评分、排序和分页。
 */
export function buildSessionSearchScore(
  query: string | undefined,
  projectScoped = false,
): SessionSearchScore {
  const keywords = workspaceSearchKeywords(query)
  if (keywords.length === 0) return { scoreSql: '', joinSql: '', params: [] }

  const scoreParts: string[] = []
  const params: QueryParam[] = []
  const searchableTitle = `${SEARCH_CONTENT_ALIAS}.search_title`
  // A root title can live outside the selected date/model scope. It still identifies
  // its children, without pulling the parent's out-of-scope usage into the totals.
  const rootTitle = `(SELECT ${searchableSessionTitleSql('parent.title')}
    FROM main.usage_sessions parent WHERE parent.agent = usage_sessions.agent
      AND parent.session_id = COALESCE(NULLIF(usage_sessions.root_session_id, ''), usage_sessions.session_id)
    ORDER BY parent.ended_at_ms DESC, parent.date DESC LIMIT 1)`
  for (const keyword of keywords) {
    const projectMatch = `INSTR(workspace_search_text(project_path), ?) > 0
      OR ${projectOwnerSql('workspace_search_path(project_path)')} IN (SELECT id FROM tracked_projects
        WHERE ignored = 0 AND (INSTR(workspace_search_text(name), ?) > 0
          OR INSTR(workspace_search_text(notes), ?) > 0))`
    const linkedProjects = projectScoped
      ? ''
      : ` OR EXISTS (
      SELECT 1 FROM (
        SELECT p.project_path FROM usage_session_projects p
          WHERE p.agent = usage_sessions.agent AND p.session_id = usage_sessions.session_id
            AND p.date = usage_sessions.date AND p.model = usage_sessions.model
        UNION
        SELECT a.project_path FROM usage_api_calls a
          WHERE a.agent = usage_sessions.agent AND a.session_id = usage_sessions.session_id
            AND a.date = usage_sessions.date AND a.model = usage_sessions.model
      ) linked_projects WHERE ${projectMatch}
    )`
    scoreParts.push(`MAX(CASE WHEN ${projectMatch}${linkedProjects}
      THEN ${METADATA_KEYWORD_SCORE} ELSE 0 END)`)
    params.push(keyword, keyword, keyword)
    if (!projectScoped) params.push(keyword, keyword, keyword)
    const long = [...keyword].length >= 3
    const phrase = `"${keyword.replace(/"/g, '""')}"`
    const titleMatch = [searchableTitle, rootTitle]
      .map((field) => `INSTR(workspace_search_text(${field}), ?) > 0`)
      .join(' OR ')
    const metadataMatches = SEARCH_METADATA_FIELDS.map(
      (field) => `INSTR(workspace_search_text(${field}), ?) > 0`,
    )
    scoreParts.push(`MAX(CASE
      WHEN ${long ? FTS_ROW_MATCH_SQL + ' OR ' : ''}${titleMatch} THEN ${TITLE_KEYWORD_SCORE}
      WHEN ${long ? FTS_ROW_MATCH_SQL + ' OR ' : ''}(${metadataMatches.join(' OR ')}) THEN ${METADATA_KEYWORD_SCORE}
      ELSE 0
    END)`)
    if (long) params.push(`title : ${phrase}`)
    params.push(keyword, keyword)
    if (long) params.push(`{${SEARCH_METADATA_FIELDS.join(' ')}} : ${phrase}`)
    params.push(...metadataMatches.map(() => keyword))
  }

  if (keywords.length > 1) {
    const allTitleMatches = keywords
      .map(() => `INSTR(workspace_search_text(${searchableTitle}), ?) > 0`)
      .join(' AND ')
    scoreParts.push(`MAX(CASE WHEN ${allTitleMatches} THEN ${ALL_TITLE_KEYWORDS_BONUS} ELSE 0 END)`)
    params.push(...keywords.map((keyword) => keyword.toLowerCase()))

    const orderedTitleMatches = keywords
      .slice(0, -1)
      .map(
        () =>
          `(INSTR(workspace_search_text(${searchableTitle}), ?) > 0
            AND INSTR(workspace_search_text(${searchableTitle}), ?) > INSTR(workspace_search_text(${searchableTitle}), ?))`,
      )
      .join(' AND ')
    scoreParts.push(
      `MAX(CASE WHEN ${orderedTitleMatches} THEN ${ORDERED_TITLE_KEYWORDS_BONUS} ELSE 0 END)`,
    )
    for (let index = 0; index < keywords.length - 1; index += 1) {
      params.push(
        keywords[index].toLowerCase(),
        keywords[index + 1].toLowerCase(),
        keywords[index].toLowerCase(),
      )
    }
  }

  scoreParts.push(
    `MAX(CASE WHEN INSTR(workspace_search_text(${searchableTitle}), ?) BETWEEN 1 AND 12 THEN ${TITLE_PREFIX_BONUS} ELSE 0 END)`,
  )
  params.push(keywords[0].toLowerCase())

  return {
    scoreSql: scoreParts.join(' + '),
    joinSql: `JOIN (
        SELECT rowid AS search_rowid, title AS search_title
        FROM ${USAGE_SESSION_SEARCH_CONTENT_VIEW}
      ) AS ${SEARCH_CONTENT_ALIAS}
      ON ${SEARCH_CONTENT_ALIAS}.search_rowid = usage_sessions.rowid`,
    params,
  }
}

/** Shared search recall for the session, project and analytics workspaces. */
export function readMatchingSessionRoots(filter: UsageDetailFilter): Set<string> | undefined {
  const search = buildSessionSearchScore(filter.query, hasProjectScope(filter))
  if (!search.scoreSql) return undefined
  const { whereSql, params } = buildSessionWhere(filter)
  const root = "COALESCE(NULLIF(root_session_id, ''), session_id)"
  const source = sessionSourceSql(filter)
  const rows = openDatabase()
    .prepare(
      `${source}
    SELECT agent, ${root} AS root_id, (${search.scoreSql}) AS relevance
    FROM usage_sessions ${search.joinSql} ${whereSql}
    GROUP BY agent, ${root} HAVING relevance > 0`,
    )
    .all(...search.params, ...params) as Array<{ agent: string; root_id: string }>
  return new Set(rows.map((row) => JSON.stringify([row.agent, row.root_id])))
}

/** Match each project's actual usage paths, so a name hit does not leak to a
 * second project merely because a root conversation touched both directories. */
export function readMatchingSessionProjects(filter: UsageDetailFilter): Set<string> | undefined {
  const search = buildSessionSearchScore(filter.query, true)
  if (!search.scoreSql) return undefined
  const scoped = { ...filter, trackedProjectsOnly: true, onlyFavorites: false }
  const { whereSql, params } = buildSessionWhere(scoped)
  const rows = openDatabase()
    .prepare(
      `${sessionSourceSql(scoped)}
    SELECT ${projectOwnerSql('project_path')} AS project_id, (${search.scoreSql}) AS relevance
    FROM usage_sessions ${search.joinSql} ${whereSql}
    GROUP BY project_id HAVING relevance > 0`,
    )
    .all(...search.params, ...params) as Array<{ project_id: string }>
  return new Set(rows.map((row) => row.project_id))
}

function normalizePagination(
  requestedPage: number | undefined,
  requestedPageSize: number | undefined,
  total: number,
): NormalizedPagination {
  const pageSize = Math.min(MAX_PAGE_SIZE, positiveInteger(requestedPageSize, DEFAULT_PAGE_SIZE))
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0
  const page = Math.min(Math.max(1, positiveInteger(requestedPage, 1)), Math.max(1, totalPages))
  return { page, pageSize, totalPages, offset: (page - 1) * pageSize }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback
}

function createPageResult<T>(
  items: T[],
  pagination: NormalizedPagination,
  total: number,
): PageResult<T> {
  return {
    items,
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: pagination.totalPages,
  }
}

function loadRootSessionMeta(sessions: TokenUsageSession[]): Map<string, TokenUsageSession> {
  const db = openDatabase()
  const roots = new Map<string, { agent: string; rootSessionId: string }>()
  for (const session of sessions) {
    const rootSessionId = session.rootSessionId ?? session.sessionId
    const key = groupKey(session.agent, rootSessionId)
    if (!roots.has(key)) roots.set(key, { agent: session.agent, rootSessionId })
  }

  const stmt = db.prepare(`
    SELECT * FROM usage_sessions
    WHERE agent = ? AND session_id = ?
    ORDER BY ended_at_ms DESC, started_at_ms DESC,
             ended_at DESC, started_at DESC, total_tokens DESC
    LIMIT 1
  `)
  const meta = new Map<string, TokenUsageSession>()
  for (const [key, root] of roots) {
    const row = stmt.get(root.agent, root.rootSessionId) as UsageSessionRow | undefined
    if (row) meta.set(key, rowToSession(row))
  }
  return meta
}

function createUserSession(
  session: TokenUsageSession,
  rootMeta: TokenUsageSession | undefined,
  rootSessionId: string,
): MutableUserSession {
  const title = rootMeta?.title ?? session.title
  const base: MutableUserSession = {
    missingCost: false,
    projectPath: session.projectPath ?? rootMeta?.projectPath,
    agent: rootMeta?.agent ?? session.agent,
    sessionId: rootSessionId,
    rootSessionId,
    date: session.date,
    startedAt: rootMeta?.startedAt ?? session.startedAt,
    endedAt: session.endedAt,
    model: session.model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    apiCallCount: 0,
    agents: [],
    models: [],
    children: [],
    agentActivity: new Map<string, number>(),
    modelActivity: new Map<string, number>(),
    modelTokenMap: new Map<string, number>(),
  }
  if (title) base.title = title
  mergeIntoUserSession(base, session)
  return base
}

function mergeIntoUserSession(target: MutableUserSession, session: TokenUsageSession): void {
  target.missingCost ||= !session.costSummary
  target.costSummary = combineCostRollups(
    [
      ...(target.costSummary ? [target.costSummary] : []),
      session.costSummary ??
        unpricedCostRollup(
          session.agent,
          session.model,
          session.totalTokens,
          session.apiCallCount,
          PRICE_CATALOG_VERSION,
        ),
    ],
    PRICE_CATALOG_VERSION,
  )
  target.date = laterDate(target.date, session.date)
  target.startedAt = earlierTimestamp(target.startedAt, session.startedAt)
  target.endedAt = laterTimestamp(target.endedAt, session.endedAt)
  target.inputTokens += session.inputTokens
  target.outputTokens += session.outputTokens
  target.cacheReadTokens += session.cacheReadTokens
  target.cacheWriteTokens += session.cacheWriteTokens
  target.totalTokens += session.totalTokens
  target.reasoningTokens += session.reasoningTokens
  target.apiCallCount += session.apiCallCount
  target.apiCallCountComplete =
    target.apiCallCountComplete !== false && session.apiCallCountComplete !== false
  const recent =
    timestampEpochMs(session.endedAt) ||
    timestampEpochMs(session.startedAt) ||
    timestampEpochMs(session.date)
  updateLatestActivity(target.agentActivity, session.agent, recent)
  updateLatestActivity(target.modelActivity, session.model, recent)
  target.modelTokenMap.set(
    session.model,
    (target.modelTokenMap.get(session.model) || 0) + session.totalTokens,
  )
  target.model = session.model

  const rootSessionId = session.rootSessionId ?? session.sessionId
  if (session.sessionId !== rootSessionId || session.parentSessionId) {
    target.children.push(toSessionChild(session, rootSessionId))
  }
}

function toSessionChild(session: TokenUsageSession, rootSessionId: string): TokenUsageSessionChild {
  return {
    ...session,
    parentSessionId: session.parentSessionId ?? rootSessionId,
    rootSessionId,
  }
}

function rowToSession(row: UsageSessionRow): TokenUsageSession {
  const session: TokenUsageSession = {
    costSummary: readSessionCost(row),
    agent: row.agent,
    sessionId: row.session_id,
    date: row.date,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    model: canonicalModelName(row.model),
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    totalTokens: row.total_tokens,
    reasoningTokens: row.reasoning_tokens,
    apiCallCount: row.api_call_count,
    apiCallCountComplete: row.api_count_complete !== 0,
  }
  const rootSessionId = row.root_session_id || row.session_id
  if (row.parent_session_id) session.parentSessionId = row.parent_session_id
  if (rootSessionId !== row.session_id || row.parent_session_id)
    session.rootSessionId = rootSessionId
  if (row.sub_agent_name) session.subAgentName = row.sub_agent_name
  if (row.project_path) session.projectPath = row.project_path
  if (row.title) session.title = row.title
  return session
}

function rowToApiCall(row: UsageApiCallRow): TokenUsageApiCall {
  const apiCall: TokenUsageApiCall = {
    agent: row.agent,
    apiCallId: row.api_call_id,
    sessionId: row.session_id,
    date: row.date,
    rawTimestamp: row.raw_timestamp,
    timestamp: row.timestamp,
    hour: row.hour,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    totalTokens: row.total_tokens,
    reasoningTokens: row.reasoning_tokens,
    evidence: parseUsageEvidence(row.usage_evidence),
  }
  const rootSessionId = row.root_session_id || row.session_id
  if (row.parent_session_id) apiCall.parentSessionId = row.parent_session_id
  if (rootSessionId !== row.session_id || row.parent_session_id)
    apiCall.rootSessionId = rootSessionId
  if (row.sub_agent_name) apiCall.subAgentName = row.sub_agent_name
  if (row.project_path) apiCall.projectPath = row.project_path
  if (row.role) apiCall.role = row.role
  apiCall.costAssessment = readCallCost(openDatabase(), row)
  return apiCall
}

function readApiSnapshot<T>(read: () => T): T {
  const db = openDatabase()
  return db.inTransaction ? read() : db.transaction(read).immediate()
}

function groupKey(agent: string, rootSessionId: string): string {
  return `${agent}\u0000${rootSessionId}`
}

function compareUserSessionRecent(a: TokenUsageUserSession, b: TokenUsageUserSession): number {
  return (
    compareRecentValues(a.endedAt || a.startedAt || a.date, b.endedAt || b.startedAt || b.date) ||
    b.totalTokens - a.totalTokens
  )
}

function compareSessionRecent(a: TokenUsageSession, b: TokenUsageSession): number {
  return (
    compareRecentValues(a.endedAt || a.startedAt || a.date, b.endedAt || b.startedAt || b.date) ||
    b.totalTokens - a.totalTokens
  )
}

function compareRecentValues(a: string, b: string): number {
  if (a === b) return 0
  if (!a) return 1
  if (!b) return -1
  return a > b ? -1 : 1
}

function laterDate(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

function earlierTimestamp(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return a <= b ? a : b
}

function laterTimestamp(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}
