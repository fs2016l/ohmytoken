<script setup lang="ts">
import { ref, watch } from 'vue'
import type { EChartsCoreOption } from 'echarts/core'
import { init, getBarLayout as readBarLayout, type ECharts } from '../../utils/charts'
import { useChartRenderLifecycle } from '../../composables/useChartRenderLifecycle'
import { useTypography } from '../../composables/useTypography'
import { chartMotion } from '../../config/motion'
import { UI_FONT_WEIGHT } from '../../config/typography'
const props = withDefaults(
  defineProps<{
    option: EChartsCoreOption
    label: string
    highlight?: string
    animated?: boolean
  }>(),
  { highlight: undefined, animated: true },
)
const emit = defineEmits<{
  select: [index: number]
  hover: [seriesId?: string]
  layout: []
}>()
const element = ref<HTMLElement | null>(null)
const { currentInterfaceFont, currentNumberFont } = useTypography()
let chart: ECharts | undefined
function getBarLayout(seriesId: string) {
  return chart ? readBarLayout(chart, seriesId) : undefined
}
defineExpose({ getBarLayout })
function applyHighlight(): void {
  chart?.dispatchAction({ type: 'downplay' })
  if (props.highlight) chart?.dispatchAction({ type: 'highlight', seriesId: props.highlight })
}
watch(() => props.highlight, applyHighlight)
function render(): void {
  if (!element.value) return
  if (!chart) {
    chart = init(element.value)
    chart.on('click', (event) => {
      if (typeof event.dataIndex === 'number') emit('select', event.dataIndex)
    })
    chart.on('mouseover', (event) => {
      if (typeof event.seriesId === 'string') emit('hover', event.seriesId)
    })
    chart.on('mouseout', () => emit('hover'))
    chart.on('globalout', () => emit('hover'))
    chart.getZr().on('mousemove', (event) => {
      if (!event.target) emit('hover')
    })
    chart.getZr().on('globalout', () => emit('hover'))
  }
  chart.setOption(
    {
      textStyle: {
        fontWeight: UI_FONT_WEIGHT,
        fontFamily: getComputedStyle(document.documentElement)
          .getPropertyValue('--font-sans')
          .trim(),
      },
      ...props.option,
      ...chartMotion(reduced.value || props.animated === false),
    },
    { replaceMerge: ['series'] },
  )
  applyHighlight()
  emit('layout')
}
const { requestRender, reduced } = useChartRenderLifecycle(element, {
  render,
  chart: () => chart,
  resize: () => {
    chart?.resize()
    emit('layout')
  },
  dispose: () => {
    chart?.dispose()
    chart = undefined
  },
})
watch(
  [() => props.option, () => props.animated, currentInterfaceFont, currentNumberFont],
  requestRender,
  {
    deep: true,
    flush: 'post',
  },
)
</script>
<template><div ref="element" class="workspace-chart" role="img" :aria-label="label" /></template>
<style scoped>
.workspace-chart {
  width: 100%;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
</style>
