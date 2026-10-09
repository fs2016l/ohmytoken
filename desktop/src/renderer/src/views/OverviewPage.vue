<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { UsageAnalytics } from '@shared/analytics'
import type { Overview } from '@shared/models'
import PageSurface from '../components/base/PageSurface.vue'
import DateRangeControl from '../components/base/DateRangeControl.vue'
import ChartColorControl from '../components/base/ChartColorControl.vue'
import SegmentedControl from '../components/base/SegmentedControl.vue'
import AnimatedNumber from '../components/base/AnimatedNumber.vue'
import AnimatedCost from '../components/base/AnimatedCost.vue'
import CardStatsFooter from '../components/base/CardStatsFooter.vue'
import UsageBars from '../components/agent/UsageBars.vue'
import OverviewUsageCard from '../components/agent/OverviewUsageCard.vue'
import ProjectButterfly from '../components/agent/ProjectButterfly.vue'
import { usePageState } from '../composables/usePageState'
import { usePageResource } from '../composables/usePageResource'
import { useScanStatus } from '../composables/useScanStatus'
import { useRollingDateRange } from '../composables/useRollingDateRange'
import { provideUsageBarHover } from '../composables/useUsageBarHover'
import { useI18n } from '../i18n/useI18n'
import { presetRange } from '../utils/date-range'
import { calendarDays, tokenBars } from '../utils/analytics-display'
const { label } = useI18n(),
  router = useRouter()
