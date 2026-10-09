import {
  DESKTOP_API_PARAMETERS,
  type DesktopApiKey,
  type DesktopApiParameters,
} from '../../shared/runtime-config'

const pathPattern =
  /^\/(?:[A-Za-z0-9_-]+|\{[A-Za-z][A-Za-z0-9]*\})(?:\/(?:[A-Za-z0-9_-]+|\{[A-Za-z][A-Za-z0-9]*\}))*$/

export function validateDesktopApiPaths(value: unknown): Readonly<Record<DesktopApiKey, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('com 未下发业务接口配置，请更新配套服务')
  const source = value as Record<string, unknown>
  const paths = {} as Record<DesktopApiKey, string>
  for (const key of Object.keys(DESKTOP_API_PARAMETERS) as DesktopApiKey[]) {
    const path = source[key]
    if (typeof path !== 'string' || path.length > 512 || !pathPattern.test(path))
      throw new Error('com 业务接口路径不合法：' + key)
    const parameters = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    if (JSON.stringify(parameters) !== JSON.stringify([...DESKTOP_API_PARAMETERS[key]].sort()))
      throw new Error('com 业务接口参数不匹配：' + key)
    paths[key] = path
  }
  return Object.freeze(paths)
}

export function desktopApiUrl(
  base: string,
  paths: Readonly<Record<DesktopApiKey, string>>,
  key: DesktopApiKey,
  parameters: DesktopApiParameters = {},
): string {
  if (!Object.hasOwn(DESKTOP_API_PARAMETERS, key)) throw new Error('未知业务接口')
  const expected = DESKTOP_API_PARAMETERS[key] as readonly string[]
  if (
    !parameters ||
    typeof parameters !== 'object' ||
    Array.isArray(parameters) ||
    Object.keys(parameters).some((name) => !expected.includes(name))
  )
    throw new Error('业务接口参数不合法')
  const path = paths[key].replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = parameters[name]
    if (
      !['string', 'number'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isFinite(value)) ||
      !/^[A-Za-z0-9_-]+$/.test(String(value))
    )
      throw new Error('业务接口参数不合法：' + name)
    return encodeURIComponent(String(value))
  })
  const url = new URL(base.replace(/\/+$/, '') + path)
  if (url.origin !== new URL(base).origin) throw new Error('业务接口不能离开当前 com 服务')
  return url.href
}
