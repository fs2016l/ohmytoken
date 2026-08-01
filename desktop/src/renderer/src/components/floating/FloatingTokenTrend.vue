<script setup lang="ts">
/* eslint-disable max-lines */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import type { UsageTrendStats } from '@shared/models'
import { agentColors, getAgentName, getModelColor } from '../../config/agents'
import { TOTAL_SERIES_COLOR, TOTAL_SERIES_KEY, TOTAL_SERIES_LINE_TYPE } from '../../config/chart'
import { useChartTheme, escapeHtml } from '../../composables/useChartTheme'
import { useI18n } from '../../i18n/useI18n'
import type { LegendVisibilityState } from '../../composables/useLegendSelection'
import LegendVisibilityButton from '../base/LegendVisibilityButton.vue'
import { formatTokens } from '../../utils/format'

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
  getSplitLine,
} = useChartTheme()
const chartRef = ref<HTMLElement>()
const chartWidth = ref(560)
const hiddenSeries = ref(new Set<string>())
const zoomStart = ref(0)
const zoomEnd = ref(100)
const visibleSpanMs = ref(0)
const otherKey = '__other__'
const maxPrimarySeries = 5
const minuteMs = 60_000
const minMinuteTickSpacingPx = 96
const chartAxisReservedWidthPx = 48
const minimumAxisSegments = 3
const targetVisiblePointCount = 120
const bucketMinuteSteps = [1, 2, 5, 10, 15, 30, 60, 120, 360, 720, 1440] as const
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null
let renderedBucketMinutes = 1

