import type {
  AuthActionResult,
  AuthSessionResult,
  DesktopFeedbackSubmitParams,
  DesktopMessageEventInput,
  DesktopMessageSyncResult,
  DesktopHeartbeatResult,
  DesktopUserInfo,
} from '../../shared/desktop-api'
import { agentIdentityHeaders, DEVICE_CREDENTIAL_INVALID_CODE } from '../../shared/agent-client'
import type { UpdateInfo } from '../../shared/updater'
import {
  forceRefreshAccessToken,
  getAccessToken,
  hasAuthSession,
  loadAuthSession,
  getCachedAuthUser,
  rememberAuthUser,
} from './auth.service'
import {
  ensureAgentClientRegistered,
  resolveRefreshedAgentRequestIdentity,
} from './client-registration.service'
import { resolveDesktopApiUrl } from './runtime-config.service'
import { createAuthenticatedRequest } from './authenticated-request'

const REQUEST_TIMEOUT_MS = 10_000

interface ResponseResult<T> {
  code?: number
  message?: string
  data?: T
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseDesktopUserInfo(value: unknown): DesktopUserInfo | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<DesktopUserInfo>
  if (
    typeof candidate.id !== 'number' ||
    !Number.isSafeInteger(candidate.id) ||
    candidate.id <= 0 ||
    typeof candidate.username !== 'string'
  ) {
    return null
  }
  return {
    id: candidate.id,
    username: candidate.username,
    nickname: typeof candidate.nickname === 'string' ? candidate.nickname : null,
    email: typeof candidate.email === 'string' ? candidate.email : null,
    avatar: typeof candidate.avatar === 'string' ? candidate.avatar : null,
  }
}

async function readResult<T>(response: Response): Promise<ResponseResult<T>> {
  const text = await response.text()
  try {
    return JSON.parse(text) as ResponseResult<T>
  } catch {
    return {}
  }
}

async function sendRequest(
  path: string,
  init: RequestInit,
  token: string | null,
): Promise<Response> {
  const identity = await ensureAgentClientRegistered(token)
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...agentIdentityHeaders(identity),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

export const authenticatedDesktopRequest = createAuthenticatedRequest({
  sessionId: () => loadAuthSession()?.sessionId ?? null,
  token: (refresh) => (refresh ? forceRefreshAccessToken() : getAccessToken()),
  send: (path, method, token) => sendRequest(path, { method }, token),
})

async function postWithOptionalAuth<T>(
  path: string,
  body: Record<string, unknown>,
  retryWithoutAuth: boolean,
): Promise<ResponseResult<T>> {
  let token: string | null = null
  try {
    token = await getAccessToken()
  } catch (error) {
    if (!retryWithoutAuth) throw error
  }

  let response = await sendRequest(path, { method: 'POST', body: JSON.stringify(body) }, token)
  let result = await readResult<T>(response)
  const unauthorized =
    response.status === 401 || response.status === 403 || result.code === 401 || result.code === 403

  if (token && unauthorized) {
    let refreshedToken: string | null = null
    try {
      refreshedToken = await forceRefreshAccessToken()
    } catch (error) {
      if (!retryWithoutAuth) throw error
    }

    if (refreshedToken) {
      response = await sendRequest(
        path,
        { method: 'POST', body: JSON.stringify(body) },
        refreshedToken,
      )
      result = await readResult<T>(response)
    } else if (retryWithoutAuth) {
      response = await sendRequest(path, { method: 'POST', body: JSON.stringify(body) }, null)
      result = await readResult<T>(response)
    }
  }

  if (!response.ok || result.code !== 200) {
    throw new Error(result.message || `请求失败 (HTTP ${response.status})`)
  }
  return result
}

export async function getAuthSession(): Promise<AuthSessionResult> {
  if (!hasAuthSession()) return { status: 'anonymous' }
  const expectedSession = loadAuthSession()!.sessionId
  const unavailable = (message?: string): AuthSessionResult =>
    hasAuthSession()
      ? { status: 'unavailable', message, cachedUser: getCachedAuthUser() }
      : { status: 'anonymous' }

  try {
    let token = await getAccessToken()
    if (!token) return { status: 'invalid' }
    if (loadAuthSession()?.sessionId !== expectedSession) return unavailable()

    let response = await sendRequest(
      await resolveDesktopApiUrl('userInfo'),
      { method: 'GET' },
      token,
    )
    let result = await readResult<DesktopUserInfo>(response)
    const unauthorized =
      response.status === 401 ||
      response.status === 403 ||
      result.code === 401 ||
      result.code === 403

    if (unauthorized) {
      if (loadAuthSession()?.sessionId !== expectedSession) return unavailable()
      token = await forceRefreshAccessToken()
      if (!token) return { status: 'invalid' }
      if (loadAuthSession()?.sessionId !== expectedSession) return unavailable()
      response = await sendRequest(await resolveDesktopApiUrl('userInfo'), { method: 'GET' }, token)
      result = await readResult<DesktopUserInfo>(response)
      if (
        response.status === 401 ||
        response.status === 403 ||
        result.code === 401 ||
        result.code === 403
      ) {
        return hasAuthSession() ? unavailable(result.message) : { status: 'invalid' }
      }
    }

    const user = parseDesktopUserInfo(result.data)
    if (!response.ok || result.code !== 200 || !user) {
      return unavailable(result.message)
    }
    if (!rememberAuthUser(expectedSession, user)) return unavailable()
    return { status: 'authenticated', user }
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error))
  }
}

