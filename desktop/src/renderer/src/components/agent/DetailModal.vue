<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import { useBodyScrollLock } from '../../composables/useBodyScrollLock'
import { agentColors, agentNames } from '../../config/agents'
import { formatTokens, formatTokensOrDash } from '../../utils/format'
import ChildSessionList from './ChildSessionList.vue'
import PaginationBar from './PaginationBar.vue'
import type {
  DetailLevel,
  ModalMode,
  ProjectDetailDimension,
} from '../../composables/useAgentStats'
import type {
  AgentModelStats,
  ModelAgentStats,
  ProjectUsageDetail,
  TokenUsageApiCall,
  TokenUsageSession,
  TokenUsageUserSession,
} from '@shared/models'

interface Props {
  open: boolean
  mode: ModalMode
  selectedAgent: string
  selectedAgentName: string
  selectedModel: string
  agentModelData: AgentModelStats[]
  modelAgentData: ModelAgentStats[]
  selectedProjectId: string
  selectedProjectName: string
  projectDetailDimension: ProjectDetailDimension
  projectDetailData: ProjectUsageDetail
  loading: boolean
  detailLevel: DetailLevel
  sessionRows: TokenUsageUserSession[]
  apiCallRows: TokenUsageApiCall[]
  selectedSessionId: string
  detailPage: number
  detailPageSize: number
  detailTotal: number
  sessionSearchQuery: string
  modelColor: (modelName: string) => string
}

const props = defineProps<Props>()
useBodyScrollLock(() => props.open)
const emit = defineEmits<{
  close: []
  showSessionsForAgentModel: [agent: string, model: string]
  showSessionsForModelAgent: [model: string, agent: string]
  setProjectDetailDimension: [dimension: ProjectDetailDimension]
  showSessionsForProjectDimension: [dimension: ProjectDetailDimension, value: string]
  showApiCallsForSession: [session: TokenUsageUserSession]
  showFilteredUserSessions: []
  showFilteredApiRecords: []
  changeDetailPage: [page: number]
  changeDetailPageSize: [pageSize: number]
  backToDetailSummary: []
  backToSessionList: []
  updateSessionSearch: [value: string]
}>()

const { tr } = useI18n()
const summaryPage = ref(1)
const summaryPageSize = ref(10)
const activeProjectSummary = computed(() =>
  props.projectDetailDimension === 'model'
    ? props.projectDetailData.byModel
    : props.projectDetailData.byAgent,
)
const summaryTotal = computed(() => {
  if (props.mode === 'agent') return props.agentModelData.length
  if (props.mode === 'model') return props.modelAgentData.length
  return activeProjectSummary.value.length
})
const pagedAgentModelData = computed(() => {
  const start = (summaryPage.value - 1) * summaryPageSize.value
  return props.agentModelData.slice(start, start + summaryPageSize.value)
})
const pagedModelAgentData = computed(() => {
  const start = (summaryPage.value - 1) * summaryPageSize.value
  return props.modelAgentData.slice(start, start + summaryPageSize.value)
})
const pagedProjectModelData = computed(() => {
  const start = (summaryPage.value - 1) * summaryPageSize.value
  return props.projectDetailData.byModel.slice(start, start + summaryPageSize.value)
})
const pagedProjectAgentData = computed(() => {
  const start = (summaryPage.value - 1) * summaryPageSize.value
  return props.projectDetailData.byAgent.slice(start, start + summaryPageSize.value)
})

watch(
  () => [
    props.open,
    props.mode,
    props.selectedAgent,
    props.selectedModel,
    props.selectedProjectId,
    props.projectDetailDimension,
  ],
  () => {
    summaryPage.value = 1
  },
)
watch(summaryTotal, (total) => {
  const totalPages = Math.max(1, Math.ceil(total / summaryPageSize.value))
  if (summaryPage.value > totalPages) summaryPage.value = totalPages
})

function changeSummaryPageSize(pageSize: number): void {
  summaryPageSize.value = pageSize
  summaryPage.value = 1
}

const detailContext = computed(() => {
  if (props.detailLevel === 'summary') return ''
  const agentName =
    props.selectedAgentName || agentNames[props.selectedAgent] || props.selectedAgent
  const dimension =
    agentName && props.selectedModel
      ? `${agentName} / ${props.selectedModel}`
      : agentName || props.selectedModel
  if (props.mode !== 'project') return dimension
  return [props.selectedProjectName, dimension].filter(Boolean).join(' / ')
})

