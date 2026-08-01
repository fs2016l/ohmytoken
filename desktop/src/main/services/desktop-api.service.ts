import type {
  AuthActionResult,
  AuthSessionResult,
  DesktopFeedbackSubmitParams,
  DesktopMessageEventInput,
  DesktopMessageSyncResult,
  DesktopUserInfo,
} from '../../shared/desktop-api'
import type { CustomMessagePlacement } from '../../shared/custom-message'
import { agentIdentityHeaders } from '../../shared/agent-client'
import { forceRefreshAccessToken, getAccessToken, hasAuthSession } from './auth.service'
import { ensureAgentClientRegistered } from './client-registration.service'
import { getOhmytokenApiBase } from './server-config.service'

const API_BASE = getOhmytokenApiBase()
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
    !Number.isFinite(candidate.id) ||
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
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...agentIdentityHeaders(identity),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

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

  try {
    let token = await getAccessToken()
    if (!token) return { status: 'invalid' }

    let response = await sendRequest('/desktop/userinfo', { method: 'GET' }, token)
    let result = await readResult<DesktopUserInfo>(response)
    const unauthorized =
      response.status === 401 ||
      response.status === 403 ||
      result.code === 401 ||
      result.code === 403

    if (unauthorized) {
      token = await forceRefreshAccessToken()
      if (!token) return { status: 'invalid' }
      response = await sendRequest('/desktop/userinfo', { method: 'GET' }, token)
      result = await readResult<DesktopUserInfo>(response)
      if (
        response.status === 401 ||
        response.status === 403 ||
        result.code === 401 ||
        result.code === 403
      ) {
        return { status: 'invalid' }
      }
    }

    const user = parseDesktopUserInfo(result.data)
    if (!response.ok || result.code !== 200 || !user) {
      return { status: 'unavailable', message: result.message }
    }
    return { status: 'authenticated', user }
  } catch (error) {
    return {
      status: 'unavailable',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function submitDesktopFeedback(params: DesktopFeedbackSubmitParams): Promise<number> {
  const result = await postWithOptionalAuth<number | { id?: number }>(
    '/desktop/feedback/submit',
    { ...params },
    false,
  )
  const id = typeof result.data === 'number' ? result.data : result.data?.id
  if (typeof id !== 'number') throw new Error('提交反馈失败：响应缺少反馈 ID')
  return id
}

export async function syncDesktopMessages(
  placement: CustomMessagePlacement,
): Promise<DesktopMessageSyncResult> {
  try {
    const result = await postWithOptionalAuth<
      Pick<DesktopMessageSyncResult, 'messages' | 'activeMessageUids'>
    >('/desktop/message/sync', { placement }, true)
    return {
      ok: true,
      messages: Array.isArray(result.data?.messages) ? result.data.messages : [],
      activeMessageUids: Array.isArray(result.data?.activeMessageUids)
        ? result.data.activeMessageUids
        : [],
    }
  } catch (error) {
    return {
      ok: false,
      message: errorMessage(error),
      messages: [],
      activeMessageUids: [],
    }
  }
}

export async function reportDesktopMessageEvent(
  input: DesktopMessageEventInput,
): Promise<AuthActionResult> {
  try {
    await postWithOptionalAuth<void>(
      `/desktop/message/${input.messageId}/event`,
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
