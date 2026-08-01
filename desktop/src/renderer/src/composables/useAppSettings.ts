import { reactive, watch } from 'vue'
import { useTheme } from './useTheme'
import { useTypography } from './useTypography'
import { useI18n } from '../i18n/useI18n'
import type { Lang } from '../i18n/lang'
import type { Theme } from './useTheme'
import {
  DEFAULT_CODE_FONT,
  DEFAULT_INTERFACE_FONT,
  DEFAULT_NUMBER_FONT,
  isCodeFont,
  isNumberFont,
  isInterfaceFont,
  type CodeFont,
  type InterfaceFont,
  type NumberFont,
} from '../config/typography'

const STORAGE_KEY = 'app-settings'

export interface AppSettings {
  language: Lang
  theme: Theme
  systemNotificationsEnabled: boolean
  interfaceFont: InterfaceFont
  codeFont: CodeFont
  numberFont: NumberFont
  version: string
}

const defaultSettings: AppSettings = {
  language: 'zh',
  theme: 'dark',
  systemNotificationsEnabled: false,
  interfaceFont: DEFAULT_INTERFACE_FONT,
  codeFont: DEFAULT_CODE_FONT,
  numberFont: DEFAULT_NUMBER_FONT,
  version: '1.0.0',
}

function loadSettings(): AppSettings {
  let parsed: Partial<AppSettings> = {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) parsed = JSON.parse(raw) as Partial<AppSettings>
  } catch {
    // Ignore malformed settings and use the validated defaults below.
  }

  const storedLang = localStorage.getItem('app-lang')
  const storedTheme = localStorage.getItem('app-theme')
  return {
    ...defaultSettings,
    ...parsed,
    language:
      storedLang === 'en' || storedLang === 'zh'
        ? storedLang
        : parsed.language === 'en' || parsed.language === 'zh'
          ? parsed.language
          : 'zh',
    theme:
      storedTheme === 'light' || storedTheme === 'dark'
        ? storedTheme
        : parsed.theme === 'light' || parsed.theme === 'dark'
          ? parsed.theme
          : 'dark',
    systemNotificationsEnabled: parsed.systemNotificationsEnabled === true,
    interfaceFont: isInterfaceFont(parsed.interfaceFont)
      ? parsed.interfaceFont
      : DEFAULT_INTERFACE_FONT,
    codeFont: isCodeFont(parsed.codeFont) ? parsed.codeFont : DEFAULT_CODE_FONT,
    numberFont: isNumberFont(parsed.numberFont) ? parsed.numberFont : DEFAULT_NUMBER_FONT,
  }
}

const settings = reactive<AppSettings>(loadSettings())
const { currentTheme, setTheme } = useTheme()
const { currentLang, setLang } = useI18n()
const {
  currentInterfaceFont,
  currentCodeFont,
  currentNumberFont,
  setInterfaceFont,
  setCodeFont,
  setNumberFont,
} = useTypography()
settings.language = currentLang.value
settings.theme = currentTheme.value
settings.interfaceFont = currentInterfaceFont.value
settings.codeFont = currentCodeFont.value
settings.numberFont = currentNumberFont.value

let isWatching = false

function startWatching() {
  if (isWatching) return
  isWatching = true

  watch(
    settings,
    (value) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    },
    { deep: true },
  )

  watch(
    () => settings.theme,
    (value) => {
      if (currentTheme.value !== value) setTheme(value)
    },
  )
  watch(
    () => settings.language,
    (value) => {
      if (currentLang.value !== value) setLang(value)
    },
  )
  watch(
    () => settings.interfaceFont,
    (value) => {
      if (currentInterfaceFont.value !== value) setInterfaceFont(value)
    },
  )
  watch(
    () => settings.codeFont,
    (value) => {
      if (currentCodeFont.value !== value) setCodeFont(value)
    },
  )
  watch(
    () => settings.numberFont,
    (value) => {
      if (currentNumberFont.value !== value) setNumberFont(value)
    },
  )

  // Keep this renderer's settings snapshot current when another window changes a preference.
  // This prevents a later font update from persisting a stale language/theme value.
  watch(currentTheme, (value) => {
    if (settings.theme !== value) settings.theme = value
  })
  watch(currentLang, (value) => {
    if (settings.language !== value) settings.language = value
  })
  watch(currentInterfaceFont, (value) => {
    if (settings.interfaceFont !== value) settings.interfaceFont = value
  })
  watch(currentCodeFont, (value) => {
    if (settings.codeFont !== value) settings.codeFont = value
  })
  watch(currentNumberFont, (value) => {
    if (settings.numberFont !== value) settings.numberFont = value
  })
}

startWatching()

export function useAppSettings() {
  function updateLanguage(lang: Lang) {
    settings.language = lang
  }

  function updateTheme(theme: Theme) {
    settings.theme = theme
  }

  function updateSystemNotifications(enabled: boolean) {
    settings.systemNotificationsEnabled = enabled
  }

  function updateInterfaceFont(font: InterfaceFont) {
    settings.interfaceFont = font
  }

  function updateCodeFont(font: CodeFont) {
    settings.codeFont = font
  }

  function updateNumberFont(font: NumberFont) {
    settings.numberFont = font
  }

  function exportSettings(): string {
    return JSON.stringify(settings, null, 2)
  }

  function downloadSettings() {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'app-settings.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return {
    settings,
    updateLanguage,
    updateTheme,
    updateSystemNotifications,
    updateInterfaceFont,
    updateCodeFont,
    updateNumberFont,
    exportSettings,
    downloadSettings,
  }
}
