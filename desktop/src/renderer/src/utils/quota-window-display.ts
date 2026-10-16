import type { TokenPlanProviderId, TokenPlanWindowUsage } from '@shared/token-plan'
import { formatNumber } from './number-format'
import { quotaRemainingPercent } from './quota-display'

type Label = (en: string, zh: string) => string

const MONTH_MINUTES = 43_200

/** 一组同范围的额度窗口；范围为空表示套餐的主额度，不显示组名。 */
export interface QuotaWindowGroup {
  key: string
  scope: string
  windows: TokenPlanWindowUsage[]
}

export interface QuotaBalanceView {
  id: string
  icon: string
  value: string
  title: string
  caption?: string
}

/** 厂商返回的窗口标签与时长不统一，展示时只用周期长度，接口标签保留在完整名称中。 */
export function quotaPeriodMinutes(row: TokenPlanWindowUsage): number | null {
  if (row.windowMinutes && row.windowMinutes > 0) {
    // 与 Codex 官方界面一致：时长在常见周期 ±5% 内时按该周期命名。
    const known = [300, 1_440, 10_080, MONTH_MINUTES].find(
      (minutes) => Math.abs(row.windowMinutes! - minutes) <= minutes * 0.05,
    )
    return known ?? row.windowMinutes
  }
  const text = row.label.toLowerCase()
  if (/monthly|usage_period_type_monthly/.test(text)) return MONTH_MINUTES
  if (/weekly|usage_period_type_weekly|(?:^|\W)7d$/.test(text)) return 10_080
  if (/usage_period_type_daily|daily/.test(text)) return 1_440
  if (/session|(?:^|\W)5h$/.test(text)) return 300
  return null
}

export function quotaPeriodText(row: TokenPlanWindowUsage, label: Label): string {
  const minutes = quotaPeriodMinutes(row)
  if (minutes === 300) return label('5h', '5 小时')
  if (minutes === 1_440) return label('Daily', '每天')
  if (minutes === 10_080) return label('Weekly', '每周')
  if (minutes === MONTH_MINUTES) return label('Monthly', '每月')
  if (minutes !== null) {
    if (minutes < 60) return label(`${formatNumber(minutes)} min`, `${formatNumber(minutes)} 分钟`)
    if (minutes % 1_440 === 0)
      return label(`${minutes / 1_440} days`, `${formatNumber(minutes / 1_440)} 天`)
    if (minutes % 60 === 0) return label(`${minutes / 60}h`, `${formatNumber(minutes / 60)} 小时`)
    return label(`${formatNumber(minutes)} min`, `${formatNumber(minutes)} 分钟`)
  }
  return row.label === 'total' ? label('Total', '总额度') : label('Quota', '额度')
}

/** 接口原始范围；套餐主额度返回空字符串。 */
function rawScope(row: TokenPlanWindowUsage, providerId: TokenPlanProviderId): string {
  const raw = row.label.trim()
  if (/^(?:5h|7d|monthly|quota|total)$/i.test(raw) || /^USAGE_PERIOD_TYPE_/.test(raw)) return ''
  if (/^MCP(?:\s|·|$)/.test(raw)) return 'MCP'
  const family = /^(Gemini|Claude \+ GPT) (?:session|weekly)$/.exec(raw)
  if (family) return family[1]!
  if (
    (providerId === 'openai' && raw === 'Codex') ||
    (providerId === 'kimi' && raw === 'Kimi Code')
  )
    return ''
  return raw.replace(/\s·\s(?:5h|7d)$/, '')
}

function scopeText(scope: string, label: Label): string {
  const names: Record<string, string> = {
    'Code review': label('Code review', '代码审查'),
    'Kimi shared quota': label('Kimi shared', 'Kimi 共享'),
    opus: 'Opus',
    sonnet: 'Sonnet',
    oauth_apps: label('OAuth apps', 'OAuth 应用'),
  }
  return names[scope] ?? scope
}

/** 计量不是 Token 或百分比的窗口在名称旁标出单位，避免与其他窗口混读。 */
export function quotaUnitBadge(row: TokenPlanWindowUsage, label: Label): string {
  if (row.unit === 'requests') return label('req', '次')
  if (row.unit === 'credits') return label('credits', '积分')
  if (row.unit === 'USD') return '$'
  if (row.unit === 'CNY') return '¥'
  return ''
}

