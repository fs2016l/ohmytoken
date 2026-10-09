import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { motion } from '../config/motion'
import { numberTransitionGlyphs } from '../utils/number-animation'
import { useMotionVisibility } from './useMotionVisibility'

export type NumberMotionMode = 'auto' | 'digits' | 'fade'

/** Animate formatted text without producing intermediate usage or cost values. */
export function useNumberMotion(
  text: () => string,
  value: () => number | null | undefined,
  replay: () => boolean,
  mode: () => NumberMotionMode,
) {
  const element = ref<HTMLElement | null>(null)
  const content = ref<HTMLElement | null>(null)
  const displayed = ref(text())
  const incoming = ref<string | null>(null)
  const rolling = ref(false)
  const glyphs = computed(() =>
    rolling.value && incoming.value !== null
      ? numberTransitionGlyphs(displayed.value, incoming.value)
      : null,
  )
  const { visible, reduced, activation } = useMotionVisibility(element)
  let displayedValue = value()
  let shownActivation = -1
  let generation = 0
  let running = false
  let animations: Animation[] = []

  function cancel(): void {
    animations.forEach((animation) => animation.cancel())
    animations = []
  }

  function settle(): void {
    generation++
    cancel()
    running = false
    displayed.value = text()
    displayedValue = value()
    incoming.value = null
    rolling.value = false
  }

  async function change(): Promise<void> {
    if (!visible.value || reduced.value) {
      settle()
      if (reduced.value) shownActivation = activation.value
      return
    }
    // Complete the visible transition, then use only the latest update.
    if (running) return
    const target = text()
    const targetValue = value()
    const currentActivation = activation.value
    const entrance = replay() && shownActivation !== activation.value
    if (target === displayed.value && !entrance) {
      displayedValue = targetValue
      return
    }
    const current = ++generation
    const previousValue = displayedValue
    running = true
    rolling.value =
      mode() === 'digits' ||
      (mode() === 'auto' &&
        !!element.value &&
        parseFloat(getComputedStyle(element.value).fontSize) >= motion.numberText.largeFont &&
        numberTransitionGlyphs(displayed.value, target) !== null)
    if (target !== displayed.value) {
      incoming.value = target
    }
    await nextTick()
    if (current !== generation) return
    if (!content.value) {
      settle()
      return
    }
    const options = {
      duration: rolling.value ? motion.numberText.digits : motion.numberText.fade,
      easing: motion.numberText.easing,
      fill: 'both' as const,
    }
    const distance = (targetValue ?? 0) >= (previousValue ?? 0) ? 112 : -112
    const outgoingFrames = rolling.value
      ? [
          { transform: 'translateY(0)', opacity: 1 },
          { transform: `translateY(${-distance}%)`, opacity: 0 },
        ]
      : [{ opacity: 1 }, { opacity: 0 }]
    const incomingFrames = rolling.value
      ? [
          { transform: `translateY(${distance}%)`, opacity: 0 },
          { transform: 'translateY(0)', opacity: 1 },
        ]
      : [{ opacity: 0 }, { opacity: 1 }]
    if (incoming.value !== null) {
      // Different units or digit counts roll the complete value without aligning unrelated digits.
      const selector = glyphs.value ? '.number-glyph__' : '.number-'
      animations = [
        ...Array.from(content.value.querySelectorAll(`${selector}outgoing`), (node) =>
          node.animate(outgoingFrames, options),
        ),
        ...Array.from(content.value.querySelectorAll(`${selector}incoming`), (node) =>
          node.animate(incomingFrames, options),
        ),
      ]
    } else {
      // Entrances reveal the actual value instead of counting from zero.
      const node = rolling.value ? content.value.firstElementChild || content.value : content.value
      animations = [node.animate(incomingFrames, options)]
    }
    await Promise.all(animations.map((animation) => animation.finished)).catch(() => {})
    if (current !== generation) return
    displayed.value = target
    displayedValue = targetValue
    shownActivation = currentActivation
    incoming.value = null
    rolling.value = false
    await nextTick()
    if (current !== generation) return
    cancel()
    running = false
    void change()
  }

  watch([text, mode, visible, reduced, activation], () => void change(), { flush: 'post' })
  onBeforeUnmount(() => {
    generation++
    cancel()
  })
  return { element, content, displayed, incoming, glyphs }
}
