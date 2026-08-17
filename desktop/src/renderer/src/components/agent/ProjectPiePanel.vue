<script setup lang="ts">
import { computed, onDeactivated, ref, watch } from 'vue'
import * as echarts from 'echarts'
import type { ProjectUsageOverview } from '@shared/models'
import { useI18n } from '../../i18n/useI18n'
import { useChartRenderLifecycle } from '../../composables/useChartRenderLifecycle'
import { useLegendSelection } from '../../composables/useLegendSelection'
import { showEmpty, useChartTheme } from '../../composables/useChartTheme'
import { formatTokens } from '../../utils/format'
import LegendVisibilityButton from '../base/LegendVisibilityButton.vue'
import ProjectManagerModal from './ProjectManagerModal.vue'

const props = defineProps<{ overview: ProjectUsageOverview }>()
const emit = defineEmits<{
  openProject: [projectId: string]
  projectsChanged: []
  showAllUserSessions: []
  showAllApiRecords: []
}>()

const PROJECT_COLORS = ['#8b5cf6', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#e879f9', '#818cf8']

const { tr } = useI18n()
const {
  currentLang,
  currentTheme,
  currentInterfaceFont,
  currentNumberFont,
  getChartColors,
  getChartText,
  getTotalLabel,
} = useChartTheme()
const chartRef = ref<HTMLElement>()
const managerOpen = ref(false)
let chart: echarts.ECharts | null = null

const projectsWithData = computed(() =>
  props.overview.projects.filter((project) => project.totalTokens > 0),
)
const legendItems = computed(() => projectsWithData.value.map((project) => project.projectId))
const legend = useLegendSelection(legendItems)
const legendVisibilityState = legend.visibilityState

onDeactivated(() => {
  managerOpen.value = false
})

function projectColor(projectId: string): string {
  const index = props.overview.projects.findIndex((project) => project.projectId === projectId)
  return PROJECT_COLORS[(index < 0 ? 0 : index) % PROJECT_COLORS.length]
}

function projectName(projectId: string): string {
  return (
    props.overview.projects.find((project) => project.projectId === projectId)?.name || projectId
  )
}

function renderChart(): void {
  if (!chartRef.value) return
  showEmpty(chartRef.value, null)
  chart?.dispose()
  chart = null
  if (chartRef.value.clientWidth === 0) return

  if (projectsWithData.value.length === 0) {
    showEmpty(
      chartRef.value,
      props.overview.projects.length === 0 ? tr('noProjects') : tr('noProjectData'),
    )
    return
  }

  const visibleProjects = projectsWithData.value.filter((project) =>
    legend.isSelected(project.projectId),
  )
  if (visibleProjects.length === 0) {
    showEmpty(chartRef.value, tr('allProjectsHidden'))
    return
  }

  chart = echarts.init(chartRef.value)
  const cc = getChartColors()
  const chartText = getChartText()
  const total = visibleProjects.reduce((sum, project) => sum + project.totalTokens, 0)
  const data = visibleProjects.map((project) => ({
    name: project.name,
    value: project.totalTokens,
    projectId: project.projectId,
    itemStyle: { color: projectColor(project.projectId) },
  }))
  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      renderMode: 'richText',
      backgroundColor: cc.tooltipBg,
      borderColor: cc.tooltipBorder,
      textStyle: { ...chartText, color: cc.tooltipText, fontSize: 12 },
      padding: [10, 12],
      formatter: (value: unknown) => {
        const item = value as { name?: string; value?: number; percent?: number }
        return `${item.name || ''}: ${formatTokens(item.value || 0)} (${(item.percent || 0).toFixed(1)}%)\n${tr('clickToViewDetails')}`
      },
    },
    legend: { show: false },
    graphic: [
      {
        type: 'group',
        left: 'center',
        top: '40%',
        cursor: 'default',
        children: [
          {
            type: 'text',
            left: 'center',
            cursor: 'default',
            style: {
              text: formatTokens(total),
              fill: cc.centerValue,
              fontFamily: chartText.fontFamily,
              fontSize: 18,
              fontWeight: 600,
              textAlign: 'center',
            },
          },
          {
            type: 'text',
            left: 'center',
            top: 24,
            cursor: 'default',
            style: {
              text: getTotalLabel(),
              fill: cc.centerLabel,
              fontFamily: chartText.fontFamily,
              fontSize: 12,
              textAlign: 'center',
            },
          },
        ],
      },
    ],
    series: [
      {
        type: 'pie',
        cursor: 'pointer',
        radius: ['48%', '72%'],
        center: ['50%', '48%'],
        data,
        minAngle: 8,
        label: { show: false },
        itemStyle: { borderRadius: 4, borderColor: cc.pieBorder, borderWidth: 2 },
        emphasis: {
          itemStyle: { shadowBlur: 18, shadowColor: cc.pieEmphasisShadow },
          scaleSize: 5,
        },
      },
    ],
  })
  chart.on('click', (params: unknown) => {
    const projectId = (params as { data?: { projectId?: string } }).data?.projectId
    if (projectId) emit('openProject', projectId)
  })
}

const { requestRender } = useChartRenderLifecycle(chartRef, {
  render: renderChart,
  resize: () => chart?.resize(),
  dispose: () => {
    chart?.dispose()
    chart = null
  },
})

