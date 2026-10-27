import type { DiscoveredConnection, JsonObject } from './types'
import { object, textValue } from './types'
import { isQuotaRegionError, QuotaQueryError } from './query-error'
import { assertQuotaRegionAllowed, withQuotaRegionCheck } from './region-guard'
import { fetchAntigravityQuota } from './antigravity-fetch'
import { fetchMiniMaxCodeQuota } from './minimax-code-fetch'

export { QuotaQueryError } from './query-error'

const HOSTS = new Set([
  'www.minimaxi.com',
  'api.minimaxi.com',
  'api.minimax.io',
  'platform.minimax.io',
  'agent.minimaxi.com',
  'agent.minimax.io',
  'open.bigmodel.cn',
  'bigmodel.cn',
  'api.z.ai',
  'chatgpt.com',
  'api.anthropic.com',
  'api.kimi.com',
  'api.kimi.ai',
  'api.deepseek.com',
  'platform.deepseek.com',
  'daily-cloudcode-pa.googleapis.com',
  'cli-chat-proxy.grok.com',
])

export async function requestQuotaJson(
  url: string,
  headers: Record<string, string>,
  body?: JsonObject,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<JsonObject> {
  return requestJson(url, headers, body, fetcher, timeoutMs)
}

export async function requestAntigravityToken(
  fields: Record<string, string>,
  fetcher: typeof fetch,
): Promise<JsonObject> {
  return requestJson(
    'https://oauth2.googleapis.com/token',
    {},
    new URLSearchParams(fields).toString(),
    fetcher,
    15_000,
    true,
  )
}

export async function requestAntigravityIdentity(
  token: string,
  fetcher: typeof fetch,
): Promise<JsonObject> {
  return requestJson(
    'https://www.googleapis.com/oauth2/v2/userinfo',
    { Authorization: `Bearer ${token}` },
    undefined,
    fetcher,
    15_000,
    true,
  )
}

async function requestJson(
  url: string,
  headers: Record<string, string>,
  body: JsonObject | string | undefined,
  fetcher: typeof fetch,
  timeoutMs: number,
  googleAuth = false,
): Promise<JsonObject> {
  const address = new URL(url)
  const permitted = googleAuth
    ? url === 'https://oauth2.googleapis.com/token' ||
      url === 'https://www.googleapis.com/oauth2/v2/userinfo'
    : HOSTS.has(address.hostname)
  if (
    address.protocol !== 'https:' ||
    !permitted ||
    address.port ||
    address.username ||
    address.password
  ) {
    throw new QuotaQueryError('unsupported')
  }
  await assertQuotaRegionAllowed(
    googleAuth ? 'daily-cloudcode-pa.googleapis.com' : address.hostname,
    fetcher,
  )
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body
          ? {
              'Content-Type':
                typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json',
            }
          : {}),
        ...headers,
      },
      body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 401) throw new QuotaQueryError('expired')
      if (googleAuth && response.status === 400) throw new QuotaQueryError('invalid_credential')
      if (response.status === 403) throw new QuotaQueryError('permission_denied')
      if (response.status === 429) {
        const retry = response.headers.get('retry-after')
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : null
        const date = retry ? Date.parse(retry) : NaN
        throw new QuotaQueryError(
          'rate_limited',
          seconds !== null
            ? Date.now() + Math.max(seconds, 1) * 1000
            : Number.isFinite(date)
              ? date
              : Date.now() + 300_000,
        )
      }
      throw new QuotaQueryError('provider_unavailable')
    }
    const maximum = 1024 * 1024
    if (Number(response.headers.get('content-length')) > maximum) {
      await response.body?.cancel()
      throw new QuotaQueryError('invalid_response')
    }
    if (!response.body) throw new QuotaQueryError('invalid_response')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        length += part.value.byteLength
        if (length > maximum) {
          await reader.cancel()
          throw new QuotaQueryError('invalid_response')
        }
        chunks.push(part.value)
      }
    } finally {
      reader.releaseLock()
    }
    try {
      return object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch {
      throw new QuotaQueryError('invalid_response')
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchConnectionQuota(
  connection: DiscoveredConnection,
  fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
  return withQuotaRegionCheck(() => fetchQuota(connection, fetcher))
}

async function fetchQuota(
  connection: DiscoveredConnection,
  fetcher: typeof fetch,
): Promise<JsonObject> {
  if (connection.public.state === 'unsupported') throw new QuotaQueryError('unsupported')
  if (connection.public.providerId === 'antigravity') {
    return fetchAntigravityQuota(connection, fetcher, {
      quota: requestQuotaJson,
      token: requestAntigravityToken,
      identity: requestAntigravityIdentity,
    })
  }
  if (connection.expiresAt && connection.expiresAt <= Date.now())
    throw new QuotaQueryError('expired')
  const headers: Record<string, string> = { Authorization: `Bearer ${connection.token}` }
  const request = (url: string, body?: JsonObject): Promise<JsonObject> =>
    requestQuotaJson(url, headers, body, fetcher)
  const cn = connection.public.region === 'cn'
  switch (connection.public.providerId) {
    case 'minimax': {
      if (connection.miniMaxCode)
        return fetchMiniMaxCodeQuota(connection, fetcher, requestQuotaJson)
      const response = await request(
        cn
          ? 'https://www.minimaxi.com/v1/token_plan/remains'
          : 'https://api.minimax.io/v1/token_plan/remains',
      )
      if (object(response.base_resp).status_code === 2049)
        throw new QuotaQueryError('invalid_credential')
      return response
    }
    case 'zhipu': {
      let suffix = ''
      if (connection.organizationId && connection.projectId) {
        headers['bigmodel-organization'] = connection.organizationId
        headers['bigmodel-project'] = connection.projectId
        suffix = '?type=2'
      }
      return request(
        `https://${cn ? 'open.bigmodel.cn' : 'api.z.ai'}/api/monitor/usage/quota/limit${suffix}`,
      )
    }
    case 'openai':
      if (connection.accountId) headers['ChatGPT-Account-Id'] = connection.accountId
      return request('https://chatgpt.com/backend-api/wham/usage')
    case 'anthropic':
      headers['anthropic-beta'] = 'oauth-2025-04-20'
      return request('https://api.anthropic.com/api/oauth/usage')
    case 'deepseek': {
      if (connection.public.authType === 'api-key')
        return request('https://api.deepseek.com/user/balance')
      const response = await requestQuotaJson(
        'https://platform.deepseek.com/api/v0/users/get_user_summary',
        { 'x-dsh-auth-token': connection.token },
        undefined,
        fetcher,
      )
      if (response.code === 40003) throw new QuotaQueryError('expired')
      return response
    }
    case 'kimi': {
      const base = `https://api.kimi.${cn ? 'com' : 'ai'}/coding/v1`
      const [usage, profile] = await Promise.allSettled([
        request(`${base}/usages`),
        request(`${base}/me`),
      ])
      if (usage.status === 'rejected') throw usage.reason
      return { ...usage.value, profile: profile.status === 'fulfilled' ? profile.value : null }
    }
    case 'xai': {
      headers['X-XAI-Token-Auth'] = 'xai-grok-cli'
      if (connection.accountId) headers['x-userid'] = connection.accountId
      const billing = await request('https://cli-chat-proxy.grok.com/v1/billing?format=credits')
      // Grok Build enriches billing with the tier from RemoteSettings, not credit amounts.
      // Account metadata is optional: a failed settings request must not discard quota.
      try {
        const settings = await request('https://cli-chat-proxy.grok.com/v1/settings')
        return {
          ...billing,
          subscriptionTier:
            textValue(settings.subscription_tier_display) ??
            textValue(settings.subscription_tier) ??
            billing.subscriptionTier ??
            billing.subscription_tier,
        }
      } catch (error) {
        if (error instanceof QuotaQueryError && isQuotaRegionError(error.code)) throw error
        return billing
      }
    }
  }
}
