import { ipcRenderer } from 'electron'
import type { CodexScanScopeAPI, CodexScanScopeRequest } from '../shared/codex-scan-scope'
import { IPC } from '../main/ipc/channels'

export const codexScanScopeAPI: CodexScanScopeAPI = {
  codexScanScopeRead: () => ipcRenderer.invoke(IPC.CODEX_SCAN_SCOPE_READ),
  codexScanScopeResolve: (id, scope) => ipcRenderer.invoke(IPC.CODEX_SCAN_SCOPE_RESOLVE, id, scope),
  onCodexScanScopeChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, request: CodexScanScopeRequest | null) =>
      callback(request)
    ipcRenderer.on(IPC.CODEX_SCAN_SCOPE_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC.CODEX_SCAN_SCOPE_CHANGED, listener)
  },
}
