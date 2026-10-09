<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { UsageAnalytics, UsageAnalyticsFilter } from '@shared/analytics'
import type { Overview, TokenUsageUserSession, TrackedProject } from '@shared/models'
import PageSurface from '../components/base/PageSurface.vue'
import ScrollRegion from '../components/base/ScrollRegion.vue'
import DateRangeControl from '../components/base/DateRangeControl.vue'
import SearchControl from '../components/base/SearchControl.vue'
import SegmentedControl from '../components/base/SegmentedControl.vue'
import FilterSelect from '../components/base/FilterSelect.vue'
import WorkspaceDialog from '../components/base/WorkspaceDialog.vue'
import ComparisonControl from '../components/agent/ComparisonControl.vue'
import AnalyticsMetrics from '../components/agent/AnalyticsMetrics.vue'
import AnalyticsTrend from '../components/agent/AnalyticsTrend.vue'
import UsageSources from '../components/agent/UsageSources.vue'
import TokenComposition from '../components/agent/TokenComposition.vue'
import TokenHeatmap from '../components/agent/TokenHeatmap.vue'
import AnalyticsDetailTable from '../components/agent/AnalyticsDetailTable.vue'
import HighUsageSessions from '../components/agent/HighUsageSessions.vue'
import SessionDetailCard from '../components/agent/SessionDetailCard.vue'
import { usePageState } from '../composables/usePageState'
import { useRollingDateRange } from '../composables/useRollingDateRange'
import { usePageResource } from '../composables/usePageResource'
import { useScanStatus } from '../composables/useScanStatus'
import { useLocalFavorites } from '../composables/useLocalFavorites'
import { useI18n } from '../i18n/useI18n'
import { getAgentName } from '../config/agents'
import { motion } from '../config/motion'
import { localDate, presetRange } from '../utils/date-range'
import {
  comparisonDates,
  shiftDate,
  validDate,
  type ComparisonRange,
  type AnalyticsDimensionKey,
  type AnalyticsMetric,
  type AnalyticsGranularity,
} from '../utils/analytics-trend'
const { label } = useI18n(),
  route = useRoute(),
  router = useRouter(),
  scan = useScanStatus()
const favorites = useLocalFavorites()
const state = usePageState('analytics', {
  range: presetRange('month'),
  comparison: { mode: 'previous', from: '', to: '' } as ComparisonRange,
  query: '',
  submitted: '',
  agents: [] as string[],
  models: [] as string[],
  projects: [] as string[],
  view: 'trend',
  dimension: 'total' as AnalyticsDimensionKey,
  metric: 'tokens' as AnalyticsMetric,
  granularity: 'day' as AnalyticsGranularity,
  hidden: {} as Record<string, string[]>,
  sources: 'projects' as 'projects' | 'agents' | 'models',
  detail: 'projects' as 'projects' | 'agents' | 'models' | 'sessions' | 'dates',
  expanded: false as boolean,
  selectedDate: '',
})
useRollingDateRange(state)
watch(
  () => route.fullPath,
  () => {
    if (route.path !== '/analytics') return
    const { from, to } = route.query
    if (
      typeof from === 'string' &&
      typeof to === 'string' &&
      ((!from && !to) || (validDate(from) && validDate(to) && from <= to))
    )
      state.range = { from, to, preset: from ? 'custom' : 'all' }
    const list = (value: unknown): string[] =>
      (Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [])
        .filter((item): item is string => typeof item === 'string' && !!item)
        .slice(0, 256)
    for (const key of ['agents', 'models', 'projects'] as const)
      if (route.query[key] !== undefined) state[key] = list(route.query[key])
    if (typeof route.query.search === 'string') state.query = state.submitted = route.query.search
    if (route.query.view === 'details' || route.query.view === 'trend') {
      state.view = route.query.view
      state.selectedDate = ''
      state.expanded = false
    }
    if (['projects', 'agents', 'models', 'sessions', 'dates'].includes(String(route.query.detail)))
      state.detail = route.query.detail as typeof state.detail
  },
  { immediate: true },
)
const filter = computed<UsageAnalyticsFilter>(() => ({
  from: state.range.from || undefined,
  to: state.range.to || undefined,
  agents: [...state.agents],
  models: [...state.models],
  projectIds: [...state.projects],
  query: state.submitted,
}))
const resource = usePageResource(
  () => [filter.value, state.comparison, scan.revision.value],
  async () => {
    const scope = JSON.parse(JSON.stringify(filter.value)) as UsageAnalyticsFilter,
      compare = { ...state.comparison }
    const current = await window.api.getUsageAnalytics(scope),
      dates = comparisonDates(current, compare)
    const previous = dates ? await window.api.getUsageAnalytics({ ...scope, ...dates }) : null
    return { current, previous }
  },
  { current: null as UsageAnalytics | null, previous: null as UsageAnalytics | null },
)
const data = computed(() => resource.data.value.current),
  comparison = computed(() => resource.data.value.previous)
