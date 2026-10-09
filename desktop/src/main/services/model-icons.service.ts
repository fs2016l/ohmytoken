import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, protocol } from 'electron'
import {
  modelIconExtension,
  modelBrandSnapshot,
  parseModelIconManifest,
  resolveModelBrandId,
  type ModelIconEntry,
  type ModelIconManifest,
  type ModelIconSnapshot,
} from '../../shared/model-icons'
import { IPC } from '../ipc/channels'
import { getAppDataDir } from '../lib/paths'
import { DEVICE_CREDENTIAL_INVALID_CODE, agentIdentityHeaders } from '../../shared/agent-client'
import { getOhmytokenApiBase } from './server-config.service'
import { cacheModelIcon, readVerifiedModelIcon } from './model-icon-cache'
import { CLOUD_REFERENCE_CHECK_INTERVAL_MS } from '../../shared/cloud-reference-sync'

const SCHEME = 'omt-model-icon'
const MAX_MANIFEST_BYTES = 2_000_000
const MAX_PARALLEL_DOWNLOADS = 4

interface CachedManifest {
  etag: string
  manifest: ModelIconManifest
}

let current: CachedManifest | null = null
let loaded = false
let loading: Promise<void> | null = null
let running = 0
let announceTimer: ReturnType<typeof setTimeout> | undefined
let syncTimer: ReturnType<typeof setInterval> | undefined
const verified = new Set<string>()
const queued = new Set<string>()
const failed = new Set<string>()
const downloads: ModelIconEntry[] = []

function directory(): string {
  const scope = createHash('sha256').update(getOhmytokenApiBase()).digest('hex').slice(0, 16)
  return join(getAppDataDir(), 'model-icons', scope)
}

function iconPath(icon: ModelIconEntry): string {
  return join(directory(), `${icon.sha256}.${modelIconExtension(icon.contentType)}`)
}

function iconUrl(icon: ModelIconEntry): string {
  return `${SCHEME}://cache/${icon.sha256}.${modelIconExtension(icon.contentType)}`
}

function validEtag(value: unknown): value is string {
  return typeof value === 'string' && /^"[a-f0-9]{64}"$/.test(value)
}

function parseManifest(value: unknown): ModelIconManifest {
  const apiBase = new URL(getOhmytokenApiBase())
  const allowLoopbackHttp =
    apiBase.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(apiBase.hostname)
  return parseModelIconManifest(value, allowLoopbackHttp)
}

export function loadCachedModelIcons(): void {
  if (loaded) return
  loaded = true
  try {
    const path = join(directory(), 'manifest.json')
    if (!existsSync(path)) return
    const text = readFileSync(path, 'utf8')
    if (text.length > MAX_MANIFEST_BYTES) return
    const parsed = JSON.parse(text) as { etag?: unknown; manifest?: unknown }
    if (!validEtag(parsed.etag)) return
    current = { etag: parsed.etag, manifest: parseManifest(parsed.manifest) }
  } catch (error) {
    console.warn('[model-icons] 本地清单无效，等待同步 COM 配置:', error)
  }
}

export function getModelIconSnapshot(): ModelIconSnapshot {
  loadCachedModelIcons()
  const families: ModelIconSnapshot['families'] = Object.create(null)
  for (const icon of current?.manifest.families ?? []) {
    families[icon.id] = {
      sha256: icon.sha256,
      url: verified.has(icon.sha256) ? iconUrl(icon) : null,
    }
  }
  return { families, ...modelBrandSnapshot(current?.manifest) }
}

function announce(): void {
  if (announceTimer) return
  announceTimer = setTimeout(() => {
    announceTimer = undefined
    const snapshot = getModelIconSnapshot()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send(IPC.MODEL_ICONS_CHANGED, snapshot)
    }
  }, 50)
  announceTimer.unref()
}

