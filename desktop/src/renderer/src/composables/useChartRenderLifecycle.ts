import { nextTick, onActivated, onDeactivated, onMounted, onUnmounted, type Ref } from 'vue'

interface ChartRenderLifecycleOptions {
  render: () => void
  resize: () => void
  dispose: () => void
}

/**
 * Keeps canvas charts in sync with cached routes and responsive containers.
 * A render requested while the element is hidden stays pending until it has a real size.
 */
export function useChartRenderLifecycle(
  chartRef: Ref<HTMLElement | undefined>,
  options: ChartRenderLifecycleOptions,
): { requestRender: () => void } {
  let resizeObserver: ResizeObserver | null = null
  let animationFrame: number | null = null
  let renderPending = true
  let wasVisible = false
  let stopped = false

  function hasRenderableSize(): boolean {
    const element = chartRef.value
    return Boolean(element && element.clientWidth > 0 && element.clientHeight > 0)
  }

  function flushRender(): void {
    animationFrame = null
    if (stopped || !hasRenderableSize()) return
    renderPending = false
    wasVisible = true
    options.render()
  }

  function requestRender(): void {
    renderPending = true
    void nextTick(() => {
      if (stopped) return
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(flushRender)
    })
  }

  function handleResize(): void {
    if (!hasRenderableSize()) {
      wasVisible = false
      return
    }
    if (renderPending || !wasVisible) {
      requestRender()
      return
    }
    options.resize()
  }

  onMounted(() => {
    stopped = false
    if (chartRef.value && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleResize)
      resizeObserver.observe(chartRef.value)
    } else {
      window.addEventListener('resize', handleResize)
    }
    requestRender()
  })

  onActivated(() => {
    wasVisible = false
    requestRender()
  })

  onDeactivated(() => {
    wasVisible = false
  })

  onUnmounted(() => {
    stopped = true
    resizeObserver?.disconnect()
    window.removeEventListener('resize', handleResize)
    if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
    options.dispose()
  })

  return { requestRender }
}
