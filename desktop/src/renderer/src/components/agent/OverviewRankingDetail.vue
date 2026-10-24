<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UsageAnalytics } from '@shared/analytics'
import WorkspaceChart from '../base/WorkspaceChart.vue'
import { usePageResource } from '../../composables/usePageResource'
import { useI18n } from '../../i18n/useI18n'
import { useChartTokens } from '../../composables/useChartTokens'
import { useChartColorMode } from '../../composables/useChartColorMode'
import { useVisibleNow } from '../../composables/useVisibleNow'
import { tokenBars } from '../../utils/analytics-display'
import { displayRecentActivity } from '../../utils/date-range'
import { formatNumber } from '../../utils/number-format'
import { modelSeriesColor } from '../../utils/model-series-color'
import { chartTooltipPosition, createChartTooltip } from '../../utils/chart-tooltip'
import { modelLogoUrl } from '../../config/brand-logos'
import '../../styles/chart-tooltip.css'

const props = defineProps<{
  usageId: string
  name: string
  kind: 'models' | 'agents'
  data: UsageAnalytics
  color: string
  max: number
  labelSpace: number
}>()
const { label } = useI18n()
const tokens = useChartTokens()
const { mode } = useChartColorMode()
const now = useVisibleNow()
const plot = ref<InstanceType<typeof WorkspaceChart> | null>(null)
const scoped = usePageResource(
  () => (props.kind === 'agents' ? [props.usageId, props.data] : null),
  async () =>
    props.kind === 'agents'
      ? window.api.getUsageAnalytics({
          from: props.data.from,
          to: props.data.to,
          agent: props.usageId,
        })
      : null,
  null as UsageAnalytics | null,
)
const hourly = computed(() => props.data.from === props.data.to)
const data = computed(() => (props.kind === 'agents' ? scoped.data.value : props.data))
const unavailable = computed(() => hourly.value && data.value && !data.value.hourlyComplete)
const points = computed(() =>
  unavailable.value
    ? []
    : tokenBars(
        data.value,
        props.kind === 'models' ? props.usageId : undefined,
        hourly.value ? 'hour' : 'day',
      ).filter((point) => point.value > 0),
)
const height = computed(() =>
  !data.value || unavailable.value || scoped.error.value || !points.value.length
    ? 88
    : points.value.length * 22,
)
const categories = computed(() => points.value.map((point) => point.key))
const option = computed(() => ({
  grid: { outerBoundsMode: 'none', top: 0, bottom: 0, left: 0, right: props.labelSpace },
  xAxis: {
    type: 'value',
    min: 0,
    max: props.max,
    splitNumber: 4,
    minInterval: 1,
    axisLabel: { show: false },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: {
      showMinLine: false,
      lineStyle: { color: tokens.value['--border'], opacity: 0.45 },
    },
  },
  yAxis: { type: 'category', inverse: true, data: categories.value, show: false },
  tooltip: {
    trigger: 'item',
    renderMode: 'html',
    appendTo: 'body',
    confine: false,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    extraCssText: 'box-shadow:none;z-index:1100;',
    transitionDuration: 0,
    hideDelay: 0,
    formatter: (params: { dataIndex?: number }) => {
      const point = points.value[params.dataIndex ?? -1]
      if (!point) return ''
      return createChartTooltip({
        title: point.title,
        summary: {
          label: label('Total tokens', 'Token 总量'),
          value: formatNumber(point.value, { compact: true }),
        },
        rows: [
          ...point.models.map((model) => ({
            label: model.name,
            value: formatNumber(model.value, { compact: true }),
            color:
              mode.value === 'categorical' ? modelSeriesColor(model.id, tokens.value) : props.color,
            iconUrl: modelLogoUrl(model.name) ?? modelLogoUrl(model.id),
          })),
          ...(point.otherTokens
            ? [
                {
                  label: label('Other', '其他'),
                  value: formatNumber(point.otherTokens, { compact: true }),
                  color: tokens.value['--analytics-series-other'],
                },
              ]
            : []),
        ],
      })
    },
    position: (
      point: number[],
      _params: unknown,
      _element: unknown,
      _rect: unknown,
      size: { contentSize: number[] },
    ) => {
      const bounds = (plot.value?.$el as HTMLElement | undefined)?.getBoundingClientRect()
      if (!bounds) return point
      const position = chartTooltipPosition(
        { x: bounds.left + point[0]!, y: bounds.top + point[1]! },
        { width: size.contentSize[0]!, height: size.contentSize[1]! },
      )
      return [position.left - bounds.left, position.top - bounds.top]
    },
  },
  series: [
    {
      id: 'detail-usage',
      type: 'bar',
      data: categories.value.map((key, index) => ({
        id: key,
        value: points.value[index]?.value ?? '-',
        label: { show: !!points.value[index] },
      })),
      barWidth: 13,
      itemStyle: { color: props.color, borderRadius: [0, 2, 2, 0] },
      label: {
        show: true,
        position: 'right',
        distance: 8,
        color: tokens.value['--text'],
        fontSize: 10,
        formatter: ({ value }: { value?: unknown }) =>
          typeof value === 'number' ? formatNumber(value, { compact: true }) : '',
      },
      emphasis: { disabled: true },
    },
  ],
}))
</script>
<template>
  <section
    class="ranking-detail"
    :style="{ height: `${height + 12}px` }"
    :data-usage-id="usageId"
    :data-granularity="hourly ? 'hour' : 'day'"
    :aria-label="label(`${name} usage trend`, `${name} 用量趋势`)"
    :aria-busy="kind === 'agents' && scoped.busy.value"
  >
    <p v-if="scoped.error.value" class="ranking-detail-status" role="alert">
      {{ label('Trend update failed', '趋势更新失败') }} ·
      <button type="button" class="workspace-link" @click="scoped.refresh()">
        {{ label('Retry', '重试') }}
      </button>
    </p>
    <p v-else-if="!data" class="ranking-detail-status" role="status">
      {{ label('Loading trend…', '正在读取趋势…') }}
    </p>
    <p v-else-if="unavailable" class="ranking-detail-status" role="status">
      {{ label('Hourly detail is unavailable for this data', '此数据暂无完整的小时明细') }}
    </p>
    <p v-else-if="!points.length" class="ranking-detail-status" role="status">
      {{ label('No usage in this period', '此区间暂无用量') }}
    </p>
    <template v-else>
      <div class="ranking-detail-dates">
        <span
          v-for="point in points"
          :key="point.key"
          class="ranking-detail-date"
          :title="point.title"
        >
          {{ hourly ? point.key : displayRecentActivity(point.key, new Date(now)) }}
        </span>
      </div>
      <div class="ranking-detail-plot" :style="{ height: `${points.length * 22}px` }">
        <WorkspaceChart
          ref="plot"
          :option="option"
          :label="label(`${name} usage trend`, `${name} 用量趋势`)"
        />
      </div>
    </template>
  </section>
</template>
<style scoped>
.ranking-detail {
  display: grid;
  grid-template-columns: minmax(0, var(--ranking-name-width)) minmax(0, 1fr);
  column-gap: 8px;
  min-width: 0;
  padding: 2px 12px 10px;
  transition: height var(--motion-detail) var(--motion-ease);
}
.ranking-detail-dates {
  grid-column: 1;
  position: relative;
  align-self: start;
}
.ranking-detail-date {
  position: relative;
  display: block;
  height: 22px;
  padding-right: 4px;
  text-align: right;
  font: 500 10px/22px var(--font-number);
  white-space: nowrap;
  color: var(--text-soft);
}
.ranking-detail-plot {
  grid-column: 2;
  min-height: 0;
  min-width: 0;
}
.ranking-detail-status {
  grid-column: 1 / -1;
  margin: auto;
  color: var(--text-soft);
  font-size: 12px;
}
@media (prefers-reduced-motion: reduce) {
  .ranking-detail {
    transition: none;
  }
}
</style>
