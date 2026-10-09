<script setup lang="ts">
import { visibleUsagePoints } from '../../utils/usage-trend'
/* eslint-disable max-lines */
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import * as echarts from '../../utils/charts'
import type { UsageTrendStats } from '@shared/models'
import { getAgentName } from '../../config/agents'
import { agentLogoUrl, modelLogoUrl } from '../../config/brand-logos'
import { useChartTokens } from '../../composables/useChartTokens'
import { useChartRenderLifecycle } from '../../composables/useChartRenderLifecycle'
import { chartMotion } from '../../config/motion'
import { TOTAL_SERIES_KEY, TOTAL_SERIES_LINE_TYPE } from '../../config/chart'
import { useChartTheme, escapeHtml } from '../../composables/useChartTheme'
import { useI18n } from '../../i18n/useI18n'
import type { LegendVisibilityState } from '../../composables/useLegendSelection'
import LegendVisibilityButton from '../base/LegendVisibilityButton.vue'
import ChartColorControl from '../base/ChartColorControl.vue'
import PointerTooltip from '../base/PointerTooltip.vue'
import { formatTokens } from '../../utils/format'
import { modelSeriesColor } from '../../utils/model-series-color'
import { chartTooltipPosition } from '../../utils/chart-tooltip'

interface Props {
  stats: UsageTrendStats
  groupBy: 'agent' | 'model'
  loading: boolean
}

interface TrendSeriesItem {
  key: string
  label: string
  color: string
  details?: string[]
}

type TrendPoint = UsageTrendStats['points'][number]

const props = defineProps<Props>()
const { currentLang, label } = useI18n()
const {
  currentTheme,
  currentInterfaceFont,
  currentNumberFont,
  getChartColors,
  getChartText,
  getAxisLine,
} = useChartTheme()
const chartRef = ref<HTMLElement | null>(null)
const tokens = useChartTokens()
const chartControls = ref(false)
const chartWidth = ref(560)
const hiddenSeries = ref(new Set<string>([TOTAL_SERIES_KEY]))
const zoomStart = ref(0)
const zoomEnd = ref(100)
const visibleSpanMs = ref(0)
const otherKey = '__other__'
const maxPrimarySeries = 2
const minuteMs = 60_000
const secondMs = 1000
const minMinuteTickSpacingPx = 96
const chartAxisReservedWidthPx = 48
const minimumAxisSegments = 3
const targetVisiblePointCount = 32
const bucketMinuteSteps = [
  1 / 60,
  5 / 60,
  15 / 60,
  30 / 60,
  1,
  2,
  5,
  10,
  15,
  30,
  60,
  120,
  360,
  720,
  1440,
] as const
let chart: echarts.ECharts | null = null
let renderedBucketMinutes = 1

const axisSplitNumber = computed(() =>
  Math.max(
    minimumAxisSegments,
    Math.floor(Math.max(0, chartWidth.value - chartAxisReservedWidthPx) / minMinuteTickSpacingPx),
  ),
)
const minimumVisibleSpanMs = computed(() => {
  const totalSpan = Math.max(1, props.stats.to - props.stats.from)
  return Math.min(totalSpan, axisSplitNumber.value * secondMs)
})

const orderedDimensions = computed(() =>
  Object.entries(props.stats.dimensionTotals)
    .filter(([, tokens]) => tokens > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name),
)