const metadata = usePageResource(
  () => scan.revision.value,
  async () => {
    const [overview, projects] = await Promise.all([
      window.api.getOverview(),
      window.api.projectsList(),
    ])
    return { overview, projects }
  },
  { overview: null as Overview | null, projects: [] as TrackedProject[] },
)
const agents = computed(() =>
  Object.keys(metadata.data.value.overview?.agentTotals || {}).map((id) => ({
    value: id,
    label: getAgentName(id),
  })),
)
const models = computed(() =>
  Object.keys(metadata.data.value.overview?.modelTotals || {}).map((id) => ({
    value: id,
    label: id,
  })),
)
const projects = computed(() =>
  metadata.data.value.projects.map((project) => ({ value: project.id, label: project.name })),
)
const favoriteProjects = computed(() =>
  favorites.items.value.filter((item) => item.type === 'project').map((item) => item.id),
)
const today = localDate(),
  heatFrom = shiftDate(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) - 26 * 7)
const heatmap = usePageResource(
  () => [
    state.view,
    state.agents,
    state.models,
    state.projects,
    state.submitted,
    scan.revision.value,
  ],
  () =>
    state.view === 'details'
      ? window.api.getUsageAnalytics({ ...filter.value, from: heatFrom, to: today })
      : Promise.resolve(null),
  null as UsageAnalytics | null,
)
const detailFilter = computed<UsageAnalyticsFilter>(() => ({
  ...filter.value,
  ...(state.selectedDate ? { from: state.selectedDate, to: state.selectedDate } : {}),
}))
const daily = usePageResource(
  () => [state.selectedDate, detailFilter.value, scan.revision.value],
  () =>
    state.selectedDate ? window.api.getUsageAnalytics(detailFilter.value) : Promise.resolve(null),
  null as UsageAnalytics | null,
)
const details = computed(() => (state.selectedDate ? daily.data.value : data.value))
const high = usePageResource(
  () => [state.view, detailFilter.value, scan.revision.value],
  () =>
    state.view === 'details'
      ? window.api.getSessionWorkspace({
          ...detailFilter.value,
          page: 1,
          pageSize: 3,
          sortBy: 'tokens',
          sortDirection: 'desc',
        })
      : Promise.resolve(null),
  null as Awaited<ReturnType<Window['api']['getSessionWorkspace']>> | null,
)
const selected = ref<TokenUsageUserSession | null>(null),
  sessionOpen = ref(false)
