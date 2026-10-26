<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AnalyticsDimension, UsageAnalytics } from '@shared/analytics'
import WorkspaceChart from '../base/WorkspaceChart.vue'
import AgentMark from '../base/AgentMark.vue'
import ModelMark from '../base/ModelMark.vue'
import { useI18n } from '../../i18n/useI18n'
import { useChartTheme } from '../../composables/useChartTheme'
import { useChartTokens } from '../../composables/useChartTokens'
import { useChartColorMode } from '../../composables/useChartColorMode'
import { getAgentName } from '../../config/agents'
import { formatNumber } from '../../utils/number-format'
import { modelSeriesColor } from '../../utils/model-series-color'
import { chartTooltipPosition, createChartTooltip } from '../../utils/chart-tooltip'
import { agentLogoUrl, modelLogoUrl } from '../../config/brand-logos'
import '../../styles/chart-tooltip.css'

const props = defineProps<{
  items: Array<AnalyticsDimension & { color: string }>
  kind: 'models' | 'agents'
  data: UsageAnalytics
  expandedId: string | null
  joinedId: string | null
  detailIdPrefix: string
  rowHeight: number
  rowGap: number
  max: number
  labelSpace: number
}>()
const emit = defineEmits<{ toggle: [id: string] }>()
const { label } = useI18n()
const tokens = useChartTokens()
const { getChartText } = useChartTheme()
const { mode } = useChartColorMode()
const plot = ref<InstanceType<typeof WorkspaceChart> | null>(null)
const hoveredId = ref<string | null>(null)
const height = computed(() => props.items.length * (props.rowHeight + props.rowGap) - props.rowGap)
const option = computed(() => ({
  grid: {
    outerBoundsMode: 'none',
    // Half a gutter outside each edge keeps category centers aligned with the padded rows.
    top: -props.rowGap / 2,
    bottom: -props.rowGap / 2,
    left: 0,
    right: props.labelSpace,
  },
  xAxis: {
    type: 'value',
    min: 0,
    max: props.max,
    splitNumber: 4,
    minInterval: 1,
    axisLabel: {
      show: false,
    },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: {
      showMinLine: false,
      lineStyle: { color: tokens.value['--border'], opacity: 0.45 },
    },
  },
  yAxis: {
    type: 'category',
    inverse: true,
    data: props.items.map((row) => row.id),
    axisLabel: { show: false },
    axisLine: { show: false },
    axisTick: { show: false },
  },
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
      const row = props.items[params.dataIndex ?? -1]
      if (!row) return ''
      const sources =
        props.kind === 'agents'
          ? props.data.models.flatMap((model) => {
              const source = props.data.modelAgents[model.id]?.find((item) => item.id === row.id)
              return source
                ? [
                    {
                      ...source,
                      id: model.id,
                      name: model.name,
                      iconUrl: modelLogoUrl(model.name) ?? modelLogoUrl(model.id),
                    },
                  ]
                : []
            })
          : (props.data.modelAgents[row.id] || []).map((source) => ({
              ...source,
              name: getAgentName(source.id),
              iconUrl: agentLogoUrl(source.id),
            }))
      sources.sort((a, b) => b.totalTokens - a.totalTokens || a.id.localeCompare(b.id))
      return createChartTooltip({
        title: row.name,
        subtitle: `${props.data.from} – ${props.data.to}`,
        summary: {
          label: label('Total tokens', 'Token 总量'),
          value: formatNumber(row.totalTokens, { compact: true }),
        },
        rows: [
          ...sources.slice(0, 10).map((source) => ({
            label: source.name,
            value: formatNumber(source.totalTokens, { compact: true }),
            color:
              mode.value === 'categorical' ? modelSeriesColor(source.id, tokens.value) : row.color,
            iconUrl: source.iconUrl,
          })),
          ...(sources.length > 10
            ? [
                {
                  label: label('Other', '其他'),
                  value: formatNumber(
                    sources.slice(10).reduce((sum, source) => sum + source.totalTokens, 0),
                    { compact: true },
                  ),
                  color: tokens.value['--analytics-series-other'],
                },
              ]
            : []),
          {
            label: label('Share', '用量占比'),
            value: formatNumber(
              props.data.summary.totalTokens
                ? (row.totalTokens / props.data.summary.totalTokens) * 100
                : 0,
              { percent: true },
            ),
          },
        ],
      })
    },
    position: (
      point: number[],
      _params: unknown,
      _element: unknown,
      _rect: unknown,
      size: {
        contentSize: number[]
      },
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
      id: 'usage-ranking',
      type: 'bar',
      data: props.items.map((row) => ({
        id: row.id,
        name: row.name,
        value: row.totalTokens,
        itemStyle: { color: row.color },
      })),
      barWidth: 24,
      itemStyle: { borderRadius: [0, 3, 3, 0] },
      label: {
        ...getChartText('number'),
        show: true,
        position: 'right',
        distance: 8,
        color: tokens.value['--text'],
        fontSize: 12,
        formatter: ({ value }: { value?: unknown }) =>
          typeof value === 'number' ? formatNumber(value, { compact: true }) : '',
      },
      emphasis: { disabled: true },
    },
  ],
}))
function groupRow(event: MouseEvent): (typeof props.items)[number] | undefined {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const offset = event.clientY - bounds.top
  const step = props.rowHeight + props.rowGap
  if (offset < 0 || offset % step >= props.rowHeight) return undefined
  return props.items[Math.floor(offset / step)]
}
function hoverGroup(event: MouseEvent): void {
  hoveredId.value = groupRow(event)?.id ?? null
}
function toggleGroup(event: MouseEvent): void {
  const row = groupRow(event)
  if (row) emit('toggle', row.id)
}
</script>
<template>
  <div
    class="ranking-group"
    :style="{
      '--ranking-row-height': rowHeight + 'px',
      '--ranking-row-gap': rowGap + 'px',
    }"
    @mousemove="hoverGroup"
    @mouseleave="hoveredId = null"
    @click="toggleGroup"
  >
    <div class="ranking-rows">
      <div
        v-for="row in items"
        :key="row.id"
        class="ranking-name-row"
        :class="{ 'is-joined': joinedId === row.id, 'is-hovered': hoveredId === row.id }"
      >
        <button
          type="button"
          class="ranking-name ranking-expand"
          :title="row.name"
          :aria-label="row.name"
          :data-usage-id="row.id"
          :aria-expanded="expandedId === row.id"
          :aria-controls="`${detailIdPrefix}-${encodeURIComponent(row.id)}`"
          @click.stop="emit('toggle', row.id)"
        >
          <span class="ranking-chevron" aria-hidden="true" />
          <AgentMark v-if="kind === 'agents'" :agent="row.id" :size="16" />
          <ModelMark v-else :model="row.id" :size="16" />
          <span class="ranking-name-text">{{ row.name }}</span>
        </button>
      </div>
    </div>
    <div class="ranking-plot" :style="{ height: height + 'px' }">
      <WorkspaceChart
        ref="plot"
        :option="option"
        :label="
          kind === 'agents'
            ? label('Agent token usage ranking', 'Agent Token 用量排行')
            : label('Model token usage ranking', '模型 Token 用量排行')
        "
      />
    </div>
  </div>
