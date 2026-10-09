<script setup lang="ts">
import { computed, ref } from 'vue'
import AnimatedStackSegment from './AnimatedStackSegment.vue'
import { useAnimatedValue } from '../../composables/useAnimatedValue'
const props = withDefaults(
  defineProps<{
    segments: Array<{ id: string; value: number; color: string }>
    max: number
    reverse?: boolean
    gradient?: string
    highlight?: string
  }>(),
  { reverse: false, gradient: undefined, highlight: undefined },
)
const element = ref<HTMLElement | null>(null)
const extent = useAnimatedValue(
  computed(() =>
    Math.min(
      1,
      props.max > 0
        ? props.segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0) / props.max
        : 0,
    ),
  ),
  element,
)
const ranges = computed(() => {
  let start = 0
  return [...props.segments]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((segment) => {
      const end = Math.min(1, start + (props.max > 0 ? Math.max(0, segment.value) / props.max : 0))
      const result = { ...segment, start, end }
      start = end
      return result
    })
})
</script>
<template>
  <span
    ref="element"
    class="animated-stacked-bar"
    :class="{ 'is-tonal': !!gradient }"
    aria-hidden="true"
  >
    <span class="stacked-colors">
      <AnimatedStackSegment
        v-for="segment in ranges"
        :key="segment.id"
        :data-model-id="segment.id"
        :start="segment.start"
        :end="segment.end"
        :color="segment.color"
        :reverse="reverse"
        :style="{ opacity: highlight && highlight !== segment.id ? 0.18 : 1 }"
      />
    </span>
    <i
      class="stacked-gradient"
      :style="{
        left: reverse ? `${(1 - extent) * 100}%` : '0',
        width: `${extent * 100}%`,
        background: gradient,
      }"
    />
  </span>
</template>
<style scoped>
.animated-stacked-bar {
  display: block;
  position: relative;
  width: 100%;
  height: 14px;
  border-radius: 2px;
  overflow: hidden;
}
.stacked-colors {
  position: absolute;
  inset: 0;
  transition: opacity var(--motion-hover);
}
.stacked-colors :deep(.animated-stack-segment) {
  pointer-events: none;
  transition: opacity var(--motion-hover);
}
.stacked-colors :deep(.animated-stack-segment > i) {
  pointer-events: auto;
}
.stacked-gradient {
  position: absolute;
  inset-block: 0;
  border-radius: inherit;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--motion-hover);
}
.is-tonal .stacked-colors {
  opacity: 0;
}
.is-tonal .stacked-gradient {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .stacked-colors,
  .stacked-colors :deep(.animated-stack-segment),
  .stacked-gradient {
    transition: none;
  }
}
</style>