provideUsageBarHover()
const state = usePageState('overview', {
  range: presetRange('today'),
  activeDimension: 'models' as 'models' | 'agents',
  defaultsVersion: 0,
})
if (!state.defaultsVersion) {
  if (state.range.preset === 'month') state.range = presetRange('today')
  state.defaultsVersion = 1
}
useRollingDateRange(state)
const activeDimension = computed(() => (state.activeDimension === 'agents' ? 'agents' : 'models'))
const activeOptions = computed(() => [
  { value: 'models', label: label('Active models', '活跃模型') },
  { value: 'agents', label: label('Active agents', '活跃 Agent') },
])
const scan = useScanStatus()
const resource = usePageResource(
  () => [state.range, scan.revision.value],
  () =>
    window.api.getUsageAnalytics({
      from: state.range.from || undefined,
      to: state.range.to || undefined,
    }),
  null as UsageAnalytics | null,
)
const fixed = usePageResource(
  () => scan.revision.value,
  () => window.api.getOverview(),
  null as Overview | null,
)
const data = resource.data
const activeItems = computed(() => data.value?.[activeDimension.value].slice(0, 3) || [])
const days = computed(() => (data.value ? calendarDays(data.value.from, data.value.to) : []))
const peak = computed(() =>
  data.value ? Math.max(0, ...data.value.days.map((day) => day.total.tokens)) : null,
)
const activeDays = computed(
  () =>
    data.value?.days.filter((day) => day.total.tokens > 0 || day.total.calls > 0).length ?? null,
)
const rangeQuery = computed(() => ({ from: state.range.from, to: state.range.to }))
function analytics(): void {
  void router.push({ path: '/analytics', query: rangeQuery.value })
}
function projects(id?: string): void {
  const project = data.value?.projects.find((item) => item.id === id)
  void router.push({
    path: '/projects',
    query: {
      ...rangeQuery.value,
      ...(project ? { search: project.name, select: project.id } : {}),
    },
  })
}
function model(id: string): void {
  void router.push({
    path: `/analytics/models/${encodeURIComponent(id)}`,
    query: { ...rangeQuery.value, back: '/agent' },
  })
}
function openActive(id?: string): void {
  if (id && activeDimension.value === 'models') return model(id)
  void router.push({
    path: '/analytics',
    query: {
      ...rangeQuery.value,
      view: 'details',
      detail: id ? 'models' : activeDimension.value,
      agents: id || '',
      models: '',
      projects: '',
      search: '',
    },
  })
}
function fees(): void {
  void router.push({ path: '/analytics/fees', query: { ...rangeQuery.value, back: '/agent' } })
}
async function retry(): Promise<void> {
  await Promise.allSettled([resource.refresh(), fixed.refresh()])
}
</script>
<template>
  <PageSurface page-key="overview" class="overview-page">
    <div class="workspace-heading">
      <div>
        <div class="overview-title-row">
          <h1>{{ label('Overview', '概览') }}</h1>
          <ChartColorControl />
        </div>
        <p>
          {{
            label('Explore usage, models and projects by date.', '按日期范围查看用量、模型与项目')
          }}
        </p>
      </div>
      <DateRangeControl v-model="state.range" />
    </div>
    <p v-if="resource.error.value || fixed.error.value" class="workspace-error" role="alert">
      {{ resource.error.value || fixed.error.value }}
      <button type="button" class="workspace-link" @click="retry">
        {{ label('Retry', '重试') }}
      </button>
    </p>
    <div class="overview-top" :aria-busy="resource.busy.value">
      <section class="overview-figures workspace-panel">
        <header>
          <h2>{{ label('Period overview', '期间概况') }}</h2>
          <span>
            {{ label('All time', '累计') }}
            <AnimatedNumber :value="fixed.data.value?.grandTotal" :format="{ compact: true }" />
          </span>
        </header>
        <div class="period-figures">
          <div>
            <span>{{ label('Tokens in range', '区间用量') }}</span>
            <strong>
              <AnimatedNumber
                :value="data?.summary.totalTokens"
                :format="{ compact: true }"
                motion="digits"
              />
            </strong>
          </div>
          <button type="button" @click="fees">
            <span>{{ label('Est. cost', '预估花费') }}</span>
            <strong>
              <AnimatedCost
                :summary="data?.summary.costSummary"
                :estimate-mark="false"
                motion="digits"
              />
            </strong>
          </button>
          <div>
            <span>{{ label('Daily average', '日均用量') }}</span>
            <strong>
              <AnimatedNumber
                :value="data ? data.summary.totalTokens / Math.max(1, days.length) : null"
                :format="{ compact: true }"
                motion="digits"
              />
            </strong>
          </div>
          <div>
            <span>{{ label('Daily peak', '单日峰值') }}</span>
            <strong>
              <AnimatedNumber :value="peak" :format="{ compact: true }" motion="digits" />
            </strong>
          </div>
        </div>
        <CardStatsFooter
          :items="[
            { id: 'agents', label: 'Agent' },
            { id: 'models', label: label('Models', '模型') },
            { id: 'days', label: label('Active days', '活跃天数') },
          ]"
        >
          <template #agents>
            <AnimatedNumber :value="data?.agents.length" :format="{ decimals: 0 }">
              <template #leading>
                <i class="material-symbols-outlined" aria-hidden="true">code</i>
              </template>
            </AnimatedNumber>
          </template>
          <template #models>
            <AnimatedNumber :value="data?.models.length" :format="{ decimals: 0 }">
              <template #leading>
                <i class="material-symbols-outlined" aria-hidden="true">stacks</i>
              </template>
            </AnimatedNumber>
          </template>
          <template #days>
            <AnimatedNumber :value="activeDays" :format="{ decimals: 0 }">
              <template #leading>
                <i class="material-symbols-outlined" aria-hidden="true">calendar_month</i>
              </template>
            </AnimatedNumber>
          </template>
        </CardStatsFooter>
      </section>
      <section class="overview-rhythm workspace-panel">
        <header>
          <div>
            <h2>{{ label('Usage rhythm', '用量节奏') }}</h2>
            <p>
              {{ data?.from || '—' }} – {{ data?.to || '—' }} ·
              {{ label('Total tokens', 'Token 总量') }}
            </p>
          </div>
          <button type="button" class="workspace-link" @click="analytics">
            {{ label('Explore', '深入分析') }} ↗
          </button>
        </header>
        <div class="rhythm-plot">
          <UsageBars
            :points="tokenBars(data)"
            :weekday="state.range.preset === 'week'"
            :label="label('Tokens over the selected period', '选定区间 Token 用量趋势')"
          />
        </div>
      </section>
      <section class="overview-projects workspace-panel">
        <header>
          <h2>{{ label('Project usage', '项目用量') }}</h2>
          <button type="button" class="workspace-link" @click="projects()">
            {{ label('View projects', '查看项目') }} ↗
          </button>
        </header>
        <ProjectButterfly
          :projects="data?.projects || []"
          :model-usage="data?.projectModels || {}"
          :total-tokens="data?.summary.totalTokens"
          :cost-summary="data?.summary.costSummary"
          :from="data?.from"
          :to="data?.to"
          @select="projects"
        />
      </section>
    </div>
    <section class="overview-models">
      <header>
        <SegmentedControl
          v-model="state.activeDimension"
          appearance="light"
          class="active-dimension-control"
          :options="activeOptions"
          :label="label('Active usage', '活跃用量')"
        />
        <span>{{ label('Ranked by tokens in range', '按区间用量排序') }}</span>
        <button type="button" class="workspace-link" @click="openActive()">
          {{
            activeDimension === 'agents'
              ? label('All agents', '全部 Agent')
              : label('All models', '全部模型')
          }}
          ↗
        </button>
      </header>
      <div v-if="data && activeItems.length" class="model-cards">
        <!-- Ranked slots stay mounted so titles, numbers and charts can transition in place. -->
        <OverviewUsageCard
          v-for="(item, index) in activeItems"
          :key="index"
          :item="item"
          :kind="activeDimension"
          :data="data"
          @open="openActive(item.id)"
        />
      </div>
      <div v-else class="workspace-panel workspace-empty">
        <span class="material-symbols-outlined" aria-hidden="true">stacks</span>
        {{
          resource.busy.value
            ? label('Preparing usage statistics…', '正在整理用量统计…')
            : label('No usage in this period', '此区间暂无用量')
        }}
        <button
          v-if="!resource.busy.value"
          type="button"
          class="workspace-link"
          :disabled="scan.busy.value"
          @click="scan.refresh()"
        >
          {{ label('Scan local usage', '扫描本地用量') }}
        </button>
      </div>
    </section>
  </PageSurface>
