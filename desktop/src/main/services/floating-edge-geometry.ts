import { FLOATING_EDGE_PEEK, type FloatingDockEdge } from '../../shared/floating-window'

export interface EdgeBounds {
  x: number
  y: number
  width: number
  height: number
}
export interface EdgePoint {
  x: number
  y: number
}
export const EDGE_DISTANCE = 10
export const EDGE_STRIP_SIZE = FLOATING_EDGE_PEEK

export function containsPoint(bounds: EdgeBounds, point: EdgePoint): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  )
}

export function dockEdge(bounds: EdgeBounds, area: EdgeBounds): FloatingDockEdge | null {
  const distances: Array<[FloatingDockEdge, number]> = [
    ['top', Math.max(0, bounds.y - area.y)],
    ['left', Math.max(0, bounds.x - area.x)],
    ['right', Math.max(0, area.x + area.width - bounds.x - bounds.width)],
  ]
  distances.sort((a, b) => a[1] - b[1])
  return distances[0][1] <= EDGE_DISTANCE ? distances[0][0] : null
}

export function fitEdgeBounds(
  bounds: EdgeBounds,
  area: EdgeBounds,
  edge: FloatingDockEdge | null,
): EdgeBounds {
  const width = Math.min(bounds.width, area.width),
    height = Math.min(bounds.height, area.height)
  return {
    width,
    height,
    x:
      edge === 'left'
        ? area.x
        : edge === 'right'
          ? area.x + area.width - width
          : Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y:
      edge === 'top' ? area.y : Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
  }
}

/** The entire strip remains inside this display, including at shared monitor edges. */
export function edgeStrip(bounds: EdgeBounds, edge: FloatingDockEdge, inset = 0): EdgeBounds {
  return edge === 'top'
    ? {
        x: bounds.x + inset,
        y: bounds.y,
        width: bounds.width - inset * 2,
        height: EDGE_STRIP_SIZE,
      }
    : {
        x: edge === 'left' ? bounds.x : bounds.x + bounds.width - EDGE_STRIP_SIZE,
        y: bounds.y + inset,
        width: EDGE_STRIP_SIZE,
        height: bounds.height - inset * 2,
      }
}

/** Preserve the viewport: only the native window's position changes. */
export function hiddenEdgeBounds(
  bounds: EdgeBounds,
  edge: FloatingDockEdge,
  inset = 0,
): EdgeBounds {
  const hidden = { ...bounds }
  if (edge === 'top') hidden.y -= bounds.height - inset - EDGE_STRIP_SIZE
  else if (edge === 'left') hidden.x -= bounds.width - inset - EDGE_STRIP_SIZE
  else hidden.x += bounds.width - inset - EDGE_STRIP_SIZE
  return hidden
}

/** Clip paint and input before a moving window can enter a neighboring monitor. */
export function edgeClip(bounds: EdgeBounds, area: EdgeBounds): EdgeBounds {
  const x = Math.max(bounds.x, area.x),
    y = Math.max(bounds.y, area.y)
  return {
    x: x - bounds.x,
    y: y - bounds.y,
    width: Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - x),
    height: Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - y),
  }
}