</template>
<style scoped>
.ranking-group {
  display: grid;
  grid-template-columns: minmax(0, var(--ranking-name-width)) minmax(0, 1fr);
  column-gap: 8px;
  padding: 0 12px;
}
.ranking-rows {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  grid-row: 1;
  align-self: start;
  row-gap: var(--ranking-row-gap);
  min-width: 0;
  pointer-events: none;
}
.ranking-name-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: center;
  height: var(--ranking-row-height);
  min-width: 0;
  position: relative;
}
.ranking-name-row::before {
  content: '';
  position: absolute;
  inset: 0 -12px;
  border-radius: 7px;
  background: var(--ranking-row-fill);
  z-index: 0;
  pointer-events: none;
  transition: background var(--motion-hover) var(--motion-ease);
}
.ranking-name-row:hover::before,
.ranking-name-row.is-hovered::before {
  background: var(--ranking-row-hover);
}
.ranking-name-row.is-joined::before {
  border-radius: 7px 7px 0 0;
  background: var(--ranking-row-open);
}
.ranking-name-row:has(.ranking-name:focus-visible)::before {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.ranking-chevron {
  flex: none;
  width: 6px;
  height: 6px;
  margin: 0 3px;
  color: var(--text-soft);
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  transition: transform var(--motion-hover) var(--motion-ease);
}
.ranking-expand[aria-expanded='true'] .ranking-chevron {
  transform: rotate(45deg);
}
.ranking-name {
  grid-column: 1;
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  height: var(--ranking-row-height);
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  pointer-events: auto;
  transition: color var(--motion-hover) var(--motion-ease);
}
.ranking-name:hover {
  color: var(--primary);
}
.ranking-name:focus-visible {
  outline: 0;
}
.ranking-name-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ranking-plot {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  z-index: 1;
  cursor: pointer;
  mask-image: repeating-linear-gradient(
    to bottom,
    #000 0 var(--ranking-row-height),
    transparent var(--ranking-row-height) calc(var(--ranking-row-height) + var(--ranking-row-gap))
  );
}
@media (prefers-reduced-motion: reduce) {
  .ranking-name,
  .ranking-chevron,
  .ranking-name-row::before {
    transition: none;
  }
}
</style>
