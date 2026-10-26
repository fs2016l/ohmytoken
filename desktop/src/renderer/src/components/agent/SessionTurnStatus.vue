<script setup lang="ts">
import { computed } from 'vue'
import type { SessionTurnStatus } from '@shared/models'
import { useI18n } from '../../i18n/useI18n'
const props = defineProps<{ status?: SessionTurnStatus }>()
const { label } = useI18n()
const text = computed(
  () =>
    ({
      running: label('In progress', '进行中'),
      completed: label('Completed', '已完成'),
      interrupted: label('Interrupted', '已中断'),
      failed: label('Failed', '失败'),
      waiting: label('Paused', '待继续'),
    })[props.status!],
)
</script>
<template>
  <span
    v-if="status"
    class="session-turn-status"
    :class="`session-turn-status--${status}`"
    role="status"
  >
    <i aria-hidden="true" />
    {{ text }}
  </span>
</template>
<style scoped>
.session-turn-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
}
.session-turn-status i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.session-turn-status--running {
  color: var(--primary);
}
.session-turn-status--completed {
  color: var(--success, #24865b);
}
.session-turn-status--failed {
  color: var(--danger, #c64343);
}
.session-turn-status--waiting {
  color: var(--warning, #a76e18);
}
</style>
