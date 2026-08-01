import type { DesktopRuntimeConfig } from '../../shared/runtime-config'
import { getOhmytokenApiBase, isTrustedDevelopmentHttp } from './server-config.service'

interface ResponseResult<T> {
  code?: number
  message?: string
  data?: T
}

const REQUEST_TIMEOUT_MS = 10_000
const MIN_CACHE_TTL_SECONDS = 30
const MAX_CACHE_TTL_SECONDS = 3_600

let cached: DesktopRuntimeConfig | null = null
let cacheExpiresAt = 0
let loading: Promise<DesktopRuntimeConfig> | null = null

function validateUrl(value: unknown, label: string, updater = false): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    throw new Error(`${label}缺失或长度不合法`)
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label}不是合法 URL`)
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${label}不能包含凭据或片段`)
  }
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && isTrustedDevelopmentHttp(parsed))
  ) {
    throw new Error(`${label}必须使用 HTTPS；HTTP 只允许本机联调`)
  }
  if (updater && parsed.search) throw new Error('更新源地址不能包含查询参数')
  const normalized = parsed.toString()
  return updater ? normalized.replace(/\/+$/, '') + '/' : normalized
}

function parseRuntimeConfig(value: unknown): DesktopRuntimeConfig {
  if (!value || typeof value !== 'object') throw new Error('com 返回的运行配置为空')
  const candidate = value as Partial<DesktopRuntimeConfig>
  const configVersion = Number(candidate.configVersion)
  const requestedTtl = Number(candidate.cacheTtlSeconds)
  if (!Number.isSafeInteger(configVersion) || configVersion < 0) {
    throw new Error('com 运行配置版本不合法')
  }
  const cacheTtlSeconds = Math.min(
    MAX_CACHE_TTL_SECONDS,
    Math.max(MIN_CACHE_TTL_SECONDS, Number.isFinite(requestedTtl) ? requestedTtl : 300),
  )
  return Object.freeze({
    configVersion,
    cacheTtlSeconds,
    websiteUrl: validateUrl(candidate.websiteUrl, '官网地址'),
    desktopLoginUrl: validateUrl(candidate.desktopLoginUrl, '桌面登录地址'),
    accountPageUrl: validateUrl(candidate.accountPageUrl, '账号中心地址'),
    supportUrl: validateUrl(candidate.supportUrl, '帮助地址'),
    privacyPolicyUrl: validateUrl(candidate.privacyPolicyUrl, '隐私政策地址'),
    updaterFeedUrl: validateUrl(candidate.updaterFeedUrl, '更新源地址', true),
  })
}

async function fetchRuntimeConfig(): Promise<DesktopRuntimeConfig> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${getOhmytokenApiBase()}/desktop/bootstrap`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
    const body = (await response.json()) as ResponseResult<unknown>
    if (!response.ok || body.code !== 200) {
      throw new Error(body.message || `运行配置请求失败 (HTTP ${response.status})`)
    }
    const config = parseRuntimeConfig(body.data)
    cached = config
    cacheExpiresAt = Date.now() + config.cacheTtlSeconds * 1_000
    return config
  } finally {
    clearTimeout(timeout)
  }
}

/** 同一进程 single-flight 缓存；强制刷新用于登录和每次更新检查。 */
export function getDesktopRuntimeConfig(forceRefresh = false): Promise<DesktopRuntimeConfig> {
  if (!forceRefresh && cached && Date.now() < cacheExpiresAt) return Promise.resolve(cached)
  if (loading) return loading
  loading = fetchRuntimeConfig().finally(() => {
    loading = null
  })
  return loading
}
