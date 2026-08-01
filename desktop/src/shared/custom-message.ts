export type CustomMessagePlacement = 'main' | 'floating'
export type CustomMessageEvent = 'delivered' | 'view' | 'click'

export interface CustomMessageImageData {
  id: number
  imageUrl: string
  actionUrl?: string
}

export interface CustomMessageData {
  id: number
  messageUid: string
  status: 'published'
  titleZh: string
  titleEn?: string
  contentZh: string
  contentEn?: string
  level: 'info' | 'success' | 'warning' | 'important'
  displayScope: 'main' | 'floating' | 'both'
  showInNotificationCenter: boolean
  images: CustomMessageImageData[]
  priority: number
  displayDurationSeconds: number
  startAt?: string
  endAt?: string
  pushedAt?: string
  createTime?: string
  updateTime?: string
}

export interface CustomMessageReceipt {
  id: number
  messageId: number
  messageUid: string
  event: CustomMessageEvent
  placement: CustomMessagePlacement
  attempts: number
}
