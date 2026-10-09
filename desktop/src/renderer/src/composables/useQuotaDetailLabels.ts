import { useI18n } from '../i18n/useI18n'
import type { QuotaMetric } from '../../../shared/quota-details'

const names: Record<string, [string, string]> = {
  'codex-activity': ['Codex account activity', 'Codex 官方账户活动'],
  'codex-analytics': ['Codex text usage and activity', 'Codex 文本用量与活动明细'],
  'codex-distribution': ['Codex quota consumption', 'Codex 额度消耗分布'],
  'glm-models': ['GLM model usage', 'GLM 模型用量'],
  'glm-tools': ['GLM tool usage', 'GLM 工具用量'],
  'minimax-billing': ['MiniMax billing records', 'MiniMax 账单记录'],
  'claude-extra': ['Claude extra usage', 'Claude 额外用量'],
  'gemini-account': ['Gemini model quotas', 'Gemini 模型额度详情'],
  'grok-billing': ['Grok billing periods', 'Grok 历史账期'],
  'grok-settings': ['Grok subscription', 'Grok 订阅信息'],
  total: ['Tokens', 'Token 总量'],
  input: ['Input', '输入'],
  uncachedInput: ['Uncached input', '未缓存输入'],
  cacheRead: ['Cache read', '缓存读取'],
  output: ['Output', '输出'],
  turns: ['Turns', '对话次数'],
  threads: ['Tasks', '任务数'],
  credits: ['Credits', '积分'],
  requests: ['Requests', '调用次数'],
  lifetime: ['Lifetime tokens', '累计 Token'],
  peakDay: ['Peak daily tokens', '单日最高 Token'],
  currentStreak: ['Current streak', '连续使用天数'],
  longestStreak: ['Longest streak', '最长连续天数'],
  longestTurn: ['Longest turn', '最长单轮时长'],
  fastMode: ['Fast mode usage', '快速模式占比'],
  skillsUsed: ['Skill invocations', '技能调用次数'],
  uniqueSkills: ['Unique skills', '使用的技能数'],
  reasoningEffort: ['Most used reasoning effort', '最常用推理强度'],
  invocations: ['Invocations', '调用次数'],
  cumulative: ['Cumulative tokens', '截至当日累计 Token'],
  usage: ['Usage', '已用比例'],
  billed: ['Billed amount', '实际计费'],
  beforeVoucher: ['Before voucher', '抵扣前金额'],
  rawQuantity: ['Provider quantity', '厂商原始数量'],
  enabled: ['Enabled (1/0)', '已启用（1/0）'],
  usedCredits: ['Used credits', '已用积分'],
  monthlyLimit: ['Monthly limit', '月度上限'],
  remaining: ['Remaining', '剩余数量'],
  remainingRatio: ['Remaining ratio', '剩余比例'],
  included: ['Included usage', '套餐内用量金额'],
  onDemand: ['On-demand usage', '按量金额'],
  prepaid: ['Prepaid balance', '预付余额'],
  unifiedBilling: ['Shared billing (1/0)', '共享计费（1/0）'],
  onDemandEnabled: ['On-demand enabled (1/0)', '按量已启用（1/0）'],
  model: ['Model', '模型'],
  client: ['Client', '客户端'],
  tool: ['Tool', '工具'],
  tier: ['Plan', '套餐'],
  purchase: ['Purchase', '套餐购买'],
  textApi: ['Text API', '文本 API'],
  other: ['Other', '其他业务'],
  billing: ['Billing', '账期'],
  not_connected: ['Connection changed; detect again.', '连接已变更，请重新检测。'],
  expired: [
    'The source Agent sign-in needs refreshing. Sign in to the source Agent and complete one conversation, then refresh quota.',
    '原 Agent 的登录凭据需要续期。请在原 Agent 中登录并完成一次对话后，再刷新额度。',
  ],
  invalid_credential: [
    'The provider rejected this credential. Sign in to the source Agent and complete one conversation, then refresh quota.',
    '厂商拒绝了该凭据。请在原 Agent 中登录并完成一次对话后，再刷新额度。',
  ],
  permission_denied: ['This connection cannot read this data.', '该连接没有读取此数据的权限。'],
  unsupported: ['This connection has no supported data source.', '当前连接没有可用的数据接口。'],
  rate_limited: ['Provider rate limit; retry later.', '厂商限制了查询频率，请稍后刷新。'],
  provider_unavailable: ['Provider temporarily unavailable.', '厂商服务暂时不可用。'],
  invalid_response: ['Unrecognized response.', '返回数据格式无法可靠解释。'],
  network_error: ['Network request failed.', '网络请求失败。'],
  region_restricted: [
    'The current region is restricted. Refresh has been stopped for safety.',
    '当前区域受限，为安全考虑，已停止刷新。',
  ],
  region_unknown: [
    'Unable to confirm the current network region. Refresh has been stopped for safety.',
    '无法确认当前网络区域，为安全考虑，已停止刷新。',
  ],
}
const notes: Record<string, [string, string]> = {
  providerDates: [
    'Dates follow the provider buckets; the API does not declare its time zone.',
    '日期沿用厂商分桶，接口未声明时区。',
  ],
  separateTotals: [
    'Official account data is shown separately from local scans; totals are not added together.',
    '官方账户数据独立展示，不与本地扫描结果相加。',
  ],
  textTokens: [
    'Text token components can differ from account activity totals.',
    '此处为文本 Token 口径，可能与账户活动总量不同。',
  ],
  modelActivityOnly: [
    'Model rows contain activity and credits; model token counts are shown only when returned.',
    '模型行展示活动与积分；仅在接口实际返回时展示模型 Token。',
  ],
  quotaPercent: [
    'These percentages measure quota consumption, not token counts.',
    '这里是额度消耗百分比，不是 Token 数量。',
  ],
  latestRecords: [
    'Latest records, paged independently of the selected date range. Only loaded pages are shown.',
    '按最近记录分页，不受上方日期筛选影响；当前仅展示已加载页。',
  ],
  minimaxCoverage: [
    'Billing includes purchases, resource packages and text API usage; it is not a complete Token Plan history.',
    '账单包含购买、资源包和文本 API 等业务，不代表完整的 Token Plan 历史。',
  ],
  claudeNoHistory: [
    'Personal OAuth provides current extra usage; it does not provide daily account history.',
    '个人 OAuth 提供当前额外用量，未提供账户每日历史。',
  ],
  claudeCreditUnits: [
    'Credit fields are kept in the provider’s original units.',
    '积分字段保留厂商返回的原始单位。',
  ],
  geminiNoHistory: [
    'Remaining model quotas and reset times; daily account history is not provided.',
    '展示各模型剩余额度与重置时间，未提供账户每日历史。',
  ],
  grokBillingOnly: [
    'Returned historical billing periods, independent of the date filter; these amounts are not token counts.',
    '展示接口返回的历史账期，不受日期筛选影响；金额不换算为 Token。',
  ],
  truncated: [
    'The response exceeded the display limit. Narrow the date range.',
    '返回内容超过展示上限，请缩小日期范围。',
  ],
}
export function useQuotaDetailLabels() {
  const { label, currentLang } = useI18n()
  const name = (key: string): string => (names[key] ? label(...names[key]) : key)
  const note = (key: string): string => (notes[key] ? label(...notes[key]) : key)
  const format = (metric: QuotaMetric): string => {
    const value = metric.unit === 'ratio' ? metric.value * 100 : metric.value
    const text = value.toLocaleString(currentLang.value === 'zh' ? 'zh-CN' : 'en-US', {
      maximumFractionDigits: ['ratio', 'USD', 'CNY'].includes(metric.unit) ? 6 : 2,
    })
    const units: Record<string, string> = {
      percent: '%',
      ratio: '%',
      tokens: 'Token',
      requests: label('calls', '次'),
      turns: label('turns', '次'),
      threads: label('tasks', '个'),
      days: label('days', '天'),
      seconds: 's',
      count: '',
      credits: label('credits', '积分'),
      unknown: label('(unit unspecified)', '（单位未确认）'),
    }
    return `${text}${['ratio', 'percent'].includes(metric.unit) ? '' : ' '}${units[metric.unit] ?? metric.unit}`.trim()
  }
  return { name, note, format }
}
