export const ACCOUNT_FAVORITE_TYPES = ['plan-tier', 'api-model', 'article', 'agent-tool'] as const
export type AccountFavoriteType = (typeof ACCOUNT_FAVORITE_TYPES)[number]
export interface AccountFavoriteTarget {
  targetType: AccountFavoriteType
  targetId: number
}
export interface AccountFavorite extends AccountFavoriteTarget {
  savedAt: string
  available: boolean
}
export type AccountFavoriteErrorCode =
  | 'unavailable'
  | 'unauthenticated'
  | 'session-changed'
  | 'not-found'
  | 'invalid-response'
  | 'forbidden'
export interface FailedAccountFavorite extends AccountFavoriteTarget {
  desired: boolean
  code: AccountFavoriteErrorCode
}
export interface AccountFavoritesState {
  accountId: number | null
  revision: number
  items: AccountFavorite[]
  syncedAt: number | null
  source: 'anonymous' | 'cache' | 'remote'
  failed: FailedAccountFavorite[]
  error?: AccountFavoriteErrorCode
}
export interface AccountFavoriteResult {
  ok: boolean
  state: AccountFavoritesState
  code?: AccountFavoriteErrorCode
}
export function accountFavoriteKey(target: AccountFavoriteTarget): string {
  return target.targetType + ':' + target.targetId
}
export function validateAccountFavoriteTarget(value: unknown): AccountFavoriteTarget {
  const target = value as Partial<AccountFavoriteTarget> | null
  if (
    !target ||
    !ACCOUNT_FAVORITE_TYPES.includes(target.targetType as AccountFavoriteType) ||
    !Number.isSafeInteger(target.targetId) ||
    (target.targetId ?? 0) <= 0
  )
    throw new Error('Invalid account favorite target')
  return { targetType: target.targetType!, targetId: target.targetId! }
}
export function parseAccountFavorite(value: unknown): AccountFavorite {
  const target = validateAccountFavoriteTarget(value)
  const item = value as AccountFavorite
  if (
    typeof item.savedAt !== 'string' ||
    item.savedAt.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T/.test(item.savedAt) ||
    typeof item.available !== 'boolean'
  )
    throw new Error('Invalid account favorite response')
  return { ...target, savedAt: item.savedAt, available: item.available }
}
