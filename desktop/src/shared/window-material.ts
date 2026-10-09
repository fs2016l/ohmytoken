import {
  appearancePalettes,
  DEFAULT_APPEARANCE,
  DEFAULT_PALETTE,
  isAppearancePalette,
  type AppearancePaletteId,
} from './appearance'

export type WindowMaterial = 'solid' | 'frosted' | 'clear'
export type MaterialAppearance = 'light' | 'dark'
export type MaterialBackend = 'none' | 'windows-accent' | 'windows-acrylic' | 'mac-vibrancy'
export type MaterialFallback = 'unsupported' | 'unavailable' | 'reduced-transparency' | null
export interface MaterialPreferences {
  style: WindowMaterial
  appearance: MaterialAppearance
  palette: AppearancePaletteId
}
export interface WindowMaterialState {
  preferences: MaterialPreferences
  backend: MaterialBackend
  active: boolean
  reason: MaterialFallback
}
export interface WindowMaterialAPI {
  getWindowMaterial(): Promise<WindowMaterialState>
  setWindowMaterial(preferences: Partial<MaterialPreferences>): Promise<WindowMaterialState>
  onWindowMaterialChanged(callback: (state: WindowMaterialState) => void): () => void
}
export const MATERIAL_IPC = {
  GET: 'window-material:get',
  SET: 'window-material:set',
  CHANGED: 'window-material:changed',
} as const
export const DEFAULT_MATERIAL: MaterialPreferences = {
  style: 'solid',
  appearance: DEFAULT_APPEARANCE,
  palette: DEFAULT_PALETTE,
}
export function isWindowMaterial(value: unknown): value is WindowMaterial {
  return value === 'solid' || value === 'frosted' || value === 'clear'
}
export function materialPreferences(
  value: unknown,
  previous = DEFAULT_MATERIAL,
): MaterialPreferences {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const style =
    input.style === 'glacier' || input.style === 'smoky'
      ? 'frosted'
      : input.style === 'aurora'
        ? 'clear'
        : input.style
  return {
    style: isWindowMaterial(style) ? style : previous.style,
    appearance:
      input.appearance === 'light' || input.appearance === 'dark'
        ? input.appearance
        : previous.appearance,
    palette: isAppearancePalette(input.palette) ? input.palette : previous.palette,
  }
}
export function materialBackend(
  platform: string,
  version: string,
  nativeAvailable: boolean,
): MaterialBackend {
  if (platform === 'darwin') return 'mac-vibrancy'
  if (platform !== 'win32') return 'none'
  const build = Number(version.split('.')[2])
  if (!Number.isInteger(build)) return 'none'
  if (build >= 22621) return 'windows-acrylic'
  if (build >= 17763 && nativeAvailable) return 'windows-accent'
  return 'none'
}
/** Native tint is ABGR. Surface opacity remains separate so text is never translucent. */
export function materialTint(preferences: MaterialPreferences): number {
  const value = materialPreferences(preferences)
  const color = appearancePalettes[value.palette][value.appearance].shell
  const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16))
  // The renderer paints the theme surfaces. Native tint is deliberately subtle.
  const opacity = value.style === 'frosted' ? 0.12 : 0.04
  return ((Math.round(opacity * 255) << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0]) >>> 0
}

export function materialBackground(preferences: MaterialPreferences): string {
  const value = materialPreferences(preferences)
  return appearancePalettes[value.palette][value.appearance].canvas.toLowerCase()
}
