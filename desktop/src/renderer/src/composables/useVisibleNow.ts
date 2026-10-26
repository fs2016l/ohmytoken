import { onActivated, onDeactivated, onMounted, onUnmounted, readonly, ref } from 'vue'

const now = ref(Date.now())
const consumers = new Map<symbol, number>()
let timer: ReturnType<typeof setInterval> | undefined

function synchronize(): void {
  clearInterval(timer)
  timer = undefined
  if (!consumers.size || document.hidden) return
  now.value = Date.now()
  timer = setInterval(
    () => {
      now.value = Date.now()
    },
    Math.min(...consumers.values()),
  )
}

/** One clock for visible pages; quota countdowns never poll providers. */
export function useVisibleNow(interval = 30_000) {
  const key = Symbol('visible-clock')
  const start = (): void => {
    if (consumers.has(key)) return
    if (!consumers.size) document.addEventListener('visibilitychange', synchronize)
    consumers.set(key, Math.max(1000, interval))
    synchronize()
  }
  const stop = (): void => {
    if (!consumers.delete(key)) return
    synchronize()
    if (!consumers.size) document.removeEventListener('visibilitychange', synchronize)
  }
  onMounted(start)
  onActivated(start)
  onDeactivated(stop)
  onUnmounted(stop)
  return readonly(now)
}
