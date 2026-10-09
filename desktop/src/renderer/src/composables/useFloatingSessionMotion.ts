import { nextTick, onDeactivated, onUnmounted, watch, type Ref } from 'vue'
import { motion } from '../config/motion'

/** FLIP across both lists: a favorite keeps its visual position even when Vue reparents it. */
export function useFloatingSessionMotion(root: Ref<HTMLElement | null>, order: () => string): void {
  const animations = new Set<Animation>()
  let generation = 0
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const elements = (): Map<string, HTMLElement> =>
    new Map(
      [
        ...(root.value?.querySelectorAll<HTMLElement>(
          '[data-session-drag-key], .floating-recent summary',
        ) ?? []),
      ]
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => [node.dataset.sessionDragKey ?? 'recent-heading', node]),
    )
  function cancel(): void {
    generation++
    animations.forEach((animation) => animation.cancel())
    animations.clear()
  }
  watch(
    order,
    async () => {
      const before = new Map(
        [...elements()].map(([key, node]) => [
          key,
          {
            rect: node.getBoundingClientRect(),
            pinned: node.classList.contains('session-card--pinned'),
            focused:
              node.contains(document.activeElement) &&
              document.activeElement?.matches('.favorite-button'),
          },
        ]),
      )
      cancel()
      const current = generation
      await nextTick()
      if (current !== generation) return
      for (const [key, node] of elements()) {
        const previous = before.get(key)
        if (!previous) continue
        if (previous.focused && !node.contains(document.activeElement))
          node.querySelector<HTMLButtonElement>('.favorite-button')?.focus({ preventScroll: true })
        if (document.hidden || reduced.matches || node.classList.contains('session-card--dragging'))
          continue
        const after = node.getBoundingClientRect()
        const x = previous.rect.left - after.left
        const y = previous.rect.top - after.top
        if (Math.abs(x) < 1 && Math.abs(y) < 1) continue
        const transfer = previous.pinned !== node.classList.contains('session-card--pinned')
        const transform = getComputedStyle(node).transform
        const finalTransform = transform === 'none' ? '' : transform
        const animation = node.animate(
          [
            {
              transform: `translate(${x}px, ${y}px) ${finalTransform}`,
              zIndex: transfer ? '2' : '1',
            },
            { transform: finalTransform || 'none', zIndex: transfer ? '2' : '1' },
          ],
          { duration: transfer ? motion.transfer : motion.reorder, easing: motion.entranceEase },
        )
        animation.id = 'floating-session-move'
        animations.add(animation)
        animation.onfinish = () => {
          animations.delete(animation)
        }
      }
    },
    { flush: 'pre' },
  )
  reduced.addEventListener('change', cancel)
  document.addEventListener('visibilitychange', cancel)
  onDeactivated(cancel)
  onUnmounted(() => {
    cancel()
    reduced.removeEventListener('change', cancel)
    document.removeEventListener('visibilitychange', cancel)
  })
}
