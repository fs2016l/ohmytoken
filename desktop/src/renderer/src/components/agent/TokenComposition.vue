<script setup lang="ts">
import { computed } from 'vue'
import type { UsageAnalytics } from '@shared/analytics'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import AnimatedBar from '../base/AnimatedBar.vue'
import AnimatedCost from '../base/AnimatedCost.vue'
import { useI18n } from '../../i18n/useI18n'
const props = defineProps<{ data: UsageAnalytics | null; compact?: boolean }>()
const { label } = useI18n()
const rows = computed(() => [
  { id: 'input' as const, name: label('Input', '输入'), value: props.data?.summary.inputTokens },
  { id: 'output' as const, name: label('Output', '输出'), value: props.data?.summary.outputTokens },
  {
    id: 'cache' as const,
    name: label('Cache', '缓存'),
    value: props.data
      ? props.data.summary.cacheReadTokens + props.data.summary.cacheWriteTokens
      : undefined,
  },
  {
    id: 'reasoning' as const,
    name: label('Reasoning', '推理'),
    value: props.data?.summary.reasoningTokens,
  },
])
</script>
<template>
  <section class="workspace-panel composition" :class="{ 'composition--compact': compact }">
    <header>
      <h2>{{ label('Token composition', 'Token 构成') }}</h2>
      <div>
        <span>{{ label('Total tokens', 'Token 总量') }}</span>
        <strong>
          <AnimatedNumber :value="data?.summary.totalTokens" :format="{ compact: true }" />
        </strong>
      </div>
      <div>
        <span>{{ label('Est. cost', '预估花费') }}</span>
        <strong>
          <AnimatedCost :summary="data?.summary.costSummary" :note="false" :estimate-mark="false" />
        </strong>
      </div>
    </header>
    <div class="composition-labels">
      <span />
      <span>Token</span>
      <span>{{ label('Share', '占比') }}</span>
      <span>{{ label('Est. cost', '预估花费') }}</span>
    </div>
    <div v-for="row in rows" :key="row.id" class="composition-row">
      <div>
        <span>{{ row.name }}</span>
        <AnimatedBar :value="row.value || 0" :max="data?.summary.totalTokens || 0" />
      </div>
      <span class="numeric"><AnimatedNumber :value="row.value" :format="{ compact: true }" /></span>
      <span class="numeric muted">
        <AnimatedNumber
          :value="
            data
              ? data.summary.totalTokens
                ? ((row.value || 0) / data.summary.totalTokens) * 100
                : 0
              : null
          "
          :format="{ percent: true }"
        />
      </span>
      <span class="numeric">
        <AnimatedCost :summary="data?.bucketCosts[row.id]" :note="false" :estimate-mark="false" />
      </span>
    </div>
  </section>
</template>
<style scoped>
.composition {
  border-color: var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
  align-items: center;
  margin-bottom: 4px;
  height: 44px;
  flex-shrink: 0;
}
header h2 {
  margin-right: auto;
}
header > div {
  min-width: 0;
  text-align: right;
}
header > div > span {
  display: block;
  color: var(--text-soft);
  font-size: 11px;
  line-height: 18px;
}
header strong {
  display: block;
  font-size: 20px;
  font-weight: 600;
  line-height: 26px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
header > div:last-child {
  border-left: 1px solid var(--border);
  padding-left: 18px;
}
.composition-row,
.composition-labels {
  display: grid;
  grid-template-columns: minmax(80px, 1fr) 72px 56px 90px;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}
.composition-labels {
  color: var(--text-soft);
  font-size: 11px;
  text-align: right;
  height: 20px;
  line-height: 20px;
}
.composition-row {
  height: 22px;
  line-height: 22px;
}
.composition-row > span {
  text-align: right;
}
.composition-row > div {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-soft);
}
.composition-row > div > span {
  min-width: 28px;
}
.composition-row :deep(.animated-bar) {
  height: 6px;
  flex: 1;
  min-width: 12px;
  background: var(--surface-container);
}
.composition--compact {
  padding: 16px;
  gap: 0;
}
.composition--compact header {
  height: 44px;
  gap: 8px;
  margin-bottom: 6px;
  flex-shrink: 0;
}
.composition--compact header h2 {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  white-space: nowrap;
}
.composition--compact header > div:last-child {
  padding-left: 8px;
}
.composition--compact .composition-row,
.composition--compact .composition-labels {
  grid-template-columns: minmax(52px, 1fr) 64px 56px 88px;
  gap: 6px;
}
.composition--compact .composition-labels {
  height: 20px;
}
.composition--compact .composition-row {
  height: 22px;
}
.composition-row > span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
@media (max-width: 1380px) {
  .composition--compact header h2 {
    font-size: 14px;
  }
  .composition--compact header strong {
    font-size: 18px;
  }
}
</style>
