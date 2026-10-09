<script setup lang="ts">
import { computed } from 'vue'
import type {
  SessionSort,
  TokenUsageSession,
  TokenUsageUserSession,
  TrackedProject,
} from '@shared/models'
import FavoriteButton from '../base/FavoriteButton.vue'
import DropdownChevron from '../base/DropdownChevron.vue'
import GenerationMetrics from './GenerationMetrics.vue'
import UsageIdentity from './UsageIdentity.vue'
import UsageAmount from './UsageAmount.vue'
import UsageCalls from './UsageCalls.vue'
import WorkspaceSortHeader from './WorkspaceSortHeader.vue'
import { useI18n } from '../../i18n/useI18n'
import { useVisibleNow } from '../../composables/useVisibleNow'
import { displayRecentActivity, displayTimestamp } from '../../utils/date-range'
import { projectForPath, sessionChildren, sessionKey } from '../../utils/session-display'
import { sessionIdentity } from '../../utils/usage-identity'
const props = defineProps<{
  sessions: TokenUsageUserSession[]
  projects: TrackedProject[]
  selectedKey: string
  childKey: string
  expanded: string[]
  sortBy: SessionSort
  direction: 'asc' | 'desc'
}>()
const emit = defineEmits<{
  sort: [key: SessionSort]
  toggle: [key: string]
  select: [session: TokenUsageUserSession, child?: TokenUsageSession]
}>()
const { label } = useI18n()
const now = useVisibleNow()
const rows = computed(() =>
  props.sessions.flatMap((parent) => {
    const children = sessionChildren(parent.children)
    const key = sessionKey(parent)
    const row = {
      parent,
      session: parent as TokenUsageSession,
      key,
      parentKey: key,
      child: false,
      children,
      identity: sessionIdentity(parent),
    }
    return [
      row,
      ...(props.expanded.includes(key)
        ? children.map((session) => ({
            parent,
            session,
            key: sessionKey(session),
            parentKey: key,
            child: true,
            children: [],
            identity: sessionIdentity(
              session,
              parent.children.filter((source) => sessionKey(source) === sessionKey(session)),
            ),
          }))
        : []),
    ]
  }),
)
function project(session: TokenUsageSession): string {
  return (
    projectForPath(session.projectPath, props.projects)?.name ||
    session.projectPath?.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ||
    label('Unassigned', '未归属项目')
  )
}
function select(row: (typeof rows.value)[number]): void {
  emit('select', row.parent, row.child ? row.session : undefined)
}
</script>
<template>
  <table class="workspace-table usage-workspace-table sessions-table">
    <thead>
      <tr>
        <th class="favorite-cell">
          <span class="table-saved-label">{{ label('Saved', '收藏') }}</span>
        </th>
        <WorkspaceSortHeader
          class="title-column"
          :options="[{ key: 'title', label: label('Session', '会话') }]"
          :sort="sortBy"
          :direction="direction"
          @sort="emit('sort', $event)"
        />
        <WorkspaceSortHeader
          class="identity-column"
          :options="[
            { key: 'agent', label: 'Agent' },
            { key: 'model', label: label('Model', '模型') },
          ]"
          :sort="sortBy"
          :direction="direction"
          @sort="emit('sort', $event)"
        />
        <WorkspaceSortHeader
          class="amount-column"
          :options="[
            { key: 'tokens', label: 'Token', heading: label('Usage', '用量') },
            { key: 'cost', label: label('Cost', '费用') },
          ]"
          :sort="sortBy"
          :direction="direction"
          @sort="emit('sort', $event)"
        />
        <WorkspaceSortHeader
          class="calls-column"
          :options="[
            { key: 'calls', label: 'API', heading: label('Calls', '调用') },
            { key: 'turns', label: label('Turns', '对话') },
          ]"
          :sort="sortBy"
          :direction="direction"
          @sort="emit('sort', $event)"
        />
        <th class="generation-column">{{ label('Latest generation', '最近生成') }}</th>
        <WorkspaceSortHeader
          class="recent-column"
          :options="[{ key: 'recent', label: label('Recent activity', '最近活动') }]"
          :sort="sortBy"
          :direction="direction"
          @sort="emit('sort', $event)"
        />
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="row in rows"
        :key="row.key"
        :class="{
          'child-row': row.child,
          selected: selectedKey === row.parentKey && (row.child ? childKey === row.key : !childKey),
        }"
        @click="select(row)"
      >
        <td class="favorite-cell">
          <FavoriteButton
            v-if="!row.child"
            :target="{ type: 'session', agent: row.parent.agent, id: row.parent.rootSessionId }"
          />
        </td>
        <td class="session-title-cell">
          <div class="workspace-title-wrap">
            <template v-if="!row.child">
              <button
                v-if="row.children.length"
                type="button"
                class="workspace-expand expand-session"
                :aria-expanded="expanded.includes(row.key)"
                :aria-label="label('Toggle child sessions', '展开或收起子会话')"
                @click.stop="emit('toggle', row.key)"
              >
                <DropdownChevron :open="expanded.includes(row.key)" direction="right" />
              </button>
              <span v-else class="workspace-expand-spacer" />
            </template>
            <button
              type="button"
              class="workspace-row-title session-title"
              :class="{ 'child-title': row.child }"
              @click.stop="select(row)"
            >
              <b
                :title="
                  row.child
                    ? row.session.subAgentName || row.session.title
                    : row.session.title || row.parent.rootSessionId
                "
              >
                {{
                  row.child
                    ? '↳ ' +
                      (row.session.subAgentName ||
                        row.session.title ||
                        label('Child session', '子会话'))
                    : row.session.title || label('Untitled session', '未命名会话')
                }}
              </b>
              <small v-if="row.child">{{ row.session.sessionId }}</small>
              <small v-else>
                {{ project(row.session) }} ·
                {{
                  row.children.length
                    ? label(
                        row.children.length + ' child sessions',
                        row.children.length + ' 个子会话',
                      )
                    : label('Main session', '主会话')
                }}
              </small>
            </button>
          </div>
        </td>
        <td><UsageIdentity v-bind="row.identity" /></td>
        <td><UsageAmount :tokens="row.session.totalTokens" :cost="row.session.costSummary" /></td>
        <td>
          <UsageCalls
            :calls="row.session.apiCallCount"
            :complete="row.session.apiCallCountComplete"
            :turns="row.child ? undefined : row.session.turns"
          />
        </td>
        <td>
          <GenerationMetrics
            :sample="row.session.latestGeneration"
            :turn-first-token="row.session.latestTurnFirstToken"
            :agent="row.session.agent"
            stacked
          />
        </td>
        <td class="recent-cell" :title="displayTimestamp(row.session.endedAt)">
          {{ displayRecentActivity(row.session.endedAt, new Date(now)) }}
        </td>
      </tr>
    </tbody>
  </table>
</template>
<style src="./workspace-table.css" />
