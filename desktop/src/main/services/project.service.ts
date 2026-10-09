import { readUsageHours } from './session-usage-trend'
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
import { canonicalModelName } from '../cost/price-catalog'
import { openDatabase } from './sqlite-storage.service'

type QueryParam = string | number

interface TrackedProjectRow {
  notes: string
  id: string
  name: string
  path: string
  normalized_path: string
  created_at: number
  source: string
  ignored: number
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

export function listTrackedProjects(includeIgnored = false): TrackedProject[] {
  const db = openDatabase()
  const rows = db
    .prepare('SELECT * FROM tracked_projects ORDER BY created_at ASC, id ASC')
    .all() as TrackedProjectRow[]
  const directories = db
    .prepare('SELECT project_id, normalized_path FROM project_directories')
    .all() as Array<{ project_id: string; normalized_path: string }>
  const projects = rows.map(rowToProject)
  const byId = new Map(projects.map((project) => [project.id, project]))
  for (const directory of directories) {
    const project = byId.get(directory.project_id)
    if (project && !project.directories!.includes(directory.normalized_path))
      project.directories!.push(directory.normalized_path)
  }
  return includeIgnored ? projects : projects.filter((project) => !project.ignored)
}

export function saveTrackedProject(name: string, directory: string): TrackedProject {
  const { projectName, normalizedPath, displayPath } = validateProjectInput(name, directory)

  const db = openDatabase()
  const existing = db
    .prepare('SELECT * FROM tracked_projects WHERE normalized_path = ?')
    .get(normalizedPath) as TrackedProjectRow | undefined
  if (existing) {
    db.prepare(
      "UPDATE tracked_projects SET name = ?, path = ?, source = 'manual', ignored = 0 WHERE id = ?",
    ).run(projectName, displayPath, existing.id)
    return listTrackedProjects().find((project) => project.id === existing.id)!
  }

  const project: TrackedProject = {
    id: randomUUID(),
    name: projectName,
    path: displayPath,
    normalizedPath,
    createdAt: Date.now(),
    source: 'manual',
  }
  db.transaction(() => {
    db.prepare(
      `INSERT INTO tracked_projects(id, name, path, normalized_path, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(project.id, project.name, project.path, project.normalizedPath, project.createdAt)
    db.prepare('DELETE FROM project_directories WHERE normalized_path = ?').run(normalizedPath)
  })()
  return { ...project, ignored: false, directories: [normalizedPath] }
}

export function updateTrackedProject(
  projectId: string,
  name: string,
  directory: string,
): TrackedProject {
  const id = typeof projectId === 'string' ? projectId.trim() : ''
  if (!id) throw new Error('项目 ID 不能为空')
  const db = openDatabase()
  const existing = db.prepare('SELECT * FROM tracked_projects WHERE id = ?').get(id) as
    TrackedProjectRow | undefined
  if (!existing) throw new Error('要编辑的项目不存在或已被移除')
  const sameDirectory = normalizeCollectedProjectPath(directory) === existing.normalized_path
  const { projectName, normalizedPath, displayPath } = validateProjectInput(
    name,
    directory,
    sameDirectory,
  )

  const conflict = db
    .prepare('SELECT id FROM tracked_projects WHERE normalized_path = ? AND id <> ?')
    .get(normalizedPath, id) as { id: string } | undefined
  if (conflict) throw new Error('该目录已由另一个项目管理')

  db.transaction(() => {
    db.prepare(
      "UPDATE tracked_projects SET name = ?, path = ?, normalized_path = ?, source = 'manual', ignored = 0 WHERE id = ?",
    ).run(projectName, displayPath, normalizedPath, id)
    if (!sameDirectory) db.prepare('DELETE FROM project_directories WHERE project_id = ?').run(id)
    db.prepare('DELETE FROM project_directories WHERE normalized_path = ? AND project_id <> ?').run(
      normalizedPath,
      id,
    )
  })()
  return listTrackedProjects().find((project) => project.id === id)!
}

export function removeTrackedProject(projectId: string): boolean {
  if (typeof projectId !== 'string' || !projectId.trim()) return false
  const result = openDatabase()
    .prepare('UPDATE tracked_projects SET ignored = 1 WHERE id = ? AND ignored = 0')
    .run(projectId.trim())
  return result.changes > 0
}

export function restoreTrackedProject(projectId: string): boolean {
  if (typeof projectId !== 'string' || !projectId.trim()) return false
  return (
    openDatabase()
      .prepare('UPDATE tracked_projects SET ignored = 0 WHERE id = ? AND ignored = 1')
      .run(projectId.trim()).changes > 0
  )
}

export function getProjectUsageOverview(from?: string, to?: string): ProjectUsageOverview {
  const allProjects = listTrackedProjects(true)
  const projects = allProjects.filter((project) => !project.ignored)
  const statsById = new Map<string, ProjectUsageStat>()
  for (const project of projects) {
    statsById.set(project.id, {
      projectId: project.id,
      name: project.name,
      path: project.path,
      source: project.source,
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
       FROM usage_project_totals
       WHERE ${clauses.join(' AND ')}
       GROUP BY project_path, date`,
    )
    .all(...params) as ProjectUsageRow[]

  const dailyByDate = new Map<string, ProjectDailyStats>()
  for (const row of rows) {
    const project = findOwningProject(row.project_path, allProjects)
    if (!project || project.ignored) continue
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
    hourly: hourlyDate ? getProjectHourlyStats(hourlyDate, allProjects) : [],
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
       FROM usage_project_totals
       WHERE ${clauses.join(' AND ')}
       GROUP BY agent, model`,
    )
    .all(...params) as ProjectUsageRow[]

  const modelTotals = new Map<string, MutableTotals>()
  const agentTotals = new Map<string, MutableTotals>()
  for (const row of rows) {
    const totals = rowTotals(row)
    addTotalsForKey(modelTotals, canonicalModelName(row.model || 'unknown'), totals)
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
  const projects = listTrackedProjects(true)
  const project = projects.find((item) => item.id === projectId)
  if (!project || project.ignored) return { clause: '1 = 0', params: [] }
  return (
    projectPathFilter(project, projects, column, { remaining: 200 }) ?? {
      clause: `${projectOwnerSql(column)} = ?`,
      params: [projectId],
    }
  )
}

/** 忽略的子项目仍参与归属判断，防止它的用量重新进入父项目。 */
export function buildTrackedProjectsSqlFilter(column: 'project_path'): ProjectSqlFilter {
  const projects = listTrackedProjects(true)
  const filters: ProjectSqlFilter[] = []
  const budget = { remaining: 200 }
  for (const project of projects) {
    if (project.ignored) continue
    const filter = projectPathFilter(project, projects, column, budget)
    if (!filter)
      return {
        clause: `${projectOwnerSql(column)} IN (SELECT id FROM tracked_projects WHERE ignored = 0)`,
        params: [],
      }
    filters.push(filter)
  }
  if (!filters.length) return { clause: '1 = 0', params: [] }
  return {
    clause: `(${filters.map((filter) => filter.clause).join(' OR ')})`,
    params: filters.flatMap((filter) => filter.params),
  }
}

function projectPathFilter(
  project: TrackedProject,
  projects: TrackedProject[],
  column: 'project_path',
  budget: { remaining: number },
): ProjectSqlFilter | undefined {
  const alternatives: string[] = []
  const params: QueryParam[] = []
  function pathClause(root: string): string {
    params.push(root, root.endsWith('/') ? root : root + '/')
    return `(${column} = ? OR instr(${column}, ?) = 1)`
  }
  for (const root of project.directories ?? [project.normalizedPath]) {
    if (--budget.remaining < 0) return undefined
    const clauses = [pathClause(root)]
    for (const other of projects) {
      if (other.id === project.id) continue
      for (const nested of other.directories ?? [other.normalizedPath]) {
        if (nested.length <= root.length || !isSameOrChildPath(nested, root)) continue
        if (--budget.remaining < 0) return undefined
        clauses.push(`NOT ${pathClause(nested)}`)
      }
    }
    alternatives.push(`(${clauses.join(' AND ')})`)
  }
  return { clause: `(${alternatives.join(' OR ')})`, params }
}

export function projectOwnerSql(
  column: 'project_path' | 'workspace_search_path(project_path)',
): string {
  // 查询长度不随项目数量增长，避免大量自动项目触及 SQLite 表达式深度限制。
  return `(SELECT owner.id FROM (
    SELECT id, normalized_path, created_at FROM tracked_projects
    UNION ALL
    SELECT p.id, d.normalized_path, p.created_at FROM project_directories d
      JOIN tracked_projects p ON p.id = d.project_id
  ) owner
  WHERE ${column} = owner.normalized_path
    OR instr(${column}, rtrim(owner.normalized_path, '/') || '/') = 1
  ORDER BY length(owner.normalized_path) DESC, owner.created_at ASC, owner.id ASC LIMIT 1)`
}

export function findOwningProject(
  path: string,
  projects: TrackedProject[],
): TrackedProject | undefined {
  let best: TrackedProject | undefined
  let longest = -1
  for (const project of projects) {
    for (const root of project.directories ?? [project.normalizedPath]) {
      if (!isSameOrChildPath(path, root) || root.length <= longest) continue
      best = project
      longest = root.length
    }
  }
  return best
}

function isSameOrChildPath(candidate: string, root: string): boolean {
  if (candidate === root) return true
  const prefix = root.endsWith('/') ? root : `${root}/`
  return candidate.startsWith(prefix)
}

function rowToProject(row: TrackedProjectRow): TrackedProject {
  return {
    id: row.id,
    notes: row.notes || '',
    name: row.name,
    path: row.path,
    normalizedPath: row.normalized_path,
    createdAt: row.created_at,
    source: row.source === 'discovered' ? 'discovered' : 'manual',
    ignored: row.ignored === 1,
    directories: [row.normalized_path],
  }
}

export function updateProjectNotes(
  projectId: string,
  notes: string,
  name?: string,
): TrackedProject {
  if (typeof notes !== 'string' || notes.length > 4000)
    throw new Error('Project notes must contain at most 4000 characters')
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 80))
    throw new Error('项目备注名应为 1–80 个字符')
  const changed = openDatabase()
    .prepare(
      'UPDATE tracked_projects SET notes = ?, name = COALESCE(?, name) WHERE id = ? AND ignored = 0',
    )
    .run(notes, name?.trim() ?? null, projectId)
  if (!changed.changes) throw new Error('Project not found')
  return listTrackedProjects().find((project) => project.id === projectId)!
}

function validateProjectInput(
  name: string,
  directory: string,
  allowMissing = false,
): { projectName: string; normalizedPath: string; displayPath: string } {
  const projectName = typeof name === 'string' ? name.trim() : ''
  if (!projectName) throw new Error('项目名称不能为空')
  if (projectName.length > 80) throw new Error('项目名称不能超过 80 个字符')

  const normalizedPath = normalizeCollectedProjectPath(directory)
  if (!normalizedPath) throw new Error('请选择有效的绝对目录')
  const displayPath = normalize(resolve(directory))
  try {
    if (allowMissing) return { projectName, normalizedPath, displayPath }
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
  const rows = readUsageHours(openDatabase(), date).map((row) => ({
    project_path: row.project_path,
    hour: row.hour,
    total_tokens: row.totalTokens,
  }))

  for (const row of rows) {
    const project = findOwningProject(row.project_path, projects)
    if (!project || project.ignored) continue
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
