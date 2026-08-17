<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import * as echarts from 'echarts'
import type { ProjectUsageOverview } from '@shared/models'
import { useI18n } from '../../i18n/useI18n'
import { useChartRenderLifecycle } from '../../composables/useChartRenderLifecycle'
import { useLegendSelection } from '../../composables/useLegendSelection'
import { getAxisValue, showEmpty, useChartTheme } from '../../composables/useChartTheme'
import { TOTAL_SERIES_COLOR, TOTAL_SERIES_KEY, TOTAL_SERIES_LINE_TYPE } from '../../config/chart'
import { formatTokens } from '../../utils/format'
import LegendVisibilityButton from '../base/LegendVisibilityButton.vue'

const props = defineProps<{ overview: ProjectUsageOverview; singleDayRange: boolean }>()
const PROJECT_COLORS = ['#8b5cf6', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#e879f9', '#818cf8']
const { tr } = useI18n()
const {
  currentLang,
  currentTheme,
  currentInterfaceFont,
  currentNumberFont,
  getChartColors,
  getChartText,
  getAxisLine,
  getSplitLine,
  getTotalLabel,
  makeTooltipFormatter,
} = useChartTheme()
const chartRef = ref<HTMLElement>()
let chart: echarts.ECharts | null = null

const projectsWithData = computed(() =>
  props.overview.projects.filter((project) => project.totalTokens > 0),
)
const legendItems = computed(() => [
  TOTAL_SERIES_KEY,
  ...projectsWithData.value.map((project) => project.projectId),
])
const legend = useLegendSelection(legendItems)
const legendVisibilityState = legend.visibilityState

function projectColor(projectId: string): string {
  const index = props.overview.projects.findIndex((project) => project.projectId === projectId)
  return PROJECT_COLORS[(index < 0 ? 0 : index) % PROJECT_COLORS.length]
}

function projectName(projectId: string): string {
  return (
    props.overview.projects.find((project) => project.projectId === projectId)?.name || projectId
  )
}

function legendLabel(key: string): string {
  return key === TOTAL_SERIES_KEY ? getTotalLabel() : projectName(key)
}

function legendColor(key: string): string {
  return key === TOTAL_SERIES_KEY ? TOTAL_SERIES_COLOR : projectColor(key)
}

function buildTrendSeries(key: string, data: number[]) {
  const isTotal = key === TOTAL_SERIES_KEY
  const color = legendColor(key)
  return {
    id: key,
    name: legendLabel(key),
    type: 'line' as const,
    smooth: true,
    symbol: 'none',
    symbolSize: 4,
    data,
    lineStyle: {
      width: isTotal ? 2.8 : 2,
      color,
      ...(isTotal ? { type: TOTAL_SERIES_LINE_TYPE } : {}),
    },
    itemStyle: { color },
    ...(isTotal ? { z: 6 } : { areaStyle: { opacity: 0.12, color } }),
    emphasis: { focus: 'series' as const },
  }
}

function renderChart(): void {
  if (!chartRef.value) return
  showEmpty(chartRef.value, null)
  chart?.dispose()
  chart = null
  if (chartRef.value.clientWidth === 0) return

  const points = props.singleDayRange ? props.overview.hourly : props.overview.daily
  if (projectsWithData.value.length === 0 || points.length === 0) {
    showEmpty(
      chartRef.value,
      props.overview.projects.length === 0 ? tr('noProjects') : tr('noProjectData'),
    )
    return
  }

  const visibleKeys = legendItems.value.filter((key) => legend.isSelected(key))
  if (visibleKeys.length === 0) {
    showEmpty(chartRef.value, tr('allProjectsHidden'))
    return
  }

  chart = echarts.init(chartRef.value)
  const cc = getChartColors()
  const chartText = getChartText()
  const axisLine = getAxisLine()
  const splitLine = getSplitLine()
  const axisLabels = points.map((point) => ('label' in point ? point.label : point.date))
  const series = visibleKeys.map((key) =>
    buildTrendSeries(
      key,
      points.map((point) =>
        key === TOTAL_SERIES_KEY ? point.totalTokens : point.projectTokens[key] || 0,
      ),
    ),
  )
  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: cc.tooltipBg,
      borderColor: cc.tooltipBorder,
      textStyle: { ...chartText, color: cc.tooltipText, fontSize: 12 },
      padding: [10, 12],
      formatter: (params: unknown) =>
        makeTooltipFormatter(getAxisValue(params), params, { totalSeriesId: TOTAL_SERIES_KEY }),
    },
    legend: { show: false },
    grid: { top: 24, bottom: 34, left: 58, right: 40, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: axisLabels,
      axisLabel: { ...chartText, fontSize: 12 },
      axisLine,
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        ...chartText,
        formatter: (value: number) => formatTokens(value),
        fontSize: 12,
      },
      splitLine,
    },
    series,
  })
}

const { requestRender } = useChartRenderLifecycle(chartRef, {
  render: renderChart,
  resize: () => chart?.resize(),
  dispose: () => {
    chart?.dispose()
    chart = null
  },
})

watch(
  () => [
    props.overview,
    props.singleDayRange,
    legend.selected.value,
    currentTheme.value,
    currentLang.value,
    currentInterfaceFont.value,
    currentNumberFont.value,
  ],
  requestRender,
  { deep: true },
)
</script>

<template>
  <article class="panel chart-panel">
    <div class="panel-header">
      <h3>{{ tr('projectUsageTrend') }}</h3>
      <LegendVisibilityButton :state="legendVisibilityState" @toggle="legend.toggleAll" />
    </div>
    <div class="chart-legend">
      <button
        v-for="key in legendItems"
        :key="key"
        class="legend-item"
        :class="{ active: legend.isSelected(key) }"
        type="button"
        @click="legend.toggle(key)"
      >
        <span class="legend-dot" :style="{ backgroundColor: legendColor(key) }"></span>
        <span>{{ legendLabel(key) }}</span>
      </button>
    </div>
    <div class="chart-shell">
      <div ref="chartRef" class="chart"></div>
    </div>
  </article>
</template>

<style scoped>
.panel {
  min-width: 0;
  padding: 16px;
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
}
.chart-panel {
  min-height: 420px;
  display: flex;
  flex-direction: column;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.panel-header h3 {
  margin: 0;
  color: var(--text);
  font-size: 24px;
  line-height: 32px;
  font-weight: var(--weight-semibold);
}
.chart-legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 14px;
  min-height: 28px;
  margin: -4px 0 6px;
  padding-right: 10px;
}
.legend-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 7px;
  color: var(--text-soft);
  background: transparent;
  border: 0;
  font-size: 12px;
  font-weight: var(--weight-semibold);
}
.legend-item.active {
  color: var(--text);
}
.legend-item.active::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: 2px;
  background: var(--primary);
  border-radius: 999px;
}
.legend-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
}
.chart-shell {
  position: relative;
  min-height: 250px;
  flex: 1;
}
.chart {
  width: 100%;
  height: 282px;
}
:deep(.chart-empty) {
  position: absolute;
  inset: 50% auto auto 50%;
  width: min(320px, 80%);
  transform: translate(-50%, -50%);
  color: var(--text-soft);
  font-size: 13px;
  text-align: center;
}
</style>
