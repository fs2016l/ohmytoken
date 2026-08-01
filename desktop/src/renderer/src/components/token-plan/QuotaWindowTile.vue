<script setup lang="ts">
import { computed } from 'vue'
import type { TokenPlanWindowId, TokenPlanWindowUsage } from '../../../../shared/token-plan'
import { useI18n } from '../../i18n/useI18n'

const props = defineProps<{
  windowId: TokenPlanWindowId
  usage: TokenPlanWindowUsage | null
  configured: boolean
  accent: string
}>()

const { currentLang, label } = useI18n()

const title = computed(() => {
  const titles: Record<TokenPlanWindowId, string> = {
    '5h': label('5-hour window', '5 小时窗口'),
    '7d': label('7-day window', '7 天窗口'),
  }
  return titles[props.windowId]
})

const usedPercent = computed(() => props.usage?.usedPercent ?? null)
const percentText = computed(() => {
  if (usedPercent.value === null) return '--'
  const value = Math.round(usedPercent.value * 10) / 10
  return `${value}%`
})

const reasonText = computed(() => {
  if (!props.configured) return label('Add an API key first', '请先添加 API Key')
  if (!props.usage) return label('Waiting to query', '等待查询')
  if (props.usage.available) return ''

  return label('The provider API does not return it', '厂商接口未返回该窗口')
})

const detailText = computed(() => {
  const usage = props.usage
  if (!usage?.available) return reasonText.value
  if (usage.used !== null && usage.limit !== null) {
    return label(
      `${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()} used`,
      `已用 ${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()}`,
    )
  }
  if (usage.remainingPercent !== null) {
    const value = Math.round(usage.remainingPercent * 10) / 10
    return label(`${value}% remaining`, `剩余 ${value}%`)
  }
  return label('Usage percentage', '使用占比')
})

const resetText = computed(() => {
  const resetsAt = props.usage?.resetsAt
  if (!resetsAt) return ''
  const locale = currentLang.value === 'zh' ? 'zh-CN' : 'en-US'
  return (
    label('Resets ', '重置于 ') +
    new Intl.DateTimeFormat(locale, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(resetsAt))
  )
})
</script>

<template>
  <div
    class="quota-window"
    :class="{ 'quota-window--unavailable': !usage?.available }"
    :style="{ '--quota-accent': accent }"
  >
    <div class="quota-window__heading">
      <span>{{ title }}</span>
      <span v-if="usage?.available" class="quota-window__live">
        <span></span>
        {{ label('LIVE', '实时') }}
      </span>
    </div>

    <div class="quota-window__value">{{ percentText }}</div>
    <div class="quota-window__detail">{{ detailText }}</div>

    <div
      v-if="usage?.available && usedPercent !== null"
      class="quota-window__track"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="usedPercent"
    >
      <span :style="{ width: `${Math.min(100, Math.max(0, usedPercent))}%` }"></span>
    </div>
    <div v-else class="quota-window__track quota-window__track--empty"></div>

    <div class="quota-window__reset">{{ resetText || '\u00a0' }}</div>
  </div>
</template>

<style scoped>
.quota-window {
  min-width: 0;
  padding: 16px;
  background: color-mix(in srgb, var(--surface) 92%, var(--quota-accent) 8%);
  border: 1px solid color-mix(in srgb, var(--border) 72%, var(--quota-accent) 28%);
  border-radius: var(--radius-lg);
}

.quota-window--unavailable {
  background: var(--surface-low);
  border-color: var(--border);
}

.quota-window__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: var(--weight-semibold);
}

.quota-window__live {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--success);
  font-size: 10px;
  letter-spacing: 0.05em;
}

.quota-window__live span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 15%, transparent);
}

.quota-window__value {
  min-height: 36px;
  margin-top: 10px;
  color: var(--text);
  font-family: var(--font-number);
  font-size: 28px;
  line-height: 36px;
  font-weight: var(--weight-semibold);
  letter-spacing: -0.04em;
}

.quota-window--unavailable .quota-window__value {
  color: var(--text-soft);
}

.quota-window__detail {
  min-height: 36px;
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 18px;
}

.quota-window__track {
  height: 6px;
  margin-top: 10px;
  overflow: hidden;
  background: color-mix(in srgb, var(--quota-accent) 12%, var(--surface));
  border-radius: 999px;
}

.quota-window__track span {
  display: block;
  height: 100%;
  background: var(--quota-accent);
  border-radius: inherit;
  transition: width 260ms ease;
}

.quota-window__track--empty {
  background: repeating-linear-gradient(
    135deg,
    var(--border) 0,
    var(--border) 4px,
    transparent 4px,
    transparent 8px
  );
  opacity: 0.55;
}

.quota-window__reset {
  margin-top: 8px;
  overflow: hidden;
  color: var(--text-soft);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
