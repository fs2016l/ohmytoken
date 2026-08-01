import type { DesktopRuntimeConfig } from '@shared/runtime-config'

export type RuntimeUrlKey = Exclude<keyof DesktopRuntimeConfig, 'configVersion' | 'cacheTtlSeconds'>

/** renderer 不自行拼业务域名，只通过主进程读取 com 公共配置。 */
export async function openConfiguredUrl(key: RuntimeUrlKey): Promise<void> {
  const config = await window.api.getRuntimeConfig()
  const url = config[key]
  if (!url) throw new Error(`com 未配置 ${key}`)
  await window.api.openExternal(url)
}