const hasGlobalContext = computed(
  () => !props.selectedAgent && !props.selectedModel && !props.selectedProjectId,
)

const modalTitle = computed(() => {
  if (props.detailLevel === 'sessions') {
    return detailContext.value
      ? `${detailContext.value} - ${tr('allUserSessions')}`
      : tr('allUserSessions')
  }
  if (props.detailLevel === 'apiCalls' && !props.selectedSessionId) {
    return detailContext.value
      ? `${detailContext.value} - ${tr('allApiRecords')}`
      : tr('allApiRecords')
  }
  if (props.mode === 'agent') {
    const agentName =
      props.selectedAgentName || agentNames[props.selectedAgent] || props.selectedAgent
    return agentName ? `${agentName} - ${tr('agentTokenDetails')}` : tr('agentTokenDetails')
  }
  if (props.mode === 'project') {
    return props.selectedProjectName
      ? `${props.selectedProjectName} - ${tr('projectTokenDetails')}`
      : tr('projectTokenDetails')
  }
  return props.selectedModel
    ? `${props.selectedModel} - ${tr('modelTokenDetails')}`
    : tr('modelTokenDetails')
})

const modalAccentColor = computed(() => {
  if (props.mode === 'agent') return agentColors[props.selectedAgent] || 'var(--primary)'
  if (props.mode === 'project') return 'var(--primary)'
  return props.selectedModel ? props.modelColor(props.selectedModel) : 'var(--primary)'
})

function compactId(value: string): string {
  if (!value) return '-'
  if (value.length <= 18) return value
  return `${value.slice(0, 10)}...${value.slice(-5)}`
}

function sessionTitle(item: TokenUsageSession): string {
  const title = item.title?.trim()
  return title || compactId(item.sessionId)
}

function hasSessionTitle(item: TokenUsageSession): boolean {
  return Boolean(item.title?.trim())
}

function sessionAriaLabel(item: TokenUsageSession): string {
  const sessionId = compactId(item.sessionId)
  if (hasSessionTitle(item))
    return `${tr('apiCallDetails')}: ${sessionTitle(item)}, ${tr('sessionId')} ${sessionId}`
  return `${tr('apiCallDetails')}: ${sessionId}`
}

function apiCallRole(item: TokenUsageApiCall): string {
  return item.role?.trim() || ''
}

function apiCallAriaLabel(item: TokenUsageApiCall): string {
  return `${tr('apiCallDetails')}: ${[
    formatMoment(item.timestamp),
    item.model,
    apiCallRole(item),
    item.apiCallId ? `${tr('apiCallId')} ${item.apiCallId}` : '',
    item.sessionId ? `${tr('sessionId')} ${compactId(item.sessionId)}` : '',
    item.rootSessionId ? `${tr('rootSessionId')} ${compactId(item.rootSessionId)}` : '',
    item.subAgentName ? `${tr('subAgentName')} ${item.subAgentName}` : '',
  ]
    .filter(Boolean)
    .join(' · ')}`
}

