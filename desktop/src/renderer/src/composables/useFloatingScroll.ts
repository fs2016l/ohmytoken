import { nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'

/** KeepAlive can zero detached scroll nodes; record only connected, active scroll events. */
export function useFloatingScroll() {
  const scroll = ref<HTMLElement | null>(null)
  let saved = 0,
    active = true,
    restoring = false,
    generation = 0
  function save(): void {
    if (active && !restoring && scroll.value?.isConnected) saved = scroll.value.scrollTop
  }
  async function restore(): Promise<void> {
    active = true
    restoring = true
    const current = ++generation
    await nextTick()
    if (!active || generation !== current) return
    scroll.value?.scrollTo({ top: saved, behavior: 'instant' })
    restoring = false
  }
  const stop = (): void => {
    active = false
    generation++
  }
  onMounted(() => void restore())
  onActivated(() => void restore())
  onDeactivated(stop)
  onUnmounted(stop)
  return { scroll, save }
}
