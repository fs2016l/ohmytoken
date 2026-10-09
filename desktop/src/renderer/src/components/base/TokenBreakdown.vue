<script setup lang="ts">
import { computed } from 'vue'
import AnimatedNumber from './AnimatedNumber.vue'
import AnimatedBar from './AnimatedBar.vue'
import { useI18n } from '../../i18n/useI18n'
import { combinedCache } from '../../utils/number-format'
const props = defineProps<{
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    reasoningTokens: number
    totalTokens: number
  }
}>()
const { label } = useI18n()
const rows = computed(() => [
  { id: 'input', label: label('Input', '输入'), value: props.usage.inputTokens },
  { id: 'output', label: label('Output', '输出'), value: props.usage.outputTokens },
  { id: 'cache', label: label('Cache', '缓存'), value: combinedCache(props.usage)! },
  { id: 'reasoning', label: label('Reasoning', '推理'), value: props.usage.reasoningTokens },
])
</script>
<template>
  <div class="token-breakdown">
    <div v-for="row in rows" :key="row.id" class="token-breakdown-row">
      <span>{{ row.label }}</span>
      <div class="token-bar-track">
        <AnimatedBar
          :value="row.value"
          :max="usage.totalTokens"
          color="linear-gradient(90deg, var(--primary), var(--primary-border))"
        />
      </div>
      <AnimatedNumber :value="row.value" :format="{ compact: true }" />
    </div>
  </div>
</template>
<style scoped>
.token-breakdown {
  display: grid;
  gap: 0;
}
.token-breakdown-row {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) 68px;
  gap: 10px;
  align-items: center;
  min-height: 32px;
  font-size: 12px;
  color: var(--text-muted);
}
.token-breakdown-row > :last-child {
  text-align: right;
  color: var(--text);
}
.token-bar-track {
  height: 12px;
}
:deep(.animated-bar) {
  height: 100%;
  border-radius: 3px;
}
</style>
