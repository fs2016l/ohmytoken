import type { TokenPlanInformation, TokenPlanWindowUsage } from '../../shared/token-plan'
import type { DiscoveredConnection, JsonObject } from './types'
import { numberValue, object, percentage, textValue, timestamp } from './types'

export interface ParsedQuota {
  plan: TokenPlanInformation
  windows: TokenPlanWindowUsage[]
  models: string[]
}

export function quotaWindow(
  id: string,
  label: string,
  values: Partial<TokenPlanWindowUsage> = {},
): TokenPlanWindowUsage {
  let usedPercent = percentage(values.usedPercent)
  let remainingPercent = percentage(values.remainingPercent)
  const limit = numberValue(values.limit)
  const used = numberValue(values.used)
  const remaining = numberValue(values.remaining)
  if (usedPercent === null && remainingPercent !== null) usedPercent = 100 - remainingPercent
  if (usedPercent === null && limit !== null && limit > 0 && used !== null)
    usedPercent = (used / limit) * 100
  if (remainingPercent === null && usedPercent !== null)
    remainingPercent = Math.max(0, 100 - usedPercent)
  return {
    id,
    label,
    kind: values.kind ?? 'model',
    windowMinutes: values.windowMinutes ?? null,
    available:
      usedPercent !== null || used !== null || remaining !== null || values.unlimited === true,
    unlimited: values.unlimited === true,
    usedPercent,
    remainingPercent,
    used,
    limit,
    remaining,
    unit: values.unit ?? null,
    startsAt: values.startsAt ?? null,
    resetsAt: values.resetsAt ?? null,
    details: values.details ?? [],
  }
}

export function initialPlan(connection: DiscoveredConnection): TokenPlanInformation {
  const products = {
    minimax: 'MiniMax Token Plan',
    zhipu: 'GLM Coding Plan',
    openai: 'Codex',
    anthropic: 'Claude',
    kimi: 'Kimi Code',
    google: 'Gemini Code Assist',
    xai: 'Grok',
  }
  return {
    product: products[connection.public.providerId],
    tier: connection.tierHint ?? null,
    tierSource: connection.tierHint ? 'login' : null,
    expiresAt: null,
    renewalAt: null,
    parallelLimit: null,
  }
}

function returnedTier(plan: TokenPlanInformation, value: unknown): void {
  const tier = textValue(value)
  if (tier && tier.length <= 120 && !/[\r\n]/.test(tier)) {
    plan.tier = tier
    plan.tierSource = 'provider'
  }
}

function rows(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.slice(0, 150).map(object) : []
}

function minimaxCounts(row: JsonObject, prefix: string): Partial<TokenPlanWindowUsage> {
  const limit = numberValue(row[`${prefix}_total_count`])
  const count = numberValue(row[`${prefix}_usage_count`])
  const remainingPercent = percentage(row[`${prefix}_remaining_percent`])
  if (
    limit === null ||
    limit <= 0 ||
    count === null ||
    count > limit ||
    remainingPercent === null
  ) {
    return { remainingPercent }
  }
  // 数量字段的方向在不同响应版本中不同，只有与明确的剩余比例一致时才展示数量。
  const asRemaining = Math.abs((count / limit) * 100 - remainingPercent) <= 1
  const asUsed = Math.abs(((limit - count) / limit) * 100 - remainingPercent) <= 1
  if (asRemaining === asUsed && count * 2 !== limit) return { remainingPercent }
  const remaining = asRemaining ? count : asUsed ? limit - count : null
  return remaining === null
    ? { remainingPercent }
    : { remainingPercent, limit, remaining, used: limit - remaining }
}

function parseMiniMax(body: JsonObject, plan: TokenPlanInformation): TokenPlanWindowUsage[] {
  const status = object(body.base_resp).status_code
  if (status !== undefined && status !== 0) throw new Error('invalid_response')
  const data = object(body.data)
  const groups = rows(body.model_remains ?? data.model_remains)
  if (!groups.length) throw new Error('invalid_response')
  returnedTier(plan, data.plan_name ?? body.plan_name)
  const general = groups.find((row) => row.model_name === 'general')
  return (general ? [general] : groups).flatMap((row, index) => {
    const name = general ? '' : (textValue(row.model_name) ?? `Group ${index + 1}`)
    const windows = [
      quotaWindow(`${index}:interval`, name || '5h', {
        ...minimaxCounts(row, 'current_interval'),
        windowMinutes: 300,
        startsAt: timestamp(row.start_time),
        resetsAt: timestamp(row.end_time),
      }),
    ]
    if (row.current_weekly_status === 1)
      windows.push(
        quotaWindow(`${index}:weekly`, name ? `${name} · 7d` : '7d', {
          ...minimaxCounts(row, 'current_weekly'),
          windowMinutes: 10080,
          startsAt: timestamp(row.weekly_start_time),
          resetsAt: timestamp(row.weekly_end_time),
        }),
      )
    return windows
  })
}

