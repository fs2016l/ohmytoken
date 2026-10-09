<script setup lang="ts">
import { computed, onDeactivated, onUnmounted, ref, useId, watch } from 'vue'
import type { AnalyticsDimension, AnalyticsModelUsage } from '@shared/analytics'
import type { UsageCostRollup } from '@shared/usage-cost'
import { combineCostRollups } from '@shared/cost-rollup'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import AnimatedCost from '../base/AnimatedCost.vue'
import AnimatedStackedBar from '../base/AnimatedStackedBar.vue'
import PointerTooltip from '../base/PointerTooltip.vue'
import RollingText from '../base/RollingText.vue'
import CardStatsFooter from '../base/CardStatsFooter.vue'
import { useI18n } from '../../i18n/useI18n'
import { useCostCurrency } from '../../composables/useCostCurrency'
import { summaryMoney } from '../../utils/analytics-display'
import { formatNumber } from '../../utils/number-format'
import type { ChartTooltipData } from '../../utils/chart-tooltip'
import { useChartTokens } from '../../composables/useChartTokens'
import { modelSeriesColor } from '../../utils/model-series-color'
import { useChartColorMode } from '../../composables/useChartColorMode'
import { useUsageBarHover } from '../../composables/useUsageBarHover'
import { mergeProjectModels, projectModelSlices } from '../../utils/project-model-usage'
const props = defineProps<{
  projects: AnalyticsDimension[]
  modelUsage: Record<string, AnalyticsModelUsage[]>
  totalTokens?: number
  costSummary?: UsageCostRollup
  from?: string
  to?: string
}>()
const emit = defineEmits<{ select: [id: string] }>()
const { label } = useI18n(),
  { currency, exchange } = useCostCurrency()
const tokens = useChartTokens()
const { mode } = useChartColorMode()
const chartHover = useUsageBarHover()
const hoverOwner = Symbol('project-butterfly')
const highlight = computed(() =>
  mode.value === 'categorical' ? chartHover?.series.value : undefined,
)
const gradient = (reverse: boolean): string | undefined =>
  mode.value === 'tonal'
    ? `linear-gradient(${reverse ? 90 : 270}deg, ${tokens.value['--chart-project-cost-end']}, ${tokens.value['--chart-project-cost-start']})`
    : undefined
