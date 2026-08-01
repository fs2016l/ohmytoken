<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useI18n } from '../../i18n/useI18n'
import { useLegendSelection } from '../../composables/useLegendSelection'
import { useChartRenderLifecycle } from '../../composables/useChartRenderLifecycle'
import LegendVisibilityButton from '../base/LegendVisibilityButton.vue'
import { showEmpty, useChartTheme } from '../../composables/useChartTheme'
import { getModelColor } from '../../config/agents'
import { formatTokens } from '../../utils/format'
import type { ModelStats } from '@shared/models'

interface Props {
  modelStats: ModelStats[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  openModel: [model: string]
  showAllUserSessions: []
  showAllApiRecords: []
}>()

const { label, tr } = useI18n()
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
let chart: echarts.ECharts | null = null

const htmlEscapeMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeTooltipHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => htmlEscapeMap[char])
}

const sortedModelNames = computed(() =>
  [...props.modelStats]
    .filter((model) => model.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model))
    .map((model) => model.model),
)

const legendItems = computed(() => sortedModelNames.value)
const legend = useLegendSelection(legendItems)
const legendVisibilityState = legend.visibilityState

function modelColor(modelName: string): string {
  return getModelColor(modelName, sortedModelNames.value)
}

function renderChart(): void {
  if (!chartRef.value) return
  showEmpty(chartRef.value, null)
  if (props.modelStats.length === 0 || !props.modelStats.some((model) => model.totalTokens > 0)) {
    if (chart) {
      chart.dispose()
      chart = null
    }
    showEmpty(chartRef.value, tr('noModelData'))
    return
  }
  if (chartRef.value.clientWidth === 0) return
  if (chart) chart.dispose()
  chart = echarts.init(chartRef.value)

  const modelsByName = new Map(props.modelStats.map((model) => [model.model, model]))
  const data = legendItems.value
    .filter((modelName) => legend.isSelected(modelName))
    .flatMap((modelName) => {
      const model = modelsByName.get(modelName)
      return model
        ? [
            {
              name: model.model,
              value: model.totalTokens,
              itemStyle: { color: modelColor(model.model) },
            },
          ]
        : []
    })

  if (data.length === 0) {
    chart.dispose()
    chart = null
    showEmpty(chartRef.value, label('All models are hidden.', '已隐藏全部模型。'))
    return
  }

  const modelTotal = data.reduce((sum, item) => sum + item.value, 0)
  const chartText = getChartText()
  const cc = getChartColors()

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: cc.tooltipBg,
      borderColor: cc.tooltipBorder,
      textStyle: { ...chartText, color: cc.tooltipText, fontSize: 12 },
      formatter: (p: unknown) => {
        const item = p as { name?: string; value?: number; percent?: number }
        const name = escapeTooltipHtml(item.name || '')
        const hint = escapeTooltipHtml(tr('clickToViewDetails'))
        return `${name}: ${formatTokens(item.value || 0)} (${(item.percent || 0).toFixed(1)}%)<br/>${hint}`
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
            cursor: 'default',
            style: {
              text: formatTokens(modelTotal),
              fill: cc.centerValue,
              fontFamily: chartText.fontFamily,
              fontSize: 18,
              fontWeight: 600,
              textAlign: 'center',
            },
            left: 'center',
          },
          {
            type: 'text',
            cursor: 'default',
            style: {
              text: getTotalLabel(),
              fill: cc.centerLabel,
              fontFamily: chartText.fontFamily,
              fontSize: 12,
              textAlign: 'center',
            },
            left: 'center',
            top: 24,
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
    const name = (params as { name?: string }).name
    if (name) emit('openModel', name)
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
    props.modelStats,
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
  <article class="panel chart-panel model-distribution-panel">
    <div class="panel-header">
      <h3>{{ tr('modelDistribution') }}</h3>
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
        v-for="model in legendItems"
        :key="model"
        class="legend-item"
        :class="{ active: legend.isSelected(model) }"
        type="button"
        @click="legend.toggle(model)"
      >
        <span class="legend-dot" :style="{ backgroundColor: modelColor(model) }"></span>
        <span>{{ model }}</span>
      </button>
    </div>
    <div class="chart-shell">
      <div ref="chartRef" class="chart chart-pie" :title="tr('clickToViewDetails')"></div>
    </div>
    <p class="chart-hint">{{ tr('clickToViewDetails') }}</p>
  </article>
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
  min-height: 360px;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border);
}

.panel-header h3 {
  margin: 0;
  color: var(--text);
  font-size: 24px;
  line-height: 32px;
  font-weight: var(--weight-semibold);
}

.panel-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
}

.panel-action-btn {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  color: var(--text-muted);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
}

.panel-action-btn:hover,
.panel-action-btn:focus-visible {
  color: var(--text);
  background: var(--surface-container-high);
  border-color: var(--border-strong);
}

.panel-action-btn:focus-visible,
.panel-icon-btn:focus-visible {
  outline: 1px solid var(--primary);
  outline-offset: 2px;
}

.panel-action-btn .material-symbols-outlined {
  color: var(--primary);
  font-size: 16px;
}

.panel-icon-btn {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  color: var(--text);
  background: transparent;
  border: 0;
  border-radius: 999px;
}

.panel-icon-btn:hover {
  background: var(--surface-container-high);
}

.panel-icon-btn .material-symbols-outlined {
  font-size: 18px;
}

.chart-shell {
  position: relative;
  width: 100%;
  min-height: 250px;
  flex: 1;
}

.chart,
.chart-pie {
  width: 100%;
  height: 282px;
}

.chart-hint {
  margin: -6px 0 10px;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

.chart-legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 14px;
  min-height: 28px;
  margin: -8px 0 8px;
  padding-right: 16px;
}

.distribution-legend {
  justify-content: center;
  margin: -2px 0 0;
  padding-right: 0;
}

.legend-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 8px;
  color: var(--text-soft);
  background: transparent;
  border: 0;
  font-size: 12px;
  font-weight: var(--weight-semibold);
  opacity: 1;
  cursor: pointer;
}

.legend-item.active {
  color: var(--text);
  opacity: 1;
}

.legend-item.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  border-radius: 999px;
  background: var(--primary);
}

.legend-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
}

:deep(.chart-empty) {
  position: absolute;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  color: var(--text-soft);
  font-size: 13px;
  text-align: center;
  pointer-events: none;
}

@media (max-width: 560px) {
  .chart,
  .chart-pie {
    height: 280px;
  }
}
</style>
