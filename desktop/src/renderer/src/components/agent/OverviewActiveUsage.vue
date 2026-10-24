<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { UsageAnalytics } from '@shared/analytics'
import SegmentedControl from '../base/SegmentedControl.vue'
import ScrollRegion from '../base/ScrollRegion.vue'
import PaginationBar from '../base/PaginationBar.vue'
import OverviewUsageCard from './OverviewUsageCard.vue'
import OverviewUsageRanking from './OverviewUsageRanking.vue'
import { useI18n } from '../../i18n/useI18n'
import { usePageState } from '../../composables/usePageState'
import { motion } from '../../config/motion'
import { overviewRankingLayout } from '../../config/overview-ranking'

const props = defineProps<{
  data: UsageAnalytics | null
  scope: string
  busy: boolean
  scanBusy: boolean
}>()
const kind = defineModel<'models' | 'agents'>('kind', { required: true })
const expanded = defineModel<boolean>('expanded', { required: true })
const emit = defineEmits<{ open: [id: string]; scan: [] }>()
const { label } = useI18n()
const route = useRoute()
const element = ref<HTMLElement | null>(null)
const controls = ref<HTMLElement | null>(null)
const scroller = ref<InstanceType<typeof ScrollRegion> | null>(null)
const expandButton = ref<HTMLButtonElement | null>(null)
const previewCount = ref<number>(overviewRankingLayout.previewDefault)
let resizeObserver: ResizeObserver | undefined
const pageSizes = [15, 30, 45, 60]
const paging = usePageState('overview-cards', {
  page: 1,
  size: 15,
  layout: 'cards' as 'cards' | 'bars',
})
if (!pageSizes.includes(paging.size)) paging.size = 15
if (!Number.isSafeInteger(paging.page) || paging.page < 1) paging.page = 1
if (paging.layout !== 'bars') paging.layout = 'cards'
const ranking = computed(() => paging.layout === 'bars')
const dimension = computed(() => (kind.value === 'agents' ? 'agents' : 'models'))
const allItems = computed(() => props.data?.[dimension.value] || [])
const pageCount = computed(() => Math.max(1, Math.ceil(allItems.value.length / paging.size)))
const items = computed(() =>
  expanded.value
    ? allItems.value.slice((paging.page - 1) * paging.size, paging.page * paging.size)
    : allItems.value.slice(0, ranking.value ? previewCount.value : 3),
)
const options = computed(() => [
  { value: 'models', label: label('Active models', '活跃模型') },
  { value: 'agents', label: label('Active agents', '活跃 Agent') },
])
const layouts = computed(() => [
  { value: 'cards', label: label('Cards', '卡片') },
  { value: 'bars', label: label('Bar chart', '条形图') },
])
const expandLabel = computed(() =>
  expanded.value
    ? ranking.value
      ? label('Restore overview', '返回概览')
      : label('Restore cards', '收起卡片')
    : dimension.value === 'agents'
      ? label('Expand all agents', '展开全部 Agent')
      : label('Expand all models', '展开全部模型'),
)
function toggleExpanded(): void {
  scroller.value?.scrollToTop()
  expanded.value = !expanded.value
}
function measurePreviewCount(): void {
  const container = element.value?.parentElement
  const header = controls.value
  if (!container || !header) return
  const style = getComputedStyle(container)
  const summaryHeight = parseFloat(style.getPropertyValue('--overview-summary-height'))
  const summaryGap = parseFloat(style.getPropertyValue('--overview-summary-gap'))
  if (!Number.isFinite(summaryHeight) || !Number.isFinite(summaryGap)) return
  const headerStyle = getComputedStyle(header)
  // The parent keeps its height during expansion; reserve the normal summary above the list.
  const height =
    container.clientHeight -
    summaryHeight -
    summaryGap -
    header.getBoundingClientRect().height -
    (parseFloat(headerStyle.marginTop) || 0) -
    (parseFloat(headerStyle.marginBottom) || 0)
  const { padding, borderWidth, rowHeight, rowGap, previewMin, previewMax } = overviewRankingLayout
  const rows = Math.floor((height - (padding + borderWidth) * 2 + rowGap) / (rowHeight + rowGap))
  previewCount.value = Math.max(previewMin, Math.min(previewMax, rows))
}
function escape(event: KeyboardEvent): void {
  if (
    event.key !== 'Escape' ||
    event.defaultPrevented ||
    route.path !== '/agent' ||
    !expanded.value ||
    document.querySelector(':popover-open, .dp__menu')
  )
    return
  toggleExpanded()
  expandButton.value?.focus({ preventScroll: true })
}
onMounted(() => {
  document.addEventListener('keydown', escape)
  measurePreviewCount()
  const container = element.value?.parentElement
  if (container && controls.value) {
    resizeObserver = new ResizeObserver(measurePreviewCount)
    resizeObserver.observe(container)
    resizeObserver.observe(controls.value)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', escape)
  resizeObserver?.disconnect()
})
watch([dimension, () => props.scope], () => {
  paging.page = 1
  scroller.value?.scrollToTop()
})
watch([() => !!props.data, () => allItems.value.length, () => paging.size], () => {
  if (props.data) paging.page = Math.max(1, Math.min(pageCount.value, paging.page))
})
watch(
  () => [paging.page, paging.size, ranking.value],
  () => scroller.value?.scrollToTop(),
  { flush: 'post' },
)
</script>
<template>
  <section
    ref="element"
    class="overview-models"
    :class="{ 'overview-models--expanded': expanded }"
    :style="{ '--card-duration': `${motion.detail}ms` }"
  >
    <header ref="controls">
      <div class="overview-view-controls">
        <SegmentedControl
          v-model="kind"
          appearance="light"
          class="active-dimension-control"
          :options="options"
          :label="label('Active usage', '活跃用量')"
        />
        <SegmentedControl
          v-model="paging.layout"
          appearance="light"
          class="active-layout-control"
          :options="layouts"
          :label="label('Display mode', '显示方式')"
        >
          <template #option="{ option }">
            <span class="layout-option">
              <span
                class="layout-swatch"
                :class="{ 'layout-swatch--bars': option.value === 'bars' }"
                aria-hidden="true"
              >
                <i />
                <i />
                <i />
                <i />
              </span>
              {{ option.label }}
            </span>
          </template>
        </SegmentedControl>
      </div>
      <button
        ref="expandButton"
        type="button"
        class="workspace-link overview-expand"
        :aria-label="expandLabel"
        :title="expandLabel"
        :aria-expanded="expanded"
        aria-controls="overview-active-cards"
        @click="toggleExpanded"
      >
        {{
          dimension === 'agents'
            ? label('All agents', '全部 Agent')
            : label('All models', '全部模型')
        }}
        <span class="material-symbols-outlined" aria-hidden="true">
          {{ expanded ? 'fullscreen_exit' : 'fullscreen' }}
        </span>
      </button>
    </header>
    <ScrollRegion
      id="overview-active-cards"
      ref="scroller"
      class="overview-card-scroll"
      page-key="overview"
      :region="`cards:${dimension}:${expanded ? (ranking ? 'bars' : 'all') : 'top'}`"
      :ready="!!data"
      axis="vertical"
      :label="
        ranking
          ? label('Usage ranking', '用量排行')
          : dimension === 'agents'
            ? label('Agent usage cards', 'Agent 用量卡片')
            : label('Model usage cards', '模型用量卡片')
      "
      :aria-busy="busy"
    >
      <Transition name="overview-view" mode="out-in">
        <OverviewUsageRanking
          v-if="data && items.length && ranking"
          key="bars"
          :items="items"
          :kind="dimension"
          :data="data"
        />
        <TransitionGroup
          v-else-if="data && items.length"
          key="cards"
          name="overview-card"
          tag="div"
          class="model-cards"
        >
          <!-- Preserve ranked slots while names, metrics and trends change in place. -->
          <OverviewUsageCard
            v-for="(item, index) in items"
            :key="index"
            :item="item"
            :kind="dimension"
            :data="data"
            @open="emit('open', item.id)"
          />
        </TransitionGroup>
        <div v-else key="empty" class="workspace-panel workspace-empty">
          <span class="material-symbols-outlined" aria-hidden="true">stacks</span>
          {{
            busy
              ? label('Preparing usage statistics…', '正在整理用量统计…')
              : label('No usage in this period', '此区间暂无用量')
          }}
          <button
            v-if="!busy"
            type="button"
            class="workspace-link"
            :disabled="scanBusy"
            @click="emit('scan')"
          >
            {{ label('Scan local usage', '扫描本地用量') }}
          </button>
        </div>
      </Transition>
    </ScrollRegion>
    <PaginationBar
      v-if="expanded"
      v-model:page="paging.page"
      v-model:page-size="paging.size"
      :page-sizes="pageSizes"
      :total="allItems.length"
      :busy="busy"
    />
  </section>
</template>
<style scoped>
.overview-models {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: var(--control-height);
  margin-bottom: 12px;
  flex: none;
}
.overview-view-controls {
  display: flex;
  align-items: center;
  gap: 24px;
  min-width: 0;
}
.layout-option {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.active-layout-control :deep(.selection-option > span) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.layout-swatch {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 2px;
  width: 12px;
  height: 12px;
}
.layout-swatch i {
  background: currentColor;
  border-radius: 1px;
}
.layout-swatch--bars {
  display: flex;
  flex-direction: column;
}
.layout-swatch--bars i {
  height: 3px;
}
.layout-swatch--bars i:nth-child(2) {
  width: 70%;
}
.layout-swatch--bars i:nth-child(3) {
  width: 45%;
}
.layout-swatch--bars i:last-child {
  display: none;
}
.overview-expand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  font-size: 11px;
  line-height: 18px;
  white-space: nowrap;
}
.overview-expand .material-symbols-outlined {
  font-size: 18px;
}
.model-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-content: start;
  align-items: start;
  gap: 24px;
  position: relative;
}
.overview-card-enter-active,
.overview-card-leave-active {
  transition:
    opacity var(--card-duration) var(--motion-ease),
    transform var(--card-duration) var(--motion-ease);
}
.overview-card-enter-from,
.overview-card-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
.overview-card-leave-active {
  pointer-events: none;
}
.overview-view-enter-active,
.overview-view-leave-active {
  transition: opacity calc(var(--card-duration) / 2) var(--motion-ease);
}
.overview-view-enter-from,
.overview-view-leave-to {
  opacity: 0;
}
.pagination-bar {
  flex: none;
  margin-top: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
}
@media (max-width: 1350px) {
  .model-cards {
    gap: 16px;
  }
}
@media (max-width: 1150px) {
  .model-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  .overview-card-enter-active,
  .overview-card-leave-active,
  .overview-view-enter-active,
  .overview-view-leave-active {
    transition: none;
  }
}
</style>
