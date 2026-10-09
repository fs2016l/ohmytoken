import type Database from 'better-sqlite3'
import { deserialize, serialize } from 'node:v8'
import { deflateSync, inflateSync } from 'node:zlib'
import type {
  AnalyticsBucket,
  AnalyticsBucketCosts,
  AnalyticsTokens,
  UsageAnalyticsFilter,
} from '../../shared/analytics'
import { ANALYTICS_BUCKETS } from '../../shared/analytics'
import type { TokenUsageApiCall } from '../../shared/models'
import type { UsageCostAssessment, UsageCostRollup } from '../../shared/usage-cost'
import { createCostAccumulator, summarizeCostGroups } from '../../shared/cost-rollup'
import { estimateUsageCostBreakdown } from '../cost/estimate-cost'
import { PRICE_CATALOG_VERSION } from '../cost/price-catalog'
import { callFromCostRow, type CostRow } from '../cost/cost-cache'
import { parseCostRollup } from '../cost/cost-rollup-storage'
import { decodeMeterData, TOKEN_FIELDS, type SessionDataRow } from './session-usage-codec'
import { evidenceForCall } from '../cost/usage-evidence'
import { usageCallTime } from './usage-call-time'
import { ensureAnalyticsSchema } from './analytics-schema'
import { normalizeCollectedProjectPath } from '../scanners/project-path'
import { attributeModel } from '../cost/model-attribution'
import { modelSqlSelection } from './model-identity.service'

