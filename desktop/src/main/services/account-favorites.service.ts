import type {
  AccountFavorite,
  AccountFavoriteResult,
  AccountFavoritesState,
  AccountFavoriteErrorCode,
  FailedAccountFavorite,
} from '../../shared/account-favorites'
import {
  accountFavoriteKey,
  parseAccountFavorite,
  validateAccountFavoriteTarget,
} from '../../shared/account-favorites'
import { AccountRequestError } from './authenticated-request'
import type { createAccountFavoriteCache } from './account-favorite-cache'

export interface AccountContext {
  accountId: number
  sessionId: string
}
interface Dependencies {
  resolveApi(
    key: 'favorites' | 'favorite',
    parameters?: Record<string, string | number>,
  ): Promise<string>
  context(): Promise<AccountContext | null>
  current(): AccountContext | null
  request<T>(context: AccountContext, path: string, method: 'GET' | 'PUT' | 'DELETE'): Promise<T>
  cache: ReturnType<typeof createAccountFavoriteCache>
  changed?(state: AccountFavoritesState): void
}
interface Page {
  list: unknown[]
  total: number
  pageNum: number
  pageSize: number
  pages: number
}
const errorCode = (error: unknown): AccountFavoriteErrorCode =>
  error instanceof AccountRequestError ? error.code : 'unavailable'

export function createAccountFavoriteService(deps: Dependencies) {
  let revision = 0,
    tail: Promise<unknown> = Promise.resolve()
  const failures = new Map<number, Map<string, FailedAccountFavorite>>()
  function check(context: AccountContext): void {
    const current = deps.current()
    if (current?.sessionId !== context.sessionId || current.accountId !== context.accountId)
      throw new AccountRequestError('session-changed')
  }
  function snapshot(
    source: 'cache' | 'remote' = 'cache',
    error?: AccountFavoriteErrorCode,
  ): AccountFavoritesState {
    const current = deps.current()
    if (!current)
      return {
        accountId: null,
        revision: ++revision,
        items: [],
        syncedAt: null,
        source: 'anonymous',
        failed: [],
        error,
      }
    return {
      accountId: current.accountId,
      revision: ++revision,
      ...deps.cache.read(current.accountId),
      source,
      error,
      failed: [...(failures.get(current.accountId)?.values() || [])],
    }
  }
  function publish(
    source: 'cache' | 'remote',
    error?: AccountFavoriteErrorCode,
  ): AccountFavoritesState {
    const state = snapshot(source, error)
    deps.changed?.(state)
    return state
  }
  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const task = tail.then(run)
    tail = task.catch(() => {})
    return task
  }
  async function list(refresh = false): Promise<AccountFavoritesState> {
    let context: AccountContext | null
    try {
      context = await deps.context()
    } catch (error) {
      return snapshot('cache', errorCode(error))
    }
    if (!context) return snapshot()
    if (!refresh) return snapshot()
    return enqueue(async () => {
      try {
        check(context)
        const items = new Map<string, AccountFavorite>()
        let total: number | undefined
        for (let number = 1; number <= 100; number++) {
          check(context)
          const page = await deps.request<Page>(
            context,
            (await deps.resolveApi('favorites')) + `?pageNum=${number}&pageSize=100`,
            'GET',
          )
          check(context)
          if (
            !page ||
            !Array.isArray(page.list) ||
            page.list.length > 100 ||
            page.pageNum !== number ||
            !Number.isSafeInteger(page.total) ||
            page.total < 0 ||
            page.total > 10000 ||
            (total !== undefined && total !== page.total)
          )
            throw new AccountRequestError('invalid-response')
          total = page.total
          for (const value of page.list) {
            let item: AccountFavorite
            try {
              item = parseAccountFavorite(value)
            } catch {
              throw new AccountRequestError('invalid-response')
            }
            const key = accountFavoriteKey(item)
            if (items.has(key)) throw new AccountRequestError('invalid-response')
            items.set(key, item)
          }
          if (items.size === total) break
          if (page.list.length !== 100 || items.size > total)
            throw new AccountRequestError('invalid-response')
        }
        if (items.size !== total) throw new AccountRequestError('invalid-response')
        check(context)
        deps.cache.replace(context.accountId, [...items.values()], Date.now())
        for (const [key, failed] of failures.get(context.accountId) || [])
          if (items.has(key) === failed.desired) failures.get(context.accountId)?.delete(key)
        return publish('remote')
      } catch (error) {
        return publish('cache', errorCode(error))
      }
    })
  }
  async function set(input: unknown, desired: boolean): Promise<AccountFavoriteResult> {
    const target = validateAccountFavoriteTarget(input)
    if (typeof desired !== 'boolean') throw new Error('Invalid favorite value')
    let context: AccountContext | null
    try {
      context = await deps.context()
    } catch (error) {
      const code = errorCode(error)
      return { ok: false, state: snapshot('cache', code), code }
    }
    if (!context) return { ok: false, state: snapshot(), code: 'unauthenticated' }
    const expected = context
    return enqueue(async () => {
      try {
        check(expected)
        const path = await deps.resolveApi('favorite', {
          targetType: target.targetType,
          targetId: target.targetId,
        })
        check(expected)
        const response = await deps.request<unknown>(expected, path, desired ? 'PUT' : 'DELETE')
        check(expected)
        if (desired) {
          let item: AccountFavorite
          try {
            item = parseAccountFavorite(response)
          } catch {
            throw new AccountRequestError('invalid-response')
          }
          if (accountFavoriteKey(item) !== accountFavoriteKey(target))
            throw new AccountRequestError('invalid-response')
          deps.cache.put(expected.accountId, item)
        } else deps.cache.remove(expected.accountId, target)
        failures.get(expected.accountId)?.delete(accountFavoriteKey(target))
        return { ok: true, state: publish('cache') }
      } catch (error) {
        const code = errorCode(error)
        if (code !== 'session-changed') {
          const failed =
            failures.get(expected.accountId) || new Map<string, FailedAccountFavorite>()
          failed.set(accountFavoriteKey(target), { ...target, desired, code })
          while (failed.size > 100) failed.delete(failed.keys().next().value!)
          failures.set(expected.accountId, failed)
        }
        return { ok: false, state: publish('cache', code), code }
      }
    })
  }
  return { list, set }
}
