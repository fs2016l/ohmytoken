import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

function userPath(value: string, home: string): string {
  const path = value.trim()
  return path === '~'
    ? home
    : path.startsWith('~/') || path.startsWith('~\\')
      ? resolve(home, path.slice(2))
      : resolve(path)
}

function config(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {}
  if (statSync(file).size > 1024 * 1024) throw new Error('ZCode 目录配置过大')
  const bytes = readFileSync(file)
  if (bytes.length > 1024 * 1024) throw new Error('ZCode 目录配置过大')
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('ZCode 目录配置无法解析')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('ZCode 目录配置格式无效')
  return value as Record<string, unknown>
}

/** Desktop bootstrap setting stays under the real home; its value is a parent directory. */
export function getZCodeDataRoot(home = homedir(), env: NodeJS.ProcessEnv = process.env): string {
  if (env.ZCODE_HOME?.trim()) return userPath(env.ZCODE_HOME, home)
  const settings = config(join(home, '.zcode', 'v2', 'setting.json'))
  const saved = typeof settings.dataBaseDir === 'string' ? settings.dataBaseDir.trim() : ''
  const parent = saved || env.ZCODE_DATA_BASE_DIR?.trim() || env.HOME?.trim() || home
  return join(userPath(parent, home), '.zcode')
}

/** CLI storage is independent of the desktop dataBaseDir setting. */
export function zCodeDatabaseCandidates(
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  let configured: string | undefined
  for (const [key, value] of Object.entries(env))
    if ((key === 'ZCODE_SESSION_DB_PATH' || key === 'ZCODE_SESSION_DB') && value !== undefined)
      configured = value.trim() || undefined
  if (!configured) {
    const storage = config(join(home, '.zcode', 'cli', 'config.json')).storage
    if (storage && typeof storage === 'object' && !Array.isArray(storage)) {
      const value = (storage as Record<string, unknown>).sessionDbPath
      if (typeof value === 'string') configured = value.trim() || undefined
    }
  }
  if (configured && !isAbsolute(configured) && !/^~[\\/]/.test(configured))
    throw new Error('ZCode 相对会话数据库路径缺少原生工作区，无法确定完整统计来源')
  return [
    ...new Set([
      ...(configured ? [userPath(configured, home)] : []),
      join(home, '.zcode', 'cli', 'db', 'db.sqlite'),
      join(home, '.zcode', 'cli', 'db', 'zcode.db'),
    ]),
  ]
}
