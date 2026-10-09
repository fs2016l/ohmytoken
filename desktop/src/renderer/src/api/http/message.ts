import type {
  CustomMessageData,
  CustomMessageEvent,
  CustomMessagePlacement,
} from '@shared/custom-message'

export type MessagePlacement = CustomMessagePlacement
export type MessageClientEvent = CustomMessageEvent
export type DesktopMessage = CustomMessageData
export type DesktopMessageLevel = DesktopMessage['level']
