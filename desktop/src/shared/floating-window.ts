export type FloatingWorkspace = 'overview' | 'sessions' | 'quota'
export type FloatingWorkspaceTarget = FloatingWorkspace | { announcementUid: string }

export type FloatingDockEdge = 'top' | 'left' | 'right'
export const FLOATING_EDGE_PEEK = 5
export const FLOATING_WINDOW_INSET = 12
export const FLOATING_WINDOW_RADIUS = 16
export const FLOATING_RESIZE_BAND = 6
// Values match Windows WMSZ_ directions; only these names cross IPC.
export const floatingResizeDirections = {
  left: 1,
  right: 2,
  top: 3,
  'top-left': 4,
  'top-right': 5,
  bottom: 6,
  'bottom-left': 7,
  'bottom-right': 8,
} as const
export type FloatingResizeDirection = keyof typeof floatingResizeDirections

export function isFloatingResizeDirection(value: unknown): value is FloatingResizeDirection {
  return typeof value === 'string' && Object.hasOwn(floatingResizeDirections, value)
}
export const FLOATING_EDGE_MOTION_MS = 280
export interface FloatingEdgeState {
  enabled: boolean
  edge: FloatingDockEdge | null
  hidden: boolean
  transition?: 'hiding' | 'revealing'
  motionDuration?: number
  motionId?: number
  nativeMotion?: boolean
  viewport?: { width: number; height: number; x: number; y: number }
}

const destinations: Record<FloatingWorkspace, string> = {
  overview: '/agent',
  sessions: '/sessions',
  quota: '/token',
}

/** Only product destinations may cross the native window boundary. */
export function floatingWorkspacePath(value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    'announcementUid' in value &&
    validAnnouncementUid(value.announcementUid)
  )
    return '/announcements/' + encodeURIComponent(value.announcementUid)
  if (typeof value !== 'string' || !Object.hasOwn(destinations, value))
    throw new TypeError('Unknown workspace destination')
  return destinations[value as FloatingWorkspace]
}

function validAnnouncementUid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 256 &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32)
  )
}

/** Announcement intents open over the current workspace instead of changing its route. */
export function announcementUidFromWorkspacePath(path: string): string | null {
  const match = /^\/announcements\/([^/?#]+)$/.exec(path)
  if (!match) return null
  try {
    const uid = decodeURIComponent(match[1])
    return validAnnouncementUid(uid) ? uid : null
  } catch {
    return null
  }
}
