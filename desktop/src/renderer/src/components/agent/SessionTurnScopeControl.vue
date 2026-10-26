<script setup lang="ts">
import type { SessionTurnScope } from '@shared/models'
import SegmentedControl from '../base/SegmentedControl.vue'
import { useI18n } from '../../i18n/useI18n'
defineProps<{ modelValue: SessionTurnScope; compact?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: SessionTurnScope] }>()
const { label } = useI18n()
</script>
<template>
  <SegmentedControl
    class="session-turn-scope"
    :model-value="modelValue"
    :compact="compact"
    :options="[
      { value: 'all', label: label('All turns', '全部轮') },
      { value: 'latest', label: label('Latest turn', '最新轮') },
    ]"
    :label="label('Conversation turns', '会话轮次范围')"
    :title="
      label(
        'Show the whole latest turn of each selected session. Child sessions show their own latest turn.',
        '最新轮展示所选会话的最近整轮，不按日期拆分；子会话各自展示最新轮',
      )
    "
    @update:model-value="emit('update:modelValue', $event === 'latest' ? 'latest' : 'all')"
  />
</template>
<style scoped>
.session-turn-scope {
  flex: none;
}
</style>