const primaryDimensions = computed(() => orderedDimensions.value.slice(0, maxPrimarySeries))
const hasOtherSeries = computed(() => orderedDimensions.value.length > maxPrimarySeries)
const otherDimensions = computed(() => orderedDimensions.value.slice(maxPrimarySeries))
const otherDimensionLabels = computed(() =>
  otherDimensions.value.map((key) => (props.groupBy === 'agent' ? getAgentName(key) : key)),
)
const otherDetailsHeading = computed(() =>
  props.groupBy === 'model'
    ? label('Included models', '包含模型')
    : label('Included Agents', '包含 Agent'),
)
const legendTooltipId = useId()
const legendPoint = ref<{ x: number; y: number } | null>(null)
const legendDetails = computed(() => ({
  title: otherDetailsHeading.value,
  rows: [],
  note: otherDimensionLabels.value.join(' · '),
}))
function showLegendDetails(event: MouseEvent | FocusEvent, item: TrendSeriesItem): void {
  if (!item.details?.length) return
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  legendPoint.value =
    event instanceof MouseEvent
      ? { x: event.clientX, y: event.clientY }
      : { x: bounds.left + bounds.width / 2, y: bounds.bottom }
}
watch(otherDimensionLabels, () => (legendPoint.value = null))
// Legend chips show the brand mark when one exists; the color dot remains the fallback.
const seriesLogo = (key: string): string | undefined =>
  key === TOTAL_SERIES_KEY || key === otherKey
    ? undefined
    : props.groupBy === 'agent'
      ? agentLogoUrl(key)
      : modelLogoUrl(key)
const seriesItems = computed<TrendSeriesItem[]>(() => {
  const colors = [tokens.value['--chart-primary'], tokens.value['--chart-secondary']]
  const items: TrendSeriesItem[] = primaryDimensions.value.map((key, index) => ({
    key,
    label: props.groupBy === 'agent' ? getAgentName(key) : key,
    color: props.groupBy === 'model' ? modelSeriesColor(key, tokens.value) : colors[index],
  }))
  items.unshift({
    key: TOTAL_SERIES_KEY,
    label: label('Total', '总量'),
    color: tokens.value['--chart-quaternary'],
  })
  if (hasOtherSeries.value)
    items.push({
      key: otherKey,
      label: label('Other', '其他'),
      color:
        props.groupBy === 'model'
          ? tokens.value['--analytics-series-other']
          : tokens.value['--chart-tertiary'],
      details: otherDimensionLabels.value,
    })
  return items
})

const seriesVisibilityState = computed<LegendVisibilityState>(() => {
  const itemCount = seriesItems.value.length
  if (itemCount === 0) return 'none'
  const visibleCount = seriesItems.value.filter((item) => !hiddenSeries.value.has(item.key)).length
  if (visibleCount === 0) return 'none'
  if (visibleCount === itemCount) return 'all'
  return 'partial'
})

function bucketMinutesForSpan(spanMs: number): number {
  const spanMinutes = Math.max(1 / 60, spanMs / minuteMs)
  return (
    bucketMinuteSteps.find((minutes) => spanMinutes / minutes <= targetVisiblePointCount) ??
    bucketMinuteSteps[bucketMinuteSteps.length - 1]
  )
}

const activeBucketMinutes = computed(() =>
  bucketMinutesForSpan(visibleSpanMs.value || props.stats.to - props.stats.from),
)
const displayedPoints = computed(() =>
  aggregateTrendPoints(props.stats.points, activeBucketMinutes.value),
)
const canContractRange = computed(
  () =>
    (visibleSpanMs.value || props.stats.to - props.stats.from) > minimumVisibleSpanMs.value * 1.01,
)
const contractRangeTitle = computed(() =>
  canContractRange.value
    ? label('Contract selected time range', '向中间收缩时间范围')
    : label('Minimum scale is 1 second', '已达到最小 1 秒刻度'),
)

