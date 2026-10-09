<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TooltipComponentOption } from 'echarts/components'
import type { UsageAnalytics } from '@shared/analytics'
import WorkspaceChart from '../base/WorkspaceChart.vue'
import SegmentedControl from '../base/SegmentedControl.vue'
import SelectControl from '../base/SelectControl.vue'
import TrendVisibilityLayers from './TrendVisibilityLayers.vue'
import type { LegendVisibilityState } from '../../composables/useLegendSelection'
import { useChartTokens } from '../../composables/useChartTokens'
import { useCostCurrency } from '../../composables/useCostCurrency'
import { useI18n } from '../../i18n/useI18n'
import { getAgentName } from '../../config/agents'
import { agentLogoUrl, modelLogoUrl } from '../../config/brand-logos'
import { formatNumber } from '../../utils/number-format'
import { modelSeriesColor } from '../../utils/model-series-color'
import { createChartTooltip } from '../../utils/chart-tooltip'
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
function tooltipDate(key: string | null | undefined, fullYear: boolean): string {
  if (!key) return '—'
  if (key.length === 7) return key.replace('-', '/')
  const date = key.slice(fullYear ? 0 : 5, 10).replaceAll('-', '/')
  return key.includes('T') ? `${date} ${key.slice(-2)}:00` : date
}
const format = (value: unknown): string =>
  formatNumber(typeof value === 'number' ? value : null, {
    compact: true,
    ...(metric.value === 'cost' ? { currency: currency.value } : {}),
  })
const tooltip = computed<TooltipComponentOption>(() => ({
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
    const fullYear =
      (!!comparisonKey && key.slice(0, 4) !== comparisonKey.slice(0, 4)) ||
      props.data?.from.slice(0, 4) !== props.data?.to.slice(0, 4)
    const element = createChartTooltip({
      rows: items.map((item) => {
        const id = String(item.seriesId),
          prior = id.endsWith(':previous'),
          name = legends.value.find((legend) => legend.id === id.replace(/:previous$/, ''))?.name
        const date = tooltipDate(prior ? comparisonKey : key, fullYear)
        return {
          label: dimension.value === 'total' || !name ? date : `${name} · ${date}`,
          value: format(item.value),
          color: typeof item.color === 'string' ? item.color : undefined,
        }
      }),
    })
    element.classList.add('analytics-trend-tooltip')
    return element
  },
}))
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
      axisLabel: { color: tokens.value['--text-soft'], fontSize: 11, formatter: format },
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
:deep(.analytics-trend-tooltip) {
  min-width: 0;
  padding: 6px 10px;
  border-color: var(--border);
  border-radius: 4px;
}
:deep(.analytics-trend-tooltip .chart-tooltip-value) {
  font-weight: 600;
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
