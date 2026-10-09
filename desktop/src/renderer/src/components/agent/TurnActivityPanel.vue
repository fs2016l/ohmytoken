<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { UsageTurnStats } from '@shared/models'
import { useI18n } from '../../i18n/useI18n'
import { useChartTheme } from '../../composables/useChartTheme'
import { useChartRenderLifecycle } from '../../composables/useChartRenderLifecycle'
import { chartMotion } from '../../config/motion'
import { agentColors, agentNames } from '../../config/agents'
import { formatNumber } from '../../utils/number-format'
import * as echarts from '../../utils/charts'

const props = defineProps<{ from: string; to: string; revision: string; pending?: boolean }>()
const { label } = useI18n()
const {
  currentLang,
  currentTheme,
  currentInterfaceFont,
  currentNumberFont,
  getChartColors,
  getChartText,
} = useChartTheme()
const groupBy = ref<'agent' | 'model'>('model')
const data = shallowRef<UsageTurnStats | null>(null)
const loading = ref(false)
const failed = ref(false)
const element = ref<HTMLElement>()
let chart: echarts.ECharts | null = null
let request = 0
const dimensions = computed(() =>
  Object.entries(data.value?.dimensions ?? {}).sort((a, b) => b[1] - a[1]),
)

async function refresh(): Promise<void> {
  const id = ++request
  loading.value = !props.pending
  failed.value = false
  data.value = null
  if (props.pending) return
  try {
    const result = await window.api.getUsageTurns({
      from: props.from,
      to: props.to,
      groupBy: groupBy.value,
    })
    if (id === request) data.value = result
  } catch {
    if (id === request) {
      failed.value = true
      data.value = null
    }
  } finally {
    if (id === request) loading.value = false
  }
}

