import { clipboard, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { DISCOVERY_IPC, type DiscoveryNativeResult } from '../../shared/discovery-ui'
import { openDiscoveryUi } from '../services/discovery-ui.service'
import { requestDiscoveryCatalog } from '../services/discovery-request.service'

export function registerDiscoveryUiHandlers(getWindow: () => BrowserWindow | null): void {
  function check(event: IpcMainInvokeEvent): void {
    if (event.senderFrame !== event.sender.mainFrame || event.sender !== getWindow()?.webContents)
      throw new Error('Discovery requires the main Agent window')
  }
  async function run<T>(action: () => Promise<T>): Promise<DiscoveryNativeResult<T>> {
    try {
      return { ok: true, value: await action() }
    } catch (error) {
      const failure = error as { code?: unknown; status?: unknown }
      return {
        ok: false,
        error: {
          message:
            error instanceof Error
              ? error.message.slice(0, 300)
              : '网络中断或发现服务暂时不可用，请重试。',
          ...(typeof failure?.code === 'string' ? { code: failure.code } : {}),
          ...(typeof failure?.status === 'number' ? { status: failure.status } : {}),
        },
      }
    }
  }
  ipcMain.handle(DISCOVERY_IPC.DISCOVERY_UI_OPEN, (event, pageKey, force = false) => {
    check(event)
    return run(() => openDiscoveryUi(pageKey, force))
  })
  ipcMain.handle(DISCOVERY_IPC.DISCOVERY_CATALOG, (event, request) => {
    check(event)
    return run(() => requestDiscoveryCatalog(request))
  })
  ipcMain.handle(DISCOVERY_IPC.DISCOVERY_COPY, (event, text) => {
    check(event)
    if (typeof text !== 'string' || text.length > 1_000_000)
      throw new Error('Invalid clipboard text')
    clipboard.writeText(text)
  })
}
