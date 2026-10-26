<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TooltipComponentOption } from 'echarts/components'
import type { UsageAnalytics } from '@shared/analytics'
import WorkspaceChart from '../base/WorkspaceChart.vue'
import SegmentedControl from '../base/SegmentedControl.vue'
import SelectControl from '../base/SelectControl.vue'
import TrendVisibilityLayers from './TrendVisibilityLayers.vue'
import type { LegendVisibilityState } from '../../composables/useLegendSelection'
import { useChartTheme } from '../../composables/useChartTheme'
import { useChartTokens } from '../../composables/useChartTokens'
import { useCostCurrency } from '../../composables/useCostCurrency'
import { useI18n } from '../../i18n/useI18n'
import { getAgentName } from '../../config/agents'
import { agentLogoUrl, modelLogoUrl } from '../../config/brand-logos'
import { formatNumber } from '../../utils/number-format'
import { modelSeriesColor } from '../../utils/model-series-color'
import {
  createChartTooltip,
  createChartComparisonTooltip,
  type ChartTooltipData,
} from '../../utils/chart-tooltip'
import '../../styles/chart-tooltip.css'
import {
  comparisonDay,
  trendPoints,
  trendSeriesValues,
  type AnalyticsMetric,
  type AnalyticsDimensionKey,
  type AnalyticsGranularity,
  type ComparisonMode,
} from '../../utils/analytics-trend'
const props = defineProps<{
  data: UsageAnalytics | null
  comparison: UsageAnalytics | null
  comparisonMode: ComparisonMode
}>()
const dimension = defineModel<AnalyticsDimensionKey>('dimension', { required: true })
const metric = defineModel<AnalyticsMetric>('metric', { required: true })
const granularity = defineModel<AnalyticsGranularity>('granularity', { required: true })
const hidden = defineModel<Record<string, string[]>>('hidden', { required: true })
const { label } = useI18n(),
  tokens = useChartTokens(),
  { currency, exchange } = useCostCurrency()
const { getChartText } = useChartTheme()
const highlighted = ref('')
const dimensions = computed(() => [
  { value: 'total', label: label('Overview', '总览') },
  { value: 'agents', label: label('By Agent', '按 Agent') },
  { value: 'models', label: label('By model', '按模型') },
])
const metrics = computed(() => [
  { value: 'tokens', label: 'Token' },
  { value: 'cost', label: label('Est. cost', '预估花费') },
  { value: 'calls', label: label('API calls', 'API 调用') },
  { value: 'turns', label: label('Turns', '对话次数') },
])
const named = computed(() =>
  dimension.value === 'total'
    ? []
    : props.data?.[dimension.value].slice(0, 5).map((item) => item.id) || [],
)
const legends = computed(() => [
  ...named.value.map((id, index) => ({
    id: `named:${id}`,
    name: dimension.value === 'agents' ? getAgentName(id) : id,
    logo: dimension.value === 'agents' ? agentLogoUrl(id) : modelLogoUrl(id),
    color:
      dimension.value === 'models'
        ? modelSeriesColor(id, tokens.value)
        : tokens.value[`--analytics-series-${index + 1}`],
  })),
  ...(dimension.value === 'total'
    ? []
    : [
        {
          id: 'other',
          name: label('Other', '其他'),
          logo: undefined,
          color: tokens.value['--chart-secondary'],
        },
      ]),
  {
    id: 'total',
    name:
      dimension.value === 'total' ? label('Current period', '当前时段') : label('Total', '总量'),
    logo: undefined,
    color: tokens.value['--chart-primary'],
  },
])
const shown = (id: string): boolean => !hidden.value[dimension.value]?.includes(id)
const visibilityState = computed<LegendVisibilityState>(() => {
  const visible = legends.value.filter((item) => shown(item.id)).length
  return visible === 0 ? 'none' : visible === legends.value.length ? 'all' : 'partial'
})
function toggleAll(): void {
  hidden.value = {
    ...hidden.value,
    [dimension.value]: visibilityState.value === 'all' ? legends.value.map((item) => item.id) : [],
  }
}
function toggle(id: string): void {
  const values = hidden.value[dimension.value] || []
  hidden.value = {
    ...hidden.value,
    [dimension.value]: values.includes(id)
      ? values.filter((value) => value !== id)
      : [...values, id],
  }
}
const dailyOnly = computed(
  () =>
    !!props.comparison &&
    (!props.data?.hourlyComplete ||
      !props.comparison.hourlyComplete ||
      props.data.from !== props.data.to ||
      props.comparison.from !== props.comparison.to),
)
const current = computed(() =>
  props.data ? trendPoints(props.data, granularity.value, dailyOnly.value) : [],
)
const previous = computed(() =>
  props.comparison ? trendPoints(props.comparison, granularity.value, dailyOnly.value) : [],
)
const comparisonKeys = computed(() => {
  const data = props.data,
    comparison = props.comparison
  if (!data || !comparison) return []
  return current.value.map((point, index) =>
    granularity.value === 'day' && !point.key.includes('T')
      ? comparisonDay(point.key, data, comparison, props.comparisonMode)
      : (previous.value[index]?.key ?? null),
  )
})
function tooltipDate(key: string | null | undefined): string {
  if (!key) return '—'
  const date = key.slice(0, 10)
  return key.includes('T') ? `${date} ${key.slice(-2)}:00` : date
}
const format = (value: unknown): string =>
  formatNumber(typeof value === 'number' ? value : null, {
    compact: true,
    ...(metric.value === 'cost' ? { currency: currency.value } : {}),
  })
