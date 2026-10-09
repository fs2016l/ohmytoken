import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc/channels'
import type { ScanRefreshAPI, ScanRefreshState } from '../shared/scan-refresh'

export const scanRefreshAPI: ScanRefreshAPI = {
  scanRefreshRead: () => ipcRenderer.invoke(IPC.SCAN_REFRESH_READ),
  scanRefreshConfigure: (preferences) =>
    ipcRenderer.invoke(IPC.SCAN_REFRESH_CONFIGURE, preferences),
  scanRefreshSetActive: (active) => ipcRenderer.invoke(IPC.SCAN_REFRESH_ACTIVE, active),
  onScanRefreshChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ScanRefreshState): void =>
      callback(state)
    ipcRenderer.on(IPC.SCAN_REFRESH_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC.SCAN_REFRESH_CHANGED, listener)
  },
}
