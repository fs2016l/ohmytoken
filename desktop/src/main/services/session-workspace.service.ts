import type {
  SessionSort,
  SessionWorkspaceFilter,
  SessionWorkspacePage,
  SessionWorkspaceSummary,
} from '../../shared/models'
import type { UsageCostRollup } from '../../shared/usage-cost'
import { createCostAccumulator, unpricedCostRollup } from '../../shared/cost-rollup'
import { validDate } from '../../shared/calendar-date'
import { openDatabase } from './sqlite-storage.service'
import {
  buildSessionSearchScore,
  buildSessionWhere,
  readUserSessionsByKeys,
} from './usage-detail-storage.service'
import { hasProjectScope, readSessionCost, sessionSourceSql } from './session-project-scope'
import { refreshProjectUsageMetadata } from './session-project-metadata'
import {
  PRICE_CATALOG_VERSION,
  canonicalModelName,
  priceCatalogRevision,
} from '../cost/price-catalog'
import { readSessionTurnCounts } from './session-turns'
import { readLatestSessionTurns } from './session-latest-turn-storage'
import { sessionTurnView } from '../../shared/session-turn-view'
import { combineCostRollups } from '../../shared/cost-rollup'
import { readWithUsageCosts } from './usage-cost.service'

interface Entry {
  latestTurnKnown?: boolean
  latestTurnUsageAvailable?: boolean
  agent: string
  rootSessionId: string
  title: string
  model: string
  models: Map<string, number>
  tokens: number
  input: number
  output: number
  cache: number
  reasoning: number
  calls: number
  callsComplete: boolean
  recent: number
  recentText: string
  relevance: number
  cost?: UsageCostRollup
  missingCost: boolean
}
interface Index {
  entries: Entry[]
  summary: SessionWorkspaceSummary
  turns?: ReturnType<typeof readSessionTurnCounts>
}
interface Row {
  cost_groups?: string | null
  agent: string
  session_id: string
  root_key: string
  title: string | null
  model: string
  total_tokens: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  api_call_count: number
  api_count_complete: number
  ended_at_ms: number
  started_at_ms: number
  ended_at: string
  started_at: string
  date: string
  cost_revision: string | null
  cost_summary: string | null
  relevance: number
}
const caches = new WeakMap<
  ReturnType<typeof openDatabase>,
  { version: string; values: Map<string, Index> }
>()

