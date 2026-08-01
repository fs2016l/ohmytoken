import type { DesktopMessageSyncResult } from '@shared/desktop-api'
import type {
  CustomMessageData,
  CustomMessageEvent,
  CustomMessagePlacement,
} from '@shared/custom-message'

export type MessagePlacement = CustomMessagePlacement
export type MessageClientEvent = CustomMessageEvent
export type DesktopMessage = CustomMessageData
export type DesktopMessageLevel = DesktopMessage['level']
export type MessageSyncResult = DesktopMessageSyncResult

export async function syncActiveMessages(placement: MessagePlacement): Promise<MessageSyncResult> {
  const result = await window.api.syncDesktopMessages(placement)
  if (!result.ok) throw new Error(result.message || '消息服务暂不可用')
  return result
}

export async function reportMessageEvent(
  messageId: number,
  messageUid: string,
  event: MessageClientEvent,
  placement: MessagePlacement,
): Promise<void> {
  const result = await window.api.reportDesktopMessageEvent({
    messageId,
    messageUid,
    event,
    placement,
  })
  if (!result.ok) throw new Error(result.message || '消息回执暂时无法提交')
}
