import { createAccountFavoriteCache } from './account-favorite-cache'
import { createAccountFavoriteService, type AccountContext } from './account-favorites.service'
import { openDatabase } from './sqlite-storage.service'
import { getCachedAuthUser, loadAuthSession } from './auth.service'
import { authenticatedDesktopRequest, getAuthSession } from './desktop-api.service'
import { resolveDesktopApiUrl } from './runtime-config.service'
import { AccountRequestError } from './authenticated-request'
import type { AccountFavoritesState } from '../../shared/account-favorites'

export function createRuntimeAccountFavorites(changed: (state: AccountFavoritesState) => void) {
  const current = (): AccountContext | null => {
    const session = loadAuthSession(),
      user = getCachedAuthUser()
    return session && user ? { accountId: user.id, sessionId: session.sessionId } : null
  }
  return createAccountFavoriteService({
    resolveApi: resolveDesktopApiUrl,
    cache: createAccountFavoriteCache(openDatabase()),
    current,
    changed,
    async context() {
      const cached = current()
      if (cached) return cached
      const auth = await getAuthSession()
      if (auth.status === 'unavailable') throw new AccountRequestError('unavailable')
      return current()
    },
    request: (context, path, method) =>
      authenticatedDesktopRequest(context.sessionId, path, method),
  })
}
