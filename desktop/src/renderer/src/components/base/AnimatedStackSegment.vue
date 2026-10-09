<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAnimatedValue } from '../../composables/useAnimatedValue'
const props = defineProps<{ start: number; end: number; color: string; reverse: boolean }>()
const element = ref<HTMLElement | null>(null)
const start = useAnimatedValue(
  computed(() => props.start),
  element,
)
const end = useAnimatedValue(
  computed(() => props.end),
  element,
)
</script>
<template>
  <span ref="element" class="animated-stack-segment">
    <i
      :style="{
        left: `${(reverse ? 1 - end : start) * 100}%`,
        width: `${Math.max(0, end - start) * 100}%`,
        background: color,
      }"
    />
  </span>
</template>
<style scoped>
.animated-stack-segment {
  position: absolute;
  inset: 0;
}
.animated-stack-segment > i {
  position: absolute;
  top: 0;
  bottom: 0;
}
</style>
