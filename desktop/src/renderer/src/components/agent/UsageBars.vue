<script setup lang="ts">
import { computed, onDeactivated, onUnmounted, ref, shallowRef, watch } from 'vue'
import { format as chartFormat } from 'echarts/core'
import type { TooltipComponentOption } from 'echarts/components'
import WorkspaceChart from '../base/WorkspaceChart.vue'
import { useChartTokens } from '../../composables/useChartTokens'
import { useI18n } from '../../i18n/useI18n'
import { formatNumber } from '../../utils/number-format'
import type { TokenBarPoint } from '../../utils/analytics-display'
import { createChartTooltip, chartTooltipPosition } from '../../utils/chart-tooltip'
import { modelSeriesColor } from '../../utils/model-series-color'
import { useChartColorMode } from '../../composables/useChartColorMode'
import { useUsageBarHover } from '../../composables/useUsageBarHover'
import { selectChartLabelIndices } from '../../utils/chart-label-layout'
import { modelLogoUrl } from '../../config/brand-logos'
import '../../styles/chart-tooltip.css'
const props = withDefaults(
  defineProps<{
    points: TokenBarPoint[]
    label: string
    mini?: boolean
    weekday?: boolean
    labelsVisible?: boolean
  }>(),
  { mini: false, weekday: false, labelsVisible: false },
)
const tokens = useChartTokens()
const { mode } = useChartColorMode()
const hover = useUsageBarHover()
const hoverOwner = Symbol('usage-bars')
function changeHover(seriesId?: string): void {
  hover?.set(hoverOwner, mode.value === 'categorical' ? seriesId : undefined)
}
watch([mode, () => props.points], () => hover?.clear())
onDeactivated(() => changeHover())
onUnmounted(() => changeHover())
const seriesColor = (id: string): string =>
  mode.value === 'tonal'
    ? tokens.value[props.mini ? '--chart-quaternary' : '--chart-primary']
    : modelSeriesColor(id, tokens.value)