async function saveManifest(cache: CachedManifest): Promise<void> {
  const folder = directory()
  await mkdir(folder, { recursive: true })
  const temporary = join(folder, `manifest.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify(cache), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, join(folder, 'manifest.json'))
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

async function fetchManifest(): Promise<void> {
  const { getAgentIdentityHeaders, resolveRefreshedAgentRequestIdentity } =
    await import('./client-registration.service')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const request = (headers: Record<string, string>) =>
      fetch(`${getOhmytokenApiBase()}/desktop/model-icons`, {
        method: 'GET',
        headers: {
          ...headers,
          Accept: 'application/json',
          ...(current ? { 'If-None-Match': current.etag } : {}),
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
        if (refreshed.status === 'ready')
          response = await request(agentIdentityHeaders(refreshed.identity))
      }
    }
    if (response.status === 304 && current) return
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (Number(response.headers.get('content-length')) > MAX_MANIFEST_BYTES)
      throw new Error('模型图标清单超过大小限制')
    const body = await response.text()
    if (body.length > MAX_MANIFEST_BYTES) throw new Error('模型图标清单超过大小限制')
    const manifest = parseManifest(JSON.parse(body))
    const etag = response.headers.get('etag')
    if (!validEtag(etag)) throw new Error('模型图标清单缺少有效 ETag')
    if (createHash('sha256').update(body).digest('hex') !== etag.slice(1, -1))
      throw new Error('模型图标清单 ETag 与内容不符')
    const next = { etag, manifest }
    await saveManifest(next)
    current = next
    failed.clear()
    announce()
  } finally {
    clearTimeout(timeout)
  }
}

export function refreshModelIcons(): Promise<void> {
  loadCachedModelIcons()
  if (loading) return loading
  loading = fetchManifest()
    .catch((error: unknown) => console.warn('[model-icons] 更新失败，继续使用本地缓存:', error))
    .finally(() => {
      loading = null
    })
  return loading
}

export function startModelIconSync(): void {
  if (syncTimer) return
  loadCachedModelIcons()
  void refreshModelIcons()
  syncTimer = setInterval(() => void refreshModelIcons(), CLOUD_REFERENCE_CHECK_INTERVAL_MS)
  syncTimer.unref()
}

async function loadIcon(icon: ModelIconEntry): Promise<void> {
  await cacheModelIcon(icon, iconPath(icon))
  verified.add(icon.sha256)
  announce()
}

function pump(): void {
  while (running < MAX_PARALLEL_DOWNLOADS && downloads.length) {
    const icon = downloads.shift()!
    running++
    void loadIcon(icon)
      .catch((error: unknown) => {
        failed.add(icon.sha256)
        console.warn(`[model-icons] 图片 ${icon.sha256.slice(0, 12)} 不可用:`, error)
      })
      .finally(() => {
        running--
        queued.delete(icon.sha256)
        pump()
      })
  }
}

/** Called only for models currently visible in either renderer. */
export function ensureModelIcons(modelIds: string[]): void {
  loadCachedModelIcons()
  if (
    !Array.isArray(modelIds) ||
    modelIds.length > 200 ||
    modelIds.some((id) => typeof id !== 'string' || id.length > 256)
  )
    throw new Error('模型图标请求无效')
  const snapshot = modelBrandSnapshot(current?.manifest)
  const families = new Set(modelIds.map((model) => resolveModelBrandId(snapshot, model)))
  for (const icon of current?.manifest.families ?? []) {
    if (!families.has(icon.id)) continue
    if (verified.has(icon.sha256) || queued.has(icon.sha256) || failed.has(icon.sha256)) continue
    queued.add(icon.sha256)
    downloads.push(icon)
  }
  pump()
}

/** Installed after app ready; the URL contains only a checked digest and extension. */
export function installModelIconProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const match = /^\/([a-f0-9]{64})\.(svg|png|jpg|webp|gif)$/.exec(url.pathname)
      if (
        !['GET', 'HEAD'].includes(request.method) ||
        url.hostname !== 'cache' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password ||
        url.port ||
        !match ||
        !verified.has(match[1])
      )
        return new Response(null, { status: 404 })
      const icon = current?.manifest.families.find(
        (item) => item.sha256 === match[1] && modelIconExtension(item.contentType) === match[2],
      )
      if (!icon) return new Response(null, { status: 404 })
      const bytes = await readVerifiedModelIcon(icon, iconPath(icon))
      if (!bytes) {
        verified.delete(icon.sha256)
        announce()
        return new Response(null, { status: 404 })
      }
      return new Response(request.method === 'HEAD' ? null : Uint8Array.from(bytes), {
        headers: {
          'Content-Type': icon.contentType,
          'Content-Length': String(bytes.length),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'",
        },
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
