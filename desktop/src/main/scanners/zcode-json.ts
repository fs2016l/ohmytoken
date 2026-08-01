/** Z Code message.data 的小型 JSON 读取工具。 */

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return isObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function readJsonObject(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = source[key]
  return isObject(value) ? value : {}
}

export function readJsonString(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  if (typeof value === 'string') return value
  if (isObject(value) && typeof value.id === 'string') return value.id
  return ''
}

export function readJsonToken(source: Record<string, unknown>, key: string): number {
  const value = source[key]
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value))
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
  }
  return 0
}

export function readJsonTimestamp(
  source: Record<string, unknown>,
  path: string[],
): number | string | bigint | null {
  let current: unknown = source
  for (const key of path) {
    if (!isObject(current)) return null
    current = current[key]
  }
  if (typeof current === 'number' && Number.isFinite(current) && current > 0) return current
  if (typeof current === 'bigint' && current > 0n) return current
  if (typeof current === 'string' && current.trim()) return current
  return null
}

export function parseZCodeModel(value: unknown): string {
  const raw =
    typeof value === 'string'
      ? value.trim()
      : typeof value === 'number' || typeof value === 'bigint'
        ? String(value)
        : ''
  if (!raw) return 'unknown'
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isObject(parsed) && typeof parsed.id === 'string') return parsed.id
  } catch {
    // 旧 schema 也可能直接保存模型名。
  }
  return raw
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
