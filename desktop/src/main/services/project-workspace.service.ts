import type {
  ProjectWorkspaceItem,
  ProjectWorkspacePage,
  SessionWorkspaceFilter,
  UsageDetailFilter,
} from '../../shared/models'
import type { UsageCostAssessment } from '../../shared/usage-cost'
import {
  createCostAccumulator,
  summarizeCostGroups,
  unpricedCostRollup,
} from '../../shared/cost-rollup'
import { PRICE_CATALOG_VERSION } from '../cost/price-catalog'
import { canonicalModelName } from '../cost/price-catalog'
import { modelSqlSelection } from './model-identity.service'
import { parseCostRollup } from '../cost/cost-rollup-storage'
import { openDatabase } from './sqlite-storage.service'
import { findOwningProject, listTrackedProjects } from './project.service'
import { readWithUsageCosts } from './usage-cost.service'
import { refreshProjectUsageMetadata } from './session-project-metadata'
import { readProjectTurnCounts } from './session-turns'
import { ensureLocalFavoriteSchema } from './local-favorite-schema'
import { discoverProjects } from './project-discovery'
import { readMatchingSessionProjects } from './usage-detail-storage.service'
import { matchesWorkspaceSearch, workspaceSearchKeywords } from '../../shared/workspace-search'
import { orderByLatestActivity, updateLatestActivity } from '../../shared/usage-activity'

interface Row {
  project_path: string | null
  agent: string
  model: string
  root_id: string
  recent: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  api_call_count: number
  api_count_complete: number
  cost_revision: string | null
  cost_summary: string | null
  group_json?: string | null
  min_cost?: number | null
  max_cost?: number | null
  legacy_records?: number
}
interface Aggregate {
  value: ProjectWorkspaceItem
  agentTotals: Map<string, number>
  modelTotals: Map<string, number>
  agentActivity: Map<string, number>
  modelActivity: Map<string, number>
  sessions: Set<string>
  costs: ReturnType<typeof createCostAccumulator>
  missingCost: boolean
  recent: number
}