function showSession(value: TokenUsageUserSession): void {
  selected.value = value
  sessionOpen.value = true
}
function model(id: string): void {
  void router.push({ path: `/analytics/models/${encodeURIComponent(id)}`, query: contextQuery() })
}
function contextQuery(): Record<string, string | string[]> {
  return {
    ...state.range,
    back: '/analytics',
    agents: state.agents,
    projects: state.projects,
    models: state.models,
    search: state.submitted,
  }
}
function fees(): void {
  void router.push({ path: '/analytics/fees', query: contextQuery() })
}
function showDetails(): void {
  state.detail = state.sources
  state.view = 'details'
}
function escape(event: KeyboardEvent): void {
  if (
    event.key === 'Escape' &&
    route.path === '/analytics' &&
    !sessionOpen.value &&
    !document.querySelector(':popover-open')
  )
    state.expanded = false
}
onMounted(() => document.addEventListener('keydown', escape))
onBeforeUnmount(() => document.removeEventListener('keydown', escape))
watch(
  () => [state.range, state.agents, state.models, state.projects, state.submitted],
  () => {
    state.selectedDate = ''
  },
  { deep: true },
)
async function retry(): Promise<void> {
  await Promise.allSettled([
    resource.refresh(),
    metadata.refresh(),
    heatmap.refresh(),
    daily.refresh(),
    high.refresh(),
  ])
}
const error = computed(
  () =>
    resource.error.value ||
    metadata.error.value ||
    heatmap.error.value ||
    daily.error.value ||
    high.error.value,
)
</script>
<template>
  <PageSurface page-key="analytics" fixed class="analytics-page">
    <div class="workspace-heading analytics-heading">
      <div>
        <h1>{{ label('Usage analytics', '用量分析') }}</h1>
        <p>
          {{ label('Understand where your usage comes from.', '看清用量变化，追溯每一笔消耗') }}
        </p>
      </div>
      <div class="analytics-dates">
        <DateRangeControl v-model="state.range" />
        <ComparisonControl
          v-model="state.comparison"
          :current="state.range.from && state.range.to ? state.range : data || state.range"
        />
      </div>
    </div>
    <div class="workspace-controls analytics-controls">
      <SearchControl
        v-model="state.query"
        :placeholder="
          label('Search projects, sessions, models or Agents', '搜索项目、会话、模型或 Agent')
        "
        @search="state.submitted = state.query.trim()"
      />
      <SegmentedControl
        v-model="state.view"
        :options="[
          { value: 'trend', label: label('Usage trend', '用量趋势') },
          { value: 'details', label: label('Detailed analysis', '明细分析') },
        ]"
        :label="label('Analysis view', '分析视图')"
        appearance="group"
      />
      <FilterSelect
        v-model="state.projects"
        :name="label('Projects', '项目')"
        :options="projects"
        :favorite-values="favoriteProjects"
        :label="label('All projects', '全部项目')"
        icon="folder"
      />
      <FilterSelect
        v-model="state.agents"
        :name="label('Agent', 'Agent')"
        :options="agents"
        :label="label('All Agents', '所有 Agent')"
        icon="stacks"
        option-kind="agent"
      />
      <FilterSelect
        v-model="state.models"
        :name="label('Models', '模型')"
        :options="models"
        :label="label('All models', '全部模型')"
        icon="memory"
        option-kind="model"
      />
    </div>
    <p v-if="error" class="workspace-error" role="alert">
      {{ error }}
      <button type="button" class="workspace-link" @click="retry">
        {{ label('Retry', '重试') }}
      </button>
    </p>
    <ScrollRegion
      v-show="state.view === 'trend'"
      class="analytics-trend-content"
      axis="vertical"
      page-key="analytics"
      region="trend"
      :label="label('Usage trend content', '用量趋势内容')"
      :aria-busy="resource.busy.value"
    >
      <AnalyticsMetrics :data="data" :comparison="comparison" @fees="fees" />
      <AnalyticsTrend
        v-model:dimension="state.dimension"
        v-model:metric="state.metric"
        v-model:granularity="state.granularity"
        v-model:hidden="state.hidden"
        :data="data"
        :comparison="comparison"
        :comparison-mode="state.comparison.mode"
      />
      <div class="analytics-bottom">
        <UsageSources v-model="state.sources" :data="data" @details="showDetails" />
        <TokenComposition :data="data" />
      </div>
    </ScrollRegion>
    <div
      v-show="state.view === 'details'"
      class="analytics-detail-layout"
      :class="{ 'analytics-detail-layout--expanded': state.expanded }"
      :style="{ '--detail-duration': `${motion.detail}ms` }"
      :aria-busy="resource.busy.value || daily.busy.value"
    >
      <div class="analytics-detail-summary" :inert="state.expanded">
        <div class="analytics-heatmap-wrap">
          <TokenHeatmap
            v-model="state.selectedDate"
            :data="heatmap.data.value"
            :from="heatFrom"
            :to="today"
          />
        </div>
        <aside class="analytics-detail-side">
          <TokenComposition :data="details" compact />
          <HighUsageSessions
            :sessions="high.data.value?.items || []"
            @select="showSession"
            @all="state.detail = 'sessions'"
          />
        </aside>
      </div>
      <div class="analytics-detail-main">
        <div v-if="state.selectedDate" class="selected-day">
          {{ label('Detail date', '明细日期') }}: {{ state.selectedDate }}
          <button type="button" class="workspace-link" @click="state.selectedDate = ''">
            {{ label('Return to selected period', '返回选定区间') }}
          </button>
        </div>
        <AnalyticsDetailTable
          v-model="state.detail"
          :data="details"
          :comparison="state.selectedDate ? null : comparison"
          :comparison-mode="state.comparison.mode"
          :filter="detailFilter"
          :expanded="state.expanded"
          @expand="state.expanded = !state.expanded"
          @model="model"
          @session="showSession"
        />
      </div>
    </div>
    <WorkspaceDialog
      :open="sessionOpen"
      :title="label('Session details', '会话详情')"
      @close="sessionOpen = false"
    >
      <SessionDetailCard :session="selected" />
    </WorkspaceDialog>
  </PageSurface>
