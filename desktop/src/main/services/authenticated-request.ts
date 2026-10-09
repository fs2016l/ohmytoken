import type { AccountFavoriteErrorCode } from '../../shared/account-favorites'

export class AccountRequestError extends Error {
  readonly code: AccountFavoriteErrorCode
  constructor(code: AccountFavoriteErrorCode) {
    super(code)
    this.code = code
  }
}
export interface AuthenticatedRequestDependencies {
  sessionId(): string | null
  token(refresh: boolean): Promise<string | null>
  send(path: string, method: 'GET' | 'PUT' | 'DELETE', token: string): Promise<Response>
}
/** A retry stays bound to the login session that initiated it, even if the user signs in elsewhere. */
export function createAuthenticatedRequest(deps: AuthenticatedRequestDependencies) {
  return async function request<T>(
    sessionId: string,
    path: string,
    method: 'GET' | 'PUT' | 'DELETE',
  ): Promise<T> {
    const check = (): void => {
      if (deps.sessionId() !== sessionId) throw new AccountRequestError('session-changed')
    }
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        check()
        const token = await deps.token(attempt === 1)
        check()
        if (!token) throw new AccountRequestError('unauthenticated')
        const response = await deps.send(path, method, token)
        check()
        let body: { code?: number; data?: T }
        try {
          body = (await response.json()) as typeof body
        } catch {
          throw new AccountRequestError('invalid-response')
        }
        check()
        if (response.status === 401 || body.code === 401) {
          if (attempt === 0) continue
          throw new AccountRequestError('unauthenticated')
        }
        if (response.status === 403 || body.code === 403) throw new AccountRequestError('forbidden')
        if (response.status === 404 || body.code === 404) throw new AccountRequestError('not-found')
        if (!response.ok || body.code !== 200) throw new AccountRequestError('unavailable')
        return body.data as T
      }
      throw new AccountRequestError('unauthenticated')
    } catch (error) {
      if (error instanceof AccountRequestError) throw error
      throw new AccountRequestError('unavailable')
    }
  }
}
