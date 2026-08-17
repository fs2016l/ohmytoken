<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TokenUsageSession } from '@shared/models'
import { useI18n } from '../../i18n/useI18n'
import { formatTokens } from '../../utils/format'

const props = defineProps<{
  children: TokenUsageSession[]
  ownerKey: string
}>()

const { label, tr } = useI18n()
const expanded = ref(false)
const previewCount = 3
const collapsible = computed(() => props.children.length > previewCount)
const remainingCount = computed(() => Math.max(0, props.children.length - previewCount))
const safeOwnerKey = computed(() => props.ownerKey.replace(/[^a-zA-Z0-9_-]/g, '-'))
const regionId = computed(() => `child-session-region-${safeOwnerKey.value}`)
const headingId = computed(() => `child-session-heading-${safeOwnerKey.value}`)
const stateLabel = computed(() => {
  if (!collapsible.value) {
    return label(`All ${props.children.length} shown`, `已显示全部 ${props.children.length} 条`)
  }
  if (expanded.value) {
    return label(`All ${props.children.length} shown`, `已展开全部 ${props.children.length} 条`)
  }
  return label(
    `3 shown · ${remainingCount.value} more`,
    `已显示 3 条 · 还有 ${remainingCount.value} 条`,
  )
})
const toggleTitle = computed(() =>
  expanded.value
    ? label('Collapse child sessions', '收起子会话')
    : label(
        `Show all ${props.children.length} child sessions`,
        `展开全部 ${props.children.length} 条子会话`,
      ),
)
const toggleHint = computed(() =>
  expanded.value
    ? label('Return to the compact 3-item preview', '恢复为 3 条精简预览')
    : label(
        `Continue with the remaining ${remainingCount.value} sessions`,
        `继续查看其余 ${remainingCount.value} 条子会话`,
      ),
)

function compactId(value: string): string {
  if (!value) return '-'
  if (value.length <= 18) return value
  return `${value.slice(0, 10)}...${value.slice(-5)}`
}

function sessionTitle(item: TokenUsageSession): string {
  return item.title?.trim() || compactId(item.sessionId)
}

function hasSessionTitle(item: TokenUsageSession): boolean {
  return Boolean(item.title?.trim())
}

