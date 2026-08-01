import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  reportMessageEvent,
  syncActiveMessages,
  type DesktopMessage,
  type MessageClientEvent,
  type MessagePlacement,
} from '../api/http/message'

const POLL_INTERVAL_MS = 60_000
const ACTIVE_MESSAGE_LIMIT = 10
const DEFAULT_DISPLAY_DURATION_SECONDS = 8
const MIN_DISPLAY_DURATION_SECONDS = 3
const MAX_DISPLAY_DURATION_SECONDS = 300
type RollDirection = 'up' | 'down'

let receiptFlushPromise: Promise<void> | null = null

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function flushReceiptOutbox(): Promise<void> {
  if (receiptFlushPromise) return receiptFlushPromise
  receiptFlushPromise = (async () => {
    const pending = await window.api.customMessageReceiptsPending()
    for (const receipt of pending) {
      try {
        await reportMessageEvent(
          receipt.messageId,
          receipt.messageUid,
          receipt.event,
          receipt.placement,
        )
        await window.api.customMessageReceiptSent(receipt.id)
      } catch (error) {
        await window.api.customMessageReceiptFailed(receipt.id, errorText(error))
      }
    }
  })().finally(() => {
    receiptFlushPromise = null
  })
  return receiptFlushPromise
}

function displayDurationMs(message: DesktopMessage): number {
  const requested = Number(message.displayDurationSeconds)
  const seconds = Number.isFinite(requested) ? requested : DEFAULT_DISPLAY_DURATION_SECONDS
  return (
    Math.max(MIN_DISPLAY_DURATION_SECONDS, Math.min(MAX_DISPLAY_DURATION_SECONDS, seconds)) * 1000
  )
}

function isCurrentlyActive(message: DesktopMessage): boolean {
  const now = Date.now()
  if (message.startAt && new Date(message.startAt).getTime() > now) return false
  if (message.endAt && new Date(message.endAt).getTime() <= now) return false
  return message.status === 'published'
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

export function useMessageBanner(placement: MessagePlacement) {
  const messages = ref<DesktopMessage[]>([])
  const activeIndex = ref(0)
  const rollDirection = ref<RollDirection>('up')
  const detailsOpen = ref(false)
  const isLoading = ref(false)
  const viewedVersions = new Set<string>()
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let rotateTimer: ReturnType<typeof setTimeout> | null = null
  let mounted = false
  let unsubscribeSse: (() => void) | null = null

  const currentMessage = computed(() => messages.value[activeIndex.value] || null)
  const rotationKey = computed(() => {
    const message = currentMessage.value
    return message ? `${message.id}:${message.messageUid}:${message.displayDurationSeconds}` : ''
  })

  function applyMessages(nextMessages: DesktopMessage[]): void {
    const currentUid = currentMessage.value?.messageUid
    const uniqueMessages = new Map<string, DesktopMessage>()
    for (const message of nextMessages) {
      if (isCurrentlyActive(message) && matchesPlacement(message, placement)) {
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
    if (currentUid && preservedIndex < 0) detailsOpen.value = false
  }

  async function loadCached(): Promise<void> {
    applyMessages(await window.api.customMessagesList(placement))
  }

  async function queueReceipt(message: DesktopMessage, event: MessageClientEvent): Promise<void> {
    await window.api.customMessageReceiptQueue(message.id, message.messageUid, event, placement)
    await flushReceiptOutbox()
  }

  async function refresh(): Promise<void> {
    if (isLoading.value) return
    isLoading.value = true
    try {
      const remote = await syncActiveMessages(placement)
      await window.api.customMessagesCache(remote.messages, placement)
      await window.api.customMessagesReconcile(placement, remote.activeMessageUids)
      await loadCached()
      await flushReceiptOutbox()
    } catch (error) {
      console.debug('[message-banner] 当前无法同步顶部消息，继续使用本地缓存:', error)
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
  }

  function next(): void {
    select(activeIndex.value + 1, 'up')
  }

  function previous(): void {
    select(activeIndex.value - 1, 'down')
  }

  function openDetails(message: DesktopMessage): void {
    detailsOpen.value = true
    reportViewed(message)
  }

  async function openAction(message: DesktopMessage, actionUrl?: string): Promise<void> {
    if (!actionUrl || !/^https?:\/\//i.test(actionUrl)) return
    void queueReceipt(message, 'click')
    await window.api.openExternal(actionUrl)
  }

  function reportViewed(message: DesktopMessage): void {
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
    if (!mounted || document.hidden || detailsOpen.value || messages.value.length <= 1 || !message)
      return
    rotateTimer = setTimeout(next, displayDurationMs(message))
  }

  function handleVisibilityChange(): void {
    if (document.hidden) {
      clearRotation()
      return
    }
    void refresh()
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
  watch(detailsOpen, scheduleRotation, { flush: 'post' })
  watch(() => messages.value.length, scheduleRotation, { flush: 'post' })

  onMounted(() => {
    mounted = true
    void loadCached().then(() => flushReceiptOutbox())
    void refresh()
    pollTimer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    unsubscribeSse = window.api.onSsePushMessage((message) => {
      if (message.type !== 'custom') return
      void loadCached().then(() => flushReceiptOutbox())
    })
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onUnmounted(() => {
    mounted = false
    if (pollTimer) clearInterval(pollTimer)
    clearRotation()
    unsubscribeSse?.()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

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
    openAction,
  }
}
