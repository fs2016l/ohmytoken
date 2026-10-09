import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getAppDataDir } from '../lib/paths'
import { CLOUD_REFERENCE_CHECK_INTERVAL_MS } from '../../shared/cloud-reference-sync'
import { activatePriceCatalog } from '../cost/price-catalog'
import { activateVendorRules } from '../cost/vendor-rules'
import {
  parseModelCatalogPublication,
  type ModelCatalogPublication,
} from '../cost/model-catalog-document'
import { getOhmytokenApiBase } from './server-config.service'
import { DEVICE_CREDENTIAL_INVALID_CODE, agentIdentityHeaders } from '../../shared/agent-client'

interface CachedCatalog {
  etag: string
  publication: ModelCatalogPublication
}

let current: CachedCatalog | undefined
let timer: ReturnType<typeof setInterval> | undefined
let loading: Promise<void> | undefined

function filePath(): string {
  const scope = createHash('sha256').update(getOhmytokenApiBase()).digest('hex').slice(0, 16)
  return join(getAppDataDir(), `model-catalog-com-${scope}.json`)
}

function validEtag(value: unknown): value is string {
  return typeof value === 'string' && /^"[a-f0-9]{64}"$/.test(value)
}

function activate(cache: CachedCatalog): void {
  activatePriceCatalog(cache.publication)
  activateVendorRules(cache.publication.catalog.vendors)
  current = cache
}

/** Called in main and in every scan process before cost computation. No network or local Agent data is read. */
export function loadCachedModelCatalog(): void {
  try {
    const path = filePath()
    if (!existsSync(path)) return
    const text = readFileSync(path, 'utf8')
    if (text.length > 2_500_000) return
    const parsed = JSON.parse(text) as { etag?: unknown; publication?: unknown }
    if (!validEtag(parsed.etag)) return
    const publication = parseModelCatalogPublication(parsed.publication)
    activate({ etag: parsed.etag, publication })
  } catch (error) {
    console.warn('[model-catalog] 本地快照无效，使用内置价目表:', error)
  }
}

async function fetchCatalog(): Promise<void> {
  const { getAgentIdentityHeaders, resolveRefreshedAgentRequestIdentity } =
    await import('./client-registration.service')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const request = (headers: Record<string, string>) =>
      fetch(`${getOhmytokenApiBase()}/desktop/model-catalog`, {
        method: 'GET',
        headers: {
          ...headers,
          Accept: 'application/json',
          ...(current
            ? {
                'If-None-Match': current.etag,
                'X-Model-Catalog-Version': String(current.publication.version),
              }
            : {}),
        },
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      })
    let response = await request(await getAgentIdentityHeaders(null))
    if (response.status === 401) {
      const body = (await response.json().catch(() => ({}))) as { code?: number }
      if (body.code === DEVICE_CREDENTIAL_INVALID_CODE) {
        const refreshed = await resolveRefreshedAgentRequestIdentity(async () => null)
        if (refreshed.status === 'ready') {
          response = await request(agentIdentityHeaders(refreshed.identity))
        }
      }
    }
    if (response.status === 304 || response.status === 204) return
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (Number(response.headers.get('content-length')) > 2_500_000)
      throw new Error('价目表超过大小限制')
    const body = await response.text()
    if (body.length > 2_500_000) throw new Error('价目表超过大小限制')
    const publication = parseModelCatalogPublication(JSON.parse(body))
    const etag = response.headers.get('etag')
    if (!validEtag(etag)) throw new Error('价目表缺少有效 ETag')
    if (current && publication.version < current.publication.version)
      throw new Error('价目表版本倒退')
    const cache = { etag, publication }
    const path = filePath()
    await mkdir(getAppDataDir(), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(cache), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
    activate(cache)
  } finally {
    clearTimeout(timeout)
  }
}

export function refreshModelCatalog(): Promise<void> {
  if (loading) return loading
  loading = fetchCatalog()
    .catch((error: unknown) => {
      console.warn('[model-catalog] 更新失败，继续使用上次有效配置:', error)
    })
    .finally(() => {
      loading = undefined
    })
  return loading
}

export function startModelCatalogSync(): void {
  if (timer) return
  loadCachedModelCatalog()
  void refreshModelCatalog()
  timer = setInterval(() => void refreshModelCatalog(), CLOUD_REFERENCE_CHECK_INTERVAL_MS)
  timer.unref()
}

export function stopModelCatalogSync(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}
