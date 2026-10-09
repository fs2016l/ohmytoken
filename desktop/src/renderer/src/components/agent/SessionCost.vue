<script setup lang="ts">
import type { UsageCostRollup } from '@shared/usage-cost'
import { useCostLabels } from '../../composables/useCostLabels'
import { useI18n } from '../../i18n/useI18n'

withDefaults(
  defineProps<{ summary?: UsageCostRollup; variant?: 'inline' | 'metric' | 'table' }>(),
  { summary: undefined, variant: 'inline' },
)
const { rollupCostLabel } = useCostLabels()
const { label } = useI18n()
</script>

<template>
  <span class="session-cost" :class="`session-cost--${variant}`">
    <span v-if="variant === 'inline'">{{ label('API equivalent', 'API 参考费用') }}</span>
    <b v-if="summary" :title="rollupCostLabel(summary, false)">
      {{ summary.pricedRecords ? '≈ ' : '' }}{{ rollupCostLabel(summary) }}
    </b>
    <b v-else>{{ label('Not available', '未提供') }}</b>
    <span v-if="summary && summary.pricedRecords < summary.totalRecords" class="session-cost__note">
      {{ label('Unpriced calls', '未计价调用') }}
      {{ summary.totalRecords - summary.pricedRecords }}
    </span>
  </span>
</template>

<style scoped>
.session-cost {
  display: block;
  color: var(--text-soft);
  font-size: 11px;
  line-height: 1.7;
  margin-top: 8px;
  overflow-wrap: anywhere;
}
.session-cost--metric,
.session-cost--table {
  margin-top: 0;
  font-family: var(--font-number);
  font-size: 13px;
}
.session-cost--table {
  font-size: 12px;
}
.session-cost--inline > span:first-child {
  margin-right: 4px;
}
.session-cost__note {
  display: block;
  font-size: 10px;
  color: var(--text-soft);
}
b {
  color: var(--primary);
  font-weight: 500;
  white-space: nowrap;
}
</style>
