import {
  materialBackend,
  materialBackground,
  materialTint,
  type MaterialPreferences,
  type MaterialBackend,
  type WindowMaterialState,
} from '../../shared/window-material'
import { FLOATING_WINDOW_INSET, FLOATING_WINDOW_RADIUS } from '../../shared/floating-window'

/** Win10 AccentPolicy needs an alpha-capable renderer from window creation.
 * Win11's built-in Acrylic and macOS Vibrancy manage their own compositors. */
export function materialWindowOptions(
  kind: 'main' | 'floating',
  preferences: MaterialPreferences,
  backend: MaterialBackend,
): { transparent: boolean; backgroundColor: string; visualEffectState: 'active' } {
  const nativeGlass = preferences.style !== 'solid' && backend !== 'none'
  return {
    transparent: kind === 'floating' || backend === 'windows-accent',
    backgroundColor:
      kind === 'floating' || nativeGlass ? '#00000000' : materialBackground(preferences),
    visualEffectState: 'active',
  }
}

export interface MaterialNativeBridge {
  status(): {
    available: boolean
    highContrast: boolean
    transparencyEnabled?: boolean
    roundedRegions?: boolean
  }
  apply?(
    handle: Buffer,
    mode: number,
    tint: number,
    inset?: number,
    radius?: number,
  ): { accepted: boolean }
  setVibrancyGeometry?(handle: Buffer, inset: number, radius: number): { accepted: boolean }
}
export interface MaterialWindow {
  setBackgroundColor(color: string): void
  setBackgroundMaterial(material: 'none' | 'acrylic'): void
  setVibrancy(material: 'under-window' | null): void
  getNativeWindowHandle(): Buffer
}
export interface MaterialAccessibility {
  prefersReducedTransparency?: boolean
  inForcedColorsMode?: boolean
  shouldUseHighContrastColors?: boolean
}
/** Pure adapter boundary: independently testable without Electron or a desktop session. */
export function applyWindowMaterial(
  window: MaterialWindow,
  preferences: MaterialPreferences,
  environment: {
    platform: string
    release: string
    accessibility: MaterialAccessibility
    native: MaterialNativeBridge | null
    floating: boolean
    transparent: boolean
    moving?: boolean
    suspended?: boolean
  },
): WindowMaterialState {
  const { platform, release, accessibility, native } = environment
  let nativeStatus: ReturnType<MaterialNativeBridge['status']> | undefined
  try {
    nativeStatus = native?.status()
  } catch {
    /* Unsupported native module falls back to solid. */
  }
  let backend = materialBackend(platform, release, nativeStatus?.available ?? false)
  const clippedFloating = platform === 'win32' && environment.floating && environment.transparent
  const transparentMain = platform === 'win32' && !environment.floating && environment.transparent
  if (clippedFloating && backend !== 'none')
    backend = nativeStatus?.available && nativeStatus.roundedRegions ? 'windows-accent' : 'none'
  const reduced =
    accessibility.prefersReducedTransparency ||
    accessibility.inForcedColorsMode ||
    accessibility.shouldUseHighContrastColors ||
    nativeStatus?.highContrast ||
    nativeStatus?.transparencyEnabled === false
  const state: WindowMaterialState = {
    preferences: { ...preferences },
    backend,
    active: false,
    reason: null,
  }
  function clear(): void {
    if (platform === 'darwin') window.setVibrancy(null)
    else if (backend === 'windows-acrylic') window.setBackgroundMaterial('none')
    else if (nativeStatus?.available)
      native?.apply?.(
        window.getNativeWindowHandle(),
        0,
        0,
        ...(transparentMain ? ([0, 0] as const) : []),
      )
  }
  function solid(): void {
    try {
      clear()
    } catch {
      /* An opaque paint surface is sufficient to remain readable. */
    }
    window.setBackgroundColor(
      environment.floating && environment.transparent
        ? '#00000000'
        : materialBackground(preferences),
    )
  }
  if (preferences.style === 'solid' || reduced || backend === 'none') {
    solid()
    if (preferences.style !== 'solid')
      state.reason = reduced ? 'reduced-transparency' : 'unsupported'
    return state
  }
  try {
    window.setBackgroundColor('#00000000')
    if (environment.suspended && environment.floating && environment.transparent) {
      // A fixed native backdrop cannot follow a compositor transform. Suspend only
      // the backdrop until the original panel has finished sliding into place.
      clear()
    } else if (backend === 'windows-accent') {
      const result = native?.apply?.(
        window.getNativeWindowHandle(),
        environment.moving ? 3 : 4,
        materialTint(preferences),
        ...(clippedFloating
          ? ([FLOATING_WINDOW_INSET, FLOATING_WINDOW_RADIUS] as const)
          : transparentMain
            ? ([0, 0] as const)
            : []),
      )
      if (!result?.accepted) throw new Error('Native material rejected')
    } else if (backend === 'windows-acrylic') window.setBackgroundMaterial('acrylic')
    else {
      window.setVibrancy('under-window')
      if (
        environment.floating &&
        !native?.setVibrancyGeometry?.(
          window.getNativeWindowHandle(),
          FLOATING_WINDOW_INSET,
          FLOATING_WINDOW_RADIUS,
        ).accepted
      )
        throw new Error('Native vibrancy mask unavailable')
    }
    state.active = true
  } catch {
    solid()
    state.reason = 'unavailable'
  }
  return state
}
