import { onActivated, onDeactivated, onMounted, onUnmounted, readonly, ref } from 'vue'

const now = ref(Date.now())
const consumers = new Set<symbol>()
let timer: ReturnType<typeof setInterval> | undefined

function synchronize(): void {
  clearInterval(timer)
  timer = undefined
  if (!consumers.size || document.hidden) return
  now.value = Date.now()
  timer = setInterval(() => {
    now.value = Date.now()
  }, 30_000)
}

/** One clock for visible pages; quota countdowns never poll providers. */
export function useVisibleNow() {
  const key = Symbol('visible-clock')
  const start = (): void => {
    if (!consumers.size) document.addEventListener('visibilitychange', synchronize)
    consumers.add(key)
    synchronize()
  }
  const stop = (): void => {
    consumers.delete(key)
    synchronize()
    if (!consumers.size) document.removeEventListener('visibilitychange', synchronize)
  }
  onMounted(start)
  onActivated(start)
  onDeactivated(stop)
  onUnmounted(stop)
  return readonly(now)
}
