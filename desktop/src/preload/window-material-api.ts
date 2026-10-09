import { ipcRenderer } from 'electron'
import {
  MATERIAL_IPC,
  type WindowMaterialAPI,
  type WindowMaterialState,
} from '../shared/window-material'
export const windowMaterialAPI: WindowMaterialAPI = {
  getWindowMaterial: () => ipcRenderer.invoke(MATERIAL_IPC.GET),
  setWindowMaterial: (preferences) => ipcRenderer.invoke(MATERIAL_IPC.SET, preferences),
  onWindowMaterialChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: WindowMaterialState): void =>
      callback(state)
    ipcRenderer.on(MATERIAL_IPC.CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(MATERIAL_IPC.CHANGED, handler)
    }
  },
}
