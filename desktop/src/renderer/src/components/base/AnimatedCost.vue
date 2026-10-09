<script setup lang="ts">
import { computed } from 'vue'
import type { UsageCostRollup } from '@shared/usage-cost'
import { summaryMoney } from '../../utils/analytics-display'
import { useCostCurrency } from '../../composables/useCostCurrency'
import { useI18n } from '../../i18n/useI18n'
import type { NumberMotionMode } from '../../composables/useNumberMotion'
import AnimatedNumber from './AnimatedNumber.vue'
const props = withDefaults(
  defineProps<{
    summary?: UsageCostRollup
    note?: boolean
    estimateMark?: boolean
    motion?: NumberMotionMode
  }>(),
  { note: true, estimateMark: true, summary: undefined, motion: 'auto' },
)
const { currency, exchange } = useCostCurrency()
const { label } = useI18n()
const money = computed(() => {
  return summaryMoney(props.summary, currency.value, exchange.value.snapshot)
})
const partial = computed(
  () => props.summary && props.summary.pricedRecords < props.summary.totalRecords,
)
const range = computed(() => money.value && Math.abs(money.value.max - money.value.min) > 1e-10)
const hint = computed(() =>
  !props.summary
    ? label('Cost unavailable', '费用暂不可用')
    : !props.summary.pricedRecords && props.summary.totalRecords > 0
      ? label('Unpriced', '未计价')
      : !money.value
        ? label('Exchange rate unavailable', '汇率暂不可用')
        : `${label('API equivalent estimate', 'API 参考估算')} · ${currency.value} ${money.value.min}${range.value ? ` – ${money.value.max}` : ''}${partial.value ? ` · ${label('Partially priced', '部分调用未计价')}` : ''}`,
)
</script>
<template>
  <span class="animated-cost" :title="hint">
    <span v-if="money" class="cost-value">
      <template v-if="estimateMark">≈</template>
      <AnimatedNumber :value="money.min" :format="{ currency, compact: true }" :motion="motion" />
      <template v-if="range">
        –
        <AnimatedNumber :value="money.max" :format="{ currency, compact: true }" :motion="motion" />
      </template>
    </span>
    <span v-else>—</span>
    <small v-if="note && partial">{{ label('Partially priced', '部分未计价') }}</small>
    <small v-else-if="note && summary && !money">{{ hint }}</small>
  </span>
</template>
<style scoped>
.animated-cost {
  font-family: var(--font-number);
  font-variant-numeric: tabular-nums;
}
.cost-value {
  white-space: nowrap;
}
small {
  display: block;
  font-family: var(--font-ui);
  color: var(--text-soft);
  font-size: 10px;
  font-weight: 400;
  line-height: 16px;
}
</style>
