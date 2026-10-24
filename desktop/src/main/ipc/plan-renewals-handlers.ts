import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IPC } from './channels'
import { openDatabase } from '../services/sqlite-storage.service'
import { createPlanRenewalStore } from '../services/plan-renewals.service'

export function registerPlanRenewalHandlers(getWindow: () => BrowserWindow | null): void {
  let store: ReturnType<typeof createPlanRenewalStore> | undefined
  function renewals(event: IpcMainInvokeEvent) {
    if (event.sender !== getWindow()?.webContents || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Renewals require the main application window')
    return (store ??= createPlanRenewalStore(openDatabase()))
  }
  ipcMain.handle(IPC.PLAN_RENEWALS_LIST, (event) => renewals(event).list())
  ipcMain.handle(IPC.PLAN_RENEWALS_SAVE, (event, input: unknown) => renewals(event).save(input))
  ipcMain.handle(IPC.PLAN_RENEWALS_DELETE, (event, id: unknown) => renewals(event).remove(id))
  ipcMain.handle(IPC.PLAN_RENEWALS_REORDER, (event, ids: unknown) => renewals(event).reorder(ids))
  ipcMain.handle(IPC.PLAN_RENEWALS_COMPLETE, (event, input: unknown) =>
    renewals(event).complete(input),
  )
}
