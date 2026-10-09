export const SCAN_REFRESH_INTERVALS = [30_000, 60_000, 300_000, 900_000] as const
export type ScanRefreshInterval = (typeof SCAN_REFRESH_INTERVALS)[number]

export interface ScanRefreshPreferences {
  enabled: boolean
  interval: ScanRefreshInterval
}

export interface ScanRefreshState extends ScanRefreshPreferences {
  revision: number
  running: boolean
  nextRefreshAt: number | null
}

export const DEFAULT_SCAN_REFRESH: ScanRefreshPreferences = { enabled: false, interval: 60_000 }

export function isScanRefreshInterval(value: unknown): value is ScanRefreshInterval {
  return SCAN_REFRESH_INTERVALS.includes(value as ScanRefreshInterval)
}

export interface ScanRefreshAPI {
  scanRefreshRead: () => Promise<ScanRefreshState>
  scanRefreshConfigure: (preferences: ScanRefreshPreferences) => Promise<ScanRefreshState>
  scanRefreshSetActive: (active: boolean) => Promise<ScanRefreshState>
  onScanRefreshChanged: (callback: (state: ScanRefreshState) => void) => () => void
}