watch(
  () => [
    props.overview,
    legend.selected.value,
    currentTheme.value,
    currentLang.value,
    currentInterfaceFont.value,
    currentNumberFont.value,
  ],
  requestRender,
  { deep: true },
)
</script>

<template>
  <article class="panel chart-panel project-panel">
    <div class="panel-header">
      <div class="panel-title-group">
        <h3>{{ tr('projectDistribution') }}</h3>
        <button
          class="manage-project-button"
          type="button"
          :title="tr('manageProjects')"
          :aria-label="tr('manageProjects')"
          @click="managerOpen = true"
        >
          <span class="material-symbols-outlined">folder_managed</span>
          <span>{{ tr('manageProjectsShort') }}</span>
        </button>
      </div>
      <div class="panel-actions">
        <button
          class="panel-action-btn"
          type="button"
          :title="tr('viewAllUserSessions')"
          :aria-label="tr('viewAllUserSessions')"
          @click="emit('showAllUserSessions')"
        >
          <span class="material-symbols-outlined">account_tree</span>
          <span>{{ tr('allUserSessions') }}</span>
        </button>
        <button
          class="panel-action-btn"
          type="button"
          :title="tr('viewAllApiRecords')"
          :aria-label="tr('viewAllApiRecords')"
          @click="emit('showAllApiRecords')"
        >
          <span class="material-symbols-outlined">dataset</span>
          <span>{{ tr('allApiRecords') }}</span>
        </button>
        <LegendVisibilityButton :state="legendVisibilityState" @toggle="legend.toggleAll" />
      </div>
    </div>

    <div class="chart-legend distribution-legend">
      <button
        v-for="projectId in legendItems"
        :key="projectId"
        class="legend-item"
        :class="{ active: legend.isSelected(projectId) }"
        type="button"
        @click="legend.toggle(projectId)"
      >
        <span class="legend-dot" :style="{ backgroundColor: projectColor(projectId) }"></span>
        <span>{{ projectName(projectId) }}</span>
      </button>
    </div>

    <div class="chart-shell">
      <div ref="chartRef" class="chart chart-pie" :title="tr('clickToViewDetails')"></div>
    </div>
    <p class="chart-hint">{{ tr('clickToViewDetails') }}</p>
  </article>

  <ProjectManagerModal
    :open="managerOpen"
    :projects="overview.projects"
    @close="managerOpen = false"
    @changed="emit('projectsChanged')"
  />
</template>

<style scoped>
.panel {
  min-width: 0;
  padding: 16px;
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
}

.chart-panel {
  min-height: 420px;
  display: flex;
  flex-direction: column;
}

.project-panel {
  container-type: inline-size;
}

.panel-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border);
}

.panel-title-group {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.panel-header h3 {
  margin: 0;
  color: var(--text);
  font-size: 24px;
  line-height: 32px;
  font-weight: var(--weight-semibold);
  white-space: nowrap;
}

.manage-project-button,
.panel-action-btn {
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

.manage-project-button {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 9%, var(--bg-base));
  border-color: color-mix(in srgb, var(--primary) 28%, var(--border));
}

.manage-project-button:hover,
.panel-action-btn:hover,
.manage-project-button:focus-visible,
.panel-action-btn:focus-visible {
  color: var(--text);
  background: var(--surface-container-high);
  border-color: color-mix(in srgb, var(--primary) 48%, var(--border));
}

.manage-project-button .material-symbols-outlined,
.panel-action-btn .material-symbols-outlined {
  color: var(--primary);
  font-size: 16px;
}

.panel-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
}

.chart-legend {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 14px;
  min-height: 26px;
  margin: 0 0 2px;
}

.legend-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 7px;
  color: var(--text-soft);
  background: transparent;
  border: 0;
  font-size: 12px;
  font-weight: var(--weight-semibold);
}

.legend-item.active {
  color: var(--text);
}

.legend-item.active::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: 2px;
  background: var(--primary);
  border-radius: 999px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
}

.chart-shell {
  position: relative;
  min-height: 250px;
  flex: 1;
}

.chart,
.chart-pie {
  width: 100%;
  height: 282px;
}

.chart-hint {
  margin: -6px 0 2px;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

:deep(.chart-empty) {
  position: absolute;
  inset: 50% auto auto 50%;
  width: min(300px, 82%);
  transform: translate(-50%, -50%);
  color: var(--text-soft);
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
}

@media (max-width: 640px) {
  .panel-title-group {
    width: 100%;
    justify-content: space-between;
  }
}

@container (max-width: 520px) and (min-width: 431px) {
  .panel-header {
    gap: 8px;
  }

  .panel-title-group {
    gap: 6px;
  }

  .manage-project-button,
  .panel-action-btn {
    padding-inline: 7px;
  }

  .panel-actions {
    flex-wrap: nowrap;
    gap: 4px;
  }
}

@container (max-width: 430px) {
  .panel-header {
    grid-template-columns: minmax(0, 1fr);
    align-items: flex-start;
    gap: 9px;
  }

  .panel-title-group {
    width: 100%;
    justify-content: flex-start;
  }

  .panel-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
