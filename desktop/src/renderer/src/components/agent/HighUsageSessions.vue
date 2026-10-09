<script setup lang="ts">
import type { TokenUsageUserSession } from '@shared/models'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import AnimatedCost from '../base/AnimatedCost.vue'
import RollingText from '../base/RollingText.vue'
import { getAgentName } from '../../config/agents'
import { useI18n } from '../../i18n/useI18n'

defineProps<{ sessions: TokenUsageUserSession[] }>()
const emit = defineEmits<{ select: [session: TokenUsageUserSession]; all: [] }>()
const { label } = useI18n()
</script>

<template>
  <section class="workspace-panel high-sessions">
    <header>
      <h2>{{ label('High usage sessions', '高用量会话') }}</h2>
      <button type="button" class="workspace-link" @click="emit('all')">
        {{ label('View all', '查看全部') }} →
      </button>
    </header>
    <!-- These are presentation ranks; the click target always uses the current session. -->
    <button
      v-for="(session, rank) in sessions"
      :key="rank"
      type="button"
      class="high-session-row"
      :title="`${session.title || session.sessionId} · ${getAgentName(session.agent)}`"
      @click="emit('select', session)"
    >
      <RollingText :text="session.title || session.sessionId" />
      <AnimatedNumber :value="session.totalTokens" :format="{ compact: true }" />
      <AnimatedCost :summary="session.costSummary" :note="false" :estimate-mark="false" />
    </button>
    <p v-if="!sessions.length">{{ label('No sessions in this period', '此区间暂无会话') }}</p>
  </section>
</template>

<style scoped>
.high-sessions {
  border-color: var(--border);
  padding: 11px 16px;
  min-width: 0;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 24px;
  margin-bottom: 4px;
}
header button {
  white-space: nowrap;
  min-height: 24px;
}
.high-session-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 64px 88px;
  align-items: center;
  width: 100%;
  height: 20px;
  min-height: 20px;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  cursor: pointer;
  text-align: right;
}
.high-session-row > span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.high-session-row > span:first-child {
  text-align: left;
}
.high-session-row:hover {
  color: var(--accent);
}
p {
  margin: 8px 0 0;
  color: var(--text-soft);
  font-size: 12px;
}
</style>
