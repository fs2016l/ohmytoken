import type { TokenPlanConnection, TokenPlanDiscoveryIssue } from '../../shared/token-plan'

export type JsonObject = Record<string, unknown>

export interface DiscoveredConnection {
  public: TokenPlanConnection
  token: string
  fingerprint: string
  accountId?: string
  organizationId?: string
  projectId?: string
  expiresAt?: number
  tierHint?: string
  quotaIdentity?: string
  credentials?: DiscoveredConnection[]
}

export interface DiscoveryResult {
  connections: DiscoveredConnection[]
  checkedSources: string[]
  issues: TokenPlanDiscoveryIssue[]
}

export function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

export function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function numberValue(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

export function timestamp(value: unknown): number | null {
  if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value)) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  const number = numberValue(value)
  if (number === null || number <= 0) return null
  const result = number < 10_000_000_000 ? number * 1000 : number
  return result <= 8_640_000_000_000_000 ? result : null
}

export function percentage(value: unknown): number | null {
  const result = numberValue(value)
  return result !== null && result <= 100 ? result : null
}

export function jwtClaims(token: string): JsonObject {
  try {
    const segment = token.split('.')[1]
    return segment && segment.length < 32_768
      ? object(JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')))
      : {}
  } catch {
    return {}
  }
}
