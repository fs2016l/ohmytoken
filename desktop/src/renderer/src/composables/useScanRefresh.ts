import { onActivated, onDeactivated, onMounted, onUnmounted, readonly, ref, shallowRef } from 'vue'
import {
  DEFAULT_SCAN_REFRESH,
  type ScanRefreshPreferences,
  type ScanRefreshState,
} from '@shared/scan-refresh'

const state = shallowRef<ScanRefreshState>({
  ...DEFAULT_SCAN_REFRESH,
  revision: 0,
  running: false,
  nextRefreshAt: null,
})
const ready = ref(false)
const saving = ref(false)
const error = ref(false)
const viewers = new Set<symbol>()
let consumers = 0
let unsubscribe: (() => void) | undefined
let active: boolean | undefined

function receive(value: ScanRefreshState): void {
  if (value.revision >= state.value.revision) state.value = value
  ready.value = true
}
function visibility(): void {
  const visible = viewers.size > 0 && !document.hidden
  if (active === visible) return
  active = visible
  void window.api
    .scanRefreshSetActive(visible)
    .then(receive)
    .catch(() => {
      active = undefined
      error.value = true
    })
}
async function configure(preferences: ScanRefreshPreferences): Promise<void> {
  if (saving.value) return
  saving.value = true
  error.value = false
  try {
    receive(await window.api.scanRefreshConfigure(preferences))
  } catch {
    error.value = true
  } finally {
    saving.value = false
  }
}

/** Renderer subscriptions only; the main process owns persistence and the shared timer. */
export function useScanRefresh() {
  const id = Symbol('local-usage-view')
  function resume(): void {
    viewers.add(id)
    visibility()
  }
  function pause(): void {
    viewers.delete(id)
    visibility()
  }
  onMounted(() => {
    if (++consumers === 1) {
      unsubscribe = window.api.onScanRefreshChanged(receive)
      document.addEventListener('visibilitychange', visibility)
      void window.api
        .scanRefreshRead()
        .then(receive)
        .catch(() => {
          error.value = true
        })
    }
    resume()
  })
  onActivated(resume)
  onDeactivated(pause)
  onUnmounted(() => {
    pause()
    if (--consumers === 0) {
      unsubscribe?.()
      unsubscribe = undefined
      document.removeEventListener('visibilitychange', visibility)
    }
  })
  return {
    state: readonly(state),
    ready: readonly(ready),
    saving: readonly(saving),
    error: readonly(error),
    configure,
  }
}
