import { decodeTurnData } from './session-turn-codec'
import type Database from 'better-sqlite3'
import type { TokenUsageSession, UsageDetailFilter, UsageTurnStats } from '../../shared/models'
import { formatDateFromMs } from '../lib/date-utils'
import { buildProjectSqlFilter, buildTrackedProjectsSqlFilter } from './project.service'
import { withUsageDatabase } from './sqlite-storage.service'
import { canonicalModelName } from '../cost/price-catalog'

interface TurnRow {
  project_path?: string | null
  agent: string
  session_id: string
  root_session_id: string
  date: string
  model: string
  parent_session_id: string | null
  turn_data: Buffer | null
  in_scope: number
}
interface CountedTurn {
  projectPath: string
  agent: string
  sessionId: string
  rootSessionId: string
  time: number
  model: string
  user: boolean
  inScope: boolean
}

function inRange(date: string, model: string, filter: UsageDetailFilter): boolean {
  const canonical = canonicalModelName(model)
  return (
    (!filter.from || date >= filter.from) &&
    (!filter.to || date <= filter.to) &&
    (!filter.model || canonical === canonicalModelName(filter.model)) &&
    (!filter.models?.length || filter.models.some((item) => canonical === canonicalModelName(item)))
  )
}

function collect(rows: Iterable<TurnRow>, filter: UsageDetailFilter) {
  const turns = new Map<string, CountedTurn>()
  const coverage = new Map<string, boolean>()
  const projectCoverage = new Map<string, boolean>()
  for (const row of rows) {
    if (row.parent_session_id) continue
    const data = decodeTurnData(row.turn_data)
    const key = JSON.stringify([row.agent, row.session_id])
    if (row.in_scope && inRange(row.date, row.model, filter)) {
      coverage.set(key, (coverage.get(key) ?? true) && data !== null && data.unknown === 0)
      const projectKey = row.project_path || ''
      projectCoverage.set(
        projectKey,
        (projectCoverage.get(projectKey) ?? true) && data !== null && data.unknown === 0,
      )
    }
    const model = canonicalModelName(row.model)
    for (const [id, time, user] of data?.points ?? []) {
      const identity = JSON.stringify([row.agent, row.session_id, id])
      const previous = turns.get(identity)
      if (
        !previous ||
        (time > 0 && (!previous.time || time < previous.time)) ||
        (time === previous.time && model < previous.model)
      ) {
        turns.set(identity, {
          agent: row.agent,
          sessionId: row.session_id,
          rootSessionId: row.root_session_id || row.session_id,
          projectPath: row.project_path || '',
          time,
          model,
          user: user && (previous?.user ?? true),
          inScope: Boolean(row.in_scope),
        })
      } else previous.user &&= user
    }
  }
  return {
    coverage,
    projectCoverage,
    turns: [...turns.values()].filter(
      (turn) =>
        turn.user &&
        turn.time > 0 &&
        turn.inScope &&
        inRange(formatDateFromMs(turn.time), turn.model, filter),
    ),
  }
}

function selectTurns(db: Database.Database, filter: UsageDetailFilter, byProject = false) {
  const project = withUsageDatabase(db, () =>
    filter.projectIds?.length
      ? (() => {
          const parts = filter.projectIds.map((id) => buildProjectSqlFilter(id, 'project_path'))
          return {
            clause: `(${parts.map((part) => part.clause || '0 = 1').join(' OR ')})`,
            params: parts.flatMap((part) => part.params),
          }
        })()
      : filter.projectId
        ? buildProjectSqlFilter(filter.projectId, 'project_path')
        : filter.trackedProjectsOnly
          ? buildTrackedProjectsSqlFilter('project_path')
          : null,
  )
  const conditions: string[] = ['s.api_call_count > 0']
  const params: Array<string | number> = [...(project?.params ?? [])]
  if (filter.agent) {
    conditions.push('s.agent = ?')
    params.push(filter.agent)
  }
  if (filter.agents?.length) {
    conditions.push(`s.agent IN (${filter.agents.map(() => '?').join(',')})`)
    params.push(...filter.agents)
  }
  if (filter.rootSessionId) {
    conditions.push("COALESCE(NULLIF(s.root_session_id, ''), s.session_id) = ?")
    params.push(filter.rootSessionId)
  }
  // 日期、模型和项目在选定每轮首次用量之后筛选，跨天和模型切换不会重复计数。
  const projectRows = Boolean(project) || byProject
  const projectPath = projectRows ? 'COALESCE(p.project_path, s.project_path)' : 's.project_path'
  const scope = project?.clause.replaceAll('project_path', projectPath) || '1 = 1'
  const sql = `SELECT s.agent, s.session_id, s.root_session_id, s.date, s.model, s.parent_session_id,
    ${projectRows ? 'COALESCE(p.turn_data, d.turn_data)' : 'd.turn_data'} AS turn_data,
    ${projectPath} AS project_path,
    CASE WHEN ${scope} THEN 1 ELSE 0 END in_scope
    FROM usage_sessions s LEFT JOIN usage_session_data d USING (agent, session_id, date, model)
    ${projectRows ? 'LEFT JOIN usage_session_projects p USING (agent, session_id, date, model)' : ''}
    WHERE ${conditions.join(' AND ') || '1 = 1'}`
  return { sql, params }
}

