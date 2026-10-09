import { computed, onMounted, onUnmounted, readonly, ref, shallowRef } from 'vue'
import type { ScanProgress } from '@shared/scan-progress'
import type { ScanMode, ScanResult } from '@shared/models'

const progress = shallowRef<ScanProgress | null>(null)
const result = shallowRef<ScanResult | null>(null)
const revision = ref(0)
const requesting = ref(false)
const error = ref('')
const updatedAt = ref(localStorage.getItem('last-scan-time') || '')
const busy = computed(() => requesting.value || progress.value?.status === 'running')
let consumers = 0
let unsubscribe: (() => void) | undefined
let finishedId = ''

function receive(next: ScanProgress): void {
  const previous = progress.value
  if (
    previous &&
    (next.startedAt < previous.startedAt ||
      (next.scanId === previous.scanId && next.sequence <= previous.sequence))
  )
    return
  if (next.scanId !== previous?.scanId || next.status === 'complete') error.value = ''
  progress.value = next
  if (next.status !== 'running' && finishedId !== next.scanId) {
    finishedId = next.scanId
    // Incremental scans commit each successful agent even if another agent fails.
    // Invalidate readers on either terminal status, while preserving the last full success time.
    if (next.status === 'complete') {
      // Cached progress can be replayed long after completion when a window opens.
      updatedAt.value = new Date(next.finishedAt ?? next.startedAt).toISOString()
      localStorage.setItem('last-scan-time', updatedAt.value)
    }
    revision.value++
  }
  if (next.status === 'failed') error.value = next.error || 'Scan failed'
}

async function refresh(mode: ScanMode = 'incremental'): Promise<void> {
  if (busy.value) return
  requesting.value = true
  error.value = ''
  try {
    result.value = await window.api.scanPerform({ mode })
    if (result.value.errors?.length) error.value = result.value.errors.join('\n')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    requesting.value = false
  }
}

/** Shared by the shell and data pages; one IPC subscription per renderer. */
export function useScanStatus() {
  onMounted(() => {
    if (++consumers !== 1) return
    unsubscribe = window.api.onScanProgress(receive)
    void window.api
      .getScanProgress()
      .then((value) => {
        if (value) receive(value)
      })
      .catch((reason) => console.error('[scan-status]', reason))
  })
  onUnmounted(() => {
    if (--consumers === 0) {
      unsubscribe?.()
      unsubscribe = undefined
    }
  })
  return {
    progress: readonly(progress),
    result: readonly(result),
    revision: readonly(revision),
    updatedAt: readonly(updatedAt),
    error: readonly(error),
    busy,
    refresh,
  }
}
