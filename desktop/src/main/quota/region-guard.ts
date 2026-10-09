import { AsyncLocalStorage } from 'node:async_hooks'
import { regionCode } from '../network-check/ai-regions'
import { publicIp } from '../network-check/policy'
import { object } from './types'
import { QuotaQueryError } from './query-error'

const GUARDED_HOSTS = new Set([
  'chatgpt.com',
  'api.anthropic.com',
  'cloudcode-pa.googleapis.com',
  'cli-chat-proxy.grok.com',
])
const REGION_SOURCES = [
  { url: 'https://ipinfo.io/json', country: 'country' },
  { url: 'https://ipwho.is/?fields=ip,success,country_code', country: 'country_code' },
]
const CHECK_TIMEOUT_MS = 2500
const MAX_RESPONSE_BYTES = 8192
const MAX_CHECK_AGE_MS = 10_000
interface Check {
  startedAt: number
  result: Promise<string | null>
}
interface RefreshScope {
  active: boolean
  checks: Map<typeof fetch, Check>
}
const scope = new AsyncLocalStorage<RefreshScope>()
const pending = new WeakMap<typeof fetch, Check>()

/** Reuse a check only within this refresh. The next refresh rechecks the current exit. */
export function withQuotaRegionCheck<T>(work: () => Promise<T>): Promise<T> {
  if (scope.getStore()?.active) return work()
  const batch: RefreshScope = { active: true, checks: new Map() }
  return scope.run(batch, async () => {
    try {
      return await work()
    } finally {
      // Scheduled refresh timers inherit async context, but must not inherit permission.
      batch.active = false
      batch.checks.clear()
    }
  })
}

async function readCountry(
  source: (typeof REGION_SOURCES)[number],
  fetcher: typeof fetch,
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  try {
    // Use the quota transport's fetcher, not Electron's separate network-check session.
    // Never send vendor credentials, account identifiers or cookies to an IP service.
    const response = await fetcher(source.url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    if (
      !response.ok ||
      response.redirected ||
      Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES
    ) {
      await response.body?.cancel()
      return null
    }
    if (!response.body) return null
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        length += part.value.byteLength
        if (length > MAX_RESPONSE_BYTES) {
          await reader.cancel()
          return null
        }
        chunks.push(part.value)
      }
    } finally {
      reader.releaseLock()
    }
    const data = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    const country = data[source.country]
    if (!publicIp(data.ip) || data.success === false || data.error || typeof country !== 'string')
      return null
    return regionCode(country.trim())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function lookupCountry(fetcher: typeof fetch): Promise<string | null> {
  for (const source of REGION_SOURCES) {
    const country = await readCountry(source, fetcher)
    if (country) return country
  }
  return null
}

export async function assertQuotaRegionAllowed(
  hostname: string,
  fetcher: typeof fetch,
): Promise<void> {
  if (!GUARDED_HOSTS.has(hostname)) return
  const current = scope.getStore()
  const batch = current?.active ? current.checks : undefined
  let check = batch?.get(fetcher)
  // Slow batches also recheck; an old successful result never becomes a lasting permission.
  if (!check || Date.now() - check.startedAt >= MAX_CHECK_AGE_MS) {
    check = pending.get(fetcher)
    if (!check) {
      check = { startedAt: Date.now(), result: lookupCountry(fetcher) }
      pending.set(fetcher, check)
      void check.result.finally(() => pending.delete(fetcher))
    }
    batch?.set(fetcher, check)
  }
  const country = await check.result
  if (country === 'CN') throw new QuotaQueryError('region_restricted')
  if (!country) throw new QuotaQueryError('region_unknown')
}
