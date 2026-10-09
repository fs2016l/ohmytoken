import { app, safeStorage } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import {
  QUOTA_REFRESH_INTERVALS,
  TOKEN_PLAN_PROVIDER_IDS,
  type QuotaRefreshInterval,
  type TokenPlanConnection,
  type TokenPlanInventory,
  type TokenPlanMonitorState,
  type TokenPlanUsageSnapshot,
} from '../../shared/token-plan'
import { QuotaRefreshController } from '../quota/refresh-controller'
import { discoverQuotaConnections } from '../quota/discovery'
import { QuotaCache } from '../quota/cache'
import { QuotaQueryError } from '../quota/transport'
import { fetchAccountQuota, groupQuotaAccounts } from '../quota/accounts'
import { identifyZhipuAccounts } from '../quota/zhipu-account'
import { object, textValue, type DiscoveryResult } from '../quota/types'
import type { QuotaDetailQuery, QuotaDetails } from '../../shared/quota-details'
import { QuotaDetailCache } from '../quota/detail-cache'
import { withQuotaRegionCheck } from '../quota/region-guard'

let inventory: DiscoveryResult | null = null
let discoveredAt = 0
let discovery: Promise<TokenPlanInventory> | null = null
let restored = false
let saving = Promise.resolve()
const cache = new QuotaCache(fetchAccountQuota)
const detailCache = new QuotaDetailCache()
let detailsRestored = false
let detailSaving = Promise.resolve()
let cachedConnections: TokenPlanConnection[] = []

// Read only public fields, even if an older or edited cache contains extra properties.
function publicConnection(value: unknown): TokenPlanConnection | null {
  const row = object(value)
  if (
    typeof row.id !== 'string' ||
    !/^[a-f0-9]{32}$/.test(row.id) ||
    !TOKEN_PLAN_PROVIDER_IDS.includes(row.providerId as TokenPlanConnection['providerId']) ||
    !['cn', 'global'].includes(String(row.region)) ||
    !['oauth', 'api-key', 'client'].includes(String(row.authType)) ||
    !['ready', 'expired', 'unsupported'].includes(String(row.state))
  )
    return null
  return {
    id: row.id,
    providerId: row.providerId as TokenPlanConnection['providerId'],
    region: row.region as TokenPlanConnection['region'],
    sources: Array.isArray(row.sources)
      ? row.sources.filter((v): v is string => typeof v === 'string').slice(0, 30)
      : [],
    accountLabel: textValue(row.accountLabel) ?? null,
    authType: row.authType as TokenPlanConnection['authType'],
    state: row.state as TokenPlanConnection['state'],
    scope: row.scope === 'project' ? 'project' : 'account',
    identity: row.identity === 'account' ? 'account' : 'credential',
    connectionCount: typeof row.connectionCount === 'number' ? row.connectionCount : undefined,
  }
}

async function savedConnections(): Promise<Record<string, string>> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return {}
    const bytes = await readFile(join(app.getPath('userData'), 'token-plan-credentials.enc'))
    if (bytes.length > 64 * 1024 || bytes.subarray(0, 5).toString() !== 'ENC1:') return {}
    const parsed = object(JSON.parse(safeStorage.decryptString(bytes.subarray(5))))
    const result: Record<string, string> = {}
    for (const id of ['minimax', 'zhipu']) {
      const key = textValue(object(parsed[id]).apiKey)
      if (key) result[id] = key
    }
    return result
  } catch {
    return {}
  }
}

function snapshotPath(): string {
  return join(app.getPath('userData'), 'quota-snapshots.json')
}

async function restoreSnapshots(): Promise<void> {
  if (restored) return
  restored = true
  try {
    const raw = await readFile(snapshotPath())
    if (raw.length > 1024 * 1024) return
    const payload = object(JSON.parse(raw.toString('utf8')))
    if (payload.version === 1 && Array.isArray(payload.snapshots)) cache.restore(payload.snapshots)
    if (Array.isArray(payload.connections))
      cachedConnections = payload.connections
        .map(publicConnection)
        .filter((row): row is TokenPlanConnection => row !== null)
    if (typeof payload.discoveredAt === 'number') discoveredAt = payload.discoveredAt
  } catch {
    /* 首次启动或缓存损坏时重新查询。 */
  }
}

function currentInventory(): TokenPlanInventory {
  return {
    connections: inventory?.connections.map((row) => row.public) ?? cachedConnections,
    snapshots: cache.list(),
    issues: inventory?.issues ?? [],
    checkedSources: inventory?.checkedSources ?? [],
    discoveredAt,
  }
}

