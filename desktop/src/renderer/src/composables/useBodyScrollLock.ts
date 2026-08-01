import { onUnmounted, toValue, watch, type MaybeRefOrGetter } from 'vue'

let lockCount = 0
let previousBodyOverflow = ''
let previousDocumentOverflow = ''

function acquireScrollLock(): void {
  if (lockCount === 0) {
    previousBodyOverflow = document.body.style.overflow
    previousDocumentOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
  }
  lockCount += 1
}

function releaseScrollLock(): void {
  if (lockCount === 0) return
  lockCount -= 1
  if (lockCount === 0) {
    document.body.style.overflow = previousBodyOverflow
    document.documentElement.style.overflow = previousDocumentOverflow
  }
}

export function useBodyScrollLock(locked: MaybeRefOrGetter<boolean>): void {
  let ownsLock = false

  const stop = watch(
    () => toValue(locked),
    (shouldLock) => {
      if (shouldLock === ownsLock) return
      ownsLock = shouldLock
      if (shouldLock) acquireScrollLock()
      else releaseScrollLock()
    },
    { immediate: true },
  )

  onUnmounted(() => {
    stop()
    if (!ownsLock) return
    ownsLock = false
    releaseScrollLock()
  })
}
