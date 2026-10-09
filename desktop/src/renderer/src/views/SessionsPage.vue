<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  Overview,
  SessionSort,
  SessionWorkspaceFilter,
  SessionWorkspacePage,
  TokenUsageSession,
  TokenUsageUserSession,
  TrackedProject,
} from '@shared/models'
import PageSurface from '../components/base/PageSurface.vue'
import ScrollRegion from '../components/base/ScrollRegion.vue'
import DateRangeControl from '../components/base/DateRangeControl.vue'
import SearchControl from '../components/base/SearchControl.vue'
import FilterSelect from '../components/base/FilterSelect.vue'
import SegmentedControl from '../components/base/SegmentedControl.vue'
import PaginationBar from '../components/base/PaginationBar.vue'
import AnimatedNumber from '../components/base/AnimatedNumber.vue'
import AnimatedCost from '../components/base/AnimatedCost.vue'
import SessionTable from '../components/agent/SessionTable.vue'
import SessionDetailCard from '../components/agent/SessionDetailCard.vue'
import { useI18n } from '../i18n/useI18n'
import { usePageState } from '../composables/usePageState'
import { useRollingDateRange } from '../composables/useRollingDateRange'
import { useTableTabState } from '../composables/useTableTabState'
import { usePageResource } from '../composables/usePageResource'
import { useScanStatus } from '../composables/useScanStatus'
import { useLocalFavorites } from '../composables/useLocalFavorites'
import { useCostCurrency } from '../composables/useCostCurrency'
import { getAgentName } from '../config/agents'
import { presetRange } from '../utils/date-range'
import { projectForPath, sessionChildren, sessionKey } from '../utils/session-display'

const { label } = useI18n()
const state = usePageState('sessions', {
  range: presetRange('month'),
  query: '',
  submitted: '',
  collection: 'all',
  agents: [] as string[],
  models: [] as string[],
  projects: [] as string[],
  sort: 'recent' as SessionSort,
  direction: 'desc' as 'asc' | 'desc',
  page: 1,
  size: 10,
  selected: '',
  expanded: [] as string[],
  child: '',
})
useRollingDateRange(state)
const tabs = useTableTabState('sessions', () => state.collection, state, {
  page: 1,
  size: 10,
  sort: 'recent',
  direction: 'desc',
  selected: '',
  expanded: [],
  child: '',
})
const scan = useScanStatus()
const favorites = useLocalFavorites()
const { exchange } = useCostCurrency()
const scroller = ref<InstanceType<typeof ScrollRegion> | null>(null)
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
  Object.keys(metadata.data.value.overview?.agentTotals ?? {}).map((value) => ({
    value,
    label: getAgentName(value),
  })),
)
const models = computed(() =>
  Object.keys(metadata.data.value.overview?.modelTotals ?? {}).map((value) => ({
    value,
    label: value,
  })),
)
const projects = computed(() =>
  metadata.data.value.projects.map((project) => ({ value: project.id, label: project.name })),
)
const favoriteProjects = computed(() =>
  favorites.items.value.filter((item) => item.type === 'project').map((item) => item.id),
)
const filter = computed<SessionWorkspaceFilter>(() => ({
  from: state.range.from || undefined,
  to: state.range.to || undefined,
  query: state.submitted,
  // Electron cannot clone Vue proxies, including arrays nested inside a plain filter.
  agents: [...state.agents],
  models: [...state.models],
  projectIds: [...state.projects],
  onlyFavorites: state.collection === 'favorites',
  page: state.page,
  pageSize: state.size,
  sortBy: state.sort,
  sortDirection: state.direction,
  costExchangeRate: exchange.value.snapshot?.rates.CNY,
}))
const empty: SessionWorkspacePage = {
  items: [],
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 0,
  summary: { totalTokens: 0, apiCallCount: 0, apiCallCountComplete: true },
}
const resource = usePageResource(
  () => [filter.value, scan.revision.value, favorites.items.value],
  () => window.api.getSessionWorkspace(filter.value),
  empty,
)
const rows = computed(() =>
  resource.data.value.items.map((session) => ({
    session,
    key: sessionKey(session),
    children: sessionChildren(session.children),
  })),
)
const selection = computed<TokenUsageSession | null>(() => {
  const selected = rows.value.find((row) => row.key === state.selected)
  return (
    selected?.children.find((child) => sessionKey(child) === state.child) ??
    selected?.session ??
    null
  )
})
const selectedProject = computed(
  () => projectForPath(selection.value?.projectPath, metadata.data.value.projects)?.name,
)
const selectedSources = computed(() =>
  rows.value
    .find((row) => row.key === state.selected)
    ?.session.children.filter((child) => sessionKey(child) === state.child),
)
watch(
  () => resource.data.value,
  (value) => {
    if (value.page !== state.page) state.page = value.page
    if (!value.items.some((session) => sessionKey(session) === state.selected)) {
      state.selected = value.items[0] ? sessionKey(value.items[0]) : ''
      state.child = ''
    }
  },
)
watch(
  () => [state.range, state.submitted, state.agents, state.models, state.projects],
  () => {
    tabs.resetPaging(true)
    scroller.value?.scrollToTop()
  },
  { deep: true, flush: 'sync' },
)
watch(
  () => [state.sort, state.direction, state.size],
  () => {
    if (tabs.switching.value) return
    tabs.resetPaging()
    scroller.value?.scrollToTop()
  },
  { flush: 'sync' },
)
watch(
  () => state.page,
  () => {
    if (!tabs.switching.value) scroller.value?.scrollToTop()
  },
  { flush: 'sync' },
)
function sort(key: SessionSort): void {
  state.direction = state.sort === key && state.direction === 'desc' ? 'asc' : 'desc'
  state.sort = key
}
function toggle(key: string): void {
  state.expanded = state.expanded.includes(key)
    ? state.expanded.filter((value) => value !== key)
    : [...state.expanded, key]
}
function select(session: TokenUsageUserSession, child?: TokenUsageSession): void {
  state.selected = sessionKey(session)
  state.child = child ? sessionKey(child) : ''
}
async function retry(): Promise<void> {
  await Promise.allSettled([resource.refresh(), metadata.refresh(), favorites.initialize()])
}
</script>

