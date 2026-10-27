import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { parseDocument } from 'yaml'
import { parseJsonConfig } from '../lib/json-config'
import type { TokenPlanProviderId } from '../../shared/token-plan'
import {
  getMavisDataDirCandidates,
  getCodexHomeDir,
  getOpencodeDataDirCandidates,
  getOpencodeDbCandidates,
  resolveUserPath,
} from '../lib/paths'
import { getZCodeDataRoot } from '../lib/zcode-storage'
import { groupQuotaAccounts } from './accounts'
import { kimiCodeHomes, kimiRegion } from './kimi-login'
import { discoverAntigravityGrants } from './antigravity-credentials'
import { readDeepSeekCredentials } from './deepseek-credentials'
import { readMiniMaxCodeCredentials } from './minimax-code-credentials'
import { readOpenCodeCredentials } from './opencode-credentials'
import {
  jwtClaims,
  object,
  textValue,
  timestamp,
  type DiscoveredConnection,
  type DiscoveryResult,
  type JsonObject,
  type AntigravityOAuthGrant,
} from './types'

interface DiscoveryOptions {
  home: string
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  legacy?: Record<string, string>
  antigravityGrants?: Array<{ source: string; grant: AntigravityOAuthGrant }>
}

type Destination = { providerId: TokenPlanProviderId; region: 'cn' | 'global' }
const hosts: Record<string, Destination> = {
  'api.openai.com': { providerId: 'openai', region: 'global' },
  'api.anthropic.com': { providerId: 'anthropic', region: 'global' },
  'open.bigmodel.cn': { providerId: 'zhipu', region: 'cn' },
  'api.z.ai': { providerId: 'zhipu', region: 'global' },
  'api.minimaxi.com': { providerId: 'minimax', region: 'cn' },
  'api.minimax.io': { providerId: 'minimax', region: 'global' },
  'api.kimi.com': { providerId: 'kimi', region: 'cn' },
  'api.kimi.ai': { providerId: 'kimi', region: 'global' },
  'api.deepseek.com': { providerId: 'deepseek', region: 'global' },
  'cli-chat-proxy.grok.com': { providerId: 'xai', region: 'global' },
}
const defaults: Record<string, Destination> = {
  openai: hosts['api.openai.com'],
  anthropic: hosts['api.anthropic.com'],
  'zhipuai-coding-plan': hosts['open.bigmodel.cn'],
  'zai-coding-plan': hosts['api.z.ai'],
  'builtin:bigmodel-coding-plan': hosts['open.bigmodel.cn'],
  'builtin:zai-coding-plan': hosts['api.z.ai'],
  'minimax-cn': hosts['api.minimaxi.com'],
  minimax: hosts['api.minimax.io'],
  'kimi-for-coding': hosts['api.kimi.com'],
  deepseek: hosts['api.deepseek.com'],
}

export function providerDestination(base: unknown, provider?: string): Destination | null {
  const value = textValue(base)
  if (!value) return provider ? (defaults[provider] ?? null) : null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    return hosts[url.hostname.toLowerCase()] ?? null
  } catch {
    return null
  }
}