function formatMoment(value: string): string {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
      .replace('T', ' ')
      .replace(/\.\d+Z?$/, '')
      .replace(/Z$/, '')
  }
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`
}

function toggleExpanded(): void {
  if (collapsible.value) expanded.value = !expanded.value
}
</script>

<template>
  <section
    class="child-session-list"
    :class="{ expanded, collapsible }"
    :aria-labelledby="headingId"
  >
    <header class="child-session-heading">
      <span :id="headingId" class="child-session-heading-main">
        <span class="heading-icon material-symbols-outlined" aria-hidden="true">account_tree</span>
        <span>{{ tr('childSessions') }}</span>
        <span class="child-session-count">{{ children.length }}</span>
      </span>
      <button
        v-if="collapsible"
        class="child-session-header-toggle"
        type="button"
        :aria-controls="regionId"
        :aria-expanded="expanded"
        :aria-label="toggleTitle"
        @click="toggleExpanded"
      >
        <span>{{ expanded ? label('Collapse', '收起') : label('Expandable', '可展开') }}</span>
        <span class="material-symbols-outlined" aria-hidden="true">
          {{ expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down' }}
        </span>
      </button>
      <span v-else class="child-session-state">{{ stateLabel }}</span>
    </header>

    <div class="child-session-status" aria-live="polite">{{ stateLabel }}</div>

    <div
      :id="regionId"
      class="child-session-viewport"
      :class="{ 'is-collapsed': collapsible && !expanded }"
    >
      <div
        v-for="child in children"
        :key="`${child.agent}-${child.sessionId}`"
        class="child-session-row"
      >
        <div class="child-session-main">
          <span class="child-session-title" :title="sessionTitle(child)">
            {{ sessionTitle(child) }}
          </span>
          <span v-if="hasSessionTitle(child)" class="child-session-id" :title="child.sessionId">
            {{ compactId(child.sessionId) }}
          </span>
          <span v-if="child.subAgentName" class="sub-agent-pill" :title="child.subAgentName">
            {{ child.subAgentName }}
          </span>
        </div>
        <div class="child-session-meta">
          <span class="child-model" :title="child.model">{{ child.model }}</span>
          <span>{{ formatMoment(child.startedAt) }} → {{ formatMoment(child.endedAt) }}</span>
          <span>{{ tr('apiCalls') }} {{ child.apiCallCount }}</span>
          <span class="child-token-total">{{ formatTokens(child.totalTokens) }}</span>
        </div>
      </div>
    </div>

    <button
      v-if="collapsible"
      class="child-session-toggle"
      type="button"
      :aria-controls="regionId"
      :aria-expanded="expanded"
      @click="toggleExpanded"
    >
      <span class="toggle-icon-shell">
        <span class="material-symbols-outlined" aria-hidden="true">
          {{ expanded ? 'unfold_less' : 'unfold_more' }}
        </span>
      </span>
      <span class="toggle-copy">
        <strong>{{ toggleTitle }}</strong>
        <small>{{ toggleHint }}</small>
      </span>
      <span class="toggle-chevron material-symbols-outlined" aria-hidden="true">
        keyboard_arrow_down
      </span>
    </button>
  </section>
</template>

<style scoped>
.child-session-list {
  --child-gap: 8px;
  min-width: 0;
  display: grid;
  gap: 9px;
  padding: 11px;
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--primary) 3%, transparent), transparent 44%),
    var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.child-session-heading {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.child-session-heading-main {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
}

.heading-icon {
  color: var(--primary);
  font-size: 16px;
}

.child-session-count {
  min-width: 24px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  padding: 0 7px;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 9%, var(--bg-base));
  border: 1px solid color-mix(in srgb, var(--primary) 24%, var(--border));
  border-radius: 999px;
  font-family: var(--font-number);
  font-size: 10px;
}

.child-session-state,
.child-session-status {
  color: var(--text-soft);
  font-size: 10px;
}

.child-session-status {
  min-height: 15px;
  padding-left: 23px;
}

.child-session-header-toggle {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 8px 0 10px;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 7%, var(--bg-base));
  border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--border));
  border-radius: 999px;
  font-size: 10px;
  font-weight: var(--weight-semibold);
  cursor: pointer;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    transform 160ms ease;
}

.child-session-header-toggle:hover {
  background: color-mix(in srgb, var(--primary) 13%, var(--bg-base));
  border-color: color-mix(in srgb, var(--primary) 42%, var(--border));
  transform: translateY(-1px);
}

.child-session-header-toggle .material-symbols-outlined {
  font-size: 16px;
}

.child-session-viewport {
  min-width: 0;
  position: relative;
  display: grid;
  gap: var(--child-gap);
}

.child-session-viewport.is-collapsed .child-session-row:nth-child(4) {
  min-height: 34px;
  max-height: 34px;
  overflow: hidden;
  opacity: 0.74;
  mask-image: linear-gradient(to bottom, #000 15%, transparent 100%);
}

.child-session-viewport.is-collapsed .child-session-row:nth-child(n + 5) {
  display: none;
}

.child-session-viewport.is-collapsed::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 58px;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--surface-low) 92%);
}

.child-session-row {
  min-width: 0;
  min-height: 62px;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.6fr);
  gap: 8px;
  align-items: center;
  padding: 9px 10px;
  background: color-mix(in srgb, var(--bg-base) 94%, var(--primary) 6%);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-sizing: border-box;
}

.expanded .child-session-row:nth-child(n + 4) {
  animation: reveal-child-session 180ms ease both;
}

.child-session-main {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.child-session-title,
.child-session-id,
.sub-agent-pill,
.child-model {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.child-session-title {
  color: var(--text);
  font-size: 12px;
  font-weight: var(--weight-semibold);
}

.child-session-id {
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
}

.sub-agent-pill {
  max-width: 140px;
  min-height: 20px;
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  color: var(--primary);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
}

.child-session-meta {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 8px;
  color: var(--text-soft);
  font-size: var(--type-caption);
  text-align: right;
}

.child-token-total {
  color: var(--primary);
  font-family: var(--font-number);
  font-weight: var(--weight-semibold);
}

.child-session-toggle {
  width: 100%;
  min-height: 52px;
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px 11px;
  color: var(--text-muted);
  text-align: left;
  background: linear-gradient(
    120deg,
    color-mix(in srgb, var(--primary) 12%, var(--bg-base)),
    color-mix(in srgb, var(--primary) 4%, var(--surface-container))
  );
  border: 1px solid color-mix(in srgb, var(--primary) 26%, var(--border));
  border-radius: 10px;
  box-shadow: 0 8px 20px color-mix(in srgb, var(--primary) 6%, transparent);
  cursor: pointer;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.child-session-toggle:hover {
  border-color: color-mix(in srgb, var(--primary) 48%, var(--border));
  box-shadow: 0 10px 24px color-mix(in srgb, var(--primary) 12%, transparent);
  transform: translateY(-1px);
}

.child-session-toggle:focus-visible,
.child-session-header-toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--primary) 64%, white);
  outline-offset: 2px;
}

.toggle-icon-shell {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--bg-base));
  border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--border));
  border-radius: 9px;
}

.toggle-icon-shell .material-symbols-outlined,
.toggle-chevron {
  font-size: 19px;
}

.toggle-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.toggle-copy strong {
  overflow: hidden;
  color: var(--text);
  font-size: 11px;
  font-weight: var(--weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toggle-copy small {
  overflow: hidden;
  color: var(--text-soft);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toggle-chevron {
  color: var(--primary);
  transition: transform 180ms ease;
}

.expanded .toggle-chevron {
  transform: rotate(180deg);
}

@keyframes reveal-child-session {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 720px) {
  .child-session-list {
    padding: 9px;
  }

  .child-session-heading {
    align-items: flex-start;
  }

  .child-session-status {
    padding-left: 0;
  }

  .child-session-row {
    min-height: 86px;
    grid-template-columns: 1fr;
  }

  .child-session-meta {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    flex-wrap: wrap;
    text-align: left;
  }

  .child-session-viewport.is-collapsed .child-session-row:nth-child(4) {
    min-height: 44px;
    max-height: 44px;
  }
}
</style>
