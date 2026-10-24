import type { CSSProperties } from 'vue'
import { isRenewalColor } from '../../../shared/plan-renewals'

/** Keep preview and calendar text readable on the exact, opaque user color. */
export function renewalColorText(color: string | null | undefined): string {
  if (!isRenewalColor(color)) return 'var(--primary-on)'
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(color.slice(start, start + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
  return luminance > 0.179 ? '#000000' : '#ffffff'
}

export function renewalColorStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!isRenewalColor(color)) return undefined
  return {
    '--renewal-event-color': color,
    '--renewal-event-fill': color,
    '--renewal-event-text': renewalColorText(color),
    '--renewal-event-outline': 'var(--border)',
  }
}
