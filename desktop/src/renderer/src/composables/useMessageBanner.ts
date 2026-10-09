import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { isMessageCurrent, useMessageDetails } from './useMessageDetails'
import {
  type DesktopMessage,
  type MessageClientEvent,
  type MessagePlacement,
} from '../api/http/message'

const ACTIVE_MESSAGE_LIMIT = 10
const DEFAULT_DISPLAY_DURATION_SECONDS = 8
const MIN_DISPLAY_DURATION_SECONDS = 3
const MAX_DISPLAY_DURATION_SECONDS = 300
type RollDirection = 'up' | 'down'

function displayDurationMs(message: DesktopMessage): number {
  const requested = Number(message.displayDurationSeconds)
  const seconds = Number.isFinite(requested) ? requested : DEFAULT_DISPLAY_DURATION_SECONDS
  return (
    Math.max(MIN_DISPLAY_DURATION_SECONDS, Math.min(MAX_DISPLAY_DURATION_SECONDS, seconds)) * 1000
  )
}

function matchesPlacement(message: DesktopMessage, placement: MessagePlacement): boolean {
  return message.displayScope === 'both' || message.displayScope === placement
}

function messageSortTime(message: DesktopMessage): number {
  const raw = message.pushedAt || message.updateTime || message.createTime
  if (!raw) return 0
  const timestamp = new Date(raw).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function sortMessages(messages: DesktopMessage[]): DesktopMessage[] {
  return [...messages].sort((left, right) => {
    const priority = (right.priority || 0) - (left.priority || 0)
    if (priority !== 0) return priority
    const pushedAt = messageSortTime(right) - messageSortTime(left)
    return pushedAt !== 0 ? pushedAt : right.id - left.id
  })
}

export function useMessageBanner(placement: MessagePlacement, interacting: Ref<boolean>) {
  const messages = ref<DesktopMessage[]>([])
  const activeIndex = ref(0)
  const rollDirection = ref<RollDirection>('up')
  const details = useMessageDetails()
  const detailsOpen = computed(() => !!details.message.value)
  const isLoading = ref(false)
  const viewedVersions = new Set<string>()
  let expiryTimer: ReturnType<typeof setTimeout> | null = null
  let rotateTimer: ReturnType<typeof setTimeout> | null = null
  let titleDuration: { messageUid: string; milliseconds: number } | null = null
  let mounted = false
  let unsubscribeAnnouncements: (() => void) | null = null

  const currentMessage = computed(() => messages.value[activeIndex.value] || null)
  const rotationKey = computed(() => {
    const message = currentMessage.value
    return message ? `${message.id}:${message.messageUid}:${message.displayDurationSeconds}` : ''
  })

  function applyMessages(nextMessages: DesktopMessage[]): void {
    const currentUid = currentMessage.value?.messageUid
    const uniqueMessages = new Map<string, DesktopMessage>()
    for (const message of nextMessages) {
      if (isMessageCurrent(message) && matchesPlacement(message, placement)) {
        uniqueMessages.set(message.messageUid, message)
      }
    }
    const next = sortMessages([...uniqueMessages.values()]).slice(0, ACTIVE_MESSAGE_LIMIT)
    const activeViewKeys = new Set(next.map((message) => `${message.messageUid}:${placement}`))
    for (const key of viewedVersions) {
      if (!activeViewKeys.has(key)) viewedVersions.delete(key)
    }

    const preservedIndex = currentUid
      ? next.findIndex((message) => message.messageUid === currentUid)
      : -1
    messages.value = next
    activeIndex.value = preservedIndex >= 0 ? preservedIndex : 0
  }

  async function loadCached(): Promise<void> {
    const cached = await window.api.customMessagesList(placement)
    if (!mounted) return
    applyMessages(cached)
    if (expiryTimer) clearTimeout(expiryTimer)
    const now = Date.now()
    const ends = messages.value
      .map((message) => (message.endAt ? new Date(message.endAt).getTime() : NaN))
      .filter((end) => Number.isFinite(end) && end > now)
    // Local expiry also hides the final remaining banner while the device is offline.
    expiryTimer = ends.length
      ? setTimeout(
          () => {
            void loadCached()
          },
          Math.min(2_147_483_647, Math.max(1, Math.min(...ends) - now)),
        )
      : null
  }

  async function queueReceipt(message: DesktopMessage, event: MessageClientEvent): Promise<void> {
    await window.api.customMessageReceiptQueue(message.id, message.messageUid, event, placement)
  }

  async function refresh(): Promise<void> {
    if (isLoading.value) return
    isLoading.value = true
    try {
      await window.api.wakeAgentHeartbeat()
      await loadCached()
    } catch (error) {
      console.warn('[message-banner] 当前无法同步顶部消息，继续使用本地缓存:', error)
    } finally {
      isLoading.value = false
    }
  }

  function select(index: number, direction: RollDirection = 'up'): void {
    if (!messages.value.length) return
    const normalized = (index + messages.value.length) % messages.value.length
    rollDirection.value = direction
    if (normalized === activeIndex.value) {
      scheduleRotation()
      return
    }
    activeIndex.value = normalized
    if (placement === 'floating' && detailsOpen.value && currentMessage.value) {
      details.open(currentMessage.value, placement)
      reportViewed(currentMessage.value)
    }
  }

  function next(): void {
    select(activeIndex.value + 1, 'up')
  }

  function previous(): void {
    select(activeIndex.value - 1, 'down')
  }

  function openDetails(message: DesktopMessage): void {
    if (placement === 'floating' && details.message.value?.messageUid === message.messageUid) {
      details.close()
      return
    }
    details.open(message, placement)
    reportViewed(message)
  }

  function reportViewed(message: DesktopMessage): void {
    if (document.hidden) return
    const version = `${message.messageUid}:${placement}`
    if (viewedVersions.has(version)) return
    viewedVersions.add(version)
    void queueReceipt(message, 'view')
  }

  function clearRotation(): void {
    if (rotateTimer) clearTimeout(rotateTimer)
    rotateTimer = null
  }

  function scheduleRotation(): void {
    clearRotation()
    const message = currentMessage.value
    if (
      !mounted ||
      document.hidden ||
      detailsOpen.value ||
      interacting.value ||
      messages.value.length <= 1 ||
      !message
    )
      return
    const readingTime =
      titleDuration?.messageUid === message.messageUid ? titleDuration.milliseconds : 0
    rotateTimer = setTimeout(next, Math.max(displayDurationMs(message), readingTime))
  }

  function setTitleDuration(messageUid: string, milliseconds: number): void {
    // A leaving transition can still be measured after the next banner is active.
    if (currentMessage.value?.messageUid !== messageUid) return
    titleDuration = { messageUid, milliseconds }
    scheduleRotation()
  }

  function handleVisibilityChange(): void {
    if (document.hidden) {
      clearRotation()
      return
    }
    void loadCached().then(() => {
      if (currentMessage.value) reportViewed(currentMessage.value)
    })
    scheduleRotation()
  }

  watch(
    rotationKey,
    () => {
      if (currentMessage.value) reportViewed(currentMessage.value)
      scheduleRotation()
    },
    { flush: 'post' },
  )
  watch([detailsOpen, interacting], scheduleRotation, { flush: 'post' })
  watch(() => messages.value.length, scheduleRotation, { flush: 'post' })

  onMounted(() => {
    mounted = true
    void loadCached()
    unsubscribeAnnouncements = window.api.onAnnouncementsChanged(() => {
      void loadCached()
    })
    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onUnmounted(() => {
    mounted = false
    if (expiryTimer) clearTimeout(expiryTimer)
    clearRotation()
    unsubscribeAnnouncements?.()
    window.removeEventListener('online', handleOnline)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  function handleOnline(): void {
    void window.api.wakeAgentHeartbeat()
  }

  return {
    messages,
    currentMessage,
    activeIndex,
    rollDirection,
    detailsOpen,
    isLoading,
    refresh,
    next,
    previous,
    select,
    openDetails,
    setTitleDuration,
  }
}
