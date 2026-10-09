import type {
  QuotaDetailQuery,
  QuotaDetailSource,
  QuotaDetailSourceId,
  QuotaMetric,
} from '../../shared/quota-details'
import { detailSource, digest, metric, records, safeText } from './detail-common'
import { numberValue, object, timestamp, type JsonObject } from './types'
import { QuotaQueryError } from './transport'

export function parseGlmDetail(id: QuotaDetailSourceId, body: JsonObject): QuotaDetailSource {
  if (body.success === false || (body.code !== undefined && body.code !== 200))
    throw new QuotaQueryError('invalid_response')
  const data = object(body.data)
  if (!Array.isArray(data.x_time)) throw new QuotaQueryError('invalid_response')
  const result = detailSource(id)
  result.granularity =
    data.granularity === 'hourly' ? 'hour' : data.granularity === 'daily' ? 'day' : 'unknown'
  result.notes = ['providerDates']
  const models = id === 'glm-models'
  const total = object(data.totalUsage)
  result.metrics = models
    ? [
        ...metric('total', total.totalTokensUsage, 'tokens'),
        ...metric('requests', total.totalModelCallCount, 'requests'),
      ]
    : []
  const series = records((models ? data.modelDataList : data.toolDataList) ?? [], 100)
  if (!models && !series.length) {
    for (const [key, label] of [
      ['networkSearchCount', 'Network search'],
      ['webReadMcpCount', 'Web reader'],
      ['zreadMcpCount', 'Zread'],
    ]) {
      if (Array.isArray(data[key])) series.push({ toolName: label, usageCount: data[key] })
    }
  }
  if (!models) {
    for (const row of records(data.toolSummaryList ?? total.toolSummaryList ?? [], 100))
      result.metrics.push(
        ...metric(
          'requests',
          row.totalUsageCount,
          'requests',
          safeText(row.toolNameI18n ?? row.toolName ?? row.toolCode) ?? undefined,
        ),
      )
  }
  result.rows = data.x_time.slice(0, 750).flatMap((time, index) => {
    const label = safeText(time)
    if (!label) return []
    const at = (value: unknown): unknown => (Array.isArray(value) ? value[index] : undefined)
    const entries = series.map((row, i) => ({
      id: `${index}:${i}`,
      time: label,
      label: safeText(row.modelName ?? row.toolNameI18n ?? row.toolName ?? row.toolCode) ?? '',
      category: models ? 'model' : 'tool',
      metrics: metric(
        models ? 'total' : 'requests',
        at(models ? row.tokensUsage : row.usageCount),
        models ? 'tokens' : 'requests',
      ),
    }))
    if (models)
      entries.unshift({
        id: `${index}:total`,
        time: label,
        label: '',
        category: 'total',
        metrics: [
          ...metric('total', at(data.tokensUsage), 'tokens'),
          ...metric('requests', at(data.modelCallCount), 'requests'),
        ],
      })
    return entries
  })
  if (result.rows.length > 6000) {
    result.rows = result.rows.slice(0, 6000)
    result.status = 'partial'
    result.notes.push('truncated')
  }
  return result
}

export function parseMiniMaxBilling(body: JsonObject, query: QuotaDetailQuery): QuotaDetailSource {
  if (object(body.base_resp).status_code !== 0) throw new QuotaQueryError('invalid_response')
  const result = detailSource('minimax-billing')
  result.granularity = 'hour'
  result.notes = ['latestRecords', 'minimaxCoverage', 'providerDates']
  const rows = records(body.charge_records, 100)
  const page = query.cursor ? Number(query.cursor) : 1
  result.totalRows = numberValue(body.total_cnt)
  result.nextCursor =
    rows.length && (result.totalRows === null ? rows.length >= 20 : page * 20 < result.totalRows)
      ? String(page + 1)
      : null
  result.rows = rows.map((row, index) => {
    const method = safeText(row.method) ?? ''
    const textTokens = method === 'chatcompletion-v2(Text API)' || method === 'cache-read(Text API)'
    return {
      id: digest([page, index, row.created_at, method]),
      time: safeText(row.consume_time),
      label: [method, safeText(row.model), safeText(row.status)].filter(Boolean).join(' · '),
      category: method === 'code_plan_purchase' ? 'purchase' : textTokens ? 'textApi' : 'other',
      metrics: [
        ...metric('billed', row.consume_cash_after_voucher, 'CNY'),
        ...metric('beforeVoucher', row.consume_cash, 'CNY'),
        ...metric(
          textTokens ? 'total' : 'rawQuantity',
          row.consume_token,
          textTokens ? 'tokens' : 'unknown',
        ),
        ...(textTokens
          ? [
              ...metric('input', row.consume_input_token, 'tokens'),
              ...metric('output', row.consume_output_token, 'tokens'),
            ]
          : []),
      ],
    }
  })
  return result
}

