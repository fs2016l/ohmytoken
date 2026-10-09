import { onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import type { MonitorSnapshot } from '@shared/network-monitor'

export function useNetworkMonitor() {
  const snapshot = shallowRef<MonitorSnapshot | null>(null)
  const pending = ref('')
  const error = ref(false)
  let unsubscribe: (() => void) | undefined
  let requestId = 0
  const apply = (value: MonitorSnapshot): void => {
    if (!snapshot.value || value.updatedAt >= snapshot.value.updatedAt) snapshot.value = value
  }
  async function request(name: string, run: () => Promise<MonitorSnapshot>): Promise<void> {
    const id = ++requestId
    pending.value = name
    error.value = false
    try {
      apply(await run())
    } catch {
      error.value = true
    } finally {
      if (id === requestId) pending.value = ''
    }
  }
  async function attach(): Promise<void> {
    if (unsubscribe) return
    unsubscribe = window.api.onNetworkMonitorChanged(apply)
    try {
      apply(await window.api.networkMonitorSnapshot())
    } catch {
      error.value = true
    }
  }
  function detach(): void {
    unsubscribe?.()
    unsubscribe = undefined
  }
  onMounted(attach)
  onActivated(attach)
  onDeactivated(detach)
  onUnmounted(detach)
  return { snapshot, pending, error, apply, request }
}
