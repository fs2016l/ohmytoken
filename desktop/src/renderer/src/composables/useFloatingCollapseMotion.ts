import { nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { motion } from '../config/motion'

/** Fold the visible panel before shrinking its native, transparent window. */
export function useFloatingCollapseMotion(
  panel: Ref<HTMLElement | null>,
  content: Ref<HTMLElement | null>,
  reduced: Ref<boolean>,
) {
  const animating = ref(false)
  const animations = new Set<Animation>()
  let disposed = false

  function finish(): void {
    for (const animation of animations) animation.finish()
  }

  function finishWhenHidden(): void {
    if (document.hidden) finish()
  }

  watch(reduced, (value) => {
    if (value) finish()
  })
  onMounted(() => document.addEventListener('visibilitychange', finishWhenHidden))
  onUnmounted(() => {
    disposed = true
    for (const animation of animations) animation.cancel()
    document.removeEventListener('visibilitychange', finishWhenHidden)
  })

  async function animateCollapse(
    collapsed: boolean,
    apply: () => void,
    resize: () => Promise<boolean>,
  ): Promise<boolean> {
    const element = panel.value
    if (!element || reduced.value || document.hidden) {
      apply()
      await nextTick()
      return resize()
    }

    const previousHeight = element.style.height
    const startHeight = element.getBoundingClientRect().height
    element.style.height = `${startHeight}px`
    animating.value = true
    try {
      if (!collapsed) {
        // Reserve the native viewport while keeping the visible panel compact.
        const result = await resize()
        if (result !== collapsed || disposed) return result
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }

      apply()
      await nextTick()
      if (disposed) return collapsed
      // Measure the destination layout without painting its final height first.
      element.style.height = previousHeight
      const endHeight = element.getBoundingClientRect().height
      if (reduced.value || document.hidden) return collapsed ? await resize() : collapsed
      element.style.height = `${startHeight}px`
      const fold = element.animate([{ height: `${startHeight}px` }, { height: `${endHeight}px` }], {
        duration: motion.detail,
        easing: 'ease-in-out',
        fill: 'forwards',
      })
      animations.add(fold)
      if (content.value) {
        const reveal = content.value.animate(
          [
            { opacity: 0, transform: `translateY(${collapsed ? -6 : 6}px)` },
            { opacity: 1, transform: 'none' },
          ],
          {
            duration: motion.detail * 0.6,
            delay: motion.detail * 0.15,
            easing: motion.entranceEase,
            fill: 'both',
          },
        )
        animations.add(reveal)
      }
      await Promise.all([...animations].map((animation) => animation.finished))
      element.style.height = previousHeight
      for (const animation of animations) animation.cancel()
      animations.clear()
      return collapsed && !disposed ? await resize() : collapsed
    } finally {
      element.style.height = previousHeight
      for (const animation of animations) animation.cancel()
      animations.clear()
      animating.value = false
    }
  }

  return { animateCollapse, animating }
}
