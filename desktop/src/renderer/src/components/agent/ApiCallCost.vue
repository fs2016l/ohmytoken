<script setup lang="ts">
import type { UsageCostAssessment } from '@shared/usage-cost'
import { useI18n } from '../../i18n/useI18n'
import { useCostLabels } from '../../composables/useCostLabels'
import { useCostCurrency } from '../../composables/useCostCurrency'
defineProps<{ assessment: UsageCostAssessment }>()
const { label } = useI18n()
const { vendorName, reasonLabel, costLabel, pricingPeriodLabel } = useCostLabels()
const { exchange } = useCostCurrency()
</script>

<template>
  <div class="call-cost">
    <span>
      {{ label('API equivalent', 'API 参考费用') }}
      <b>{{ assessment.status === 'unpriced' ? '' : '≈ ' }}{{ costLabel(assessment) }}</b>
    </span>
    <span>
      {{ label('Model vendor', '模型厂商') }}: {{ vendorName(assessment.identity.vendor) }}
    </span>
    <span v-if="exchange.snapshot">
      {{ label('Exchange rate date', '汇率日期') }}: {{ exchange.snapshot.asOf }} ·
      {{ exchange.snapshot.source === 'manual' ? label('Manual rate', '后台维护汇率') : 'ECB' }}
    </span>
    <span v-if="assessment.reason">{{ reasonLabel(assessment.reason) }}</span>
    <span v-if="assessment.pricingPeriod">{{ pricingPeriodLabel(assessment.pricingPeriod) }}</span>
    <span v-if="assessment.reportedCost">
      {{ label('Agent-reported cost (unverified)', 'Agent 记录费用（未经账单核验）') }}:
      {{
        costLabel({
          currency: assessment.reportedCost.currency,
          min: assessment.reportedCost.amount,
          max: assessment.reportedCost.amount,
          status: 'estimated',
        })
      }}
    </span>
  </div>
</template>

<style scoped>
.call-cost {
  display: flex;
  gap: 6px 18px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-soft);
  overflow-wrap: anywhere;
}
b {
  color: var(--primary);
  font-weight: 500;
}
</style>
