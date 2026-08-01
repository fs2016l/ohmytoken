/**
 * 日期工具（对应 Java ScannerUtils.DATE_FMT + StatsService 中的日期逻辑）
 * 所有日期格式化使用系统默认时区
 */

/**
 * 将 epoch 时间戳（毫秒或秒）格式化为 yyyy-MM-dd
 * 对应 Java ScannerUtils 各 Scanner 的 extractDate 逻辑
 */
export function formatDateFromEpoch(epoch: number): string {
  let ms: number
  if (epoch > 1_000_000_000_000) {
    ms = epoch // 已经是毫秒
  } else {
    ms = epoch * 1000 // 秒转毫秒
  }
  return formatDateFromMs(ms)
}

/** 将毫秒时间戳格式化为 yyyy-MM-dd（系统时区） */
export function formatDateFromMs(ms: number): string {
  if (ms <= 0) return 'unknown'
  const d = new Date(ms)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 将时间点格式化为系统时区的固定宽度日期时间。 */
export function formatLocalTimestampFromMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const d = new Date(ms)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const seconds = String(d.getSeconds()).padStart(2, '0')
  const millis = String(d.getMilliseconds()).padStart(3, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}`
}

/**
 * 将来源时间转换为系统时区。无时区字符串按本地时间解释，不会重复偏移；
 * 数字兼容 epoch 秒、毫秒、微秒与纳秒。
 */
export function localTimestampFromValue(
  value: string | number | bigint | null | undefined,
  fallbackDate = '',
): string {
  if (typeof value === 'string') {
    const localDate = /^(\d{4}-\d{2}-\d{2})$/.exec(value.trim())
    if (localDate) return `${localDate[1]}T00:00:00.000`
  }
  const epochMs = timestampEpochMs(value)
  if (epochMs > 0) return formatLocalTimestampFromMs(epochMs)
  return /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate) ? `${fallbackDate}T00:00:00.000` : ''
}

/** 判断字符串是否显式携带 UTC 或 offset；用于旧库迁移时识别可恢复的原始时间。 */
export function hasExplicitTimezone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())
}

export function timestampEpochMs(value: string | number | bigint | null | undefined): number {
  if (typeof value === 'number') return normalizeEpochMilliseconds(value)
  if (typeof value === 'bigint') return normalizeEpochMilliseconds(Number(value))
  if (typeof value !== 'string' || !value.trim()) return 0
  const trimmed = value.trim()
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return normalizeEpochMilliseconds(Number(trimmed))
  }
  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function normalizeEpochMilliseconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 100_000_000_000_000_000) return Math.trunc(value / 1_000_000)
  if (value >= 100_000_000_000_000) return Math.trunc(value / 1000)
  if (value < 100_000_000_000) return Math.trunc(value * 1000)
  return Math.trunc(value)
}

/**
 * 从 JSONL 行中提取日期
 * 对应 Java ClaudeCodeScanner.extractDate()
 * @param timestamp 顶层 timestamp（数字或字符串）
 * @param messageCreatedAt message.created_at（字符串回退）
 *
 * L7 修复：substring 后必须校验为合法 yyyy-MM-dd 格式，否则 fallthrough 到
 * messageCreatedAt 参数；都不匹配返回 'unknown'。
 * 旧实现对短字符串（如 "2024"）原样返回，会进入 stats 被静默过滤。
 */
export function extractDate(
  timestamp: number | string | undefined,
  messageCreatedAt: string | undefined,
): string {
  if (timestamp !== undefined && timestamp !== null) {
    if (typeof timestamp === 'number') {
      return formatDateFromEpoch(timestamp)
    }
    // 字符串：取前 10 个字符并校验为合法 yyyy-MM-dd，否则 fallthrough
    const str = String(timestamp)
    const candidate = str.substring(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
      return candidate
    }
    // timestamp 字符串不是合法日期格式，尝试 messageCreatedAt 回退
  }
  if (messageCreatedAt) {
    const candidate = messageCreatedAt.substring(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
      return candidate
    }
  }
  return 'unknown'
}

/** 当前日期 yyyy-MM-dd */
export function todayStr(): string {
  return formatDateFromMs(Date.now())
}

/** 当前月份 yyyy-MM */
export function currentMonthStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 本周一的日期 yyyy-MM-dd */
export function thisMondayStr(): string {
  const d = new Date()
  const day = d.getDay() // 0=Sunday, 1=Monday...
  const diff = day === 0 ? -6 : 1 - day // 回到周一
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return formatDateFromMs(d.getTime())
}

/** 本月1号的日期 yyyy-MM-dd */
export function thisMonthStartStr(): string {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return formatDateFromMs(d.getTime())
}

/** 昨天的日期 yyyy-MM-dd */
export function yesterdayStr(): string {
  return formatDateFromMs(Date.now() - 86400000)
}

/** 上周一的日期 yyyy-MM-dd */
export function lastMondayStr(): string {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff - 7)
  d.setHours(0, 0, 0, 0)
  return formatDateFromMs(d.getTime())
}

/** 上周今天对应日（today - 7天，作为"上周同期"右边界，保证与本周天数对等） */
export function lastWeekSameDayStr(): string {
  return formatDateFromMs(Date.now() - 7 * 86400000)
}

/** 上周日的日期 yyyy-MM-dd */
export function lastSundayStr(): string {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff - 1)
  d.setHours(0, 0, 0, 0)
  return formatDateFromMs(d.getTime())
}

/** 上月1号的日期 yyyy-MM-dd */
export function lastMonthStartStr(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return formatDateFromMs(d.getTime())
}

/** 上月最后一天的日期 yyyy-MM-dd */
export function lastMonthEndStr(): string {
  const d = new Date()
  d.setDate(1) // 本月1号
  d.setHours(0, 0, 0, 0)
  d.setDate(0) // 上月最后一天
  return formatDateFromMs(d.getTime())
}

/** 上月同一天（夹在上月1号和上月末尾之间） */
export function lastMonthSameDayStr(): string {
  const d = new Date()
  const dayOfMonth = d.getDate()
  const lastMonthEnd = new Date()
  lastMonthEnd.setDate(1)
  lastMonthEnd.setHours(0, 0, 0, 0)
  lastMonthEnd.setDate(0) // 上月最后一天
  const clampedDay = Math.min(dayOfMonth, lastMonthEnd.getDate())
  lastMonthEnd.setDate(clampedDay)
  return formatDateFromMs(lastMonthEnd.getTime())
}

/** ISO 本地日期时间（对应 Java LocalDateTime.now().format(ISO_LOCAL_DATE_TIME)） */
export function isoLocalDateTime(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const seconds = String(d.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
}

/** 验证日期字符串格式 \d{4}-\d{2}-\d{2} */
export function isValidDateStr(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/**
 * 日期范围过滤（对应 Java getRecordsByDateRange 的 String.compareTo 逻辑）
 * 使用字符串字典序比较（ISO 日期格式天然支持）
 */
export function isInRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to
}

/** 环比变化百分比（对应 Java Math.round((cur-prev)*1000/prev)/10.0） */
export function calcChange(current: number, previous: number): number {
  if (previous === 0) return 0
  return Math.round(((current - previous) * 1000) / previous) / 10
}