/** Preserve first-user-request attribution across models, days and directories for analytics. */
export function readAnalyticsTurns(db: Database.Database, filter: UsageDetailFilter) {
  const { sql, params } = selectTurns(db, filter, true)
  return collect(db.prepare(sql).iterate(...params) as Iterable<TurnRow>, filter)
}

export function readProjectTurnCounts(
  db: Database.Database,
  filter: UsageDetailFilter,
  ownerForPath: (path: string) => string | undefined,
): Map<string, { count: number; complete: boolean }> {
  const { sql, params } = selectTurns(db, filter, true)
  const { turns, projectCoverage } = collect(
    db.prepare(sql).iterate(...params) as Iterable<TurnRow>,
    filter,
  )
  const result = new Map<string, { count: number; complete: boolean }>()
  for (const [path, complete] of projectCoverage) {
    const id = ownerForPath(path)
    if (!id) continue
    const item = result.get(id) ?? { count: 0, complete: true }
    item.complete &&= complete
    result.set(id, item)
  }
  for (const turn of turns) {
    const id = ownerForPath(turn.projectPath)
    if (!id) continue
    const item = result.get(id) ?? { count: 0, complete: false }
    item.count++
    result.set(id, item)
  }
  return result
}

/** A single compact scan for full-result turn sorting; no per-session query loop. */
export function readSessionTurnCounts(db: Database.Database, filter: UsageDetailFilter) {
  const { sql, params } = selectTurns(db, filter)
  const { turns, coverage } = collect(
    db.prepare(sql).iterate(...params) as Iterable<TurnRow>,
    filter,
  )
  const result = new Map<string, { count: number; complete: boolean }>()
  for (const [key, complete] of coverage) result.set(key, { count: 0, complete })
  for (const turn of turns) {
    const key = JSON.stringify([turn.agent, turn.sessionId])
    const entry = result.get(key) ?? { count: 0, complete: false }
    entry.count++
    result.set(key, entry)
  }
  return result
}

export function readTurnStats(
  db: Database.Database,
  filter: UsageDetailFilter,
  groupBy: 'agent' | 'model',
): UsageTurnStats {
  const { sql, params } = selectTurns(db, filter)
  const { turns, coverage } = collect(
    db.prepare(sql).iterate(...params) as Iterable<TurnRow>,
    filter,
  )
  const days = new Map<string, UsageTurnStats['days'][number]>()
  const dimensions: Record<string, number> = Object.create(null)
  for (const turn of turns) {
    const dimension = groupBy === 'agent' ? turn.agent : turn.model
    const date = formatDateFromMs(turn.time)
    const day = days.get(date) ?? { date, turns: 0, dimensions: Object.create(null) }
    day.turns++
    day.dimensions[dimension] = (day.dimensions[dimension] ?? 0) + 1
    dimensions[dimension] = (dimensions[dimension] ?? 0) + 1
    days.set(date, day)
  }
  return {
    turns: turns.length,
    coveredSessions: [...coverage.values()].filter(Boolean).length,
    unknownSessions: [...coverage.values()].filter((value) => !value).length,
    dimensions,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

/** 会话查询只解码紧凑轮次数组，不读取 Token 计量明细。 */
export function attachSessionTurns(
  db: Database.Database,
  sessions: TokenUsageSession[],
  filter: UsageDetailFilter,
): void {
  const { sql, params } = selectTurns(db, filter)
  const read = db.prepare(sql + ' AND s.agent = ? AND s.session_id = ?')
  const cache = new Map<string, NonNullable<TokenUsageSession['turns']>>()
  for (const session of sessions) {
    if (session.parentSessionId || (session.apiCallCount === 0 && session.totalTokens === 0)) {
      session.turns = { count: 0, complete: true }
      continue
    }
    const key = JSON.stringify([session.agent, session.sessionId])
    let result = cache.get(key)
    if (!result) {
      const { turns, coverage } = collect(
        read.iterate(...params, session.agent, session.sessionId) as Iterable<TurnRow>,
        filter,
      )
      result = {
        count: turns.length,
        complete: coverage.size > 0 && [...coverage.values()].every(Boolean),
      }
      cache.set(key, result)
    }
    session.turns = result
  }
}
