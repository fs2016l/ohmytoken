import { randomUUID } from 'crypto'
import { statSync } from 'fs'
import { normalize, resolve } from 'path'
import type {
  AgentModelStats,
  ModelAgentStats,
  ProjectDailyStats,
  ProjectHourlyStats,
  ProjectUsageDetail,
  ProjectUsageOverview,
  ProjectUsageStat,
  TrackedProject,
} from '../../shared/models'
import { normalizeCollectedProjectPath } from '../scanners/project-path'
import { openDatabase } from './sqlite-storage.service'

type QueryParam = string | number

interface TrackedProjectRow {
  id: string
  name: string
  path: string
  normalized_path: string
  created_at: number
}

interface ProjectUsageRow {
  project_path: string
  date: string
  agent?: string
  model?: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  reasoning_tokens: number
}

interface ProjectHourlyUsageRow {
  project_path: string
  hour: number
  total_tokens: number
}

interface MutableTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  reasoningTokens: number
}

export interface ProjectSqlFilter {
  clause: string
  params: QueryParam[]
}

export function listTrackedProjects(): TrackedProject[] {
  const rows = openDatabase()
    .prepare('SELECT * FROM tracked_projects ORDER BY created_at ASC, id ASC')
    .all() as TrackedProjectRow[]
  return rows.map(rowToProject)
}

