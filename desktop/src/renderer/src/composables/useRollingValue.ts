import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useMotionVisibility } from './useMotionVisibility'
import { motion } from '../config/motion'

/** Keep the outgoing content intact until the shared upward roll has finished. */
export function useRollingValue<T>(
  value: () => T,
  same: (left: T, right: T) => boolean = Object.is,
) {
  const element = ref<HTMLElement | null>(null)
  const currentElement = ref<HTMLElement | null>(null)
  const incomingElement = ref<HTMLElement | null>(null)
  const displayed = shallowRef(value())
  const incoming = shallowRef<T | null>(null)
  const { visible, reduced } = useMotionVisibility(element)
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
    displayed.value = value()
    incoming.value = null
  }

  async function roll(): Promise<void> {
    if (!visible.value || reduced.value) {
      settle()
      return
    }
    // Finish the visible roll, then take only the newest value. Rapid updates
    // never restart a half-painted item or queue obsolete content.
    if (running || same(value(), displayed.value)) return
    const current = ++generation
    const target = value()
    running = true
    incoming.value = target
    await nextTick()
    if (current !== generation) return
    if (!currentElement.value || !incomingElement.value) {
      settle()
      return
    }
    const options = {
      duration: motion.textRoll.duration,
      easing: motion.textRoll.easing,
      fill: 'both' as const,
    }
    const { angle } = motion.textRoll
    animations = [
      currentElement.value.animate(
        [
          { transform: 'translateY(0) rotateX(0deg)', opacity: 1 },
          { transform: `translateY(-100%) rotateX(${angle}deg)`, opacity: 0 },
        ],
        options,
      ),
      incomingElement.value.animate(
        [
          { transform: `translateY(100%) rotateX(-${angle}deg)`, opacity: 0 },
          { transform: 'translateY(0) rotateX(0deg)', opacity: 1 },
        ],
        options,
      ),
    ]
    await Promise.all(animations.map((animation) => animation.finished)).catch(() => {})
    if (current !== generation) return
    displayed.value = target
    incoming.value = null
    // Commit the new content before removing the outgoing animation's final frame.
    await nextTick()
    if (current !== generation) return
    cancel()
    running = false
    void roll()
  }

  watch([value, visible, reduced], () => void roll(), { flush: 'post' })
  onBeforeUnmount(() => {
    generation++
    cancel()
  })

  return { element, currentElement, incomingElement, displayed, incoming }
}
