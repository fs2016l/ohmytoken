/** 由 electron.vite.config.ts 在主进程构建时注入；测试环境中允许不存在。 */
declare const __OHMYTOKEN_BUILD_API_BASE__: string | undefined
declare const __OHMYTOKEN_DEV__: boolean | undefined

/**
 * Agent 唯一内置的服务端配置入口。
 * 生产构建值来自 MAIN_VITE_OHMYTOKEN_API_BASE，运行时环境变量仅用于私有部署覆盖。
 */
const BUILD_API_BASE =
  typeof __OHMYTOKEN_BUILD_API_BASE__ === 'undefined'
    ? process.env.MAIN_VITE_OHMYTOKEN_API_BASE
    : __OHMYTOKEN_BUILD_API_BASE__
const IS_DEVELOPMENT =
  typeof __OHMYTOKEN_DEV__ === 'undefined'
    ? process.env.NODE_ENV !== 'production'
    : __OHMYTOKEN_DEV__

let cachedApiBase: string | null = null

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

export function getOhmytokenApiBase(): string {
  if (cachedApiBase) return cachedApiBase
  const raw =
    process.env.OHMYTOKEN_API_BASE ||
    BUILD_API_BASE ||
    (IS_DEVELOPMENT ? 'http://localhost:8099/api' : '')
  if (!raw) {
    // TODO: 正式打包前在 .env.production 配置 MAIN_VITE_OHMYTOKEN_API_BASE。
    throw new Error('未配置 com API Base，无法使用联网功能')
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('com API Base 不是合法 URL')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('com API Base 不能包含凭据、查询参数或片段')
  }
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))
  ) {
    throw new Error('生产 com API Base 必须使用 HTTPS；HTTP 只允许本机开发地址')
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  cachedApiBase = parsed.toString().replace(/\/+$/, '')
  return cachedApiBase
}

export function isTrustedDevelopmentHttp(url: URL): boolean {
  const apiBase = new URL(getOhmytokenApiBase())
  return apiBase.protocol === 'http:' && isLoopback(apiBase.hostname) && isLoopback(url.hostname)
}
