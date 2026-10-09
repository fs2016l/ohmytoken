<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  FLOATING_RESIZE_BAND,
  FLOATING_WINDOW_RADIUS,
  type FloatingResizeDirection,
} from '@shared/floating-window'

const props = defineProps<{ panel: HTMLElement | null; collapsed: boolean }>()
const rect = ref({ left: 0, top: 0, width: 0, height: 0 })
watch(
  () => props.panel,
  (panel, _old, cleanup) => {
    if (!panel) return
    const measure = (): void => {
      const { left, top, width, height } = panel.getBoundingClientRect()
      rect.value = { left, top, width, height }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    window.addEventListener('resize', measure)
    measure()
    cleanup(() => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    })
  },
  { immediate: true, flush: 'post' },
)

const handles = computed(() => {
  const { left: x, top: y, width: w, height: h } = rect.value
  if (!w || !h) return []
  const r = FLOATING_WINDOW_RADIUS,
    band = FLOATING_RESIZE_BAND,
    half = band / 2
  const corner = r + band
  const make = (
    direction: FloatingResizeDirection,
    left: number,
    top: number,
    width: number,
    height: number,
    cursor: string,
    path?: string,
  ) => ({
    direction,
    cursor,
    path,
    style: { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` },
  })
  const sides = [
    make('left', x - half, y + r, band, h - r * 2, 'ew-resize'),
    make('right', x + w - half, y + r, band, h - r * 2, 'ew-resize'),
  ]
  if (props.collapsed) return sides
  const arc = `A ${r} ${r} 0 0 1`
  return [
    ...sides,
    make('top', x + r, y - half, w - r * 2, band, 'ns-resize'),
    make('bottom', x + r, y + h - half, w - r * 2, band, 'ns-resize'),
    make(
      'top-left',
      x - half,
      y - half,
      corner,
      corner,
      'nwse-resize',
      `M ${half} ${r + half} ${arc} ${r + half} ${half}`,
    ),
    make(
      'top-right',
      x + w - r - half,
      y - half,
      corner,
      corner,
      'nesw-resize',
      `M ${half} ${half} ${arc} ${r + half} ${r + half}`,
    ),
    make(
      'bottom-left',
      x - half,
      y + h - r - half,
      corner,
      corner,
      'nesw-resize',
      `M ${r + half} ${r + half} ${arc} ${half} ${half}`,
    ),
    make(
      'bottom-right',
      x + w - r - half,
      y + h - r - half,
      corner,
      corner,
      'nwse-resize',
      `M ${r + half} ${half} ${arc} ${half} ${r + half}`,
    ),
  ]
})

function begin(event: PointerEvent, direction: FloatingResizeDirection): void {
  if (event.button !== 0 || event.pointerType !== 'mouse') return
  event.preventDefault()
  void window.api.beginFloatingWindowResize(direction).catch((error) => {
    console.warn('[floating-window] Could not start resizing:', error)
  })
}
</script>

<template>
  <div class="floating-resize-frame" aria-hidden="true">
    <template v-for="handle in handles" :key="handle.direction">
      <svg v-if="handle.path" class="floating-resize-corner" :style="handle.style">
        <path
          :data-resize="handle.direction"
          :d="handle.path"
          :stroke-width="FLOATING_RESIZE_BAND"
          :style="{ cursor: handle.cursor }"
          @pointerdown="begin($event, handle.direction)"
        />
      </svg>
      <div
        v-else
        class="floating-resize-side"
        :data-resize="handle.direction"
        :style="{ ...handle.style, cursor: handle.cursor }"
        @pointerdown="begin($event, handle.direction)"
      />
    </template>
  </div>
</template>

<style scoped>
.floating-resize-frame {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 100;
}
.floating-resize-side,
.floating-resize-corner {
  position: absolute;
  -webkit-app-region: no-drag;
}
.floating-resize-side {
  pointer-events: auto;
}
.floating-resize-corner path {
  fill: none;
  stroke: transparent;
  pointer-events: stroke;
}
</style>
