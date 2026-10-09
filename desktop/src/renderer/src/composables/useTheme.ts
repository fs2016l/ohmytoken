import { ref } from 'vue'
import { getTheme, themeRegistry, builtinThemes } from '../config/themes'
import { readAppearancePreferences } from '../config/appearance-preferences'
import { glassThemeTokens } from '../config/glass-materials'
import {
  initializeWindowMaterial,
  syncMaterialAppearance,
  useWindowMaterial,
} from './useWindowMaterial'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'app-theme'
const ACCENT_KEY = 'app-accent'
const SYNC_CHANNEL = 'ohmyagent-preferences'

interface PreferenceMessage {
  type?: string
  value?: unknown
}

function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light'
}

const initial = readAppearancePreferences(localStorage)
const currentTheme = ref<Theme>(initial.appearance)
const currentAccent = ref(initial.palette)
const preferenceChannel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SYNC_CHANNEL)
const { materialState } = useWindowMaterial()

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.setAttribute('data-accent', currentAccent.value)
  document.documentElement.style.colorScheme = theme
  const base = getTheme(currentAccent.value).colors[theme]
  const material = {
    ...materialState.value,
    preferences: { ...materialState.value.preferences, appearance: theme },
  }
  for (const [property, value] of Object.entries({
    ...base,
    ...glassThemeTokens(base, material),
  })) {
    document.documentElement.style.setProperty(property, value)
  }
  if (window.api?.windowControlsOverlay)
    void window.api.setWindowControlSymbolColor(base['--text-muted']).catch((error) => {
      console.warn('[window-chrome] Unable to update window controls:', error)
    })
}

function syncTheme(theme: Theme): void {
  if (currentTheme.value !== theme) currentTheme.value = theme
  applyTheme(theme)
  syncMaterialAppearance(theme, currentAccent.value)
}

applyTheme(currentTheme.value)
document.documentElement.addEventListener('omt:material-changed', () =>
  applyTheme(currentTheme.value),
)
void initializeWindowMaterial(currentTheme.value, currentAccent.value)

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY && isTheme(event.newValue)) syncTheme(event.newValue)
  if (event.key === ACCENT_KEY && event.newValue && themeRegistry.has(event.newValue)) {
    currentAccent.value = event.newValue
    applyTheme(currentTheme.value)
    syncMaterialAppearance(currentTheme.value, currentAccent.value)
  }
})

preferenceChannel?.addEventListener('message', (event: MessageEvent<PreferenceMessage>) => {
  if (event.data?.type === 'theme' && isTheme(event.data.value)) syncTheme(event.data.value)
  if (
    event.data?.type === 'accent' &&
    typeof event.data.value === 'string' &&
    themeRegistry.has(event.data.value)
  ) {
    currentAccent.value = event.data.value
    applyTheme(currentTheme.value)
    syncMaterialAppearance(currentTheme.value, currentAccent.value)
  }
})

export function useTheme() {
  function setAccent(accent: string): void {
    if (!themeRegistry.has(accent)) return
    currentAccent.value = accent
    localStorage.setItem(ACCENT_KEY, accent)
    applyTheme(currentTheme.value)
    syncMaterialAppearance(currentTheme.value, currentAccent.value)
    preferenceChannel?.postMessage({ type: 'accent', value: accent })
  }
  function setTheme(theme: Theme): void {
    syncTheme(theme)
    localStorage.setItem(STORAGE_KEY, theme)
    preferenceChannel?.postMessage({ type: 'theme', value: theme })
  }

  function toggleTheme(): void {
    setTheme(currentTheme.value === 'dark' ? 'light' : 'dark')
  }

  return {
    currentTheme,
    currentAccent,
    themes: builtinThemes,
    setAccent,
    setTheme,
    toggleTheme,
  }
}
