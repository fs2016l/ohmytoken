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
  let renderRevision = 0
  let fontKey = ''
  let fontsReady = Promise.resolve()

  function loadChartFonts(): Promise<void> {
    const style = getComputedStyle(document.documentElement)
    const labelFont = style.getPropertyValue('--font-sans').trim() || 'sans-serif'
    const numberFont = style.getPropertyValue('--font-number').trim() || labelFont
    const key = `${labelFont}|${numberFont}`
    if (key !== fontKey) {
      fontKey = key
      // ECharts caches text measurements. Its first layout must not measure a
      // fallback face and keep those widths after the selected font arrives.
      fontsReady = Promise.all([
        document.fonts.load(`400 12px ${labelFont}`, 'Usage 用量'),
        document.fonts.load(`400 12px ${numberFont}`, '0123456789.KM%'),
        document.fonts.load(`500 12px ${numberFont}`, '0123456789.KM%'),
      ]).then(
        () => undefined,
        () => undefined, // A missing optional face still permits normal font fallback.
      )
    }
    return fontsReady
  }

  function requestRender(): void {
    pending = true
    const revision = ++renderRevision
    void nextTick(async () => {
      if (disposed || !visible.value) return
      await loadChartFonts()
      if (disposed || !visible.value || revision !== renderRevision) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        if (disposed || !visible.value || revision !== renderRevision) return
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
    // Canvas text is measured independently of DOM text. Redraw after a bundled
    // font finishes loading, including later changes made in Appearance settings.
    document.fonts.addEventListener('loadingdone', requestRender)
    void document.fonts.ready.then(requestRender)
    requestRender()
  })
  onUnmounted(() => {
    disposed = true
    cancelAnimationFrame(frame)
    observer?.disconnect()
    document.fonts.removeEventListener('loadingdone', requestRender)
    options.dispose()
  })
  return { requestRender, reduced, visible }
}