function handleChartWheel(event: WheelEvent): void {
  const scrollDelta = event.deltaY !== 0 ? event.deltaY : event.deltaX
  if (scrollDelta >= 0 || canContractRange.value) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

const visibleResolution = computed(() => {
  const minutes = activeBucketMinutes.value
  if (minutes < 1)
    return label(
      `${Math.round(minutes * 60)}-second interval`,
      `${Math.round(minutes * 60)} 秒粒度`,
    )
  if (minutes < 60) return label(`${minutes}-minute interval`, `${minutes} 分钟粒度`)
  const hours = minutes / 60
  if (hours < 24) return label(`${hours}-hour interval`, `${hours} 小时粒度`)
  const days = hours / 24
  return label(`${days}-day interval`, `${days} 天粒度`)
})

const visibleRangeLabel = computed(() => {
  const total = Math.max(1, props.stats.to - props.stats.from)
  const from = props.stats.from + total * (zoomStart.value / 100)
  const to = props.stats.from + total * (zoomEnd.value / 100)
  const locale = currentLang.value === 'zh' ? 'zh-CN' : 'en'
  const options: Intl.DateTimeFormatOptions =
    to - from <= 24 * 60 * 60 * 1000
      ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
      : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
  const formatter = new Intl.DateTimeFormat(locale, options)
  return `${formatter.format(from)} – ${formatter.format(to)}`
})

function aggregateTrendPoints(points: TrendPoint[], bucketMinutes: number): TrendPoint[] {
  const span = props.stats.to - props.stats.from
  return visibleUsagePoints(points, {
    from: props.stats.from,
    to: props.stats.to,
    visibleFrom: props.stats.from + (span * zoomStart.value) / 100,
    visibleTo: props.stats.from + (span * zoomEnd.value) / 100,
    bucketMs: bucketMinutes * minuteMs,
  })
}

function seriesValue(point: UsageTrendStats['points'][number], key: string): number {
  if (key === TOTAL_SERIES_KEY) return point.totalTokens
  if (key !== otherKey) return point.dimensionTokens[key] || 0
  return orderedDimensions.value
    .slice(maxPrimarySeries)
    .reduce((sum, dimension) => sum + (point.dimensionTokens[dimension] || 0), 0)
}

function formatTime(value: number, withDate = false): string {
  const locale = currentLang.value === 'zh' ? 'zh-CN' : 'en'
  return new Intl.DateTimeFormat(locale, {
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: activeBucketMinutes.value < 1 ? '2-digit' : undefined,
    hour12: false,
  }).format(value)
}

function axisLabel(value: number): string {
  const span = visibleSpanMs.value || props.stats.to - props.stats.from
  if (span <= 36 * 60 * 60 * 1000) return formatTime(value)
  if (span <= 4 * 24 * 60 * 60 * 1000) return formatTime(value, true)
  return new Intl.DateTimeFormat(currentLang.value === 'zh' ? 'zh-CN' : 'en', {
    month: 'short',
    day: 'numeric',
  }).format(value)
}

function tooltipFormatter(rawParams: unknown): string {
  const params = Array.isArray(rawParams) ? rawParams : []
  const first = params[0] as Record<string, unknown> | undefined
  const firstValue = Array.isArray(first?.value) ? first.value : []
  const timestamp = Number(firstValue[0] ?? props.stats.from)
  const cc = getChartColors()
  let total = 0
  let html = `<div style="font-weight: var(--weight-semibold);margin-bottom:7px">${escapeHtml(formatTime(timestamp, true))}</div>`
  let totalSeriesRow = ''

  for (const rawItem of params) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as Record<string, unknown>
    const value = Array.isArray(item.value) ? Number(item.value[1]) || 0 : 0
    const isTotalSeries = item.seriesId === TOTAL_SERIES_KEY
    if (!isTotalSeries) {
      if (value <= 0) continue
      total += value
    }
    const row = `<div style="display:flex;justify-content:space-between;gap:16px;margin:3px 0"><span>${String(item.marker || '')} ${escapeHtml(String(item.seriesName || ''))}</span><b>${formatTokens(value)}</b></div>`
    if (isTotalSeries) totalSeriesRow += row
    else html += row
  }

  html += totalSeriesRow
  html += `<div style="border-top:1px solid ${cc.tooltipDivider};margin-top:7px;padding-top:7px;display:flex;justify-content:space-between;gap:16px"><span>${label('Total', '合计')}</span><b style="color:${cc.tooltipTotal}">${formatTokens(total)}</b></div>`
  return html
}

function minimumZoomPercent(): number {
  const totalSpan = Math.max(1, props.stats.to - props.stats.from)
  return Math.min(100, (minimumVisibleSpanMs.value / totalSpan) * 100)
}