function formatMoment(value: string): string {
  if (!value) return '-'

  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    const pad = (part: number): string => String(part).padStart(2, '0')
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`
  }

  return value
    .replace('T', ' ')
    .replace(/\.\d+Z?$/, '')
    .replace(/Z$/, '')
}

function apiBackLabel(): string {
  return props.sessionRows.length > 0 ? tr('backToSessions') : tr('backToSummary')
}

function backFromLevel(): void {
  if (props.detailLevel === 'apiCalls') {
    if (props.sessionRows.length > 0) {
      emit('backToSessionList')
      return
    }
    emit('backToDetailSummary')
    return
  }
  emit('backToDetailSummary')
}

function onSearchInput(event: Event): void {
  emit('updateSessionSearch', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div v-if="open" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <h3>
          <span class="agent-dot" :style="{ backgroundColor: modalAccentColor }"></span>
          {{ modalTitle }}
        </h3>
        <div class="modal-header-actions">
          <div v-if="detailLevel === 'summary' && !hasGlobalContext" class="detail-shortcuts">
            <button
              v-if="mode === 'project'"
              class="modal-action-btn"
              :class="{ active: projectDetailDimension === 'model' }"
              type="button"
              :disabled="loading"
              @click="emit('setProjectDetailDimension', 'model')"
            >
              <span class="material-symbols-outlined">deployed_code</span>
              <span>{{ tr('byModelDistribution') }}</span>
            </button>
            <button
              v-if="mode === 'project'"
              class="modal-action-btn"
              :class="{ active: projectDetailDimension === 'agent' }"
              type="button"
              :disabled="loading"
              @click="emit('setProjectDetailDimension', 'agent')"
            >
              <span class="material-symbols-outlined">smart_toy</span>
              <span>{{ tr('byAgentDistribution') }}</span>
            </button>
            <button
              class="modal-action-btn"
              type="button"
              :title="tr('viewAllUserSessions')"
              :aria-label="tr('viewAllUserSessions')"
              :disabled="loading"
              @click="emit('showFilteredUserSessions')"
            >
              <span class="material-symbols-outlined">account_tree</span>
              <span>{{ tr('allUserSessions') }}</span>
            </button>
            <button
              class="modal-action-btn"
              type="button"
              :title="tr('viewAllApiRecords')"
              :aria-label="tr('viewAllApiRecords')"
              :disabled="loading"
              @click="emit('showFilteredApiRecords')"
            >
              <span class="material-symbols-outlined">dataset</span>
              <span>{{ tr('allApiRecords') }}</span>
            </button>
          </div>
          <button class="icon-btn" type="button" :aria-label="tr('close')" @click="emit('close')">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div v-if="detailLevel !== 'summary' && !hasGlobalContext" class="modal-nav">
        <button class="back-btn" type="button" @click="backFromLevel">
          <span class="material-symbols-outlined">arrow_back</span>
          {{ detailLevel === 'apiCalls' ? apiBackLabel() : tr('backToSummary') }}
        </button>
        <span v-if="detailContext" class="context-pill">{{ detailContext }}</span>
        <span
          v-if="detailLevel === 'apiCalls' && selectedSessionId"
          class="context-pill muted-pill"
        >
          {{ compactId(selectedSessionId) }}
        </span>
      </div>
      <div v-if="detailLevel === 'sessions'" class="session-search-wrap">
        <label class="session-search">
          <span class="material-symbols-outlined">search</span>
          <input
            :value="sessionSearchQuery"
            type="search"
            :aria-label="tr('sessionSearchPlaceholder')"
            :placeholder="tr('sessionSearchPlaceholder')"
            @input="onSearchInput"
          />
          <button
            v-if="sessionSearchQuery"
            class="search-clear"
            type="button"
            :aria-label="tr('clearSearch')"
            @click="emit('updateSessionSearch', '')"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </label>
        <span class="search-hint">{{ tr('searchMultipleHint') }}</span>
      </div>
      <div v-if="loading" class="modal-state">{{ tr('loading') }}</div>
      <template v-else-if="detailLevel === 'summary' && mode === 'agent'">
        <div v-if="agentModelData.length === 0" class="modal-state">
          {{ tr('noModelDataForAgent') }}
        </div>
        <div v-else class="modal-table-wrapper">
          <table class="modal-table">
            <thead>
              <tr>
                <th>{{ tr('model') }}</th>
                <th class="right">{{ tr('totalTokensCol') }}</th>
                <th class="right">{{ tr('inputTokens') }}</th>
                <th class="right">{{ tr('outputTokens') }}</th>
                <th class="right">{{ tr('cacheRead') }}</th>
                <th class="right">{{ tr('cacheWrite') }}</th>
                <th class="right">{{ tr('reasoning') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in pagedAgentModelData"
                :key="item.model"
                class="interactive-row"
                role="button"
                tabindex="0"
                :aria-label="`${tr('viewSessions')}: ${item.model}`"
                @click="emit('showSessionsForAgentModel', selectedAgent, item.model)"
                @keydown.enter.prevent="
                  emit('showSessionsForAgentModel', selectedAgent, item.model)
                "
                @keydown.space.prevent="
                  emit('showSessionsForAgentModel', selectedAgent, item.model)
                "
              >
                <td class="model-name">
                  <span>{{ item.model }}</span>
                  <span class="row-action">{{ tr('viewSessions') }}</span>
                </td>
                <td class="right token-total">{{ formatTokens(item.totalTokens) }}</td>
                <td class="right">{{ formatTokens(item.inputTokens) }}</td>
                <td class="right">{{ formatTokens(item.outputTokens) }}</td>
                <td class="right">{{ formatTokensOrDash(item.cacheReadTokens) }}</td>
                <td class="right">{{ formatTokensOrDash(item.cacheWriteTokens) }}</td>
                <td class="right">{{ formatTokensOrDash(item.reasoningTokens) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <PaginationBar
          v-if="agentModelData.length > 0"
          :page="summaryPage"
          :page-size="summaryPageSize"
          :total="agentModelData.length"
          @change-page="summaryPage = $event"
          @change-page-size="changeSummaryPageSize"
        />
      </template>
      <template v-else-if="detailLevel === 'summary' && mode === 'model'">
        <div v-if="modelAgentData.length === 0" class="modal-state">
          {{ tr('noAgentDataForModel') }}
        </div>
        <div v-else class="modal-table-wrapper">
          <table class="modal-table">
            <thead>
              <tr>
                <th>{{ tr('agents') }}</th>
                <th class="right">{{ tr('totalTokensCol') }}</th>
                <th class="right">{{ tr('inputTokens') }}</th>
                <th class="right">{{ tr('outputTokens') }}</th>
                <th class="right">{{ tr('cacheRead') }}</th>
                <th class="right">{{ tr('cacheWrite') }}</th>
                <th class="right">{{ tr('reasoning') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in pagedModelAgentData"
                :key="item.agent"
                class="interactive-row"
                role="button"
                tabindex="0"
                :aria-label="`${tr('viewSessions')}: ${agentNames[item.agent] || item.agent}`"
                @click="emit('showSessionsForModelAgent', selectedModel, item.agent)"
                @keydown.enter.prevent="
                  emit('showSessionsForModelAgent', selectedModel, item.agent)
                "
                @keydown.space.prevent="
                  emit('showSessionsForModelAgent', selectedModel, item.agent)
                "
              >
                <td>
                  <span
                    class="agent-badge"
                    :style="{
                      color: agentColors[item.agent] || '#cbc3d7',
                      borderColor: (agentColors[item.agent] || '#cbc3d7') + '66',
                      backgroundColor: (agentColors[item.agent] || '#cbc3d7') + '18',
                    }"
                  >
                    {{ agentNames[item.agent] || item.agent }}
                  </span>
                  <span class="row-action">{{ tr('viewSessions') }}</span>
                </td>
                <td class="right token-total">{{ formatTokens(item.totalTokens) }}</td>
                <td class="right">{{ formatTokens(item.inputTokens) }}</td>
                <td class="right">{{ formatTokens(item.outputTokens) }}</td>
                <td class="right">{{ formatTokensOrDash(item.cacheReadTokens) }}</td>
                <td class="right">{{ formatTokensOrDash(item.cacheWriteTokens) }}</td>
                <td class="right">{{ formatTokensOrDash(item.reasoningTokens) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <PaginationBar
          v-if="modelAgentData.length > 0"
          :page="summaryPage"
          :page-size="summaryPageSize"
          :total="modelAgentData.length"
          @change-page="summaryPage = $event"
          @change-page-size="changeSummaryPageSize"
        />
      </template>
      <template v-else-if="detailLevel === 'summary' && mode === 'project'">
        <div v-if="summaryTotal === 0" class="modal-state">
          {{ tr('noProjectData') }}
        </div>
        <div v-else class="modal-table-wrapper">
          <table v-if="projectDetailDimension === 'model'" class="modal-table">
            <thead>
              <tr>
                <th>{{ tr('model') }}</th>
                <th class="right">{{ tr('totalTokensCol') }}</th>
                <th class="right">{{ tr('inputTokens') }}</th>
                <th class="right">{{ tr('outputTokens') }}</th>
                <th class="right">{{ tr('cacheRead') }}</th>
                <th class="right">{{ tr('cacheWrite') }}</th>
                <th class="right">{{ tr('reasoning') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in pagedProjectModelData"
                :key="item.model"
                class="interactive-row"
                role="button"
                tabindex="0"
                :aria-label="`${tr('viewSessions')}: ${item.model}`"
                @click="emit('showSessionsForProjectDimension', 'model', item.model)"
                @keydown.enter.prevent="
                  emit('showSessionsForProjectDimension', 'model', item.model)
                "
                @keydown.space.prevent="
                  emit('showSessionsForProjectDimension', 'model', item.model)
                "
              >
                <td class="model-name">
                  <span>{{ item.model }}</span>
                  <span class="row-action">{{ tr('viewSessions') }}</span>
                </td>
                <td class="right token-total">{{ formatTokens(item.totalTokens) }}</td>
                <td class="right">{{ formatTokens(item.inputTokens) }}</td>
                <td class="right">{{ formatTokens(item.outputTokens) }}</td>
                <td class="right">{{ formatTokensOrDash(item.cacheReadTokens) }}</td>
                <td class="right">{{ formatTokensOrDash(item.cacheWriteTokens) }}</td>
                <td class="right">{{ formatTokensOrDash(item.reasoningTokens) }}</td>
              </tr>
            </tbody>
          </table>
          <table v-else class="modal-table">
            <thead>
              <tr>
                <th>{{ tr('agents') }}</th>
                <th class="right">{{ tr('totalTokensCol') }}</th>
                <th class="right">{{ tr('inputTokens') }}</th>
                <th class="right">{{ tr('outputTokens') }}</th>
                <th class="right">{{ tr('cacheRead') }}</th>
                <th class="right">{{ tr('cacheWrite') }}</th>
                <th class="right">{{ tr('reasoning') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in pagedProjectAgentData"
                :key="item.agent"
                class="interactive-row"
                role="button"
                tabindex="0"
                :aria-label="`${tr('viewSessions')}: ${agentNames[item.agent] || item.agent}`"
                @click="emit('showSessionsForProjectDimension', 'agent', item.agent)"
                @keydown.enter.prevent="
                  emit('showSessionsForProjectDimension', 'agent', item.agent)
                "
                @keydown.space.prevent="
                  emit('showSessionsForProjectDimension', 'agent', item.agent)
                "
              >
                <td>
                  <span
                    class="agent-badge"
                    :style="{
                      color: agentColors[item.agent] || '#cbc3d7',
                      borderColor: (agentColors[item.agent] || '#cbc3d7') + '66',
                      backgroundColor: (agentColors[item.agent] || '#cbc3d7') + '18',
                    }"
                  >
                    {{ agentNames[item.agent] || item.agent }}
                  </span>
                  <span class="row-action">{{ tr('viewSessions') }}</span>
                </td>
                <td class="right token-total">{{ formatTokens(item.totalTokens) }}</td>
                <td class="right">{{ formatTokens(item.inputTokens) }}</td>
                <td class="right">{{ formatTokens(item.outputTokens) }}</td>
                <td class="right">{{ formatTokensOrDash(item.cacheReadTokens) }}</td>
                <td class="right">{{ formatTokensOrDash(item.cacheWriteTokens) }}</td>
                <td class="right">{{ formatTokensOrDash(item.reasoningTokens) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <PaginationBar
          v-if="summaryTotal > 0"
          :page="summaryPage"
          :page-size="summaryPageSize"
          :total="summaryTotal"
          @change-page="summaryPage = $event"
          @change-page-size="changeSummaryPageSize"
        />
      </template>
      <template v-else-if="detailLevel === 'sessions'">
        <div v-if="sessionRows.length === 0" class="modal-state">{{ tr('noSessionData') }}</div>
        <div v-else class="detail-list">
          <article
            v-for="item in sessionRows"
            :key="`${item.agent}-${item.rootSessionId || item.sessionId}`"
            class="detail-card session-card"
          >
            <button
              class="session-card-summary"
              type="button"
              :aria-label="sessionAriaLabel(item)"
              @click="emit('showApiCallsForSession', item)"
            >
              <span class="detail-card-head">
                <span class="detail-card-title session-title">
                  <span class="material-symbols-outlined">forum</span>
                  <span class="session-title-stack">
                    <span class="session-title-primary" :title="sessionTitle(item)">
                      {{ sessionTitle(item) }}
                    </span>
                    <span
                      v-if="hasSessionTitle(item)"
                      class="session-title-secondary"
                      :title="item.sessionId"
                    >
                      {{ compactId(item.sessionId) }}
                    </span>
                  </span>
                </span>
                <span class="detail-card-meta">
                  {{ item.date }} · {{ tr('apiCalls') }} {{ item.apiCallCount }}
                </span>
              </span>
              <span class="metric-grid">
                <span class="metric primary-metric">
                  <span class="metric-label">{{ tr('totalTokensCol') }}</span>
                  <span class="metric-value">{{ formatTokens(item.totalTokens) }}</span>
                </span>
                <span class="metric">
                  <span class="metric-label">{{ tr('inputTokens') }}</span>
                  <span class="metric-value">{{ formatTokens(item.inputTokens) }}</span>
                </span>
                <span class="metric">
                  <span class="metric-label">{{ tr('outputTokens') }}</span>
                  <span class="metric-value">{{ formatTokens(item.outputTokens) }}</span>
                </span>
                <span class="metric">
                  <span class="metric-label">{{ tr('cacheRead') }}</span>
                  <span class="metric-value">{{ formatTokensOrDash(item.cacheReadTokens) }}</span>
                </span>
                <span class="metric">
                  <span class="metric-label">{{ tr('cacheWrite') }}</span>
                  <span class="metric-value">{{ formatTokensOrDash(item.cacheWriteTokens) }}</span>
                </span>
                <span class="metric">
                  <span class="metric-label">{{ tr('reasoning') }}</span>
                  <span class="metric-value">{{ formatTokensOrDash(item.reasoningTokens) }}</span>
                </span>
              </span>
              <span class="session-time">
                {{ formatMoment(item.startedAt) }} → {{ formatMoment(item.endedAt) }}
              </span>
              <span class="card-action">
                <span>{{ tr('apiCallDetails') }}</span>
                <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
              </span>
            </button>
            <ChildSessionList
              v-if="item.children.length > 0"
              :children="item.children"
              :owner-key="`${item.agent}-${item.rootSessionId || item.sessionId}`"
            />
          </article>
        </div>
        <PaginationBar
          v-if="detailTotal > 0"
          :page="detailPage"
          :page-size="detailPageSize"
          :total="detailTotal"
          :disabled="loading"
          @change-page="emit('changeDetailPage', $event)"
          @change-page-size="emit('changeDetailPageSize', $event)"
        />
      </template>
      <template v-else>
        <div v-if="apiCallRows.length === 0" class="modal-state">{{ tr('noApiCallData') }}</div>
        <div v-else class="detail-list">
          <article
            v-for="item in apiCallRows"
            :key="`${item.agent}-${item.rootSessionId || item.sessionId}-${item.apiCallId}`"
            class="detail-card api-card"
            :aria-label="apiCallAriaLabel(item)"
          >
            <div class="detail-card-head">
              <div class="detail-card-title">
                <span class="material-symbols-outlined">bolt</span>
                <span class="detail-title-text">{{ formatMoment(item.timestamp) }}</span>
              </div>
              <span class="api-meta-row">
                <span v-if="apiCallRole(item)" class="role-badge" :title="apiCallRole(item)">
                  {{ apiCallRole(item) }}
                </span>
                <span class="detail-card-meta">{{ item.model }}</span>
              </span>
            </div>
            <div class="api-context-row">
              <span class="context-chip" :title="item.apiCallId">
                <span class="context-chip-label">{{ tr('apiCallId') }}</span>
                <span class="context-chip-value">{{ compactId(item.apiCallId) }}</span>
              </span>
              <span v-if="item.sessionId" class="context-chip" :title="item.sessionId">
                <span class="context-chip-label">{{ tr('sessionId') }}</span>
                <span class="context-chip-value">{{ compactId(item.sessionId) }}</span>
              </span>
              <span v-if="item.rootSessionId" class="context-chip" :title="item.rootSessionId">
                <span class="context-chip-label">{{ tr('rootSessionId') }}</span>
                <span class="context-chip-value">{{ compactId(item.rootSessionId) }}</span>
              </span>
              <span v-if="item.subAgentName" class="context-chip" :title="item.subAgentName">
                <span class="context-chip-label">{{ tr('subAgentName') }}</span>
                <span class="context-chip-value">{{ item.subAgentName }}</span>
              </span>
            </div>
            <div class="metric-grid">
              <span class="metric primary-metric">
                <span class="metric-label">{{ tr('totalTokensCol') }}</span>
                <span class="metric-value">{{ formatTokens(item.totalTokens) }}</span>
              </span>
              <span class="metric">
                <span class="metric-label">{{ tr('inputTokens') }}</span>
                <span class="metric-value">{{ formatTokens(item.inputTokens) }}</span>
              </span>
              <span class="metric">
                <span class="metric-label">{{ tr('outputTokens') }}</span>
                <span class="metric-value">{{ formatTokens(item.outputTokens) }}</span>
              </span>
              <span class="metric">
                <span class="metric-label">{{ tr('cacheRead') }}</span>
                <span class="metric-value">{{ formatTokensOrDash(item.cacheReadTokens) }}</span>
              </span>
              <span class="metric">
                <span class="metric-label">{{ tr('cacheWrite') }}</span>
                <span class="metric-value">{{ formatTokensOrDash(item.cacheWriteTokens) }}</span>
              </span>
              <span class="metric">
                <span class="metric-label">{{ tr('reasoning') }}</span>
                <span class="metric-value">{{ formatTokensOrDash(item.reasoningTokens) }}</span>
              </span>
            </div>
          </article>
        </div>
        <PaginationBar
          v-if="detailTotal > 0"
          :page="detailPage"
          :page-size="detailPageSize"
          :total="detailTotal"
          :disabled="loading"
          @change-page="emit('changeDetailPage', $event)"
          @change-page-size="emit('changeDetailPageSize', $event)"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.66);
  backdrop-filter: blur(8px);
}

.modal-content {
  width: min(920px, 100%);
  height: min(760px, calc(100vh - 48px));
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-low);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
}

.modal-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.modal-header h3 {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--text);
  font-size: 17px;
}

.modal-header-actions,
.detail-shortcuts {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.modal-header-actions {
  flex: 0 0 auto;
  margin-left: auto;
}

.modal-action-btn {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  color: var(--text-muted);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
}

.modal-action-btn:hover:not(:disabled),
.modal-action-btn:focus-visible {
  color: var(--text);
  background: var(--surface-container-high);
  border-color: var(--border-strong);
}

.modal-action-btn.active {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--bg-base));
  border-color: color-mix(in srgb, var(--primary) 45%, var(--border));
}

.modal-action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.modal-action-btn .material-symbols-outlined {
  color: var(--primary);
  font-size: 17px;
}

.modal-state {
  flex: 1 1 auto;
  display: grid;
  place-items: center;
  padding: 44px 24px;
  color: var(--text-soft);
  text-align: center;
}

.modal-nav {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
}

.session-search-wrap {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
}

.session-search {
  min-width: 220px;
  flex: 1 1 420px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 10px;
  color: var(--text-soft);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 7px;
}

.session-search:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 14%, transparent);
}

.session-search > .material-symbols-outlined {
  flex: 0 0 auto;
  font-size: 18px;
}

.session-search input {
  min-width: 0;
  flex: 1;
  color: var(--text);
  background: transparent;
  border: 0;
  outline: 0;
}

.session-search input::-webkit-search-cancel-button {
  display: none;
}

.search-clear {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--text-soft);
  background: transparent;
  border: 0;
  border-radius: 999px;
}

.search-clear:hover {
  color: var(--text);
  background: var(--surface-container-high);
}

.search-clear .material-symbols-outlined {
  font-size: 17px;
}

.search-hint {
  flex: 0 1 auto;
  color: var(--text-soft);
  font-size: var(--type-caption);
  white-space: nowrap;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  color: var(--text-muted);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  font-weight: var(--weight-semibold);
}

.back-btn:hover {
  color: var(--text);
  background: var(--surface-container-high);
}

.back-btn .material-symbols-outlined {
  font-size: 18px;
}

.context-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  color: var(--text-soft);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: 12px;
}

.muted-pill {
  opacity: 0.72;
}

.modal-table-wrapper {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 20px 20px;
  overflow: auto;
}

.detail-list {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-auto-rows: max-content;
  align-content: start;
  gap: 12px;
  padding: 0 20px 20px;
  overflow-y: auto;
  overflow-x: hidden;
}

.detail-card {
  width: 100%;
  min-height: max-content;
  align-self: start;
  display: grid;
  gap: 12px;
  padding: 14px;
  color: var(--text-muted);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
}

:deep(.pagination-bar) {
  flex: 0 0 auto;
}

.session-card {
  transition:
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.session-card-summary {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 12px;
  padding: 0;
  color: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

.session-card:has(.session-card-summary:hover),
.session-card:has(.session-card-summary:focus-visible) {
  background: var(--surface-container);
  border-color: var(--border-strong);
  box-shadow: 0 10px 26px color-mix(in srgb, var(--primary) 6%, transparent);
}

.session-card-summary:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--primary) 68%, white);
  outline-offset: 2px;
}

.detail-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.detail-card-title {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: var(--weight-semibold);
}

.detail-card-title .material-symbols-outlined {
  flex: 0 0 auto;
  color: var(--primary);
  font-size: 18px;
}

.detail-title-text,
.session-title-primary,
.session-title-secondary,
.detail-card-meta,
.role-badge,
.context-chip-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-title {
  align-items: flex-start;
}

.session-title-stack {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.session-title-secondary {
  color: var(--text-soft);
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
}

.api-meta-row {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex: 0 1 auto;
}

.role-badge {
  display: inline-flex;
  align-items: center;
  max-width: 140px;
  min-height: 22px;
  padding: 0 7px;
  color: var(--text-soft);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
}

.detail-card-meta,
.session-time,
.card-action {
  color: var(--text-soft);
  font-size: 12px;
}

.detail-card-meta {
  flex: 0 1 auto;
  text-align: right;
}

.session-time {
  font-family: var(--font-number);
}

.api-context-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.context-chip {
  max-width: 100%;
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  color: var(--text-muted);
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: var(--type-caption);
}

.context-chip-label {
  flex: 0 0 auto;
  color: var(--text-soft);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 8px;
}

.metric {
  min-width: 0;
  display: grid;
  gap: 3px;
  padding: 8px;
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.metric-label {
  overflow: hidden;
  color: var(--text-soft);
  font-size: var(--type-caption);
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-value {
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-number);
  font-size: 13px;
  font-weight: var(--weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.primary-metric .metric-value {
  color: var(--primary);
}

.card-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  justify-self: end;
  color: var(--primary);
  font-weight: var(--weight-semibold);
}

.card-action .material-symbols-outlined {
  font-size: 16px;
  transition: transform 160ms ease;
}

.session-card-summary:hover .card-action .material-symbols-outlined {
  transform: translateX(2px);
}

.modal-table-wrapper::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.modal-table-wrapper::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 999px;
}

.modal-table {
  min-width: 780px;
}

.session-table {
  min-width: 1120px;
}

.api-table {
  min-width: 920px;
}

table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
}

th {
  padding: 12px 16px;
  color: var(--text-muted);
  background: var(--bg-base);
  border-bottom: 1px solid var(--border);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: var(--weight-semibold);
  text-align: left;
  text-transform: uppercase;
}

td {
  padding: 12px 16px;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}

tbody tr:hover td {
  background: var(--surface-container);
}

.interactive-row {
  cursor: pointer;
}

.interactive-row:focus-visible td {
  outline: 1px solid var(--primary);
  outline-offset: -1px;
  background: var(--surface-container);
}

.right {
  text-align: right;
}

.modal-table td.right {
  font-family: var(--font-number);
  font-variant-numeric: tabular-nums lining-nums;
  font-feature-settings:
    'tnum' 1,
    'lnum' 1;
}

.token-total {
  color: var(--primary);
}

.model-name {
  color: var(--text);
  font-family: var(--font-mono);
  font-weight: var(--weight-semibold);
}

.model-name span {
  display: inline-flex;
  vertical-align: middle;
}

.row-action {
  margin-left: 8px;
  color: var(--text-soft);
  font-family: var(--font-sans);
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.interactive-row:hover .row-action,
.interactive-row:focus-visible .row-action {
  opacity: 1;
}

.icon-btn {
  position: relative;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: 999px;
}

.icon-btn:hover {
  color: var(--text);
  background: var(--surface-container-high);
}

.agent-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex: 0 0 auto;
}

.agent-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  margin: 2px 4px 2px 0;
  padding: 0 8px;
  border: 1px solid;
  border-radius: 6px;
  font-size: 12px;
  background: transparent;
}

.agent-badge:hover {
  filter: brightness(1.18);
}

@media (max-width: 720px) {
  .modal-overlay {
    padding: 12px;
  }

  .modal-content {
    height: min(760px, calc(100vh - 24px));
    max-height: calc(100vh - 24px);
  }

  .modal-header,
  .modal-nav,
  .session-search-wrap,
  .detail-list,
  .modal-table-wrapper {
    padding-left: 12px;
    padding-right: 12px;
  }

  .modal-header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .modal-header-actions,
  .detail-shortcuts {
    max-width: 100%;
    flex-wrap: wrap;
  }

  .session-search-wrap {
    align-items: stretch;
    flex-direction: column;
  }

  .session-search {
    min-width: 0;
    flex-basis: auto;
  }

  .search-hint {
    white-space: normal;
  }

  .detail-card-head {
    display: grid;
  }

  .detail-card-meta {
    text-align: left;
  }

  .api-meta-row {
    justify-content: flex-start;
  }
}
</style>
