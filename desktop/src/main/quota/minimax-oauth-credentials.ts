import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { TokenPlanDiscoveryIssue } from '../../shared/token-plan'
import { object, textValue, type JsonObject } from './types'

export type MiniMaxRegion = 'cn' | 'global'
export interface MiniMaxLoginCredential {
  token: string
  region: MiniMaxRegion
  expiresAt?: number
}

/** Read committed first-party OAuth leases; never refresh or modify the native store. */
export async function readMiniMaxOAuthCredentials(root: string): Promise<{
  credentials: MiniMaxLoginCredential[]
  authoritativeRegions: Set<MiniMaxRegion>
  issues: TokenPlanDiscoveryIssue[]
}> {
  const credentials: MiniMaxLoginCredential[] = []
  const authoritativeRegions = new Set<MiniMaxRegion>()
  const issues: TokenPlanDiscoveryIssue[] = []
  const issue = (reason: TokenPlanDiscoveryIssue['reason']): void => {
    if (!issues.some((row) => row.reason === reason))
      issues.push({ source: 'MiniMax Code', reason })
  }
  const read = async (file: string): Promise<JsonObject | undefined> => {
    const info = await stat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined
      throw error
    })
    if (!info) return undefined
    if (!info.isFile() || info.size > 1024 * 1024) throw new SyntaxError()
    const bytes = await readFile(file)
    if (bytes.length > 1024 * 1024) throw new SyntaxError()
    const parsed: unknown = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError()
    return object(parsed)
  }
  const authHome = join(resolve(root), 'auth')
  const account = createHash('sha256').update(`${authHome}\0mcode-public`).digest('base64url')
  for (const scope of ['cn', 'en'] as const) {
    const region: MiniMaxRegion = scope === 'cn' ? 'cn' : 'global'
    const directory = join(authHome, 'prod', scope, 'mcode-public')
    try {
      const state = await read(join(directory, 'auth-state.json'))
      const store = await read(join(directory, 'auth.json'))
      if (!state && !store) continue
      authoritativeRegions.add(region)
      if (!state || !store) {
        // Logout may legitimately remove credentials while retaining its public state.
        if (
          state &&
          ['anonymous', 'logging_out', 'logout_pending', 'authorizing'].includes(
            String(state.status),
          )
        )
          continue
        issue('invalid_config')
        continue
      }
      if (
        (state.schemaVersion !== 1 && state.schemaVersion !== 2) ||
        state.clientId !== 'mcode-public' ||
        state.audience !== 'agent-backend' ||
        (state.buildEnv !== undefined && state.buildEnv !== 'prod') ||
        (state.region !== undefined && state.region !== scope) ||
        !Number.isSafeInteger(state.generation) ||
        Number(state.generation) < 0
      ) {
        issue('invalid_config')
        continue
      }
      if (state.storeKind !== 'file') {
        issue('unsupported')
        continue
      }
      if (!['authenticated', 'expired'].includes(String(state.status))) continue
      if (store.schemaVersion !== 1) {
        issue('invalid_config')
        continue
      }
      const record = object(
        object(store.records)[`com.minimax.mcode.oauth.prod.${scope}\0${account}`],
      )
      // Historical aliases can contain the same file under a different lexical root.
      if (!Object.keys(record).length) continue
      const expiry = record.expiresAtMs
      if (
        record.schemaVersion !== 1 ||
        record.clientId !== 'mcode-public' ||
        record.audience !== 'agent-backend' ||
        record.tokenType !== 'Bearer' ||
        record.generation !== state.generation ||
        typeof expiry !== 'number' ||
        !Number.isFinite(expiry) ||
        expiry <= 0 ||
        expiry > 8_640_000_000_000_000 ||
        !textValue(record.refreshToken)
      ) {
        issue('invalid_config')
        continue
      }
      if (
        ![state.scopes, record.scopes].every(
          (scopes) =>
            Array.isArray(scopes) &&
            scopes.every((scope) => typeof scope === 'string') &&
            scopes.includes('agent.default'),
        )
      ) {
        issue('scope_missing')
        continue
      }
      if (process.platform !== 'win32') {
        const [folder, file] = await Promise.all([
          stat(directory),
          stat(join(directory, 'auth.json')),
        ])
        if ((folder.mode & 0o077) !== 0 || (file.mode & 0o077) !== 0) throw new Error()
      }
      const token = textValue(record.accessToken)
      if (
        !token ||
        token.length > 32768 ||
        /\s/.test(token) ||
        [...token].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      ) {
        issue('invalid_config')
        continue
      }
      credentials.push({
        token,
        region,
        expiresAt: state.status === 'expired' ? Math.min(expiry, Date.now() - 1) : expiry,
      })
    } catch (error) {
      authoritativeRegions.add(region)
      issue(error instanceof SyntaxError ? 'invalid_config' : 'unreadable')
    }
  }
  return { credentials, authoritativeRegions, issues }
}
