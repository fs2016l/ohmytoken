import {
  DISCOVERY_PAGE_KEYS,
  type DiscoveryPageKey,
  type DiscoveryUiEntry,
} from '../../shared/discovery-ui'

export const MAX_DISCOVERY_FILE_BYTES = 16 * 1024 * 1024
const TYPES: Record<string, string> = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
}

export function validDiscoveryPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length <= 240 &&
    /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/.test(path)
  )
}

/** Accept only the exact immutable asset directory declared by the trusted com API. */
export function parseDiscoveryEntry(
  input: unknown,
  pageKey: DiscoveryPageKey,
  now = Date.now(),
): DiscoveryUiEntry {
  if (!input || typeof input !== 'object' || !DISCOVERY_PAGE_KEYS.includes(pageKey))
    throw new Error('Invalid discovery entry')
  const value = input as DiscoveryUiEntry
  if (
    value.pageKey !== pageKey ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.releaseId !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{7,63}$/.test(value.releaseId) ||
    !validDiscoveryPath(value.entryPath) ||
    !value.entryPath.endsWith('.html') ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= now ||
    value.expiresAt > now + 86_460_000 ||
    !Number.isInteger(value.refreshAfterSeconds) ||
    value.refreshAfterSeconds < 1 ||
    value.refreshAfterSeconds > 300 ||
    !Array.isArray(value.resources) ||
    !value.resources.length ||
    value.resources.length > 512
  )
    throw new Error('Invalid discovery entry')
  let origin = ''
  let bytes = 0
  const paths = new Set<string>()
  const resources = value.resources.map((resource) => {
    if (
      !resource ||
      !validDiscoveryPath(resource.path) ||
      paths.has(resource.path) ||
      !/^[a-f0-9]{64}$/.test(resource.sha256) ||
      !Number.isSafeInteger(resource.size) ||
      resource.size < 1 ||
      resource.size > MAX_DISCOVERY_FILE_BYTES ||
      TYPES[resource.path.split('.').pop()!] !== resource.contentType ||
      typeof resource.url !== 'string' ||
      resource.url.length > 2048
    )
      throw new Error('Invalid discovery resource')
    const url = new URL(resource.url)
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port !== '' && url.port !== '443') ||
      url.pathname !== `/discovery/${value.releaseId}/${resource.path}` ||
      !/^\?sign=\d{1,12}-[A-Za-z0-9]{0,100}-0-[a-f0-9]{32}$/.test(url.search) ||
      (origin && url.origin !== origin)
    )
      throw new Error('Untrusted discovery resource URL')
    origin = url.origin
    paths.add(resource.path)
    bytes += resource.size
    return {
      path: resource.path,
      sha256: resource.sha256,
      size: resource.size,
      contentType: resource.contentType,
      url: url.href,
    }
  })
  if (bytes > 64 * 1024 * 1024 || !paths.has(value.entryPath))
    throw new Error('Invalid discovery resource manifest')
  return {
    pageKey,
    revision: value.revision,
    releaseId: value.releaseId,
    entryPath: value.entryPath,
    expiresAt: value.expiresAt,
    refreshAfterSeconds: value.refreshAfterSeconds,
    resources,
  }
}

export function sameDiscoveryRelease(first: DiscoveryUiEntry, second: DiscoveryUiEntry): boolean {
  if (
    first.releaseId !== second.releaseId ||
    first.entryPath !== second.entryPath ||
    first.resources.length !== second.resources.length
  )
    return false
  const assets = new Map(first.resources.map((asset) => [asset.path, asset]))
  return second.resources.every((asset) => {
    const previous = assets.get(asset.path)
    return (
      previous?.sha256 === asset.sha256 &&
      previous.size === asset.size &&
      previous.contentType === asset.contentType
    )
  })
}