export const ANALYTICS_REVISION = `${PRICE_CATALOG_VERSION}:analytics-3`
export interface AnalyticsFact extends AnalyticsTokens {
  lastActiveAt?: string
  projectPath: string
  hour: number
  apiCallCount: number
  apiCallCountComplete: boolean
  costSummary?: UsageCostRollup
  bucketCosts: AnalyticsBucketCosts
}
interface SourceRow {
  agent: string
  session_id: string
  date: string
  model: string
  project_path: string | null
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
  ended_at?: string
}
export function emptyAnalyticsTokens(): AnalyticsTokens {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }
}
export function decodeAnalyticsFacts(data: Buffer): AnalyticsFact[] {
  return deserialize(inflateSync(data)) as AnalyticsFact[]
}
/** A known daily aggregate is an unpriced evidence record, never a fabricated API request. */
export function unpricedAnalyticsCost(
  agent: string,
  model: string,
  tokens: number,
): UsageCostRollup {
  return summarizeCostGroups(
    [
      {
        agent,
        model,
        tokens,
        records: 1,
        identity: attributeModel(model),
        status: 'unpriced',
        reason: 'model-not-historical',
      },
    ],
    PRICE_CATALOG_VERSION,
    1,
  )
}
function bucketTokens(call: TokenUsageApiCall, bucket: AnalyticsBucket): number {
  return bucket === 'cache' ? call.cacheReadTokens + call.cacheWriteTokens : call[`${bucket}Tokens`]
}
function rollup(
  call: TokenUsageApiCall,
  assessment: UsageCostAssessment,
  tokens = call.totalTokens,
): UsageCostRollup {
  const { reportedCost: _reported, ...cost } = assessment
  return summarizeCostGroups(
    [{ ...cost, agent: call.agent, model: call.model, records: 1, tokens }],
    PRICE_CATALOG_VERSION,
    call.evidence ? 0 : 1,
  )
}
function buildFacts(calls: TokenUsageApiCall[], source: SourceRow): AnalyticsFact[] {
  if (!calls.length)
    return [
      {
        ...emptyAnalyticsTokens(),
        projectPath: source.project_path || '',
        hour: -1,
        lastActiveAt: source.ended_at || source.date,
        inputTokens: source.input_tokens,
        outputTokens: source.output_tokens,
        cacheReadTokens: source.cache_read_tokens,
        cacheWriteTokens: source.cache_write_tokens,
        reasoningTokens: source.reasoning_tokens,
        totalTokens: source.total_tokens,
        apiCallCount: source.api_call_count,
        apiCallCountComplete: source.api_count_complete !== 0,
        costSummary: parseCostRollup(source)?.totalRecords
          ? parseCostRollup(source)
          : unpricedAnalyticsCost(source.agent, source.model, source.total_tokens),
        bucketCosts: {
          input: undefined,
          output: undefined,
          cache: undefined,
          reasoning: undefined,
        },
      },
    ]
  const groups = new Map<
    string,
    {
      fact: AnalyticsFact
      cost: ReturnType<typeof createCostAccumulator>
      buckets: Record<AnalyticsBucket, ReturnType<typeof createCostAccumulator>>
    }
  >()
  for (const call of calls) {
    const time = usageCallTime(call)
    const projectPath = normalizeCollectedProjectPath(call.projectPath) || ''
    const hour =
      evidenceForCall(call).granularity !== 'aggregate' &&
      Number.isInteger(time.hour) &&
      time.hour >= 0 &&
      time.hour < 24
        ? time.hour
        : -1
    const key = JSON.stringify([projectPath, hour])
    let entry = groups.get(key)
    if (!entry) {
      entry = {
        fact: {
          ...emptyAnalyticsTokens(),
          projectPath,
          hour,
          apiCallCount: 0,
          apiCallCountComplete: true,
          bucketCosts: {
            input: undefined,
            output: undefined,
            cache: undefined,
            reasoning: undefined,
          },
        },
        cost: createCostAccumulator(PRICE_CATALOG_VERSION),
        buckets: Object.fromEntries(
          ANALYTICS_BUCKETS.map((bucket) => [bucket, createCostAccumulator(PRICE_CATALOG_VERSION)]),
        ) as Record<AnalyticsBucket, ReturnType<typeof createCostAccumulator>>,
      }
      groups.set(key, entry)
    }
    for (const field of TOKEN_FIELDS) entry.fact[field] += call[field]
    const timestamp = time.timestamp || time.date
    if (!entry.fact.lastActiveAt || Date.parse(timestamp) > Date.parse(entry.fact.lastActiveAt))
      entry.fact.lastActiveAt = timestamp
    entry.fact.apiCallCount++
    entry.fact.apiCallCountComplete &&= evidenceForCall(call).granularity !== 'aggregate'
    const estimated = estimateUsageCostBreakdown({
      ...call,
      date: time.date,
      timestamp: time.timestamp,
      hour: time.hour,
    })
    entry.cost.add(rollup(call, estimated.total))
    for (const bucket of ANALYTICS_BUCKETS)
      entry.buckets[bucket].add(rollup(call, estimated.buckets[bucket], bucketTokens(call, bucket)))
  }
  return [...groups.values()].map((entry) => ({
    ...entry.fact,
    costSummary: entry.cost.finish(),
    bucketCosts: Object.fromEntries(
      ANALYTICS_BUCKETS.map((bucket) => [bucket, entry.buckets[bucket].finish()]),
    ) as AnalyticsBucketCosts,
  }))
}
export function analyticsSourceFilter(
  filter: UsageAnalyticsFilter,
  db: Database.Database,
): {
  sql: string
  params: string[]
} {
  const clauses: string[] = [],
    params: string[] = []
  for (const [column, operator, value] of [
    ['date', '>=', filter.from],
    ['date', '<=', filter.to],
    ['agent', '=', filter.agent],
  ] as const) {
    if (value) {
      clauses.push(`s.${column} ${operator} ?`)
      params.push(value)
    }
  }
  if (filter.model) {
    const selection = modelSqlSelection('s.model', [filter.model], db)
    clauses.push(selection.sql)
    params.push(...selection.params)
  }
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
      throw new Error('Invalid analytics filter')
    if (column === 'model') {
      const selection = modelSqlSelection('s.model', values, db)
      clauses.push(selection.sql)
      params.push(...selection.params)
    } else {
      clauses.push(`s.${column} IN (${values.map(() => '?').join(',')})`)
      params.push(...values)
    }
  }
  return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', params }
}
const pending = new WeakMap<Database.Database, Promise<void>>()
/** Per-session jobs yield between small transactions. Concurrent scopes share work and then recheck. */
export async function refreshAnalyticsCache(
  db: Database.Database,
  filter: UsageAnalyticsFilter,
): Promise<void> {
  ensureAnalyticsSchema(db)
  const existing = pending.get(db)
  if (existing) {
    await existing
    return refreshAnalyticsCache(db, filter)
  }
  const work = rebuild(db, filter).finally(() => pending.delete(db))
  pending.set(db, work)
  return work
}
async function rebuild(db: Database.Database, filter: UsageAnalyticsFilter): Promise<void> {
  const scope = analyticsSourceFilter(filter, db)
  const read =
    db.prepare(`SELECT s.* FROM usage_sessions s LEFT JOIN usage_analytics_cache c USING (agent,session_id,date,model)
    WHERE (c.revision IS NULL OR c.revision != ?) ${scope.sql} LIMIT 4`)
  const compact = db.prepare(
    'SELECT * FROM usage_session_data WHERE agent = ? AND session_id = ? AND date = ? AND model = ?',
  )
  const legacy = db.prepare(
    'SELECT * FROM usage_api_calls WHERE agent = ? AND session_id = ? AND date = ? AND model = ?',
  )
  const write = db.prepare(
    'INSERT OR REPLACE INTO usage_analytics_cache(agent,session_id,date,model,revision,data) VALUES (?,?,?,?,?,?)',
  )
  const batch = db.transaction(() => {
    const rows = read.all(ANALYTICS_REVISION, ...scope.params) as SourceRow[]
    for (const row of rows) {
      const key = [row.agent, row.session_id, row.date, row.model]
      const data = compact.get(...key) as SessionDataRow | undefined
      const calls = data
        ? decodeMeterData(data)
        : (legacy.all(...key) as Array<CostRow & { project_path: string | null }>).map((value) => ({
            ...callFromCostRow(value),
            projectPath: value.project_path || undefined,
          }))
      write.run(...key, ANALYTICS_REVISION, deflateSync(serialize(buildFacts(calls, row))))
    }
    return rows.length
  })
  while (db.open && batch.immediate() > 0)
    await new Promise<void>((resolve) => setImmediate(resolve))
}