export function parseAccountMetadata(id: QuotaDetailSourceId, body: JsonObject): QuotaDetailSource {
  const result = detailSource(id)
  result.granularity = 'snapshot'
  if (id === 'claude-extra') {
    const extra = object(body.extra_usage)
    result.notes = ['claudeNoHistory']
    if (!Object.keys(extra).length) {
      result.status = 'unsupported'
      return result
    }
    result.metrics = [
      ...metric(
        'enabled',
        typeof extra.is_enabled === 'boolean' ? Number(extra.is_enabled) : null,
        'count',
      ),
      ...metric('usedCredits', extra.used_credits, 'credits'),
      ...metric('monthlyLimit', extra.monthly_limit, 'credits'),
      ...metric('usage', extra.utilization, 'percent'),
    ]
    result.notes.push('claudeCreditUnits')
  } else if (id === 'gemini-account') {
    result.notes = ['geminiNoHistory']
    result.rows = records(body.buckets).map((row, index) => ({
      id: String(index),
      time: timestamp(row.resetTime) ? new Date(timestamp(row.resetTime)!).toISOString() : null,
      label: safeText(row.modelId) ?? '',
      category: safeText(row.tokenType),
      metrics: [
        ...metric(
          'remaining',
          row.remainingAmount,
          row.tokenType === 'REQUESTS' ? 'requests' : 'unknown',
        ),
        ...metric('remainingRatio', row.remainingFraction, 'ratio'),
      ],
    }))
    const tier = object(body.accountTier)
    if (safeText(tier.name ?? tier.id))
      result.rows.unshift({
        id: 'tier',
        time: null,
        label: safeText(tier.name ?? tier.id)!,
        category: 'tier',
        metrics: [],
      })
  } else if (id === 'grok-settings') {
    const tier = safeText(body.subscription_tier_display ?? body.subscription_tier)
    result.rows = tier
      ? [{ id: 'tier', time: null, label: tier, category: 'tier', metrics: [] }]
      : []
    result.metrics = metric(
      'onDemandEnabled',
      typeof body.on_demand_enabled === 'boolean' ? Number(body.on_demand_enabled) : null,
      'count',
    )
  } else {
    const config = object(body.config)
    if (!Object.keys(config).length) throw new QuotaQueryError('invalid_response')
    result.granularity = 'month'
    result.notes = ['grokBillingOnly']
    const cents = (key: string, value: unknown): QuotaMetric[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const n = numberValue(object(value).val ?? 0)
      return metric(key, n === null ? null : n / 100, 'USD')
    }
    result.metrics = [
      ...metric('usage', config.creditUsagePercent, 'percent'),
      ...metric(
        'unifiedBilling',
        typeof config.isUnifiedBillingUser === 'boolean'
          ? Number(config.isUnifiedBillingUser)
          : null,
        'count',
      ),
      ...cents('onDemand', config.onDemandUsed),
      ...cents('prepaid', config.prepaidBalance),
    ]
    result.rows = records(config.history ?? [], 120).map((row, index) => {
      const cycle = object(row.billingCycle)
      const year = numberValue(cycle.year),
        month = numberValue(cycle.month)
      return {
        id: String(index),
        time: year && month && month <= 12 ? `${year}-${String(month).padStart(2, '0')}` : null,
        label: '',
        category: 'billing',
        metrics: [
          ...cents('included', row.includedUsed),
          ...cents('onDemand', row.onDemandUsed),
          ...cents('billed', row.totalUsed),
        ],
      }
    })
  }
  return result
}