const tooltip = computed<TooltipComponentOption>(() => {
  const valuesFor = (points: typeof current.value, id: string) =>
    trendSeriesValues(
      points,
      dimension.value,
      id,
      named.value,
      metric.value,
      currency.value,
      exchange.value.snapshot,
    )
  const currentTotals = valuesFor(current.value, 'total')
  const previousTotals = valuesFor(previous.value, 'total')
  const previousByDate = (values: Array<number | null>) =>
    new Map(previous.value.map((point, index) => [point.key, values[index]]))
  const comparisonTotals = previousByDate(previousTotals)
  const rows = legends.value
    .filter((legend) => legend.id !== 'total' && shown(legend.id))
    .map((legend) => ({
      ...legend,
      current: valuesFor(current.value, legend.id),
      comparison: previousByDate(valuesFor(previous.value, legend.id)),
    }))
  const summaryLabel =
    metric.value === 'tokens'
      ? label('Total tokens', 'Token 总量')
      : metric.value === 'cost'
        ? `${label('Est. cost', '预估花费')} · ${currency.value}`
        : metric.value === 'calls'
          ? label('API calls', 'API 调用')
          : label('Turns', '对话次数')
  return {
    trigger: 'axis',
    renderMode: 'html',
    confine: true,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    extraCssText: 'box-shadow:none;',
    transitionDuration: 0,
    hideDelay: 0,
    formatter: (params) => {
      const items = Array.isArray(params) ? params : [params]
      const index = items[0]?.dataIndex,
        key = current.value[index]?.key,
        comparisonKey = comparisonKeys.value[index]
      if (!key) return ''
      const visibleRows = rows.filter((row) => {
        const currentValue = row.current[index]
        if (!props.comparison) return currentValue !== 0
        const comparisonValue = comparisonKey ? row.comparison.get(comparisonKey) : null
        return currentValue !== 0 || comparisonValue !== 0
      })
      function column(prior: boolean): ChartTooltipData {
        return {
          title: tooltipDate(prior ? comparisonKey : key),
          subtitle: props.comparison
            ? prior
              ? label('Comparison period', '对比时段')
              : label('Current period', '当前时段')
            : undefined,
          summary: {
            label: summaryLabel,
            value: format(
              prior
                ? comparisonKey
                  ? comparisonTotals.get(comparisonKey)
                  : null
                : currentTotals[index],
            ),
          },
          rows: visibleRows.map((row) => ({
            label: row.name,
            value: format(
              prior
                ? comparisonKey
                  ? row.comparison.get(comparisonKey)
                  : null
                : row.current[index],
            ),
            color: row.color,
            iconUrl: row.logo,
          })),
        }
      }
      const element = props.comparison
        ? createChartComparisonTooltip(column(false), column(true))
        : createChartTooltip(column(false))
      element.classList.add('analytics-trend-tooltip')
      return element
    },
  }
})
const option = computed(() => {
  const series = legends.value
    .filter((item) => shown(item.id))
    .flatMap((item) => {
      const entries = [
        { points: current.value, prior: false },
        ...(props.comparison ? [{ points: previous.value, prior: true }] : []),
      ]
      return entries.map(({ points, prior }) => {
        const values = trendSeriesValues(
          points,
          dimension.value,
          item.id,
          named.value,
          metric.value,
          currency.value,
          exchange.value.snapshot,
        )
        const byDate = new Map(points.map((point, index) => [point.key, values[index]]))
        const aligned = prior
          ? comparisonKeys.value.map((key) => (key ? (byDate.get(key) ?? null) : null))
          : values
        return {
          id: prior ? `${item.id}:previous` : item.id,
          name: prior
            ? dimension.value === 'total'
              ? label('Comparison period', '对比时段')
              : `${item.name} · ${label('Comparison period', '对比时段')}`
            : item.name,
          type: 'line',
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 5,
          showSymbol: current.value.length === 1,
          connectNulls: false,
          data: current.value.map((point, index) => ({
            id: point.key,
            value: index < aligned.length ? aligned[index] : null,
          })),
          lineStyle: {
            color: item.color,
            width: prior ? 1.5 : 2.5,
            type: prior ? 'dashed' : 'solid',
            opacity: prior ? 0.5 : 1,
          },
          itemStyle: { color: item.color, opacity: prior ? 0.5 : 1 },
          emphasis: { focus: 'series' },
          z: item.id === 'total' ? 5 : 3,
        }
      })
    })
  return {
    grid: { left: 8, right: 12, top: 16, bottom: 0, containLabel: true },
    tooltip: tooltip.value,
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: current.value.map((point) =>
        point.key.includes('T')
          ? `${point.key.slice(-2)}:00`
          : point.key.length === 10
            ? point.key.slice(5).replace('-', '/')
            : point.key,
      ),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: tokens.value['--text-soft'], fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      splitNumber: 4,
      axisLabel: {
        ...getChartText('number'),
        color: tokens.value['--text-soft'],
        fontSize: 11,
        formatter: format,
      },
      splitLine: { lineStyle: { color: tokens.value['--border'], type: 'dotted' } },
    },
    series,
  }
})
</script>
<template>
  <section class="workspace-panel analytics-trend">
    <header>
      <h2>{{ label('Usage trend', '用量趋势') }}</h2>
      <SegmentedControl
        v-model="dimension"
        appearance="light"
        :options="dimensions"
        :label="label('Chart dimension', '曲线维度')"
      />
      <div class="trend-controls">
        <SegmentedControl
          v-model="metric"
          appearance="light"
          :options="metrics"
          :label="label('Chart metric', '曲线指标')"
        />
        <SelectControl
          v-model="granularity"
          :label="label('Time interval', '时间粒度')"
          :options="[
            { value: 'day', label: label('Daily', '按天') },
            { value: 'week', label: label('Weekly', '按周') },
            { value: 'month', label: label('Monthly', '按月') },
          ]"
        />
      </div>
    </header>
    <div class="trend-legend">
      <TrendVisibilityLayers :state="visibilityState" @toggle="toggleAll" />
      <span class="trend-legend-divider" aria-hidden="true" />
      <button
        v-for="item in legends"
        :key="item.id"
        type="button"
        class="trend-legend-item"
        :aria-pressed="shown(item.id)"
        :class="{ off: !shown(item.id) }"
        @click="toggle(item.id)"
        @mouseenter="highlighted = item.id"
        @mouseleave="highlighted = ''"
        @focus="highlighted = item.id"
        @blur="highlighted = ''"
      >
        <img v-if="item.logo" class="trend-legend-logo" :src="item.logo" alt="" />
        <i v-else :style="{ background: item.color }" />
        {{ item.name }}
      </button>
      <span v-if="comparison">
        <i class="previous-line" />
        {{ label('Dashed: comparison period', '虚线：对比时段') }}
      </span>
    </div>
    <div class="trend-plot">
      <WorkspaceChart
        :option="option"
        :highlight="highlighted"
        :label="label('Usage by time', '用量时间曲线')"
      />
    </div>
  </section>
