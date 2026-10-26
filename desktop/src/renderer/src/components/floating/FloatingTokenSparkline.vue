<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import type { UsageTrendStats } from '@shared/models'
import { useMotionVisibility } from '../../composables/useMotionVisibility'
import { useTheme } from '../../composables/useTheme'
import {
  tokenSparklineBins,
  tokenSparklineGeometry,
  tokenSparklineInset,
  tokenSparklinePalette,
  type TokenSparklineInsets,
} from '../../utils/floating-token-sparkline'

const props = withDefaults(
  defineProps<{ stats: UsageTrendStats; height?: number; insets?: TokenSparklineInsets }>(),
  { height: 70, insets: () => tokenSparklineInset },
)
const { currentTheme } = useTheme()
const palette = computed(() => tokenSparklinePalette[currentTheme.value])
const container = ref<HTMLElement | null>(null)
const edge = ref<SVGPathElement | null>(null)
const ripple = ref<SVGCircleElement | null>(null)
const id = 'floating-sparkline-' + useId().replace(/[^\w-]/g, '')
const { visible, reduced } = useMotionVisibility(container)
const width = ref(240)
const values = ref(tokenSparklineBins(props.stats))
const bins = computed(() => tokenSparklineBins(props.stats))
const geometry = computed(() =>
  tokenSparklineGeometry(values.value, width.value, props.height, props.insets),
)
const sweepOpacity = ref(0)
const sweepOffset = ref(0)
const sweepLength = ref(32)
const pathLength = ref(1)
let frame = 0
let pulse: Animation | undefined
let observer: ResizeObserver | undefined
let previousTotal = props.stats.totalTokens
let previousSpan = props.stats.to - props.stats.from
let destination = [...values.value]

function stop(): void {
  cancelAnimationFrame(frame)
  frame = 0
  pulse?.cancel()
  pulse = undefined
  sweepOpacity.value = 0
  values.value = [...destination]
}
watch(
  bins,
  (next) => {
    const span = props.stats.to - props.stats.from
    const changed = props.stats.totalTokens !== previousTotal
    const rangeChanged = Math.abs(span - previousSpan) > Math.max(1000, previousSpan * 0.05)
    previousTotal = props.stats.totalTokens
    previousSpan = span
    destination = next
    const from = [...values.value]
    cancelAnimationFrame(frame)
    pulse?.cancel()
    sweepOpacity.value = 0
    if (!changed || rangeChanged || !visible.value || reduced.value) {
      stop()
      return
    }
    const started = performance.now()
    let prepared = false
    function tick(now: number): void {
      const elapsed = now - started
      const t = Math.min(1, elapsed / 480)
      if (elapsed <= 500) {
        const eased = 1 - (1 - t) ** 3
        values.value = destination.map(
          (value, index) => from[index]! + (value - from[index]!) * eased,
        )
      }
      if (elapsed >= 500) {
        if (!prepared) {
          values.value = [...destination]
          pathLength.value = edge.value?.getTotalLength() ?? 1
          sweepLength.value = Math.max(32, width.value * 0.09)
          prepared = true
        }
        const progress = Math.min(1, (elapsed - 500) / 800)
        sweepOffset.value = sweepLength.value - (pathLength.value + sweepLength.value) * progress
        sweepOpacity.value = Math.max(0, Math.min(1, progress * 9, (1 - progress) * 9))
      }
      if (elapsed < 1300) frame = requestAnimationFrame(tick)
      else {
        frame = 0
        sweepOpacity.value = 0
        pulse = ripple.value?.animate(
          [
            { r: '5px', opacity: 0.55 },
            { r: '13px', opacity: 0 },
          ],
          {
            duration: 600,
            easing: 'ease-out',
          },
        )
      }
    }
    frame = requestAnimationFrame(tick)
  },
  { flush: 'post' },
)
watch([visible, reduced], ([show, less]) => {
  if (!show || less) stop()
})
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (container.value?.clientWidth) width.value = container.value.clientWidth
  })
  if (container.value) observer.observe(container.value)
})
onUnmounted(() => {
  stop()
  observer?.disconnect()
})
</script>

