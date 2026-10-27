import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { miniMaxDesktopStores } from '../lib/minimax-desktop'
import { object, textValue, type JsonObject } from './types'
import type { TokenPlanDiscoveryIssue } from '../../shared/token-plan'
import {
  readMiniMaxOAuthCredentials,
  type MiniMaxLoginCredential,
} from './minimax-oauth-credentials'

type Region = 'cn' | 'global'

export async function readMiniMaxCodeCredentials(
  home: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  roots: string[],
): Promise<{ credentials: MiniMaxLoginCredential[]; issues: TokenPlanDiscoveryIssue[] }> {
  const credentials: MiniMaxLoginCredential[] = []
  const issues: TokenPlanDiscoveryIssue[] = []
  const issue = (reason: TokenPlanDiscoveryIssue['reason']): void => {
    if (!issues.some((item) => item.reason === reason))
      issues.push({ source: 'MiniMax Code', reason })
  }
  const read = async (file: string): Promise<JsonObject> => {
    try {
      if ((await stat(file)).size > 1024 * 1024) throw new Error('invalid_config')
      const bytes = await readFile(file)
      if (bytes.length > 1024 * 1024) throw new Error('invalid_config')
      const value: unknown = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('invalid_config')
      return object(value)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') issue(code ? 'unreadable' : 'invalid_config')
      return {}
    }
  }
  const add = (value: unknown, region: Region, expiresAt?: number): void => {
    const token = textValue(value)
    if (!token) return
    if (
      token.length > 32768 ||
      [...token].some(
        (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
      )
    ) {
      issue('invalid_config')
      return
    }
    if (!credentials.some((item) => item.region === region && item.token === token))
      credentials.push({ token, region, ...(expiresAt ? { expiresAt } : {}) })
  }
  const canonicalRoots = new Map<string, string>()
  const normalized = (path: string): string =>
    platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
  for (const root of roots)
    canonicalRoots.set(normalized(root), normalized(await realpath(root).catch(() => root)))
  const key = (root: string): string => {
    return canonicalRoots.get(normalized(root)) ?? normalized(root)
  }
  const authoritative = new Map<string, Set<Region>>()
  for (const root of roots) {
    const oauth = await readMiniMaxOAuthCredentials(root)
    for (const entry of oauth.issues) issue(entry.reason)
    const regions = authoritative.get(key(root)) ?? new Set<Region>()
    for (const region of oauth.authoritativeRegions) regions.add(region)
    authoritative.set(key(root), regions)
    for (const credential of oauth.credentials)
      add(credential.token, credential.region, credential.expiresAt)
  }
  const bindings = new Map<string, Set<Region>>()
  for (const source of miniMaxDesktopStores(home, env, platform)) {
    const store = await read(source.file)
    if (!Object.keys(store).length) continue
    const parent = textValue(object(store.config).localRuntimeDataParentDir)
    const configured = env.MINIMAX_DATA_DIR?.trim() || env.MAVIS_DATA_DIR?.trim()
    const root = configured
      ? roots[0]
      : platform === 'win32' && parent && isAbsolute(parent)
        ? join(parent, '.minimax')
        : join(home, '.minimax')
    const regions = bindings.get(key(root)) ?? new Set<Region>()
    regions.add(source.region)
    bindings.set(key(root), regions)
    if (!authoritative.get(key(root))?.has(source.region))
      add(object(store.tokens).accessToken, source.region)
  }

  for (const root of roots) {
    for (const scope of ['cn', 'en', ''] as const) {
      const directory = join(root, 'cli-auth', 'prod', scope)
      const metadata = await read(join(directory, 'cli-auth.scope.json'))
      const selectedRegion = region(metadata.region)
      if (
        metadata.version !== 1 ||
        metadata.buildEnv !== 'prod' ||
        !selectedRegion ||
        (scope && metadata.region !== scope)
      )
        continue
      const privateRecord = await read(join(directory, 'local-runtime.auth.json'))
      if (privateRecord.version === 1 && !authoritative.get(key(root))?.has(selectedRegion))
        add(object(privateRecord.auth).accessToken, selectedRegion)
    }
    if (authoritative.get(key(root))?.size) continue
    const record = await read(join(root, 'local-runtime.auth.json'))
    const auth = record.version === 1 ? object(record.auth) : {}
    const token = textValue(auth.accessToken)
    if (token) {
      const projection = await read(join(root, 'cli-auth', 'shared-projection.json'))
      const normalized = Object.fromEntries(
        ['accessToken', 'realUserID', 'userEmail', 'userName', 'subUserName'].flatMap((field) => {
          const value = textValue(auth[field])
          return value ? [[field, value]] : []
        }),
      )
      const fingerprint =
        'sha256:' + createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
      const projectedRegion =
        projection.version === 1 &&
        projection.buildEnv === 'prod' &&
        projection.authFingerprint === fingerprint
          ? region(projection.region)
          : undefined
      const matching = credentials.filter((item) => item.token === token)
      const regions = projectedRegion
        ? new Set([projectedRegion])
        : matching.length
          ? new Set(matching.map((item) => item.region))
          : bindings.get(key(root))
      if (regions?.size === 1) add(token, [...regions][0])
      else issue('scope_missing')
    }
  }
  return { credentials, issues }
}

function region(value: unknown): Region | undefined {
  return value === 'cn' ? 'cn' : value === 'en' ? 'global' : undefined
}
