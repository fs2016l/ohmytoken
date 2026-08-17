/**
 * 会话级与 API 轮次级 Token 明细持久化服务。
 * 旧的 usage_records 日聚合表保持不变，本服务只读写新增明细表。
 */
import type {
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
import { buildProjectSqlFilter, buildTrackedProjectsSqlFilter } from './project.service'
import { USAGE_SESSION_SEARCH_CONTENT_VIEW } from './session-title-search'

interface UsageSessionRow {
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
}

interface UsageApiCallRow {
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
  agentSet: Set<string>
  modelSet: Set<string>
  modelTotals: Map<string, number>
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

export function saveUsageSessions(sessions: TokenUsageSession[]): void {
  if (sessions.length === 0) return
  const db = openDatabase()
  const insertMany = db.transaction((rows: TokenUsageSession[]) => {
    insertSessionRows(rows)
  })
  insertMany(sessions)
}

export function saveUsageApiCalls(apiCalls: TokenUsageApiCall[]): void {
  if (apiCalls.length === 0) return
  const db = openDatabase()
  const insertMany = db.transaction((rows: TokenUsageApiCall[]) => {
    insertApiCallRows(rows)
  })
  insertMany(apiCalls)
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
    insertApiCallRows(apiCalls.filter((apiCall) => agentNames.includes(apiCall.agent)))
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

export function insertApiCallRows(apiCalls: TokenUsageApiCall[]): void {
  if (apiCalls.length === 0) return
  const db = openDatabase()
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO usage_api_calls
      (agent, api_call_id, session_id, parent_session_id, root_session_id, sub_agent_name,
       project_path, role, date, raw_timestamp, timestamp, hour, model, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, total_tokens, reasoning_tokens,
       event_timestamp_ms, source_scope)
    VALUES
      (@agent, @api_call_id, @session_id, @parent_session_id, @root_session_id,
       @sub_agent_name, @project_path, @role, @date, @raw_timestamp, @timestamp, @hour, @model,
       @input_tokens, @output_tokens, @cache_read_tokens, @cache_write_tokens,
       @total_tokens, @reasoning_tokens, @event_timestamp_ms, @source_scope)
  `)
  for (const row of apiCalls) {
    const timestamp = localTimestampFromValue(row.timestamp, row.date)
    const timeParts = localTimestampParts(timestamp, row.date, row.hour)
    stmt.run({
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
      hour: timeParts.hour,
      model: row.model,
      input_tokens: row.inputTokens,
      output_tokens: row.outputTokens,
      cache_read_tokens: row.cacheReadTokens,
      cache_write_tokens: row.cacheWriteTokens,
      total_tokens: row.totalTokens,
      reasoning_tokens: row.reasoningTokens,
    })
  }
}

export function listUsageSessions(filter: UsageDetailFilter): TokenUsageSession[] {
  return selectSessionRows(filter).map(rowToSession)
}

export function listUserUsageSessions(filter: UsageDetailFilter): TokenUsageUserSession[] {
  const rows = selectSessionRows(filter)
  return buildUserSessions(rows)
}

export function listUserUsageSessionsPage(
  filter: UsageDetailPageFilter,
): PageResult<TokenUsageUserSession> {
  const db = openDatabase()
  const { whereSql, params } = buildSessionWhere(filter)
  const rootExpression = "COALESCE(NULLIF(root_session_id, ''), session_id)"
  const search = buildSessionSearchScore(filter.query)
  const searchColumn = search.scoreSql ? `, (${search.scoreSql}) AS match_score` : ''
  const searchHaving = search.scoreSql ? 'HAVING match_score > 0' : ''
  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS total FROM (
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
      `SELECT
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
      `SELECT * FROM usage_sessions
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
  return createPageResult(items, pagination, total)
}

export function listUsageApiCalls(filter: UsageApiCallFilter): TokenUsageApiCall[] {
  return listUsageApiRecords(filter)
}

export function listUsageApiRecords(filter: UsageApiRecordFilter): TokenUsageApiCall[] {
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
      FROM usage_api_calls
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
      FROM usage_api_calls
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

  return [...grouped.values()]
    .map((session) => {
      session.children.sort(compareSessionRecent)
      session.agents = [...session.agentSet].sort()
      session.models = [...session.modelTotals.entries()]
        .sort(
          ([modelA, tokensA], [modelB, tokensB]) =>
            tokensB - tokensA || modelA.localeCompare(modelB),
        )
        .map(([model]) => model)
      const {
        agentSet: _agentSet,
        modelSet: _modelSet,
        modelTotals: _modelTotals,
        ...cleanSession
      } = session
      return cleanSession
    })
    .sort(compareUserSessionRecent)
}

function buildSessionWhere(filter: UsageDetailFilter): {
  whereSql: string
  params: QueryParam[]
} {
  const clauses: string[] = []
  const params: QueryParam[] = []
  addEqualsFilter(clauses, params, 'agent', filter.agent)
  addEqualsFilter(clauses, params, 'model', filter.model)
  if (filter.rootSessionId) {
    clauses.push("COALESCE(NULLIF(root_session_id, ''), session_id) = ?")
    params.push(filter.rootSessionId)
  }
  addProjectFilter(clauses, params, filter.projectId, filter.trackedProjectsOnly)
  addDateFilters(clauses, params, filter.from, filter.to)
  return { whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

function buildApiCallWhere(filter: UsageApiRecordFilter): {
  whereSql: string
  params: QueryParam[]
} {
  const clauses: string[] = []
  const params: QueryParam[] = []
  addEqualsFilter(clauses, params, 'agent', filter.agent)
  addEqualsFilter(clauses, params, 'session_id', filter.sessionId)
  if (filter.rootSessionId) {
    clauses.push("COALESCE(NULLIF(root_session_id, ''), session_id) = ?")
    params.push(filter.rootSessionId)
  }
  addEqualsFilter(clauses, params, 'model', filter.model)
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
 * 长词走 trigram FTS5，短词走参数化 LIKE；最终只在 SQLite 内排序并分页。
 */
function buildSessionSearchScore(query: string | undefined): SessionSearchScore {
  const keywords = normalizeSearchKeywords(query)
  if (keywords.length === 0) return { scoreSql: '', joinSql: '', params: [] }

  const scoreParts: string[] = []
  const params: QueryParam[] = []
  const searchableTitle = `${SEARCH_CONTENT_ALIAS}.search_title`
  for (const keyword of keywords) {
    if ([...keyword].length >= 3) {
      const phrase = `"${keyword.replace(/"/g, '""')}"`
      scoreParts.push(`MAX(CASE
        WHEN ${FTS_ROW_MATCH_SQL} THEN ${TITLE_KEYWORD_SCORE}
        WHEN ${FTS_ROW_MATCH_SQL} THEN ${METADATA_KEYWORD_SCORE}
        ELSE 0
      END)`)
      params.push(`title : ${phrase}`, `{${SEARCH_METADATA_FIELDS.join(' ')}} : ${phrase}`)
      continue
    }

    const titleMatch = `LOWER(${searchableTitle}) LIKE ? ESCAPE '\\'`
    const metadataMatches = SEARCH_METADATA_FIELDS.map(
      (field) => `LOWER(COALESCE(${field}, '')) LIKE ? ESCAPE '\\'`,
    )
    scoreParts.push(`MAX(CASE
      WHEN ${titleMatch} THEN ${TITLE_KEYWORD_SCORE}
      WHEN (${metadataMatches.join(' OR ')}) THEN ${METADATA_KEYWORD_SCORE}
      ELSE 0
    END)`)
    const pattern = `%${escapeSearchLike(keyword.toLowerCase())}%`
    params.push(pattern, ...metadataMatches.map(() => pattern))
  }

  if (keywords.length > 1) {
    const allTitleMatches = keywords
      .map(() => `INSTR(LOWER(${searchableTitle}), ?) > 0`)
      .join(' AND ')
    scoreParts.push(`MAX(CASE WHEN ${allTitleMatches} THEN ${ALL_TITLE_KEYWORDS_BONUS} ELSE 0 END)`)
    params.push(...keywords.map((keyword) => keyword.toLowerCase()))

    const orderedTitleMatches = keywords
      .slice(0, -1)
      .map(
        () =>
          `(INSTR(LOWER(${searchableTitle}), ?) > 0
            AND INSTR(LOWER(${searchableTitle}), ?) > INSTR(LOWER(${searchableTitle}), ?))`,
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
    `MAX(CASE WHEN INSTR(LOWER(${searchableTitle}), ?) BETWEEN 1 AND 12 THEN ${TITLE_PREFIX_BONUS} ELSE 0 END)`,
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

function normalizeSearchKeywords(query: string | undefined): string[] {
  if (typeof query !== 'string') return []
  const unique = new Map<string, string>()
  const sanitized = [...query]
    .map((character) => (character.charCodeAt(0) < 32 ? ' ' : character))
    .join('')
  for (const raw of sanitized.trim().split(/\s+/u)) {
    const keyword = raw.trim().slice(0, 80)
    if (!keyword) continue
    const key = keyword.toLocaleLowerCase()
    if (!unique.has(key)) unique.set(key, keyword)
    if (unique.size >= 12) break
  }
  return [...unique.values()]
}

function escapeSearchLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
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
    agentSet: new Set<string>(),
    modelSet: new Set<string>(),
    modelTotals: new Map<string, number>(),
  }
  if (title) base.title = title
  mergeIntoUserSession(base, session)
  return base
}

