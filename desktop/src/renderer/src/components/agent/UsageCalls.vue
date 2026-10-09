<script setup lang="ts">
import AnimatedNumber from '../base/AnimatedNumber.vue'
import { useI18n } from '../../i18n/useI18n'
defineProps<{
  calls: number
  complete?: boolean
  turns?: { count: number; complete: boolean }
}>()
const { label } = useI18n()
</script>
<template>
  <div class="usage-calls workspace-cell-lines">
    <span
      :title="
        complete === false
          ? label('Known calls; source is incomplete', '已知调用数，来源记录不完整')
          : undefined
      "
    >
      <AnimatedNumber
        :prefix="complete === false ? '≥' : ''"
        :value="calls"
        :format="{ compact: true }"
      />
      <small>{{ label('calls', '次调用') }}</small>
    </span>
    <span
      class="usage-calls__turns"
      :title="
        !turns?.complete
          ? label('The source cannot provide a complete turn count', '来源无法提供完整对话次数')
          : undefined
      "
    >
      <template v-if="turns?.complete || turns?.count">
        <AnimatedNumber
          :prefix="!turns.complete && turns.count ? '≥' : ''"
          :value="turns.count"
          :format="{ compact: true }"
        />
        <small>{{ label('turns', '轮对话') }}</small>
      </template>
      <template v-else>{{ label('Turns', '对话') }} —</template>
    </span>
  </div>
</template>
<style scoped>
.usage-calls > span {
  white-space: nowrap;
  color: var(--text);
}
.usage-calls small {
  margin-left: 4px;
  color: var(--text-muted);
  font-size: 11px;
}
.usage-calls > .usage-calls__turns {
  color: var(--text-muted);
  font-size: 11px;
}
</style>
