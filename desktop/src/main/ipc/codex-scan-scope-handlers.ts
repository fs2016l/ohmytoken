import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { CodexScanScope } from '../../shared/codex-scan-scope'
import { codexScanScope, configureCodexScanScope } from '../services/codex-scan-scope.service'
import { IPC } from './channels'

export function registerCodexScanScopeHandlers(windowGetter: () => BrowserWindow | null): void {
  configureCodexScanScope(windowGetter)
  function sender(event: IpcMainInvokeEvent): void {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      event.sender !== windowGetter()?.webContents
    )
      throw new Error('Invalid Codex scan scope sender')
  }
  ipcMain.handle(IPC.CODEX_SCAN_SCOPE_READ, (event) => {
    sender(event)
    return codexScanScope.read()
  })
  ipcMain.handle(
    IPC.CODEX_SCAN_SCOPE_RESOLVE,
    (event, id: number, scope: CodexScanScope | null) => {
      sender(event)
      if (!Number.isSafeInteger(id)) throw new Error('Invalid Codex scan scope request')
      return codexScanScope.resolve(id, scope)
    },
  )
}
