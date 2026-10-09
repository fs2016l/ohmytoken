<script setup lang="ts">
import { computed } from 'vue'
import type { TokenUsageSession } from '@shared/models'
import { useI18n } from '../../i18n/useI18n'
import { formatNumber } from '../../utils/number-format'
const props = defineProps<{ turns?: TokenUsageSession['turns'] }>()
const { label } = useI18n()
const explanation = computed(() => {
  if (props.turns?.complete)
    return label(
      `${props.turns.count} confirmed user turns with recorded usage. Tool continuations count as the same turn.`,
      `已确认 ${props.turns.count} 次对话。按有用量记录的用户请求去重，工具续跑仍属于同一次对话。`,
    )
  return props.turns?.count
    ? label(
        `At least ${props.turns.count} user turns are confirmed. Some usage has no reliable user-request boundary, so the actual count may be higher.`,
        `已确认至少 ${props.turns.count} 次对话。部分用量缺少可靠的用户请求边界，实际对话次数可能更多。`,
      )
    : label(
        'The source has no reliable user-turn evidence. This does not mean zero usage.',
        '来源日志缺少可靠的对话次数依据，不代表没有用量。',
      )
})
</script>

<template>
  <span :title="explanation" :aria-label="explanation" tabindex="0">
    {{ label('Turns', '对话次数') }}
    {{
      turns?.complete
        ? formatNumber(turns.count, { compact: true })
        : turns?.count
          ? `≥ ${formatNumber(turns.count, { compact: true })}`
          : label('Unknown', '未提供')
    }}
    <span v-if="!turns?.complete" class="turn-help" aria-hidden="true">ⓘ</span>
  </span>
</template>

<style scoped>
.turn-help {
  margin-left: 3px;
  color: var(--text-soft);
  cursor: help;
}
</style>
