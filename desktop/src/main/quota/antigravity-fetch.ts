import { createHash } from 'node:crypto'
import { assertQuotaRegionAllowed } from './region-guard'
import { QuotaQueryError } from './query-error'
import { parseQuota } from './normalize'
import { object, textValue, numberValue } from './types'
import type { AntigravityOAuthGrant, DiscoveredConnection, JsonObject } from './types'

interface Requests {
  quota: (
    url: string,
    headers: Record<string, string>,
    body: JsonObject | undefined,
    fetcher: typeof fetch,
  ) => Promise<JsonObject>
  token: (fields: Record<string, string>, fetcher: typeof fetch) => Promise<JsonObject>
  identity: (token: string, fetcher: typeof fetch) => Promise<JsonObject>
}

interface Session {
  grant: AntigravityOAuthGrant
  accountId?: string
  sourceAccessToken: string
}

const sessions = new Map<string, Session>()
const renewing = new Map<string, Promise<Session>>()
// Match the Hub's cloud_code_endpoint; the legacy host can return different Gemini quota pools.
const host = 'daily-cloudcode-pa.googleapis.com'
const base = `https://${host}/v1internal:`

function secret(value: unknown): string | undefined {
  const text = textValue(value)
  return text && text.length <= 32768 && !/[\r\n]/.test(text) ? text : undefined
}

function sessionKey(connection: DiscoveredConnection, grant: AntigravityOAuthGrant): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        connection.public.id,
        grant.accountId ?? '',
        grant.clientId ?? '',
        grant.refreshToken ?? grant.accessToken,
      ]),
    )
    .digest('hex')
}

function remember(key: string, session: Session): void {
  sessions.delete(key)
  sessions.set(key, session)
  while (sessions.size > 32) sessions.delete(sessions.keys().next().value!)
}

async function renew(
  key: string,
  current: Session,
  fetcher: typeof fetch,
  requests: Requests,
): Promise<Session> {
  const pending = renewing.get(key)
  if (pending) return pending
  const work = (async (): Promise<Session> => {
    const grant = current.grant
    const refreshToken = secret(grant.refreshToken)
    const clientId = secret(grant.clientId)
    const clientSecret = secret(grant.clientSecret)
    if (!refreshToken || !clientId || !clientSecret) throw new QuotaQueryError('expired')
    const response = await requests.token(
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      },
      fetcher,
    )
    const accessToken = secret(response.access_token)
    const seconds = numberValue(response.expires_in)
    if (!accessToken || seconds === null || seconds <= 0 || seconds > 31_536_000)
      throw new QuotaQueryError('invalid_response')
    const next: Session = {
      accountId: current.accountId,
      sourceAccessToken: current.sourceAccessToken,
      grant: {
        ...grant,
        accessToken,
        refreshToken: secret(response.refresh_token) ?? refreshToken,
        expiresAt: Date.now() + seconds * 1000,
      },
    }
    remember(key, next)
    return next
  })().finally(() => renewing.delete(key))
  renewing.set(key, work)
  return work
}

async function verifyAccount(
  session: Session,
  fetcher: typeof fetch,
  requests: Requests,
): Promise<void> {
  const result = await requests.identity(session.grant.accessToken, fetcher)
  const account = secret(result.id ?? result.sub)
  if (!account) throw new QuotaQueryError('invalid_response')
  const expected =
    session.accountId ??
    (session.grant.accountIdentityVerified ? session.grant.accountId : undefined)
  if (expected && expected !== account) throw new QuotaQueryError('invalid_credential')
  session.accountId = account
}

export async function fetchAntigravityQuota(
  connection: DiscoveredConnection,
  fetcher: typeof fetch,
  requests: Requests,
): Promise<JsonObject> {
  const source = connection.antigravityOAuth
  if (!source || !secret(source.accessToken)) throw new QuotaQueryError('not_connected')
  await assertQuotaRegionAllowed(host, fetcher)
  const key = sessionKey(connection, source)
  const cached = sessions.get(key)
  let session: Session =
    cached?.sourceAccessToken === source.accessToken
      ? cached
      : {
          grant: { ...source },
          accountId:
            cached?.accountId ?? (source.accountIdentityVerified ? source.accountId : undefined),
          sourceAccessToken: source.accessToken,
        }
  const version = textValue(source.clientVersion)
  if (!version || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version))
    throw new QuotaQueryError('unsupported')
  session.grant.clientVersion = version
  const installedClientSecret = secret(source.clientSecret)
  if (installedClientSecret) session.grant.clientSecret = installedClientSecret
  if (
    session.grant.expiresAt &&
    session.grant.expiresAt <= Date.now() + 60_000 &&
    (session.grant.expiresAt <= Date.now() ||
      (session.grant.refreshToken && session.grant.clientId && session.grant.clientSecret))
  )
    session = await renew(key, session, fetcher, requests)

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await verifyAccount(session, fetcher, requests)
      remember(key, session)
      const platform = process.platform === 'win32' ? 'windows' : process.platform
      const architecture = process.arch === 'x64' ? 'amd64' : process.arch
      const headers = {
        Authorization: `Bearer ${session.grant.accessToken}`,
        'User-Agent': `antigravity/hub/${version} ${platform}/${architecture}`,
      }
      const account = await requests.quota(
        `${base}loadCodeAssist`,
        headers,
        {
          metadata: {
            ideType: 'ANTIGRAVITY',
            pluginType: 'GEMINI',
            platform: 'PLATFORM_UNSPECIFIED',
          },
        },
        fetcher,
      )
      const nativeProject =
        secret(account.cloudaicompanionProject) ??
        secret(object(account.cloudaicompanionProject).id) ??
        secret(object(account.cloudaicompanionProject).projectId)
      if (
        !account.currentTier &&
        !nativeProject &&
        Array.isArray(account.ineligibleTiers) &&
        account.ineligibleTiers.some(
          (tier) => object(tier).reasonCode === 'GOOGLE_TOS_NOT_SUPPORTED_BY_CLIENT',
        )
      )
        throw new QuotaQueryError('invalid_credential')
      const project = secret(session.grant.projectId) ?? nativeProject
      try {
        const quota = await requests.quota(
          `${base}retrieveUserQuotaSummary`,
          headers,
          project ? { project } : {},
          fetcher,
        )
        const result = {
          ...quota,
          accountTier: account.paidTier ?? account.currentTier,
          planType: object(account.planInfo).planType,
        }
        if (!project && !parseQuota(connection, result).windows.some((window) => window.available))
          throw new QuotaQueryError('scope_missing')
        return result
      } catch (error) {
        if (
          !project &&
          ((error instanceof QuotaQueryError &&
            ['invalid_response', 'provider_unavailable'].includes(error.code)) ||
            (error instanceof Error && error.message === 'invalid_response'))
        )
          throw new QuotaQueryError('scope_missing')
        throw error
      }
    } catch (error) {
      if (!(error instanceof QuotaQueryError) || error.code !== 'expired' || attempt !== 0)
        throw error
      session = await renew(key, session, fetcher, requests)
    }
  }
  throw new QuotaQueryError('expired')
}
