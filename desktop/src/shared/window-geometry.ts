export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}
export interface SavedWindowState {
  width?: number
  height?: number
  x?: number
  y?: number
  isMaximized?: boolean
}
export interface WindowFrameSize {
  width: number
  height: number
}

// Design canvas sizes describe the content area, excluding the native title bar and borders.
export const MAIN_WINDOW_DEFAULT = { width: 1600, height: 1000 } as const
export const MAIN_WINDOW_MINIMUM = { width: 1280, height: 800 } as const

/** Electron work areas are device-independent pixels, including OS scaling. */
export function fitMainWindow(
  saved: SavedWindowState,
  area: WorkArea,
  frame: WindowFrameSize = { width: 0, height: 0 },
) {
  const frameWidth = Math.max(0, Math.min(frame.width, area.width - 1))
  const frameHeight = Math.max(0, Math.min(frame.height, area.height - 1))
  const availableWidth = area.width - frameWidth
  const availableHeight = area.height - frameHeight
  const scale = Math.min(
    1,
    availableWidth / MAIN_WINDOW_MINIMUM.width,
    availableHeight / MAIN_WINDOW_MINIMUM.height,
  )
  const minWidth = Math.max(1, Math.floor(MAIN_WINDOW_MINIMUM.width * scale)) + frameWidth
  const minHeight = Math.max(1, Math.floor(MAIN_WINDOW_MINIMUM.height * scale)) + frameHeight
  const defaultScale = Math.min(
    1,
    availableWidth / MAIN_WINDOW_DEFAULT.width,
    availableHeight / MAIN_WINDOW_DEFAULT.height,
  )
  const valid = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value)
  const width = Math.round(
    Math.min(
      area.width,
      Math.max(
        minWidth,
        valid(saved.width) && saved.width > 0
          ? saved.width
          : MAIN_WINDOW_DEFAULT.width * defaultScale + frameWidth,
      ),
    ),
  )
  const height = Math.round(
    Math.min(
      area.height,
      Math.max(
        minHeight,
        valid(saved.height) && saved.height > 0
          ? saved.height
          : MAIN_WINDOW_DEFAULT.height * defaultScale + frameHeight,
      ),
    ),
  )
  const x = Math.round(
    Math.max(
      area.x,
      Math.min(
        area.x + area.width - width,
        valid(saved.x) ? saved.x : area.x + (area.width - width) / 2,
      ),
    ),
  )
  const y = Math.round(
    Math.max(
      area.y,
      Math.min(
        area.y + area.height - height,
        valid(saved.y) ? saved.y : area.y + (area.height - height) / 2,
      ),
    ),
  )
  return { width, height, x, y, minWidth, minHeight, isMaximized: saved.isMaximized === true }
}