export function saveTrackedProject(name: string, directory: string): TrackedProject {
  const { projectName, normalizedPath, displayPath } = validateProjectInput(name, directory)

  const db = openDatabase()
  const existing = db
    .prepare('SELECT * FROM tracked_projects WHERE normalized_path = ?')
    .get(normalizedPath) as TrackedProjectRow | undefined
  if (existing) {
    db.prepare('UPDATE tracked_projects SET name = ?, path = ? WHERE id = ?').run(
      projectName,
      displayPath,
      existing.id,
    )
    return { ...rowToProject(existing), name: projectName, path: displayPath }
  }

  const project: TrackedProject = {
    id: randomUUID(),
    name: projectName,
    path: displayPath,
    normalizedPath,
    createdAt: Date.now(),
  }
  db.prepare(
    `INSERT INTO tracked_projects(id, name, path, normalized_path, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(project.id, project.name, project.path, project.normalizedPath, project.createdAt)
  return project
}

export function updateTrackedProject(
  projectId: string,
  name: string,
  directory: string,
): TrackedProject {
  const id = typeof projectId === 'string' ? projectId.trim() : ''
  if (!id) throw new Error('项目 ID 不能为空')
  const { projectName, normalizedPath, displayPath } = validateProjectInput(name, directory)
  const db = openDatabase()
  const existing = db.prepare('SELECT * FROM tracked_projects WHERE id = ?').get(id) as
    TrackedProjectRow | undefined
  if (!existing) throw new Error('要编辑的项目不存在或已被移除')

  const conflict = db
    .prepare('SELECT id FROM tracked_projects WHERE normalized_path = ? AND id <> ?')
    .get(normalizedPath, id) as { id: string } | undefined
  if (conflict) throw new Error('该目录已由另一个项目管理')

  db.prepare(
    'UPDATE tracked_projects SET name = ?, path = ?, normalized_path = ? WHERE id = ?',
  ).run(projectName, displayPath, normalizedPath, id)
  return {
    id,
    name: projectName,
    path: displayPath,
    normalizedPath,
    createdAt: existing.created_at,
  }
}

export function removeTrackedProject(projectId: string): boolean {
  if (typeof projectId !== 'string' || !projectId.trim()) return false
  const result = openDatabase()
    .prepare('DELETE FROM tracked_projects WHERE id = ?')
    .run(projectId.trim())
  return result.changes > 0
}

export function getProjectUsageOverview(from?: string, to?: string): ProjectUsageOverview {
  const projects = listTrackedProjects()
  const statsById = new Map<string, ProjectUsageStat>()
  for (const project of projects) {
    statsById.set(project.id, {
      projectId: project.id,
      name: project.name,
      path: project.path,
      ...emptyTotals(),
    })
  }
  if (projects.length === 0) return { projects: [], daily: [], hourly: [] }

  const clauses = ['project_path IS NOT NULL', "project_path <> ''"]
  const params: QueryParam[] = []
  addDateFilters(clauses, params, from, to)
  const rows = openDatabase()
    .prepare(
      `SELECT
        project_path,
        date,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens,
        SUM(cache_write_tokens) AS cache_write_tokens,
        SUM(total_tokens) AS total_tokens,
        SUM(reasoning_tokens) AS reasoning_tokens
       FROM usage_api_calls
       WHERE ${clauses.join(' AND ')}
       GROUP BY project_path, date`,
    )
    .all(...params) as ProjectUsageRow[]

  const dailyByDate = new Map<string, ProjectDailyStats>()
  for (const row of rows) {
    const project = findOwningProject(row.project_path, projects)
    if (!project) continue
    const totals = rowTotals(row)
    addTotals(statsById.get(project.id)!, totals)
    const day = dailyByDate.get(row.date) ?? {
      date: row.date,
      projectTokens: {},
      totalTokens: 0,
    }
    day.projectTokens[project.id] = (day.projectTokens[project.id] || 0) + totals.totalTokens
    day.totalTokens += totals.totalTokens
    dailyByDate.set(row.date, day)
  }

  const daily = [...dailyByDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const hourlyDate = from && to && from === to ? from : daily.length === 1 ? daily[0].date : null
  return {
    projects: projects
      .map((project) => statsById.get(project.id)!)
      .sort((a, b) => b.totalTokens - a.totalTokens || a.name.localeCompare(b.name)),
    daily,
    hourly: hourlyDate ? getProjectHourlyStats(hourlyDate, projects) : [],
  }
}

export function getProjectUsageDetail(
  projectId: string,
  from?: string,
  to?: string,
): ProjectUsageDetail {
  const pathFilter = buildProjectSqlFilter(projectId, 'project_path')
  if (pathFilter.clause === '1 = 0') return { byModel: [], byAgent: [] }
  const clauses = [pathFilter.clause]
  const params = [...pathFilter.params]
  addDateFilters(clauses, params, from, to)
  const rows = openDatabase()
    .prepare(
      `SELECT
        project_path,
        '' AS date,
        agent,
        model,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens,
        SUM(cache_write_tokens) AS cache_write_tokens,
        SUM(total_tokens) AS total_tokens,
        SUM(reasoning_tokens) AS reasoning_tokens
       FROM usage_api_calls
       WHERE ${clauses.join(' AND ')}
       GROUP BY agent, model`,
    )
    .all(...params) as ProjectUsageRow[]

  const modelTotals = new Map<string, MutableTotals>()
  const agentTotals = new Map<string, MutableTotals>()
  for (const row of rows) {
    const totals = rowTotals(row)
    addTotalsForKey(modelTotals, row.model || 'unknown', totals)
    addTotalsForKey(agentTotals, row.agent || 'unknown', totals)
  }

  const byModel: AgentModelStats[] = [...modelTotals.entries()]
    .map(([model, totals]) => ({ model, ...totals }))
    .sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model))
  const byAgent: ModelAgentStats[] = [...agentTotals.entries()]
    .map(([agent, totals]) => ({ agent, ...totals }))
    .sort((a, b) => b.totalTokens - a.totalTokens || a.agent.localeCompare(b.agent))
  return { byModel, byAgent }
}

/**
 * 生成项目路径 SQL 条件。若保存了嵌套项目，目录归属于路径最长的项目，
 * 因此父项目条件会排除已单独保存的子项目范围。
 */
export function buildProjectSqlFilter(
  projectId: string | undefined,
  column: 'project_path',
): ProjectSqlFilter {
  if (!projectId) return { clause: '', params: [] }
  const projects = listTrackedProjects()
  const project = projects.find((item) => item.id === projectId)
  if (!project) return { clause: '1 = 0', params: [] }

  const own = pathSqlClause(column, project.normalizedPath)
  const clauses = [own.clause]
  const params = [...own.params]
  const descendants = projects.filter(
    (item) =>
      item.id !== project.id &&
      isSameOrChildPath(item.normalizedPath, project.normalizedPath) &&
      item.normalizedPath.length > project.normalizedPath.length,
  )
  for (const descendant of descendants) {
    const nested = pathSqlClause(column, descendant.normalizedPath)
    clauses.push(`NOT ${nested.clause}`)
    params.push(...nested.params)
  }
  return { clause: `(${clauses.join(' AND ')})`, params }
}

/** 生成“全部已保存项目”范围；未保存目录不会进入查询。 */
export function buildTrackedProjectsSqlFilter(column: 'project_path'): ProjectSqlFilter {
  const projects = listTrackedProjects()
  if (projects.length === 0) return { clause: '1 = 0', params: [] }

  // 父目录已经覆盖其子目录，合并根路径可减少 SQL 条件数量。
  const roots = projects.filter(
    (project) =>
      !projects.some(
        (candidate) =>
          candidate.id !== project.id &&
          candidate.normalizedPath.length < project.normalizedPath.length &&
          isSameOrChildPath(project.normalizedPath, candidate.normalizedPath),
      ),
  )
  const filters = roots.map((project) => pathSqlClause(column, project.normalizedPath))
  return {
    clause: `(${filters.map((filter) => filter.clause).join(' OR ')})`,
    params: filters.flatMap((filter) => filter.params),
  }
}

function pathSqlClause(column: 'project_path', root: string): ProjectSqlFilter {
  const prefix = root.endsWith('/') ? root : `${root}/`
  return {
    clause: `(${column} = ? OR ${column} LIKE ? ESCAPE '\\')`,
    params: [root, `${escapeLike(prefix)}%`],
  }
}

function findOwningProject(path: string, projects: TrackedProject[]): TrackedProject | undefined {
  let best: TrackedProject | undefined
  for (const project of projects) {
    if (!isSameOrChildPath(path, project.normalizedPath)) continue
    if (!best || project.normalizedPath.length > best.normalizedPath.length) best = project
  }
  return best
}

function isSameOrChildPath(candidate: string, root: string): boolean {
  if (candidate === root) return true
  const prefix = root.endsWith('/') ? root : `${root}/`
  return candidate.startsWith(prefix)
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function rowToProject(row: TrackedProjectRow): TrackedProject {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    normalizedPath: row.normalized_path,
    createdAt: row.created_at,
  }
}

function validateProjectInput(
  name: string,
  directory: string,
): { projectName: string; normalizedPath: string; displayPath: string } {
  const projectName = typeof name === 'string' ? name.trim() : ''
  if (!projectName) throw new Error('项目名称不能为空')
  if (projectName.length > 80) throw new Error('项目名称不能超过 80 个字符')

  const normalizedPath = normalizeCollectedProjectPath(directory)
  if (!normalizedPath) throw new Error('请选择有效的绝对目录')
  const displayPath = normalize(resolve(directory))
  try {
    if (!statSync(displayPath).isDirectory()) throw new Error('not-directory')
  } catch {
    throw new Error('所选项目目录不存在或不可访问')
  }
  return { projectName, normalizedPath, displayPath }
}

function getProjectHourlyStats(date: string, projects: TrackedProject[]): ProjectHourlyStats[] {
  const buckets: ProjectHourlyStats[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    projectTokens: {},
    totalTokens: 0,
  }))
  const rows = openDatabase()
    .prepare(
      `SELECT project_path, hour, SUM(total_tokens) AS total_tokens
       FROM usage_api_calls
       WHERE project_path IS NOT NULL AND project_path <> '' AND date = ?
       GROUP BY project_path, hour`,
    )
    .all(date) as ProjectHourlyUsageRow[]

  for (const row of rows) {
    const project = findOwningProject(row.project_path, projects)
    if (!project) continue
    const hour = Math.min(23, Math.max(0, Math.trunc(Number(row.hour) || 0)))
    const tokens = Number(row.total_tokens) || 0
    buckets[hour].projectTokens[project.id] =
      (buckets[hour].projectTokens[project.id] || 0) + tokens
    buckets[hour].totalTokens += tokens
  }
  return buckets
}

function emptyTotals(): MutableTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
  }
}

function rowTotals(row: ProjectUsageRow): MutableTotals {
  return {
    inputTokens: Number(row.input_tokens) || 0,
    outputTokens: Number(row.output_tokens) || 0,
    cacheReadTokens: Number(row.cache_read_tokens) || 0,
    cacheWriteTokens: Number(row.cache_write_tokens) || 0,
    totalTokens: Number(row.total_tokens) || 0,
    reasoningTokens: Number(row.reasoning_tokens) || 0,
  }
}

function addTotals(target: MutableTotals, source: MutableTotals): void {
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.cacheWriteTokens += source.cacheWriteTokens
  target.totalTokens += source.totalTokens
  target.reasoningTokens += source.reasoningTokens
}

function addTotalsForKey(
  target: Map<string, MutableTotals>,
  key: string,
  totals: MutableTotals,
): void {
  const current = target.get(key) ?? emptyTotals()
  addTotals(current, totals)
  target.set(key, current)
}

function addDateFilters(clauses: string[], params: QueryParam[], from?: string, to?: string): void {
  if (from) {
    clauses.push('date >= ?')
    params.push(from)
  }
  if (to) {
    clauses.push('date <= ?')
    params.push(to)
  }
}
