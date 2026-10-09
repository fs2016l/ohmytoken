import { createApp } from 'vue'
import type { AppLanguage } from '@shared/app-preferences'
import { initializeAppPreferences } from './initial-preferences'

/** Finish first-run setup before loading any module that reads language or currency. */
export async function setupPreferences(floating = false): Promise<void> {
  const preferences = await initializeAppPreferences({
    storage: localStorage,
    getInstallationLanguage: () => window.api.getInstallationLanguage(),
    chooseLanguage: floating
      ? undefined
      : async () => {
          const { default: LanguageSetup } = await import('../components/layout/LanguageSetup.vue')
          return new Promise<AppLanguage>((resolve) => {
            const setup = createApp(LanguageSetup, {
              onChoose(language: AppLanguage) {
                setup.unmount()
                resolve(language)
              },
            })
            setup.mount('#app')
          })
        },
  })
  if (preferences && typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('ohmyagent-preferences')
    channel.postMessage({ type: 'language', value: preferences.language })
    channel.postMessage({ type: 'currency', value: preferences.currency })
    channel.close()
  }
}