</template>
<style scoped>
.overview-title-row {
  display: flex;
  align-items: center;
  gap: 20px;
}
.overview-page {
  scrollbar-gutter: auto;
}
.overview-page :deep(.page-surface-content) {
  padding-block: 24px;
}
.workspace-heading {
  min-height: 64px;
  align-items: center;
  margin-bottom: 32px;
}
.overview-top {
  display: grid;
  grid-template-columns: minmax(210px, 304fr) minmax(320px, 584fr) minmax(260px, 384fr);
  gap: 24px;
  margin-bottom: 32px;
}
.overview-top > section {
  height: 320px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 20px;
  border: 1px solid var(--border);
}
header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
header span,
header p {
  font-size: 12px;
  line-height: 18px;
  color: var(--text-soft);
}
header p {
  margin: 4px 0 0;
}
header .workspace-link {
  font-size: 11px;
  white-space: nowrap;
}
.overview-top header .workspace-link {
  min-height: 24px;
  line-height: 18px;
}
.overview-figures {
  justify-content: space-between;
}
.overview-figures header {
  align-items: center;
  flex-wrap: wrap;
}
.overview-figures header > span {
  font-size: 11px;
}
.period-figures {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px 8px;
  margin: 0;
}
.period-figures > div,
.period-figures > button {
  min-width: 0;
}
.period-figures > button {
  border: 0;
  padding: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: var(--text);
}
.period-figures > button:hover {
  color: var(--accent);
}
.period-figures > div > span,
.period-figures > button > span {
  display: block;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.period-figures strong {
  display: block;
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.period-figures :deep(.cost-value) {
  white-space: normal;
}
.rhythm-plot {
  flex: 1;
  min-height: 0;
  margin-top: 12px;
}
.overview-projects > header {
  margin-bottom: 4px;
}
.overview-models > header {
  align-items: center;
  min-height: var(--control-height);
  margin-bottom: 12px;
}
.overview-models > header .workspace-link {
  min-height: 28px;
  line-height: 18px;
}
.model-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}
.workspace-error {
  margin-bottom: 24px;
}
@media (max-width: 1350px) {
  .overview-top {
    grid-template-columns: minmax(200px, 0.85fr) minmax(300px, 1.35fr) minmax(240px, 1fr);
    gap: 16px;
  }
  .overview-top > section {
    padding: 16px;
  }
  .period-figures strong {
    font-size: 21px;
  }
  .period-figures > button strong {
    font-size: 18px;
  }
  .model-cards {
    gap: 16px;
  }
}
@media (max-width: 1150px) {
  .overview-top {
    grid-template-columns: 1fr 1.5fr;
  }
  .overview-projects {
    grid-column: 1 / -1;
  }
  .model-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
