<script setup lang="ts">
import { onBeforeUnmount, onDeactivated, onMounted, ref, watch, watchEffect } from 'vue'
import {
  createChartTooltip,
  chartTooltipPosition,
  type ChartTooltipData,
} from '../../utils/chart-tooltip'
import '../../styles/chart-tooltip.css'
const props = defineProps<{
  id: string
  content: ChartTooltipData | null
  point: { x: number; y: number } | null
  zIndex?: number
}>()
const emit = defineEmits<{ dismiss: [] }>()
const panel = ref<HTMLElement | null>(null)
watch(
  [panel, () => props.content],
  () => {
    if (panel.value && props.content) panel.value.replaceChildren(createChartTooltip(props.content))
  },
  { flush: 'post' },
)
watchEffect(
  () => {
    if (!panel.value || !props.content || !props.point) return
    const position = chartTooltipPosition(props.point, panel.value.getBoundingClientRect())
    panel.value.style.left = `${position.left}px`
    panel.value.style.top = `${position.top}px`
  },
  { flush: 'post' },
)
function close(): void {
  emit('dismiss')
}
function keydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}
onMounted(() => {
  window.addEventListener('scroll', close, true)
  window.addEventListener('resize', close)
  window.addEventListener('keydown', keydown)
})
onDeactivated(close)
onBeforeUnmount(() => {
  window.removeEventListener('scroll', close, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('keydown', keydown)
})
</script>
<template>
  <Teleport to="body">
    <div
      v-if="content && point"
      :id="id"
      ref="panel"
      class="pointer-tooltip"
      :style="zIndex ? { zIndex } : undefined"
    />
  </Teleport>
</template>
<style scoped>
.pointer-tooltip {
  position: fixed;
  z-index: 1100;
  pointer-events: none;
}
</style>
