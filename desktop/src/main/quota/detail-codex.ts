import type {
  QuotaDetailQuery,
  QuotaDetailSource,
  QuotaDetailSourceId,
  QuotaMetric,
} from '../../shared/quota-details'
import { detailSource, inRange, metric, records, safeText } from './detail-common'
import { QuotaQueryError } from './transport'
import { object, timestamp, type JsonObject } from './types'

function usage(row: JsonObject): QuotaMetric[] {
  return [
    ...metric('uncachedInput', row.uncached_text_input_tokens, 'tokens'),
    ...metric('cacheRead', row.cached_text_input_tokens, 'tokens'),
    ...metric('output', row.text_output_tokens, 'tokens'),
    ...metric('total', row.text_total_tokens, 'tokens'),
    ...metric('turns', row.turns, 'turns'),
    ...metric('threads', row.threads, 'threads'),
    ...metric('credits', row.credits, 'credits'),
  ]
}
export function parseCodexDetail(
  id: QuotaDetailSourceId,
  body: JsonObject,
  query: QuotaDetailQuery,
): QuotaDetailSource {
  const result = detailSource(id)
  result.granularity = 'day'
  result.notes = ['providerDates', 'separateTotals']
  if (id === 'codex-activity') {
    const stats = object(body.stats)
    const metadata = object(body.metadata)
    if (metadata.stats_error) throw new QuotaQueryError('provider_unavailable')
    result.providerAsOf = timestamp(metadata.stats_as_of)
    result.metrics = [
      ...metric('lifetime', stats.lifetime_tokens, 'tokens'),
      ...metric('peakDay', stats.peak_daily_tokens, 'tokens'),
      ...metric('currentStreak', stats.current_streak_days, 'days'),
      ...metric('longestStreak', stats.longest_streak_days, 'days'),
      ...metric('longestTurn', stats.longest_running_turn_sec, 'seconds'),
      ...metric('threads', stats.total_threads, 'threads'),
      ...metric('fastMode', stats.fast_mode_usage_percentage, 'percent'),
      ...metric('skillsUsed', stats.total_skills_used, 'count'),
      ...metric('uniqueSkills', stats.unique_skills_used, 'count'),
      ...metric(
        'reasoningEffort',
        stats.most_used_reasoning_effort_percentage,
        'percent',
        safeText(stats.most_used_reasoning_effort) ?? undefined,
      ),
    ]
    const cumulative = new Map(
      records(stats.cumulative_daily_usage_buckets ?? []).map((row) => [
        row.start_date,
        row.tokens,
      ]),
    )
    result.rows = records(stats.daily_usage_buckets)
      .filter((row) => inRange(row.start_date, query))
      .map((row) => ({
        id: String(row.start_date),
        time: String(row.start_date),
        label: '',
        category: null,
        metrics: [
          ...metric('total', row.tokens, 'tokens'),
          ...metric('cumulative', cumulative.get(row.start_date), 'tokens'),
        ],
      }))
    for (const row of records(stats.top_invocations ?? [], 20)) {
      const label = safeText(row.skill_name ?? row.plugin_name)
      if (label) result.metrics.push(...metric('invocations', row.usage_count, 'count', label))
    }
    return result
  }
  if (body.group_by !== undefined && body.group_by !== 'day')
    throw new QuotaQueryError('invalid_response')
  if (id === 'codex-analytics') {
    result.notes.push('textTokens', 'modelActivityOnly')
    result.rows = records(body.data)
      .filter((row) => inRange(row.date, query))
      .flatMap((day) => [
        {
          id: `${day.date}:total`,
          time: String(day.date),
          label: '',
          category: 'total',
          metrics: usage(object(day.totals)),
        },
        ...records(day.clients ?? [], 100).map((row, i) => ({
          id: `${day.date}:client:${i}`,
          time: String(day.date),
          label: safeText(row.client_id) ?? '',
          category: 'client',
          metrics: usage(row),
        })),
        ...records(day.models ?? [], 100).map((row, i) => ({
          id: `${day.date}:model:${i}`,
          time: String(day.date),
          label: safeText(row.model) ?? '',
          category: 'model',
          metrics: usage(row),
        })),
      ])
    return result
  }
  // 此接口报告的是额度消耗占比，不是 Token 数量或货币。
  if (body.units !== 'percent') throw new QuotaQueryError('invalid_response')
  result.notes.push('quotaPercent')
  result.rows = records(body.data)
    .filter((row) => inRange(row.date, query))
    .flatMap((day) => [
      ...Object.entries(object(day.product_surface_usage_values))
        .slice(0, 100)
        .map(([name, value]) => ({
          id: `${day.date}:client:${name}`,
          time: String(day.date),
          label: safeText(name) ?? '',
          category: 'client',
          metrics: metric('usage', value, 'percent'),
        })),
      ...records(day.models ?? [], 100).map((row, i) => ({
        id: `${day.date}:model:${i}`,
        time: String(day.date),
        label: [safeText(row.model), safeText(row.speed)].filter(Boolean).join(' · '),
        category: 'model',
        metrics: metric('usage', row.credits, 'percent'),
      })),
    ])
  return result
}
