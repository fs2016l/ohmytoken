<script setup lang="ts">
import { onBeforeUnmount, onDeactivated, ref, useId, watch } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import SelectionPopover from '../base/SelectionPopover.vue'

const props = defineProps<{
  status: string
  stale: boolean
  hint?: string
  retryAt?: number | null
  observedAt?: number | null
}>()
const { currentLang, label } = useI18n()
const anchor = ref<HTMLElement | null>(null)
const open = ref(false)
const id = useId()
let hideTimer: ReturnType<typeof setTimeout> | undefined

function keep(): void {
  clearTimeout(hideTimer)
}
function show(): void {
  keep()
  if (props.hint) open.value = true
}
function close(): void {
  keep()
  open.value = false
}
function leave(): void {
  keep()
  // Allow moving across the arrow into the message without making it disappear.
  hideTimer = setTimeout(() => {
    if (!anchor.value?.matches(':focus-visible')) open.value = false
  }, 120)
}
watch(
  () => props.hint,
  (value) => {
    if (!value) close()
  },
)
onDeactivated(close)
onBeforeUnmount(close)
</script>

<template>
  <span
    ref="anchor"
    class="quota-card__badge"
    :class="{ 'quota-card__badge--stale': stale, 'quota-card__badge--hint': hint }"
    :tabindex="hint ? 0 : undefined"
    :aria-describedby="open ? id : undefined"
    @mouseenter="show"
    @mouseleave="leave"
    @focus="show"
    @blur="leave"
  >
    {{ status }}
  </span>
  <SelectionPopover
    v-if="hint"
    :id="id"
    v-model="open"
    :anchor="anchor"
    :label="status"
    :width="300"
    :max-height="280"
    role="tooltip"
    @mouseenter="keep"
    @mouseleave="leave"
  >
    <div class="quota-status-hint">
      <strong>{{ status }}</strong>
      <p>{{ hint }}</p>
      <p v-if="retryAt" class="quota-status-hint__note">
        {{ label('Retry after ', '可重试时间：')
        }}{{ new Date(retryAt).toLocaleString(currentLang === 'zh' ? 'zh-CN' : 'en-US') }}
      </p>
      <p v-if="observedAt" class="quota-status-hint__note">
        {{
          label('Showing the last successfully fetched quota.', '当前保留上次成功获取的额度数据。')
        }}
      </p>
    </div>
  </SelectionPopover>
</template>

<style scoped>
.quota-card__badge {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--primary-soft);
  color: var(--primary-soft-text);
}
.quota-card__badge--stale {
  color: var(--text-muted);
  background: var(--surface-container);
}
.quota-card__badge--hint {
  cursor: help;
}
.quota-card__badge--hint:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.quota-status-hint {
  min-height: 0;
  overflow: auto;
  padding: 14px 16px;
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.quota-status-hint strong {
  font-size: 13px;
  font-weight: 600;
}
.quota-status-hint p {
  margin: 6px 0 0;
}
.quota-status-hint__note {
  color: var(--text-muted);
}
</style>
