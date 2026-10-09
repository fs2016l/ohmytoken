<script setup lang="ts">
import type { AnalyticsDimension, UsageAnalytics } from '@shared/analytics'
import { computed } from 'vue'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import AnimatedCost from '../base/AnimatedCost.vue'
import AnimatedBar from '../base/AnimatedBar.vue'
import RollingText from '../base/RollingText.vue'
import RollingMark from '../base/RollingMark.vue'
import CardStatsFooter from '../base/CardStatsFooter.vue'
import AgentMark from '../base/AgentMark.vue'
import ModelMark from '../base/ModelMark.vue'
import UsageBars from './UsageBars.vue'
import { useI18n } from '../../i18n/useI18n'
import { tokenBars } from '../../utils/analytics-display'
import { getAgentName } from '../../config/agents'
import { formatNumber } from '../../utils/number-format'
import { useChartTokens } from '../../composables/useChartTokens'
import { useChartColorMode } from '../../composables/useChartColorMode'
import { usePageResource } from '../../composables/usePageResource'
import { modelSeriesColor } from '../../utils/model-series-color'
const props = withDefaults(
  defineProps<{ item: AnalyticsDimension; data: UsageAnalytics; kind?: 'models' | 'agents' }>(),
  { kind: 'models' },
)
const emit = defineEmits<{ open: [] }>()
const { label } = useI18n()
const tokens = useChartTokens()
const { mode } = useChartColorMode()
const isAgent = computed(() => props.kind === 'agents')
const name = computed(() => (isAgent.value ? getAgentName(props.item.id) : props.item.name))
const scopeKey = computed(() => JSON.stringify([props.item.id, props.data.from, props.data.to]))
const scoped = usePageResource(
  () => (isAgent.value ? [props.item.id, props.data] : null),
  async () => {
    if (!isAgent.value) return null
    const key = scopeKey.value
    const data = await window.api.getUsageAnalytics({
      from: props.data.from,
      to: props.data.to,
      agent: props.item.id,
    })
    return { key, data }
  },
  null as { key: string; data: UsageAnalytics } | null,
)
const pendingScope = computed(() => isAgent.value && scoped.data.value?.key !== scopeKey.value)
const related = computed(() => {
  if (!isAgent.value)
    return (props.data.modelAgents[props.item.id] || []).map((agent) => ({
      ...agent,
      name: getAgentName(agent.id),
    }))
  return props.data.models
    .flatMap((model) => {
      const usage = props.data.modelAgents[model.id]?.find((agent) => agent.id === props.item.id)
      return usage ? [{ ...usage, id: model.id, name: model.name }] : []
    })
    .sort((a, b) => b.totalTokens - a.totalTokens || a.id.localeCompare(b.id))
})
const sources = computed(() => {
  const visible = related.value.slice(0, 3).map((source) => ({ ...source, other: false }))
  const remaining = related.value.slice(3)
  if (remaining.length)
    visible.push({
      ...remaining[0],
      id: 'source:other',
      name: label(`Other ${remaining.length}`, `其他 ${remaining.length}`),
      totalTokens: remaining.reduce((sum, source) => sum + source.totalTokens, 0),
      other: true,
    })
  return visible
})
const sourceColor = (id: string, index: number): string =>
  isAgent.value && mode.value === 'categorical'
    ? modelSeriesColor(id, tokens.value)
    : tokens.value[`--analytics-series-${(index % 5) + 1}` as keyof typeof tokens.value]
