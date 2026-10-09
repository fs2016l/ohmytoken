import { defaultCostCurrency, isAppLanguage, type AppLanguage } from '@shared/app-preferences'
import type { CostCurrency } from '@shared/usage-cost'

interface InitialPreferenceOptions {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  getInstallationLanguage: () => Promise<unknown>
  chooseLanguage?: () => Promise<AppLanguage>
}

export async function initializeAppPreferences({
  storage,
  getInstallationLanguage,
  chooseLanguage,
}: InitialPreferenceOptions): Promise<{ language: AppLanguage; currency: CostCurrency } | null> {
  let language: unknown = storage.getItem('app-lang')
  if (!isAppLanguage(language)) {
    try {
      language = JSON.parse(storage.getItem('app-settings') || '{}').language
    } catch {
      language = null
    }
  }
  if (!isAppLanguage(language)) {
    try {
      language = await getInstallationLanguage()
    } catch {
      language = null
    }
  }
  // A mini window never opens setup. The main window will broadcast its completed choice.
  if (!isAppLanguage(language)) {
    if (!chooseLanguage) return null
    language = await chooseLanguage()
  }
  if (!isAppLanguage(language)) return null
  const storedCurrency = storage.getItem('cost-currency')
  const currency =
    storedCurrency === 'CNY' || storedCurrency === 'USD'
      ? storedCurrency
      : defaultCostCurrency(language)
  storage.setItem('app-lang', language)
  storage.setItem('cost-currency', currency)
  return { language, currency }
}
