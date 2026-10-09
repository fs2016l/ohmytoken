<script setup lang="ts">
import { computed } from 'vue'
import type { AnalyticsDimension, UsageAnalytics } from '@shared/analytics'
import { combineCostRollups } from '@shared/cost-rollup'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import AnimatedBar from '../base/AnimatedBar.vue'
import AnimatedCost from '../base/AnimatedCost.vue'
import RollingText from '../base/RollingText.vue'
import SegmentedControl from '../base/SegmentedControl.vue'
import AgentMark from '../base/AgentMark.vue'
import ModelMark from '../base/ModelMark.vue'
import { useI18n } from '../../i18n/useI18n'
import { getAgentName } from '../../config/agents'
const props = defineProps<{ data: UsageAnalytics | null }>()
const dimension = defineModel<'projects' | 'agents' | 'models'>({ required: true })
const emit = defineEmits<{ details: [] }>()
const { label } = useI18n()
const options = computed(() => [
  { value: 'projects', label: label('Projects', '项目') },
  { value: 'agents', label: 'Agent' },
  { value: 'models', label: label('Models', '模型') },
])
const rows = computed(() => {
  const values = props.data?.[dimension.value] || [],
    named = values.filter((value) => !!value.id).slice(0, 3)
  const other = values.filter((value) => !named.includes(value)),
    costs = other.flatMap((value) => (value.costSummary ? [value.costSummary] : []))
  return [
    ...named.map((value) => ({
      ...value,
      name: dimension.value === 'agents' ? getAgentName(value.id) : value.name,
    })),
    {
      id: '__other',
      name: label('Other', '其他'),
      totalTokens: other.reduce((sum, value) => sum + value.totalTokens, 0),
      costSummary:
        costs.length === other.length
          ? combineCostRollups(costs, costs[0]?.catalogVersion || '')
          : undefined,
    } as AnalyticsDimension,
  ]
})
</script>
<template>
  <section class="workspace-panel usage-sources">
    <header>
      <h2>{{ label('Usage sources', '用量来源') }}</h2>
      <SegmentedControl
        v-model="dimension"
        appearance="light"
        :options="options"
        :label="label('Source dimension', '来源维度')"
      />
      <button type="button" class="workspace-link" @click="emit('details')">
        {{ label('View details', '查看明细') }} →
      </button>
    </header>
    <div class="source-labels">
      <span />
      <span />
      <span>Token</span>
      <span>{{ label('Share', '占比') }}</span>
      <span>{{ label('Est. cost', '预估花费') }}</span>
    </div>
    <!-- Keep each presentation rank mounted when the source dimension or ranking changes. -->
    <div v-for="(row, rank) in rows" :key="rank" class="source-row">
      <span class="source-name">
        <AgentMark
          v-if="dimension === 'agents' && row.id !== '__other'"
          :agent="row.id"
          :size="14"
        />
        <ModelMark
          v-else-if="dimension === 'models' && row.id !== '__other'"
          :model="row.id"
          :size="14"
        />
        <RollingText :text="row.name" />
      </span>
      <AnimatedBar :value="row.totalTokens" :max="data?.summary.totalTokens || 0" />
      <span class="numeric">
        <AnimatedNumber :value="row.totalTokens" :format="{ compact: true }" />
      </span>
      <span class="numeric muted">
        <AnimatedNumber
          :value="
            data?.summary.totalTokens ? (row.totalTokens / data.summary.totalTokens) * 100 : 0
          "
          :format="{ percent: true }"
        />
      </span>
      <span class="numeric"><AnimatedCost :summary="row.costSummary" :note="false" /></span>
    </div>
  </section>
</template>
<style scoped>
.usage-sources {
  border-color: var(--border);
  display: flex;
  flex-direction: column;
  gap: 9px;
}
header {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
}
header button:last-child {
  margin-left: auto;
  white-space: nowrap;
}
.source-labels,
.source-row {
  display: grid;
  grid-template-columns: 130px minmax(20px, 1fr) 75px 55px 95px;
  gap: 10px;
  align-items: center;
  font-size: 12px;
}
.source-labels {
  font-size: 11px;
  color: var(--text-soft);
  text-align: right;
}
.source-row .numeric {
  text-align: right;
}
.source-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.source-name :deep(.rolling-text) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.source-row :deep(.animated-bar) {
  height: 6px;
  background: var(--surface-container);
}
@media (max-width: 1400px) {
  .source-labels,
  .source-row {
    grid-template-columns: 90px minmax(15px, 1fr) 58px 45px 75px;
    gap: 6px;
  }
  header {
    gap: 8px;
  }
}
</style>
