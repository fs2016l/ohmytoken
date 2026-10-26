export const RENEWAL_TIME_ZONES = ['Asia/Shanghai', 'America/Los_Angeles', 'Europe/London'] as const
export type RenewalTimeZone = (typeof RENEWAL_TIME_ZONES)[number]
export const DEFAULT_RENEWAL_TIME_ZONE: RenewalTimeZone = 'Asia/Shanghai'

export function isRenewalTimeZone(value: unknown): value is RenewalTimeZone {
  return typeof value === 'string' && RENEWAL_TIME_ZONES.some((zone) => zone === value)
}
export function isRenewalTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

const formatters = new Map<RenewalTimeZone, Intl.DateTimeFormat>()
function zonedParts(timestamp: number, timeZone: RenewalTimeZone): Record<string, number> {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, formatter)
  }
  return Object.fromEntries(
    formatter
      .formatToParts(timestamp)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
}
function wallTimestamp(parts: Record<string, number>): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
}

/** Resolve a local wall time with IANA rules; overlaps use the first occurrence, gaps move forward. */
export function renewalTimestamp(
  date: string,
  time: string,
  timeZone: RenewalTimeZone,
): number | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number(date.slice(0, 4)) < 1000 ||
    !isRenewalTime(time) ||
    !isRenewalTimeZone(timeZone)
  )
    return null
  const target = Date.parse(`${date}T${time}:00Z`)
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date) return null
  const offsets = new Set(
    [-86400000, 0, 86400000].map((delta) => {
      const sample = target + delta
      return wallTimestamp(zonedParts(sample, timeZone)) - sample
    }),
  )
  const candidates = [...offsets].map((offset) => {
    const timestamp = target - offset
    return { timestamp, local: wallTimestamp(zonedParts(timestamp, timeZone)) }
  })
  const exact = candidates
    .filter((candidate) => candidate.local === target)
    .sort((a, b) => a.timestamp - b.timestamp)[0]
  return (
    exact?.timestamp ??
    candidates.filter((candidate) => candidate.local > target).sort((a, b) => a.local - b.local)[0]
      ?.timestamp ??
    null
  )
}

export interface RenewalDateTime {
  renewOn: string
  renewTime?: string
  timeZone?: RenewalTimeZone
}
export function renewalDisplayDateTime(
  item: RenewalDateTime,
  displayZone: RenewalTimeZone,
): {
  date: string
  time: string
} {
  const sourceZone = item.timeZone ?? DEFAULT_RENEWAL_TIME_ZONE
  const time = item.renewTime ?? '00:00'
  const timestamp = renewalTimestamp(item.renewOn, time, sourceZone)
  if (timestamp === null) return { date: item.renewOn, time }
  const parts = zonedParts(timestamp, displayZone)
  const two = (value: number): string => String(value).padStart(2, '0')
  return {
    date: `${String(parts.year).padStart(4, '0')}-${two(parts.month)}-${two(parts.day)}`,
    time: `${two(parts.hour)}:${two(parts.minute)}`,
  }
}