function normalizeZoomRange(start: number, end: number): { start: number; end: number } {
  let safeStart = Math.max(0, Math.min(100, start))
  let safeEnd = Math.max(0, Math.min(100, end))
  if (safeEnd < safeStart) [safeStart, safeEnd] = [safeEnd, safeStart]
  const minWidth = minimumZoomPercent()
  if (safeEnd - safeStart >= minWidth) return { start: safeStart, end: safeEnd }

  const center = (safeStart + safeEnd) / 2
  safeStart = center - minWidth / 2
  safeEnd = center + minWidth / 2
  if (safeStart < 0) {
    safeEnd -= safeStart
    safeStart = 0
  }
  if (safeEnd > 100) {
    safeStart -= safeEnd - 100
    safeEnd = 100
  }
  return { start: Math.max(0, safeStart), end: Math.min(100, safeEnd) }
}

function updateVisibleSpan(): void {
  visibleSpanMs.value = Math.max(
    minimumVisibleSpanMs.value,
    (props.stats.to - props.stats.from) * ((zoomEnd.value - zoomStart.value) / 100),
  )
}

function buildSeries() {
  return seriesItems.value
    .filter((item) => !hiddenSeries.value.has(item.key))
    .map((item) => {
      const total = item.key === TOTAL_SERIES_KEY
      return {
        id: item.key,
        name: item.label,
        type: total ? 'line' : 'bar',
        stack: total ? undefined : 'tokens',
        data: displayedPoints.value.map((point) => ({
          // Rolling windows must match the same time bucket, not the array position.
          id:
            point.timestamp === props.stats.to
              ? 'range:end'
              : String(
                  point.timestamp === props.stats.from
                    ? Math.floor(point.timestamp / (activeBucketMinutes.value * minuteMs)) *
                        activeBucketMinutes.value *
                        minuteMs
                    : point.timestamp,
                ),
          value: [point.timestamp, seriesValue(point, item.key)],
        })),
        barMaxWidth: 9,
        barWidth: Math.max(3, Math.min(9, ((chartWidth.value - 24) / 32) * 0.65)),
        barMinHeight: 0,
        showSymbol: false,
        itemStyle: { color: item.color, borderRadius: total ? 0 : [3, 3, 0, 0] },
        ...(total
          ? { z: 6, lineStyle: { color: item.color, width: 1.5, type: TOTAL_SERIES_LINE_TYPE } }
          : {}),
        emphasis: { focus: 'series' },
      }
    })
}

function updateSeriesData(): void {
  if (!chart || renderedBucketMinutes === activeBucketMinutes.value) return
  renderedBucketMinutes = activeBucketMinutes.value
  chart.setOption({ series: buildSeries() }, { replaceMerge: ['series'], lazyUpdate: true })
}

function handleDataZoom(event: unknown): void {
  if (!event || typeof event !== 'object') return
  const previousBucketMinutes = activeBucketMinutes.value
  const record = event as Record<string, unknown>
  const batch = Array.isArray(record.batch) ? (record.batch[0] as Record<string, unknown>) : record
  const rawStart = Number(batch.start)
  const rawEnd = Number(batch.end)
  const normalized = normalizeZoomRange(
    Number.isFinite(rawStart) ? rawStart : zoomStart.value,
    Number.isFinite(rawEnd) ? rawEnd : zoomEnd.value,
  )
  const needsCorrection =
    !Number.isFinite(rawStart) ||
    !Number.isFinite(rawEnd) ||
    Math.abs(normalized.start - rawStart) > 0.000001 ||
    Math.abs(normalized.end - rawEnd) > 0.000001
  zoomStart.value = normalized.start
  zoomEnd.value = normalized.end
  updateVisibleSpan()
  if (needsCorrection && chart) {
    chart.dispatchAction({ type: 'dataZoom', start: normalized.start, end: normalized.end })
  }
  if (activeBucketMinutes.value !== previousBucketMinutes) void nextTick(updateSeriesData)
}

