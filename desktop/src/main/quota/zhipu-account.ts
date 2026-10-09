import { createDecipheriv, createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { userInfo } from 'node:os'
import { accountDigest } from './accounts'
import { requestQuotaJson } from './transport'
import { object, textValue, type DiscoveredConnection } from './types'

interface AccountLookupOptions {
  home: string
  env: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  username?: string
}
interface Owner {
  identity: string
  label: string
}
const remembered = new Map<string, { expiresAt: number; owners: Map<string, Owner> }>()

export function readZcodeCredential(value: unknown, secret: string): string | undefined {
  const text = textValue(value)
  if (!text || text.length > 64 * 1024) return undefined
  if (!text.startsWith('enc:v1:')) return text
  try {
    const parts = text.slice(7).split('.')
    if (parts.length !== 3 || parts.some((part) => !/^[\w-]+$/.test(part))) return undefined
    const [nonce, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'))
    if (nonce.length !== 12 || tag.length !== 16) return undefined
    const key = createHash('sha256').update(secret).digest()
    const decoder = createDecipheriv('aes-256-gcm', key, nonce)
    decoder.setAuthTag(tag)
    return Buffer.concat([decoder.update(encrypted), decoder.final()]).toString('utf8')
  } catch {
    return undefined
  }
}

async function loadLogin(options: AccountLookupOptions): Promise<string | undefined> {
  try {
    const path = join(
      options.env.ZCODE_HOME || join(options.home, '.zcode'),
      'v2',
      'credentials.json',
    )
    if ((await stat(path)).size > 1024 * 1024) return undefined
    const entries = object(JSON.parse(await readFile(path, 'utf8')))
    const username = options.username ?? userInfo().username
    const secret =
      options.env.ZCODE_CREDENTIAL_SECRET ||
      `zcode-credential-fallback:${options.platform ?? process.platform}:${options.home}:${username}`
    const token = readZcodeCredential(entries['oauth:bigmodel:access_token'], secret)
    return token && token.length <= 32768 && !/[\r\n]/.test(token) ? token : undefined
  } catch {
    return undefined
  }
}

async function lookupOwners(token: string, fetcher: typeof fetch): Promise<Map<string, Owner>> {
  const headers = { Authorization: `Bearer ${token}` }
  const profile = await requestQuotaJson(
    'https://bigmodel.cn/api/biz/customer/getCustomerInfo',
    headers,
    undefined,
    fetcher,
    4_000,
  )
  const customer = object(profile.data)
  const customerId = textValue(customer.customerNumber)
  const owners = new Map<string, Owner>()
  if (profile.code !== 200 || !customerId || !Array.isArray(customer.organizations)) return owners
  // 默认组织、默认项目的个人套餐共享账户额度；团队项目保留独立范围。
  for (const value of customer.organizations.slice(0, 20)) {
    const organization = object(value)
    const organizationId = textValue(organization.organizationId)
    if (organization.isDefault !== true || !organizationId || !Array.isArray(organization.projects))
      continue
    const project = organization.projects.map(object).find((row) => row.isDefault === true)
    const projectId = textValue(project?.projectId)
    if (!projectId) continue
    const response = await requestQuotaJson(
      `https://bigmodel.cn/api/biz/v1/organization/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/api_keys`,
      { ...headers, 'Bigmodel-Organization': organizationId, 'Bigmodel-Project': projectId },
      undefined,
      fetcher,
      4_000,
    )
    if (response.code !== 200 || !Array.isArray(response.data)) continue
    for (const item of response.data.slice(0, 500)) {
      const keyId = textValue(object(item).apiKey)
      if (keyId)
        owners.set(keyId, {
          identity: accountDigest(['personal', customerId, organizationId, projectId]),
          label: `…${customerId.slice(-6)}`,
        })
    }
    break
  }
  return owners
}

export async function identifyZhipuAccounts(
  connections: DiscoveredConnection[],
  options: AccountLookupOptions,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const candidates = connections
    .flatMap((row) => row.credentials ?? [row])
    .filter(
      (row) =>
        row.public.providerId === 'zhipu' &&
        row.public.region === 'cn' &&
        row.public.scope === 'account' &&
        /^[\w-]{8,128}\.[\w-]{8,256}$/.test(row.token),
    )
  if (candidates.length < 2) return
  const token = await loadLogin(options)
  if (!token) return
  const loginId = accountDigest([token])
  let saved = remembered.get(loginId)
  if (!saved || saved.expiresAt <= Date.now()) {
    try {
      saved = { owners: await lookupOwners(token, fetcher), expiresAt: Date.now() + 300_000 }
    } catch {
      saved = { owners: saved?.owners ?? new Map(), expiresAt: Date.now() + 60_000 }
    }
    remembered.clear()
    remembered.set(loginId, saved)
  }
  for (const row of candidates) {
    const owner = saved.owners.get(row.token.split('.')[0])
    if (!owner) continue
    row.quotaIdentity = owner.identity
    row.public.accountLabel = owner.label
  }
}
