import { onUnmounted, ref, watch, type Ref } from 'vue'
import { motion, numberProgress } from '../config/motion'
import { useMotionVisibility } from './useMotionVisibility'

/** Shared numerical interpolation for counters, bars and proportions. */
export function useAnimatedValue(
  value: Readonly<Ref<number | null | undefined>>,
  element: Ref<HTMLElement | null>,
  replay: () => boolean = () => true,
) {
  const { visible, reduced, activation } = useMotionVisibility(element)
  const displayed = ref(replay() ? 0 : (value.value ?? 0))
  let frame = 0,
    shownActivation = -1
  watch(
    [value, visible, reduced, activation],
    () => {
      cancelAnimationFrame(frame)
      const target = value.value
      if (target == null || !Number.isFinite(target)) {
        displayed.value = 0
        return
      }
      // Keep the last painted value offscreen. Visibility is not a new entrance.
      if (!visible.value) return
      if (reduced.value) {
        displayed.value = target
        shownActivation = activation.value
        return
      }
      const from = replay() && shownActivation !== activation.value ? 0 : displayed.value
      shownActivation = activation.value
      const start = performance.now()
      displayed.value = from
      if (from === target) return
      const tick = (now: number): void => {
        const progress = Math.min(1, (now - start) / motion.number)
        displayed.value = from + (target - from) * numberProgress(progress)
        if (progress < 1) frame = requestAnimationFrame(tick)
        else displayed.value = target
      }
      frame = requestAnimationFrame(tick)
    },
    { immediate: true, flush: 'post' },
  )
  onUnmounted(() => cancelAnimationFrame(frame))
  return displayed
}
