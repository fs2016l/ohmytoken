<script setup lang="ts">
import { watch } from 'vue'
import type {
  SessionWorkspaceFilter,
  SessionWorkspacePage,
  TokenUsageUserSession,
} from '@shared/models'
import UsageIdentity from './UsageIdentity.vue'
import UsageAmount from './UsageAmount.vue'
import UsageCalls from './UsageCalls.vue'
import { usePageResource } from '../../composables/usePageResource'
import { useI18n } from '../../i18n/useI18n'
import { sessionIdentity } from '../../utils/usage-identity'
import { useVisibleNow } from '../../composables/useVisibleNow'
import { displayRecentActivity, displayTimestamp } from '../../utils/date-range'
import { sessionChildren, sessionKey } from '../../utils/session-display'
const props = defineProps<{
  projectId: string
  page: number
  filter: SessionWorkspaceFilter
  revision: number
  selectedKey: string
}>()
const emit = defineEmits<{
  'update:page': [page: number]
  select: [session: TokenUsageUserSession]
  loaded: [sessions: TokenUsageUserSession[]]
  collapse: []
}>()
const { label } = useI18n()
const now = useVisibleNow()
const empty: SessionWorkspacePage = {
  items: [],
  total: 0,
  totalPages: 0,
  page: 1,
  pageSize: 4,
  summary: { totalTokens: 0, apiCallCount: 0, apiCallCountComplete: true },
}
const resource = usePageResource(
  () => [props.filter, props.page, props.revision, props.projectId],
  () =>
    window.api.getSessionWorkspace({
      ...props.filter,
      projectId: props.projectId,
      page: props.page,
      pageSize: 4,
      sortBy: 'recent',
      sortDirection: 'desc',
    }),
  empty,
)
watch(
  () => resource.data.value,
  (value) => {
    if (props.page !== value.page) emit('update:page', value.page)
    emit('loaded', value.items)
  },
)
</script>
<template>
  <tr
    v-for="session in resource.data.value.items"
    :key="sessionKey(session)"
    class="project-session-row"
    :class="{ selected: selectedKey === sessionKey(session) }"
    @click="emit('select', session)"
  >
    <td />
    <td>
      <button
        type="button"
        class="workspace-row-title project-session-title"
        @click.stop="emit('select', session)"
      >
        <b :title="session.title || session.sessionId">
          {{ session.title || label('Untitled session', '未命名会话') }}
        </b>
        <small>
          {{ label('Main session', '主会话') }} ·
          {{
            label(
              `${sessionChildren(session.children).length} child sessions`,
              `${sessionChildren(session.children).length} 个子会话`,
            )
          }}
        </small>
      </button>
    </td>
    <td><UsageIdentity v-bind="sessionIdentity(session)" /></td>
    <td><UsageAmount :tokens="session.totalTokens" :cost="session.costSummary" /></td>
    <td>
      <UsageCalls
        :calls="session.apiCallCount"
        :complete="session.apiCallCountComplete"
        :turns="session.turns"
      />
    </td>
    <td class="recent-cell" :title="displayTimestamp(session.endedAt)">
      {{ displayRecentActivity(session.endedAt, new Date(now)) }}
    </td>
  </tr>
  <tr v-if="resource.error.value" class="project-session-row">
    <td />
    <td colspan="5">
      <div class="workspace-error" role="alert">
        {{ resource.error.value }}
        <button type="button" class="workspace-link" @click="resource.refresh()">
          {{ label('Retry', '重试') }}
        </button>
      </div>
    </td>
  </tr>
  <tr v-else-if="!resource.data.value.items.length" class="project-session-row">
    <td />
    <td colspan="5" class="project-sessions-empty">
      {{
        resource.busy.value
          ? label('Loading sessions…', '正在读取会话…')
          : label('No sessions in this range', '此范围内没有会话')
      }}
    </td>
  </tr>
  <tr class="project-session-row">
    <td />
    <td colspan="5">
      <div class="project-sessions-footer">
        <button type="button" class="workspace-link" @click="emit('collapse')">
          {{ label('Collapse sessions', '收起会话') }}
        </button>
        <span v-if="resource.busy.value" role="status">{{ label('Updating…', '更新中…') }}</span>
        <span class="page-range">
          {{ resource.data.value.total ? (resource.data.value.page - 1) * 4 + 1 : 0 }}–{{
            Math.min(resource.data.value.page * 4, resource.data.value.total)
          }}
          / {{ resource.data.value.total }}
        </span>
        <button
          v-if="page > 1"
          type="button"
          class="workspace-button"
          :disabled="resource.busy.value"
          @click="emit('update:page', page - 1)"
        >
          {{ label('Previous', '上一页') }}
        </button>
        <button
          v-if="resource.data.value.totalPages > 1"
          type="button"
          class="workspace-button"
          :disabled="resource.busy.value || page >= resource.data.value.totalPages"
          @click="emit('update:page', page + 1)"
        >
          {{ label('Next', '下一页') }}
        </button>
      </div>
    </td>
  </tr>
</template>
<style scoped>
.project-session-title {
  padding-left: 24px;
}
.project-sessions-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 24px;
  font-size: 11px;
  color: var(--text-soft);
}
.project-sessions-footer .page-range {
  margin-left: auto;
}
.project-sessions-footer .workspace-button {
  height: 32px;
  font-size: 12px;
}
.project-sessions-empty {
  text-align: left;
}
</style>
