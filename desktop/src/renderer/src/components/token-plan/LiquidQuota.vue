<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useTheme } from '../../composables/useTheme'
import { useMotionVisibility } from '../../composables/useMotionVisibility'
import { useAnimatedValue } from '../../composables/useAnimatedValue'
import { quotaLiquidSpec, quotaPaint } from '../../utils/quota-paint'
import { quotaLiquidGeometry } from '../../utils/quota-liquid'
import { getTheme } from '../../config/themes'
import { formatNumber } from '../../utils/number-format'

const props = withDefaults(
  defineProps<{ percent: number | null; label: string; unlimited?: boolean; height?: number }>(),
  { unlimited: false, height: 124 },
)
const root = ref<HTMLElement | null>(null)
const { visible, reduced } = useMotionVisibility(root)
const { currentTheme, currentAccent } = useTheme()
const id = `quota-liquid-${useId()}`
const percent = computed(() =>
  props.unlimited || props.percent === null || !Number.isFinite(props.percent)
    ? null
    : Math.max(0, Math.min(100, props.percent)),
)
// Retarget the existing liquid level, including the final descent to empty.
const displayed = useAnimatedValue(percent, root, () => false)
const moving = computed(
  () =>
    visible.value &&
    !reduced.value &&
    percent.value !== null &&
    displayed.value > 0 &&
    displayed.value < 100,
)
const spec = computed(() => quotaLiquidSpec(currentTheme.value))
const theme = computed(() => getTheme(currentAccent.value))
const color = computed(() => quotaPaint(displayed.value, theme.value, currentTheme.value))
const geometry = computed(() => quotaLiquidGeometry(displayed.value, props.height))
const palette = computed(() => theme.value.colors[currentTheme.value])
const style = computed(() => ({
  '--liquid-color': color.value,
  '--liquid-air': String(spec.value.air),
  '--liquid-height': `${props.height}px`,
  '--liquid-percent': `${displayed.value}%`,
  '--liquid-amplitude': `${geometry.value.amplitude}px`,
  '--liquid-top': `color-mix(in srgb, ${color.value} ${spec.value.front * 55}%, var(--surface-low))`,
  '--liquid-middle': `color-mix(in srgb, ${color.value} ${spec.value.front * 80}%, var(--surface-low))`,
  '--liquid-bottom': `color-mix(in srgb, ${color.value} ${spec.value.front * 115}%, var(--surface-low))`,
  '--liquid-highlight':
    currentTheme.value === 'light' ? palette.value['--surface-low'] : palette.value['--text'],
  '--liquid-highlight-opacity': currentTheme.value === 'light' ? '0.86' : '0.3',
  '--liquid-reflection-opacity': currentTheme.value === 'light' ? '0.14' : '0.045',
  '--liquid-label': `color-mix(in srgb, ${palette.value['--text-muted']} 75%, ${palette.value['--text']})`,
}))
</script>

<template>
  <div
    ref="root"
    class="liquid-quota"
    :class="{ 'liquid-quota--moving': moving, 'liquid-quota--full': displayed === 100 }"
    :style="style"
    :role="percent === null ? 'group' : 'progressbar'"
    :aria-label="label"
    :aria-valuenow="percent ?? undefined"
    :aria-valuemin="percent === null ? undefined : 0"
    :aria-valuemax="percent === null ? undefined : 100"
    :aria-valuetext="unlimited ? '∞' : formatNumber(percent, { percent: true })"
  >
    <div v-if="percent !== null" class="liquid-air" aria-hidden="true" />
    <div v-if="percent !== null && displayed > 0" class="liquid-level" aria-hidden="true">
      <svg
        class="liquid-wave liquid-wave--back"
        :viewBox="geometry.viewBox"
        preserveAspectRatio="none"
      >
        <path :d="geometry.back" />
      </svg>
      <svg
        class="liquid-wave liquid-wave--middle"
        :viewBox="geometry.viewBox"
        preserveAspectRatio="none"
      >
        <path :d="geometry.middle" />
      </svg>
      <svg
        class="liquid-wave liquid-wave--front"
        :viewBox="geometry.viewBox"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient
            :id="`${id}-depth`"
            gradientUnits="userSpaceOnUse"
            x1="0"
            x2="0"
            :y1="geometry.amplitude"
            :y2="geometry.amplitude + geometry.depth"
          >
            <stop offset="0" class="liquid-stop--top" />
            <stop offset="0.42" class="liquid-stop--middle" />
            <stop offset="1" class="liquid-stop--bottom" />
          </linearGradient>
          <linearGradient
            :id="`${id}-shine`"
            gradientUnits="userSpaceOnUse"
            x1="0"
            x2="100"
            spreadMethod="repeat"
          >
            <stop offset="0" stop-opacity="0.32" />
            <stop offset="0.35" stop-opacity="0.94" />
            <stop offset="0.7" stop-opacity="0.62" />
            <stop offset="1" stop-opacity="0.32" />
          </linearGradient>
        </defs>
        <path :d="geometry.front" :fill="`url(#${id}-depth)`" />
        <path
          class="liquid-surface liquid-surface--glow"
          :d="geometry.surface"
          :stroke="`url(#${id}-shine)`"
          vector-effect="non-scaling-stroke"
        />
        <path
          class="liquid-surface"
          :d="geometry.surface"
          :stroke="`url(#${id}-shine)`"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <div class="liquid-reflection">
        <svg class="liquid-reflection__light" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M-10 46C25 116 74 110 110 16L110 30C73 114 25 122-10 61Z" />
          <path
            class="liquid-reflection__line"
            d="M-10 62C27 122 78 113 110 34"
            vector-effect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
    <div class="liquid-readout"><slot /></div>
  </div>
