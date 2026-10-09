import { DEFAULT_PALETTE, type Appearance } from '../../../shared/appearance'
import { builtinThemeColors } from './theme-colors'

export type { Appearance } from '../../../shared/appearance'
export type BuiltinAccent = keyof typeof builtinThemeColors
export type ThemeToken = keyof typeof builtinThemeColors.classic.light
export type ThemeColors = Record<ThemeToken, string>
export interface ThemeDefinition {
  id: string
  name: { en: string; zh: string }
  colors: Record<Appearance, ThemeColors>
  /** Remaining quota anchors: low quota retains warning/error semantics. */
  quotaRamp: Record<Appearance, readonly [string, string, string, string, string]>
}

const names = {
  classic: { en: 'Classic', zh: '经典' },
  iris: { en: 'Iris', zh: '鸢尾' },
  cobalt: { en: 'Cobalt', zh: '钴蓝' },
  copper: { en: 'Copper', zh: '铜红' },
}
const quotaRamp = (colors: ThemeColors): ThemeDefinition['quotaRamp']['light'] => [
  colors['--error'],
  colors['--warning'],
  colors['--primary'],
  colors['--primary'],
  colors['--primary'],
]
const definitions: ThemeDefinition[] = (Object.keys(names) as BuiltinAccent[]).map((id) => ({
  id,
  name: names[id],
  colors: builtinThemeColors[id],
  quotaRamp: {
    light: quotaRamp(builtinThemeColors[id].light),
    dark: quotaRamp(builtinThemeColors[id].dark),
  },
}))

export const themeRegistry = new Map(definitions.map((theme) => [theme.id, theme]))
export const builtinThemes: readonly ThemeDefinition[] = definitions
export const DEFAULT_ACCENT = DEFAULT_PALETTE

/** Imported themes use the same complete role contract as built-in themes. */
export function registerTheme(definition: ThemeDefinition): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(definition.id)) throw new Error('Invalid theme ID')
  const validColor = (value: unknown): boolean =>
    typeof value === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(value)
  for (const mode of ['light', 'dark'] as const) {
    if (
      Object.keys(builtinThemeColors.classic[mode]).some(
        (key) => !validColor(definition.colors[mode][key as ThemeToken]),
      )
    )
      throw new Error('Incomplete theme colors')
    if (definition.quotaRamp[mode].length !== 5 || !definition.quotaRamp[mode].every(validColor))
      throw new Error('Invalid quota ramp')
  }
  themeRegistry.set(definition.id, structuredClone(definition))
}

export function getTheme(id: string): ThemeDefinition {
  return themeRegistry.get(id) ?? themeRegistry.get(DEFAULT_ACCENT)!
}
