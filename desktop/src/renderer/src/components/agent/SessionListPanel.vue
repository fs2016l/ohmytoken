<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { UsageAnalyticsFilter } from '@shared/analytics'
import type {
  SessionSort,
  TokenUsageSession,
  TokenUsageUserSession,
  TrackedProject,
} from '@shared/models'
import SessionTable from './SessionTable.vue'
import SessionDetailCard from './SessionDetailCard.vue'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import ScrollRegion from '../base/ScrollRegion.vue'
import PaginationBar from '../base/PaginationBar.vue'
import { usePageResource } from '../../composables/usePageResource'
import { usePageState } from '../../composables/usePageState'
import { useScanStatus } from '../../composables/useScanStatus'
import { useLocalFavorites } from '../../composables/useLocalFavorites'
import { useCostCurrency } from '../../composables/useCostCurrency'
import { useI18n } from '../../i18n/useI18n'
import { sessionKey } from '../../utils/session-display'
const props = defineProps<{ filter: UsageAnalyticsFilter; pageKey: string }>()
const { label } = useI18n(),
  scan = useScanStatus(),
  favorites = useLocalFavorites(),
  { exchange } = useCostCurrency()
const state = usePageState(`${props.pageKey}:sessions`, {
  page: 1,
  size: 10,
  sort: 'recent' as SessionSort,
  direction: 'desc' as 'asc' | 'desc',
  expanded: [] as string[],
  selected: '',
  child: '',
})
const selected = ref<TokenUsageSession | null>(null),
  opened = ref(false)
const resource = usePageResource(
  () => [
    props.filter,
    state.page,
    state.size,
    state.sort,
    state.direction,
    scan.revision.value,
    favorites.items.value,
  ],
  () =>
    window.api.getSessionWorkspace({
      ...props.filter,
      page: state.page,
      pageSize: state.size,
      sortBy: state.sort,
      sortDirection: state.direction,
      costExchangeRate: exchange.value.snapshot?.rates.CNY,
    }),
  null as Awaited<ReturnType<Window['api']['getSessionWorkspace']>> | null,
)
const projects = usePageResource(
  () => scan.revision.value,
  () => window.api.projectsList(),
  [] as TrackedProject[],
)
const sessions = computed(() => resource.data.value?.items || [])
watch(
  () => resource.data.value?.page,
  (page) => {
    if (page) state.page = page
  },
)
watch(
  () => [props.filter, state.sort, state.direction, state.size],
  () => {
    state.page = 1
  },
  { deep: true },
)
function sort(value: SessionSort): void {
  state.direction = state.sort === value && state.direction === 'desc' ? 'asc' : 'desc'
  state.sort = value
}
function toggle(key: string): void {
  state.expanded = state.expanded.includes(key)
    ? state.expanded.filter((value) => value !== key)
    : [...state.expanded, key]
}
function select(session: TokenUsageUserSession, child?: TokenUsageSession): void {
  state.selected = sessionKey(session)
  state.child = child ? sessionKey(child) : ''
  selected.value = child || session
  opened.value = true
}
</script>
<template>
  <section class="workspace-table-frame recent-session-panel">
    <header>
      <h2>{{ label('Recent sessions', '最近会话') }}</h2>
      <span>{{ resource.data.value?.total || 0 }} {{ label('sessions', '个会话') }}</span>
    </header>
    <p v-if="resource.error.value" class="workspace-error" role="alert">
      {{ resource.error.value }}
      <button type="button" class="workspace-link" @click="resource.refresh()">
        {{ label('Retry', '重试') }}
      </button>
    </p>
    <ScrollRegion
      :page-key="pageKey"
      region="sessions"
      :label="label('Recent sessions', '最近会话')"
    >
      <SessionTable
        :sessions="sessions"
        :projects="projects.data.value"
        :selected-key="state.selected"
        :child-key="state.child"
        :expanded="state.expanded"
        :sort-by="state.sort"
        :direction="state.direction"
        @sort="sort"
        @toggle="toggle"
        @select="select"
      />
      <div v-if="!sessions.length" class="workspace-empty">
        {{
          resource.busy.value
            ? label('Loading…', '正在加载…')
            : label('No session details in this period', '此区间暂无会话明细')
        }}
      </div>
    </ScrollRegion>
    <PaginationBar
      v-model:page="state.page"
      v-model:page-size="state.size"
      :total="resource.data.value?.total || 0"
      :busy="resource.busy.value"
    />
    <WorkspaceDialog
      :open="opened"
      :title="label('Session details', '会话详情')"
      @close="opened = false"
    >
      <SessionDetailCard :session="selected" />
    </WorkspaceDialog>
  </section>
</template>
<style scoped>
.recent-session-panel {
  min-height: 340px;
  max-height: 660px;
}
header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
}
header h2 {
  font-size: 16px;
  font-weight: 500;
  margin: 0;
}
header > span {
  color: var(--text-soft);
  font-size: 12px;
}
</style>
