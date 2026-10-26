<script setup lang="ts">
import AnimatedNumber from '../base/AnimatedNumber.vue'
import DesignIcon from '../base/DesignIcon.vue'
import { useI18n } from '../../i18n/useI18n'
defineProps<{
  calls: number | null
  complete?: boolean
  turns?: { count: number; complete: boolean }
}>()
const { label } = useI18n()
</script>
<template>
  <div class="usage-calls workspace-cell-lines">
    <span
      role="group"
      :aria-label="label('API calls', 'API 调用次数')"
      :title="
        complete === false
          ? label(
              'API calls · known calls; source is incomplete',
              'API 调用次数 · 已知调用数，来源记录不完整',
            )
          : label('API calls', 'API 调用次数')
      "
    >
      <DesignIcon class="usage-calls__icon" name="capabilityCode" :size="14" />
      <AnimatedNumber
        :prefix="calls !== null && complete === false ? '≥' : ''"
        :value="calls"
        :format="{ compact: true }"
      />
    </span>
    <span
      class="usage-calls__turns"
      role="group"
      :aria-label="label('Conversation turns', '对话轮数')"
      :title="
        !turns?.complete
          ? label('The source cannot provide a complete turn count', '来源无法提供完整对话次数')
          : label('Conversation turns', '对话轮数')
      "
    >
      <DesignIcon class="usage-calls__icon" name="sessions" :size="14" />
      <AnimatedNumber
        v-if="turns?.complete || turns?.count"
        :prefix="!turns.complete && turns.count ? '≥' : ''"
        :value="turns.count"
        :format="{ compact: true }"
      />
      <span v-else>—</span>
    </span>
  </div>
</template>
<style scoped>
.usage-calls > span {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  color: var(--text);
}
.usage-calls__icon {
  color: var(--text-muted);
}
</style>
