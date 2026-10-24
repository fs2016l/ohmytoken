import type { TokenPlanInformation, TokenPlanWindowUsage } from '../../shared/token-plan'
import type { DiscoveredConnection, JsonObject } from './types'
import { balanceValue, numberValue, object, percentage, textValue, timestamp } from './types'
import { deepSeekBalances } from './deepseek-balance'
import { grokCreditUsagePercent } from './grok-billing'

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
  const remaining =
    values.kind === 'balance' && (values.unit === 'CNY' || values.unit === 'USD')
      ? balanceValue(values.remaining)
      : numberValue(values.remaining)
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
    antigravity: 'Antigravity',
    deepseek: connection.public.authType === 'api-key' ? 'DeepSeek API' : 'DeepSeek Harness',
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
  // 状态 1 正常、2 已耗尽、3 不限量；两个窗口都不限量且总量为 0 的通道不属于当前套餐。
  const counts = (row: JsonObject, prefix: string): Partial<TokenPlanWindowUsage> => {
    const status = row[`${prefix}_status`]
    if (status === 3) return { unlimited: true }
    const values = minimaxCounts(row, prefix)
    return status === 2 && values.remainingPercent === null ? { remainingPercent: 0 } : values
  }
  const absent = (row: JsonObject, prefix: string): boolean =>
    row[`${prefix}_status`] === 3 && !numberValue(row[`${prefix}_total_count`])
  return (general ? [general] : groups).flatMap((row, index) => {
    if (!general && absent(row, 'current_interval') && absent(row, 'current_weekly')) return []
    const name = general ? '' : (textValue(row.model_name) ?? `Group ${index + 1}`)
    const windows = [
      quotaWindow(`${index}:interval`, name || '5h', {
        ...counts(row, 'current_interval'),
        windowMinutes: 300,
        startsAt: timestamp(row.start_time),
        resetsAt: timestamp(row.end_time),
      }),
    ]
    if ([1, 2, 3].includes(row.current_weekly_status as number))
      windows.push(
        quotaWindow(`${index}:weekly`, name ? `${name} · 7d` : '7d', {
          ...counts(row, 'current_weekly'),
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
    .filter((row) => ['TIME_LIMIT', 'TOKENS_LIMIT', 'CREDIT_LIMIT'].includes(row.type as string))
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
      // 积分套餐的 5 小时/每周窗口带总量与已用积分；旧版 Token 窗口只有百分比。
      const counted = tool || row.type === 'CREDIT_LIMIT'
      return quotaWindow(`zhipu:${index}`, tool ? `MCP · ${label}` : label, {
        kind: tool ? 'tool' : 'model',
        windowMinutes: duration,
        usedPercent: percentage(row.percentage),
        used: counted ? numberValue(row.currentValue) : null,
        limit: counted ? numberValue(row.usage) : null,
        remaining: counted ? numberValue(row.remaining) : null,
        unit: tool ? 'requests' : counted ? 'credits' : null,
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
  for (const [index, row] of rows(body.limits).entries()) {
    const weekly = row.group === 'weekly' || /^weekly/.test(textValue(row.kind) ?? '')
    windows.push(
      quotaWindow(
        `limit:${index}`,
        textValue(object(object(row.scope).model).display_name) ??
          textValue(row.name) ??
          textValue(row.model) ??
          'quota',
        {
          usedPercent: percentage(row.utilization ?? row.percent),
          windowMinutes: weekly ? 10080 : null,
          resetsAt: timestamp(row.resets_at),
        },
      ),
    )
  }
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
  const pools = object(body.usages)
  const poolKeys: Array<[string, string, number]> = [
    ['limit_5h', 'Kimi Code', 300],
    ['limit_7d', 'Kimi Code', 10080],
    ['limit_month_code', 'Kimi Code', 43200],
    ['limit_month_total', 'Kimi shared quota', 43200],
  ]
  // 新版按比例返回 5 小时、每周、每月 Code 与每月共享额度；有比例池时以它为准，不与旧计数窗口重复。
  const present = poolKeys.filter(([key]) => pools[key])
  if (present.length)
    return present.map(([key, label, minutes]) => {
      const row = object(pools[key])
      const ratio = numberValue(row.used_ratio)
      return quotaWindow(`kimi:${key}`, label, {
        usedPercent: ratio === null ? null : Math.min(100, ratio * 100),
        windowMinutes: minutes,
        resetsAt: timestamp(row.reset_time ?? row.resetTime),
      })
    })
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

function parseAntigravity(body: JsonObject, plan: TokenPlanInformation): TokenPlanWindowUsage[] {
  if (
    (body.code !== undefined && ![0, 200, '0', '200'].includes(body.code as string | number)) ||
    body.error
  )
    throw new Error('invalid_response')
  const tier = object(body.accountTier)
  returnedTier(plan, tier.name ?? tier.id ?? body.planType)
  const summary = object(body.response ?? body.summary ?? body)
  if (!Array.isArray(summary.groups)) throw new Error('invalid_response')
  const found = new Map<string, Partial<TokenPlanWindowUsage>>()
  const conflicts = new Set<string>()
  for (const group of rows(summary.groups)) {
    if (!Array.isArray(group.buckets)) continue
    const name = (textValue(group.displayName ?? group.name) ?? '').toLowerCase()
    for (const bucket of rows(group.buckets)) {
      const id = (textValue(bucket.bucketId ?? bucket.id) ?? '').toLowerCase()
      const bucketFamily = /^gemini[-_]/.test(id)
        ? 'gemini'
        : /^3p[-_]/.test(id)
          ? 'third-party'
          : null
      const groupFamily = name.includes('gemini')
        ? 'gemini'
        : /claude|gpt/.test(name)
          ? 'third-party'
          : null
      if (bucketFamily && groupFamily && bucketFamily !== groupFamily) continue
      const family = bucketFamily ?? groupFamily
      const cadence = (
        textValue(bucket.window) ??
        textValue(bucket.displayName ?? bucket.name) ??
        id
      )
        .toLowerCase()
        .replace(/_/g, '-')
        .replace(/\s+limit$/, '')
      const kind = /(?:^|[- ])weekly$/.test(cadence)
        ? 'weekly'
        : /(?:^|[- ])(?:session|5h|5-hour|five hour|five-hour)$/.test(cadence)
          ? 'session'
          : null
      if (!family || !kind || !id) continue
      const remaining = object(bucket.remaining)
      const fraction = numberValue(
        bucket.remainingFraction ??
          remaining.remainingFraction ??
          (remaining.case === 'remainingFraction' ? remaining.value : undefined),
      )
      const values = {
        remainingPercent:
          bucket.disabled !== true && fraction !== null && fraction <= 1 ? fraction * 100 : null,
        // Hub omits the reset description for unused windows; their resetTime moves on each fetch.
        resetsAt:
          fraction === 1 && !textValue(bucket.description) ? null : timestamp(bucket.resetTime),
      }
      const key = `${family}:${kind}`
      const previous = found.get(key)
      if (previous && JSON.stringify(previous) !== JSON.stringify(values)) conflicts.add(key)
      else found.set(key, values)
    }
  }
  const starter = /(?:^|[ _-])starter(?:$|[ _-])/i.test(plan.tier ?? '')
  return [
    ['gemini', 'Gemini'],
    ['third-party', 'Claude + GPT'],
  ].flatMap(([family, label]) =>
    (starter ? ['weekly'] : ['session', 'weekly']).map((kind) => {
      const key = `${family}:${kind}`
      return quotaWindow(`antigravity:${key}`, `${label} ${kind}`, {
        ...(conflicts.has(key) ? {} : found.get(key)),
        windowMinutes: kind === 'session' ? 300 : 10080,
      })
    }),
  )
}

function parseGrok(body: JsonObject, plan: TokenPlanInformation): TokenPlanWindowUsage[] {
  const row = object(body.config)
  if (!Object.keys(row).length) throw new Error('invalid_response')
  const period = object(row.currentPeriod)
  returnedTier(plan, body.subscriptionTier ?? body.subscription_tier)
  function dollars(value: unknown): number | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const amount = object(value)
    const raw = Object.keys(amount).length === 0 ? 0 : amount.val
    // 余额可能以负数分值保存，展示取绝对值。
    const cents = numberValue(
      typeof raw === 'string'
        ? raw.trim().replace(/^-/, '')
        : typeof raw === 'number'
          ? Math.abs(raw)
          : raw,
    )
    return cents === null ? null : cents / 100
  }
  const limit = dollars(row.monthlyLimit)
  const used = dollars(row.used)
  const windows = [
    quotaWindow('grok:credits', textValue(period.type) ?? 'Credits', {
      usedPercent: grokCreditUsagePercent(row),
      limit,
      used,
      unit: limit !== null || used !== null ? 'USD' : null,
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
    antigravity: () => parseAntigravity(body, plan),
    deepseek: () =>
      deepSeekBalances(connection, body).map(({ id, label, ...values }) =>
        quotaWindow(id, label, { ...values, kind: 'balance' }),
      ),
    xai: () => parseGrok(body, plan),
  }
  const windows = parsers[connection.public.providerId]()
  if (!windows.length) throw new Error('invalid_response')
  return {
    plan,
    windows,
    models: [],
  }
}
