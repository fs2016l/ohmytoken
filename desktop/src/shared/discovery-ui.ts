import type {
  AccountFavoriteResult,
  AccountFavoritesState,
  AccountFavoriteTarget,
} from './account-favorites'
import type { BrowsingPageSnapshot, BrowsingSnapshot } from './browsing-state'
import type { ExchangeRateState } from './cost-currency'

export const DISCOVERY_BRIDGE_CHANNEL = 'ohmytoken-discovery-v1'
export const DISCOVERY_PAGE_KEYS = ['insights', 'comparison', 'agents'] as const
export type DiscoveryPageKey = (typeof DISCOVERY_PAGE_KEYS)[number]

export interface DiscoveryUiAsset {
  path: string
  sha256: string
  size: number
  contentType: string
}
export interface DiscoveryUiManifest {
  format: 1
  releaseId: string
  entryPath: string
  files: DiscoveryUiAsset[]
}
export interface DiscoveryUiEntry {
  pageKey: DiscoveryPageKey
  revision: number
  releaseId: string
  entryPath: string
  expiresAt: number
  refreshAfterSeconds: number
  resources: (DiscoveryUiAsset & { url: string })[]
}
export interface DiscoveryUser {
  id: number
  username: string
  nickname: string | null
  avatar: string | null
}
export interface DiscoveryHostContext {
  route: string
  active: boolean
  language: 'zh' | 'en'
  currency: 'USD' | 'CNY'
  readingSizes: { article: number | null; agent: number | null }
  apiScope: string
  auth: { user: DiscoveryUser | null; hydrating: boolean }
  appearance: {
    attributes: Record<string, string>
    variables: Record<string, string>
    fontStyles: string
  }
  viewport: {
    width: number
    height: number
    x: number
    y: number
    contentWidth: number
    contentHeight: number
  }
}
export const DISCOVERY_CATALOG_KEYS = [
  'discoveryConfig',
  'plans',
  'planTier',
  'apiModels',
  'apiModel',
  'agents',
  'agent',
  'articles',
  'article',
] as const
export type DiscoveryCatalogKey = (typeof DISCOVERY_CATALOG_KEYS)[number]
export interface DiscoveryCatalogRequest {
  key: DiscoveryCatalogKey
  method: 'GET' | 'POST'
  parameters?: Record<string, string | number>
  query?: Record<string, unknown>
  body?: Record<string, unknown>
}
export interface DiscoveryOperations {
  catalog: { args: DiscoveryCatalogRequest; result: unknown }
  favoritesList: { args: { remote: boolean }; result: AccountFavoritesState }
  favoriteSet: {
    args: { target: AccountFavoriteTarget; desired: boolean }
    result: AccountFavoriteResult
  }
  browsingRead: { args: Record<string, never>; result: BrowsingSnapshot }
  browsingWrite: { args: { key: string; value: BrowsingPageSnapshot }; result: void }
  exchangeRates: { args: { force: boolean }; result: ExchangeRateState }
  openExternal: { args: { url: string }; result: void }
  clipboardWrite: { args: { text: string }; result: void }
  requestLogin: { args: Record<string, never>; result: void }
  navigate: { args: { route: string; replace: boolean }; result: void }
  currency: { args: { currency: 'USD' | 'CNY' }; result: void }
  readingSize: { args: { kind: 'article' | 'agent'; size: number }; result: void }
}
export type DiscoveryOperation = keyof DiscoveryOperations
export interface DiscoveryRpcError {
  message: string
  code?: string
  status?: number
}

export type DiscoveryNativeResult<T> =
  { ok: true; value: T } | { ok: false; error: DiscoveryRpcError }

export interface DiscoveryUiLocation {
  url: string
  origin: string
  releaseId: string
  fontStyles: string
  apiScope: string
}

/** These methods are available only to the trusted, top-level Agent renderer. */
export interface DiscoveryNativeAPI {
  discoveryCopy(text: string): Promise<void>
  discoveryUiOpen(
    pageKey: DiscoveryPageKey,
    force?: boolean,
  ): Promise<DiscoveryNativeResult<DiscoveryUiLocation>>
  discoveryCatalog(request: DiscoveryCatalogRequest): Promise<DiscoveryNativeResult<unknown>>
}

export const DISCOVERY_IPC = {
  DISCOVERY_COPY: 'discovery-ui:copy',
  DISCOVERY_UI_OPEN: 'discovery-ui:open',
  DISCOVERY_CATALOG: 'discovery-ui:catalog',
} as const

/** Route classification is native navigation only; the matching HTML/version comes from com. */
export function discoveryPageKey(route: string): DiscoveryPageKey | null {
  const path = route.split('?')[0]
  if (/^\/insight(?:\/(?:favorites|\d+))?$/.test(path)) return 'insights'
  if (/^\/codingplan(?:\/favorites)?$/.test(path)) return 'comparison'
  if (/^\/agent-download(?:\/(?:favorites|\d+))?$/.test(path)) return 'agents'
  return null
}