<template>
  <PageSurface page-key="sessions" fixed>
    <div class="workspace-heading">
      <div>
        <h1>{{ label('Sessions', '会话') }}</h1>
        <p>
          {{
            label(
              'Follow your work across main and child sessions.',
              '沿着项目、主会话与子会话，追踪每一次用量',
            )
          }}
        </p>
      </div>
      <DateRangeControl v-model="state.range" />
    </div>
    <div class="workspace-controls session-controls">
      <SearchControl
        v-model="state.query"
        :placeholder="
          label('Search projects, sessions, models or Agents', '搜索项目、会话、模型或 Agent')
        "
        @search="state.submitted = state.query.trim()"
      />
      <SegmentedControl
        v-model="state.collection"
        :options="[
          { value: 'all', label: label('All sessions', '所有会话') },
          { value: 'favorites', label: label('Favorites', '收藏夹') },
        ]"
        :label="label('Session collection', '会话范围')"
      />
      <FilterSelect
        v-model="state.agents"
        :name="label('Agent', 'Agent')"
        :label="label('All Agents', '所有 Agent')"
        icon="stacks"
        option-kind="agent"
        :options="agents"
      />
      <FilterSelect
        v-model="state.models"
        :name="label('Models', '模型')"
        :label="label('All models', '全部模型')"
        icon="memory"
        option-kind="model"
        :options="models"
      />
      <FilterSelect
        v-model="state.projects"
        :name="label('Projects', '项目')"
        :label="label('All projects', '全部项目')"
        icon="folder"
        :options="projects"
        :favorite-values="favoriteProjects"
      />
    </div>
    <div
      v-if="resource.error.value || favorites.error.value || metadata.error.value"
      class="workspace-error"
      role="alert"
    >
      {{ resource.error.value || favorites.error.value || metadata.error.value }}
      <button type="button" class="workspace-link" @click="retry">
        {{ label('Retry', '重试') }}
      </button>
    </div>
    <div class="session-workspace">
      <section class="session-list workspace-panel" :aria-busy="resource.busy.value">
        <div class="session-summary">
          <strong>
            <AnimatedNumber
              :value="resource.ready.value ? resource.data.value.total : null"
              :format="{ compact: true }"
            />
            {{ label('main sessions', '个主会话') }}
          </strong>
          <span>
            {{ label('Total tokens', 'Token 总量') }}
            <AnimatedNumber
              :value="resource.ready.value ? resource.data.value.summary.totalTokens : null"
              :format="{ compact: true }"
            />
          </span>
          <span>
            {{ label('Estimated cost', '预估花费') }}
            <AnimatedCost :summary="resource.data.value.summary.costSummary" :note="false" />
          </span>
          <span v-if="resource.busy.value" class="loading-label" role="status">
            {{ label('Updating…', '更新中…') }}
          </span>
        </div>
        <ScrollRegion
          :key="state.collection"
          ref="scroller"
          page-key="sessions"
          :region="tabs.region(state.collection)"
          :ready="!resource.busy.value"
          :label="label('Session list', '会话列表')"
        >
          <SessionTable
            v-if="rows.length"
            :sessions="resource.data.value.items"
            :projects="metadata.data.value.projects"
            :selected-key="state.selected"
            :child-key="state.child"
            :expanded="state.expanded"
            :sort-by="state.sort"
            :direction="state.direction"
            @sort="sort"
            @toggle="toggle"
            @select="select"
          />
          <div v-else class="workspace-empty">
            <span class="material-symbols-outlined">chat_bubble</span>
            {{
              resource.busy.value
                ? label('Loading sessions…', '正在读取会话…')
                : state.collection === 'favorites'
                  ? label('No matching favorite sessions', '没有符合条件的收藏会话')
                  : label('No sessions in this range', '此范围内没有会话')
            }}
            <button
              v-if="!resource.busy.value"
              type="button"
              class="workspace-link"
              @click="scan.refresh()"
            >
              {{ label('Refresh local data', '刷新本地数据') }}
            </button>
          </div>
        </ScrollRegion>
        <PaginationBar
          v-model:page="state.page"
          v-model:page-size="state.size"
          :total="resource.data.value.total"
          :busy="resource.busy.value"
        />
      </section>
      <ScrollRegion
        page-key="sessions"
        region="detail"
        class="session-sidebar"
        axis="vertical"
        :label="label('Session details', '会话详情')"
      >
        <SessionDetailCard
          :session="selection"
          :project-name="selectedProject"
          :sources="selectedSources"
        />
      </ScrollRegion>
    </div>
  </PageSurface>
</template>

<style scoped>
.session-controls {
  margin-bottom: 24px;
  gap: 8px;
}
.session-controls :deep(.search-control) {
  width: 328px;
}
.session-workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 316px;
  gap: 24px;
}
.session-list {
  min-height: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
}
.session-summary {
  min-height: 50px;
  padding: 12px 16px;
  display: flex;
  gap: 20px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-muted);
}
.session-summary strong {
  font-size: 16px;
  font-weight: 500;
  color: var(--text);
}
.session-summary > span > :last-child {
  color: var(--text);
  margin-left: 4px;
}
.session-summary .loading-label {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-soft);
}
.session-list > :deep(.pagination-bar) {
  margin-inline: 16px;
  padding-inline: 0;
  flex: none;
}
.session-sidebar {
  scrollbar-gutter: auto;
}
.workspace-error {
  flex: none;
  margin-bottom: 12px;
  font-size: 13px;
}
@media (max-width: 1350px) {
  .session-controls :deep(.search-control) {
    width: 260px;
  }
  .session-controls :deep(.filter-select) {
    width: 130px;
  }
}
</style>