function renderChart(): void {
  if (!element.value || !data.value || element.value.clientWidth === 0) return
  chart ??= echarts.init(element.value)
  const colors = getChartColors()
  const dates = data.value.days.map((day) => day.date)
  const byDay = new Map(data.value.days.map((day) => [day.date, day]))
  if (dates.length > 1) {
    const end = new Date(`${dates[dates.length - 1]}T12:00:00`)
    const cursor = new Date(`${dates[0]}T12:00:00`)
    dates.length = 0
    while (cursor <= end) {
      dates.push(
        `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
      )
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  const palette = ['#6860e5', '#2196e8', '#ed9855', '#42b997', '#d47bc7', '#8794b4']
  chart.setOption(
    {
      ...chartMotion(lifecycle.reduced.value),
      backgroundColor: 'transparent',
      textStyle: getChartText(),
      tooltip: {
        trigger: 'axis',
        renderMode: 'richText',
        valueFormatter: (value: unknown) =>
          formatNumber(typeof value === 'number' ? value : null, { compact: true }),
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.tooltipText },
      },
      legend: { type: 'scroll', bottom: 0, textStyle: { color: colors.text } },
      grid: { top: 14, left: 48, right: 18, bottom: 65 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { color: colors.text },
        axisLine: { lineStyle: { color: colors.axisLine } },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: {
          color: colors.text,
          formatter: (value: number) => formatNumber(value, { compact: true }),
        },
        splitLine: { lineStyle: { color: colors.splitLine } },
      },
      series: dimensions.value.map(([name], index) => ({
        id: name,
        name: groupBy.value === 'agent' ? agentNames[name] || name : name,
        type: 'line',
        symbol: dates.length === 1 ? 'circle' : 'none',
        data: dates.map((date) => ({ id: date, value: byDay.get(date)?.dimensions[name] ?? 0 })),
        lineStyle: { width: 2 },
        itemStyle: {
          color: groupBy.value === 'agent' ? agentColors[name] : palette[index % palette.length],
        },
      })),
    },
    { replaceMerge: ['series'] },
  )
}
const lifecycle = useChartRenderLifecycle(element, {
  render: renderChart,
  chart: () => chart,
  resize: () => chart?.resize(),
  dispose: () => {
    chart?.dispose()
    chart = null
  },
})
watch(() => [props.from, props.to, props.revision, props.pending, groupBy.value], refresh, {
  immediate: true,
})
watch(
  [data, currentLang, currentTheme, currentInterfaceFont, currentNumberFont],
  lifecycle.requestRender,
  { flush: 'post' },
)
onBeforeUnmount(() => {
  request++
})
</script>

<template>
  <section class="panel turn-activity" :aria-busy="loading || pending">
    <header>
      <div>
        <h3>{{ label('Conversation turns', '对话次数') }}</h3>
        <p>
          {{
            label(
              'User turns with recorded usage · Uses the date range above',
              '有用量记录的对话次数 · 跟随上方日期范围',
            )
          }}
        </p>
      </div>
      <div class="turn-controls">
        <button type="button" :aria-pressed="groupBy === 'model'" @click="groupBy = 'model'">
          {{ label('By model', '按模型') }}
        </button>
        <button type="button" :aria-pressed="groupBy === 'agent'" @click="groupBy = 'agent'">
          {{ label('By Agent', '按 Agent') }}
        </button>
      </div>
    </header>
    <div class="turn-total">
      <span>{{ label('Identified turns', '已识别对话次数') }}</span>
      <strong :title="data ? formatNumber(data.turns) : undefined">
        {{
          pending || loading
            ? '…'
            : failed || !data
              ? '—'
              : formatNumber(data.turns, { compact: true })
        }}
      </strong>
    </div>
    <p v-if="pending" role="status">
      {{
        label(
          'Turn counts will appear after this scan finishes.',
          '本轮扫描完成后自动显示对话次数。',
        )
      }}
    </p>
    <p v-else-if="loading" role="status">
      {{ label('Loading turn counts…', '正在加载对话次数…') }}
    </p>
    <p v-else-if="failed" role="status">
      {{
        label('Unable to read activity. Try refreshing.', '暂时无法读取对话次数，请刷新后重试。')
      }}
      <button type="button" @click="refresh">{{ label('Retry', '重试') }}</button>
    </p>
    <div v-show="data?.turns && !loading && !pending && !failed" ref="element" class="turn-chart" />
    <p v-if="!loading && !pending && data && !data.turns" class="turn-note">
      {{ label('No identified user turns in this range.', '当前范围暂无可确认的对话次数。') }}
    </p>
    <p class="turn-note">
      {{
        label(
          'Tool continuations and automatic child tasks do not add user turns. Each turn is attributed to its first recorded usage and model.',
          '工具续跑、自动子任务不增加对话次数。每次对话归属到首次产生用量的时间和模型。',
        )
      }}
      <template v-if="data?.unknownSessions">
        {{
          label(
            `${data.unknownSessions.toLocaleString()} sessions have incomplete turn evidence. Refresh all to recheck old data; unsupported source formats remain unknown.`,
            `${data.unknownSessions.toLocaleString()} 个会话的对话次数缺少完整依据；全量刷新可重新识别旧数据，无法确认的日志仍保留未知。`,
          )
        }}
      </template>
    </p>
  </section>
</template>

<style scoped>
.turn-activity {
  margin: 18px 0;
  padding: 24px;
}
header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
}
h3 {
  margin: 0 0 5px;
  font-size: 16px;
}
p,
.turn-total > span {
  margin: 0;
  color: var(--text-soft);
  font-size: 12px;
}
.turn-controls {
  display: flex;
  gap: 4px;
}
button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-soft);
  border-radius: 8px;
  cursor: pointer;
}
button[aria-pressed='true'] {
  color: var(--primary);
  border-color: var(--primary);
}
.turn-total {
  margin-top: 22px;
  display: grid;
  gap: 4px;
}
.turn-total strong {
  font-size: 28px;
  font-variant-numeric: tabular-nums;
}
.turn-chart {
  height: 245px;
  width: 100%;
}
.turn-note {
  margin-top: 14px;
  line-height: 1.7;
}
</style>
