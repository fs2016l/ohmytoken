<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import { useBodyScrollLock } from '../../composables/useBodyScrollLock'
import { agentColors, agentNames } from '../../config/agents'
import { formatTokens, formatTokensOrDash } from '../../utils/format'
import PaginationBar from './PaginationBar.vue'
import type { DetailLevel, ModalMode } from '../../composables/useAgentStats'
import type {
  AgentModelStats,
  ModelAgentStats,
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
  loading: boolean
  detailLevel: DetailLevel
  sessionRows: TokenUsageUserSession[]
  apiCallRows: TokenUsageApiCall[]
  selectedSessionId: string
  detailPage: number
  detailPageSize: number
  detailTotal: number
  modelColor: (modelName: string) => string
}

const props = defineProps<Props>()
useBodyScrollLock(() => props.open)
const emit = defineEmits<{
  close: []
  showSessionsForAgentModel: [agent: string, model: string]
  showSessionsForModelAgent: [model: string, agent: string]
  showApiCallsForSession: [session: TokenUsageUserSession]
  showFilteredUserSessions: []
  showFilteredApiRecords: []
  changeDetailPage: [page: number]
  changeDetailPageSize: [pageSize: number]
  backToDetailSummary: []
  backToSessionList: []
}>()

const { tr } = useI18n()
const summaryPage = ref(1)
const summaryPageSize = ref(10)
const summaryTotal = computed(() =>
  props.mode === 'agent' ? props.agentModelData.length : props.modelAgentData.length,
)
const pagedAgentModelData = computed(() => {
  const start = (summaryPage.value - 1) * summaryPageSize.value
  return props.agentModelData.slice(start, start + summaryPageSize.value)
})
const pagedModelAgentData = computed(() => {
  const start = (summaryPage.value - 1) * summaryPageSize.value
  return props.modelAgentData.slice(start, start + summaryPageSize.value)
})

watch(
  () => [props.open, props.mode, props.selectedAgent, props.selectedModel],
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
  if (agentName && props.selectedModel) return `${agentName} / ${props.selectedModel}`
  return agentName || props.selectedModel
})

const hasGlobalContext = computed(() => !props.selectedAgent && !props.selectedModel)

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
  return props.selectedModel
    ? `${props.selectedModel} - ${tr('modelTokenDetails')}`
    : tr('modelTokenDetails')
})

const modalAccentColor = computed(() => {
  if (props.mode === 'agent') return agentColors[props.selectedAgent] || 'var(--primary)'
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
      <template v-else-if="detailLevel === 'summary'">
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
      <template v-else-if="detailLevel === 'sessions'">
        <div v-if="sessionRows.length === 0" class="modal-state">{{ tr('noSessionData') }}</div>
        <div v-else class="detail-list">
          <button
            v-for="item in sessionRows"
            :key="`${item.agent}-${item.rootSessionId}`"
            class="detail-card session-card"
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
            <span v-if="item.children.length > 0" class="child-session-list">
              <span class="child-session-heading">
                <span>{{ tr('childSessions') }}</span>
                <span>{{ item.children.length }}</span>
              </span>
              <span
                v-for="child in item.children"
                :key="`${child.agent}-${child.sessionId}`"
                class="child-session-row"
              >
                <span class="child-session-main">
                  <span class="child-session-title" :title="sessionTitle(child)">
                    {{ sessionTitle(child) }}
                  </span>
                  <span
                    v-if="hasSessionTitle(child)"
                    class="child-session-id"
                    :title="child.sessionId"
                  >
                    {{ compactId(child.sessionId) }}
                  </span>
                  <span
                    v-if="child.subAgentName"
                    class="sub-agent-pill"
                    :title="child.subAgentName"
                  >
                    {{ child.subAgentName }}
                  </span>
                </span>
                <span class="child-session-meta">
                  <span class="child-model" :title="child.model">{{ child.model }}</span>
                  <span>
                    {{ formatMoment(child.startedAt) }} → {{ formatMoment(child.endedAt) }}
                  </span>
                  <span>{{ tr('apiCalls') }} {{ child.apiCallCount }}</span>
                  <span class="child-token-total">{{ formatTokens(child.totalTokens) }}</span>
                </span>
              </span>
            </span>
            <span class="card-action">{{ tr('apiCallDetails') }}</span>
          </button>
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
  max-height: min(80vh, 760px);
  min-height: 0;
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

.modal-action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.modal-action-btn .material-symbols-outlined {
  color: var(--primary);
  font-size: 17px;
}

.modal-state {
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

button.detail-card {
  text-align: left;
  cursor: pointer;
}

button.detail-card:hover,
button.detail-card:focus-visible {
  background: var(--surface-container);
  border-color: var(--border-strong);
}

button.detail-card:focus-visible {
  outline: 1px solid var(--primary);
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
.child-session-title,
.child-session-id,
.sub-agent-pill,
.child-model,
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

.child-session-list {
  display: grid;
  gap: 8px;
  padding: 10px;
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.child-session-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
}

.child-session-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.6fr);
  gap: 8px;
  align-items: center;
  padding: 8px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.child-session-main {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.child-session-title {
  color: var(--text);
  font-size: 12px;
  font-weight: var(--weight-semibold);
}

.child-session-id {
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
}

.sub-agent-pill {
  max-width: 140px;
  min-height: 20px;
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  color: var(--primary);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
}

.child-session-meta {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 8px;
  color: var(--text-soft);
  font-size: var(--type-caption);
  text-align: right;
}

.child-token-total {
  color: var(--primary);
  font-family: var(--font-number);
  font-weight: var(--weight-semibold);
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
  justify-self: end;
  font-weight: var(--weight-semibold);
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

  .modal-header,
  .modal-nav,
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

  .detail-card-head {
    display: grid;
  }

  .detail-card-meta {
    text-align: left;
  }

  .api-meta-row {
    justify-content: flex-start;
  }

  .child-session-row,
  .child-session-meta {
    grid-template-columns: 1fr;
    text-align: left;
  }
}
</style>
