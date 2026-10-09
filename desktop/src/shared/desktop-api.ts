import type {
  CustomMessageData,
  CustomMessageEvent,
  CustomMessagePlacement,
} from './custom-message'

export interface AuthActionResult {
  ok: boolean
  message?: string
}

export interface DesktopUserInfo {
  id: number
  username: string
  nickname: string | null
  email: string | null
  avatar: string | null
}

export type AuthSessionResult =
  | { status: 'authenticated'; user: DesktopUserInfo }
  | { status: 'anonymous' }
  | { status: 'invalid' }
  | { status: 'unavailable'; message?: string; cachedUser?: DesktopUserInfo }

export interface DesktopFeedbackSubmitParams {
  category: string
  title?: string
  content: string
  contact?: string
  images?: string
}

export interface DesktopMessageSyncResult {
  revision: string
  mainMessages: CustomMessageData[]
  floatingMessages: CustomMessageData[]
}

export interface DesktopHeartbeatResult {
  serverTime: number
  announcementRevision: string
  onlineWindowSeconds: number
}

export interface DesktopMessageEventInput {
  messageId: number
  messageUid: string
  event: CustomMessageEvent
  placement: CustomMessagePlacement
}