function indexFor(filter: SessionWorkspaceFilter, committedRead: boolean): Index {
  const db = openDatabase()
  const { whereSql, params } = buildSessionWhere(filter)
  const search = buildSessionSearchScore(filter.query, hasProjectScope(filter))
  const key = JSON.stringify([whereSql, params, search.params, filter.turnScope])
  const version = JSON.stringify([
    priceCatalogRevision(),
    db
      .prepare(
        'SELECT total_changes() AS changes, (SELECT data_version FROM pragma_data_version) AS version',
      )
      .get(),
  ])
  const cacheable = !db.inTransaction || committedRead
  let cache = cacheable ? caches.get(db) : undefined
  if (!cache || cache.version !== version) {
    cache = { version, values: new Map() }
    if (cacheable) caches.set(db, cache)
  }
  const existing = cache.values.get(key)
  if (existing) return existing
  const root = "COALESCE(NULLIF(root_session_id, ''), session_id)"
  const score = search.scoreSql || '0'
  // Search selects whole roots. Date/model/project filters still apply to every counted row.
  const source = sessionSourceSql(filter)
  const sql = `${source ? source + ', ' : 'WITH '} matched AS (
    SELECT agent AS matched_agent, ${root} AS matched_root, (${score}) AS relevance
    FROM usage_sessions ${search.joinSql} ${whereSql}
    GROUP BY agent, ${root} ${search.scoreSql ? 'HAVING relevance > 0' : ''}
  ) SELECT usage_sessions.agent, session_id, ${root} AS root_key, title, model,
      total_tokens, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
      api_call_count, api_count_complete, ended_at_ms, started_at_ms,
      ended_at, started_at, date, cost_revision, cost_summary, ${source ? 'cost_groups' : 'NULL AS cost_groups'}, relevance
    FROM usage_sessions JOIN matched ON matched_agent = agent AND matched_root = ${root}
    ${whereSql}`
  const entries = new Map<string, Entry>()
  const costs = new Map<string, ReturnType<typeof createCostAccumulator>>()
  const allCosts = createCostAccumulator(PRICE_CATALOG_VERSION)
  let anyMissingCost = false
  for (const row of db
    .prepare(sql)
    .iterate(...search.params, ...params, ...params) as Iterable<Row>) {
    const identity = JSON.stringify([row.agent, row.root_key])
    let entry = entries.get(identity)
    if (!entry) {
      entry = {
        agent: row.agent,
        rootSessionId: row.root_key,
        title: '',
        model: '',
        models: new Map(),
        tokens: 0,
        input: 0,
        output: 0,
        cache: 0,
        reasoning: 0,
        calls: 0,
        callsComplete: true,
        recent: 0,
        recentText: '',
        relevance: row.relevance,
        missingCost: false,
      }
      entries.set(identity, entry)
    }
    entry.tokens += row.total_tokens
    entry.input += row.input_tokens
    entry.output += row.output_tokens
    entry.cache += row.cache_read_tokens + row.cache_write_tokens
    entry.reasoning += row.reasoning_tokens
    entry.calls += row.api_call_count
    entry.callsComplete &&= row.api_count_complete !== 0
    const recent = row.ended_at_ms || row.started_at_ms
    const recentText = row.ended_at || row.started_at || row.date
    if (recent > entry.recent || (recent === entry.recent && recentText > entry.recentText)) {
      entry.recent = recent
      entry.recentText = recentText
    }
    if (row.session_id === row.root_key && row.title) entry.title = row.title
    const model = canonicalModelName(row.model)
    entry.models.set(model, (entry.models.get(model) ?? 0) + row.total_tokens)
    const cost = readSessionCost(row)
    if (cost) {
      let aggregate = costs.get(identity)
      if (!aggregate) {
        aggregate = createCostAccumulator(PRICE_CATALOG_VERSION)
        costs.set(identity, aggregate)
      }
      aggregate.add(cost)
      allCosts.add(cost)
    } else {
      entry.missingCost = true
      anyMissingCost = true
      const unknown = unpricedCostRollup(
        row.agent,
        row.model,
        row.total_tokens,
        row.api_call_count,
        PRICE_CATALOG_VERSION,
      )
      let aggregate = costs.get(identity)
      if (!aggregate) {
        aggregate = createCostAccumulator(PRICE_CATALOG_VERSION)
        costs.set(identity, aggregate)
      }
      aggregate.add(unknown)
      allCosts.add(unknown)
    }
  }
  const values = [...entries.values()]
  const metadata = db.prepare(
    'SELECT title FROM usage_sessions WHERE agent = ? AND session_id = ? AND title IS NOT NULL ORDER BY ended_at_ms DESC, ended_at DESC LIMIT 1',
  )
  for (const entry of values) {
    const rootMeta = metadata.get(entry.agent, entry.rootSessionId) as { title: string } | undefined
    entry.title = rootMeta?.title || entry.title || entry.rootSessionId
    entry.model =
      [...entry.models].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || ''
    entry.models.clear()
    const cost = costs.get(JSON.stringify([entry.agent, entry.rootSessionId]))?.finish()
    entry.cost = entry.missingCost && !cost?.pricedRecords ? undefined : cost
  }
  let summaryCost = allCosts.finish()
  if (filter.turnScope === 'latest') {
    const latest = readLatestSessionTurns(
      db,
      values.map((e) => ({ agent: e.agent, sessionId: e.rootSessionId })),
    )
    for (const entry of values) {
      const turn = latest.get(JSON.stringify([entry.agent, entry.rootSessionId]))
      entry.latestTurnKnown = Boolean(turn)
      entry.latestTurnUsageAvailable = turn?.usageAvailable === true
      entry.tokens = turn?.totalTokens ?? 0
      entry.input = turn?.inputTokens ?? 0
      entry.output = turn?.outputTokens ?? 0
      entry.cache = (turn?.cacheReadTokens ?? 0) + (turn?.cacheWriteTokens ?? 0)
      entry.reasoning = turn?.reasoningTokens ?? 0
      entry.calls = turn?.apiCallCount ?? 0
      entry.callsComplete = turn?.usageAvailable === true && turn.apiCallCountComplete
      entry.model = turn?.models[0] ?? ''
      entry.cost = turn?.costSummary
      if (turn) entry.recent = Math.max(entry.recent, turn.updatedAtMs)
    }
    summaryCost = combineCostRollups(
      values.flatMap((e) => (e.cost ? [e.cost] : [])),
      PRICE_CATALOG_VERSION,
    )
    anyMissingCost = values.some((e) => !e.cost)
  }
  const result: Index = {
    entries: values,
    summary: {
      ...(filter.turnScope === 'latest'
        ? {
            latestTurnUsageMissing: values.filter((entry) => !entry.latestTurnUsageAvailable)
              .length,
          }
        : {}),
      totalTokens: values.reduce((sum, entry) => sum + entry.tokens, 0),
      apiCallCount: values.reduce((sum, entry) => sum + entry.calls, 0),
      apiCallCountComplete: values.every((entry) => entry.callsComplete),
      costSummary: anyMissingCost && !summaryCost.pricedRecords ? undefined : summaryCost,
    },
  }
  if (cacheable) cache.values.set(key, result)
  while (cache.values.size > 3) cache.values.delete(cache.values.keys().next().value!)
  return result
}

