import { agentIdentityHeaders, DEVICE_CREDENTIAL_INVALID_CODE } from '../../shared/agent-client'
import type { DesktopApiKey, DesktopApiParameters } from '../../shared/runtime-config'
import type { DiscoveryCatalogRequest, DiscoveryPageKey } from '../../shared/discovery-ui'
import { validateDiscoveryCatalog } from '../../shared/discovery-ui-validation'
import { getAccessToken } from './auth.service'
import {
  resolveAgentRequestIdentity,
  resolveRefreshedAgentRequestIdentity,
} from './client-registration.service'
import { resolveDesktopApiUrl } from './runtime-config.service'

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error('发现服务没有返回数据')
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 8 * 1024 * 1024) throw new Error('发现服务返回的数据过大')
      parts.push(next.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const body = JSON.parse(Buffer.concat(parts, size).toString('utf8')) as unknown
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('发现服务响应无效')
  return body as Record<string, unknown>
}

async function request(
  key: DesktopApiKey,
  parameters?: DesktopApiParameters,
  query?: Record<string, unknown>,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = new URL(await resolveDesktopApiUrl(key, parameters))
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(name, String(value))
  }
  let identity = await resolveAgentRequestIdentity(getAccessToken)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (identity.status !== 'ready') throw new Error('网络中断或发现服务暂时不可用，请重试。')
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        ...agentIdentityHeaders(identity.identity),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    const result = await readJson(response)
    if (
      response.status === 401 &&
      result.code === DEVICE_CREDENTIAL_INVALID_CODE &&
      attempt === 0
    ) {
      identity = await resolveRefreshedAgentRequestIdentity(getAccessToken)
      continue
    }
    if (!response.ok)
      throw Object.assign(
        new Error(
          typeof result.message === 'string'
            ? result.message.slice(0, 300)
            : '发现服务暂时不可用，请重试。',
        ),
        {
          status: response.status,
          code: [404, 8203, 2002].includes(Number(result.code)) ? 'catalog-removed' : 'unavailable',
        },
      )
    return result
  }
  throw new Error('发现服务验证失败，请重试。')
}

export async function loadDiscoveryEntry(
  pageKey: DiscoveryPageKey,
  releaseId?: string,
): Promise<unknown> {
  const result = await request('discoveryUi', { pageKey }, releaseId ? { releaseId } : undefined)
  if (result.code !== 200 || !result.data) throw new Error('发现页面尚未启用或暂时不可用。')
  return result.data
}

export function requestDiscoveryCatalog(input: DiscoveryCatalogRequest): Promise<unknown> {
  const checked = validateDiscoveryCatalog(input)
  return request(checked.key, checked.parameters, checked.query, checked.body)
}
