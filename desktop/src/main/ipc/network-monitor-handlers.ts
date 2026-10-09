import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { NetworkMonitorService } from '../network-monitor/service'
import { NETWORK_MONITOR_IPC as IPC } from './network-monitor-channels'

export function registerNetworkMonitorHandlers(getWindow: () => BrowserWindow | null): void {
  let subscriber: number | null = null
  const observed = (): boolean => {
    const window = getWindow()
    return (
      !!window &&
      !window.isDestroyed() &&
      window.webContents.id === subscriber &&
      window.isVisible() &&
      !window.isMinimized()
    )
  }
  const monitor = new NetworkMonitorService((snapshot) => {
    const window = getWindow()
    if (observed()) window!.webContents.send(IPC.CHANGED, snapshot)
  }, observed)
  ipcMain.on(IPC.SUBSCRIBE, (event, enabled: unknown) => {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      event.sender !== getWindow()?.webContents ||
      typeof enabled !== 'boolean'
    )
      return
    subscriber = enabled ? event.sender.id : null
  })
  function check(event: IpcMainInvokeEvent): void {
    if (event.senderFrame !== event.sender.mainFrame || event.sender !== getWindow()?.webContents)
      throw new Error('Network monitor requires the main window')
  }
  ipcMain.handle(IPC.SNAPSHOT, (event) => {
    check(event)
    return monitor.snapshot()
  })
  ipcMain.handle(IPC.START, (event) => {
    check(event)
    return monitor.start(true)
  })
  ipcMain.handle(IPC.STOP, (event) => {
    check(event)
    return monitor.stop()
  })
  ipcMain.handle(IPC.AUTO_START, (event, enabled: boolean) => {
    check(event)
    return monitor.setAutoStart(enabled)
  })
  ipcMain.handle(IPC.FILE_ASSOCIATION, (event, enabled: boolean) => {
    check(event)
    return monitor.setFileAssociation(enabled)
  })
  ipcMain.handle(
    IPC.RULE,
    (event, id: string, value: Parameters<NetworkMonitorService['updateRule']>[1]) => {
      check(event)
      return monitor.updateRule(id, value)
    },
  )
  ipcMain.handle(IPC.REMOVE, (event, id: string) => {
    check(event)
    return monitor.removeRule(id)
  })
  ipcMain.handle(IPC.CHOOSE, (event, language: 'en' | 'zh') => {
    check(event)
    return monitor.choose(getWindow()!, language === 'zh' ? 'zh' : 'en')
  })
  ipcMain.handle(IPC.PROCESSES, (event) => {
    check(event)
    return monitor.listProcesses()
  })
  ipcMain.handle(IPC.ADD, (event, input: Parameters<NetworkMonitorService['add']>[0]) => {
    check(event)
    return monitor.add(input)
  })
  app.once('before-quit', () => monitor.dispose())
  monitor.initialize()
}
