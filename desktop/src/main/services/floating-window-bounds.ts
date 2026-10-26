import type { Rectangle, Screen } from 'electron'

// At minimum width, leave half a recent-session card visible below empty favorites.
export const DEFAULT_FLOATING_HEIGHT = 837
export const MIN_FLOATING_WIDTH = 400
export const MIN_FLOATING_HEIGHT = 520

/** Restore dimensions against the saved display, falling back to the primary. */
export function initialFloatingWindowBounds(
  state: Partial<Rectangle>,
  screen: Pick<Screen, 'getAllDisplays' | 'getPrimaryDisplay' | 'getDisplayMatching'>,
): {
  size: Pick<Rectangle, 'width' | 'height'>
  position: Pick<Rectangle, 'x' | 'y'>
  maxHeight: number
} {
  const width = Math.max(MIN_FLOATING_WIDTH, state.width ?? MIN_FLOATING_WIDTH)
  const height = Math.max(MIN_FLOATING_HEIGHT, state.height ?? DEFAULT_FLOATING_HEIGHT)
  const visible = (x: number, y: number, width: number, height: number): boolean =>
    screen
      .getAllDisplays()
      .some(
        ({ workArea: area }) =>
          x < area.x + area.width - 40 &&
          x + width > area.x + 40 &&
          y < area.y + area.height - 40 &&
          y + height > area.y + 40,
      )
  const savedPosition =
    typeof state.x === 'number' && typeof state.y === 'number' ? { x: state.x, y: state.y } : null
  const area =
    savedPosition && visible(savedPosition.x, savedPosition.y, width, height)
      ? screen.getDisplayMatching({ ...savedPosition, width, height }).workArea
      : screen.getPrimaryDisplay().workArea
  const size = { width: Math.min(area.width, 900, width), height: Math.min(area.height, height) }
  const primary = screen.getPrimaryDisplay().workArea
  const position =
    savedPosition && visible(savedPosition.x, savedPosition.y, size.width, size.height)
      ? savedPosition
      : {
          x: Math.max(primary.x, primary.x + primary.width - size.width - 24),
          y: Math.max(
            primary.y,
            Math.min(primary.y + 24, primary.y + primary.height - size.height),
          ),
        }
  return {
    size,
    position,
    maxHeight: screen.getDisplayMatching({ ...position, ...size }).workArea.height,
  }
}
