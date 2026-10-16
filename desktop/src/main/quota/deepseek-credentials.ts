import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseDocument } from 'yaml'
import type { TokenPlanDiscoveryIssue } from '../../shared/token-plan'
import { object, textValue } from './types'

interface DeepSeekCredentials {
  apiKey?: string
  accountGrant?: { token: string; issuer: string }
}

function secret(value: unknown): string {
  const token = textValue(value)
  if (!token || token.length > 32768 || !/^[\x21-\x7e]+$/.test(token))
    throw new Error('invalid_config')
  return token
}

/** Read only the official DeepSeek reference and account record; YAML diagnostics can contain secrets. */
export function parseDeepSeekCredentials(source: string): DeepSeekCredentials {
  const document = parseDocument(source, { prettyErrors: false, uniqueKeys: true })
  if (document.errors.length || document.warnings.length) throw new Error('invalid_config')
  const value: unknown = document.toJS({ maxAliasCount: 0 })
  if (value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_config')
  const root = object(value)
  if (!Object.keys(root).length) return {}
  // Early Harness releases stored a flat reference map. Never migrate or write the source file.
  if (!Object.hasOwn(root, 'version')) {
    if (
      !Object.entries(root).every(
        ([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string',
      )
    )
      throw new Error('invalid_config')
    return root.DEEPSEEK_API_KEY === undefined ? {} : { apiKey: secret(root.DEEPSEEK_API_KEY) }
  }
  if (root.version !== 1) throw new Error('invalid_config')
  for (const field of ['refs', 'records']) {
    const section = root[field]
    if (section != null && (typeof section !== 'object' || Array.isArray(section)))
      throw new Error('invalid_config')
  }
  const result: DeepSeekCredentials = {}
  const refs = object(root.refs)
  if (refs.DEEPSEEK_API_KEY !== undefined) result.apiKey = secret(refs.DEEPSEEK_API_KEY)
  const stored = object(root.records)['deepseek-account-platform/default']
  if (stored !== undefined) {
    const record = object(stored)
    const payload = object(record.payload)
    const issuer = textValue(payload.issuer)
    if (record.kind !== 'grant' || payload.version !== 1 || !issuer)
      throw new Error('invalid_config')
    result.accountGrant = { token: secret(payload.token), issuer }
  }
  return result
}

export async function readDeepSeekCredentials(
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<DeepSeekCredentials & { issues: TokenPlanDiscoveryIssue[] }> {
  const source = 'DeepSeek Harness'
  const issues: TokenPlanDiscoveryIssue[] = []
  const file = join(resolve(env.DSH_HOME || join(home, '.dsh')), '.credentials.yaml')
  try {
    if ((await stat(file)).size > 1024 * 1024) throw new Error('invalid_config')
    const bytes = await readFile(file)
    if (bytes.length > 1024 * 1024) throw new Error('invalid_config')
    const credentials = parseDeepSeekCredentials(bytes.toString('utf8'))
    if (
      credentials.accountGrant &&
      credentials.accountGrant.issuer !== 'https://platform.deepseek.com'
    ) {
      delete credentials.accountGrant
      issues.push({ source, reason: 'unsupported' })
    }
    return { ...credentials, issues }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR')
      issues.push({ source, reason: code ? 'unreadable' : 'invalid_config' })
    return { issues }
  }
}
