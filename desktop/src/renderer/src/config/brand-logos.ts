import { modelPalette } from './agents'
import { computed, shallowRef } from 'vue'
import {
  createModelBrandIdentityResolver,
  resolveModelBrandId,
  type ModelIconSnapshot,
} from '@shared/model-icons'

const remoteModelIcons = shallowRef<ModelIconSnapshot>({
  families: Object.create(null),
  models: Object.create(null),
})
const resolveModelBrandIdentity = computed(() =>
  createModelBrandIdentityResolver(remoteModelIcons.value),
)
const requestedFamilies = new Set<string>()
const pendingFamilies = new Map<string, string>()
let requestQueued = false

function applyModelIcons(snapshot: ModelIconSnapshot): void {
  const previous = remoteModelIcons.value.families
  for (const [familyId, icon] of Object.entries(snapshot.families)) {
    if (previous[familyId]?.sha256 !== icon.sha256 || (previous[familyId]?.url && !icon.url))
      requestedFamilies.delete(familyId)
  }
  for (const familyId of Object.keys(previous))
    if (!snapshot.families[familyId]) requestedFamilies.delete(familyId)
  remoteModelIcons.value = snapshot
}

if (typeof window !== 'undefined' && typeof window.api?.getModelIconSnapshot === 'function') {
  let eventSeen = false
  window.api.onModelIconsChanged((snapshot) => {
    eventSeen = true
    applyModelIcons(snapshot)
  })
  void window.api
    .getModelIconSnapshot()
    .then((snapshot) => {
      if (!eventSeen) applyModelIcons(snapshot)
    })
    .catch(() => undefined)
}

function queueModelIcon(modelId: string, familyId: string): void {
  if (
    requestedFamilies.has(familyId) ||
    typeof window === 'undefined' ||
    typeof window.api?.ensureModelIcons !== 'function'
  )
    return
  requestedFamilies.add(familyId)
  pendingFamilies.set(familyId, modelId)
  if (requestQueued) return
  requestQueued = true
  queueMicrotask(() => {
    requestQueued = false
    const models = [...pendingFamilies.values()]
    pendingFamilies.clear()
    for (let index = 0; index < models.length; index += 200)
      void window.api.ensureModelIcons(models.slice(index, index + 200)).catch(() => undefined)
  })
}

export function remoteModelLogoUrl(modelName: string): string | undefined {
  const familyId = resolveModelBrandId(remoteModelIcons.value, modelName)
  if (!familyId) return undefined
  const icon = remoteModelIcons.value.families[familyId]
  if (!icon) return undefined
  if (!icon.url) queueModelIcon(modelName, familyId)
  return icon.url ?? undefined
}

/** Project and floating stacks group by brand, independently of image source or readiness. */
export function modelIconIdentity(modelName: string): string {
  remoteModelLogoUrl(modelName)
  return resolveModelBrandIdentity.value(modelName)
}

export function distinctModelsByIcon(models: string[]): string[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    const identity = modelIconIdentity(model)
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

const agentFiles = import.meta.glob<string>('../assets/logos/agents/*.svg', {
  eager: true,
  import: 'default',
})
const vendorFiles = import.meta.glob<string>('../assets/logos/vendors/*.svg', {
  eager: true,
  import: 'default',
})

const byKey = (files: Record<string, string>): Record<string, string> => {
  const map: Record<string, string> = {}
  for (const [path, url] of Object.entries(files)) {
    map[path.replace(/^.*\/(.+)\.svg$/, '$1')] = url
  }
  return map
}

const agentLogos = byKey(agentFiles)
const vendorLogos = byKey(vendorFiles)

// Single-color marks rendered through a currentColor mask so they stay visible on dark themes.
const monochromeAgents = new Set(['codex', 'grok', 'zed'])
const monochromeVendors = new Set(['openai', 'anthropic'])

export function agentLogoUrl(agent: string): string | undefined {
  return agentLogos[agent]
}

export function modelLogoUrl(modelName: string): string | undefined {
  return remoteModelLogoUrl(modelName)
}

export function vendorLogoUrl(providerId: string): string | undefined {
  return vendorLogos[providerId]
}

export function isMonochromeAgent(agent: string): boolean {
  return monochromeAgents.has(agent)
}

export function isMonochromeVendor(providerId: string): boolean {
  return monochromeVendors.has(providerId)
}

export function initialOf(name: string): string {
  const match = name.match(/[a-z0-9\u4e00-\u9fff]/i)
  return (match?.[0] || '?').toUpperCase()
}

export function modelTileColor(modelName: string): string {
  let hash = 2166136261
  for (const char of modelName.trim().toLowerCase()) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  }
  return modelPalette[(hash >>> 0) % modelPalette.length]
}