function clearSeriesEmphasis(): void {
  if (!chart || chart.isDisposed()) return
  chart.dispatchAction({ type: 'downplay' })
  chart.dispatchAction({ type: 'hideTip' })
}

function renderChart(): void {
  if (!chartRef.value || chartRef.value.clientWidth === 0) return
  chartWidth.value = chartRef.value.clientWidth
  const normalized = normalizeZoomRange(zoomStart.value, zoomEnd.value)
  zoomStart.value = normalized.start
  zoomEnd.value = normalized.end
  if (!chart) {
    chart = echarts.init(chartRef.value)
    chart.on('datazoom', handleDataZoom)
    chart.getZr().on('globalout', clearSeriesEmphasis)
  }
  const colors = getChartColors()
  const chartText = getChartText()
  updateVisibleSpan()
  const series = buildSeries()
  renderedBucketMinutes = activeBucketMinutes.value

  chart.setOption(
    {
      backgroundColor: 'transparent',
      ...chartMotion(reduced.value),
      grid: { top: 8, right: 12, bottom: chartControls.value ? 45 : 22, left: 12 },
      tooltip: {
        trigger: 'axis',
        renderMode: 'html',
        appendTo: 'body',
        className: 'floating-trend-tooltip',
        confine: false,
        enterable: false,
        transitionDuration: 0,
        hideDelay: 0,
        extraCssText:
          'max-width:calc(100vw - 24px);box-sizing:border-box;white-space:normal;overflow-wrap:anywhere;pointer-events:none;z-index:1100;',
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        textStyle: { ...chartText, color: colors.tooltipText, fontSize: 12 },
        padding: [8, 10],
        formatter: tooltipFormatter,
        position: (point, _params, _element, _rect, size) => {
          const bounds = chartRef.value?.getBoundingClientRect()
          if (!bounds) return point
          const position = chartTooltipPosition(
            { x: bounds.left + point[0], y: bounds.top + point[1] },
            { width: size.contentSize[0], height: size.contentSize[1] },
          )
          return [position.left - bounds.left, position.top - bounds.top]
        },
      },
      xAxis: {
        type: 'time',
        minInterval: secondMs,
        splitNumber: axisSplitNumber.value,
        min: props.stats.from,
        max: props.stats.to,
        boundaryGap: false,
        axisLabel: { ...chartText, fontSize: 10, hideOverlap: true, formatter: axisLabel },
        axisLine: getAxisLine(),
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: { type: 'value', show: false, minInterval: 1 },
      dataZoom: [
        {
          type: 'inside',
          start: zoomStart.value,
          end: zoomEnd.value,
          filterMode: 'none',
          minSpan: minimumZoomPercent(),
          minValueSpan: minimumVisibleSpanMs.value,
          zoomOnMouseWheel: true,
          moveOnMouseWheel: false,
          moveOnMouseMove: true,
        },
        {
          type: 'slider',
          start: zoomStart.value,
          end: zoomEnd.value,
          filterMode: 'none',
          minSpan: minimumZoomPercent(),
          minValueSpan: minimumVisibleSpanMs.value,
          show: chartControls.value,
          height: 16,
          bottom: 2,
          handleSize: 24,
          moveHandleSize: 10,
          borderColor: colors.axisLine,
          backgroundColor: 'transparent',
          fillerColor: tokens.value['--primary-soft'],
          handleStyle: {
            color: colors.tooltipTotal,
            borderColor: colors.tooltipTotal,
            borderWidth: 1.5,
          },
          dataBackground: {
            lineStyle: { color: colors.text, opacity: 0.28 },
            areaStyle: { color: colors.text, opacity: 0.06 },
          },
          selectedDataBackground: {
            lineStyle: { color: colors.tooltipTotal, opacity: 0.7 },
            areaStyle: { color: colors.tooltipTotal, opacity: 0.12 },
          },
          textStyle: { ...chartText, color: 'transparent' },
        },
      ],
      series,
    },
    { replaceMerge: ['series'] },
  )
  updateVisibleSpan()
}

function setZoom(start: number, end: number): void {
  const normalized = normalizeZoomRange(start, end)
  zoomStart.value = normalized.start
  zoomEnd.value = normalized.end
  chart?.dispatchAction({ type: 'dataZoom', start: normalized.start, end: normalized.end })
  updateVisibleSpan()
}

function zoom(factor: number): void {
  if (factor < 1 && !canContractRange.value) return
  const minimumWidth = minimumZoomPercent()
  const currentWidth = Math.max(zoomEnd.value - zoomStart.value, minimumWidth)
  const nextWidth = Math.max(minimumWidth, Math.min(100, currentWidth * factor))
  const center = (zoomStart.value + zoomEnd.value) / 2
  let start = center - nextWidth / 2
  let end = center + nextWidth / 2
  if (start < 0) {
    end -= start
    start = 0
  }
  if (end > 100) {
    start -= end - 100
    end = 100
  }
  setZoom(start, end)
}

function resetZoom(): void {
  setZoom(0, 100)
}

function handleChartResize(): void {
  if (!visible.value) return
  const nextWidth = chartRef.value?.clientWidth || 0
  if (nextWidth <= 0) return
  if (!chart) {
    renderChart()
    return
  }
  chart.resize()
  if (Math.abs(nextWidth - chartWidth.value) < 1) return

  const previousBucketMinutes = activeBucketMinutes.value
  chartWidth.value = nextWidth
  const normalized = normalizeZoomRange(zoomStart.value, zoomEnd.value)
  zoomStart.value = normalized.start
  zoomEnd.value = normalized.end
  updateVisibleSpan()
  chart.setOption({
    xAxis: { type: 'time', splitNumber: axisSplitNumber.value },
    dataZoom: [
      {
        type: 'inside',
        start: zoomStart.value,
        end: zoomEnd.value,
        minSpan: minimumZoomPercent(),
        minValueSpan: minimumVisibleSpanMs.value,
      },
      {
        type: 'slider',
        start: zoomStart.value,
        end: zoomEnd.value,
        minSpan: minimumZoomPercent(),
        minValueSpan: minimumVisibleSpanMs.value,
      },
    ],
  })
  if (activeBucketMinutes.value !== previousBucketMinutes) void nextTick(updateSeriesData)
}

function toggleSeries(key: string): void {
  const next = new Set(hiddenSeries.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  hiddenSeries.value = next
}

function toggleAllSeries(): void {
  hiddenSeries.value =
    seriesVisibilityState.value === 'all'
      ? new Set(seriesItems.value.map((item) => item.key))
      : new Set()
}

watch(
  () => [
    props.stats,
    currentTheme.value,
    currentLang.value,
    currentInterfaceFont.value,
    currentNumberFont.value,
    hiddenSeries.value,
    tokens.value,
    chartControls.value,
  ],
  () => requestRender(),
  { deep: false },
)

const groupState = new Map<string, { start: number; end: number; hidden: Set<string> }>()
watch(
  () => props.groupBy,
  (next, previous) => {
    groupState.set(previous, {
      start: zoomStart.value,
      end: zoomEnd.value,
      hidden: new Set(hiddenSeries.value),
    })
    const stored = groupState.get(next)
    hiddenSeries.value = stored?.hidden ?? new Set([TOTAL_SERIES_KEY])
    zoomStart.value = stored?.start ?? 0
    zoomEnd.value = stored?.end ?? 100
  },
)

function releaseChart(): void {
  if (chart) {
    chart.getZr().off('globalout', clearSeriesEmphasis)
    chart.dispose()
    chart = null
  }
}

const { requestRender, reduced, visible } = useChartRenderLifecycle(chartRef, {
  render: renderChart,
  resize: handleChartResize,
  chart: () => chart,
  dispose: releaseChart,
})

watch(visible, (shown) => {
  if (!shown) {
    clearSeriesEmphasis()
    legendPoint.value = null
  }
})

onMounted(() => {
  if (chartRef.value) {
    chartRef.value.addEventListener('wheel', handleChartWheel, { capture: true, passive: false })
    chartRef.value.addEventListener('mouseleave', clearSeriesEmphasis)
  }
})

onUnmounted(() => {
  chartRef.value?.removeEventListener('wheel', handleChartWheel, true)
  chartRef.value?.removeEventListener('mouseleave', clearSeriesEmphasis)
})
</script>

<template>
  <div class="trend-visual">
    <div class="floating-trend-plot" :class="{ 'floating-trend-plot--controls': chartControls }">
      <div
        ref="chartRef"
        class="floating-trend-canvas"
        role="img"
        :aria-label="label('Token usage by time', '各时段 Token 用量')"
      ></div>
      <div v-if="loading && stats.points.length === 0" class="chart-state">
        {{ label('Loading usage…', '正在加载用量…') }}
      </div>
      <div v-else-if="stats.totalTokens === 0" class="chart-state">
        {{ label('No Token usage in this range', '所选时间内暂无 Token 用量') }}
      </div>
      <div v-else-if="seriesVisibilityState === 'none'" class="chart-state">
        {{ label('All series are hidden', '已隐藏全部系列') }}
      </div>
    </div>
    <div class="trend-legend-row">
      <div class="trend-legend" :aria-label="label('Chart series', '图表系列')">
        <button
          v-for="item in seriesItems.filter((item) => item.key !== TOTAL_SERIES_KEY)"
          :key="item.key"
          class="legend-chip"
          :class="{ muted: hiddenSeries.has(item.key) }"
          :aria-pressed="!hiddenSeries.has(item.key)"
          :aria-describedby="item.details?.length && legendPoint ? legendTooltipId : undefined"
          @mouseenter="showLegendDetails($event, item)"
          @mousemove="showLegendDetails($event, item)"
          @mouseleave="legendPoint = null"
          @focus="showLegendDetails($event, item)"
          @blur="legendPoint = null"
          @click="toggleSeries(item.key)"
        >
          <template v-if="item.key !== TOTAL_SERIES_KEY">
            <img
              v-if="seriesLogo(item.key)"
              class="legend-logo"
              :src="seriesLogo(item.key)"
              alt=""
            />
            <i v-else :style="{ backgroundColor: item.color }"></i>
          </template>
          <i v-else :style="{ backgroundColor: item.color }"></i>
          <span class="legend-label">{{ item.label }}</span>
        </button>
      </div>
      <PointerTooltip
        :id="legendTooltipId"
        :content="legendDetails"
        :point="legendPoint"
        @dismiss="legendPoint = null"
      />
      <slot name="actions" />
      <button
        class="trend-controls-toggle"
        :aria-expanded="chartControls"
        :aria-label="label('Zoom and series controls', '缩放与图例控制')"
        @click="chartControls = !chartControls"
      >
        <span class="material-symbols-outlined">tune</span>
      </button>
    </div>
    <div v-if="chartControls" class="zoom-footer">
      <div class="zoom-copy">
        <span>{{ visibleResolution }}</span>
        <span>{{ visibleRangeLabel }}</span>
      </div>
      <div class="zoom-actions">
        <button
          :aria-pressed="!hiddenSeries.has(TOTAL_SERIES_KEY)"
          @click="toggleSeries(TOTAL_SERIES_KEY)"
        >
          {{ label('Total', '总量') }}
        </button>
        <LegendVisibilityButton :state="seriesVisibilityState" @toggle="toggleAllSeries" />
        <button
          :aria-label="label('Expand selected time range', '向两侧扩展时间范围')"
          @click="zoom(2)"
        >
          −
        </button>
        <button :aria-label="label('Reset zoom', '重置缩放')" @click="resetZoom">↺</button>
        <button
          :title="contractRangeTitle"
          :aria-label="contractRangeTitle"
          :disabled="!canContractRange"
          @click="zoom(0.5)"
        >
          +
        </button>
      </div>
      <div class="floating-chart-colors"><ChartColorControl /></div>
    </div>
  </div>
</template>
<style scoped src="./floating-trend.css"></style>
