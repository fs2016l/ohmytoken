import { readonly, ref } from 'vue'
import { DEFAULT_PALETTE, isAppearancePalette, type AppearancePaletteId } from '@shared/appearance'
import {
  DEFAULT_MATERIAL,
  materialPreferences,
  type MaterialAppearance,
  type MaterialPreferences,
  type WindowMaterial,
  type WindowMaterialState,
} from '@shared/window-material'

const state = ref<WindowMaterialState>({
  preferences: { ...DEFAULT_MATERIAL },
  backend: 'none',
  active: false,
  reason: null,
})
const pending = ref(false)
const failed = ref(false)
let initialized = false
let desiredAppearance: MaterialAppearance = DEFAULT_MATERIAL.appearance
let desiredPalette: AppearancePaletteId = DEFAULT_PALETTE
let requests: Promise<void> = Promise.resolve()

export function applyMaterialState(next: WindowMaterialState): void {
  const preferences = materialPreferences(next.preferences, state.value.preferences)
  state.value = { ...next, preferences }
  document.documentElement.dataset.material = preferences.style
  document.documentElement.dataset.nativeGlass = String(next.active)
  document.documentElement.dataset.materialBackend = next.backend
  document.documentElement.dispatchEvent(new Event('omt:material-changed'))
}

/** Serialize updates and read the latest mode/palette when an IPC request starts. */
function requestMaterial(style?: WindowMaterial): Promise<void> {
  const operation = requests
    .catch(() => {})
    .then(async () => {
      const patch: Partial<MaterialPreferences> = {
        appearance: desiredAppearance,
        palette: desiredPalette,
        ...(style ? { style } : {}),
      }
      applyMaterialState(await window.api.setWindowMaterial(patch))
    })
  requests = operation
  return operation
}

export function syncMaterialAppearance(appearance: MaterialAppearance, palette: string): void {
  desiredAppearance = appearance
  desiredPalette = isAppearancePalette(palette) ? palette : DEFAULT_PALETTE
  if (
    initialized &&
    typeof window.api?.setWindowMaterial === 'function' &&
    (state.value.preferences.appearance !== appearance ||
      state.value.preferences.palette !== desiredPalette)
  ) {
    void requestMaterial().catch(() => {
      failed.value = true
    })
  }
}

export async function initializeWindowMaterial(
  appearance: MaterialAppearance,
  palette: string,
): Promise<void> {
  desiredAppearance = appearance
  desiredPalette = isAppearancePalette(palette) ? palette : DEFAULT_PALETTE
  if (initialized || !window.api?.getWindowMaterial) return
  initialized = true
  window.api.onWindowMaterialChanged(applyMaterialState)
  try {
    applyMaterialState(await window.api.getWindowMaterial())
    syncMaterialAppearance(desiredAppearance, desiredPalette)
  } catch {
    failed.value = true
  }
}

export function useWindowMaterial() {
  async function setMaterial(style: WindowMaterial): Promise<void> {
    if (!window.api?.setWindowMaterial || pending.value) return
    pending.value = true
    failed.value = false
    try {
      await requestMaterial(style)
    } catch {
      failed.value = true
    } finally {
      pending.value = false
    }
  }
  return {
    materialState: readonly(state),
    materialPending: readonly(pending),
    materialFailed: readonly(failed),
    setMaterial,
  }
}

/** Queue behind any in-flight appearance change so it cannot overwrite the restored defaults. */
export async function resetWindowMaterial(): Promise<void> {
  desiredAppearance = DEFAULT_MATERIAL.appearance
  desiredPalette = DEFAULT_MATERIAL.palette
  await requestMaterial(DEFAULT_MATERIAL.style)
}