/** 悬停提示中的完整名称，保留厂商自己的额度含义。 */
export function quotaWindowTitle(row: TokenPlanWindowUsage, label: Label): string {
  const names: Record<string, string> = {
    '5h': label('5-hour quota', '5 小时额度'),
    '7d': label('Weekly quota', '每周额度'),
    monthly: label('Monthly quota', '每月额度'),
    quota: label('Usage limit', '用量限制'),
    'MCP · monthly': label('Monthly MCP calls', '每月 MCP 调用次数'),
    'MCP · 5h': label('5-hour MCP calls', '5 小时 MCP 调用次数'),
    'MCP · 7d': label('Weekly MCP calls', '每周 MCP 调用次数'),
    total: label('Total quota', '总额度'),
    Codex: label('Codex usage limit', 'Codex 用量限制'),
    'Code review': label('Code review limit', '代码审查用量限制'),
    'Kimi Code': label('Kimi Code quota', 'Kimi Code 额度'),
    'Kimi shared quota': label('Kimi shared quota', 'Kimi 共享额度'),
    'Gemini session': label('Gemini session quota', 'Gemini 会话额度'),
    'Gemini weekly': label('Gemini weekly quota', 'Gemini 每周额度'),
    'Claude + GPT session': label('Claude + GPT session quota', 'Claude + GPT 会话额度'),
    'Claude + GPT weekly': label('Claude + GPT weekly quota', 'Claude + GPT 每周额度'),
    opus: label('Weekly Opus quota', 'Opus 每周额度'),
    sonnet: label('Weekly Sonnet quota', 'Sonnet 每周额度'),
    oauth_apps: label('Weekly OAuth apps quota', 'OAuth 应用每周额度'),
    USAGE_PERIOD_TYPE_WEEKLY: label('Weekly credit usage', '每周额度'),
    USAGE_PERIOD_TYPE_MONTHLY: label('Monthly credit usage', '每月额度'),
  }
  const name = names[row.label] ?? row.label
  // 只有范围、不含周期的名称（如 Codex 主、副窗口同名）补上周期。
  const scopeOnly = !names[row.label] || ['Codex', 'Code review', 'Kimi Code'].includes(row.label)
  return scopeOnly ? `${name} · ${quotaPeriodText(row, label)}` : name
}

/**
 * 按范围分组，组内按周期从短到长排列；余额类数据单独返回，不作为窗口展示。
 * 主额度组排在最前，其余组保持接口顺序。
 */
export function groupQuotaWindows(
  windows: readonly TokenPlanWindowUsage[],
  providerId: TokenPlanProviderId,
  label: Label,
): { groups: QuotaWindowGroup[]; balances: TokenPlanWindowUsage[] } {
  const groups = new Map<string, QuotaWindowGroup>()
  const balances: TokenPlanWindowUsage[] = []
  for (const row of windows) {
    if (row.kind === 'balance') {
      balances.push(row)
      continue
    }
    const key = rawScope(row, providerId)
    const group = groups.get(key) ?? { key, scope: key ? scopeText(key, label) : '', windows: [] }
    group.windows.push(row)
    groups.set(key, group)
  }
  const order = (row: TokenPlanWindowUsage): number => quotaPeriodMinutes(row) ?? Infinity
  const sorted = [...groups.values()].map((group) => ({
    ...group,
    windows: [...group.windows].sort((a, b) => order(a) - order(b)),
  }))
  return {
    groups: [...sorted.filter((group) => !group.key), ...sorted.filter((group) => group.key)],
    balances,
  }
}

