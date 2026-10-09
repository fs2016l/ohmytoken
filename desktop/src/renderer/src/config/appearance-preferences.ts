import {
  APPEARANCE_VERSION,
  DEFAULT_APPEARANCE,
  migrateAppearancePalette,
  type Appearance,
} from '../../../shared/appearance'
import { themeRegistry } from './themes'

/** Migrate once, so legacy Iris keeps the neutral light appearance the user selected. */
export function readAppearancePreferences(storage: Pick<Storage, 'getItem' | 'setItem'>): {
  appearance: Appearance
  palette: string
} {
  let saved: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(storage.getItem('app-settings') || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      saved = parsed as Record<string, unknown>
  } catch {
    // Malformed old settings must not prevent a window from opening.
  }
  const mode = storage.getItem('app-theme') ?? saved.theme
  const appearance = mode === 'light' || mode === 'dark' ? mode : DEFAULT_APPEARANCE
  const accent = storage.getItem('app-accent') ?? saved.accent
  const version = storage.getItem('app-appearance-version')
  const palette =
    version === APPEARANCE_VERSION && typeof accent === 'string' && themeRegistry.has(accent)
      ? accent
      : migrateAppearancePalette(accent, version)
  storage.setItem('app-theme', appearance)
  storage.setItem('app-accent', palette)
  storage.setItem('app-appearance-version', APPEARANCE_VERSION)
  return { appearance, palette }
}
