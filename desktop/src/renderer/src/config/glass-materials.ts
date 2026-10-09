import type { WindowMaterial, WindowMaterialState } from '@shared/window-material'
import type { ThemeColors } from './themes'

export const glassMaterials: ReadonlyArray<{
  id: WindowMaterial
  name: { en: string; zh: string }
  description: { en: string; zh: string }
}> = [
  {
    id: 'solid',
    name: { en: 'Solid', zh: '纯色' },
    description: { en: 'Opaque surfaces, clear and stable', zh: '完全不透明，清晰稳定' },
  },
  {
    id: 'frosted',
    name: { en: 'Frosted', zh: '磨砂' },
    description: { en: 'Soft background, subtle transparency', zh: '柔化背景，温和透色' },
  },
  {
    id: 'clear',
    name: { en: 'Clear', zh: '通透' },
    description: { en: 'More of your desktop, crisp surfaces', zh: '看见桌面，保留清晰内容' },
  },
]

export const materialSurfaces = {
  // Native blur is controlled by the OS; previews share that blur and show the
  // actual difference in tint density instead of advertising two blur radii.
  solid: { opacity: { light: 1, dark: 1 }, previewBlur: 0 },
  frosted: { opacity: { light: 0.72, dark: 0.88 }, previewBlur: 28 },
  clear: { opacity: { light: 0.5, dark: 0.7 }, previewBlur: 28 },
} as const

/** Only window backgrounds transmit the desktop. Data, controls and text stay opaque. */
export function glassThemeTokens(
  base: ThemeColors,
  state: WindowMaterialState,
): Partial<ThemeColors & { '--glass-edge-surface': string }> {
  if (!state.active || state.preferences.style === 'solid') return {}
  const opacity = materialSurfaces[state.preferences.style].opacity[state.preferences.appearance]
  const alpha = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, '0')
  const tint = (color: string): string => color.slice(0, 7) + alpha
  return {
    '--glass-edge-surface': base['--shell'],
    '--shell': tint(base['--shell']),
    '--sidebar': tint(base['--sidebar']),
    '--bg-base': tint(base['--bg-base']),
    '--omt-account-surface': tint(base['--sidebar']),
  }
}