<template>
  <span
    ref="container"
    class="floating-token-sparkline"
    :style="{
      '--sparkline-height': `${height}px`,
      '--sparkline-start': palette.start,
      '--sparkline-end': palette.end,
      '--sparkline-core': palette.core,
    }"
    aria-hidden="true"
  >
    <svg :viewBox="`0 0 ${width} ${height}`">
      <defs>
        <linearGradient :id="`${id}-stroke`">
          <stop stop-color="var(--sparkline-start)" />
          <stop offset=".55" stop-color="var(--sparkline-start)" />
          <stop offset="1" stop-color="var(--sparkline-end)" />
        </linearGradient>
        <linearGradient :id="`${id}-fill`" x1="0" y1="0" x2=".18" y2="1">
          <stop stop-color="var(--sparkline-start)" class="sparkline-fill-top" />
          <stop offset=".5" stop-color="var(--sparkline-start)" class="sparkline-fill-mid" />
          <stop offset="1" stop-color="var(--sparkline-end)" class="sparkline-fill-bottom" />
        </linearGradient>
        <filter
          :id="`${id}-blur`"
          filterUnits="userSpaceOnUse"
          x="-10"
          y="-12"
          :width="width + 20"
          :height="height + 24"
        >
          <feGaussianBlur stdDeviation="2.3" />
        </filter>
      </defs>
      <path :d="geometry.area" :fill="`url(#${id}-fill)`" />
      <path
        class="sparkline-halo"
        :d="geometry.line"
        :stroke="`url(#${id}-stroke)`"
        :filter="`url(#${id}-blur)`"
      />
      <path ref="edge" class="sparkline-edge" :d="geometry.line" :stroke="`url(#${id}-stroke)`" />
      <path class="sparkline-core" :d="geometry.line" />
      <path
        class="sparkline-sweep"
        :d="geometry.line"
        :style="{
          opacity: sweepOpacity,
          strokeDasharray: `${sweepLength} ${pathLength + sweepLength + 1}`,
          strokeDashoffset: sweepOffset,
        }"
      />
      <g :transform="`translate(${geometry.last[0]},${geometry.last[1]})`">
        <circle class="sparkline-point-halo" r="7" :filter="`url(#${id}-blur)`" />
        <circle ref="ripple" class="sparkline-ripple" r="5" />
        <circle class="sparkline-point" r="3" />
      </g>
    </svg>
  </span>
</template>

<style scoped>
.floating-token-sparkline {
  display: block;
  width: 100%;
  height: var(--sparkline-height);
  flex: none;
}
.floating-token-sparkline svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.floating-token-sparkline path {
  stroke-linecap: round;
  stroke-linejoin: round;
}
.sparkline-fill-top {
  stop-opacity: 0.38;
}
.sparkline-fill-mid {
  stop-opacity: 0.22;
}
.sparkline-fill-bottom {
  stop-opacity: 0.12;
}
.sparkline-halo {
  fill: none;
  stroke-width: 5.5;
  opacity: 0.36;
}
.sparkline-edge {
  fill: none;
  stroke-width: 2.2;
}
.sparkline-core {
  fill: none;
  stroke: var(--sparkline-core);
  stroke-width: 0.55;
  opacity: 0.78;
}
.sparkline-sweep {
  fill: none;
  stroke: var(--sparkline-core);
  stroke-width: 1.8;
  opacity: 0;
}
.sparkline-point-halo {
  fill: var(--sparkline-start);
  opacity: 0.35;
}
.sparkline-point {
  fill: var(--sparkline-start);
  stroke: var(--sparkline-core);
  stroke-width: 1.4;
}
.sparkline-ripple {
  fill: none;
  stroke: var(--sparkline-start);
  stroke-width: 1;
  opacity: 0;
}
:global(html[data-theme='dark']) .sparkline-halo {
  stroke-width: 6.5;
  opacity: 0.55;
}
:global(html[data-theme='dark']) .sparkline-core {
  stroke-width: 1.05;
  opacity: 1;
}
:global(html[data-theme='dark']) .sparkline-fill-top {
  stop-opacity: 0.24;
}
:global(html[data-theme='dark']) .sparkline-fill-mid {
  stop-opacity: 0.14;
}
:global(html[data-theme='dark']) .sparkline-fill-bottom {
  stop-opacity: 0.07;
}
</style>
