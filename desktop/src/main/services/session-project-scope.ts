import type { UsageDetailFilter } from '../../shared/models'
import type { UsageCostAssessment, UsageCostRollup } from '../../shared/usage-cost'
import { summarizeCostGroups } from '../../shared/cost-rollup'
import { parseCostRollup, type CostRollupRow } from '../cost/cost-rollup-storage'
import { PRICE_CATALOG_VERSION } from '../cost/price-catalog'

export function hasProjectScope(filter: UsageDetailFilter): boolean {
  return Boolean(filter.projectId || filter.projectIds?.length || filter.trackedProjectsOnly)
}

const buckets = [
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'reasoning_tokens',
  'total_tokens',
]
function projectedColumns(source: 'p' | 'g'): string {
  return `s.rowid AS rowid, s.agent, s.session_id, s.parent_session_id, s.root_session_id,
    s.sub_agent_name, ${source}.project_path, s.title, s.date,
    CASE WHEN ${source}.first_ms > 0 THEN strftime('%Y-%m-%dT%H:%M:%f', ${source}.first_ms / 1000.0, 'unixepoch', 'localtime') ELSE s.started_at END AS started_at,
    CASE WHEN ${source}.last_ms > 0 THEN strftime('%Y-%m-%dT%H:%M:%f', ${source}.last_ms / 1000.0, 'unixepoch', 'localtime') ELSE s.ended_at END AS ended_at,
    s.model, ${buckets.map((field) => `${source}.${field}`).join(',')}, ${source}.api_call_count,
    COALESCE(${source}.first_ms, s.started_at_ms) AS started_at_ms,
    COALESCE(${source}.last_ms, s.ended_at_ms) AS ended_at_ms,
    ${source === 'p' ? 'p.cost_revision, p.cost_summary' : 'NULL AS cost_revision, NULL AS cost_summary'},
    ${source}.api_count_complete, ${source === 'g' ? 'g.cost_groups' : 'NULL AS cost_groups'}`
}

/** A read-only projection, so all existing root grouping/search/pagination uses scoped amounts. */
export function sessionSourceSql(filter: UsageDetailFilter): string {
  if (!hasProjectScope(filter)) return ''
  return `WITH legacy_project_cost_groups AS (
    SELECT a.agent, a.session_id, a.date, a.model, a.project_path,
      ${buckets.map((field) => `SUM(a.${field}) AS ${field}`).join(',')}, COUNT(*) AS api_call_count,
      MIN(CASE WHEN json_valid(a.usage_evidence) THEN CASE WHEN json_extract(a.usage_evidence, '$.granularity') = 'aggregate' THEN 0 ELSE 1 END ELSE 1 END) AS api_count_complete,
      MIN(CASE WHEN a.event_timestamp_ms > 0 THEN a.event_timestamp_ms END) AS first_ms,
      MAX(a.event_timestamp_ms) AS last_ms, c.revision, c.group_json,
      SUM(c.min_cost) AS min_cost, SUM(c.max_cost) AS max_cost, SUM(a.usage_evidence IS NULL) AS legacy_records
    FROM usage_api_calls a LEFT JOIN usage_cost_cache c ON c.agent = a.agent AND c.api_call_id = a.api_call_id
    GROUP BY a.agent, a.session_id, a.date, a.model, a.project_path, c.revision, c.group_json
  ), legacy_project_rows AS (
    SELECT agent, session_id, date, model, project_path,
      ${buckets.map((field) => `SUM(${field}) AS ${field}`).join(',')}, SUM(api_call_count) AS api_call_count,
      MIN(api_count_complete) AS api_count_complete, MIN(first_ms) AS first_ms, MAX(last_ms) AS last_ms,
      json_group_array(json_object('revision', revision, 'assessment', group_json,
        'min', min_cost, 'max', max_cost, 'records', api_call_count,
        'tokens', total_tokens, 'legacy', legacy_records)) AS cost_groups
    FROM legacy_project_cost_groups GROUP BY agent, session_id, date, model, project_path
  ), usage_sessions AS (
    SELECT ${projectedColumns('p')} FROM main.usage_sessions s
      JOIN usage_session_projects p USING (agent, session_id, date, model)
    UNION ALL
    SELECT ${projectedColumns('g')} FROM main.usage_sessions s
      JOIN legacy_project_rows g USING (agent, session_id, date, model)
    UNION ALL
    SELECT s.rowid AS rowid, s.agent, s.session_id, s.parent_session_id, s.root_session_id,
      s.sub_agent_name, s.project_path, s.title, s.date, s.started_at, s.ended_at, s.model,
      ${buckets.map((field) => `s.${field}`).join(',')}, s.api_call_count, s.started_at_ms, s.ended_at_ms,
      s.cost_revision, s.cost_summary, s.api_count_complete, NULL AS cost_groups
      FROM main.usage_sessions s
      WHERE NOT EXISTS (SELECT 1 FROM usage_session_data d WHERE d.agent = s.agent AND d.session_id = s.session_id AND d.date = s.date AND d.model = s.model)
      AND NOT EXISTS (SELECT 1 FROM usage_api_calls a WHERE a.agent = s.agent AND a.session_id = s.session_id AND a.date = s.date AND a.model = s.model)
  )`
}

export function readSessionCost(
  row: CostRollupRow & { agent: string; model: string; cost_groups?: string | null },
): UsageCostRollup | undefined {
  if (!row.cost_groups) return parseCostRollup(row)
  const values = JSON.parse(row.cost_groups) as Array<{
    revision: string
    assessment: string | null
    min: number | null
    max: number | null
    records: number
    tokens: number
    legacy: number
  }>
  if (values.some((value) => value.revision !== PRICE_CATALOG_VERSION || !value.assessment))
    return undefined
  return summarizeCostGroups(
    values.map((value) => ({
      ...(JSON.parse(value.assessment!) as UsageCostAssessment),
      agent: row.agent,
      model: row.model,
      records: value.records,
      tokens: value.tokens,
      min: value.min ?? undefined,
      max: value.max ?? undefined,
    })),
    PRICE_CATALOG_VERSION,
    values.reduce((sum, value) => sum + value.legacy, 0),
  )
}
