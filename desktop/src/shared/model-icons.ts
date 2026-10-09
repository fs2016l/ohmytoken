import { compileBrandPatterns } from './model-brand-patterns'

/** A brand icon family owns one immutable CDN object for all of its canonical models. */
export interface ModelIconEntry {
  id: string
  sha256: string
  contentType: string
  byteSize: number
  url: string
}

export interface ModelIconModel {
  modelId: string
  familyId: string
  aliases?: string[]
}

/** COM projects its configured vendor rules onto an unambiguous brand. */
export interface ModelBrandRule {
  familyId: string
  families?: string[]
  numberedFamilies?: string[]
  exact?: string[]
  matchPatterns?: string[]
}

export interface ModelIconManifest {
  /** Only families with a usable shared image appear here. */
  families: ModelIconEntry[]
  /** A model keeps its family mapping even when that family has no image. */
  models: ModelIconModel[]
  brandRules?: ModelBrandRule[]
}

export interface ModelIconSnapshot {
  /** Keys are stable brand IDs. A null URL means the icon is not cached yet. */
  families: Record<string, { sha256: string; url: string | null }>
  /** Keys are lower-case canonical model IDs and COM aliases. */
  models: Record<string, string>
  brandRules?: ModelBrandRule[]
}

const compiledBrandRules = new WeakMap<ModelBrandRule[], ReturnType<typeof compileBrandPatterns>>()

/** Interpret only downloaded COM data; unknown or ambiguous names have no brand. */
export function resolveModelBrandId(
  snapshot: Pick<ModelIconSnapshot, 'models' | 'brandRules'>,
  modelName: string,
): string | undefined {
  if (modelName.length > 256) return undefined
  const name = modelName.trim().toLowerCase()
  if (Object.hasOwn(snapshot.models, name)) return snapshot.models[name]
  const key = (name.split('/').at(-1) ?? '').replace(/[\s_]+/g, '-')
  const rules = snapshot.brandRules
  if (!rules?.length) return undefined
  let patterns = compiledBrandRules.get(rules)
  if (!patterns) {
    patterns = compileBrandPatterns(rules)
    compiledBrandRules.set(rules, patterns)
  }
  const matches = new Set<string>()
  for (const [index, rule] of rules.entries()) {
    const numbered = (family: string): boolean => {
      if (!key.startsWith(family)) return false
      return /^\d/.test(key.slice(family.length).replace(/^-/, ''))
    }
    if (
      patterns[index].some((pattern) => pattern.testExact(name)) ||
      rule.exact?.includes(key) ||
      rule.numberedFamilies?.some(numbered) ||
      rule.families?.some(
        (family) => key === family || key.startsWith(`${family}-`) || numbered(family),
      )
    )
      matches.add(rule.familyId)
  }
  return matches.size === 1 ? [...matches][0] : undefined
}

/** Brand identity is independent of the image asset and its download state. */
export function mappedModelIconIdentity(
  snapshot: ModelIconSnapshot,
  modelName: string,
): string | undefined {
  const familyId = resolveModelBrandId(snapshot, modelName)
  if (!familyId) return undefined
  return `family:${familyId}`
}

/** Group by COM brand identity; unmatched names remain distinct models. */
export function createModelBrandIdentityResolver(
  snapshot: ModelIconSnapshot,
): (modelName: string) => string {
  return (modelName) =>
    mappedModelIconIdentity(snapshot, modelName) ?? `model:${modelName.trim().toLowerCase()}`
}

/** The same projection serves the renderer and on-demand icon downloads. */
export function modelBrandSnapshot(
  manifest: ModelIconManifest | undefined,
): Pick<ModelIconSnapshot, 'models' | 'brandRules'> {
  const models: ModelIconSnapshot['models'] = Object.create(null)
  for (const model of manifest?.models ?? [])
    for (const name of [model.modelId, ...(model.aliases ?? [])])
      models[name.toLowerCase()] = model.familyId
  return { models, brandRules: manifest?.brandRules ?? [] }
}

export const MODEL_ICON_IPC = {
  MODEL_ICONS_SNAPSHOT: 'model-icons:snapshot',
  MODEL_ICONS_ENSURE: 'model-icons:ensure',
  MODEL_ICONS_CHANGED: 'model-icons:changed',
} as const

export interface ModelIconAPI {
  getModelIconSnapshot(): Promise<ModelIconSnapshot>
  ensureModelIcons(modelIds: string[]): Promise<void>
  onModelIconsChanged(callback: (snapshot: ModelIconSnapshot) => void): () => void
}

