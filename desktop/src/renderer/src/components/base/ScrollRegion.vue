<script setup lang="ts">
import { ref } from 'vue'
import { useRetainedScroll } from '../../composables/useRetainedScroll'
const props = withDefaults(
  defineProps<{
    pageKey: string
    region: string
    label: string
    axis?: 'both' | 'vertical'
    ready?: boolean
  }>(),
  { axis: 'both', ready: true },
)
const element = ref<HTMLElement | null>(null)
const { save, stopRestoring, scrollToTop } = useRetainedScroll(
  element,
  () => props.pageKey,
  () => props.region,
  () => props.ready,
)
defineExpose({ scrollToTop, element })
</script>
<template>
  <div
    ref="element"
    class="scroll-region"
    :class="{ 'scroll-region--vertical': axis === 'vertical' }"
    tabindex="0"
    role="region"
    :aria-label="label"
    @scroll.passive="save"
    @wheel.passive="stopRestoring"
    @touchstart.passive="stopRestoring"
    @pointerdown="stopRestoring"
    @keydown="stopRestoring"
  >
    <div class="scroll-region-content"><slot /></div>
  </div>
</template>
<style scoped>
.scroll-region {
  min-height: 0;
  min-width: 0;
  overflow: auto;
  overflow-anchor: none;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  flex: 1;
}
.scroll-region-content {
  min-width: 100%;
}
.scroll-region--vertical {
  overflow-x: hidden;
}
.scroll-region--vertical > .scroll-region-content {
  min-width: 0;
  width: 100%;
}
</style>
