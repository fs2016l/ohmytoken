import { onUnmounted, watch, type Ref } from 'vue'
import {
  FLOATING_EDGE_MOTION_MS,
  FLOATING_EDGE_PEEK,
  type FloatingEdgeState,
} from '@shared/floating-window'
import { motion } from '../config/motion'

function outside(state: FloatingEdgeState, element: HTMLElement): string {
  if (state.edge === 'left')
    return `translate3d(${FLOATING_EDGE_PEEK - element.offsetLeft - element.offsetWidth}px, 0, 0)`
  if (state.edge === 'right')
    return `translate3d(${(state.viewport?.width ?? innerWidth) - element.offsetLeft - FLOATING_EDGE_PEEK}px, 0, 0)`
  return `translate3d(0, ${FLOATING_EDGE_PEEK - element.offsetTop - element.offsetHeight}px, 0)`
}

/** One compositor layer, fixed dimensions and opacity; no native per-frame work. */
export function useFloatingEdgeMotion(
  edge: Ref<FloatingEdgeState>,
  panel: Ref<HTMLElement | null>,
): void {
  let animation: Animation | undefined
  let fixedHeight: number | undefined
  function clearViewport(): void {
    document.body.style.removeProperty('width')
    document.body.style.removeProperty('height')
    document.body.style.removeProperty('translate')
  }
  watch(
    edge,
    (state) => {
      const element = panel.value
      if (!element) return
      if (state.hidden || state.transition) {
        fixedHeight ??= element.getBoundingClientRect().height
        element.style.height = `${fixedHeight}px`
      } else {
        fixedHeight = undefined
        element.style.removeProperty('height')
      }
      if (state.nativeMotion) return
      element.style.willChange = state.hidden || state.transition ? 'transform' : ''
      // Sample before cancellation so a hover reversal continues from the current frame.
      const transform = getComputedStyle(element).transform
      animation?.cancel()
      animation = undefined
      if (state.viewport) {
        document.body.style.width = `${state.viewport.width}px`
        document.body.style.height = `${state.viewport.height}px`
        document.body.style.translate = `${-state.viewport.x}px ${-state.viewport.y}px`
      } else clearViewport()
      const target = outside(state, element)
      if (!state.transition || state.hidden) {
        element.style.transform = state.hidden ? target : ''
        return
      }
      const hiding = state.transition === 'hiding'
      element.style.transform = hiding ? target : ''
      animation = element.animate([{ transform }, { transform: hiding ? target : 'none' }], {
        duration: matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 0
          : (state.motionDuration ?? FLOATING_EDGE_MOTION_MS),
        easing: hiding ? motion.ease : motion.entranceEase,
        fill: 'both',
      })
      const current = animation
      const id = state.motionId
      if (id !== undefined) {
        void current.finished
          .then(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          )
          .then(() =>
            animation === current ? window.api.completeFloatingWindowEdgeMotion(id) : undefined,
          )
          .catch(() => {}) // Cancellation is expected when the pointer reverses the slide.
      }
    },
    { flush: 'post' },
  )
  onUnmounted(() => {
    animation?.cancel()
    animation = undefined
    clearViewport()
  })
}
