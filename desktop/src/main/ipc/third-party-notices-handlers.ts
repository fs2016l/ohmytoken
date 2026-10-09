import { app, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { THIRD_PARTY_IPC as IPC } from '../../shared/third-party-notices'
import { ThirdPartyNoticesService } from '../services/third-party-notices.service'

export function registerThirdPartyNoticesHandlers(getWindow: () => BrowserWindow | null): void {
  // Resolve paths only after Electron is ready and the handler is invoked.
  let service: ThirdPartyNoticesService | undefined
  function check(event: IpcMainInvokeEvent): void {
    if (event.sender !== getWindow()?.webContents || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Notices require the main application window')
  }
  function notices(): ThirdPartyNoticesService {
    return (service ??= new ThirdPartyNoticesService(
      app.isPackaged
        ? join(process.resourcesPath, 'licenses')
        : join(app.getAppPath(), 'third-party-licenses'),
    ))
  }
  ipcMain.handle(IPC.NOTICES_LIST, (event) => {
    check(event)
    return notices().list()
  })
  ipcMain.handle(IPC.NOTICES_READ, (event, id: string, document: number) => {
    check(event)
    return notices().read(id, document)
  })
  ipcMain.handle(IPC.NOTICES_CHROMIUM, async (event) => {
    check(event)
    const file = app.isPackaged
      ? join(process.resourcesPath, 'licenses/runtime/LICENSES.chromium.html')
      : join(app.getAppPath(), 'node_modules/electron/dist/LICENSES.chromium.html')
    const error = await shell.openPath(file)
    if (error) throw new Error('Could not open runtime notices')
  })
}
