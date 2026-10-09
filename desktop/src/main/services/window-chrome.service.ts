import {
  ipcMain,
  nativeTheme,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
} from 'electron'
import { WINDOW_CHROME_HEIGHT, WINDOW_CHROME_IPC } from '../../shared/window-chrome'

export function mainWindowChromeOptions(): Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'titleBarOverlay'
> {
  if (process.platform !== 'win32') return {}
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#e6eefb' : '#17233b',
      height: WINDOW_CHROME_HEIGHT,
    },
  }
}

export function registerWindowChromeIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(WINDOW_CHROME_IPC, (event, color: unknown) => {
    const window = getWindow()
    if (
      process.platform !== 'win32' ||
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error('Unknown window chrome sender')
    if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color))
      throw new Error('Invalid window control color')
    window.setTitleBarOverlay({ symbolColor: color })
  })
}
