<script setup lang="ts">
import { onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { motion } from '../../config/motion'
import { useI18n } from '../../i18n/useI18n'
const props = withDefaults(defineProps<{ value: string; prompt?: boolean; label?: string }>(), {
  prompt: false,
  label: '',
})
const { label: t } = useI18n()
const status = ref<'idle' | 'copied' | 'failed'>('idle')
let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0
function reset(): void {
  generation++
  clearTimeout(timer)
  status.value = 'idle'
}
async function copy(): Promise<void> {
  clearTimeout(timer)
  const current = ++generation
  try {
    await navigator.clipboard.writeText(props.value)
    if (current === generation) status.value = 'copied'
  } catch {
    if (current === generation) status.value = 'failed'
  }
  if (current === generation) timer = setTimeout(reset, motion.copyFeedback)
}
watch(() => props.value, reset)
onDeactivated(reset)
onBeforeUnmount(reset)
</script>
<template>
  <div class="copy-text" :class="{ 'copy-text--prompt': prompt }">
    <span v-if="prompt">{{ value }}</span>
    <code v-else>{{ value }}</code>
    <button
      type="button"
      :aria-label="
        status === 'copied'
          ? t('Copied', '已复制')
          : status === 'failed'
            ? t('Copy failed, retry', '复制失败，请重试')
            : label || (prompt ? t('Copy example', '复制提示词') : t('Copy command', '复制命令'))
      "
      @click="copy"
    >
      <span class="material-symbols-outlined" aria-hidden="true">
        {{ status === 'copied' ? 'check' : status === 'failed' ? 'error' : 'content_copy' }}
      </span>
      <span v-if="prompt">
        {{
          status === 'copied'
            ? t('Copied', '已复制')
            : status === 'failed'
              ? t('Retry', '重试')
              : label || t('Copy example', '复制提示词')
        }}
      </span>
    </button>
    <span class="sr-only" role="status">
      {{
        status === 'copied'
          ? t('Copied', '已复制')
          : status === 'failed'
            ? t('Copy failed', '复制失败')
            : ''
      }}
    </span>
  </div>
</template>
<style scoped>
.copy-text {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 6px;
  background: var(--code-background, var(--surface-inverse));
  color: var(--code-foreground, var(--text-inverse));
  min-width: 0;
}
.copy-text code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  flex: 1;
  font: 12px/1.65 var(--font-mono);
}
.copy-text button {
  display: flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  color: inherit;
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 2px;
  font-size: 12px;
  flex-shrink: 0;
}
.material-symbols-outlined {
  font-size: 16px;
}
.copy-text--prompt {
  background: var(--primary-soft);
  color: var(--primary-soft-text);
  font-size: 13px;
}
.copy-text--prompt > span:first-child {
  flex: 1;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
