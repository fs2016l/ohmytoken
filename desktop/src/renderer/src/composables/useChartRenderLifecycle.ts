import { nextTick, onMounted, onUnmounted, watch, type Ref } from 'vue'
import type { ECharts } from '../utils/charts'
import { useMotionVisibility } from './useMotionVisibility'

interface ChartRenderLifecycleOptions {
  render: () => void
  resize: () => void
  dispose: () => void
  chart: () => ECharts | null | undefined
}

/** Keep live geometry while hidden; only leaving a cached page releases its chart. */
export function useChartRenderLifecycle(
  chartRef: Ref<HTMLElement | null | undefined>,
  options: ChartRenderLifecycleOptions,
) {
  const { active, visible, reduced } = useMotionVisibility(chartRef)
  let observer: ResizeObserver | undefined
  let frame = 0
  let pending = true
  let disposed = false

  function requestRender(): void {
    pending = true
    void nextTick(() => {
      if (disposed || !visible.value) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        if (disposed || !visible.value) return
        options.chart()?.getZr().animation.resume()
        pending = false
        options.render()
      })
    })
  }
  function resize(): void {
    if (!visible.value) return
    options.resize()
    if (pending) requestRender()
  }
  watch(
    [active, visible, reduced],
    () => {
      if (!visible.value) {
        cancelAnimationFrame(frame)
        frame = 0
        if (!active.value) options.dispose()
        else options.chart()?.getZr().animation.pause()
        return
      }
      // A hidden element may have resized without a visible ResizeObserver callback.
      options.resize()
      requestRender()
    },
    { flush: 'post' },
  )
  onMounted(() => {
    observer = new ResizeObserver(resize)
    if (chartRef.value) observer.observe(chartRef.value)
    requestRender()
  })
  onUnmounted(() => {
    disposed = true
    cancelAnimationFrame(frame)
    observer?.disconnect()
    options.dispose()
  })
  return { requestRender, reduced, visible }
}
