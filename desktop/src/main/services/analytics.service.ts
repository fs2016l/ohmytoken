import type {
  AnalyticsBucket,
  AnalyticsBucketCosts,
  AnalyticsDimension,
  AnalyticsMetrics,
  AnalyticsTrendPoint,
  AnalyticsTrendValue,
  UsageAnalytics,
  UsageAnalyticsFilter,
} from '../../shared/analytics'
import { ANALYTICS_BUCKETS } from '../../shared/analytics'
import { createCostAccumulator } from '../../shared/cost-rollup'
import { PRICE_CATALOG_VERSION } from '../cost/price-catalog'
import { canonicalModelName } from '../cost/price-catalog'
import { formatDateFromMs } from '../lib/date-utils'
import { openDatabase } from './sqlite-storage.service'
import { readWithUsageCosts } from './usage-cost.service'
import { findOwningProject, listTrackedProjects } from './project.service'
import { refreshProjectUsageMetadata } from './session-project-metadata'
import { readAnalyticsTurns } from './session-turns'
import {
  ANALYTICS_REVISION,
  analyticsSourceFilter,
  decodeAnalyticsFacts,
  emptyAnalyticsTokens,
  refreshAnalyticsCache,
  unpricedAnalyticsCost,
  type AnalyticsFact,
} from './analytics-cache'
import { TOKEN_FIELDS } from './session-usage-codec'
import { normalizeCollectedProjectPath } from '../scanners/project-path'
import { parseCostRollup, type CostRollupRow } from '../cost/cost-rollup-storage'
import { readMatchingSessionRoots } from './usage-detail-storage.service'
import { matchesWorkspaceSearch, workspaceSearchKeywords } from '../../shared/workspace-search'

