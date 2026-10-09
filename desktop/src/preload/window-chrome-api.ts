import { ipcRenderer } from 'electron'
import {
  WINDOW_CHROME_ARGUMENT,
  WINDOW_CHROME_IPC,
  type WindowChromeAPI,
} from '../shared/window-chrome'

export const windowChromeAPI: WindowChromeAPI = {
  windowControlsOverlay: process.argv.includes(WINDOW_CHROME_ARGUMENT),
  setWindowControlSymbolColor: (color) => ipcRenderer.invoke(WINDOW_CHROME_IPC, color),
}
