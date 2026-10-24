<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  reactive,
  ref,
  useId,
  watch,
  type ComponentPublicInstance,
} from 'vue'
import type { AnalyticsDimension, UsageAnalytics } from '@shared/analytics'
import CollapseRegion from '../base/CollapseRegion.vue'
import OverviewRankingGroup from './OverviewRankingGroup.vue'
import OverviewRankingDetail from './OverviewRankingDetail.vue'
import { useChartTokens } from '../../composables/useChartTokens'
import { useChartColorMode } from '../../composables/useChartColorMode'
import { useMotionVisibility } from '../../composables/useMotionVisibility'
import { getAgentName } from '../../config/agents'
import { motion } from '../../config/motion'
import { overviewRankingLayout } from '../../config/overview-ranking'
import { formatNumber } from '../../utils/number-format'
import { modelSeriesColor } from '../../utils/model-series-color'

const props = defineProps<{
  items: AnalyticsDimension[]
  kind: 'models' | 'agents'
  data: UsageAnalytics
}>()
const tokens = useChartTokens()
const { mode } = useChartColorMode()
const element = ref<HTMLElement | null>(null)
const { reduced } = useMotionVisibility(element)
const details = reactive(new Map<string, { expanded: boolean; open: boolean }>())
const detailIdPrefix = useId()
const { rowHeight, rowGap, padding, borderWidth } = overviewRankingLayout
const detailRegions = new Map<string, HTMLElement>()
const frames = new Map<string, number>()
const closeTimers = new Map<string, ReturnType<typeof setTimeout>>()
let disposed = false

const rows = computed(() =>
  props.items.map((item) => ({
    ...item,
    name: props.kind === 'agents' ? getAgentName(item.id) : item.name,
    color:
      mode.value === 'categorical'
        ? modelSeriesColor(item.id, tokens.value)
        : tokens.value['--chart-quaternary'],
  })),
)
// Stable rows keep their canvas and tooltip when any neighboring detail changes height.
const groups = computed(() => rows.value.map((row) => ({ id: row.id, items: [row], row })))
const scaleMax = computed(() => {
  const maximum = Math.max(1, ...rows.value.map((row) => row.totalTokens))
  const magnitude = 10 ** Math.floor(Math.log10(maximum))
  return Math.ceil(maximum / magnitude) * magnitude
})
const labelSpace = computed(() =>
  Math.max(
    64,
    ...rows.value.map((row) => formatNumber(row.totalTokens, { compact: true }).length * 8 + 16),
  ),
)

function clearPending(id: string): void {
  const frame = frames.get(id)
  if (frame !== undefined) cancelAnimationFrame(frame)
  frames.delete(id)
  const timer = closeTimers.get(id)
  if (timer !== undefined) clearTimeout(timer)
  closeTimers.delete(id)
}
function clearAllPending(): void {
  for (const id of new Set([...frames.keys(), ...closeTimers.keys()])) clearPending(id)
}
function setDetailRegion(id: string, region: Element | ComponentPublicInstance | null): void {
  if (region && '$el' in region) detailRegions.set(id, region.$el as HTMLElement)
  else detailRegions.delete(id)
}
async function mountDetail(id: string): Promise<void> {
  details.set(id, { expanded: true, open: reduced.value })
  const state = details.get(id)!
  if (reduced.value) return
  await nextTick()
  if (disposed || details.get(id) !== state || !state.expanded || state.open) return
  // Paint the closed grid before opening it; charts retain their full geometry inside the clip.
  detailRegions.get(id)?.getBoundingClientRect()
  frames.set(
    id,
    requestAnimationFrame(() => {
      frames.delete(id)
      if (!disposed && details.get(id) === state && state.expanded) state.open = true
    }),
  )
}
function finishClose(id: string): void {
  const state = details.get(id)
  if (!state || state.expanded || state.open) return
  clearPending(id)
  details.delete(id)
}
function toggle(id: string): void {
  clearPending(id)
  const state = details.get(id)
  if (!state) {
    void mountDetail(id)
  } else if (!state.expanded) {
    state.expanded = true
    state.open = true
  } else {
    state.expanded = false
    state.open = false
    if (reduced.value) finishClose(id)
    else
      closeTimers.set(
        id,
        setTimeout(() => finishClose(id), motion.detail + 50),
      )
  }
}
function onDetailTransitionEnd(id: string, event: TransitionEvent): void {
  if (event.target === event.currentTarget && event.propertyName === 'grid-template-rows')
    finishClose(id)
}
watch([() => props.kind, () => props.data.from, () => props.data.to], () => {
  clearAllPending()
  details.clear()
})
watch(
  () => props.items.map((item) => item.id),
  (ids) => {
    const retained = new Set(ids)
    for (const id of details.keys()) {
      if (retained.has(id)) continue
      clearPending(id)
      details.delete(id)
    }
  },
)
watch(reduced, (value) => {
  if (!value) return
  clearAllPending()
  for (const [id, state] of details) {
    if (state.expanded) state.open = true
    else finishClose(id)
  }
})
onBeforeUnmount(() => {
  disposed = true
  clearAllPending()
  detailRegions.clear()
})
</script>
<template>
  <div
    ref="element"
    class="overview-ranking workspace-panel"
    :style="{
      '--ranking-row-gap': rowGap + 'px',
      '--ranking-padding': padding + 'px',
      '--ranking-border-width': borderWidth + 'px',
    }"
  >
    <div class="ranking-layout">
      <template v-for="(group, index) in groups" :key="group.id">
        <OverviewRankingGroup
          :class="{ 'ranking-group--trailing': index > 0 }"
          :items="group.items"
          :kind="kind"
          :data="data"
          :expanded-id="details.get(group.id)?.open ? group.id : null"
          :joined-id="details.has(group.id) ? group.id : null"
          :detail-id-prefix="detailIdPrefix"
          :row-height="rowHeight"
          :row-gap="rowGap"
          :max="scaleMax"
          :label-space="labelSpace"
          @toggle="toggle"
        />
        <CollapseRegion
          v-if="details.has(group.id)"
          :id="`${detailIdPrefix}-${encodeURIComponent(group.id)}`"
          :ref="(region) => setDetailRegion(group.id, region)"
          class="ranking-detail-region"
          :open="details.get(group.id)?.open ?? false"
          @transitionend="onDetailTransitionEnd(group.id, $event)"
        >
          <OverviewRankingDetail
            :usage-id="group.id"
            :name="group.row.name"
            :kind="kind"
            :data="data"
            :color="group.row.color"
            :max="scaleMax"
            :label-space="labelSpace"
          />
        </CollapseRegion>
      </template>
    </div>
  </div>
</template>
<style scoped>
.overview-ranking {
  --ranking-name-width: 184px;
  --ranking-row-fill: color-mix(in srgb, var(--primary) 6%, var(--surface-low));
  --ranking-row-hover: color-mix(in srgb, var(--primary) 8%, var(--surface-low));
  --ranking-row-open: color-mix(in srgb, var(--primary) 10%, var(--surface-low));
  padding: var(--ranking-padding);
  border-width: var(--ranking-border-width);
}
.ranking-layout {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.ranking-detail-region {
  border-radius: 0 0 7px 7px;
  background: var(--ranking-row-open);
}
.ranking-group--trailing {
  margin-top: var(--ranking-row-gap);
}
@media (max-width: 1350px) {
  .overview-ranking {
    --ranking-name-width: 164px;
  }
}
</style>