export function quotaBalanceView(row: TokenPlanWindowUsage, label: Label): QuotaBalanceView {
  const money = row.unit === 'USD' || row.unit === 'CNY' ? { currency: row.unit } : {}
  const amount = (value: number | null): string => formatNumber(value, money)
  const pair = (): string =>
    row.limit !== null ? `${amount(row.used)} / ${amount(row.limit)}` : amount(row.used)
  const names: Record<string, string> = {
    'Account balance': label('Available balance', '可用余额'),
    'Recharge balance': label('Recharge balance', '充值余额'),
    'Granted balance': label('Granted balance', '赠送余额'),
  }
  const caption = names[row.label]
  if (caption)
    return {
      id: row.id,
      icon: row.label === 'Granted balance' ? 'redeem' : 'account_balance_wallet',
      caption,
      value: amount(row.remaining),
      title: [
        `${caption} (${row.unit})`,
        ...row.details.map(
          (detail) => `${names[detail.name] ?? detail.name} ${amount(detail.used)}`,
        ),
      ].join('\n'),
    }
  if (row.label === 'Credits')
    return {
      id: row.id,
      icon: 'toll',
      value: row.unlimited ? '∞' : amount(row.remaining),
      title: label('Credits', '积分'),
    }
  if (row.label === 'Extra usage')
    return { id: row.id, icon: 'add_card', value: pair(), title: label('Extra usage', '额外用量') }
  if (row.label === 'On-demand')
    return {
      id: row.id,
      icon: 'receipt_long',
      value: pair(),
      title: label('On-demand usage', '按量用量'),
    }
  if (row.label === 'Prepaid')
    return {
      id: row.id,
      icon: 'account_balance_wallet',
      value: amount(row.remaining),
      title: label('Prepaid balance', '预付余额'),
    }
  return {
    id: row.id,
    icon: 'account_balance_wallet',
    value: row.remaining !== null ? amount(row.remaining) : pair(),
    title: row.label,
  }
}

/** 紧凑的剩余时长，配合时钟图标显示，不再写“后重置”。 */
export function quotaResetShort(resetsAt: number | null, now: number, label: Label): string {
  if (!resetsAt) return ''
  if (resetsAt <= now) return label('Due', '待刷新')
  const minutes = Math.max(1, Math.ceil((resetsAt - now) / 60_000))
  const days = Math.floor(minutes / 1_440),
    hours = Math.floor((minutes % 1_440) / 60),
    rest = minutes % 60
  if (days)
    return hours
      ? label(`${days}d ${hours}h`, `${days}天${hours}时`)
      : label(`${days}d`, `${days}天`)
  if (hours)
    return rest
      ? label(`${hours}h ${rest}m`, `${hours}时${rest}分`)
      : label(`${hours}h`, `${hours}时`)
  return label(`${rest}m`, `${rest}分`)
}

/** 用后计时的窗口（如智谱 5 小时）未使用时接口不返回重置时间，满额且无时间视为尚未开始计时。 */
function quotaWindowNotStarted(row: TokenPlanWindowUsage): boolean {
  return !row.resetsAt && quotaPeriodMinutes(row) !== null && quotaRemainingPercent(row) === 100
}

/** 时钟图标旁的文字：剩余时长、尚未开始计时，或厂商未提供时间时的占位符。 */
export function quotaResetText(
  row: TokenPlanWindowUsage | null,
  now: number,
  label: Label,
): string {
  if (!row) return '—'
  return (
    quotaResetShort(row.resetsAt, now, label) ||
    (quotaWindowNotStarted(row) ? label('Not started', '未开始') : '—')
  )
}

/** 悬停提示：完整名称、剩余量与确切重置时间。 */
export function quotaWindowTooltip(
  row: TokenPlanWindowUsage,
  label: Label,
  lang: 'zh' | 'en',
): string {
  const lines = [quotaWindowTitle(row, label)]
  const percent = quotaRemainingPercent(row)
  if (!row.available) lines.push(label('Usage not returned', '厂商未返回用量'))
  else if (row.unlimited) lines.push(label('Unlimited', '不限量'))
  else if (percent !== null)
    lines.push(`${label('Remaining', '剩余')} ${formatNumber(percent, { percent: true })}`)
  if (row.remaining !== null && row.limit !== null)
    lines.push(
      `${formatNumber(row.remaining)} / ${formatNumber(row.limit)}${
        row.unit && row.unit !== 'tokens' ? ` ${quotaUnitBadge(row, label)}` : ''
      }`,
    )
  for (const detail of row.details) lines.push(`${detail.name} ${formatNumber(detail.used)}`)
  lines.push(
    row.resetsAt
      ? `${label('Resets at ', '重置时间 ')}${new Intl.DateTimeFormat(
          lang === 'zh' ? 'zh-CN' : 'en-US',
          { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' },
        ).format(row.resetsAt)}`
      : quotaWindowNotStarted(row)
        ? label('Timer starts on first use', '首次使用后开始计时')
        : label('Reset time not provided', '未提供重置时间'),
  )
  return lines.join('\n')
}
