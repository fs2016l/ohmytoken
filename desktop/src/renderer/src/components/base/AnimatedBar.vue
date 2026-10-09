<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAnimatedValue } from '../../composables/useAnimatedValue'
const props = withDefaults(
  defineProps<{ value: number; max?: number; color?: string; reverse?: boolean }>(),
  { max: 100, color: 'var(--chart-primary)', reverse: false },
)
const element = ref<HTMLElement | null>(null)
const target = computed(() =>
  props.max > 0 ? Math.min(1, Math.max(0, props.value / props.max)) : 0,
)
const progress = useAnimatedValue(target, element)
</script>
<template>
  <span ref="element" class="animated-bar" aria-hidden="true">
    <span
      :style="{
        transform: `scaleX(${progress})`,
        transformOrigin: reverse ? 'right' : 'left',
        background: color,
      }"
    />
  </span>
</template>
<style scoped>
.animated-bar {
  display: block;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  width: 100%;
}
.animated-bar > span {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
}
</style>