export async function submitDesktopFeedback(params: DesktopFeedbackSubmitParams): Promise<number> {
  const result = await postWithOptionalAuth<number | { id?: number }>(
    await resolveDesktopApiUrl('feedbackSubmit'),
    { ...params },
    false,
  )
  const id = typeof result.data === 'number' ? result.data : result.data?.id
  if (typeof id !== 'number') throw new Error('提交反馈失败：响应缺少反馈 ID')
  return id
}

export async function syncDesktopMessages(): Promise<DesktopMessageSyncResult> {
  const result = await postWithOptionalAuth<DesktopMessageSyncResult>(
    await resolveDesktopApiUrl('messageSync'),
    {},
    true,
  )
  const data = result.data
  if (
    !data ||
    typeof data.revision !== 'string' ||
    !data.revision ||
    !Array.isArray(data.mainMessages) ||
    !Array.isArray(data.floatingMessages)
  ) {
    throw new Error('公告快照格式无效，保留本地缓存')
  }
  return data
}

export async function sendDesktopHeartbeat(): Promise<DesktopHeartbeatResult> {
  const result = await postWithOptionalAuth<DesktopHeartbeatResult>(
    await resolveDesktopApiUrl('heartbeat'),
    {},
    true,
  )
  if (
    !result.data ||
    typeof result.data.announcementRevision !== 'string' ||
    !result.data.announcementRevision ||
    !Number.isFinite(result.data.serverTime)
  ) {
    throw new Error('心跳响应格式无效')
  }
  return result.data
}

/** Use the same device-scoped release endpoint as startup/manual checks, without requiring login. */
export async function fetchDesktopUpdateInfo(lang: string): Promise<UpdateInfo | null> {
  const url = new URL(await resolveDesktopApiUrl('updateCheck'))
  url.searchParams.set('lang', lang)
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await sendRequest(
      url.href,
      { method: 'GET', cache: 'no-store', redirect: 'error' },
      null,
    )
    const result = await readResult<{
      hasUpdate?: boolean
      versionName?: string
      releaseAt?: string
      changelog?: string | null
    }>(response)
    if (
      attempt === 0 &&
      response.status === 401 &&
      result.code === DEVICE_CREDENTIAL_INVALID_CODE
    ) {
      const refreshed = await resolveRefreshedAgentRequestIdentity(async () => null)
      if (refreshed.status !== 'ready') throw new Error(refreshed.message)
      continue
    }
    if (!response.ok || result.code !== 200 || typeof result.data?.hasUpdate !== 'boolean')
      throw new Error(result.message || '软件更新查询失败')
    if (!result.data.hasUpdate) return null
    const { versionName, releaseAt, changelog } = result.data
    if (typeof versionName !== 'string' || !/^\d+\.\d+\.\d+$/.test(versionName))
      throw new Error('软件更新版本信息无效')
    return {
      version: versionName,
      releaseDate: typeof releaseAt === 'string' ? releaseAt : undefined,
      releaseNotes: typeof changelog === 'string' ? changelog : null,
    }
  }
  throw new Error('软件更新查询凭证无效')
}

export async function reportDesktopMessageEvent(
  input: DesktopMessageEventInput,
): Promise<AuthActionResult> {
  try {
    await postWithOptionalAuth<void>(
      await resolveDesktopApiUrl('messageEvent', { messageId: input.messageId }),
      {
        messageUid: input.messageUid,
        event: input.event,
        placement: input.placement,
      },
      true,
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}