const otherColor = computed(() =>
  mode.value === 'tonal' ? seriesColor('') : tokens.value['--analytics-series-other'],
)
const { label: localize, currentLang } = useI18n()
const weekdayNames = computed(() =>
  currentLang.value === 'zh'
    ? (['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const)
    : (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const),
)
function weekdayLabel(key: string): string {
  const day = new Date(`${key}T00:00:00`).getDay()
  return weekdayNames.value[day] ?? key
}
const plot = ref<InstanceType<typeof WorkspaceChart> | null>(null)
const labelIndices = shallowRef<number[]>([])
function updateLabelLayout(): void {
  const width = (plot.value?.$el as HTMLElement | undefined)?.clientWidth
  if (!width) return
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-number').trim()
  const font = `600 ${props.mini ? 10 : 11}px ${family || 'sans-serif'}`
  const candidates = props.points.flatMap((point, index) => {
    const center = plot.value?.getCategoryPosition(index)
    if (center === undefined || point.value <= 0) return []
    return [
      {
        index,
        value: point.value,
        center,
        width: chartFormat.getTextRect(formatNumber(point.value, { compact: true }), font).width,
      },
    ]
  })
  const next = selectChartLabelIndices(candidates, width, props.mini ? 16 : 12)
  if (
    next.length !== labelIndices.value.length ||
    next.some((index, position) => index !== labelIndices.value[position])
  )
    labelIndices.value = next
}
const tooltip = computed<TooltipComponentOption>(() => {
  void currentLang.value
  const modelIcons = new Map(
    props.points.flatMap((point) =>
      point.models.map(
        (model) => [model.id, modelLogoUrl(model.name) ?? modelLogoUrl(model.id)] as const,
      ),
    ),
  )
  return {
    trigger: mode.value === 'categorical' ? 'item' : 'axis',
    renderMode: 'html',
    appendTo: 'body',
    confine: false,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    extraCssText: 'box-shadow:none;z-index:1100;',
    transitionDuration: 0,
    hideDelay: 0,
    formatter: (params) => {
      const item = Array.isArray(params) ? params[0] : params
      const point = props.points[item?.dataIndex]
      if (!point) return ''
      const focused = mode.value === 'categorical' ? item?.seriesId : undefined
      if (typeof focused === 'string') changeHover(focused)
      const models = focused
        ? point.models.filter((model) => `model:${model.id}` === focused)
        : point.models
      const other = (!focused || focused === 'remainder') && point.otherTokens > 0
      return createChartTooltip({
        title: point.title.replaceAll('-', '/'),
        summary: {
          label: focused
            ? localize('Tokens', 'Token 用量')
            : localize('Total tokens', 'Token 总量'),
          value: formatNumber(
            focused
              ? models.reduce((total, model) => total + model.value, other ? point.otherTokens : 0)
              : point.value,
            { compact: true },
          ),
        },
        rows: [
          ...models.map((model) => ({
            label: model.name || localize('Unknown model', '未知模型'),
            value: formatNumber(model.value, { compact: true }),
            color: seriesColor(model.id),
            iconUrl: modelIcons.get(model.id),
          })),
          ...(other
            ? [
                {
                  label: localize('Other', '其他'),
                  value: formatNumber(point.otherTokens, { compact: true }),
                  color: otherColor.value,
                },
              ]
            : []),
        ],
      })
    },
    position: (point, _params, _element, _rect, size) => {
      const bounds = (plot.value?.$el as HTMLElement | undefined)?.getBoundingClientRect()
      if (!bounds) return point
      const position = chartTooltipPosition(
        { x: bounds.left + point[0], y: bounds.top + point[1] },
        { width: size.contentSize[0], height: size.contentSize[1] },
      )
      return [position.left - bounds.left, position.top - bounds.top]
    },
  }
})
const series = computed(() => {
  const visibleLabels = new Set(props.labelsVisible ? labelIndices.value : [])
  const models = new Map(
    props.points.flatMap((point) => point.models.map((model) => [model.id, model.name] as const)),
  )
  const values = props.points.map(
    (point) => new Map(point.models.map((model) => [model.id, model.value])),
  )
  const named = [...models]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, name]) => ({
      id: `model:${id}`,
      name,
      color: seriesColor(id),
      values: values.map((point) => point.get(id) || 0),
    }))
  if (props.points.some((point) => point.otherTokens > 0) || !named.length)
    named.push({
      id: 'remainder',
      name: localize('Other', '其他'),
      color: otherColor.value,
      values: props.points.map((point) => point.otherTokens),
    })
  const stacked = named.map((item) => ({
    id: item.id,
    name: item.name,
    type: 'bar',
    stack: 'tokens',
    data: props.points.map((point, index) => ({ id: point.key, value: item.values[index] })),
    barMaxWidth: props.mini ? 20 : 28,
    itemStyle: {
      color: item.color,
      opacity:
        mode.value === 'tonal'
          ? 0
          : hover?.series.value && hover.series.value !== item.id
            ? 0.18
            : 1,
    },
    emphasis: {
      focus: mode.value === 'categorical' ? 'series' : 'none',
      disabled: mode.value === 'tonal',
    },
    blur: { itemStyle: { opacity: 0.18 } },
  }))
  // Keep both geometries alive: one continuous tonal bar avoids antialiased stack seams,
  // while palette changes only swap paint and never replay a bar's growth from zero.
  return [
    ...stacked,
    {
      id: 'tonal-total',
      name: localize('Total tokens', 'Token 总量'),
      type: 'bar',
      data: props.points.map((point, index) => ({
        id: point.key,
        value: point.value,
        label: { show: visibleLabels.has(index) },
      })),
      barMaxWidth: props.mini ? 20 : 28,
      barGap: '-100%',
      z: 3,
      silent: true,
      itemStyle: {
        color: tokens.value[props.mini ? '--chart-quaternary' : '--chart-primary'],
        opacity: mode.value === 'tonal' ? 1 : 0,
      },
      label: {
        show: false,
        silent: true,
        position: 'top',
        distance: 5,
        color: tokens.value['--text'],
        opacity: 1,
        fontSize: props.mini ? 10 : 11,
        fontWeight: 600,
        minMargin: 6,
        formatter: ({ value }: { value?: unknown }) =>
          typeof value === 'number' && value > 0 ? formatNumber(value, { compact: true }) : '',
      },
      labelLayout: ({
        rect,
        labelRect,
      }: {
        rect: { x: number; width: number }
        labelRect: { width: number }
      }) => {
        const width = (plot.value?.$el as HTMLElement | undefined)?.clientWidth
        if (!width) return { hideOverlap: true }
        // Use the bar's center so repeated layouts never reuse a shifted label position.
        const center = rect.x + rect.width / 2
        const half = labelRect.width / 2
        return {
          hideOverlap: true,
          dx: Math.max(half, Math.min(width - half, center)) - center,
        }
      },
      emphasis: { disabled: true },
      tooltip: { show: false },
    },
  ]
})
const option = computed(() => ({
  grid: {
    left: props.mini ? 0 : 4,
    right: 0,
    top: props.mini ? 22 : 24,
    bottom: 0,
    containLabel: true,
  },
  tooltip: tooltip.value,
  xAxis: {
    type: 'category',
    data: props.points.map((point) =>
      props.weekday && point.key.length === 10
        ? weekdayLabel(point.key)
        : point.key.length > 7
          ? point.key.slice(5).replace('-', '/')
          : point.key,
    ),
    axisLabel: { color: tokens.value['--text-soft'], fontSize: 10, hideOverlap: true },
    axisTick: { show: false },
    axisLine: { show: false },
  },
  yAxis: {
    type: 'value',
    show: !props.mini,
    splitNumber: 4,
    axisLabel: {
      color: tokens.value['--text-soft'],
      fontSize: 11,
      formatter: (value: number) => formatNumber(value, { compact: true }),
    },
    splitLine: { lineStyle: { color: tokens.value['--border'], type: 'dotted' } },
  },
  series: series.value,
}))
</script>
<template>
  <WorkspaceChart
    ref="plot"
    :option="option"
    :label="label"
    :highlight="mode === 'categorical' ? hover?.series.value : undefined"
    @hover="changeHover"
    @layout="updateLabelLayout"
  />
</template>
