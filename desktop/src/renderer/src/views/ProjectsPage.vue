<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import type {
  Overview,
  ProjectUsageStat,
  ProjectWorkspaceItem,
  ProjectWorkspacePage,
  SessionSort,
  SessionWorkspaceFilter,
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
import ProjectTable from '../components/agent/ProjectTable.vue'
import ProjectDetailCard from '../components/agent/ProjectDetailCard.vue'
import SessionDetailCard from '../components/agent/SessionDetailCard.vue'
import ProjectManagerModal from '../components/agent/ProjectManagerModal.vue'
import ProjectNotesDialog from '../components/agent/ProjectNotesDialog.vue'
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
import { sessionKey } from '../utils/session-display'
import { validDate } from '@shared/calendar-date'
const { label } = useI18n()
const route = useRoute()
const state = usePageState('projects', {
  range: presetRange('month'),
  query: '',
  submitted: '',
  collection: 'all',
  agents: [] as string[],
  models: [] as string[],
  sort: 'recent' as SessionSort,
  direction: 'desc' as 'asc' | 'desc',
  page: 1,
  size: 10,
  selected: '',
  session: '',
  expanded: [] as string[],
  pages: {} as Record<string, number>,
})
useRollingDateRange(state)
const tabs = useTableTabState('projects', () => state.collection, state, {
  page: 1,
  size: 10,
  sort: 'recent',
  direction: 'desc',
  selected: '',
  session: '',
  expanded: [],
  pages: {},
})
const scan = useScanStatus(),
  favorites = useLocalFavorites()
const { exchange } = useCostCurrency()
const revision = ref(0),
  manager = ref(false)
const editingNotes = shallowRef<ProjectWorkspaceItem | null>(null)
const sessions = shallowRef<Record<string, TokenUsageUserSession[]>>({})
const scroller = ref<InstanceType<typeof ScrollRegion> | null>(null)
const metadata = usePageResource(
  () => [scan.revision.value, revision.value],
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
const sessionFilter = computed<SessionWorkspaceFilter>(() => ({
  from: state.range.from || undefined,
  to: state.range.to || undefined,
  agents: [...state.agents],
  models: [...state.models],
  costExchangeRate: exchange.value.snapshot?.rates.CNY,
}))
const filter = computed<SessionWorkspaceFilter>(() => ({
  ...sessionFilter.value,
  query: state.submitted,
  onlyFavorites: state.collection === 'favorites',
  page: state.page,
  pageSize: state.size,
  sortBy: state.sort,
  sortDirection: state.direction,
}))
const empty: ProjectWorkspacePage = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 10,
  totalPages: 0,
  summary: { totalTokens: 0, apiCallCount: 0, apiCallCountComplete: true, sessionCount: 0 },
}
const resource = usePageResource(
  () => [filter.value, scan.revision.value, revision.value, favorites.items.value],
  () => window.api.getProjectWorkspace(filter.value),
  empty,
)
const selection = computed(
  () => resource.data.value.items.find((project) => project.projectId === state.selected) ?? null,
)
const selectedSession = computed(
  () =>
    sessions.value[state.selected]?.find((session) => sessionKey(session) === state.session) ??
    null,
)
const managedProjects = computed<ProjectUsageStat[]>(() =>
  metadata.data.value.projects.map((project) => ({
    projectId: project.id,
    name: project.name,
    path: project.path,
    source: project.source,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  })),
)
watch(
  () => resource.data.value,
  (value) => {
    if (value.page !== state.page) state.page = value.page
    if (!value.items.some((project) => project.projectId === state.selected)) {
      state.selected = value.items[0]?.projectId || ''
      state.session = ''
    }
  },
)
watch(
  () => [state.range, state.submitted, state.agents, state.models],
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
  () => [state.range, state.agents, state.models],
  () => {
    state.pages = {}
    state.session = ''
  },
  { deep: true, flush: 'sync' },
)
watch(
  () => state.page,
  () => {
    if (!tabs.switching.value) scroller.value?.scrollToTop()
  },
  { flush: 'sync' },
)
watch(
  () => route.fullPath,
  () => {
    if (route.path !== '/projects') return
    if (
      typeof route.query.from === 'string' &&
      typeof route.query.to === 'string' &&
      ((!route.query.from && !route.query.to) ||
        (validDate(route.query.from) &&
          validDate(route.query.to) &&
          route.query.from <= route.query.to))
    )
      state.range = {
        from: route.query.from,
        to: route.query.to,
        preset: route.query.from ? 'custom' : 'all',
      }
    if (typeof route.query.search === 'string') {
      state.query = state.submitted = route.query.search
      state.collection = 'all'
      state.agents = []
      state.models = []
    }
    if (typeof route.query.select === 'string') {
      state.selected = route.query.select
      state.session = ''
    }
  },
  { immediate: true },
)
function sort(key: SessionSort): void {
  state.direction = state.sort === key && state.direction === 'desc' ? 'asc' : 'desc'
  state.sort = key
}
function toggle(id: string): void {
  state.expanded = state.expanded.includes(id)
    ? state.expanded.filter((value) => value !== id)
    : [...state.expanded, id]
  if (!state.expanded.includes(id) && state.selected === id) state.session = ''
}
function select(project: ProjectWorkspaceItem, session?: TokenUsageUserSession): void {
  state.selected = project.projectId
  state.session = session ? sessionKey(session) : ''
}
function sessionPage(id: string, page: number): void {
  state.pages = { ...state.pages, [id]: page }
  if (state.selected === id) state.session = ''
}
function loaded(id: string, values: TokenUsageUserSession[]): void {
  sessions.value = { ...sessions.value, [id]: values }
}
function changed(): void {
  revision.value++
}
async function retry(): Promise<void> {
  await Promise.allSettled([resource.refresh(), metadata.refresh(), favorites.initialize()])
}
</script>
<template>
  <PageSurface page-key="projects" fixed>
    <div class="workspace-heading">
      <div>
        <h1>{{ label('Projects', '项目') }}</h1>
        <p>
          {{
            label(
              'See usage by project and expand to explore sessions.',
              '按项目看用量，展开查看所属会话',
            )
          }}
        </p>
      </div>
      <DateRangeControl v-model="state.range" />
    </div>
    <div class="workspace-controls project-controls">
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
          { value: 'all', label: label('All projects', '所有项目') },
          { value: 'favorites', label: label('Favorites', '收藏夹') },
        ]"
        :label="label('Project collection', '项目范围')"
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
      <button type="button" class="workspace-button" @click="manager = true">
        <span class="material-symbols-outlined" aria-hidden="true">tune</span>
        {{ label('Manage projects', '管理项目') }}
      </button>
    </div>
    <div
      v-if="resource.error.value || metadata.error.value || favorites.error.value"
      class="workspace-error project-error"
      role="alert"
    >
      {{ resource.error.value || metadata.error.value || favorites.error.value }}
      <button type="button" class="workspace-link" @click="retry">
        {{ label('Retry', '重试') }}
      </button>
    </div>
    <div class="project-workspace">
      <section class="project-list workspace-panel" :aria-busy="resource.busy.value">
        <div class="project-summary">
          <strong>
            <AnimatedNumber
              :value="resource.ready.value ? resource.data.value.total : null"
              :format="{ compact: true }"
            />
            {{ label('projects', '个项目') }}
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
          <span class="summary-sessions">
            {{ label('Sessions', '会话') }}
            <AnimatedNumber
              :value="resource.ready.value ? resource.data.value.summary.sessionCount : null"
              :format="{ compact: true }"
            />
          </span>
          <span v-if="resource.busy.value" role="status">{{ label('Updating…', '更新中…') }}</span>
        </div>
        <ScrollRegion
          :key="state.collection"
          ref="scroller"
          page-key="projects"
          :region="tabs.region(state.collection)"
          :ready="!resource.busy.value"
          :label="label('Project list', '项目列表')"
        >
          <ProjectTable
            v-if="resource.data.value.items.length"
            :projects="resource.data.value.items"
            :expanded="state.expanded"
            :pages="state.pages"
            :selected="state.selected"
            :selected-session="state.session"
            :sort="state.sort"
            :direction="state.direction"
            :session-filter="sessionFilter"
            :revision="scan.revision.value + revision"
            @sort="sort"
            @toggle="toggle"
            @select="select"
            @page="sessionPage"
            @loaded="loaded"
          />
          <div v-else class="workspace-empty">
            <span class="material-symbols-outlined">folder</span>
            {{
              resource.busy.value
                ? label('Loading projects…', '正在读取项目…')
                : state.collection === 'favorites'
                  ? label('No matching favorite projects', '没有符合条件的收藏项目')
                  : label('No matching projects', '没有符合条件的项目')
            }}
            <button type="button" class="workspace-link" @click="manager = true">
              {{ label('Manage project folders', '管理项目目录') }}
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
        page-key="projects"
        region="detail"
        class="project-sidebar"
        axis="vertical"
        :label="
          selectedSession
            ? label('Session details', '会话详情')
            : label('Project details', '项目详情')
        "
      >
        <SessionDetailCard
          v-if="selectedSession"
          :session="selectedSession"
          :project-name="selection?.name"
        />
        <ProjectDetailCard v-else :project="selection" @notes="editingNotes = $event" />
      </ScrollRegion>
    </div>
    <ProjectNotesDialog :project="editingNotes" @close="editingNotes = null" @saved="changed" />
    <ProjectManagerModal
      :open="manager"
      :projects="managedProjects"
      @close="manager = false"
      @changed="changed"
    />
  </PageSurface>
</template>
<style scoped>
.project-controls {
  gap: 8px;
  margin-bottom: 24px;
}
.project-controls :deep(.search-control) {
  width: 328px;
}
.project-controls > button .material-symbols-outlined {
  font-size: 18px;
}
.project-workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 316px;
  gap: 24px;
}
.project-list {
  min-height: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
}
.project-summary {
  min-height: 50px;
  padding: 12px 16px;
  display: flex;
  gap: 20px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-muted);
}
.project-summary strong {
  font-size: 16px;
  font-weight: 500;
  color: var(--text);
}
.project-summary > span > :last-child {
  color: var(--text);
  margin-left: 4px;
}
.summary-sessions {
  margin-left: auto;
}
.project-list > :deep(.pagination-bar) {
  margin-inline: 16px;
  padding-inline: 0;
  flex: none;
}
.project-sidebar {
  scrollbar-gutter: auto;
}
.project-error {
  flex: none;
  margin-bottom: 12px;
  font-size: 13px;
}
@media (max-width: 1350px) {
  .project-controls :deep(.search-control) {
    width: 260px;
  }
  .project-controls :deep(.filter-select) {
    width: 130px;
  }
}
</style>