function costValue(entry: Entry, rate: number | undefined): number | null {
  const cost = entry.cost
  if (!cost || !cost.pricedRecords) return null
  let sum = 0
  for (const item of cost.totals) {
    if (item.currency === 'USD') sum += item.min
    else if (rate && Number.isFinite(rate) && rate > 0) sum += item.min / rate
    else return null
  }
  return sum
}

export async function getSessionWorkspace(
  filter: SessionWorkspaceFilter,
): Promise<SessionWorkspacePage> {
  if (hasProjectScope(filter) || filter.query?.trim())
    await refreshProjectUsageMetadata(openDatabase())
  // readWithUsageCosts owns a read-only snapshot after the pricing transaction commits.
  return readWithUsageCosts(() => readSessionWorkspace(filter, true))
}

export function readSessionWorkspace(
  filter: SessionWorkspaceFilter,
  committedRead = false,
): SessionWorkspacePage {
  const comparison = filter.comparison
  if (
    comparison !== undefined &&
    (!comparison ||
      !validDate(comparison.from) ||
      !validDate(comparison.to) ||
      comparison.from > comparison.to)
  )
    throw new Error('Invalid comparison date range')
  const db = openDatabase()
  const index = indexFor(filter, committedRead)
  // The search selects current roots. Earlier titles must not hide their baseline.
  const baseline = comparison
    ? new Map(
        indexFor({ ...filter, ...comparison, query: undefined }, committedRead).entries.map(
          (entry) => [JSON.stringify([entry.agent, entry.rootSessionId]), entry.tokens],
        ),
      )
    : null
  const prior = (entry: { agent: string; rootSessionId: string }): number =>
    baseline?.get(JSON.stringify([entry.agent, entry.rootSessionId])) ?? 0
  const sorts: SessionSort[] = [
    'title',
    'agent',
    'model',
    'tokens',
    'input',
    'output',
    'cache',
    'reasoning',
    'cost',
    'calls',
    'turns',
    'change',
    'recent',
  ]
  const sort = sorts.includes(filter.sortBy!) ? filter.sortBy! : 'recent'
  const direction = filter.sortDirection === 'asc' ? 1 : -1
  if (sort === 'turns') index.turns ??= readSessionTurnCounts(db, filter)
  const value = (entry: Entry): string | number | null => {
    if (sort === 'change') {
      const before = prior(entry)
      return before > 0 ? (entry.tokens - before) / before : null
    }
    if (sort === 'cost') return costValue(entry, filter.costExchangeRate)
    if (sort === 'turns') {
      if (filter.turnScope === 'latest') return entry.latestTurnKnown ? 1 : null
      if (entry.calls === 0 && entry.tokens === 0) return 0
      const count = index.turns?.get(JSON.stringify([entry.agent, entry.rootSessionId]))
      return count?.complete ? count.count : null
    }
    return entry[sort]
  }
  const ordered = [...index.entries].sort((a, b) => {
    if (!filter.sortBy && a.relevance !== b.relevance) return b.relevance - a.relevance
    const left = value(a),
      right = value(b)
    if (left === null || right === null) return left === right ? tie(a, b) : left === null ? 1 : -1
    const compared =
      typeof left === 'string' && typeof right === 'string'
        ? left.localeCompare(right, undefined, { numeric: true })
        : Number(left) - Number(right)
    return compared * direction || tie(a, b)
  })
  const total = ordered.length
  const size = Number.isFinite(filter.pageSize) ? Math.trunc(filter.pageSize!) : 10
  const pageSize = Math.max(1, Math.min(100, size))
  const totalPages = Math.ceil(total / pageSize)
  const requested = Number.isFinite(filter.page) ? Math.trunc(filter.page!) : 1
  const page = Math.max(1, Math.min(totalPages || 1, requested))
  return {
    items: readUserSessionsByKeys(
      filter,
      ordered.slice((page - 1) * pageSize, page * pageSize),
    ).map((item) =>
      sessionTurnView(
        baseline ? { ...item, comparisonTokens: prior(item) } : item,
        filter.turnScope === 'latest' ? 'latest' : 'all',
      ),
    ),
    page,
    pageSize,
    total,
    totalPages,
    summary: structuredClone(index.summary),
  }
}

function tie(a: Entry, b: Entry): number {
  return (
    b.recent - a.recent ||
    b.recentText.localeCompare(a.recentText) ||
    a.agent.localeCompare(b.agent) ||
    a.rootSessionId.localeCompare(b.rootSessionId)
  )
}
