import {
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  shallowRef,
  watch,
  type WatchSource,
} from 'vue'

/** The latest selection owns the response. Cached destinations do no hidden refresh work. */
export function usePageResource<T>(source: WatchSource, read: () => Promise<T>, initial: T) {
  const data = shallowRef<T>(initial)
  const busy = ref(false)
  const error = ref('')
  const ready = ref(false)
  let generation = 0
  let active = true
  let dirty = false
  let scheduled = false
  async function refresh(): Promise<void> {
    const current = ++generation
    dirty = false
    busy.value = true
    error.value = ''
    try {
      const result = await read()
      if (current === generation) {
        data.value = result
        ready.value = true
      }
    } catch (reason) {
      if (current === generation)
        error.value = reason instanceof Error ? reason.message : String(reason)
    } finally {
      if (current === generation) busy.value = false
    }
  }
  function invalidate(): void {
    generation++
    dirty = true
    if (!active || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (active && dirty) void refresh()
    })
  }
  watch(source, invalidate, { immediate: true, deep: true, flush: 'sync' })
  onActivated(() => {
    active = true
    if (dirty) invalidate()
  })
  onDeactivated(() => {
    active = false
    if (busy.value) {
      generation++
      dirty = true
      busy.value = false
    }
  })
  onBeforeUnmount(() => {
    active = false
    generation++
  })
  return { data, busy, ready, error, refresh }
}