function parseZhipu(body: JsonObject, plan: TokenPlanInformation): TokenPlanWindowUsage[] {
  if (body.code !== 200 || body.success === false) throw new Error('invalid_response')
  const data = object(body.data)
  if (!Array.isArray(data.limits)) throw new Error('invalid_response')
  returnedTier(plan, data.level)
  return rows(data.limits)
    .filter((row) => row.type === 'TIME_LIMIT' || row.type === 'TOKENS_LIMIT')
    .map((row, index) => {
      const count = numberValue(row.number)
      const minutes = row.unit === 3 ? 60 : row.unit === 4 ? 1440 : row.unit === 6 ? 10080 : null
      const duration = count !== null && minutes !== null ? count * minutes : null
      const label =
        duration === 300
          ? '5h'
          : duration === 10080
            ? '7d'
            : row.unit === 5 && count === 1
              ? 'monthly'
              : 'quota'
      const tool = row.type === 'TIME_LIMIT'
      return quotaWindow(`zhipu:${index}`, tool ? `MCP · ${label}` : label, {
        kind: tool ? 'tool' : 'model',
        windowMinutes: duration,
        usedPercent: percentage(row.percentage),
        used: tool ? numberValue(row.currentValue) : null,
        limit: tool ? numberValue(row.usage) : null,
        remaining: tool ? numberValue(row.remaining) : null,
        unit: tool ? 'requests' : null,
        resetsAt: timestamp(row.nextResetTime),
        details: tool
          ? rows(row.usageDetails).flatMap((detail) => {
              const name = textValue(detail.modelCode)
              const used = numberValue(detail.usage)
              return name && used !== null ? [{ name, used }] : []
            })
          : [],
      })
    })
}

function parseCodex(body: JsonObject, plan: TokenPlanInformation): TokenPlanWindowUsage[] {
  returnedTier(plan, body.plan_type)
  const entries: Array<[string, JsonObject]> = []
  if (body.rate_limit) entries.push(['Codex', object(body.rate_limit)])
  if (body.code_review_rate_limit)
    entries.push(['Code review', object(body.code_review_rate_limit)])
  for (const entry of rows(body.additional_rate_limits)) {
    entries.push([
      textValue(entry.limit_name) ?? textValue(entry.metered_feature) ?? 'Model',
      object(entry.rate_limit),
    ])
  }
  const windows = entries.flatMap(([label, limits], index) =>
    ['primary_window', 'secondary_window'].flatMap((key) => {
      if (!limits[key]) return []
      const row = object(limits[key])
      const seconds = numberValue(row.limit_window_seconds)
      return [
        quotaWindow(`${index}:${key}`, label, {
          usedPercent: percentage(row.used_percent),
          windowMinutes: seconds === null ? null : seconds / 60,
          resetsAt: timestamp(row.reset_at),
        }),
      ]
    }),
  )
  const credits = object(body.credits)
  if (credits.has_credits === true || credits.unlimited === true)
    windows.push(
      quotaWindow('credits', 'Credits', {
        kind: 'balance',
        remaining: numberValue(credits.balance),
        unlimited: credits.unlimited === true,
        unit: 'credits',
      }),
    )
  return windows
}

function parseClaude(body: JsonObject): TokenPlanWindowUsage[] {
  const windows: TokenPlanWindowUsage[] = []
  for (const [key, value] of Object.entries(body)) {
    if (!/^five_hour$|^seven_day(?:_[\w-]+)?$/.test(key) || !value) continue
    const row = object(value)
    windows.push(
      quotaWindow(
        key,
        key === 'five_hour' ? '5h' : key === 'seven_day' ? '7d' : key.replace('seven_day_', ''),
        {
          usedPercent: percentage(row.utilization),
          windowMinutes: key === 'five_hour' ? 300 : 10080,
          resetsAt: timestamp(row.resets_at),
        },
      ),
    )
  }
  // 未知的新额度桶保留接口标签，不把任意桶强行标成五小时或每周。
  for (const [index, row] of rows(body.limits).entries())
    windows.push(
      quotaWindow(`limit:${index}`, textValue(row.name) ?? textValue(row.model) ?? 'quota', {
        usedPercent: percentage(row.utilization),
        resetsAt: timestamp(row.resets_at),
      }),
    )
  const extra = object(body.extra_usage)
  if (extra.is_enabled === true)
    windows.push(
      quotaWindow('claude:extra', 'Extra usage', {
        kind: 'balance',
        used: numberValue(extra.used_credits),
        limit: numberValue(extra.monthly_limit),
        usedPercent: percentage(extra.utilization),
        unit: 'credits',
      }),
    )
  return windows
}

