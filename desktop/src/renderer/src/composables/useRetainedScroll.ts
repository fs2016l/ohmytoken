import {
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  watch,
  type Ref,
} from 'vue'
import { getPageScroll, savePageScroll } from './usePageState'

export function useRetainedScroll(
  element: Ref<HTMLElement | null>,
  pageKey: () => string,
  scrollKey: () => string,
  ready: () => boolean = () => true,
) {
  let restoring = false
  let active = true
  let generation = 0
  let resize: ResizeObserver | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  function save(): void {
    if (element.value && active && !restoring && ready())
      savePageScroll(pageKey(), scrollKey(), element.value.scrollTop, element.value.scrollLeft)
  }
  function stopRestoring(): void {
    generation++
    restoring = false
    resize?.disconnect()
    clearTimeout(timer)
  }
  async function restore(): Promise<void> {
    clearTimeout(timer)
    const current = ++generation
    restoring = true
    await nextTick()
    if (!element.value || current !== generation) return
    const saved = getPageScroll(pageKey(), scrollKey())
    const apply = (): void => {
      const target = element.value
      if (!target || current !== generation || !ready()) return
      target.scrollTo({ top: saved.top, left: saved.left, behavior: 'instant' })
      if (
        target.scrollHeight - target.clientHeight >= saved.top - 1 &&
        target.scrollWidth - target.clientWidth >= saved.left - 1
      )
        stopRestoring()
    }
    resize?.disconnect()
    resize = new ResizeObserver(apply)
    if (element.value.firstElementChild) resize.observe(element.value.firstElementChild)
    apply()
    if (restoring) timer = setTimeout(stopRestoring, 10000)
  }
  function scrollToTop(): void {
    stopRestoring()
    element.value?.scrollTo({ top: 0, behavior: 'instant' })
    if (element.value && active) savePageScroll(pageKey(), scrollKey(), 0, element.value.scrollLeft)
  }
  watch(
    ready,
    (value) => {
      if (value && active && restoring) void restore()
    },
    { flush: 'post' },
  )
  onMounted(() => {
    void restore()
  })
  onActivated(() => {
    active = true
    void restore()
  })
  onDeactivated(() => {
    active = false
    generation++
    stopRestoring()
  })
  onBeforeUnmount(() => {
    save()
    active = false
    generation++
    stopRestoring()
  })
  return { save, stopRestoring, scrollToTop }
}