function mergeIntoUserSession(target: MutableUserSession, session: TokenUsageSession): void {
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
  target.agentSet.add(session.agent)
  target.modelSet.add(session.model)
  target.modelTotals.set(
    session.model,
    (target.modelTotals.get(session.model) || 0) + session.totalTokens,
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
    agent: row.agent,
    sessionId: row.session_id,
    date: row.date,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    totalTokens: row.total_tokens,
    reasoningTokens: row.reasoning_tokens,
    apiCallCount: row.api_call_count,
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
  }
  const rootSessionId = row.root_session_id || row.session_id
  if (row.parent_session_id) apiCall.parentSessionId = row.parent_session_id
  if (rootSessionId !== row.session_id || row.parent_session_id)
    apiCall.rootSessionId = rootSessionId
  if (row.sub_agent_name) apiCall.subAgentName = row.sub_agent_name
  if (row.project_path) apiCall.projectPath = row.project_path
  if (row.role) apiCall.role = row.role
  return apiCall
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

function localTimestampParts(
  timestamp: string,
  fallbackDate: string,
  fallbackHour: number,
): { date: string; hour: number } {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):/.exec(timestamp)
  if (!match) return { date: fallbackDate, hour: fallbackHour }
  const hour = Number.parseInt(match[2], 10)
  return {
    date: match[1],
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : fallbackHour,
  }
}