export function zcodeProjectScope(
  selection: unknown,
  provider: string,
): Partial<DiscoveredConnection> | null {
  const value = textValue(selection)
  if (!value?.startsWith('team-plan:')) return {}
  const prefix = `team-plan:${provider}:`
  if (!value.startsWith(prefix)) return null
  try {
    const parts = value
      .slice(prefix.length)
      .split(':')
      .map((part) => decodeURIComponent(part).trim())
    if (parts.length !== 3 || parts.some((part) => !part || /[\r\n]/.test(part))) return null
    return { organizationId: parts[1], projectId: parts[2] }
  } catch {
    return null
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function parseConfigJson(text: string): JsonObject {
  return object(parseJsonConfig(text))
}

function parseConfigYaml(source: string): JsonObject {
  const document = parseDocument(source, { prettyErrors: false, uniqueKeys: true })
  if (document.errors.length || document.warnings.length) throw new Error('invalid_config')
  const value: unknown = document.toJS({ maxAliasCount: 0 })
  if (value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_config')
  return object(value)
}

export async function discoverQuotaConnections(
  options: DiscoveryOptions,
): Promise<DiscoveryResult> {
  const { home, env } = options
  const found = new Map<string, DiscoveredConnection>()
  const result: DiscoveryResult = { connections: [], checkedSources: [], issues: [] }
  const issue = (source: string, reason: DiscoveryResult['issues'][number]['reason']): void => {
    if (!result.issues.some((item) => item.source === source && item.reason === reason))
      result.issues.push({ source, reason })
  }
  const read = async (
    path: string,
    source: string,
    format: 'json' | 'yaml' = 'json',
  ): Promise<JsonObject> => {
    if (!result.checkedSources.includes(source)) result.checkedSources.push(source)
    try {
      if ((await stat(path)).size > 1024 * 1024) {
        issue(source, 'invalid_config')
        return {}
      }
      const bytes = await readFile(path)
      if (bytes.length > 1024 * 1024) {
        issue(source, 'invalid_config')
        return {}
      }
      return format === 'yaml'
        ? parseConfigYaml(bytes.toString('utf8'))
        : parseConfigJson(bytes.toString('utf8'))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR')
        issue(source, code ? 'unreadable' : 'invalid_config')
      return {}
    }
  }
  const resolveValue = (value: unknown): string | undefined => {
    const text = textValue(value)
    const match = text?.match(/^\{env:([A-Z_][A-Z0-9_]*)\}$/)
    return match ? textValue(env[match[1]]) : text?.startsWith('{') ? undefined : text
  }
  const add = (
    source: string,
    destination: Destination,
    token: unknown,
    authType: 'api-key' | 'oauth',
    fields: Partial<DiscoveredConnection> = {},
  ): void => {
    const secret = resolveValue(token)
    if (!secret || secret.length > 32768 || /[\r\n]/.test(secret)) return
    const claims = authType === 'oauth' ? jwtClaims(secret) : {}
    const auth = object(claims['https://api.openai.com/auth'])
    const accountId =
      fields.accountId ??
      (destination.providerId === 'openai'
        ? textValue(auth.chatgpt_account_id)
        : textValue(claims.sub))
    const fingerprint = digest(secret)
    const scope = [
      destination.providerId,
      destination.region,
      accountId ?? '',
      fields.organizationId ?? '',
      fields.projectId ?? '',
      ...(fields.miniMaxCode ? ['minimax-code-login'] : []),
    ].join(':')
    // 先收集凭据，随后按可确认的账户身份合并。
    const id = digest(`${scope}:${fingerprint}`).slice(0, 32)
    const previous = found.get(id)
    if (previous) {
      if (!previous.public.sources.includes(source)) previous.public.sources.push(source)
      return
    }
    const expiresAt = fields.expiresAt ?? timestamp(claims.exp) ?? undefined
    const unsupported =
      authType === 'api-key' &&
      (['openai', 'anthropic'].includes(destination.providerId) ||
        (destination.providerId === 'minimax' && secret.startsWith('sk-api-')))
    found.set(id, {
      ...fields,
      token: secret,
      fingerprint,
      accountId,
      expiresAt,
      tierHint: fields.tierHint ?? textValue(auth.chatgpt_plan_type),
      public: {
        id,
        ...destination,
        sources: [source],
        authType,
        accountLabel: accountId ? `…${accountId.slice(-6)}` : null,
        state: unsupported
          ? 'unsupported'
          : expiresAt && expiresAt <= Date.now()
            ? 'expired'
            : 'ready',
        scope: fields.projectId || fields.organizationId ? 'project' : 'account',
      },
    })
  }
  const environment = (source: string, values: JsonObject): void => {
    const key = values.ANTHROPIC_AUTH_TOKEN ?? values.ANTHROPIC_API_KEY
    if (key) {
      const destination = providerDestination(values.ANTHROPIC_BASE_URL, 'anthropic')
      if (destination) add(source, destination, key, 'api-key')
      else issue(source, 'unsupported')
    }
    const pairs: Array<[string, Destination]> = [
      ['ZHIPU_API_KEY', hosts['open.bigmodel.cn']],
      ['BIGMODEL_API_KEY', hosts['open.bigmodel.cn']],
      ['ZHIPUAI_API_KEY', hosts['open.bigmodel.cn']],
      ['GLM_API_KEY', hosts['open.bigmodel.cn']],
      ['Z_AI_API_KEY', hosts['api.z.ai']],
      ['KIMI_API_KEY', hosts['api.kimi.com']],
    ]
    for (const [name, destination] of pairs)
      if (values[name]) add(source, destination, values[name], 'api-key')
    if (values.KIMI_CODE_API_KEY) {
      const destination = providerDestination(values.KIMI_CODE_BASE_URL, 'kimi-for-coding')
      if (destination?.providerId === 'kimi')
        add(source, destination, values.KIMI_CODE_API_KEY, 'api-key')
      else issue(source, 'unsupported')
    }
    if (values.DEEPSEEK_API_KEY) {
      const destination = providerDestination(values.DEEPSEEK_BASE_URL, 'deepseek')
      if (destination?.providerId === 'deepseek')
        add(source, destination, values.DEEPSEEK_API_KEY, 'api-key')
      else issue(source, 'unsupported')
    }
    const minimaxKey = values.MINIMAX_CODING_API_KEY ?? values.MINIMAX_API_KEY
    if (minimaxKey) {
      const destination = providerDestination(
        values.MINIMAX_BASE_URL,
        values.MINIMAX_REGION === 'cn' ? 'minimax-cn' : 'minimax',
      )
      if (destination?.providerId === 'minimax') add(source, destination, minimaxKey, 'api-key')
      else issue(source, 'unsupported')
    }
  }
  const providers = (
    source: string,
    config: JsonObject,
    auth: JsonObject = {},
    selections: JsonObject = {},
    preferAuth = false,
  ): void => {
    environment(source, object(config.env))
    const entries = object(config.provider ?? object(config.models).providers)
    for (const id of new Set([...Object.keys(entries), ...Object.keys(auth)])) {
      const entry = object(entries[id])
      if (entry.enabled === false) continue
      const settings = object(entry.options)
      const login = object(auth[id])
      const family =
        id === 'builtin:bigmodel-coding-plan'
          ? 'bigmodel'
          : id === 'builtin:zai-coding-plan'
            ? 'zai'
            : null
      const selectedScope = family ? zcodeProjectScope(selections[family], id) : {}
      if (selectedScope === null) {
        issue(source, 'scope_missing')
        continue
      }
      const destination = providerDestination(
        settings.baseURL ?? entry.baseUrl ?? entry.baseURL,
        source === 'OpenCode' ? (textValue(entry.canonical) ?? id) : id,
      )
      const key =
        preferAuth && login.type === 'oauth'
          ? undefined
          : preferAuth
            ? (login.key ?? settings.apiKey ?? entry.apiKey)
            : (settings.apiKey ?? entry.apiKey ?? login.key)
      if (!destination) {
        if (key || login.access) issue(source, 'unsupported')
        continue
      }
      if (key) add(source, destination, key, 'api-key', selectedScope)
      else if (login.type === 'oauth')
        add(source, destination, login.access, 'oauth', {
          ...selectedScope,
          accountId: textValue(login.accountId),
          expiresAt: timestamp(login.expires) ?? undefined,
        })
    }
  }

  environment('Environment', env)
  result.checkedSources.push('Environment')
  const deepseek = await readDeepSeekCredentials(home, env)
  result.checkedSources.push('DeepSeek Harness')
  result.issues.push(...deepseek.issues)
  if (deepseek.apiKey)
    environment('DeepSeek Harness', {
      DEEPSEEK_API_KEY: deepseek.apiKey,
      DEEPSEEK_BASE_URL: env.DEEPSEEK_BASE_URL,
    })
  if (deepseek.accountGrant)
    add('DeepSeek Harness', hosts['api.deepseek.com'], deepseek.accountGrant.token, 'oauth')
  const claudeHome = resolve(env.CLAUDE_CONFIG_DIR || join(home, '.claude'))
  const claude = object(
    (await read(join(claudeHome, '.credentials.json'), 'Claude Code')).claudeAiOauth,
  )
  add('Claude Code', hosts['api.anthropic.com'], claude.accessToken, 'oauth', {
    expiresAt: timestamp(claude.expiresAt) ?? undefined,
    tierHint: textValue(claude.subscriptionType),
  })
  environment(
    'Claude Code',
    object((await read(join(claudeHome, 'settings.json'), 'Claude Code')).env),
  )

  const codexHome = getCodexHomeDir(home, env)
  const codex = await read(join(codexHome, 'auth.json'), 'Codex')
  const tokens = object(codex.tokens)
  add('Codex', hosts['api.openai.com'], tokens.access_token, 'oauth', {
    accountId: textValue(tokens.account_id),
  })

  const configRoot = env.OPENCODE_CONFIG_DIR?.trim()
    ? resolveUserPath(env.OPENCODE_CONFIG_DIR, home)
    : join(
        env.XDG_CONFIG_HOME ? resolveUserPath(env.XDG_CONFIG_HOME, home) : join(home, '.config'),
        'opencode',
      )
  const opencodeConfig = await read(join(configRoot, 'opencode.json'), 'OpenCode')
  const opencodeJsonc = await read(join(configRoot, 'opencode.jsonc'), 'OpenCode')
  const override = env.OPENCODE_CONFIG
    ? await read(resolveUserPath(env.OPENCODE_CONFIG, home), 'OpenCode')
    : {}
  let inline: JsonObject = {}
  if (env.OPENCODE_CONFIG_CONTENT) {
    try {
      inline = parseConfigJson(env.OPENCODE_CONFIG_CONTENT)
    } catch {
      issue('OpenCode', 'invalid_config')
    }
  }
  const ocProviderConfig: JsonObject = {}
  const ocEnvironment: JsonObject = {}
  for (const config of [opencodeConfig, opencodeJsonc, override, inline]) {
    Object.assign(ocEnvironment, object(config.env))
    for (const entries of [object(config.provider), object(config.providers)]) {
      for (const [id, value] of Object.entries(entries)) {
        const previous = object(ocProviderConfig[id])
        const entry = object(value)
        ocProviderConfig[id] = {
          ...previous,
          ...entry,
          options: {
            ...object(previous.options),
            ...object(entry.options),
            ...object(entry.settings),
          },
        }
      }
    }
  }
  const ocConfig = {
    ...opencodeConfig,
    ...opencodeJsonc,
    ...override,
    ...inline,
    env: ocEnvironment,
    provider: ocProviderConfig,
  }
  const ocPaths = getOpencodeDataDirCandidates(home, env, options.platform)
  const ocDatabases = getOpencodeDbCandidates(home, env, options.platform)
  const ocDatabaseOverride = env.OPENCODE_DB?.trim()
  const ocInMemory = ocDatabaseOverride === ':memory:'
  const comparablePath = (path: string): string =>
    options.platform === 'win32' ? path.toLowerCase() : path
  // Statistics retain historical copies; authentication follows only the current data root.
  const ocCredentials = readOpenCodeCredentials(
    ocDatabaseOverride
      ? ocInMemory
        ? []
        : ocDatabases.slice(0, 1)
      : ocDatabases.filter((path) => comparablePath(dirname(path)) === comparablePath(ocPaths[0])),
  )
  result.issues.push(...ocCredentials.issues)
  if (ocInMemory) issue('OpenCode', 'unsupported')
  if (ocCredentials.authoritative || ocInMemory) {
    providers('OpenCode', ocConfig)
    for (const entry of ocCredentials.entries)
      providers('OpenCode', ocConfig, { [entry.provider]: entry.auth }, {}, true)
  } else
    for (const path of env.XDG_DATA_HOME?.trim() ? ocPaths.slice(0, 1) : ocPaths)
      providers('OpenCode', ocConfig, await read(join(path, 'auth.json'), 'OpenCode'))
  if (env.OPENCODE_AUTH_CONTENT) {
    try {
      providers('OpenCode', ocConfig, parseConfigJson(env.OPENCODE_AUTH_CONTENT))
    } catch {
      issue('OpenCode', 'invalid_config')
    }
  }

  try {
    const zcodeHome = getZCodeDataRoot(home, env)
    const zcode = await read(join(zcodeHome, 'v2', 'config.json'), 'ZCode')
    const zcodeSettings = await read(join(home, '.zcode', 'v2', 'setting.json'), 'ZCode')
    providers('ZCode', zcode, {}, object(zcodeSettings.modelProviderFamilySelectedKeys))
  } catch {
    issue('ZCode', 'invalid_config')
  }

  const mmx = await read(
    join(env.MMX_CONFIG_DIR || join(home, '.mmx'), 'config.json'),
    'MiniMax CLI',
  )
  const mmxDestination = providerDestination(
    env.MINIMAX_BASE_URL || mmx.base_url || object(mmx.oauth).resource_url,
    (env.MINIMAX_REGION || mmx.region) === 'cn' ? 'minimax-cn' : 'minimax',
  )
  if (mmxDestination?.providerId !== 'minimax') issue('MiniMax CLI', 'unsupported')
  else if (mmx.api_key) add('MiniMax CLI', mmxDestination, mmx.api_key, 'api-key')
  else
    add('MiniMax CLI', mmxDestination, object(mmx.oauth).access_token, 'oauth', {
      expiresAt: timestamp(object(mmx.oauth).expires_at) ?? undefined,
    })
  const miniMaxRoots = getMavisDataDirCandidates(home, env, options.platform)
  const miniMaxLogin = await readMiniMaxCodeCredentials(home, env, options.platform, miniMaxRoots)
  result.issues.push(...miniMaxLogin.issues)
  for (const credential of miniMaxLogin.credentials)
    add(
      'MiniMax Code',
      { providerId: 'minimax', region: credential.region },
      credential.token,
      'oauth',
      { miniMaxCode: true, expiresAt: credential.expiresAt },
    )
  for (const root of miniMaxRoots) {
    providers('MiniMax Code', await read(join(root, 'config.json'), 'MiniMax Code'))
    const config = await read(join(root, 'config.yaml'), 'MiniMax Code', 'yaml')
    providers('MiniMax Code', config)
    providers('MiniMax Code', { provider: object(config.custom_provider) })
    const api = object(config.minimax_api)
    if (api.apiKey) {
      // 缺省端点取决于 MiniMax 构建的地区，不能将未知地区的 Key 发往猜测的端点。
      const destination = providerDestination(api.baseURL)
      if (destination?.providerId === 'minimax')
        add('MiniMax Code', destination, api.apiKey, 'api-key')
      else issue('MiniMax Code', 'unsupported')
    }
  }
  for (const root of kimiCodeHomes(home, env)) {
    const kimi = await read(join(root, 'credentials', 'kimi-code.json'), 'Kimi Code')
    const claims = jwtClaims(textValue(kimi.access_token) ?? '')
    const region = kimiRegion(claims.region) ?? 'cn'
    add('Kimi Code', { providerId: 'kimi', region }, kimi.access_token, 'oauth', {
      expiresAt: timestamp(kimi.expires_at) ?? undefined,
    })
  }
  const antigravity = options.antigravityGrants
    ? { grants: options.antigravityGrants, checkedSources: ['Antigravity'], issues: [] }
    : await discoverAntigravityGrants(options)
  result.checkedSources.push(...antigravity.checkedSources)
  result.issues.push(...antigravity.issues)
  for (const { source, grant } of antigravity.grants) {
    const token = textValue(grant.accessToken)
    const refresh = textValue(grant.refreshToken)
    if (!token || token.length > 32768 || /[\r\n]/.test(token)) {
      issue(source, 'invalid_config')
      continue
    }
    const accountId = grant.accountIdentityVerified ? textValue(grant.accountId) : undefined
    const id = digest(
      JSON.stringify([
        'antigravity',
        source,
        accountId ?? '',
        grant.clientId ?? '',
        refresh ?? token,
      ]),
    ).slice(0, 32)
    found.set(id, {
      token,
      fingerprint: digest(token),
      accountId,
      expiresAt: grant.expiresAt,
      projectId: grant.projectId,
      antigravityOAuth: grant,
      public: {
        id,
        providerId: 'antigravity',
        region: 'global',
        sources: [source],
        authType: 'oauth',
        accountLabel: accountId ? `…${accountId.slice(-6)}` : null,
        state:
          grant.expiresAt &&
          grant.expiresAt <= Date.now() &&
          !(grant.refreshToken && grant.clientId && grant.clientSecret)
            ? 'expired'
            : 'ready',
        scope: 'account',
      },
    })
  }
  const grok = await read(join(env.GROK_HOME || join(home, '.grok'), 'auth.json'), 'Grok')
  for (const [scope, value] of Object.entries(grok)) {
    const entry = object(value)
    if (
      scope === 'https://accounts.x.ai/sign-in' ||
      scope.startsWith('https://auth.x.ai::') ||
      scope === 'https://cli-chat-proxy.grok.com' ||
      scope === 'cli-chat-proxy.grok.com'
    ) {
      add('Grok', hosts['cli-chat-proxy.grok.com'], entry.access_token ?? entry.key, 'oauth', {
        accountId: textValue(entry.user_id),
        organizationId: textValue(entry.team_id),
        expiresAt: timestamp(entry.expires_at) ?? undefined,
      })
    } else if (entry.key || entry.access_token) issue('Grok', 'unsupported')
  }
  providers('OpenClaw', await read(join(home, '.openclaw', 'openclaw.json'), 'OpenClaw'))
  providers('Qwen', await read(join(home, '.qwen', 'settings.json'), 'Qwen'))

  const switchPath = join(home, '.cc-switch', 'cc-switch.db')
  result.checkedSources.push('CC Switch')
  try {
    await stat(switchPath)
    const db = new Database(switchPath, { readonly: true, fileMustExist: true })
    try {
      const columns = db.prepare('PRAGMA table_info(providers)').all() as Array<{ name: string }>
      if (columns.some((row) => row.name === 'settings_config')) {
        const records = db
          .prepare('SELECT settings_config FROM providers LIMIT 200')
          .all() as Array<{ settings_config: string }>
        for (const row of records) {
          try {
            const config = parseConfigJson(row.settings_config)
            environment('CC Switch', object(config.env))
            providers('CC Switch', config)
          } catch {
            issue('CC Switch', 'invalid_config')
          }
        }
      }
    } finally {
      db.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') issue('CC Switch', 'unreadable')
  }
  for (const [providerId, token] of Object.entries(options.legacy ?? {})) {
    if (providerId === 'minimax' || providerId === 'zhipu')
      add('Saved connection', { providerId, region: 'cn' }, token, 'api-key')
  }
  result.connections = groupQuotaAccounts([...found.values()])
  return result
}
