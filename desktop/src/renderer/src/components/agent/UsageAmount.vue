<script setup lang="ts">
import type { UsageCostRollup } from '@shared/usage-cost'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import AnimatedCost from '../base/AnimatedCost.vue'
import DesignIcon from '../base/DesignIcon.vue'
import { useI18n } from '../../i18n/useI18n'
defineProps<{ tokens: number; cost?: UsageCostRollup }>()
const { label } = useI18n()
</script>
<template>
  <div class="usage-amount workspace-cell-lines">
    <span
      class="usage-amount__row"
      role="group"
      :aria-label="label('Token usage', 'Token 用量')"
      :title="label('Token usage', 'Token 用量')"
    >
      <DesignIcon class="usage-amount__icon" name="analytics" :size="14" />
      <AnimatedNumber class="usage-amount__tokens" :value="tokens" :format="{ compact: true }" />
    </span>
    <span
      class="usage-amount__row"
      role="group"
      :aria-label="label('Cost', '费用')"
      :title="label('Cost', '费用')"
    >
      <DesignIcon class="usage-amount__icon" name="quota" :size="14" />
      <AnimatedCost
        class="usage-amount__cost"
        :summary="cost"
        :note="false"
        :estimate-mark="false"
        currency-position="suffix"
      />
    </span>
  </div>
</template>
<style scoped>
.usage-amount__row {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.usage-amount__icon {
  color: var(--text-muted);
}
.usage-amount__tokens,
.usage-amount__cost {
  color: var(--text);
}
</style>
