import { app, protocol } from 'electron'
import { join } from 'node:path'
import type { DiscoveryPageKey, DiscoveryUiLocation } from '../../shared/discovery-ui'
import { DISCOVERY_PAGE_KEYS } from '../../shared/discovery-ui'
import { resolveDiscoveryDevelopmentUrl } from '../../shared/discovery-development'
import { DiscoveryUiCache } from './discovery-ui-cache'
import { collectDiscoveryFonts, type DiscoveryFonts } from './discovery-fonts'
import { loadDiscoveryEntry } from './discovery-request.service'
import { getOhmytokenApiBase } from './server-config.service'
import { discoveryProtocolHandler } from './discovery-protocol'
export { registerDiscoveryScheme } from './discovery-protocol'

const SCHEME = 'omt-discovery'
let cache: DiscoveryUiCache | undefined
let fonts: Promise<DiscoveryFonts> | undefined
const allowedFrameUrls = new Set<string>()

function getCache(): DiscoveryUiCache {
  cache ??= new DiscoveryUiCache({
    directory: join(app.getPath('userData'), 'discovery-ui-cache'),
    loadEntry: loadDiscoveryEntry,
  })
  return cache
}
function getFonts(): Promise<DiscoveryFonts> {
  fonts ??= collectDiscoveryFonts(
    join(__dirname, '../renderer'),
    !app.isPackaged && process.env.ELECTRON_RENDERER_URL
      ? join(__dirname, '../../src/renderer/src')
      : undefined,
  ).catch((error) => {
    fonts = undefined
    throw error
  })
  return fonts
}
function developmentUrl(): string | null {
  return resolveDiscoveryDevelopmentUrl({
    packaged: app.isPackaged,
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    apiBase: getOhmytokenApiBase(),
    override: process.env.OHMYTOKEN_DISCOVERY_DEV_URL,
  })
}
export async function openDiscoveryUi(
  pageKey: DiscoveryPageKey,
  force = false,
): Promise<DiscoveryUiLocation> {
  if (!DISCOVERY_PAGE_KEYS.includes(pageKey) || typeof force !== 'boolean')
    throw new Error('Invalid discovery page')
  const local = developmentUrl()
  const entry = local ? null : await getCache().open(pageKey, force)
  const url = local ?? `${SCHEME}://bundle/${entry!.releaseId}/${entry!.entryPath}`
  const fontStyles = (await getFonts()).css
  allowedFrameUrls.add(url)
  if (allowedFrameUrls.size > 16) allowedFrameUrls.delete(allowedFrameUrls.values().next().value!)
  if (entry) getCache().retain(entry.releaseId)
  return {
    url,
    origin: local ? new URL(local).origin : `${SCHEME}://bundle`,
    releaseId: entry?.releaseId ?? 'local-development',
    fontStyles,
    apiScope: getOhmytokenApiBase(),
  }
}
export function isDiscoveryFrameUrl(url: string): boolean {
  return allowedFrameUrls.has(url.split('#')[0])
}

/** On the main renderer's session, after ready and before first navigation. */
export function installDiscoveryProtocol(): void {
  protocol.handle(
    SCHEME,
    discoveryProtocolHandler({
      font: getFonts,
      resource: (release, path) => getCache().resource(release, path),
    }),
  )
}