const rows = computed(() => {
  const named = props.projects.filter((project) => project.id).slice(0, 3)
  const others = props.projects.filter((project) => !named.includes(project))
  const summaries = others.flatMap((project) => (project.costSummary ? [project.costSummary] : []))
  return [
    ...named.map((project) => ({ ...project, models: props.modelUsage[project.id] || [] })),
    {
      id: '',
      name: label('Other / unassigned', '其他 / 未关联'),
      totalTokens: others.reduce((sum, project) => sum + project.totalTokens, 0),
      models: mergeProjectModels(others.flatMap((project) => props.modelUsage[project.id] || [])),
      costSummary:
        summaries.length === others.length && summaries.length
          ? combineCostRollups(summaries, summaries[0].catalogVersion)
          : undefined,
    },
  ].map((project) => ({
    ...project,
    cost: summaryMoney(project.costSummary, currency.value, exchange.value.snapshot)?.min ?? null,
  }))
})
const maxTokens = computed(() => Math.max(1, ...rows.value.map((row) => row.totalTokens)))
const maxCost = computed(() => Math.max(0.01, ...rows.value.map((row) => row.cost || 0)))
type ProjectRow = (typeof rows.value)[number]
function slices(row: ProjectRow, metric: 'tokens' | 'cost') {
  return projectModelSlices(row.models, metric, currency.value, exchange.value.snapshot).map(
    (item) => ({
      ...item,
      key: item.other ? 'remainder' : `model:${item.id}`,
      name: item.other ? label('Other', '其他') : item.name || label('Unknown model', '未知模型'),
      color: item.other
        ? tokens.value['--analytics-series-other']
        : modelSeriesColor(item.id, tokens.value),
    }),
  )
}
function segments(row: ProjectRow, metric: 'tokens' | 'cost') {
  if (metric === 'cost' && row.cost === null) return []
  const parts = slices(row, metric)
  return parts.length
    ? parts.map((part) => ({ id: part.key, value: part.value, color: part.color }))
    : [
        {
          id: 'remainder',
          value: metric === 'tokens' ? row.totalTokens : row.cost || 0,
          color: tokens.value['--analytics-series-other'],
        },
      ]
}
const paintedRows = computed(() =>
  rows.value.map((row) => ({
    ...row,
    tokenSegments: segments(row, 'tokens'),
    costSegments: segments(row, 'cost'),
  })),
)
function modelCost(model: AnalyticsModelUsage): string {
  const money = summaryMoney(model.costSummary, currency.value, exchange.value.snapshot)
  if (!money) return model.costSummary?.pricedRecords === 0 ? label('Unpriced', '未计价') : '—'
  return `≈${formatNumber(money.min, { currency: currency.value, compact: true })}${Math.abs(money.max - money.min) > 1e-10 ? ` – ${formatNumber(money.max, { currency: currency.value, compact: true })}` : ''}`
}
const tooltipId = useId()
const hovered = ref<{ id: string; metric: 'tokens' | 'cost' | 'both' } | null>(null)
const pointer = ref<{ x: number; y: number } | null>(null)
const tooltip = computed<ChartTooltipData | null>(() => {
  const row = rows.value.find((row) => row.id === hovered.value?.id)
  if (!row || !hovered.value) return null
  const token = {
    label: label('Token usage', 'Token 用量'),
    value: formatNumber(row.totalTokens, { compact: true }),
  }
  const money = summaryMoney(row.costSummary, currency.value, exchange.value.snapshot)
  const cost = {
    label: `${label('Est. cost', '预估花费')} · ${currency.value}`,
    value: money
      ? `≈${formatNumber(money.min, { currency: currency.value, compact: true })}${Math.abs(money.max - money.min) > 1e-10 ? ` – ${formatNumber(money.max, { currency: currency.value, compact: true })}` : ''}`
      : !row.costSummary && !row.totalTokens
        ? formatNumber(0, { currency: currency.value })
        : '—',
  }
  const note = !row.costSummary
    ? row.totalTokens
      ? label('Cost unavailable', '费用暂不可用')
      : ''
    : row.costSummary.totalRecords && !row.costSummary.pricedRecords
      ? label('Unpriced', '未计价')
      : !money
        ? label('Exchange rate unavailable', '汇率暂不可用')
        : row.costSummary.pricedRecords < row.costSummary.totalRecords
          ? label('API equivalent estimate · Partially priced', 'API 参考估算 · 部分调用未计价')
          : label('API equivalent estimate', 'API 参考估算')
  const details = slices(row, hovered.value.metric === 'cost' ? 'cost' : 'tokens').map((item) => ({
    label: item.name,
    color: item.color,
    value:
      hovered.value?.metric === 'cost'
        ? modelCost(item)
        : formatNumber(item.totalTokens, { compact: true }),
  }))
  return {
    title: row.name,
    subtitle: props.from && props.to ? `${props.from} – ${props.to}` : undefined,
    summary: hovered.value.metric === 'cost' ? cost : token,
    rows: hovered.value.metric === 'both' ? [cost] : details,
    note:
      hovered.value.metric === 'tokens'
        ? props.totalTokens
          ? `${label('Share of period tokens', '区间用量占比')} ${formatNumber((row.totalTokens / props.totalTokens) * 100, { percent: true })}`
          : undefined
        : note,
  }
})
function hover(event: MouseEvent, id: string): void {
  const target = event.target as HTMLElement
  chartHover?.set(
    hoverOwner,
    mode.value === 'categorical'
      ? target.closest<HTMLElement>('[data-model-id]')?.dataset.modelId
      : undefined,
  )
  const metric = target.closest('.token-wing')
    ? 'tokens'
    : target.closest('.cost-wing')
      ? 'cost'
      : 'both'
  if (hovered.value?.id !== id || hovered.value.metric !== metric) hovered.value = { id, metric }
  pointer.value = { x: event.clientX, y: event.clientY }
}
function focus(event: FocusEvent, id: string): void {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  hovered.value = { id, metric: 'both' }
  pointer.value = { x: bounds.left + bounds.width / 2, y: bounds.bottom }
}
function closeTooltip(): void {
  hovered.value = null
  chartHover?.set(hoverOwner)
}
watch(mode, closeTooltip)
onDeactivated(closeTooltip)
onUnmounted(closeTooltip)
// A ranking change replaces the project under a stationary pointer.
watch(() => rows.value.map((row) => row.id).join('\0'), closeTooltip)
</script>
<template>
  <div class="project-butterfly" :style="{ '--project-row-count': rows.length }">
    <div class="butterfly-legend">
      <span>
        <i :style="{ background: gradient(true) }" />
        Token
      </span>
      <span>
        <i :style="{ background: gradient(false) }" />
        {{ label('Est. cost', '预估花费') }} · {{ currency }}
      </span>
    </div>
    <!-- Rank slots keep the label transition alive; project actions use the current row. -->
    <button
      v-for="(row, rank) in paintedRows"
      :key="rank"
      type="button"
      class="butterfly-row"
      :aria-disabled="!row.id"
      :aria-describedby="hovered?.id === row.id ? tooltipId : undefined"
      @mousemove="hover($event, row.id)"
      @mouseleave="closeTooltip"
      @focus="focus($event, row.id)"
      @blur="closeTooltip"
      @click="row.id && emit('select', row.id)"
    >
      <div class="token-wing">
        <AnimatedNumber :value="row.totalTokens" :format="{ compact: true }" title="" />
        <AnimatedStackedBar
          :segments="row.tokenSegments"
          :max="maxTokens"
          :gradient="gradient(true)"
          :highlight="highlight"
          reverse
        />
      </div>
      <span class="butterfly-name"><RollingText :text="row.name" /></span>
      <div class="cost-wing">
        <AnimatedCost v-if="row.costSummary" :summary="row.costSummary" :note="false" title="" />
        <span v-else>{{ row.totalTokens ? '—' : formatNumber(0, { currency }) }}</span>
        <AnimatedStackedBar
          :segments="row.costSegments"
          :max="maxCost"
          :gradient="gradient(false)"
          :highlight="highlight"
        />
      </div>
    </button>
    <CardStatsFooter
      class="butterfly-scale"
      :items="[
        { id: 'tokens', label: label('Total tokens', 'Token 总计') },
        { id: 'cost', label: label('Est. total cost', '预估总花费') },
      ]"
    >
      <template #tokens>
        <AnimatedNumber :value="totalTokens" :format="{ compact: true }" />
      </template>
      <template #cost>
        <AnimatedCost :summary="costSummary" :note="false" :estimate-mark="false" />
      </template>
    </CardStatsFooter>
    <PointerTooltip :id="tooltipId" :content="tooltip" :point="pointer" @dismiss="closeTooltip" />
  </div>
