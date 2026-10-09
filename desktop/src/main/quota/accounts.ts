import { createHash } from 'node:crypto'
import type { DiscoveredConnection } from './types'
import { jwtClaims, object, textValue } from './types'
import { fetchConnectionQuota, QuotaQueryError } from './transport'
import { parseQuota } from './normalize'

export function accountDigest(parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

function identity(connection: DiscoveredConnection): string | undefined {
  if (connection.quotaIdentity) return connection.quotaIdentity
  if (!connection.accountId || connection.public.authType !== 'oauth') return undefined
  if (connection.public.providerId === 'openai') {
    const claims = jwtClaims(connection.token)
    const auth = object(claims['https://api.openai.com/auth'])
    const user = textValue(auth.chatgpt_user_id) ?? textValue(claims.sub)
    // 工作区可由多人共用；额度合并还需要同一登录用户。
    if (user) return accountDigest([connection.accountId, user])
  }
  if (connection.public.providerId === 'xai' || connection.public.providerId === 'kimi')
    return accountDigest([connection.accountId])
  return undefined
}

export function groupQuotaAccounts(connections: DiscoveredConnection[]): DiscoveredConnection[] {
  const groups = new Map<string, DiscoveredConnection[]>()
  for (const row of connections.flatMap((connection) => connection.credentials ?? [connection])) {
    const owner = identity(row)
    const id = owner
      ? accountDigest([
          row.public.providerId,
          row.public.region,
          owner,
          row.organizationId ?? '',
          row.projectId ?? '',
        ]).slice(0, 32)
      : row.public.id
    const members = groups.get(id) ?? []
    const same = members.find((member) => member.fingerprint === row.fingerprint)
    if (same) same.public.sources = [...new Set([...same.public.sources, ...row.public.sources])]
    else members.push(row)
    groups.set(id, members)
  }
  return [...groups].map(([id, members]) => {
    members.sort(
      (a, b) =>
        Number(b.public.state === 'ready') - Number(a.public.state === 'ready') ||
        (b.expiresAt ?? Number.MAX_SAFE_INTEGER) - (a.expiresAt ?? Number.MAX_SAFE_INTEGER),
    )
    const primary = members[0]
    return {
      ...primary,
      credentials: members,
      fingerprint: accountDigest(members.map((row) => row.fingerprint).sort()),
      public: {
        ...primary.public,
        id,
        identity: identity(primary) ? 'account' : 'credential',
        connectionCount: members.length,
        sources: [...new Set(members.flatMap((row) => row.public.sources))],
      },
    }
  })
}

export async function fetchAccountQuota(
  account: DiscoveredConnection,
  query: (connection: DiscoveredConnection) => Promise<unknown> = fetchConnectionQuota,
): Promise<unknown> {
  const members = account.credentials ?? [account]
  let lastError: unknown
  for (const member of members) {
    if (member.public.state !== 'ready' && members.some((row) => row.public.state === 'ready'))
      continue
    try {
      const body = await query(member)
      parseQuota(member, body)
      return body
    } catch (error) {
      lastError = error
      const retry =
        error instanceof QuotaQueryError
          ? ['expired', 'invalid_credential', 'permission_denied', 'invalid_response'].includes(
              error.code,
            )
          : error instanceof Error && error.message === 'invalid_response'
      if (!retry) throw error
    }
  }
  throw lastError ?? new QuotaQueryError('not_connected')
}
