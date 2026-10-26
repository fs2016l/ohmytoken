/** Full local date and 24-hour time, shared by saved observations in both languages. */
export function formatDateTime(timestamp: number | null | undefined): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return '—'
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return '—'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Age of the actual observation; a failed refresh must not make saved data look new. */
export function formatUpdatedAgo(
  timestamp: number | null | undefined,
  now: number,
  label: (en: string, zh: string) => string,
): string {
  if (timestamp == null || !Number.isFinite(timestamp) || !Number.isFinite(now)) return ''
  const seconds = Math.floor(Math.max(0, now - timestamp) / 1000)
  if (seconds < 1) return label('Updated just now', '刚刚更新')
  if (seconds < 60) return label(`Updated ${seconds}s ago`, `${seconds} 秒前更新`)
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return label(`Updated ${minutes}m ago`, `${minutes} 分钟前更新`)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return label(`Updated ${hours}h ago`, `${hours} 小时前更新`)
  const days = Math.floor(hours / 24)
  return label(`Updated ${days}d ago`, `${days} 天前更新`)
}