</template>
<style scoped>
.project-butterfly {
  display: grid;
  grid-template-rows: 18px repeat(var(--project-row-count), minmax(0, 1fr)) 40px;
  gap: 8px;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.butterfly-legend {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-soft);
  font-size: 11px;
  line-height: 18px;
}
.butterfly-legend i {
  display: inline-block;
  width: 12px;
  height: 5px;
  background: var(--chart-primary);
  border-radius: 3px;
  margin-right: 4px;
}
.butterfly-row {
  padding: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px minmax(0, 1fr);
  gap: 4px;
  background: transparent;
  border: 0;
  color: var(--text);
  cursor: pointer;
  width: 100%;
  min-height: 0;
  font-weight: 400;
}
.butterfly-row[aria-disabled='true'] {
  cursor: default;
}
.butterfly-row[aria-disabled='false']:hover .butterfly-name {
  color: var(--accent);
}
.token-wing,
.cost-wing {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
  font-size: 11px;
  line-height: 16px;
}
.token-wing > :first-child,
.cost-wing > :first-child {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.token-wing {
  text-align: right;
}
.token-wing > .animated-number {
  align-self: flex-end;
  max-width: 100%;
}
.cost-wing {
  text-align: left;
}
.butterfly-name {
  display: block;
  padding-top: 18px;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  text-align: center;
}
</style>
