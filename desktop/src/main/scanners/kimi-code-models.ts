import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse } from 'smol-toml'

/** Kimi 自己的模型展示名称；每轮扫描读取一次，不保存配置中的连接或凭据。 */
export function readKimiCodeModelNames(sessionsDir: string): ReadonlyMap<string, string> {
  const names = new Map<string, Set<string>>()
  try {
    const config = parse(readFileSync(join(dirname(sessionsDir), 'config.toml'), 'utf8'))
    const models = config.models
    if (!models || typeof models !== 'object' || Array.isArray(models)) return new Map()
    for (const [alias, value] of Object.entries(models)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const model = value as Record<string, unknown>
      const displayName = modelText(model.display_name)
      if (!displayName) continue
      for (const key of [modelText(alias), modelText(model.model)]) {
        if (!key) continue
        const candidates = names.get(key) ?? new Set<string>()
        candidates.add(displayName)
        names.set(key, candidates)
      }
    }
  } catch {
    // 配置可选；缺失、损坏或写入中时继续保留日志里的模型 ID。
  }
  // 同一请求 ID 被多个配置别名赋予不同名称时，只接受精确别名匹配。
  return new Map(
    [...names].flatMap(([key, candidates]) =>
      candidates.size === 1 ? [[key, [...candidates][0]] as const] : [],
    ),
  )
}

function modelText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return text.length <= 256 && !/\p{Cc}/u.test(text) ? text : ''
}
