import { onDeactivated, onUnmounted } from 'vue'

type Position = 'before' | 'after'
interface Options {
  enabled?: () => boolean
  key: (card: HTMLElement) => string
  cards: (card: HTMLElement) => HTMLElement[]
  previewClass: string
  draggingClass: string
  handle?: string
  dropMotion?: { duration: number; easing: string }
  onStart: (key: string) => void
  onOver: (key: string | null, position: Position | null) => void
  onEnd: () => void
  onCancel?: () => void
}

/** Shared pointer capture, drag preview and edge scrolling for floating cards. */
export function useFloatingCardDrag(options: Options) {
  let card: HTMLElement | null = null
  let preview: HTMLElement | null = null
  let scroll: HTMLElement | null = null
  let pointerId: number | null = null
  let started = false
  let startX = 0,
    startY = 0,
    x = 0,
    y = 0,
    offsetX = 0,
    offsetY = 0
  let frame = 0
  let finishDrop: ((commit: boolean) => void) | null = null

  function cursor(active: boolean): void {
    document.documentElement.classList.toggle('floating-reorder-active', active)
    document.body.classList.toggle('floating-reorder-active', active)
  }
  function positionPreview(): void {
    if (preview)
      preview.style.transform = `translate3d(${Math.round(x - offsetX)}px, ${Math.round(y - offsetY)}px, 0)`
  }
  function target(): void {
    if (!card) return
    // Hit-test final slots; an animating neighbor must not immediately undo the reorder.
    const match = options
      .cards(card)
      .map((node) => {
        const rect = node.getBoundingClientRect()
        const transform = new DOMMatrix(getComputedStyle(node).transform)
        return {
          node,
          left: rect.left - transform.m41,
          top: rect.top - transform.m42,
          width: rect.width,
          height: rect.height,
        }
      })
      .find(
        (rect) =>
          x >= rect.left &&
          x <= rect.left + rect.width &&
          y >= rect.top &&
          y <= rect.top + rect.height,
      )
    if (!match || match.node === card) {
      options.onOver(null, null)
      return
    }
    options.onOver(options.key(match.node), y < match.top + match.height / 2 ? 'before' : 'after')
  }
  function scrollFrame(): void {
    if (!started || !scroll) return
    const bounds = scroll.getBoundingClientRect()
    if (x >= bounds.left && x <= bounds.right) {
      const edge = 36
      const speed =
        y < bounds.top + edge
          ? -Math.min(1, (bounds.top + edge - y) / edge)
          : y > bounds.bottom - edge
            ? Math.min(1, (y - bounds.bottom + edge) / edge)
            : 0
      if (speed) {
        const before = scroll.scrollTop
        scroll.scrollTop += speed * 9
        if (scroll.scrollTop !== before) target()
      }
    }
    frame = requestAnimationFrame(scrollFrame)
  }
  function reset(commit = true, animate = false): void {
    if (finishDrop) {
      finishDrop(commit)
      return
    }
    if (pointerId === null && !preview) return
    const moved = started
    const capturedCard = card,
      capturedPointer = pointerId
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', finish, true)
    window.removeEventListener('pointercancel', finish, true)
    window.removeEventListener('blur', blur, true)
    window.removeEventListener('keydown', keydown, true)
    cancelAnimationFrame(frame)
    const ghost = preview
    preview = null
    card = null
    scroll = null
    pointerId = null
    started = false
    if (capturedPointer !== null && capturedCard?.hasPointerCapture(capturedPointer))
      capturedCard.releasePointerCapture(capturedPointer)
    let animation: Animation | undefined
    let finished = false
    const complete = (accepted: boolean): void => {
      if (finished) return
      finished = true
      finishDrop = null
      animation?.cancel()
      ghost?.remove()
      cursor(false)
      if (moved) {
        if (accepted) options.onEnd()
        else (options.onCancel ?? options.onEnd)()
      }
    }
    if (
      commit &&
      animate &&
      moved &&
      ghost &&
      capturedCard?.isConnected &&
      options.dropMotion &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      const bounds = capturedCard.getBoundingClientRect()
      finishDrop = complete
      animation = ghost.animate(
        [
          { transform: ghost.style.transform },
          { transform: `translate3d(${bounds.left}px, ${bounds.top}px, 0)` },
        ],
        { ...options.dropMotion, fill: 'forwards' },
      )
      void animation.finished.then(
        () => complete(true),
        () => complete(false),
      )
    } else complete(commit)
  }
  function blur(event: FocusEvent): void {
    if (event.target === window) reset(false)
  }
  function keydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !options.onCancel) return
    event.preventDefault()
    event.stopPropagation()
    reset(false)
  }
  function move(event: PointerEvent): void {
    if (event.pointerId !== pointerId || !card) return
    event.preventDefault()
    x = event.clientX
    y = event.clientY
    if (!started) {
      if (Math.hypot(x - startX, y - startY) < 4) return
      started = true
      const bounds = card.getBoundingClientRect()
      preview = card.cloneNode(true) as HTMLElement
      preview.classList.remove(options.draggingClass)
      preview.classList.add(options.previewClass)
      preview.setAttribute('aria-hidden', 'true')
      preview.setAttribute('inert', '')
      preview.style.width = `${bounds.width}px`
      preview.style.height = `${bounds.height}px`
      // Native modal dialogs live above the document's stacking contexts.
      const previewRoot = card.closest('dialog[open]') ?? document.body
      previewRoot.appendChild(preview)
      options.onStart(options.key(card))
      frame = requestAnimationFrame(scrollFrame)
    }
    positionPreview()
    target()
  }
  function finish(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return
    if (started && card) {
      event.preventDefault()
      const dragged = card
      const cancelClick = (click: MouseEvent): void => {
        click.preventDefault()
        click.stopImmediatePropagation()
      }
      // Dropping a label must not also toggle its checkbox.
      dragged.addEventListener('click', cancelClick, { capture: true, once: true })
      setTimeout(() => dragged.removeEventListener('click', cancelClick, true), 0)
    }
    reset(event.type === 'pointerup', event.type === 'pointerup')
  }
  function start(event: PointerEvent): void {
    if (
      options.enabled?.() === false ||
      !event.isPrimary ||
      event.button !== 0 ||
      pointerId !== null ||
      finishDrop !== null
    )
      return
    const target = event.target instanceof Element ? event.target : null
    const handle = options.handle ? target?.closest<HTMLElement>(options.handle) : null
    if (options.handle && !handle) return
    if (target?.closest('button, a, input, select, textarea, [contenteditable="true"]') && !handle)
      return
    card = event.currentTarget as HTMLElement
    scroll = card.closest<HTMLElement>('.floating-scroll, .dialog-content')
    const bounds = card.getBoundingClientRect()
    x = startX = event.clientX
    y = startY = event.clientY
    offsetX = Math.min(bounds.width, Math.max(0, x - bounds.left))
    offsetY = Math.min(bounds.height, Math.max(0, y - bounds.top))
    pointerId = event.pointerId
    event.preventDefault()
    handle?.focus({ preventScroll: true })
    cursor(true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', finish, true)
    window.addEventListener('blur', blur, true)
    window.addEventListener('keydown', keydown, true)
    try {
      card.setPointerCapture(pointerId)
    } catch {
      reset(false)
    }
  }
  const stop = (): void => reset(false)
  onDeactivated(stop)
  onUnmounted(stop)
  return { start, stop }
}
