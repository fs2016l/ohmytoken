import { createHash } from 'node:crypto'
import { QuotaQueryError } from './query-error'
import { numberValue, object, textValue, type DiscoveredConnection, type JsonObject } from './types'

type Request = (
  url: string,
  headers: Record<string, string>,
  body: JsonObject | undefined,
  fetcher: typeof fetch,
) => Promise<JsonObject>

/** MiniMax's account/matrix-account-client.ts protocol; all calls only read account data. */
export async function fetchMiniMaxCodeQuota(
  connection: DiscoveredConnection,
  fetcher: typeof fetch,
  request: Request,
): Promise<JsonObject> {
  const cn = connection.public.region === 'cn'
  const origin = cn ? 'https://agent.minimaxi.com' : 'https://agent.minimax.io'
  const accountRequest = async (
    path: string,
    payload?: JsonObject,
    userId = '0',
  ): Promise<JsonObject> => {
    const now = Date.now()
    const seconds = Math.floor(now / 1000)
    const url = new URL(path, origin)
    url.search = new URLSearchParams({
      device_platform: 'mcode',
      biz_id: '3',
      app_id: '3001',
      version_code: '22201',
      unix: String(now),
      timezone_offset: String(new Date().getTimezoneOffset() * -60),
      sys_language: cn ? 'zh' : 'en',
      lang: cn ? 'zh' : 'en',
      device_id: '0',
      os_name: process.platform,
      browser_name: 'mcode',
      user_id: userId,
      client: 'mcode',
    }).toString()
    const body = payload ? JSON.stringify(payload) : '{}'
    // Public first-party client attribution constants, not credentials. Authorization
    // still uses the user's token, matching the official open-source client.
    const result = await request(
      url.href,
      {
        Authorization: `Bearer ${connection.token}`,
        'User-Agent': 'MiniMaxCode',
        yy: md5(`${encodeURIComponent(url.pathname + url.search)}_${body}${md5(String(now))}ooui`),
        'x-timestamp': String(seconds),
        'x-signature': md5(`${seconds}I*7Cf%WZ#S&%1RlZJ&C2${payload ? body : ''}`),
      },
      payload,
      fetcher,
    )
    assertSuccess(result)
    return result
  }
  const identity = await accountRequest('/v1/api/user/info')
  const data = object(identity.data)
  const user = object(data.userInfo ?? data.user_info ?? identity.userInfo ?? identity.user_info)
  const userId = textValue(user.realUserID ?? user.real_user_id)
  if (!userId) throw new QuotaQueryError('invalid_response')
  const extra = await accountRequest('/matrix/api/v1/user/get_user_extra_info', {}, userId)
  const workspaces = extra.workspaces ?? object(extra.data).workspaces
  const personal = Array.isArray(workspaces)
    ? workspaces.map(object).find((row) => row.workspace_type === 0)
    : undefined
  if (!personal) throw new QuotaQueryError('scope_missing')
  const workspaceId = personal.workspace_id
  if (
    !(typeof workspaceId === 'number' && Number.isFinite(workspaceId) && workspaceId >= 0) &&
    !textValue(workspaceId)
  )
    throw new QuotaQueryError('scope_missing')
  const groupId = textValue(personal.op_group_id)
  if (!groupId || /[\r\n]/.test(groupId)) throw new QuotaQueryError('scope_missing')
  const platformOrigin =
    connection.public.region === 'cn' ? 'https://www.minimaxi.com' : 'https://platform.minimax.io'
  const membership = await accountRequest(
    '/matrix/api/v1/commerce/get_membership_info',
    {
      workspace_id: workspaceId,
    },
    userId,
  )
  const details = { ...personal, ...object(membership.data), ...membership }
  if (personal.has_token_plan !== true && details.has_token_plan === false)
    throw new QuotaQueryError('unsupported')
  const quota = await request(
    `${platformOrigin}/v1/api/openplatform/coding_plan/remains`,
    {
      Authorization: `Bearer ${connection.token}`,
      'X-Group-Id': groupId,
    },
    undefined,
    fetcher,
  )
  assertSuccess(quota)
  // This login-specific endpoint defines legacy usage_count as remaining. Do not
  // apply that interpretation to API-key endpoints, whose versions differ.
  const remains = quota.model_remains ?? object(quota.data).model_remains
  if (!Array.isArray(remains) || !remains.length) throw new QuotaQueryError('invalid_response')
  return {
    ...quota,
    model_remains: remains.map((value) => {
      const row = { ...object(value) }
      for (const prefix of ['current_interval', 'current_weekly']) {
        if (row[`${prefix}_remaining_percent`] !== undefined) continue
        const total = numberValue(row[`${prefix}_total_count`])
        const remaining = numberValue(row[`${prefix}_usage_count`])
        if (total && remaining !== null && remaining <= total)
          row[`${prefix}_remaining_percent`] = (remaining / total) * 100
      }
      return row
    }),
    plan_name: details.token_plan_tier ?? quota.plan_name,
    minimax_code_membership: { token_plan_expires_at: details.token_plan_expires_at },
  }
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex')
}

function assertSuccess(body: JsonObject): void {
  const status = object(body.statusInfo).code
  if (status === 1000048) throw new QuotaQueryError('expired')
  const base = object(body.base_resp).status_code
  if (base === 2049) throw new QuotaQueryError('invalid_credential')
  if ((status !== undefined && status !== 0) || (base !== undefined && base !== 0))
    throw new QuotaQueryError('invalid_response')
}