function scope(filter: UsageDetailFilter, prefix: 'p' | 'a'): { sql: string; params: string[] } {
  const clauses: string[] = [],
    params: string[] = []
  for (const [field, values] of [
    ['agent', filter.agents],
    ['model', filter.models],
  ] as const) {
    if (!values?.length) continue
    if (
      !Array.isArray(values) ||
      values.length > 256 ||
      values.some((value) => typeof value !== 'string')
    )
      throw new Error('Invalid project filter')
    if (field === 'model') {
      const selection = modelSqlSelection(`${prefix}.model`, values)
      clauses.push(selection.sql)
      params.push(...selection.params)
    } else {
      clauses.push(`${prefix}.${field} IN (${values.map(() => '?').join(',')})`)
      params.push(...values)
    }
  }
  for (const [field, operator, value] of [
    ['date', '>=', filter.from],
    ['date', '<=', filter.to],
    ['agent', '=', filter.agent],
  ] as const) {
    if (value) {
      clauses.push(`${prefix}.${field} ${operator} ?`)
      params.push(value)
    }
  }
  if (filter.model) {
    const selection = modelSqlSelection(`${prefix}.model`, [filter.model])
    clauses.push(selection.sql)
    params.push(...selection.params)
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export async function getProjectWorkspace(
  filter: SessionWorkspaceFilter,
): Promise<ProjectWorkspacePage> {
  await discoverProjects()
  await refreshProjectUsageMetadata(openDatabase())
  return readWithUsageCosts(() => readProjectWorkspace(filter))
}

/** All filters and ordering precede slicing, and costs stay in their original currencies. */
export function readProjectWorkspace(filter: SessionWorkspaceFilter): ProjectWorkspacePage {
  const db = openDatabase()
  const projects = listTrackedProjects(true)
  const owners = new Map<string, string | undefined>()
  function owner(path: string | null): string | undefined {
    if (!path) return undefined
    if (owners.has(path)) return owners.get(path)
    const project = findOwningProject(path, projects)
    const id = project && !project.ignored ? project.id : undefined
    owners.set(path, id)
    return id
  }
  const entries = new Map<string, Aggregate>(
    projects
      .filter((project) => !project.ignored)
      .map((project) => [
        project.id,
        {
          value: {
            projectId: project.id,
            name: project.name,
            path: project.path,
            source: project.source,
            notes: project.notes || '',
            agents: [],
            agentTotals: {},
            models: [],
            modelTotals: {},
            sessionCount: 0,
            apiCallCount: 0,
            apiCallCountComplete: true,
            totalTokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
            turns: { count: 0, complete: true },
            lastActivity: '',
          },
          agentTotals: new Map(),
          modelTotals: new Map(),
          agentActivity: new Map(),
          modelActivity: new Map(),
          sessions: new Set(),
          costs: createCostAccumulator(PRICE_CATALOG_VERSION),
          missingCost: false,
          recent: 0,
        },
      ]),
  )
  function add(row: Row, legacy = false): void {
    const id = owner(row.project_path)
    const entry = id && entries.get(id)
    if (!entry) return
    const value = entry.value
    value.inputTokens += row.input_tokens
    value.outputTokens += row.output_tokens
    value.cacheReadTokens += row.cache_read_tokens
    value.cacheWriteTokens += row.cache_write_tokens
    value.reasoningTokens += row.reasoning_tokens
    value.totalTokens += row.total_tokens
    value.apiCallCount += row.api_call_count
    value.apiCallCountComplete &&= row.api_count_complete !== 0
    entry.agentTotals.set(row.agent, (entry.agentTotals.get(row.agent) ?? 0) + row.total_tokens)
    const model = canonicalModelName(row.model)
    entry.modelTotals.set(model, (entry.modelTotals.get(model) ?? 0) + row.total_tokens)
    updateLatestActivity(entry.agentActivity, row.agent, row.recent)
    updateLatestActivity(entry.modelActivity, model, row.recent)
    entry.sessions.add(JSON.stringify([row.agent, row.root_id]))
    entry.recent = Math.max(entry.recent, row.recent || 0)
    if (legacy) {
      if (row.cost_revision !== PRICE_CATALOG_VERSION || !row.group_json) {
        entry.missingCost = true
        entry.costs.add(
          unpricedCostRollup(
            row.agent,
            row.model,
            row.total_tokens,
            row.api_call_count,
            PRICE_CATALOG_VERSION,
          ),
        )
        return
      }
      const assessment = JSON.parse(row.group_json) as UsageCostAssessment
      entry.costs.add(
        summarizeCostGroups(
          [
            {
              ...assessment,
              agent: row.agent,
              model: row.model,
              records: row.api_call_count,
              tokens: row.total_tokens,
              min: row.min_cost ?? undefined,
              max: row.max_cost ?? undefined,
            },
          ],
          PRICE_CATALOG_VERSION,
          row.legacy_records || 0,
        ),
      )
    } else {
      const cost = parseCostRollup(row)
      if (cost) entry.costs.add(cost)
      else {
        entry.missingCost = true
        entry.costs.add(
          unpricedCostRollup(
            row.agent,
            row.model,
            row.total_tokens,
            row.api_call_count,
            PRICE_CATALOG_VERSION,
          ),
        )
      }
    }
  }
  const compact = scope(filter, 'p')
  for (const row of db
    .prepare(
      `SELECT p.*, COALESCE(NULLIF(s.root_session_id, ''), s.session_id) AS root_id,
    p.last_ms AS recent FROM usage_session_projects p JOIN usage_sessions s USING (agent, session_id, date, model)
    ${compact.sql}`,
    )
    .iterate(...compact.params) as Iterable<Row>)
    add(row)
  const legacy = scope(filter, 'a')
  for (const row of db
    .prepare(
      `SELECT a.agent, a.model, a.project_path,
    COALESCE(NULLIF(a.root_session_id, ''), a.session_id) AS root_id,
    SUM(a.input_tokens) AS input_tokens, SUM(a.output_tokens) AS output_tokens,
    SUM(a.cache_read_tokens) AS cache_read_tokens, SUM(a.cache_write_tokens) AS cache_write_tokens,
    SUM(a.reasoning_tokens) AS reasoning_tokens, SUM(a.total_tokens) AS total_tokens,
    COUNT(*) AS api_call_count,
    MIN(CASE WHEN json_valid(a.usage_evidence) THEN CASE WHEN json_extract(a.usage_evidence, '$.granularity') = 'aggregate' THEN 0 ELSE 1 END ELSE 1 END) AS api_count_complete,
    MAX(a.event_timestamp_ms) AS recent, c.revision AS cost_revision, c.group_json,
    SUM(c.min_cost) AS min_cost, SUM(c.max_cost) AS max_cost, SUM(a.usage_evidence IS NULL) AS legacy_records
    FROM usage_api_calls a LEFT JOIN usage_cost_cache c ON c.agent = a.agent AND c.api_call_id = a.api_call_id
    ${legacy.sql} GROUP BY a.agent, a.model, a.project_path, root_id, c.revision, c.group_json`,
    )
    .iterate(...legacy.params) as Iterable<Row>)
    add(row, true)
  const turns = readProjectTurnCounts(db, filter, owner)
  let favorites: Set<string> | undefined
  if (filter.onlyFavorites) {
    ensureLocalFavoriteSchema(db)
    favorites = new Set(
      (
        db
          .prepare("SELECT entity_id FROM local_favorites WHERE entity_type = 'project'")
          .all() as Array<{ entity_id: string }>
      ).map((row) => row.entity_id),
    )
  }
  const keywords = workspaceSearchKeywords(filter.query)
  // Project favorites and session favorites are separate filters. Related session
  // recall uses the same date/Agent/model scope as the project's usage aggregates.
  const matchingProjects = readMatchingSessionProjects(filter)
  const requireActivity = !!(
    filter.from ||
    filter.to ||
    filter.agents?.length ||
    filter.models?.length ||
    filter.agent ||
    filter.model
  )
  const selected = [...entries.values()].filter((entry) => {
    // Match analytics membership, including real records with zero tokens.
    if (requireActivity && entry.sessions.size === 0) return false
    const value = entry.value
    value.agents = orderByLatestActivity(entry.agentActivity)
    value.agentTotals = Object.fromEntries(entry.agentTotals)
    value.models = orderByLatestActivity(entry.modelActivity)
    value.modelTotals = Object.fromEntries(entry.modelTotals)
    value.sessionCount = entry.sessions.size
    value.lastActivity = entry.recent ? new Date(entry.recent).toISOString() : ''
    const cost = entry.costs.finish()
    value.costSummary = entry.missingCost && !cost.pricedRecords ? undefined : cost
    value.turns = turns.get(value.projectId) ?? { count: 0, complete: value.apiCallCount === 0 }
    return (
      (!favorites || favorites.has(value.projectId)) &&
      (matchesWorkspaceSearch(keywords, [value.name, value.notes, value.path]) ||
        matchingProjects?.has(value.projectId))
    )
  })
  const direction = filter.sortDirection === 'asc' ? 1 : -1
  function sortable(entry: Aggregate): number | string | null {
    const value = entry.value
    switch (filter.sortBy) {
      case 'title':
        return value.name
      case 'agent':
        return value.agents.length
      case 'model':
        return value.models.length
      case 'tokens':
        return value.totalTokens
      case 'calls':
        return value.apiCallCount
      case 'turns':
        return value.turns.complete ? value.turns.count : null
      case 'cost': {
        if (!value.costSummary?.pricedRecords) return value.apiCallCount === 0 ? 0 : null
        let total = 0
        for (const money of value.costSummary.totals) {
          if (money.currency === 'USD') total += money.min
          else if (
            filter.costExchangeRate &&
            Number.isFinite(filter.costExchangeRate) &&
            filter.costExchangeRate > 0
          )
            total += money.min / filter.costExchangeRate
          else return null
        }
        return total
      }
      default:
        return entry.recent
    }
  }
  selected.sort((a, b) => {
    const left = sortable(a),
      right = sortable(b)
    if (left === null || right === null)
      return left === right
        ? a.value.projectId.localeCompare(b.value.projectId)
        : left === null
          ? 1
          : -1
    return (
      (typeof left === 'string' && typeof right === 'string'
        ? left.localeCompare(right, undefined, { numeric: true })
        : Number(left) - Number(right)) * direction ||
      a.value.projectId.localeCompare(b.value.projectId)
    )
  })
  const total = selected.length
  const pageSize = Math.max(
    1,
    Math.min(100, Number.isFinite(filter.pageSize) ? Math.trunc(filter.pageSize!) : 10),
  )
  const totalPages = Math.ceil(total / pageSize)
  const page = Math.max(
    1,
    Math.min(totalPages || 1, Number.isFinite(filter.page) ? Math.trunc(filter.page!) : 1),
  )
  const costs = createCostAccumulator(PRICE_CATALOG_VERSION)
  const sessions = new Set<string>()
  for (const entry of selected) {
    if (entry.value.costSummary) costs.add(entry.value.costSummary)
    for (const session of entry.sessions) sessions.add(session)
  }
  const summaryCost = costs.finish()
  return {
    items: selected.slice((page - 1) * pageSize, page * pageSize).map((entry) => entry.value),
    page,
    pageSize,
    total,
    totalPages,
    summary: {
      totalTokens: selected.reduce((sum, entry) => sum + entry.value.totalTokens, 0),
      apiCallCount: selected.reduce((sum, entry) => sum + entry.value.apiCallCount, 0),
      apiCallCountComplete: selected.every((entry) => entry.value.apiCallCountComplete),
      costSummary:
        selected.some((entry) => entry.missingCost) && !summaryCost.pricedRecords
          ? undefined
          : summaryCost,
      sessionCount: sessions.size,
    },
  }
}