</template>
<style scoped>
.analytics-trend {
  height: 336px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-color: var(--border);
  gap: 10px;
}
header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
h2 {
  white-space: nowrap;
}
.trend-controls {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}
.trend-legend {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 18px;
  min-height: 20px;
}
.trend-legend-divider {
  width: 1px;
  height: 14px;
  background: var(--border);
  margin-right: 1px;
}
.trend-legend-item,
.trend-legend > span:not(.trend-legend-divider) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--text-soft);
  font-size: 11px;
}
.trend-legend-item {
  cursor: pointer;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trend-legend-item.off {
  opacity: 0.4;
  text-decoration: line-through;
}
.trend-legend i {
  display: inline-block;
  flex: none;
  width: 20px;
  height: 2px;
}
.trend-legend-logo {
  flex: none;
  width: 14px;
  height: 14px;
  object-fit: contain;
  border-radius: 3px;
}
.previous-line {
  background: repeating-linear-gradient(to right, var(--text-soft) 0 4px, transparent 4px 7px);
}
.trend-plot {
  position: relative;
  flex: 1;
  min-height: 100px;
}
.trend-plot :deep(.workspace-chart) {
  position: absolute;
  inset: 0;
}
@media (max-width: 1350px) {
  .trend-controls {
    gap: 6px;
  }
  header {
    gap: 8px;
  }
  .analytics-trend {
    height: 360px;
  }
}
</style>
