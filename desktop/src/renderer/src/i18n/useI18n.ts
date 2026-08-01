import { ref } from 'vue'
import { type Lang, type TranslationKey, t } from './lang'

const STORAGE_KEY = 'app-lang'
const SYNC_CHANNEL = 'ohmyagent-preferences'

interface PreferenceMessage {
  type?: string
  value?: unknown
}

function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'zh'
}

const storedLang = localStorage.getItem(STORAGE_KEY)
const currentLang = ref<Lang>(isLang(storedLang) ? storedLang : 'zh')
const preferenceChannel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SYNC_CHANNEL)

function syncLang(lang: Lang): void {
  if (currentLang.value !== lang) currentLang.value = lang
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
}

syncLang(currentLang.value)

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY && isLang(event.newValue)) syncLang(event.newValue)
})

preferenceChannel?.addEventListener('message', (event: MessageEvent<PreferenceMessage>) => {
  if (event.data?.type === 'language' && isLang(event.data.value)) syncLang(event.data.value)
})

export function useI18n() {
  function setLang(lang: Lang): void {
    syncLang(lang)
    localStorage.setItem(STORAGE_KEY, lang)
    preferenceChannel?.postMessage({ type: 'language', value: lang })
  }

  function tr(key: TranslationKey): string {
    return t(key, currentLang.value)
  }

  function label(en: string, zh: string): string {
    return currentLang.value === 'zh' ? zh : en
  }

  return {
    currentLang,
    setLang,
    tr,
    label,
  }
}