const axisSplitNumber = computed(() =>
  Math.max(
    minimumAxisSegments,
    Math.floor(Math.max(0, chartWidth.value - chartAxisReservedWidthPx) / minMinuteTickSpacingPx),
  ),
)
const minimumVisibleSpanMs = computed(() => {
  const totalSpan = Math.max(1, props.stats.to - props.stats.from)
  return Math.min(totalSpan, axisSplitNumber.value * minuteMs)
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
const modelColorOrder = computed(() => [
  ...primaryDimensions.value,
  ...(hasOtherSeries.value ? [otherKey] : []),
])

const seriesItems = computed<TrendSeriesItem[]>(() => {
  const items: TrendSeriesItem[] = primaryDimensions.value.map((key) => ({
    key,
    label: props.groupBy === 'agent' ? getAgentName(key) : key,
    color:
      props.groupBy === 'agent'
        ? agentColors[key] || '#94a3b8'
        : getModelColor(key, modelColorOrder.value),
  }))
  items.unshift({
    key: TOTAL_SERIES_KEY,
    label: label('Total', '总量'),
    color: TOTAL_SERIES_COLOR,
  })
  if (hasOtherSeries.value) {
    items.push({
      key: otherKey,
      label: label('Other', '其他'),
      color: '#94a3b8',
      details: otherDimensionLabels.value,
    })
  }
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
  const spanMinutes = Math.max(1, spanMs / minuteMs)
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
    : label('Minimum scale is 1 minute', '已达到最小 1 分钟刻度'),
)

function handleChartWheel(event: WheelEvent): void {
  const scrollDelta = event.deltaY !== 0 ? event.deltaY : event.deltaX
  if (scrollDelta >= 0 || canContractRange.value) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

const visibleResolution = computed(() => {
  const minutes = activeBucketMinutes.value
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
      ? { hour: '2-digit', minute: '2-digit', hour12: false }
      : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
  const formatter = new Intl.DateTimeFormat(locale, options)
  return `${formatter.format(from)} – ${formatter.format(to)}`
})

function aggregateTrendPoints(points: TrendPoint[], bucketMinutes: number): TrendPoint[] {
  const bucketMs = Math.max(1, bucketMinutes) * minuteMs
  if (bucketMs === minuteMs) return points
  const buckets = new Map<number, TrendPoint>()

  for (const point of points) {
    const bucketStart = Math.floor(point.timestamp / bucketMs) * bucketMs
    const aggregate = buckets.get(bucketStart) ?? {
      timestamp: Math.max(props.stats.from, bucketStart),
      dimensionTokens: {},
      totalTokens: 0,
    }
    aggregate.totalTokens += point.totalTokens
    for (const [dimension, tokens] of Object.entries(point.dimensionTokens)) {
      aggregate.dimensionTokens[dimension] = (aggregate.dimensionTokens[dimension] || 0) + tokens
    }
    buckets.set(bucketStart, aggregate)
  }

  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp)
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
  const enabledSeries = seriesItems.value.filter((item) => !hiddenSeries.value.has(item.key))
  return enabledSeries.map((item) => {
    const isTotal = item.key === TOTAL_SERIES_KEY
    return {
      id: item.key,
      name: item.label,
      type: 'line' as const,
      data: displayedPoints.value.map((point) => [point.timestamp, seriesValue(point, item.key)]),
      showSymbol: false,
      smooth: 0.22,
      sampling: 'lttb' as const,
      animation: false,
      lineStyle: {
        width: isTotal ? 2.8 : 1.8,
        color: item.color,
        ...(isTotal ? { type: TOTAL_SERIES_LINE_TYPE } : {}),
      },
      itemStyle: { color: item.color },
      ...(isTotal
        ? { z: 6 }
        : { areaStyle: { color: item.color, opacity: enabledSeries.length === 1 ? 0.14 : 0.045 } }),
      emphasis: {
        focus: 'series' as const,
        lineStyle: {
          width: isTotal ? 3.4 : 2.6,
          ...(isTotal ? { type: TOTAL_SERIES_LINE_TYPE } : {}),
        },
      },
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
  if (chart) {
    chart.getZr().off('globalout', clearSeriesEmphasis)
    chart.dispose()
  }
  chart = echarts.init(chartRef.value)
  chart.on('datazoom', handleDataZoom)
  chart.getZr().on('globalout', clearSeriesEmphasis)
  const colors = getChartColors()
  const chartText = getChartText()
  updateVisibleSpan()
  const series = buildSeries()
  renderedBucketMinutes = activeBucketMinutes.value

  chart.setOption({
    backgroundColor: 'transparent',
    animation: false,
    grid: { top: 10, right: 8, bottom: 72, left: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: colors.tooltipBg,
      borderColor: colors.tooltipBorder,
      textStyle: { ...chartText, color: colors.tooltipText, fontSize: 12 },
      padding: [8, 10],
      formatter: tooltipFormatter,
    },
    xAxis: {
      type: 'time',
      minInterval: minuteMs,
      splitNumber: axisSplitNumber.value,
      min: props.stats.from,
      max: props.stats.to,
      boundaryGap: false,
      axisLabel: { ...chartText, fontSize: 12, hideOverlap: true, formatter: axisLabel },
      axisLine: getAxisLine(),
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { ...chartText, fontSize: 12, formatter: (value: number) => formatTokens(value) },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: getSplitLine(),
    },
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
        height: 28,
        bottom: 14,
        handleSize: 24,
        moveHandleSize: 10,
        borderColor: colors.axisLine,
        backgroundColor: 'transparent',
        fillerColor:
          currentTheme.value === 'light' ? 'rgba(103,88,217,.12)' : 'rgba(139,128,249,.13)',
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
  })
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
  ],
  () => void nextTick(renderChart),
  { deep: false },
)

watch(
  () => props.groupBy,
  () => {
    hiddenSeries.value = new Set()
    zoomStart.value = 0
    zoomEnd.value = 100
  },
)

onMounted(() => {
  void nextTick(renderChart)
  if (chartRef.value) {
    chartRef.value.addEventListener('wheel', handleChartWheel, { capture: true, passive: false })
    chartRef.value.addEventListener('mouseleave', clearSeriesEmphasis)
    resizeObserver = new ResizeObserver(handleChartResize)
    resizeObserver.observe(chartRef.value)
  }
})

onUnmounted(() => {
  chartRef.value?.removeEventListener('wheel', handleChartWheel, true)
  chartRef.value?.removeEventListener('mouseleave', clearSeriesEmphasis)
  resizeObserver?.disconnect()
  if (chart) {
    chart.getZr().off('globalout', clearSeriesEmphasis)
    chart.dispose()
  }
})
</script>

<template>
  <div class="trend-visual">
    <div class="trend-legend-row">
      <div class="trend-legend" role="list" :aria-label="label('Chart series', '图表系列')">
        <button
          v-for="item in seriesItems"
          :key="item.key"
          class="legend-chip"
          :class="{ muted: hiddenSeries.has(item.key) }"
          type="button"
          role="listitem"
          @click="toggleSeries(item.key)"
        >
          <i :style="{ backgroundColor: item.color }"></i>
          <span class="legend-label">{{ item.label }}</span>
          <span v-if="item.details?.length" class="legend-details" role="tooltip">
            <strong>{{ otherDetailsHeading }}</strong>
            <span>{{ item.details.join(' · ') }}</span>
          </span>
        </button>
      </div>
      <LegendVisibilityButton
        v-if="seriesItems.length > 0"
        class="trend-visibility-button"
        :state="seriesVisibilityState"
        @toggle="toggleAllSeries"
      />
    </div>

    <div class="chart-shell">
      <div ref="chartRef" class="chart"></div>
      <div v-if="loading && stats.points.length === 0" class="chart-state chart-state--loading">
        <span></span>
        {{ label('Loading minute data...', '正在加载分钟数据...') }}
      </div>
      <div v-else-if="stats.totalTokens === 0" class="chart-state">
        <strong>{{ label('No Token usage in this range', '所选时间内暂无 Token 用量') }}</strong>
        <span>
          {{
            label(
              'Try a longer range or refresh after using an Agent',
              '可扩大时间范围，或使用 Agent 后刷新',
            )
          }}
        </span>
      </div>
      <div v-else-if="seriesVisibilityState === 'none'" class="chart-state">
        <strong>{{ label('All series are hidden', '已隐藏全部系列') }}</strong>
        <span>
          {{
            label('Use the eye button or select a series to show it', '点击眼睛或选择系列即可显示')
          }}
        </span>
      </div>
    </div>

    <footer class="zoom-footer">
      <div class="viewport-copy">
        <strong>{{ visibleResolution }}</strong>
        <span>{{ visibleRangeLabel }}</span>
      </div>
      <div class="zoom-actions">
        <button
          type="button"
          :title="label('Expand selected time range', '向两侧扩展时间范围')"
          :aria-label="label('Expand selected time range', '向两侧扩展时间范围')"
          @click="zoom(2)"
        >
          <svg
            class="range-action-icon"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M9 10H3m0 0 3-3m-3 3 3 3M11 10h6m0 0-3-3m3 3-3 3" />
          </svg>
        </button>
        <button
          type="button"
          :title="label('Reset zoom', '重置缩放')"
          :aria-label="label('Reset zoom', '重置缩放')"
          @click="resetZoom"
        >
          ↺
        </button>
        <button
          type="button"
          :title="contractRangeTitle"
          :aria-label="contractRangeTitle"
          :disabled="!canContractRange"
          @click="zoom(0.5)"
        >
          <svg
            class="range-action-icon"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 10h6m0 0L6 7m3 3-3 3M17 10h-6m0 0 3-3m-3 3 3 3" />
          </svg>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.trend-visual {
  min-width: 0;
}
.trend-legend-row {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 5px;
}

.trend-legend {
  min-height: 29px;
  min-width: 0;
  flex: 1;
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  padding: 0 2px 5px;
  scrollbar-width: none;
}
.trend-legend::-webkit-scrollbar {
  display: none;
}
.trend-visibility-button {
  width: 28px;
  height: 26px;
  margin-right: 2px;
}

.legend-chip {
  position: relative;
  flex: 0 0 auto;
  max-width: 160px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  color: var(--text-muted);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: var(--type-caption);
  cursor: pointer;
  transition:
    opacity 0.15s ease,
    border-color 0.15s ease;
}
.legend-chip:hover {
  border-color: var(--border-strong);
}
.legend-chip.muted {
  opacity: 0.38;
}
.legend-chip i {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
}
.legend-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.legend-details {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 8;
  width: max-content;
  max-width: min(300px, calc(100vw - 44px));
  padding: 8px 10px;
  color: var(--text);
  background: var(--surface-container-high);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
  text-align: left;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-3px);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
  pointer-events: none;
}
.legend-details strong {
  display: block;
  margin-bottom: 3px;
  color: var(--primary);
}
.legend-details span {
  display: block;
  overflow: visible;
  white-space: normal;
  text-overflow: clip;
  overflow-wrap: anywhere;
}
.legend-chip:hover .legend-details,
.legend-chip:focus-visible .legend-details {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

.chart-shell {
  position: relative;
  height: 242px;
  min-height: 214px;
  overflow: hidden;
}
.chart {
  width: 100%;
  height: 100%;
}
.chart-state {
  position: absolute;
  inset: 20px 18px 56px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: var(--text-muted);
  background: color-mix(in srgb, var(--surface-low) 88%, transparent);
  border-radius: 10px;
  text-align: center;
  pointer-events: none;
}
.chart-state strong {
  color: var(--text-muted);
  font-size: 12px;
}
.chart-state span {
  max-width: 250px;
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
}
.chart-state--loading span:first-child {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: trend-spin 0.8s linear infinite;
}
@keyframes trend-spin {
  to {
    transform: rotate(360deg);
  }
}
.zoom-footer {
  position: relative;
  z-index: 2;
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  padding: 7px 2px 0;
  background: var(--surface-low);
  border-top: 1px solid var(--border);
}
.viewport-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.viewport-copy strong {
  flex: 0 0 auto;
  color: var(--primary);
  font-size: var(--type-caption);
}
.viewport-copy span {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zoom-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 3px;
}
.zoom-actions button {
  width: 30px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--text-muted);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 7px;
  font-size: 13px;
  cursor: pointer;
}
.range-action-icon {
  width: 18px;
  height: 18px;
  pointer-events: none;
}
.zoom-actions button:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.zoom-actions button:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border-strong);
  background: var(--surface-container-high);
}
.zoom-actions button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--primary) 70%, transparent);
  outline-offset: 1px;
}
</style>
