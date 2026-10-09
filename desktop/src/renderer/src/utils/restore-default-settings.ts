import { defaultCostCurrency, isAppLanguage } from '@shared/app-preferences'
import { DEFAULT_SCAN_REFRESH } from '@shared/scan-refresh'

// Keep this allowlist separate from caches, credentials, favorites and generated files.
const preferenceKeys = [
  'app-settings',
  'app-theme',
  'app-accent',
  'app-appearance-version',
  'app-interface-font',
  'app-code-font',
  'app-number-font',
  'chart-color-mode',
  'date-from',
  'date-to',
  'article-reading-size',
  'agent-reading-size',
  'floating-view',
  'floating-token-preferences',
  'floating-quota-followed',
  'floating-quota-order',
  'network-monitor-application-order',
  'replay-export-preferences-v1',
] as const

interface RestoreOptions {
  api: Pick<
    Window['api'],
    | 'scanRefreshConfigure'
    | 'tokenPlanMonitorSetInterval'
    | 'networkMonitorAutoStart'
    | 'networkMonitorFileAssociation'
    | 'networkMonitorStop'
    | 'setCloseBehavior'
    | 'resetFloatingWindowPreferences'
  >
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  resetMaterial: () => Promise<void>
  resetBrowsing: () => Promise<void>
}

/** The caller reloads the renderer only after every preference has been saved successfully. */
export async function restoreDefaultSettings({
  api,
  storage,
  resetMaterial,
  resetBrowsing,
}: RestoreOptions): Promise<void> {
  const language = storage.getItem('app-lang')
  // Older installations may still have unmigrated session favorites in this preference.
  let pinned: unknown[] = []
  try {
    const saved = JSON.parse(storage.getItem('floating-session-preferences') ?? 'null')
    if (Array.isArray(saved?.pinned)) pinned = saved.pinned
  } catch {
    // A malformed preference has no readable favorites to migrate.
  }

  await api.scanRefreshConfigure({ ...DEFAULT_SCAN_REFRESH })
  await api.tokenPlanMonitorSetInterval(0)
  await api.networkMonitorAutoStart(false)
  await api.networkMonitorFileAssociation(false)
  await api.networkMonitorStop()
  await api.setCloseBehavior('ask')
  // Close the other renderer before clearing shared preferences so it cannot write them back.
  await api.resetFloatingWindowPreferences()
  await resetMaterial()

  for (const key of preferenceKeys) storage.removeItem(key)
  storage.setItem('cost-currency', defaultCostCurrency(isAppLanguage(language) ? language : 'zh'))
  storage.setItem('floating-session-preferences', JSON.stringify({ latestCount: 5, pinned }))
  await resetBrowsing()
}