type CostAccumulator = ReturnType<typeof createCostAccumulator>
interface Aggregate {
  value: AnalyticsMetrics
  roots: Set<string>
  cost: CostAccumulator
  missing: boolean
}
interface Row {
  agent: string
  session_id: string
  root_id: string
  date: string
  model: string
  title: string | null
  root_title: string | null
  data: Buffer
  recordOnly?: boolean
  facts?: AnalyticsFact[]
}
const identity = (agent: string, id: string): string => JSON.stringify([agent, id])
function emptyAggregate(): Aggregate {
  return {
    value: {
      ...emptyAnalyticsTokens(),
      apiCallCount: 0,
      apiCallCountComplete: true,
      sessionCount: 0,
      sessionCountComplete: true,
      turns: { count: 0, complete: true },
    },
    roots: new Set(),
    cost: createCostAccumulator(PRICE_CATALOG_VERSION),
    missing: false,
  }
}
function add(entry: Aggregate, fact: AnalyticsFact, root?: string): void {
  for (const field of TOKEN_FIELDS) entry.value[field] += fact[field]
  entry.value.apiCallCount += fact.apiCallCount
  entry.value.apiCallCountComplete &&= fact.apiCallCountComplete
  if (
    fact.lastActiveAt &&
    (!entry.value.lastActiveAt ||
      Date.parse(fact.lastActiveAt) > Date.parse(entry.value.lastActiveAt))
  )
    entry.value.lastActiveAt = fact.lastActiveAt
  if (root) entry.roots.add(root)
  else {
    entry.value.sessionCountComplete = false
    entry.value.turns.complete = false
  }
  if (fact.costSummary) entry.cost.add(fact.costSummary)
  else entry.missing = true
}
function finish(entry: Aggregate): AnalyticsMetrics {
  return {
    ...entry.value,
    sessionCount: entry.roots.size,
    costSummary: entry.missing ? undefined : entry.cost.finish(),
  }
}
function trendValue(): AnalyticsTrendValue {
  return {
    tokens: 0,
    calls: 0,
    callsComplete: true,
    turns: 0,
    turnsComplete: true,
    costs: [],
    costPartial: false,
  }
}
function addTrend(value: AnalyticsTrendValue, fact: AnalyticsFact): void {
  value.tokens += fact.totalTokens
  value.calls += fact.apiCallCount
  value.callsComplete &&= fact.apiCallCountComplete
  const summary = fact.costSummary
  value.costPartial ||= !summary || summary.pricedRecords < summary.totalRecords
  if (!summary) {
    value.costs = null
    return
  }
  if (value.costs)
    for (const total of summary.totals) {
      let existing = value.costs.find((item) => item.currency === total.currency)
      if (!existing) {
        existing = { currency: total.currency, min: 0, max: 0 }
        value.costs.push(existing)
      }
      existing.min += total.min
      existing.max += total.max
    }
}
function point(points: Map<string, AnalyticsTrendPoint>, key: string): AnalyticsTrendPoint {
  let value = points.get(key)
  if (!value) {
    value = {
      key,
      total: trendValue(),
      agents: Object.create(null),
      models: Object.create(null),
      projects: Object.create(null),
    }
    points.set(key, value)
  }
  return value
}
function dimension(map: Map<string, Aggregate>, key: string): Aggregate {
  let value = map.get(key)
  if (!value) {
    value = emptyAggregate()
    map.set(key, value)
  }
  return value
}
export async function getUsageAnalytics(
  filter: UsageAnalyticsFilter = {},
): Promise<UsageAnalytics> {
  const db = openDatabase()
  await refreshProjectUsageMetadata(db)
  // Cost refreshes can change session rows. Build the derived cache after that refresh.
  await readWithUsageCosts(() => undefined)
  await refreshAnalyticsCache(db, filter)
  return db.transaction(() => readUsageAnalytics(filter))()
}
/** Real request-derived costs and bucket totals; no proportion-based fee allocation. */
export function readUsageAnalytics(filter: UsageAnalyticsFilter = {}): UsageAnalytics {
  const db = openDatabase()
  const scope = analyticsSourceFilter(filter, db)
  const read = db.prepare(`SELECT s.agent, s.session_id, s.date, s.model, s.title,
    COALESCE(NULLIF(s.root_session_id, ''), s.session_id) AS root_id,
    (SELECT m.title FROM usage_sessions m WHERE m.agent = s.agent AND m.session_id = COALESCE(NULLIF(s.root_session_id, ''), s.session_id) AND m.title IS NOT NULL ORDER BY m.date DESC LIMIT 1) AS root_title,
    c.data FROM usage_sessions s JOIN usage_analytics_cache c USING (agent,session_id,date,model)
    WHERE c.revision = ? ${scope.sql}`)
  const pending = db
    .prepare(
      `SELECT 1 FROM usage_sessions s LEFT JOIN usage_analytics_cache c USING (agent,session_id,date,model) WHERE (c.revision IS NULL OR c.revision != ?) ${scope.sql} LIMIT 1`,
    )
    .get(ANALYTICS_REVISION, ...scope.params)
  if (pending) throw new Error('Analytics are being updated; please retry')
  // Older scanners may only have daily records. Include those dates/models once,
  // without inventing session identities, request counts, timestamps or bucket fees.
  const records = db.prepare(`SELECT s.* FROM usage_records s WHERE NOT EXISTS (
    SELECT 1 FROM usage_sessions m WHERE m.agent = s.agent AND m.date = s.date AND m.model = s.model
  ) ${scope.sql}`)
  function* rows(): Generator<Row> {
    yield* read.iterate(ANALYTICS_REVISION, ...scope.params) as Iterable<Row>
    for (const record of records.iterate(...scope.params) as Iterable<
      CostRollupRow & {
        agent: string
        date: string
        model: string
        input_tokens: number
        output_tokens: number
        cache_read_tokens: number
        cache_write_tokens: number
        reasoning_tokens: number
        total_tokens: number
      }
    >) {
      const cost = parseCostRollup(record)
      yield {
        ...record,
        session_id: '',
        root_id: '',
        title: null,
        root_title: null,
        data: Buffer.alloc(0),
        recordOnly: true,
        facts: [
          {
            inputTokens: record.input_tokens,
            outputTokens: record.output_tokens,
            cacheReadTokens: record.cache_read_tokens,
            cacheWriteTokens: record.cache_write_tokens,
            reasoningTokens: record.reasoning_tokens,
            totalTokens: record.total_tokens,
            projectPath: '',
            lastActiveAt: record.date,
            hour: -1,
            apiCallCount: 0,
            apiCallCountComplete: false,
            costSummary: cost?.totalRecords
              ? cost
              : unpricedAnalyticsCost(record.agent, record.model, record.total_tokens),
            bucketCosts: {
              input: undefined,
              output: undefined,
              cache: undefined,
              reasoning: undefined,
            },
          },
        ],
      }
    }
  }
  const rowKey = (row: Row): string =>
    row.recordOnly
      ? JSON.stringify([row.agent, '', row.date, row.model])
      : identity(row.agent, row.root_id)
  const facts = (row: Row): AnalyticsFact[] => row.facts || decodeAnalyticsFacts(row.data)
  const projects = listTrackedProjects(true)
  const projectNames = new Map(projects.map((project) => [project.id, project.name]))
  const owners = new Map<string, string>()
  const owner = (path: string): string => {
    let id = owners.get(path)
    if (id !== undefined) return id
    const project = findOwningProject(normalizeCollectedProjectPath(path) || '', projects)
    id = project && !project.ignored ? project.id : ''
    owners.set(path, id)
    return id
  }
  if (
    filter.projectIds &&
    (!Array.isArray(filter.projectIds) ||
      filter.projectIds.length > 256 ||
      filter.projectIds.some((id) => typeof id !== 'string'))
  )
    throw new Error('Invalid project filter')
  const projectIds = filter.projectId ? [filter.projectId] : filter.projectIds || []
  const inScope = (fact: AnalyticsFact): boolean =>
    !projectIds.length || projectIds.includes(owner(fact.projectPath))
  const keywords = workspaceSearchKeywords(filter.query)
  const matching = readMatchingSessionRoots(filter)
  if (matching) {
    // Daily-only legacy records have no session root; match their available
    // metadata using the same normalization and keyword semantics.
    for (const row of rows()) {
      if (row.recordOnly && matchesWorkspaceSearch(keywords, [row.agent, row.model]))
        matching.add(rowKey(row))
      // Also cover older caches before derived project metadata has been rebuilt.
      if (!row.recordOnly && !matching.has(rowKey(row))) {
        for (const fact of facts(row)) {
          const project = projects.find((project) => project.id === owner(fact.projectPath))
          if (
            inScope(fact) &&
            matchesWorkspaceSearch(keywords, [fact.projectPath, project?.name, project?.notes])
          ) {
            matching.add(rowKey(row))
            break
          }
        }
      }
    }
  }
  const summary = emptyAggregate(),
    agents = new Map<string, Aggregate>(),
    models = new Map<string, Aggregate>(),
    projectTotals = new Map<string, Aggregate>()
  const days = new Map<string, AnalyticsTrendPoint>(),
    hours = new Map<string, AnalyticsTrendPoint>()
  const modelAgents = new Map<string, Map<string, Aggregate>>()
  const projectAgents = new Map<string, Map<string, Aggregate>>()
  const projectModels = new Map<
    string,
    Map<string, { tokens: number; cost: CostAccumulator; missing: boolean }>
  >()
  const dateTotals = new Map<string, Aggregate>()
  const buckets = Object.fromEntries(
    ANALYTICS_BUCKETS.map((bucket) => [bucket, createCostAccumulator(PRICE_CATALOG_VERSION)]),
  ) as Record<AnalyticsBucket, CostAccumulator>
  const missingBuckets = new Set<AnalyticsBucket>()
  const roots = new Set<string>(),
    sessions = new Map<string, string>()
  const includeHours = !!filter.from && filter.from === filter.to
  let first = '',
    last = ''
  // An unbounded query may contain only one day, but it never builds hourly buckets.
  let hourlyComplete = includeHours
  for (const row of rows()) {
    const model = canonicalModelName(row.model)
    const root = row.recordOnly ? undefined : identity(row.agent, row.root_id)
    if (matching && !matching.has(rowKey(row))) continue
    for (const fact of facts(row)) {
      if (!inScope(fact)) continue
      if (!first || row.date < first) first = row.date
      if (row.date > last) last = row.date
      hourlyComplete &&= fact.hour >= 0
      if (root) {
        roots.add(root)
        sessions.set(identity(row.agent, row.session_id), root)
      }
      let relatedAgents = modelAgents.get(model)
      if (!relatedAgents) {
        relatedAgents = new Map()
        modelAgents.set(model, relatedAgents)
      }
      const projectId = owner(fact.projectPath)
      let relatedModels = projectModels.get(projectId)
      if (!relatedModels) {
        relatedModels = new Map()
        projectModels.set(projectId, relatedModels)
      }
      let modelUsage = relatedModels.get(model)
      if (!modelUsage) {
        modelUsage = {
          tokens: 0,
          cost: createCostAccumulator(PRICE_CATALOG_VERSION),
          missing: false,
        }
        relatedModels.set(model, modelUsage)
      }
      modelUsage.tokens += fact.totalTokens
      if (fact.costSummary) modelUsage.cost.add(fact.costSummary)
      else modelUsage.missing = true
      let relatedProject = projectAgents.get(projectId)
      if (!relatedProject) {
        relatedProject = new Map()
        projectAgents.set(projectId, relatedProject)
      }
      for (const entry of [
        summary,
        dimension(agents, row.agent),
        dimension(models, model),
        dimension(projectTotals, owner(fact.projectPath)),
        dimension(relatedAgents, row.agent),
        dimension(relatedProject, row.agent),
        dimension(dateTotals, row.date),
      ])
        add(entry, fact, root)
      const points = [point(days, row.date)]
      if (includeHours && fact.hour >= 0)
        points.push(point(hours, `${row.date}T${String(fact.hour).padStart(2, '0')}`))
      for (const value of points) {
        addTrend(value.total, fact)
        addTrend((value.agents[row.agent] ??= trendValue()), fact)
        addTrend((value.models[model] ??= trendValue()), fact)
        addTrend((value.projects[projectId] ??= trendValue()), fact)
        if (row.recordOnly) {
          value.total.turnsComplete = false
          value.agents[row.agent].turnsComplete = false
          value.models[model].turnsComplete = false
          value.projects[projectId].turnsComplete = false
        }
      }
      for (const bucket of ANALYTICS_BUCKETS) {
        const cost = fact.bucketCosts[bucket]
        if (cost) buckets[bucket].add(cost)
        else missingBuckets.add(bucket)
      }
    }
  }
  const turns = readAnalyticsTurns(db, filter)
  const coverage = [...turns.coverage].filter(([key]) => sessions.has(key))
  const complete = !roots.size || (coverage.length > 0 && coverage.every(([, value]) => value))
  for (const entry of [
    summary,
    ...agents.values(),
    ...models.values(),
    ...projectTotals.values(),
    ...[...modelAgents.values()].flatMap((values) => [...values.values()]),
    ...[...projectAgents.values()].flatMap((values) => [...values.values()]),
    ...dateTotals.values(),
  ])
    entry.value.turns.complete &&= complete
  for (const values of [days, hours])
    for (const value of values.values()) {
      value.total.turnsComplete &&= complete
      for (const item of [
        ...Object.values(value.agents),
        ...Object.values(value.models),
        ...Object.values(value.projects),
      ])
        item.turnsComplete &&= complete
    }
  for (const turn of turns.turns) {
    if (!roots.has(identity(turn.agent, turn.rootSessionId))) continue
    const projectId = owner(turn.projectPath)
    if (projectIds.length && !projectIds.includes(projectId)) continue
    const entries = [
      summary,
      agents.get(turn.agent),
      models.get(turn.model),
      projectTotals.get(projectId),
      modelAgents.get(turn.model)?.get(turn.agent),
      projectAgents.get(projectId)?.get(turn.agent),
      dateTotals.get(formatDateFromMs(turn.time)),
    ]
    for (const entry of entries) if (entry) entry.value.turns.count++
    const date = formatDateFromMs(turn.time)
    const points = [point(days, date)]
    if (includeHours)
      points.push(
        point(hours, `${date}T${String(new Date(turn.time).getHours()).padStart(2, '0')}`),
      )
    for (const value of points) {
      value.total.turns++
      ;(value.agents[turn.agent] ??= trendValue()).turns++
      ;(value.models[turn.model] ??= trendValue()).turns++
      ;(value.projects[projectId] ??= trendValue()).turns++
    }
  }
  const dimensions = (
    values: Map<string, Aggregate>,
    names?: Map<string, string>,
  ): AnalyticsDimension[] =>
    [...values]
      .map(([id, entry]) => ({ ...finish(entry), id, name: names?.get(id) || id }))
      .sort((a, b) => b.totalTokens - a.totalTokens || a.id.localeCompare(b.id))
  return {
    from: filter.from || first,
    to: filter.to || last,
    summary: finish(summary),
    agents: dimensions(agents),
    models: dimensions(models),
    modelAgents: Object.fromEntries(
      [...modelAgents].map(([model, values]) => [model, dimensions(values)]),
    ),
    projectAgents: Object.fromEntries(
      [...projectAgents].map(([project, values]) => [project, dimensions(values)]),
    ),
    projectModels: Object.fromEntries(
      [...projectModels].map(([project, values]) => [
        project,
        [...values]
          .map(([id, value]) => ({
            id,
            name: id,
            totalTokens: value.tokens,
            costSummary: value.missing ? undefined : value.cost.finish(),
          }))
          .sort((a, b) => b.totalTokens - a.totalTokens || a.id.localeCompare(b.id)),
      ]),
    ),
    projects: dimensions(projectTotals, projectNames),
    dates: dimensions(dateTotals),
    days: [...days.values()].sort((a, b) => a.key.localeCompare(b.key)),
    hours: [...hours.values()].sort((a, b) => a.key.localeCompare(b.key)),
    hourlyComplete,
    bucketCosts: Object.fromEntries(
      ANALYTICS_BUCKETS.map((bucket) => [
        bucket,
        missingBuckets.has(bucket) ? undefined : buckets[bucket].finish(),
      ]),
    ) as AnalyticsBucketCosts,
  }
}
