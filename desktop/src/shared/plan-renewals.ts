import type { TokenPlanProviderId } from './token-plan'

export type RenewalCycle = 'monthly' | 'quarterly' | 'yearly' | 'custom'
export interface PlanRenewalInput {
  id?: string
  name: string
  providerId: TokenPlanProviderId | 'other'
  renewOn: string
  cycle: RenewalCycle
  intervalDays: number | null
  notes: string
  color?: string | null
}
export interface PlanRenewal extends PlanRenewalInput {
  id: string
  anchorOn: string
  position: number
  createdAt: number
  color: string | null
}
export interface PlanRenewalOccurrence {
  renewal: PlanRenewal
  date: string
}
export interface PlanRenewalsAPI {
  planRenewalsList(): Promise<PlanRenewal[]>
  planRenewalsSave(input: PlanRenewalInput): Promise<PlanRenewal[]>
  planRenewalsDelete(id: string): Promise<PlanRenewal[]>
  planRenewalsReorder(ids: string[]): Promise<PlanRenewal[]>
  planRenewalsComplete(id: string, renewOn: string): Promise<PlanRenewal[]>
}

/** Only opaque hex colors are accepted for user-controlled calendar styling. */
export function isRenewalColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
}

/** Date-only values use UTC for arithmetic, never for deciding the user's local today. */
export function parseRenewalDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1000 || year > 9999) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.toISOString().slice(0, 10) === value ? date : null
}

export function localRenewalDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function renewalDaysUntil(renewOn: string, today: string): number {
  const date = parseRenewalDate(renewOn),
    from = parseRenewalDate(today)
  return date && from ? (date.getTime() - from.getTime()) / 86_400_000 : NaN
}

export type RenewalStatus = 'overdue' | 'soon' | 'upcoming'
export function renewalStatus(renewOn: string, today: string): RenewalStatus {
  const days = renewalDaysUntil(renewOn, today)
  return days < 0 ? 'overdue' : days <= 7 ? 'soon' : 'upcoming'
}

export function renewalIsPending(renewOn: string, today: string): boolean {
  return renewalDaysUntil(renewOn, today) <= 0
}

/** Complete Monday-first weeks, including adjacent-month dates. */
export function renewalMonthDates(month: string): string[] {
  const first = parseRenewalDate(`${month}-01`)
  if (!first) return []
  const year = first.getUTCFullYear(),
    index = first.getUTCMonth()
  const offset = (first.getUTCDay() + 6) % 7
  const length = new Date(Date.UTC(year, index + 1, 0)).getUTCDate()
  return Array.from({ length: Math.ceil((length + offset) / 7) * 7 }, (_, day) =>
    new Date(Date.UTC(year, index, 1 - offset + day)).toISOString().slice(0, 10),
  )
}

type RenewalSchedule = PlanRenewalInput & { anchorOn?: string }

/** Fraction of the billing cycle still remaining, using calendar days rather than elapsed hours. */
export function renewalCountdown(
  item: RenewalSchedule,
  today: string,
): { days: number; fraction: number } | null {
  const due = parseRenewalDate(item.renewOn),
    anchor = parseRenewalDate(item.anchorOn ?? item.renewOn)
  const days = renewalDaysUntil(item.renewOn, today)
  if (!due || !anchor || !Number.isFinite(days)) return null
  let duration: number
  if (item.cycle === 'custom') {
    if (!Number.isInteger(item.intervalDays) || item.intervalDays! < 1 || item.intervalDays! > 3650)
      return null
    duration = item.intervalDays!
  } else {
    const period = { monthly: 1, quarterly: 3, yearly: 12 }[item.cycle]
    if (!period) return null
    const month = due.getUTCFullYear() * 12 + due.getUTCMonth() - period
    const year = Math.floor(month / 12),
      index = month % 12
    const day = Math.min(anchor.getUTCDate(), new Date(Date.UTC(year, index + 1, 0)).getUTCDate())
    duration = (due.getTime() - Date.UTC(year, index, day)) / 86_400_000
  }
  return { days, fraction: Math.max(0, Math.min(1, days / duration)) }
}

function* occurrenceDates(item: RenewalSchedule, from: string, to: string): Generator<string> {
  const anchor = parseRenewalDate(item.anchorOn ?? item.renewOn),
    requestedStart = parseRenewalDate(from),
    start = parseRenewalDate(from > item.renewOn ? from : item.renewOn),
    end = parseRenewalDate(to)
  if (!anchor || !requestedStart || !start || !end || from > to || item.renewOn > to) return
  if (item.cycle === 'custom') {
    if (!Number.isInteger(item.intervalDays) || item.intervalDays! < 1 || item.intervalDays! > 3650)
      return
    const step = item.intervalDays! * 86_400_000
    const first =
      anchor.getTime() + Math.max(0, Math.ceil((start.getTime() - anchor.getTime()) / step)) * step
    for (let time = first; time <= end.getTime(); time += step)
      yield new Date(time).toISOString().slice(0, 10)
    return
  }
  const period = { monthly: 1, quarterly: 3, yearly: 12 }[item.cycle]
  if (!period) return
  const anchorMonth = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth()
  const startMonth = start.getUTCFullYear() * 12 + start.getUTCMonth()
  const endMonth = end.getUTCFullYear() * 12 + end.getUTCMonth()
  const firstMonth =
    anchorMonth + Math.max(0, Math.floor((startMonth - anchorMonth) / period)) * period
  for (let month = firstMonth; month <= endMonth; month += period) {
    const year = Math.floor(month / 12),
      index = month % 12
    const day = Math.min(anchor.getUTCDate(), new Date(Date.UTC(year, index + 1, 0)).getUTCDate())
    const date = new Date(Date.UTC(year, index, day)).toISOString().slice(0, 10)
    if (date >= from && date >= item.renewOn && date <= to) yield date
  }
}

/** Paid dates disappear; future occurrences retain the original billing day, including month ends. */
export function renewalOccurrenceDates(item: RenewalSchedule, from: string, to: string): string[] {
  return [...occurrenceDates(item, from, to)]
}

/** Skip overdue periods and return the first scheduled date strictly after the completed due date/today. */
export function nextRenewalDate(item: RenewalSchedule, today: string): string | null {
  if (!parseRenewalDate(today) || !parseRenewalDate(item.renewOn)) return null
  const after = parseRenewalDate(today > item.renewOn ? today : item.renewOn)
  if (!after || after.getTime() >= Date.UTC(9999, 11, 31)) return null
  after.setUTCDate(after.getUTCDate() + 1)
  return occurrenceDates(item, after.toISOString().slice(0, 10), '9999-12-31').next().value ?? null
}

/** Moving visible rows retains hidden records in the user's saved order. */
export function moveRenewalOrder(
  ids: string[],
  source: string,
  target: string,
  position: 'before' | 'after',
): string[] {
  if (source === target || !ids.includes(source) || !ids.includes(target)) return ids
  const next = ids.filter((id) => id !== source)
  next.splice(next.indexOf(target) + (position === 'after' ? 1 : 0), 0, source)
  return next
}
