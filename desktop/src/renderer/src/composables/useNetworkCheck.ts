import {
  computed,
  onMounted,
  onUnmounted,
  onActivated,
  onDeactivated,
  ref,
  shallowRef,
  watch,
} from 'vue'
import type {
  NetworkCheckSnapshot,
  NetworkMode,
  NetworkCheckTarget,
} from '../../../shared/network-check'

export function useNetworkCheck() {
  const snapshot = shallowRef<NetworkCheckSnapshot | null>(null)
  const updatedAt = ref<number | null>(null)
  const initializing = ref(true)
  const requesting = ref(false)
  const error = ref(false)
  const now = ref(Date.now())
  let unsubscribe: (() => void) | undefined
  let clock: ReturnType<typeof setInterval> | undefined
  let mounted = true
  let active = true
  function synchronizeClock(): void {
    clearInterval(clock)
    clock = undefined
    now.value = Date.now()
    if (active && !document.hidden && snapshot.value?.status === 'running')
      clock = setInterval(() => {
        now.value = Date.now()
      }, 1000)
  }
  watch(() => snapshot.value?.status, synchronizeClock)
  onActivated(() => {
    active = true
    synchronizeClock()
  })
  onDeactivated(() => {
    active = false
    synchronizeClock()
  })
  const apply = (value: NetworkCheckSnapshot): void => {
    if (mounted && (!snapshot.value || value.revision >= snapshot.value.revision)) {
      snapshot.value = value
      if (value.status === 'completed') updatedAt.value = value.finishedAt
    }
  }
  onMounted(async () => {
    document.addEventListener('visibilitychange', synchronizeClock)
    try {
      unsubscribe = window.api.onNetworkCheckProgress(apply)
      apply(await window.api.networkCheckStatus())
    } catch {
      error.value = true
    } finally {
      initializing.value = false
    }
  })
  onUnmounted(() => {
    mounted = false
    unsubscribe?.()
    clearInterval(clock)
    document.removeEventListener('visibilitychange', synchronizeClock)
  })
  const running = computed(() => snapshot.value?.status === 'running')
  async function start(mode: NetworkMode, target?: NetworkCheckTarget): Promise<void> {
    if (requesting.value || running.value) return
    error.value = false
    requesting.value = true
    try {
      apply(await window.api.networkCheckStart(mode, target))
    } catch {
      error.value = true
    } finally {
      requesting.value = false
    }
  }
  async function cancel(): Promise<void> {
    try {
      apply(await window.api.networkCheckCancel())
    } catch {
      error.value = true
    }
  }
  return { snapshot, updatedAt, initializing, requesting, running, error, now, start, cancel }
}
