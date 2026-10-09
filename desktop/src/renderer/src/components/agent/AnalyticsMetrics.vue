<script setup lang="ts">
import { computed } from 'vue'
import type { UsageAnalytics } from '@shared/analytics'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import AnimatedCost from '../base/AnimatedCost.vue'
import { useI18n } from '../../i18n/useI18n'
import { useCostCurrency } from '../../composables/useCostCurrency'
import { summaryMoney } from '../../utils/analytics-display'
const props = defineProps<{ data: UsageAnalytics | null; comparison: UsageAnalytics | null }>()
const emit = defineEmits<{ fees: [] }>()
const { label } = useI18n(),
  { currency, exchange } = useCostCurrency()
const peak = computed(() =>
  props.data?.days.reduce(
    (best, value) =>
      value.total.tokens > best.tokens ? { date: value.key, tokens: value.total.tokens } : best,
    { date: '', tokens: 0 },
  ),
)
const rows = computed(() => {
  const now = props.data?.summary,
    prior = props.comparison?.summary
  return [
    {
      id: 'tokens',
      name: label('Total tokens', 'Token 总量'),
      icon: 'stacks',
      value: now?.totalTokens,
      before: prior?.totalTokens,
      complete: true,
    },
    {
      id: 'cost',
      name: label('Est. cost', '预估花费'),
      icon: 'credit_card',
      value: summaryMoney(now?.costSummary, currency.value, exchange.value.snapshot)?.min,
      before:
        prior?.costSummary && prior.costSummary.pricedRecords === prior.costSummary.totalRecords
          ? summaryMoney(prior.costSummary, currency.value, exchange.value.snapshot)?.min
          : undefined,
      complete:
        !!now?.costSummary && now.costSummary.pricedRecords === now.costSummary.totalRecords,
    },
    {
      id: 'calls',
      name: label('API calls', 'API 调用'),
      icon: 'bolt',
      value: now?.apiCallCount,
      before: prior?.apiCallCountComplete ? prior.apiCallCount : undefined,
      complete: now?.apiCallCountComplete,
    },
    {
      id: 'turns',
      name: label('Turns', '对话次数'),
      icon: 'chat_bubble',
      value: now?.turns.count,
      before: prior?.turns.complete ? prior.turns.count : undefined,
      complete: now?.turns.complete,
    },
    {
      id: 'peak',
      name: label('Daily peak', '单日峰值'),
      icon: 'monitoring',
      value: peak.value?.tokens,
      before: undefined,
      complete: true,
    },
  ].map((row) => ({
    ...row,
    change:
      row.before && row.value !== undefined ? ((row.value - row.before) / row.before) * 100 : null,
  }))
})
</script>
<template>
  <div class="analytics-metrics">
    <section v-for="row in rows" :key="row.id" class="workspace-panel metric-card">
      <span class="material-symbols-outlined" aria-hidden="true">{{ row.icon }}</span>
      <div>
        <span class="metric-title">{{ row.name }}</span>
        <button
          v-if="row.id === 'cost'"
          type="button"
          class="metric-value metric-cost"
          @click="emit('fees')"
        >
          <AnimatedCost :summary="data?.summary.costSummary" :note="false" />
        </button>
        <strong v-else class="metric-value">
          <AnimatedNumber
            :prefix="!row.complete && row.value ? '≥' : ''"
            :value="row.complete || row.value ? row.value : null"
            :format="{ compact: true }"
          />
        </strong>
        <span class="metric-note">
          <template v-if="row.id === 'peak'">{{ peak?.date || '—' }}</template>
          <template v-else-if="!row.complete">
            {{ label('Incomplete data', '数据未完整') }}
          </template>
          <template v-else-if="comparison && row.change !== null">
            {{ label('vs comparison', '较对比时段') }}
            <span>
              {{ row.change >= 0 ? '↑' : '↓' }}
              <AnimatedNumber :value="Math.abs(row.change)" :format="{ percent: true }" />
            </span>
          </template>
          <template v-else-if="comparison && row.value && row.before === 0">
            {{ label('New usage', '新增用量') }}
          </template>
          <template v-else>{{ label('Selected period', '当前区间') }}</template>
        </span>
      </div>
    </section>
  </div>
</template>
<style scoped>
.analytics-metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
}
.metric-card {
  display: flex;
  align-items: center;
  gap: 12px;
  border-color: var(--border);
  min-height: 100px;
  padding: 12px;
}
.metric-card > .material-symbols-outlined {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: 8px;
  background: var(--primary-soft);
  color: var(--primary-soft-text);
  font-size: 21px;
}
.metric-card > div {
  min-width: 0;
  flex: 1;
}
.metric-title {
  display: block;
  color: var(--text-soft);
  font-size: 11px;
  line-height: 18px;
}
.metric-value {
  display: block;
  font-size: 27px;
  line-height: 36px;
  font-weight: 600;
  letter-spacing: -0.5px;
  font-family: var(--font-number);
}
.metric-cost {
  border: 0;
  background: transparent;
  color: var(--text);
  padding: 0;
  cursor: pointer;
  text-align: left;
  font-size: 24px;
}
.metric-cost :deep(.cost-value) {
  white-space: normal;
}
.metric-note {
  display: block;
  color: var(--text-soft);
  font-size: 10px;
  min-height: 18px;
  line-height: 18px;
}
.metric-note > span {
  white-space: nowrap;
}
@media (max-width: 1400px) {
  .analytics-metrics {
    gap: 10px;
  }
  .metric-card {
    gap: 8px;
    padding: 10px;
  }
  .metric-card > .material-symbols-outlined {
    width: 28px;
    height: 28px;
    font-size: 18px;
  }
  .metric-value {
    font-size: 23px;
  }
  .metric-cost {
    font-size: 20px;
  }
}
</style>
