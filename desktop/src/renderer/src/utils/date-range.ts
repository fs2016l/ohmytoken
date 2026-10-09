import { subDays, subMonths } from 'date-fns'
import { validDate } from '@shared/calendar-date'

export type DatePreset = 'today' | 'week' | 'month' | 'all' | 'custom'
export type DateRange = { from: string; to: string; preset: DatePreset }
export type QuickDateRange = '15days' | '3months' | '6months' | 'year'

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function presetRange(preset: DatePreset, now = new Date()): DateRange {
  if (preset === 'all') return { from: '', to: '', preset }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (preset === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  if (preset === 'month') start.setDate(1)
  return { from: localDate(start), to: localDate(now), preset }
}

/** Roll only a relative preset whose displayed dates still match that preset. */
export function rollDateRange(range: DateRange, now = new Date()): DateRange {
  const { preset, from, to } = range
  if ((preset !== 'today' && preset !== 'week' && preset !== 'month') || !validDate(to))
    return range
  const previous = presetRange(preset, new Date(`${to}T12:00:00`))
  if (from !== previous.from || to !== previous.to) return range
  const current = presetRange(preset, now)
  return from === current.from && to === current.to ? range : current
}

/** Preset whose current range equals from..to exactly; 'custom' when none does. */
export function matchPreset(from: string, to: string, now = new Date()): DatePreset {
  for (const preset of ['today', 'week', 'month'] as const) {
    const range = presetRange(preset, now)
    if (range.from === from && range.to === to) return preset
  }
  return 'custom'
}

/** Rolling calendar periods; the 15-day range includes today. Month ends are clamped. */
export function quickDateRange(preset: QuickDateRange, now = new Date()): DateRange {
  const start =
    preset === '15days'
      ? subDays(now, 14)
      : subMonths(now, preset === '3months' ? 3 : preset === '6months' ? 6 : 12)
  return { from: localDate(start), to: localDate(now), preset: 'custom' }
}

export function parseDateInput(value: string): string | null {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value.trim())
  if (!match) return null
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  return validDate(date) ? date : null
}

export function displayTimestamp(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return `${localDate(date).replaceAll('-', '/')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Recent activity uses the user's local day/year, not the timestamp's UTC date. */
export function displayRecentActivity(value: string, now = new Date()): string {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  if (localDate(date) === localDate(now)) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  const day = localDate(date).replaceAll('-', '/')
  return date.getFullYear() === now.getFullYear() ? day.slice(5) : day
}
