import {
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  shallowRef,
  watch,
  type Ref,
} from 'vue'
import { motion, numberProgress } from '../config/motion'

export interface ArticleHeading {
  id: string
  title: string
  depth: number
  element: HTMLElement
}

export function useArticleContents(
  articleId: number,
  body: Readonly<Ref<string>>,
  reading: Ref<HTMLElement | null>,
  getScroller: () => HTMLElement | null | undefined,
) {
  const headings = shallowRef<ArticleHeading[]>([])
  const activeId = ref('')
  const viewport = shallowRef({ width: 0, height: 0 })
  let scroller: HTMLElement | null | undefined
  let resize: ResizeObserver | undefined
  let frame = 0
  let scrollFrame = 0
  let navigationId = ''
  let active = false

  function update(): void {
    frame = 0
    if (!active || !scroller) return
    const { clientWidth: width, clientHeight: height } = scroller
    if (viewport.value.width !== width || viewport.value.height !== height)
      viewport.value = { width, height }
    if (navigationId) return
    const offset =
      (scroller.querySelector<HTMLElement>('.article-toolbar')?.offsetHeight ?? 72) + 24
    const threshold = scroller.getBoundingClientRect().top + offset + 1
    let current: ArticleHeading | undefined = headings.value[0]
    for (const heading of headings.value) {
      if (heading.element.getBoundingClientRect().top > threshold) break
      current = heading
    }
    if (scroller.scrollTop > 0 && scroller.scrollHeight - height - scroller.scrollTop < 2)
      current = headings.value.at(-1)
    activeId.value = current?.id ?? ''
  }

  function schedule(): void {
    if (active && !frame) frame = requestAnimationFrame(update)
  }

  function interruptNavigation(): void {
    if (scrollFrame) cancelAnimationFrame(scrollFrame)
    scrollFrame = 0
    navigationId = ''
    schedule()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
      interruptNavigation()
  }

  function navigate(destination: number, targetId: string): void {
    interruptNavigation()
    if (!scroller || !active) return
    const container = scroller
    const origin = container.scrollTop
    const target = Math.max(
      0,
      Math.min(destination, container.scrollHeight - container.clientHeight),
    )
    const distance = target - origin
    activeId.value = targetId
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(distance) < 1) {
      container.scrollTo({ top: target, behavior: 'instant' })
      return
    }
    navigationId = targetId
    const duration = Math.min(motion.selection, motion.detail + Math.abs(distance) / 8)
    const start = performance.now()
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration)
      container.scrollTo({ top: origin + distance * numberProgress(progress), behavior: 'instant' })
      if (progress < 1) scrollFrame = requestAnimationFrame(tick)
      else {
        scrollFrame = 0
        navigationId = ''
        schedule()
      }
    }
    scrollFrame = requestAnimationFrame(tick)
  }

  function disconnect(): void {
    active = false
    interruptNavigation()
    resize?.disconnect()
    scroller?.removeEventListener('scroll', schedule)
    scroller?.removeEventListener('wheel', interruptNavigation)
    scroller?.removeEventListener('touchstart', interruptNavigation)
    scroller?.removeEventListener('pointerdown', interruptNavigation)
    scroller?.removeEventListener('keydown', handleKeydown)
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }

  function connect(): void {
    disconnect()
    active = true
    scroller = getScroller()
    if (!scroller) return
    scroller.addEventListener('scroll', schedule, { passive: true })
    scroller.addEventListener('wheel', interruptNavigation, { passive: true })
    scroller.addEventListener('touchstart', interruptNavigation, { passive: true })
    scroller.addEventListener('pointerdown', interruptNavigation)
    scroller.addEventListener('keydown', handleKeydown)
    resize = new ResizeObserver(schedule)
    resize.observe(scroller)
    if (scroller.firstElementChild) resize.observe(scroller.firstElementChild)
    schedule()
  }

  watch(
    [body, reading],
    async () => {
      interruptNavigation()
      await nextTick()
      headings.value = Array.from(reading.value?.querySelectorAll<HTMLElement>('h2,h3') ?? []).map(
        (element, index) => {
          const id = `article-${articleId}-section-${index}`
          element.id = id
          return {
            id,
            title: element.textContent || '',
            depth: Number(element.tagName[1]),
            element,
          }
        },
      )
      schedule()
    },
    { immediate: true, flush: 'post' },
  )

  function jump(id: string): void {
    const element = headings.value.find((heading) => heading.id === id)?.element
    if (!element || !scroller) return
    const offset = parseFloat(getComputedStyle(element).scrollMarginTop) || 0
    const destination =
      scroller.scrollTop +
      element.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      offset
    element.tabIndex = -1
    element.focus({ preventScroll: true })
    navigate(destination, id)
  }

  function top(): void {
    const title = scroller?.querySelector<HTMLElement>('.article-detail-title h1')
    if (title) {
      title.tabIndex = -1
      title.focus({ preventScroll: true })
    }
    navigate(0, headings.value[0]?.id ?? '')
  }

  onMounted(connect)
  onActivated(connect)
  onDeactivated(disconnect)
  onBeforeUnmount(disconnect)
  return { headings, activeId, viewport, jump, top }
}
