import type { TokenPlanErrorCode } from '../../shared/token-plan'

export class QuotaQueryError extends Error {
  readonly code: TokenPlanErrorCode
  readonly retryAt: number | null
  constructor(code: TokenPlanErrorCode, retryAt: number | null = null) {
    super(code)
    this.code = code
    this.retryAt = retryAt
  }
}

export function isQuotaRegionError(code: TokenPlanErrorCode): boolean {
  return code === 'region_restricted' || code === 'region_unknown'
}
