import { computed, nextTick, ref, shallowRef } from 'vue'
import type { DesktopMessage, MessagePlacement } from '../api/http/message'

const message = shallowRef<DesktopMessage | null>(null)
const unavailable = ref(false)
let expiry: ReturnType<typeof setTimeout> | undefined
let unsubscribe: (() => void) | undefined
let previousFocus: HTMLElement | null = null
let source: MessagePlacement = 'main'
let revision = 0

export function isMessageCurrent(value: DesktopMessage): boolean {
  const now = Date.now()
  return (
    value.status === 'published' &&
    (!value.startAt || new Date(value.startAt).getTime() <= now) &&
    (!value.endAt || new Date(value.endAt).getTime() > now)
  )
}

function stop(): void {
  clearTimeout(expiry)
  unsubscribe?.()
  unsubscribe = undefined
}

function close(): void {
  const wasOpen = !!message.value
  revision++
  stop()
  message.value = null
  unavailable.value = false
  const focus = previousFocus
  previousFocus = null
  void nextTick(() => {
    if (message.value || !wasOpen) return
    const target = focus?.isConnected ? focus : document.querySelector<HTMLElement>('.message-main')
    target?.focus({ preventScroll: true })
  })
}

function scheduleExpiry(): void {
  clearTimeout(expiry)
  const end = message.value?.endAt ? new Date(message.value.endAt).getTime() : NaN
  if (Number.isFinite(end))
    expiry = setTimeout(
      () => {
        if (message.value && !isMessageCurrent(message.value)) close()
        else scheduleExpiry()
      },
      Math.min(2_147_483_647, Math.max(1, end - Date.now())),
    )
}

async function synchronize(): Promise<void> {
  const selected = message.value
  if (!selected) return
  const version = ++revision
  try {
    const cached = await window.api.customMessagesList(source)
    if (version !== revision) return
    const updated = cached.find(
      (item) => item.messageUid === selected.messageUid && isMessageCurrent(item),
    )
    if (!updated) close()
    else {
      message.value = updated
      scheduleExpiry()
    }
  } catch {
    // Keep the cached article available offline; its local expiry timer still applies.
  }
}

function open(value: DesktopMessage, placement: MessagePlacement): void {
  if (!isMessageCurrent(value)) return
  if (!message.value && document.activeElement instanceof HTMLElement)
    previousFocus = document.activeElement
  revision++
  stop()
  unavailable.value = false
  source = placement
  message.value = value
  scheduleExpiry()
  unsubscribe = window.api.onAnnouncementsChanged(() => void synchronize())
}

/** Explicit handoff reads the shared local cache, including floating-only announcements. */
export async function openMessageDetailsInMain(uid: string): Promise<void> {
  const version = ++revision
  try {
    const [main, floating] = await Promise.all([
      window.api.customMessagesList('main'),
      window.api.customMessagesList('floating'),
    ])
    if (version !== revision) return
    const selected = [...main, ...floating].find(
      (item) => item.messageUid === uid && isMessageCurrent(item),
    )
    if (!selected) {
      close()
      unavailable.value = true
      return
    }
    open(selected, main.some((item) => item.messageUid === uid) ? 'main' : 'floating')
    void window.api.customMessageReceiptQueue(selected.id, selected.messageUid, 'view', 'main')
  } catch {
    if (version !== revision) return
    close()
    unavailable.value = true
  }
}

export async function openMessageLink(
  value: DesktopMessage,
  placement: MessagePlacement,
  url: string,
): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return
  void window.api.customMessageReceiptQueue(value.id, value.messageUid, 'click', placement)
  await window.api.openExternal(url)
}

/** One reader per renderer; the banner stays mounted and pauses rotation during reading. */
export function useMessageDetails() {
  return { message: computed(() => message.value), unavailable, open, close }
}
