import type { NetworkIssue } from '../../shared/network-check'

export interface ProbeResponse {
  url: string
  destination: string
  statusCode: number | null
  headers: Record<string, string>
  body: string
  truncated: boolean
  redirectStopped: boolean
  elapsedMs: number
  route: 'direct' | 'proxy' | 'unknown'
  issue: NetworkIssue | null
  observedAt?: number
  retryAt?: number
}

export type NetworkFetcher = (url: string, signal: AbortSignal) => Promise<ProbeResponse>

export function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function parseObject(body: string): Record<string, unknown> {
  try {
    return jsonObject(JSON.parse(body))
  } catch {
    return {}
  }
}

export function textField(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().slice(0, 180)
  return text && text !== 'null' ? text : null
}

export function booleanField(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

export function requestIssue(response: ProbeResponse): NetworkIssue | null {
  if (response.issue) return response.issue
  if (response.statusCode === 429) return 'rate_limited'
  if (response.statusCode === 401) return 'authentication'
  if (response.statusCode === null || response.statusCode < 200 || response.statusCode >= 300)
    return 'unavailable'
  return null
}
