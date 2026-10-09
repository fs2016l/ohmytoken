import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import type { TokenPlanProviderId } from '../../shared/token-plan'
import { groupQuotaAccounts } from './accounts'
import { kimiCodeHomes, kimiRegion } from './kimi-login'
import {
  jwtClaims,
  object,
  textValue,
  timestamp,
  type DiscoveredConnection,
  type DiscoveryResult,
  type JsonObject,
} from './types'

interface DiscoveryOptions {
  home: string
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  legacy?: Record<string, string>
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
  let cleaned = ''
  let quoted = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      cleaned += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') {
      quoted = true
      cleaned += char
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      cleaned += '\n'
    } else if (char === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
      cleaned += ' '
    } else cleaned += char
  }
  let normalized = ''
  let comma = -1
  quoted = false
  escaped = false
  for (const char of cleaned) {
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') {
      quoted = true
      comma = -1
    } else if (char === ',') comma = normalized.length
    else if (!/\s/.test(char)) {
      if ((char === '}' || char === ']') && comma >= 0)
        normalized = normalized.slice(0, comma) + normalized.slice(comma + 1)
      comma = -1
    }
    normalized += char
  }
  return object(JSON.parse(normalized.replace(/^\uFEFF/, '')))
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
  const read = async (path: string, source: string): Promise<JsonObject> => {
    if (!result.checkedSources.includes(source)) result.checkedSources.push(source)
    try {
      if ((await stat(path)).size > 1024 * 1024) {
        issue(source, 'invalid_config')
        return {}
      }
      return parseConfigJson(await readFile(path, 'utf8'))
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
      (['openai', 'anthropic', 'google'].includes(destination.providerId) ||
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
        id,
      )
      const key = settings.apiKey ?? entry.apiKey ?? login.key
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

  const codexHome = resolve(env.CODEX_HOME || join(home, '.codex'))
  const codex = await read(join(codexHome, 'auth.json'), 'Codex')
  const tokens = object(codex.tokens)
  add('Codex', hosts['api.openai.com'], tokens.access_token, 'oauth', {
    accountId: textValue(tokens.account_id),
  })

  const configRoot = env.XDG_CONFIG_HOME || join(home, '.config')
  const dataRoot = env.XDG_DATA_HOME || join(home, '.local', 'share')
  const opencodeConfig = await read(join(configRoot, 'opencode', 'opencode.json'), 'OpenCode')
  const opencodeJsonc = await read(join(configRoot, 'opencode', 'opencode.jsonc'), 'OpenCode')
  const override = env.OPENCODE_CONFIG ? await read(resolve(env.OPENCODE_CONFIG), 'OpenCode') : {}
  const ocConfig = {
    ...opencodeConfig,
    ...opencodeJsonc,
    ...override,
    provider: {
      ...object(opencodeConfig.provider),
      ...object(opencodeJsonc.provider),
      ...object(override.provider),
    },
  }
  const ocPaths = [join(dataRoot, 'opencode'), join(home, '.local', 'share', 'opencode')]
  if (options.platform === 'win32')
    ocPaths.push(join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'ai.opencode.desktop'))
  for (const path of new Set(ocPaths))
    providers('OpenCode', ocConfig, await read(join(path, 'auth.json'), 'OpenCode'))
  if (env.OPENCODE_AUTH_CONTENT) {
    try {
      providers('OpenCode', ocConfig, parseConfigJson(env.OPENCODE_AUTH_CONTENT))
    } catch {
      issue('OpenCode', 'invalid_config')
    }
  }

  const zcodeHome = resolve(env.ZCODE_HOME || join(home, '.zcode'))
  const zcode = await read(join(zcodeHome, 'v2', 'config.json'), 'ZCode')
  const zcodeSettings = await read(join(zcodeHome, 'v2', 'setting.json'), 'ZCode')
  providers('ZCode', zcode, {}, object(zcodeSettings.modelProviderFamilySelectedKeys))

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
  for (const path of [join(home, '.mavis', 'config.json'), join(home, '.minimax', 'config.json')]) {
    providers('MiniMax Code', await read(path, 'MiniMax Code'))
  }
  for (const root of kimiCodeHomes(home, env)) {
    const kimi = await read(join(root, 'credentials', 'kimi-code.json'), 'Kimi Code')
    const claims = jwtClaims(textValue(kimi.access_token) ?? '')
    const region = kimiRegion(claims.region) ?? 'cn'
    add('Kimi Code', { providerId: 'kimi', region }, kimi.access_token, 'oauth', {
      expiresAt: timestamp(kimi.expires_at) ?? undefined,
    })
  }
  const google = await read(join(home, '.gemini', 'oauth_creds.json'), 'Gemini')
  add('Gemini', { providerId: 'google', region: 'global' }, google.access_token, 'oauth', {
    expiresAt: timestamp(google.expiry_date) ?? undefined,
  })
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
