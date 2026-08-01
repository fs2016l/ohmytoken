import { ref } from 'vue'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'app-theme'
const SYNC_CHANNEL = 'ohmyagent-preferences'

interface PreferenceMessage {
  type?: string
  value?: unknown
}

function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light'
}

const storedTheme = localStorage.getItem(STORAGE_KEY)
const currentTheme = ref<Theme>(isTheme(storedTheme) ? storedTheme : 'dark')
const preferenceChannel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SYNC_CHANNEL)

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
}

function syncTheme(theme: Theme): void {
  if (currentTheme.value !== theme) currentTheme.value = theme
  applyTheme(theme)
}

applyTheme(currentTheme.value)

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY && isTheme(event.newValue)) syncTheme(event.newValue)
})

preferenceChannel?.addEventListener('message', (event: MessageEvent<PreferenceMessage>) => {
  if (event.data?.type === 'theme' && isTheme(event.data.value)) syncTheme(event.data.value)
})

export function useTheme() {
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
    setTheme,
    toggleTheme,
  }
}
