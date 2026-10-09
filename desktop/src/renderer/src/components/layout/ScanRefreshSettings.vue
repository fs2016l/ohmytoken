<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  SCAN_REFRESH_INTERVALS,
  type ScanRefreshPreferences,
  type ScanRefreshState,
} from '@shared/scan-refresh'
import SelectControl from '../base/SelectControl.vue'
import { useI18n } from '../../i18n/useI18n'

const props = defineProps<{ state: ScanRefreshState; disabled: boolean; failed: boolean }>()
const emit = defineEmits<{ configure: [value: ScanRefreshPreferences] }>()
const { label } = useI18n()
const now = ref(Date.now())
watch(() => props.state.nextRefreshAt, visibility)
const options = computed(() =>
  SCAN_REFRESH_INTERVALS.map((value) => ({
    value,
    label:
      value < 60_000
        ? label('30 seconds', '30 秒')
        : label(`${value / 60_000} minute${value === 60_000 ? '' : 's'}`, `${value / 60_000} 分钟`),
  })),
)
const countdown = computed(() => {
  const seconds = Math.max(
    0,
    Math.ceil(((props.state.nextRefreshAt ?? now.value) - now.value) / 1000),
  )
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
})
let timer: ReturnType<typeof setInterval> | undefined
function visibility(): void {
  clearInterval(timer)
  now.value = Date.now()
  if (!document.hidden)
    timer = setInterval(() => {
      now.value = Date.now()
    }, 1000)
}
onMounted(() => {
  visibility()
  document.addEventListener('visibilitychange', visibility)
})
onUnmounted(() => {
  clearInterval(timer)
  document.removeEventListener('visibilitychange', visibility)
})
</script>
<template>
  <div class="scan-refresh-settings">
    <div class="scan-refresh-row">
      <span>{{ label('Auto refresh', '自动刷新') }}</span>
      <button
        class="scan-refresh-switch"
        type="button"
        role="switch"
        :aria-label="label('Auto refresh', '自动刷新')"
        :aria-checked="state.enabled"
        :disabled="disabled"
        @click="emit('configure', { enabled: !state.enabled, interval: state.interval })"
      >
        <span />
      </button>
    </div>
    <div class="scan-refresh-row">
      <span class="scan-refresh-secondary">{{ label('Refresh interval', '刷新间隔') }}</span>
      <SelectControl
        :model-value="state.interval"
        :options="options"
        :label="label('Refresh interval', '刷新间隔')"
        :disabled="disabled || !state.enabled"
        compact
        @update:model-value="emit('configure', { enabled: state.enabled, interval: $event })"
      />
    </div>
    <div class="scan-refresh-countdown" :class="{ 'is-enabled': state.enabled }">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="5.6" />
        <path d="M8 4.8v3.5l2.1 1.3" stroke-linecap="round" />
      </svg>
      <template v-if="state.enabled && state.running">
        {{ label('Next refresh after this update', '本次完成后重新计时') }}
      </template>
      <template v-else-if="state.enabled && state.nextRefreshAt">
        {{ label('Next refresh in', '下次刷新') }}
        <span>{{ countdown }}</span>
      </template>
      <template v-else-if="state.enabled">
        {{ label('Resumes when a window is visible', '窗口可见时继续刷新') }}
      </template>
      <template v-else>{{ label('Refresh manually when needed', '需要时手动刷新') }}</template>
    </div>
    <p v-if="failed" class="scan-refresh-error" role="alert">
      {{ label('Could not save refresh settings. Try again.', '刷新设置保存失败，请重试。') }}
    </p>
  </div>
</template>
<style scoped>
.scan-refresh-settings {
  display: grid;
  gap: 14px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.scan-refresh-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 26px;
}
.scan-refresh-secondary {
  color: var(--text-soft);
  font-size: 12px;
}
.scan-refresh-switch {
  position: relative;
  flex: none;
  width: 34px;
  height: 20px;
  min-height: 0;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--bg-hover);
  cursor: pointer;
  transition:
    background 180ms ease,
    border-color 180ms ease;
}
.scan-refresh-switch span {
  position: absolute;
  left: 3px;
  top: 3px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-soft);
  transition:
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
    background 180ms ease;
}
.scan-refresh-switch[aria-checked='true'] {
  background: var(--primary);
  border-color: var(--primary);
}
.scan-refresh-switch[aria-checked='true'] span {
  transform: translateX(14px);
  background: var(--text-inverse, #fff);
}
.scan-refresh-switch:disabled {
  opacity: 0.5;
  cursor: wait;
}
.scan-refresh-switch:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
}
.scan-refresh-countdown {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  color: var(--text-soft);
  font-size: 12px;
}
.scan-refresh-countdown svg {
  width: 14px;
  height: 14px;
}
.scan-refresh-countdown span {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.scan-refresh-countdown.is-enabled {
  color: var(--primary);
}
.scan-refresh-error {
  margin: 0;
  font-size: 12px;
  color: var(--warning);
}
@media (prefers-reduced-motion: reduce) {
  .scan-refresh-switch,
  .scan-refresh-switch span {
    transition: none;
  }
}
</style>
