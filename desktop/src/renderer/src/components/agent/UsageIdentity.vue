<script setup lang="ts">
import UsageIcons from '../base/UsageIcons.vue'
import { useI18n } from '../../i18n/useI18n'
defineProps<{
  agents: string[]
  models: string[]
  agentTotals?: Record<string, number>
  modelTotals?: Record<string, number>
  labelled?: boolean
}>()
const { label } = useI18n()
</script>
<template>
  <div class="usage-identity" :class="{ 'usage-identity--labelled': labelled }">
    <div class="usage-identity__row">
      <small v-if="labelled">Agent</small>
      <UsageIcons kind="agents" :items="agents" :totals="agentTotals" />
    </div>
    <div class="usage-identity__row">
      <small v-if="labelled">{{ label('Model', '模型') }}</small>
      <UsageIcons kind="models" :items="models" :totals="modelTotals" />
    </div>
  </div>
</template>
<style scoped>
.usage-identity {
  display: grid;
  gap: 2px;
  min-width: 0;
  color: var(--text-muted);
}
.usage-identity__row {
  min-width: 0;
}
.usage-identity--labelled .usage-identity__row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}
.usage-identity__row > small {
  color: var(--text-soft);
  font-size: 11px;
}
</style>
