export const WINDOW_CHROME_HEIGHT = 32
export const WINDOW_CHROME_ARGUMENT = '--omt-window-controls-overlay'
export const WINDOW_CHROME_IPC = 'window-chrome:set-symbol-color'

export interface WindowChromeAPI {
  readonly windowControlsOverlay: boolean
  setWindowControlSymbolColor(color: string): Promise<void>
}