const extensions: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export const MAX_MODEL_ICON_BYTES = 10 * 1024 * 1024

export function modelIconExtension(contentType: string): string | undefined {
  return extensions[contentType]
}

export function parseModelIconManifest(
  value: unknown,
  allowLoopbackHttp = false,
): ModelIconManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('模型图标清单格式不合法')
  const root = value as { families?: unknown; models?: unknown; brandRules?: unknown }
  if (!Array.isArray(root.families) || root.families.length > 2_000)
    throw new Error('模型图标族类数量不合法')
  if (!Array.isArray(root.models) || root.models.length > 2_000)
    throw new Error('模型图标清单数量不合法')
  const familyIds = new Set<string>()
  const families = root.families.map((value): ModelIconEntry => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('模型图标族类格式不合法')
    const row = value as Partial<ModelIconEntry>
    if (
      typeof row.id !== 'string' ||
      !/^brand:[1-9]\d{0,18}$/.test(row.id) ||
      typeof row.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      typeof row.contentType !== 'string' ||
      !modelIconExtension(row.contentType) ||
      typeof row.byteSize !== 'number' ||
      !Number.isSafeInteger(row.byteSize) ||
      row.byteSize < 1 ||
      row.byteSize > MAX_MODEL_ICON_BYTES ||
      typeof row.url !== 'string' ||
      row.url.length > 2_048
    )
      throw new Error('模型图标族类无效')
    if (familyIds.has(row.id)) throw new Error('模型图标族类 ID 重复')
    familyIds.add(row.id)
    const url = new URL(row.url)
    if (
      (url.protocol !== 'https:' &&
        !(
          allowLoopbackHttp &&
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith(
        `/media/discovery/assets/${row.sha256.slice(0, 2)}/${row.sha256}.${modelIconExtension(row.contentType)}`,
      )
    )
      throw new Error('模型图标 CDN 地址无效')
    return {
      id: row.id,
      sha256: row.sha256,
      contentType: row.contentType,
      byteSize: row.byteSize,
      url: row.url,
    }
  })
  const modelIds = new Set<string>()
  const models = root.models.map((value): ModelIconModel => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('模型图标映射格式不合法')
    const row = value as Partial<ModelIconModel>
    if (
      typeof row.modelId !== 'string' ||
      row.modelId.length > 256 ||
      !/^[a-z0-9][a-z0-9._/-]*$/i.test(row.modelId) ||
      typeof row.familyId !== 'string' ||
      !/^brand:[1-9]\d{0,18}$/.test(row.familyId)
    )
      throw new Error('模型图标映射无效')
    const aliases = parseBrandNames(row.aliases)
    for (const name of [row.modelId, ...aliases]) {
      const key = name.toLowerCase()
      if (modelIds.has(key)) throw new Error('模型图标模型 ID 或别名重复')
      modelIds.add(key)
    }
    return {
      modelId: row.modelId,
      familyId: row.familyId,
      ...(row.aliases === undefined ? {} : { aliases }),
    }
  })
  if (
    root.brandRules !== undefined &&
    (!Array.isArray(root.brandRules) || root.brandRules.length > 100)
  )
    throw new Error('模型品牌规则数量不合法')
  const brandRules = ((root.brandRules ?? []) as unknown[]).map((value): ModelBrandRule => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('模型品牌规则格式不合法')
    const row = value as Partial<ModelBrandRule>
    if (typeof row.familyId !== 'string' || !/^brand:[1-9]\d{0,18}$/.test(row.familyId))
      throw new Error('模型品牌规则归属无效')
    return {
      familyId: row.familyId,
      families: parseBrandNames(row.families),
      numberedFamilies: parseBrandNames(row.numberedFamilies),
      exact: parseBrandNames(row.exact),
      ...(row.matchPatterns === undefined ? {} : { matchPatterns: row.matchPatterns }),
    }
  })
  compiledBrandRules.set(brandRules, compileBrandPatterns(brandRules))
  return { families, models, brandRules }
}

function parseBrandNames(value: unknown): string[] {
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    value.length > 200 ||
    value.some((name) => typeof name !== 'string' || !/^[a-z0-9][a-z0-9._/-]{0,255}$/i.test(name))
  )
    throw new Error('模型品牌规则或别名不合法')
  return value.map((name: string) => name.toLowerCase())
}