/** Opening either quota view reads disk/local configuration without contacting providers. */
export async function readCachedTokenPlanInventory(): Promise<TokenPlanInventory> {
  await restoreSnapshots()
  if (!inventory && !cachedConnections.length) {
    const found = await discoverQuotaConnections({
      home: homedir(),
      env: process.env,
      platform: process.platform,
      legacy: await savedConnections(),
    })
    cachedConnections = groupQuotaAccounts(found.connections).map((row) => row.public)
    return { ...currentInventory(), issues: found.issues, checkedSources: found.checkedSources }
  }
  return currentInventory()
}

export function createTokenPlanMonitor(
  publish: (state: TokenPlanMonitorState) => void,
): QuotaRefreshController {
  return new QuotaRefreshController({
    read: readCachedTokenPlanInventory,
    discover: () => discoverTokenPlanConnections(true),
    query: (id) => queryTokenPlanUsage(id, true),
    runRefresh: withQuotaRegionCheck,
    loadInterval: async () => {
      try {
        const value = object(
          JSON.parse(await readFile(join(app.getPath('userData'), 'quota-refresh.json'), 'utf8')),
        ).interval
        return typeof value === 'number' &&
          QUOTA_REFRESH_INTERVALS.includes(value as QuotaRefreshInterval)
          ? value
          : 0
      } catch {
        return 0
      }
    },
    saveInterval: async (interval) => {
      const path = join(app.getPath('userData'), 'quota-refresh.json')
      await mkdir(app.getPath('userData'), { recursive: true })
      await writeFile(path + '.tmp', JSON.stringify({ interval }), { mode: 0o600 })
      await rename(path + '.tmp', path)
    },
    publish,
  })
}

export function discoverTokenPlanConnections(force = false): Promise<TokenPlanInventory> {
  if (discovery) return discovery
  if (!force && inventory && Date.now() - discoveredAt < 60_000)
    return Promise.resolve(currentInventory())
  discovery = (async () => {
    await restoreSnapshots()
    const found = await discoverQuotaConnections({
      home: homedir(),
      env: process.env,
      platform: process.platform,
      legacy: await savedConnections(),
    })
    await identifyZhipuAccounts(found.connections, { home: homedir(), env: process.env })
    found.connections = groupQuotaAccounts(found.connections)
    inventory = found
    discoveredAt = Date.now()
    cache.reconcile(found.connections)
    detailCache.reconcile(found.connections)
    persistSnapshots()
    return currentInventory()
  })().finally(() => {
    discovery = null
  })
  return discovery
}

function persistSnapshots(): void {
  const payload = JSON.stringify({
    version: 1,
    snapshots: cache.list().filter((row) => row.observedAt !== null),
    connections: currentInventory().connections,
    discoveredAt,
  })
  saving = saving
    .catch(() => undefined)
    .then(async () => {
      const path = snapshotPath()
      await mkdir(app.getPath('userData'), { recursive: true })
      await writeFile(path + '.tmp', payload, { mode: 0o600 })
      await rename(path + '.tmp', path)
    })
    .catch(() => undefined)
}

export async function queryTokenPlanUsage(
  id: string,
  force = false,
): Promise<TokenPlanUsageSnapshot> {
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))
    throw new QuotaQueryError('not_connected')
  await discoverTokenPlanConnections()
  const connection = inventory?.connections.find((row) => row.public.id === id)
  if (!connection) throw new QuotaQueryError('not_connected')
  const snapshot = await withQuotaRegionCheck(() => cache.refresh(connection, force === true))
  persistSnapshots()
  return snapshot
}

export async function queryTokenPlanDetails(
  id: string,
  query: QuotaDetailQuery,
): Promise<QuotaDetails> {
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))
    throw new QuotaQueryError('not_connected')
  await discoverTokenPlanConnections()
  const connection = inventory?.connections.find((row) => row.public.id === id)
  if (!connection) throw new QuotaQueryError('not_connected')
  const path = join(app.getPath('userData'), 'quota-details.json')
  if (!detailsRestored) {
    detailsRestored = true
    try {
      if ((await stat(path)).size <= 8 * 1024 * 1024)
        detailCache.restore(await readFile(path, 'utf8'))
    } catch {
      /* 首次查询。 */
    }
    detailCache.reconcile(inventory!.connections)
  }
  const result = await withQuotaRegionCheck(() => detailCache.query(connection, query))
  const payload = detailCache.serialize()
  detailSaving = detailSaving
    .catch(() => undefined)
    .then(async () => {
      await mkdir(app.getPath('userData'), { recursive: true })
      await writeFile(path + '.tmp', payload, { mode: 0o600 })
      await rename(path + '.tmp', path)
    })
    .catch(() => undefined)
  return result
}
