import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc/channels'
import type { FloatingResizeDirection } from '../shared/floating-window'

export const floatingResizeAPI = {
  isFloatingWindowCollapsed: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_GET_COLLAPSED),
  setFloatingWindowCollapsed: (collapsed: boolean, height: number): Promise<boolean> =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_SET_COLLAPSED, collapsed, height),
  hasFloatingWindowResizeHandles: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_RESIZE_HANDLES),
  beginFloatingWindowResize: (direction: FloatingResizeDirection): Promise<boolean> =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_BEGIN_RESIZE, direction),
}
