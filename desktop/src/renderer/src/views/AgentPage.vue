<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useI18n } from '../i18n/useI18n'
import { useAgentStats } from '../composables/useAgentStats'
import type { ScanMode } from '@shared/models'
import StatCardsGrid from '../components/agent/StatCardsGrid.vue'
import ControlBar from '../components/agent/ControlBar.vue'
import ScanErrorBanner from '../components/agent/ScanErrorBanner.vue'
import AgentPiePanel from '../components/agent/AgentPiePanel.vue'
import AgentTrendPanel from '../components/agent/AgentTrendPanel.vue'
import ModelPiePanel from '../components/agent/ModelPiePanel.vue'
import ModelTrendPanel from '../components/agent/ModelTrendPanel.vue'
import ModelTable from '../components/agent/ModelTable.vue'
import DetailModal from '../components/agent/DetailModal.vue'
import PageIntro from '../components/base/PageIntro.vue'

const { tr, label } = useI18n()

const {
  overview,
  overviewFixed,
  dailyStats,
  dailyModelStats,
  hourlyAgentStats,
  hourlyModelStats,
  modelStats,
  isScanning,
  scanResult,
  lastScanTime,
  comparisons,
  modelFilter,
  dateFrom,
  dateTo,
  showModal,
  modalMode,
  selectedAgent,
  selectedAgentName,
  agentModelData,
  selectedModel,
  modelAgentData,
  isLoadingDetail,
  detailLevel,
  sessionRows,
  apiCallRows,
  selectedSessionId,
  detailPage,
  detailPageSize,
  detailTotal,
  totalAgents,
  totalModels,
  todayUsage,
  weekUsage,
  monthUsage,
  lastScanDisplay,
  quickRange,
  filteredModels,
  singleDayRange,
  modelColor,
  refreshAll,
  performScan,
  setQuickRange,
  showAgentDetail,
  showModelDetail,
  showSessionsForAgentModel,
  showSessionsForModelAgent,
  showApiCallsForSession,
  showAllUserSessions,
  showAllApiRecords,
  showUserSessionsForCurrentSelection,
  showApiRecordsForCurrentSelection,
  changeDetailPage,
  changeDetailPageSize,
  backToDetailSummary,
  backToSessionList,
  closeModal,
} = useAgentStats()

function handleScan(mode: ScanMode): Promise<void> {
  return performScan(mode)
}

let initialRefreshTimer: number | null = null

onMounted(() => {
  initialRefreshTimer = window.setTimeout(() => {
    initialRefreshTimer = null
    void refreshAll()
  }, 300)
})

onUnmounted(() => {
  if (initialRefreshTimer !== null) window.clearTimeout(initialRefreshTimer)
})
</script>

<template>
  <main class="dashboard-content">
    <PageIntro
      icon="monitoring"
      :eyebrow="label('LOCAL USAGE', '本地用量')"
      :title="tr('pageTitle')"
      :subtitle="tr('pageSubtitle')"
    />

    <StatCardsGrid
      :overview-fixed="overviewFixed"
      :total-agents="totalAgents"
      :total-models="totalModels"
      :today-usage="todayUsage"
      :week-usage="weekUsage"
      :month-usage="monthUsage"
      :comparisons="comparisons"
    />

    <ControlBar
      v-model:date-from="dateFrom"
      v-model:date-to="dateTo"
      :quick-range="quickRange"
      :last-scan-display="lastScanDisplay"
      :is-scanning="isScanning"
      @set-quick-range="setQuickRange"
      @scan="handleScan"
    />

    <ScanErrorBanner :scan-result="scanResult" :last-scan-time="lastScanTime" />

    <section class="chart-grid primary-charts">
      <AgentPiePanel
        :overview="overview"
        @open-agent="showAgentDetail"
        @show-all-user-sessions="() => showAllUserSessions('agent')"
        @show-all-api-records="() => showAllApiRecords('agent')"
      />
      <AgentTrendPanel
        :daily-stats="dailyStats"
        :hourly-agent-stats="hourlyAgentStats"
        :single-day-range="singleDayRange"
        :date-from="dateFrom"
      />
    </section>

    <section class="chart-grid secondary-charts">
      <ModelPiePanel
        :model-stats="modelStats"
        @open-model="showModelDetail"
        @show-all-user-sessions="() => showAllUserSessions('model')"
        @show-all-api-records="() => showAllApiRecords('model')"
      />
      <ModelTrendPanel
        :daily-model-stats="dailyModelStats"
        :hourly-model-stats="hourlyModelStats"
        :model-stats="modelStats"
        :single-day-range="singleDayRange"
        :date-from="dateFrom"
      />
    </section>

    <ModelTable
      v-model:model-filter="modelFilter"
      :models="filteredModels"
      @open-agent="showAgentDetail"
    />
  </main>

  <DetailModal
    :open="showModal"
    :mode="modalMode"
    :selected-agent="selectedAgent"
    :selected-agent-name="selectedAgentName"
    :selected-model="selectedModel"
    :agent-model-data="agentModelData"
    :model-agent-data="modelAgentData"
    :loading="isLoadingDetail"
    :detail-level="detailLevel"
    :session-rows="sessionRows"
    :api-call-rows="apiCallRows"
    :selected-session-id="selectedSessionId"
    :detail-page="detailPage"
    :detail-page-size="detailPageSize"
    :detail-total="detailTotal"
    :model-color="modelColor"
    @show-sessions-for-agent-model="showSessionsForAgentModel"
    @show-sessions-for-model-agent="showSessionsForModelAgent"
    @show-api-calls-for-session="showApiCallsForSession"
    @show-filtered-user-sessions="showUserSessionsForCurrentSelection"
    @show-filtered-api-records="showApiRecordsForCurrentSelection"
    @change-detail-page="changeDetailPage"
    @change-detail-page-size="changeDetailPageSize"
    @back-to-detail-summary="backToDetailSummary"
    @back-to-session-list="backToSessionList"
    @close="closeModal"
  />
</template>

<style scoped>
:deep(.material-symbols-outlined) {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 20px;
  line-height: 1;
  letter-spacing: 0;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  font-feature-settings: 'liga';
  -webkit-font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
  font-variation-settings:
    'FILL' 0,
    'wght' 400,
    'GRAD' 0,
    'opsz' 24;
}

:deep(.filled-icon) {
  font-variation-settings:
    'FILL' 1,
    'wght' 500,
    'GRAD' 0,
    'opsz' 24;
}

:deep(button),
:deep(input) {
  font: inherit;
}

:deep(button) {
  cursor: pointer;
}

.dashboard-content {
  flex: 1;
}

.chart-grid {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(0, 2fr);
}

.secondary-charts {
  grid-template-columns: minmax(280px, 1fr) minmax(0, 2fr);
}

@media (max-width: 1120px) {
  .chart-grid,
  .secondary-charts {
    grid-template-columns: 1fr;
  }
}
</style>
