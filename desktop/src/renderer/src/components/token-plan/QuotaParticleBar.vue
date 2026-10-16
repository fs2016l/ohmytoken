<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTheme } from '../../composables/useTheme'
import { useMotionVisibility } from '../../composables/useMotionVisibility'
import { quotaPaint } from '../../utils/quota-paint'
import { getTheme } from '../../config/themes'
import { formatNumber } from '../../utils/number-format'

const props = defineProps<{ percent: number | null; label: string; unlimited?: boolean }>()
const root = ref<HTMLElement | null>(null)
const { visible, reduced } = useMotionVisibility(root)
const { currentTheme, currentAccent } = useTheme()
const level = computed(() =>
  props.unlimited
    ? 100
    : props.percent === null || !Number.isFinite(props.percent)
      ? null
      : Math.max(0, Math.min(100, props.percent)),
)
// 与液面格共用主题的额度色阶，剩余越少越偏向警示色。
const color = computed(() =>
  quotaPaint(level.value ?? 0, getTheme(currentAccent.value), currentTheme.value),
)
const moving = computed(
  () => visible.value && !reduced.value && level.value !== null && level.value > 0,
)
// 固定的粒子参数：位置、大小、速度和亮度错开，每次渲染保持一致。
const particles = [
  { top: 1.4, size: 1.6, duration: 4.2, delay: -0.6, peak: 0.85 },
  { top: 3.1, size: 1.2, duration: 5.6, delay: -2.9, peak: 0.6 },
  { top: 2.2, size: 1.8, duration: 3.6, delay: -1.8, peak: 0.75 },
  { top: 3.6, size: 1.3, duration: 6.4, delay: -4.4, peak: 0.55 },
  { top: 1.8, size: 1.1, duration: 4.9, delay: -3.5, peak: 0.7 },
]
</script>

<template>
  <div
    ref="root"
    class="quota-particle-bar"
    :class="{ 'quota-particle-bar--moving': moving }"
    :style="{ '--quota-bar-color': color, '--quota-bar-level': `${level ?? 0}%` }"
    :role="level === null ? 'img' : 'progressbar'"
    :aria-label="label"
    :aria-valuenow="level ?? undefined"
    :aria-valuemin="level === null ? undefined : 0"
    :aria-valuemax="level === null ? undefined : 100"
    :aria-valuetext="unlimited ? '∞' : formatNumber(level, { percent: true })"
  >
    <div v-if="level !== null && level > 0" class="quota-particle-bar__fill" aria-hidden="true">
      <span
        v-for="(particle, index) in particles"
        :key="index"
        class="quota-particle-bar__particle"
        :style="{
          top: `${particle.top}px`,
          width: `${particle.size}px`,
          height: `${particle.size}px`,
          animationDuration: `${particle.duration}s`,
          animationDelay: `${particle.delay}s`,
          '--quota-particle-peak': particle.peak,
        }"
      />
    </div>
  </div>
</template>

<style scoped>
.quota-particle-bar {
  position: relative;
  min-width: 0;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  /* 中性灰轨道：与卡片背景拉开对比，未填满时也能看清整条额度的长度。 */
  background: color-mix(in srgb, var(--text) 10%, transparent);
}
.quota-particle-bar__fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: max(6px, var(--quota-bar-level));
  border-radius: 3px;
  overflow: hidden;
  background: color-mix(in srgb, var(--quota-bar-color) 62%, var(--surface-low));
  transition: width var(--motion-slow, 480ms) var(--motion-ease, ease);
}
.quota-particle-bar__particle {
  position: absolute;
  left: -3px;
  border-radius: 50%;
  background: #fff;
  opacity: 0;
  animation-name: quota-particle;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  animation-play-state: paused;
}
.quota-particle-bar--moving .quota-particle-bar__particle {
  animation-play-state: running;
}
@keyframes quota-particle {
  0% {
    left: -3px;
    opacity: 0;
  }
  15% {
    opacity: var(--quota-particle-peak);
  }
  50% {
    opacity: calc(var(--quota-particle-peak) * 0.35);
  }
  85% {
    opacity: var(--quota-particle-peak);
  }
  100% {
    left: 100%;
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .quota-particle-bar__particle {
    animation: none;
  }
}
</style>