const points = computed((previous: ReturnType<typeof tokenBars> | undefined) => {
  if (!isAgent.value) return tokenBars(props.data, props.item.id)
  // Keep the painted chart while a new ranked Agent loads, then morph to its data.
  return pendingScope.value ? previous || [] : tokenBars(scoped.data.value?.data ?? null)
})
</script>
<template>
  <article class="overview-model workspace-panel" :data-dimension="kind" :data-usage-id="item.id">
    <button type="button" class="model-heading" :aria-label="name" @click="emit('open')">
      <span class="model-glyph" aria-hidden="true">
        <RollingMark :kind="kind" :value="isAgent ? item.id : item.name" :size="32" />
      </span>
      <b><RollingText :text="name" /></b>
      <span aria-hidden="true">↗</span>
    </button>
    <div class="model-figures">
      <div>
        <span>{{ label('Tokens in range', '区间用量') }}</span>
        <strong>
          <AnimatedNumber :value="item.totalTokens" :format="{ compact: true }" motion="digits" />
        </strong>
      </div>
      <div>
        <span>{{ label('Est. cost', '预估花费') }}</span>
        <strong>
          <AnimatedCost :summary="item.costSummary" :estimate-mark="false" motion="digits" />
        </strong>
      </div>
      <div>
        <span>{{ label('Share', '用量占比') }}</span>
        <strong>
          <AnimatedNumber
            :value="
              data.summary.totalTokens ? (item.totalTokens / data.summary.totalTokens) * 100 : 0
            "
            :format="{ percent: true }"
            motion="digits"
          />
        </strong>
      </div>
    </div>
    <div class="model-trend" :aria-busy="pendingScope">
      <UsageBars :points="points" :label="label(`${name} usage trend`, `${name} 用量趋势`)" mini />
      <p v-if="isAgent && scoped.error.value" class="trend-status" role="alert">
        {{ label('Trend update failed', '趋势更新失败') }} ·
        <button type="button" class="workspace-link" @click="scoped.refresh()">
          {{ label('Retry', '重试') }}
        </button>
      </p>
      <p v-else-if="pendingScope" class="trend-status" role="status">
        {{ label('Loading trend…', '正在读取趋势…') }}
      </p>
    </div>
    <div class="agent-source">
      <span>
        {{ isAgent ? label('Model sources', '模型来源') : label('Agent sources', 'Agent 来源') }}
      </span>
      <div class="source-bar">
        <AnimatedBar
          v-for="(source, index) in sources"
          :key="source.id"
          :value="1"
          :max="1"
          :style="{ flex: source.totalTokens || 0.000001 }"
          :color="source.other ? tokens['--analytics-series-other'] : sourceColor(source.id, index)"
        />
      </div>
      <div class="source-legend">
        <span
          v-for="source in sources"
          :key="source.id"
          :title="`${source.name} · ${formatNumber(source.totalTokens, { compact: true })}`"
        >
          <i v-if="source.other" :style="{ background: tokens['--analytics-series-other'] }" />
          <ModelMark v-else-if="isAgent" :model="source.id" :size="12" />
          <AgentMark v-else :agent="source.id" :size="12" />
          {{ source.name }}
          {{ formatNumber(item.totalTokens ? (source.totalTokens / item.totalTokens) * 100 : 0) }}%
        </span>
      </div>
    </div>
    <CardStatsFooter
      :items="[
        { id: 'sessions', label: label('sessions', '会话') },
        { id: 'calls', label: label('calls', '调用') },
        { id: 'sources', label: isAgent ? label('models', '模型') : 'Agent' },
      ]"
    >
      <template #sessions>
        <AnimatedNumber
          :prefix="!item.sessionCountComplete && item.sessionCount ? '≥' : ''"
          :value="item.sessionCountComplete || item.sessionCount ? item.sessionCount : null"
          :format="{ compact: true }"
        >
          <template #leading>
            <i class="material-symbols-outlined" aria-hidden="true">chat_bubble</i>
          </template>
        </AnimatedNumber>
      </template>
      <template #calls>
        <AnimatedNumber
          :prefix="!item.apiCallCountComplete && item.apiCallCount ? '≥' : ''"
          :value="item.apiCallCountComplete || item.apiCallCount ? item.apiCallCount : null"
          :format="{ compact: true }"
        >
          <template #leading>
            <i class="material-symbols-outlined" aria-hidden="true">bolt</i>
          </template>
        </AnimatedNumber>
      </template>
      <template #sources>
        <AnimatedNumber :value="related.length" :format="{ decimals: 0 }">
          <template #leading>
            <i class="material-symbols-outlined" aria-hidden="true">
              {{ isAgent ? 'stacks' : 'code' }}
            </i>
          </template>
        </AnimatedNumber>
      </template>
    </CardStatsFooter>
  </article>
</template>
<style scoped>
.overview-model {
  padding: 20px;
  border: 0;
  display: flex;
  flex-direction: column;
  /* Four smaller gaps make room for the stacked footer within the original card height. */
  gap: 8px;
}
.model-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--text);
  text-align: left;
}
.model-glyph {
  display: grid;
  place-items: center;
  flex: none;
}
.model-heading b {
  flex: 1;
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
}
.model-heading > span:last-child {
  color: var(--text-muted);
}
.model-figures {
  display: grid;
  grid-template-columns: minmax(0, 164fr) minmax(0, 112fr) minmax(0, 84fr);
  gap: 12px;
  min-height: 70px;
}
.model-figures > div {
  min-width: 0;
}
.model-figures > div > span {
  display: block;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-soft);
}
.model-figures strong {
  display: block;
  margin-top: 4px;
  font-size: 22px;
  line-height: 32px;
  font-weight: 600;
  white-space: nowrap;
}
.model-figures > div:first-child strong {
  font-size: 32px;
  line-height: 40px;
  letter-spacing: -0.6px;
}
.model-figures strong :deep(.animated-number) {
  font-size: inherit;
  color: var(--text);
}
.model-figures strong :deep(.cost-value) {
  white-space: normal;
}
.model-trend {
  position: relative;
  height: 110px;
  flex: none;
}
.model-trend[aria-busy='true'] :deep(.workspace-chart) {
  pointer-events: none;
}
.trend-status {
  position: absolute;
  inset: 0 0 auto;
  margin: 0;
  font-size: 11px;
  color: var(--text-soft);
  text-align: right;
}
.agent-source {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-soft);
}
.source-bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
}
.source-bar > :deep(.animated-bar) {
  border-radius: 0;
  transition: flex-grow var(--motion-number) var(--motion-ease);
}
.source-legend {
  display: flex;
  gap: 8px;
  font-size: 11px;
  line-height: 22px;
}
.source-legend > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source-legend i {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  margin-right: 4px;
}
@media (max-width: 1350px) {
  .model-figures {
    grid-template-columns: minmax(0, 148fr) minmax(0, 128fr) minmax(0, 84fr);
  }
  .model-figures strong {
    font-size: 16px;
  }
  .model-figures > div:first-child strong {
    font-size: 24px;
  }
}
</style>
