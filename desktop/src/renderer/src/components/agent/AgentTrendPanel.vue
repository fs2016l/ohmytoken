<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useI18n } from '../../i18n/useI18n'
import { useLegendSelection } from '../../composables/useLegendSelection'
import { useChartRenderLifecycle } from '../../composables/useChartRenderLifecycle'
import LegendVisibilityButton from '../base/LegendVisibilityButton.vue'
import { getAxisValue, showEmpty, useChartTheme } from '../../composables/useChartTheme'
import { agentColors, agentNames } from '../../config/agents'
import { TOTAL_SERIES_COLOR, TOTAL_SERIES_KEY, TOTAL_SERIES_LINE_TYPE } from '../../config/chart'
import { formatTokens } from '../../utils/format'
import type { DailyStats, HourlyUsageStats } from '@shared/models'

interface Props {
  dailyStats: DailyStats[]
  hourlyAgentStats: HourlyUsageStats[]
  singleDayRange: boolean
  dateFrom: string
}

const props = defineProps<Props>()
const { label, tr } = useI18n()
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
const hourlyLabels = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)

function normalizeHourlyStats(rows: HourlyUsageStats[]): HourlyUsageStats[] {
  const byHour = new Map<number, HourlyUsageStats>()
  rows.forEach((row) => {
    if (Number.isFinite(row.hour) && row.hour >= 0 && row.hour <= 23) {
      byHour.set(Math.trunc(row.hour), row)
    }
  })

  return hourlyLabels.map((label, hour) => {
    const row = byHour.get(hour)
    return row ? { ...row, hour, label } : { hour, label, agentTokens: {}, totalTokens: 0 }
  })
}

function collectAgentTotals(rows: readonly (DailyStats | HourlyUsageStats)[]): Map<string, number> {
  const totals = new Map<string, number>()
  rows.forEach((row) => {
    Object.entries(row.agentTokens || {}).forEach(([agent, tokens]) => {
      const value = Number(tokens) || 0
      if (value > 0) totals.set(agent, (totals.get(agent) || 0) + value)
    })
  })
  return totals
}

const agentUsageTotals = computed(() => {
  const rows = props.singleDayRange ? props.hourlyAgentStats : props.dailyStats
  const totals = collectAgentTotals(rows)
  if (totals.size === 0 && props.singleDayRange) return collectAgentTotals(props.dailyStats)
  return totals
})

const dimensionLegendItems = computed(() =>
  [...agentUsageTotals.value.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([agent]) => agent),
)
const legendItems = computed(() => [TOTAL_SERIES_KEY, ...dimensionLegendItems.value])

const legend = useLegendSelection(legendItems)
const legendVisibilityState = legend.visibilityState

function legendLabel(key: string): string {
  return key === TOTAL_SERIES_KEY ? getTotalLabel() : agentNames[key] || key
}

function legendColor(key: string): string {
  return key === TOTAL_SERIES_KEY ? TOTAL_SERIES_COLOR : agentColors[key] || '#94a3b8'
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
  const todayMode = props.singleDayRange
  if (props.dailyStats.length === 0 && !todayMode) {
    if (chart) {
      chart.dispose()
      chart = null
    }
    showEmpty(chartRef.value, tr('noDailyData'))
    return
  }
  if (chartRef.value.clientWidth === 0) return
  if (chart) chart.dispose()
  chart = echarts.init(chartRef.value)
  if (legendItems.value.length > 0 && legendVisibilityState.value === 'none') {
    chart.dispose()
    chart = null
    showEmpty(chartRef.value, label('All agents are hidden.', '已隐藏全部 Agent。'))
    return
  }
  const cc = getChartColors()
  const chartText = getChartText()
  const axisLine = getAxisLine()
  const splitLine = getSplitLine()

  if (todayMode) {
    const hourlyStats = normalizeHourlyStats(props.hourlyAgentStats)
    const series = legendItems.value
      .filter((key) => legend.isSelected(key))
      .map((key) =>
        buildTrendSeries(
          key,
          hourlyStats.map((bucket) =>
            key === TOTAL_SERIES_KEY ? bucket.totalTokens : bucket.agentTokens?.[key] || 0,
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
        data: hourlyStats.map((d) => d.label),
        axisLabel: { ...chartText, fontSize: 12 },
        axisLine,
      },
      yAxis: {
        type: 'value',
        axisLabel: { ...chartText, formatter: (v: number) => formatTokens(v), fontSize: 12 },
        splitLine,
      },
      series,
    })
    return
  }

  const dates = props.dailyStats.map((d) => d.date)
  const series = legendItems.value
    .filter((key) => legend.isSelected(key))
    .map((key) =>
      buildTrendSeries(
        key,
        props.dailyStats.map((day) =>
          key === TOTAL_SERIES_KEY ? day.totalTokens : day.agentTokens?.[key] || 0,
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
      data: dates,
      axisLabel: { ...chartText, fontSize: 12 },
      axisLine,
    },
    yAxis: {
      type: 'value',
      axisLabel: { ...chartText, formatter: (v: number) => formatTokens(v), fontSize: 12 },
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
    props.dailyStats,
    props.hourlyAgentStats,
    props.singleDayRange,
    props.dateFrom,
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
  <article class="panel chart-panel trend-panel">
    <div class="panel-header with-token">
      <h3>{{ tr('usageTrend') }}</h3>
      <LegendVisibilityButton :state="legendVisibilityState" @toggle="legend.toggleAll" />
    </div>
    <div class="chart-legend">
      <button
        v-for="agent in legendItems"
        :key="agent"
        class="legend-item"
        :class="{ active: legend.isSelected(agent) }"
        type="button"
        @click="legend.toggle(agent)"
      >
        <span class="legend-dot" :style="{ backgroundColor: legendColor(agent) }"></span>
        <span>{{ legendLabel(agent) }}</span>
      </button>
    </div>
    <div class="chart-shell chart-shell-large">
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
  min-height: 360px;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border);
}

.panel-header h3 {
  margin: 0;
  color: var(--text);
  font-size: 24px;
  line-height: 32px;
  font-weight: var(--weight-semibold);
}

.panel-icon-btn {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  color: var(--text);
  background: transparent;
  border: 0;
  border-radius: 999px;
}

.panel-icon-btn:hover {
  background: var(--surface-container-high);
}

.panel-icon-btn .material-symbols-outlined {
  font-size: 18px;
}

.chart-legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 14px;
  min-height: 28px;
  margin: -8px 0 8px;
  padding-right: 16px;
}

.legend-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 8px;
  color: var(--text-soft);
  background: transparent;
  border: 0;
  font-size: 12px;
  font-weight: var(--weight-semibold);
  opacity: 1;
  cursor: pointer;
}

.legend-item.active {
  color: var(--text);
  opacity: 1;
}

.legend-item.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  border-radius: 999px;
  background: var(--primary);
}

.legend-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
}

.chart-shell {
  position: relative;
  width: 100%;
  min-height: 250px;
  flex: 1;
}

.chart-shell-large {
  min-height: 250px;
}

.chart {
  width: 100%;
  height: 282px;
}

:deep(.chart-empty) {
  position: absolute;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  color: var(--text-soft);
  font-size: 13px;
  text-align: center;
  pointer-events: none;
}

@media (max-width: 560px) {
  .chart {
    height: 280px;
  }
}
</style>
