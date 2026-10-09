<script setup lang="ts">
import type {
  ProjectWorkspaceItem,
  SessionSort,
  SessionWorkspaceFilter,
  TokenUsageUserSession,
} from '@shared/models'
import FavoriteButton from '../base/FavoriteButton.vue'
import DropdownChevron from '../base/DropdownChevron.vue'
import ProjectSessionRows from './ProjectSessionRows.vue'
import UsageIdentity from './UsageIdentity.vue'
import UsageAmount from './UsageAmount.vue'
import UsageCalls from './UsageCalls.vue'
import WorkspaceSortHeader from './WorkspaceSortHeader.vue'
import { useI18n } from '../../i18n/useI18n'
import { useVisibleNow } from '../../composables/useVisibleNow'
import { displayRecentActivity, displayTimestamp } from '../../utils/date-range'
const props = defineProps<{
  projects: ProjectWorkspaceItem[]
  expanded: string[]
  pages: Record<string, number>
  selected: string
  selectedSession: string
  sort: SessionSort
  direction: 'asc' | 'desc'
  sessionFilter: SessionWorkspaceFilter
  revision: number
}>()
const emit = defineEmits<{
  sort: [key: SessionSort]
  toggle: [id: string]
  select: [project: ProjectWorkspaceItem, session?: TokenUsageUserSession]
  page: [id: string, page: number]
  loaded: [id: string, sessions: TokenUsageUserSession[]]
}>()
const { label } = useI18n()
const now = useVisibleNow()
</script>
<template>
  <table class="workspace-table usage-workspace-table projects-table">
    <thead>
      <tr>
        <th class="favorite-cell">
          <span class="table-saved-label">{{ label('Saved', '收藏') }}</span>
        </th>
        <WorkspaceSortHeader
          class="title-column"
          :options="[{ key: 'title', label: label('Project', '项目') }]"
          :sort="sort"
          :direction="direction"
          @sort="emit('sort', $event)"
        />
        <WorkspaceSortHeader
          class="identity-column"
          :options="[
            { key: 'agent', label: 'Agent' },
            { key: 'model', label: label('Model', '模型') },
          ]"
          :sort="sort"
          :direction="direction"
          @sort="emit('sort', $event)"
        />
        <WorkspaceSortHeader
          class="amount-column"
          :options="[
            { key: 'tokens', label: 'Token', heading: label('Usage', '用量') },
            { key: 'cost', label: label('Cost', '费用') },
          ]"
          :sort="sort"
          :direction="direction"
          @sort="emit('sort', $event)"
        />
        <WorkspaceSortHeader
          class="calls-column"
          :options="[
            { key: 'calls', label: 'API', heading: label('Calls', '调用') },
            { key: 'turns', label: label('Turns', '对话') },
          ]"
          :sort="sort"
          :direction="direction"
          @sort="emit('sort', $event)"
        />
        <WorkspaceSortHeader
          class="recent-column"
          :options="[{ key: 'recent', label: label('Recent activity', '最近活动') }]"
          :sort="sort"
          :direction="direction"
          @sort="emit('sort', $event)"
        />
      </tr>
    </thead>
    <tbody>
      <template v-for="project in props.projects" :key="project.projectId">
        <tr
          class="project-row"
          :data-project-id="project.projectId"
          :class="{ selected: selected === project.projectId && !selectedSession }"
          @click="emit('select', project)"
        >
          <td class="favorite-cell">
            <FavoriteButton :target="{ type: 'project', id: project.projectId }" />
          </td>
          <td>
            <div class="workspace-title-wrap">
              <button
                type="button"
                class="workspace-expand expand-project"
                :aria-expanded="expanded.includes(project.projectId)"
                :aria-label="
                  label(
                    'Toggle sessions in ' + project.name,
                    '展开或收起 ' + project.name + ' 的会话',
                  )
                "
                @click.stop="emit('toggle', project.projectId)"
              >
                <DropdownChevron :open="expanded.includes(project.projectId)" direction="right" />
              </button>
              <button
                type="button"
                class="workspace-row-title"
                @click.stop="emit('select', project)"
              >
                <b :title="project.name">{{ project.name }}</b>
                <small>
                  {{
                    label(
                      project.sessionCount + ' main sessions',
                      project.sessionCount + ' 个主会话',
                    )
                  }}
                  ·
                  {{
                    project.source === 'discovered'
                      ? label('Auto-detected', '自动识别')
                      : label('Manually added', '手动添加')
                  }}
                </small>
              </button>
            </div>
          </td>
          <td>
            <UsageIdentity
              :agents="project.agents"
              :models="project.models"
              :agent-totals="project.agentTotals"
              :model-totals="project.modelTotals"
            />
          </td>
          <td><UsageAmount :tokens="project.totalTokens" :cost="project.costSummary" /></td>
          <td>
            <UsageCalls
              :calls="project.apiCallCount"
              :complete="project.apiCallCountComplete"
              :turns="project.turns"
            />
          </td>
          <td class="recent-cell" :title="displayTimestamp(project.lastActivity)">
            {{ displayRecentActivity(project.lastActivity, new Date(now)) }}
          </td>
        </tr>
        <ProjectSessionRows
          v-if="expanded.includes(project.projectId)"
          :project-id="project.projectId"
          :page="pages[project.projectId] || 1"
          :filter="sessionFilter"
          :revision="revision"
          :selected-key="selected === project.projectId ? selectedSession : ''"
          @update:page="emit('page', project.projectId, $event)"
          @select="emit('select', project, $event)"
          @loaded="emit('loaded', project.projectId, $event)"
          @collapse="emit('toggle', project.projectId)"
        />
      </template>
    </tbody>
  </table>
</template>
<style src="./workspace-table.css" />
<style scoped>
.projects-table {
  min-width: 880px;
}
.projects-table :deep(.identity-column) {
  width: 208px;
}
.projects-table :deep(.amount-column),
.projects-table :deep(.calls-column) {
  width: 160px;
}
.projects-table :deep(.recent-column) {
  width: 114px;
}
</style>
