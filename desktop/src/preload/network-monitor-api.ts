import { ipcRenderer } from 'electron'
import type {
  MonitorAddApplication,
  MonitorApplicationChoice,
  MonitorProcess,
  MonitorSnapshot,
} from '../shared/network-monitor'
import { NETWORK_MONITOR_IPC as IPC } from '../main/ipc/network-monitor-channels'
export const networkMonitorAPI = {
  networkMonitorSnapshot: (): Promise<MonitorSnapshot> => ipcRenderer.invoke(IPC.SNAPSHOT),
  networkMonitorStart: (): Promise<MonitorSnapshot> => ipcRenderer.invoke(IPC.START),
  networkMonitorStop: (): Promise<MonitorSnapshot> => ipcRenderer.invoke(IPC.STOP),
  networkMonitorAutoStart: (enabled: boolean): Promise<MonitorSnapshot> =>
    ipcRenderer.invoke(IPC.AUTO_START, enabled),
  networkMonitorFileAssociation: (enabled: boolean): Promise<MonitorSnapshot> =>
    ipcRenderer.invoke(IPC.FILE_ASSOCIATION, enabled),
  networkMonitorRule: (
    id: string,
    value: { enabled?: boolean; name?: string; descendants?: boolean },
  ): Promise<MonitorSnapshot> => ipcRenderer.invoke(IPC.RULE, id, value),
  networkMonitorRemove: (id: string): Promise<MonitorSnapshot> =>
    ipcRenderer.invoke(IPC.REMOVE, id),
  networkMonitorChoose: (language: 'en' | 'zh'): Promise<MonitorApplicationChoice | null> =>
    ipcRenderer.invoke(IPC.CHOOSE, language),
  networkMonitorProcesses: (): Promise<MonitorProcess[]> => ipcRenderer.invoke(IPC.PROCESSES),
  networkMonitorAdd: (input: MonitorAddApplication): Promise<MonitorSnapshot> =>
    ipcRenderer.invoke(IPC.ADD, input),
  onNetworkMonitorChanged: (callback: (snapshot: MonitorSnapshot) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: MonitorSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on(IPC.CHANGED, handler)
    ipcRenderer.send(IPC.SUBSCRIBE, true)
    return () => {
      ipcRenderer.removeListener(IPC.CHANGED, handler)
      ipcRenderer.send(IPC.SUBSCRIBE, false)
    }
  },
}
export type NetworkMonitorAPI = typeof networkMonitorAPI