</template>
<style scoped>
.analytics-heading {
  align-items: center;
  margin-bottom: 12px;
}
.analytics-dates {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.analytics-controls {
  margin-bottom: 12px;
  gap: 8px;
}
.analytics-controls :deep(.search-control) {
  width: 300px;
  max-width: 300px;
}
.analytics-trend-content {
  min-height: 0;
  flex: 1;
  scrollbar-gutter: auto;
}
.analytics-trend-content :deep(.scroll-region-content) {
  display: grid;
  /* Reserve the full source-card height before assigning the chart's remaining space. */
  grid-template-rows: 100px minmax(320px, 1fr) max-content;
  gap: 12px;
  height: 100%;
  min-height: 672px;
}
.analytics-trend-content :deep(.analytics-trend) {
  height: 100%;
}
.analytics-bottom {
  display: grid;
  grid-template-columns: minmax(0, 744fr) minmax(0, 564fr);
  gap: 12px;
  min-height: 228px;
}
.analytics-detail-layout {
  display: grid;
  grid-template-rows: 316px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  gap: 12px;
  transition:
    grid-template-rows var(--detail-duration) ease-in-out,
    gap var(--detail-duration) ease-in-out;
}
.analytics-detail-summary {
  display: grid;
  grid-template-columns: minmax(0, 908fr) minmax(0, 400fr);
  gap: 12px;
  min-height: 0;
  overflow: hidden;
  transition: opacity var(--detail-duration) ease-in-out;
}
.analytics-detail-main {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.analytics-heatmap-wrap {
  min-width: 0;
  min-height: 0;
}
.analytics-detail-side {
  min-width: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: 192px 112px;
  gap: 12px;
}
.analytics-detail-layout--expanded {
  grid-template-rows: 0px minmax(0, 1fr);
  gap: 0;
}
.analytics-detail-layout--expanded .analytics-detail-summary {
  opacity: 0;
}
.selected-day {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
}
@media (max-width: 1380px) {
  .analytics-heading {
    align-items: flex-start;
  }
  .analytics-dates {
    max-width: 690px;
  }
  .analytics-detail-summary {
    grid-template-columns: minmax(0, 1fr) minmax(0, 340px);
  }
  .analytics-bottom {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
@media (prefers-reduced-motion: reduce) {
  .analytics-detail-layout,
  .analytics-detail-summary {
    transition: none;
  }
}
</style>
