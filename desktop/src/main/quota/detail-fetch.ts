import type {
  QuotaDetailQuery,
  QuotaDetailSource,
  QuotaDetailSourceId,
} from '../../shared/quota-details'
import { parseCodexDetail } from './detail-codex'
import { parseAccountMetadata, parseGlmDetail, parseMiniMaxBilling } from './detail-providers'
import { fetchConnectionQuota, QuotaQueryError, requestQuotaJson } from './transport'
import type { DiscoveredConnection, JsonObject } from './types'

export function detailSources(connection: DiscoveredConnection): QuotaDetailSourceId[] {
  switch (connection.public.providerId) {
    case 'openai':
      return ['codex-activity', 'codex-analytics', 'codex-distribution']
    case 'zhipu':
      return ['glm-models', 'glm-tools']
    case 'kimi':
      return []
    case 'minimax':
      return ['minimax-billing']
    case 'anthropic':
      return ['claude-extra']
    case 'google':
      return ['gemini-account']
    case 'xai':
      return ['grok-billing', 'grok-settings']
  }
}

async function fetchMember(
  connection: DiscoveredConnection,
  id: QuotaDetailSourceId,
  query: QuotaDetailQuery,
  fetcher: typeof fetch,
): Promise<QuotaDetailSource> {
  if (connection.public.state === 'unsupported') throw new QuotaQueryError('unsupported')
  if (connection.expiresAt && connection.expiresAt <= Date.now())
    throw new QuotaQueryError('expired')
  const headers: Record<string, string> = { Authorization: `Bearer ${connection.token}` }
  const request = (url: string, body?: JsonObject): Promise<JsonObject> =>
    requestQuotaJson(url, headers, body, fetcher)
  const cn = connection.public.region === 'cn'
  if (id.startsWith('codex-')) {
    if (connection.accountId) headers['ChatGPT-Account-Id'] = connection.accountId
    const params = new URLSearchParams({
      start_date: query.startDate,
      end_date: query.endDate,
      group_by: 'day',
    })
    if (id === 'codex-analytics') params.set('workspace_user', 'true')
    const path =
      id === 'codex-activity'
        ? 'profiles/me'
        : id === 'codex-analytics'
          ? `analytics/daily-workspace-usage-counts?${params}`
          : `usage/daily-token-usage-breakdown?${params}`
    return parseCodexDetail(
      id,
      await request(`https://chatgpt.com/backend-api/wham/${path}`),
      query,
    )
  }
  if (id.startsWith('glm-')) {
    const params = new URLSearchParams({
      startTime: `${query.startDate} 00:00:00`,
      endTime: `${query.endDate} 23:59:59`,
    })
    if (connection.organizationId && connection.projectId) {
      headers['bigmodel-organization'] = connection.organizationId
      headers['bigmodel-project'] = connection.projectId
      params.set('type', '3')
    }
    return parseGlmDetail(
      id,
      await request(
        `https://${cn ? 'open.bigmodel.cn' : 'api.z.ai'}/api/monitor/usage/${id === 'glm-models' ? 'model' : 'tool'}-usage?${params}`,
      ),
    )
  }
  if (id === 'minimax-billing') {
    // 国际站的账单历史端点尚无可验证的协议，不能把国内凭据路由到国际站或反向复用。
    if (!cn) throw new QuotaQueryError('unsupported')
    const page = query.cursor ? Number(query.cursor) : 1
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
      throw new QuotaQueryError('invalid_response')
    return parseMiniMaxBilling(
      await request(
        `https://www.minimaxi.com/account/amount?page=${page}&limit=20&aggregate=false`,
      ),
      query,
    )
  }
  if (id === 'grok-settings') {
    headers['X-XAI-Token-Auth'] = 'xai-grok-cli'
    if (connection.accountId) headers['x-userid'] = connection.accountId
    return parseAccountMetadata(id, await request('https://cli-chat-proxy.grok.com/v1/settings'))
  }
  return parseAccountMetadata(id, await fetchConnectionQuota(connection, fetcher))
}

export async function fetchAccountDetail(
  connection: DiscoveredConnection,
  id: QuotaDetailSourceId,
  query: QuotaDetailQuery,
  fetcher: typeof fetch = fetch,
): Promise<QuotaDetailSource> {
  const members = connection.credentials ?? [connection]
  let failure: unknown = new QuotaQueryError('unsupported')
  for (const member of members) {
    try {
      return await fetchMember(member, id, query, fetcher)
    } catch (error) {
      failure = error
      if (
        !(error instanceof QuotaQueryError) ||
        ![
          'expired',
          'invalid_credential',
          'permission_denied',
          'invalid_response',
          'unsupported',
        ].includes(error.code)
      )
        break
    }
  }
  throw failure
}
