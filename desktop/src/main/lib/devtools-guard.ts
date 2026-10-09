import type { BrowserWindow } from 'electron'
import { app } from 'electron'

/**
 * 生产环境关闭 DevTools 快捷入口（F12 / Ctrl+Shift+I|J|C / Cmd+Opt+I|J|C）。
 * electron-toolkit 的 optimizer 在生产分支不处理 F12，浮窗甚至没有挂任何快捷键屏蔽；
 * 这里统一兜底，开发环境完全不干预。
 */
export function blockDevtoolsShortcuts(window: BrowserWindow): void {
  if (!app.isPackaged) return
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const isDevtoolsKey =
      input.code === 'F12' ||
      ((input.control || input.meta) &&
        input.shift &&
        (input.code === 'KeyI' || input.code === 'KeyJ' || input.code === 'KeyC')) ||
      (input.alt &&
        input.meta &&
        (input.code === 'KeyI' || input.code === 'KeyJ' || input.code === 'KeyC'))
    if (isDevtoolsKey) event.preventDefault()
  })
}
