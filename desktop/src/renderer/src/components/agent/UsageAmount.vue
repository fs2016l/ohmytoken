<script setup lang="ts">
import type { UsageCostRollup } from '@shared/usage-cost'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import AnimatedCost from '../base/AnimatedCost.vue'
defineProps<{ tokens: number; cost?: UsageCostRollup }>()
</script>
<template>
  <div class="usage-amount workspace-cell-lines">
    <AnimatedNumber class="usage-amount__tokens" :value="tokens" :format="{ compact: true }" />
    <AnimatedCost class="usage-amount__cost" :summary="cost" :note="false" />
  </div>
</template>
<style scoped>
.usage-amount__tokens {
  font-weight: 600;
  color: var(--text);
}
.usage-amount__cost {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