function parseKimi(body: JsonObject, plan: TokenPlanInformation): TokenPlanWindowUsage[] {
  plan.product = 'Kimi Code'
  returnedTier(
    plan,
    object(body.profile).user_level_name ??
      object(object(body.user).membership).level ??
      body.subType,
  )
  plan.parallelLimit = numberValue(object(body.parallel).limit)
  const duration = (value: unknown): number | null => {
    const row = object(value)
    const units: Record<string, number> = {
      TIME_UNIT_MINUTE: 1,
      TIME_UNIT_HOUR: 60,
      TIME_UNIT_DAY: 1440,
      TIME_UNIT_WEEK: 10080,
    }
    const count = numberValue(row.duration)
    const minutes = units[String(row.timeUnit)]
    return count !== null && count > 0 && minutes ? count * minutes : null
  }
  const entries: Array<[string, JsonObject, number | null]> = []
  if (body.usage)
    entries.push(['Kimi Code', object(body.usage), duration(object(body.usage).window) ?? 10080])
  rows(body.limits).forEach((row, index) =>
    entries.push([
      textValue(row.name) ?? (row.window ? 'Kimi Code' : `quota ${index + 1}`),
      object(row.detail ?? row),
      duration(row.window),
    ]),
  )
  if (body.totalQuota) entries.push(['total', object(body.totalQuota), null])
  return entries.map(([label, row, minutes], index) => {
    const limit = numberValue(row.limit)
    const remaining = numberValue(row.remaining)
    const used =
      numberValue(row.used) ??
      (limit !== null && remaining !== null && remaining <= limit ? limit - remaining : null)
    return quotaWindow(`kimi:${index}`, label, {
      limit,
      remaining,
      used,
      windowMinutes: minutes,
      resetsAt: timestamp(row.resetTime ?? row.reset_at ?? row.resetAt),
    })
  })
}

function parseGemini(body: JsonObject, plan: TokenPlanInformation): TokenPlanWindowUsage[] {
  const tier = object(body.accountTier)
  returnedTier(plan, tier.name ?? tier.id)
  if (!Array.isArray(body.buckets)) throw new Error('invalid_response')
  return rows(body.buckets).map((row, index) => {
    const fraction = numberValue(row.remainingFraction)
    return quotaWindow(`google:${index}`, textValue(row.modelId) ?? 'quota', {
      remainingPercent: fraction !== null && fraction <= 1 ? fraction * 100 : null,
      remaining: numberValue(row.remainingAmount),
      resetsAt: timestamp(row.resetTime),
      unit: row.tokenType === 'REQUESTS' ? 'requests' : null,
    })
  })
}

function parseGrok(body: JsonObject, plan: TokenPlanInformation): TokenPlanWindowUsage[] {
  const row = object(body.config)
  if (!Object.keys(row).length) throw new Error('invalid_response')
  const period = object(row.currentPeriod)
  returnedTier(plan, body.subscriptionTier ?? body.subscription_tier)
  function dollars(value: unknown): number | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const amount = object(value)
    const cents = numberValue(Object.keys(amount).length === 0 ? 0 : amount.val)
    return cents === null ? null : cents / 100
  }
  const windows = [
    quotaWindow('grok:credits', textValue(period.type) ?? 'Credits', {
      usedPercent: percentage(row.creditUsagePercent),
      limit: dollars(row.monthlyLimit),
      used: dollars(row.used),
      unit: 'USD',
      startsAt: timestamp(period.start ?? row.billingPeriodStart),
      resetsAt: timestamp(period.end ?? row.billingPeriodEnd),
    }),
  ]
  if (row.onDemandCap || row.onDemandUsed)
    windows.push(
      quotaWindow('grok:on-demand', 'On-demand', {
        kind: 'balance',
        limit: dollars(row.onDemandCap),
        used: dollars(row.onDemandUsed),
        unit: 'USD',
      }),
    )
  if (row.prepaidBalance)
    windows.push(
      quotaWindow('grok:prepaid', 'Prepaid', {
        kind: 'balance',
        remaining: dollars(row.prepaidBalance),
        unit: 'USD',
      }),
    )
  return windows
}

export function parseQuota(connection: DiscoveredConnection, value: unknown): ParsedQuota {
  const body = object(value)
  const plan = initialPlan(connection)
  const parsers = {
    minimax: () => parseMiniMax(body, plan),
    zhipu: () => parseZhipu(body, plan),
    openai: () => parseCodex(body, plan),
    anthropic: () => parseClaude(body),
    kimi: () => parseKimi(body, plan),
    google: () => parseGemini(body, plan),
    xai: () => parseGrok(body, plan),
  }
  const windows = parsers[connection.public.providerId]()
  if (!windows.length) throw new Error('invalid_response')
  return {
    plan,
    windows,
    models:
      connection.public.providerId === 'google'
        ? rows(body.buckets).flatMap((row) => (textValue(row.modelId) ? [String(row.modelId)] : []))
        : [],
  }
}
