import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ScanRefreshPreferences } from '../../shared/scan-refresh'
import { ScanRefreshController } from '../services/scan-refresh-controller'
import { getScanProgress, onScanProgress, performScan } from '../services/scan.service'
import { IPC } from './channels'

export function registerScanRefreshHandlers(): void {
  const controller = new ScanRefreshController({
    load: async () => {
      try {
        return JSON.parse(
          await readFile(join(app.getPath('userData'), 'scan-refresh.json'), 'utf8'),
        )
      } catch {
        return null
      }
    },
    save: async (preferences) => {
      const directory = app.getPath('userData')
      const path = join(directory, 'scan-refresh.json')
      await mkdir(directory, { recursive: true })
      await writeFile(path + '.tmp', JSON.stringify(preferences), { mode: 0o600 })
      await rename(path + '.tmp', path)
    },
    scan: () => performScan({ mode: 'incremental' }),
    publish: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        try {
          if (!window.isDestroyed() && !window.webContents.isDestroyed())
            window.webContents.send(IPC.SCAN_REFRESH_CHANGED, state)
        } catch {
          // A window may close while the shared state is being delivered.
        }
      }
    },
  })
  controller.setRunning(getScanProgress()?.status === 'running')
  const unsubscribe = onScanProgress((progress) =>
    controller.setRunning(progress.status === 'running'),
  )
  app.once('will-quit', () => {
    unsubscribe()
    controller.stop()
  })
  const observed = new Set<number>()
  function sender(event: IpcMainInvokeEvent): void {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !BrowserWindow.fromWebContents(event.sender)
    )
      throw new Error('Invalid scan refresh sender')
  }
  ipcMain.handle(IPC.SCAN_REFRESH_READ, (event) => {
    sender(event)
    return controller.read()
  })
  ipcMain.handle(IPC.SCAN_REFRESH_CONFIGURE, async (event, preferences: ScanRefreshPreferences) => {
    sender(event)
    await controller.configure(preferences)
    return controller.read()
  })
  ipcMain.handle(IPC.SCAN_REFRESH_ACTIVE, async (event, active: boolean) => {
    sender(event)
    if (typeof active !== 'boolean') throw new Error('Invalid scan refresh visibility')
    const id = event.sender.id
    if (!observed.has(id)) {
      observed.add(id)
      event.sender.once('destroyed', () => {
        observed.delete(id)
        void controller.setActive(id, false).catch(() => {})
      })
    }
    await controller.setActive(id, active)
    return controller.read()
  })
}