</template>

<style scoped>
.liquid-quota {
  position: relative;
  min-width: 0;
  height: var(--liquid-height);
  border: 1px solid var(--quota-outline);
  border-radius: 8px;
  overflow: hidden;
  isolation: isolate;
  background: var(--surface-low);
}
.liquid-air {
  position: absolute;
  inset: 0;
  background: var(--liquid-color);
  opacity: var(--liquid-air);
}
.liquid-level {
  position: absolute;
  bottom: 0;
  left: -1px;
  right: -1px;
  height: var(--liquid-percent);
}
.liquid-wave {
  position: absolute;
  display: block;
  left: 0;
  top: calc(-1 * var(--liquid-amplitude));
  width: 200%;
  height: calc(var(--liquid-height) + var(--liquid-amplitude) * 2);
  overflow: visible;
  animation-name: quota-front-wave;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  animation-play-state: paused;
}
.liquid-wave--back {
  fill: var(--liquid-middle);
  opacity: 0.36;
  animation-duration: 8.8s;
  animation-direction: reverse;
  animation-delay: -3.1s;
}
.liquid-wave--middle {
  fill: var(--liquid-top);
  opacity: 0.65;
  animation-duration: 7.1s;
  animation-delay: -1.4s;
}
.liquid-wave--front {
  animation-duration: 5.8s;
}
.liquid-wave stop {
  stop-color: var(--liquid-highlight);
}
.liquid-wave .liquid-stop--top {
  stop-color: var(--liquid-top);
}
.liquid-wave .liquid-stop--middle {
  stop-color: var(--liquid-middle);
}
.liquid-wave .liquid-stop--bottom {
  stop-color: var(--liquid-bottom);
}
.liquid-surface {
  fill: none;
  stroke-width: 1.2px;
  opacity: var(--liquid-highlight-opacity);
}
.liquid-surface--glow {
  stroke-width: 4px;
  opacity: calc(var(--liquid-highlight-opacity) * 0.17);
}
.liquid-reflection {
  position: absolute;
  inset: var(--liquid-amplitude) 0 0;
  overflow: hidden;
  pointer-events: none;
}
.liquid-reflection__light {
  display: block;
  width: 100%;
  height: 100%;
  fill: var(--liquid-highlight);
  opacity: var(--liquid-reflection-opacity);
  animation: quota-reflection 13s ease-in-out infinite alternate paused;
}
.liquid-reflection__line {
  fill: none;
  stroke: var(--liquid-highlight);
  stroke-width: 0.7px;
}
.liquid-quota--moving .liquid-wave,
.liquid-quota--moving .liquid-reflection__light {
  animation-play-state: running;
}
.liquid-readout {
  --text-muted: var(--liquid-label);
  position: relative;
  z-index: 1;
  height: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
@keyframes quota-front-wave {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}
@keyframes quota-reflection {
  from {
    transform: translate(-2%, 2%);
  }
  to {
    transform: translate(2%, -3%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .liquid-wave,
  .liquid-reflection__light {
    animation: none;
  }
}
</style>
