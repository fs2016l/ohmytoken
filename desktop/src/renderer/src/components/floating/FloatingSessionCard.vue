<script setup lang="ts">
import { computed, onUnmounted } from 'vue'
import { agentColors, getAgentName } from '../../config/agents'
import { useI18n } from '../../i18n/useI18n'
import { formatTokens } from '../../utils/format'
import type { FloatingSessionItem } from '../../composables/useFloatingSessions'

type DropPosition = 'before' | 'after'

const props = defineProps<{
  session: FloatingSessionItem
  pinned: boolean
  dragging?: boolean
  dropPosition?: DropPosition | null
  delta?: number
  now: number
}>()

const emit = defineEmits<{
  togglePin: [session: FloatingSessionItem]
  dragStart: [key: string]
  dragOver: [targetKey: string | null, position: DropPosition | null]
  dragEnd: []
}>()

const { label } = useI18n()

const encodedSessionKey = computed(() => encodeURIComponent(props.session.key))
const pointerDragThreshold = 4

let dragPreview: HTMLElement | null = null
let dragOffsetX = 0
let dragOffsetY = 0
let pointerStartX = 0
let pointerStartY = 0
let activePointerId: number | null = null
let pointerCard: HTMLElement | null = null
let pointerDragging = false

function setDragCursor(active: boolean): void {
  document.documentElement.classList.toggle('session-reorder-active', active)
  document.body.classList.toggle('session-reorder-active', active)
}

function addGlobalPointerListeners(): void {
  window.addEventListener('pointermove', movePointerDrag, true)
  window.addEventListener('pointerup', finishPointerDrag, true)
  window.addEventListener('pointercancel', finishPointerDrag, true)
  window.addEventListener('blur', cancelPointerDrag, true)
}

function removeGlobalPointerListeners(): void {
  window.removeEventListener('pointermove', movePointerDrag, true)
  window.removeEventListener('pointerup', finishPointerDrag, true)
  window.removeEventListener('pointercancel', finishPointerDrag, true)
  window.removeEventListener('blur', cancelPointerDrag, true)
}

function removeDragPreview(): void {
  dragPreview?.remove()
  dragPreview = null
}

function positionDragPreview(clientX: number, clientY: number): void {
  if (!dragPreview) return
  const left = Math.round(clientX - dragOffsetX)
  const top = Math.round(clientY - dragOffsetY)
  dragPreview.style.transform = 'translate3d(' + left + 'px, ' + top + 'px, 0)'
}

function createDragPreview(card: HTMLElement, clientX: number, clientY: number): void {
  removeDragPreview()
  const bounds = card.getBoundingClientRect()
  const preview = card.cloneNode(true) as HTMLElement
  preview.classList.remove(
    'session-card--dragging',
    'session-card--drop-before',
    'session-card--drop-after',
  )
  preview.classList.add('session-card-drag-preview')
  preview.setAttribute('aria-hidden', 'true')
  preview.setAttribute('inert', '')
  preview.style.width = String(bounds.width) + 'px'
  preview.style.height = String(bounds.height) + 'px'
  dragPreview = preview
  document.body.appendChild(preview)
  positionDragPreview(clientX, clientY)
}

function emitPointerTarget(clientX: number, clientY: number): void {
  const hit = document.elementFromPoint(clientX, clientY)
  const target =
    hit instanceof Element
      ? hit.closest<HTMLElement>('.session-card--pinned[data-session-drag-key]')
      : null
  const encodedTargetKey = target?.dataset.sessionDragKey
  if (!target || !encodedTargetKey) {
    emit('dragOver', null, null)
    return
  }

  let targetKey = ''
  try {
    targetKey = decodeURIComponent(encodedTargetKey)
  } catch {
    emit('dragOver', null, null)
    return
  }
  if (targetKey === props.session.key) {
    emit('dragOver', null, null)
    return
  }

  const bounds = target.getBoundingClientRect()
  const position: DropPosition = clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
  emit('dragOver', targetKey, position)
}

function resetPointerDrag(): boolean {
  const wasDragging = pointerDragging
  removeGlobalPointerListeners()
  if (pointerCard && activePointerId !== null && pointerCard.hasPointerCapture(activePointerId)) {
    pointerCard.releasePointerCapture(activePointerId)
  }
  activePointerId = null
  pointerCard = null
  pointerDragging = false
  removeDragPreview()
  setDragCursor(false)
  return wasDragging
}

onUnmounted(() => {
  resetPointerDrag()
})

const cacheTokens = computed(() => props.session.cacheReadTokens + props.session.cacheWriteTokens)

const displayTitle = computed(
  () =>
    props.session.title?.trim() ||
    `${label('Session', '会话')} ${props.session.rootSessionId.slice(0, 8)}`,
)

const modelText = computed(() => {
  const models = props.session.models.filter(Boolean)
  if (models.length === 0) return label('Unknown model', '未知模型')
  const visibleModels = models.slice(0, 5)
  const hiddenModelCount = models.length - visibleModels.length
  return `${visibleModels.join(' · ')}${hiddenModelCount > 0 ? ` +${hiddenModelCount}` : ''}`
})

const allModels = computed(() => props.session.models.join(' · '))
const agentColor = computed(() => agentColors[props.session.agent] || '#94a3b8')

const lastActivityAt = computed(() => {
  const value = props.session.endedAt || props.session.startedAt
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
})

const isActive = computed(() => {
  if (!lastActivityAt.value) return false
  const elapsed = props.now - lastActivityAt.value
  return elapsed >= 0 && elapsed <= 2 * 60_000
})

const relativeActivity = computed(() => {
  if (!lastActivityAt.value) return '—'
  const elapsed = Math.max(0, props.now - lastActivityAt.value)
  const seconds = Math.floor(elapsed / 1000)
  if (seconds < 60) return label('just now', '刚刚')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return label(`${minutes}m ago`, `${minutes}分钟前`)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return label(`${hours}h ago`, `${hours}小时前`)
  return new Date(lastActivityAt.value).toLocaleDateString(label('en-US', 'zh-CN'), {
    month: 'numeric',
    day: 'numeric',
  })
})

function startPointerDrag(event: PointerEvent): void {
  if (!props.pinned || !event.isPrimary || event.button !== 0 || activePointerId !== null) return

  const origin = event.target
  if (
    origin instanceof Element &&
    origin.closest('button, a, input, select, textarea, [contenteditable="true"]')
  ) {
    return
  }

  const card = event.currentTarget as HTMLElement
  const bounds = card.getBoundingClientRect()
  dragOffsetX = Math.min(bounds.width, Math.max(0, event.clientX - bounds.left))
  dragOffsetY = Math.min(bounds.height, Math.max(0, event.clientY - bounds.top))
  pointerStartX = event.clientX
  pointerStartY = event.clientY
  activePointerId = event.pointerId
  pointerCard = card
  event.preventDefault()
  setDragCursor(true)
  addGlobalPointerListeners()
  try {
    card.setPointerCapture(event.pointerId)
  } catch {
    resetPointerDrag()
  }
}

function movePointerDrag(event: PointerEvent): void {
  if (event.pointerId !== activePointerId || !pointerCard) return
  event.preventDefault()

  if (!pointerDragging) {
    const distance = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY)
    if (distance < pointerDragThreshold) return
    pointerDragging = true
    createDragPreview(pointerCard, event.clientX, event.clientY)
    emit('dragStart', props.session.key)
  }

  positionDragPreview(event.clientX, event.clientY)
  emitPointerTarget(event.clientX, event.clientY)
}

function finishPointerDrag(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) return
  if (pointerDragging) event.preventDefault()
  const wasDragging = resetPointerDrag()
  if (wasDragging) emit('dragEnd')
}

function cancelPointerDrag(): void {
  if (activePointerId === null) return
  const wasDragging = resetPointerDrag()
  if (wasDragging) emit('dragEnd')
}
</script>

<template>
  <article
    class="session-card"
    :class="{
      'session-card--pinned': pinned,
      'session-card--dragging': dragging,
      'session-card--drop-before': dropPosition === 'before',
      'session-card--drop-after': dropPosition === 'after',
    }"
    :data-session-drag-key="encodedSessionKey"
    @pointerdown="startPointerDrag"
  >
    <div class="session-heading">
      <div class="session-title-wrap">
        <strong class="session-title" :title="displayTitle">{{ displayTitle }}</strong>
        <span class="activity" :class="{ 'activity--active': isActive }">
          <i></i>
          {{ isActive ? `${label('Active', '活跃')} · ` : '' }}{{ relativeActivity }}
        </span>
      </div>

      <button
        class="pin-button"
        :class="{ 'pin-button--active': pinned }"
        type="button"
        :aria-pressed="pinned"
        :aria-label="pinned ? label('Unpin session', '取消置顶') : label('Pin session', '置顶会话')"
        :title="pinned ? label('Unpin session', '取消置顶') : label('Pin session', '置顶会话')"
        @click="emit('togglePin', session)"
      >
        {{ pinned ? label('Unpin', '取消置顶') : label('Pin', '置顶') }}
      </button>
    </div>

    <div class="session-meta">
      <span class="agent-dot" :style="{ background: agentColor }"></span>
      <span>{{ getAgentName(session.agent) }}</span>
      <span class="meta-divider">·</span>
      <span class="model-name" :title="allModels">{{ modelText }}</span>
    </div>

    <div class="token-grid">
      <div class="token-cell token-cell--total">
        <span>{{ label('Total', '总计') }}</span>
        <strong>{{ formatTokens(session.totalTokens) }}</strong>
        <em v-if="delta && delta > 0">+{{ formatTokens(delta) }}</em>
      </div>
      <div class="token-cell">
        <span>{{ label('Input', '输入') }}</span>
        <strong>{{ formatTokens(session.inputTokens) }}</strong>
      </div>
      <div class="token-cell">
        <span>{{ label('Output', '输出') }}</span>
        <strong>{{ formatTokens(session.outputTokens) }}</strong>
      </div>
      <div class="token-cell">
        <span>{{ label('Cache', '缓存') }}</span>
        <strong>{{ formatTokens(cacheTokens) }}</strong>
      </div>
    </div>

    <div class="session-footer">
      <span>{{ session.apiCallCount }} {{ label('calls', '次调用') }}</span>
      <span>{{ session.childCount }} {{ label('child sessions', '个子会话') }}</span>
      <span v-if="session.reasoningTokens > 0">
        {{ label('Reasoning', '推理') }} {{ formatTokens(session.reasoningTokens) }}
      </span>
    </div>
  </article>
</template>

<style scoped>
.session-card {
  position: relative;
  padding: 12px;
  background: color-mix(in srgb, var(--surface-container) 92%, transparent);
  border: 1px solid var(--border);
  border-radius: 13px;
  box-shadow: var(--shadow-card);
  transition:
    border-color 0.16s ease,
    opacity 0.16s ease,
    transform 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.session-card:hover {
  background: var(--surface-container-high);
  border-color: var(--border-strong);
}

.session-card--pinned {
  border-color: color-mix(in srgb, var(--primary) 42%, var(--border));
  cursor: grab;
  touch-action: none;
  -webkit-user-drag: none;
}

.session-card--pinned:active {
  cursor: grabbing;
}

:global(html.session-reorder-active),
:global(html.session-reorder-active body),
:global(html.session-reorder-active body *) {
  cursor: grabbing !important;
  user-select: none !important;
}

.session-card--dragging {
  opacity: 1;
  border-color: color-mix(in srgb, var(--primary) 54%, var(--border));
  border-style: dashed;
  background: color-mix(in srgb, var(--primary) 8%, var(--surface-container));
  box-shadow: none;
  transform: none;
  cursor: grabbing;
}

.session-card--dragging > * {
  visibility: hidden;
}

.session-card-drag-preview {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 4000;
  box-sizing: border-box;
  margin: 0;
  opacity: 1;
  border-color: var(--primary);
  background: var(--surface-container-high);
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.32),
    0 0 0 1px color-mix(in srgb, var(--primary) 24%, transparent);
  transform-origin: top left;
  transition: none !important;
  pointer-events: none;
  will-change: transform;
  cursor: grabbing;
}

.session-card-drag-preview * {
  pointer-events: none !important;
}

.session-card--drop-before::before,
.session-card--drop-after::before {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  height: 2px;
  background: var(--primary);
  border-radius: 99px;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 14%, transparent);
  pointer-events: none;
  z-index: 2;
}

.session-card--drop-before::before {
  top: -5px;
}

.session-card--drop-after::before {
  bottom: -5px;
}

.session-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.session-title-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.session-title {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  line-height: 20px;
  font-weight: var(--weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
  white-space: nowrap;
}

.activity i {
  width: 6px;
  height: 6px;
  background: var(--text-muted);
  border-radius: 50%;
}

.activity--active {
  color: var(--tertiary);
}

.activity--active i {
  background: var(--tertiary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tertiary) 14%, transparent);
}

.pin-button {
  flex: 0 0 auto;
  min-width: 42px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 9px;
  color: var(--text-muted);
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 7px;
  font-size: var(--type-caption);
  line-height: 1;
  font-weight: var(--weight-semibold);
  white-space: nowrap;
  cursor: pointer;
}

.pin-button:hover {
  color: var(--text);
  background: var(--surface-bright);
}

.pin-button--active {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 9%, var(--surface-low));
  border-color: color-mix(in srgb, var(--primary) 34%, var(--border));
}

.session-meta {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin: 5px 0 9px 23px;
  color: var(--text-muted);
  font-size: var(--type-caption);
  line-height: 16px;
}

.agent-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 4px;
}

.meta-divider {
  color: var(--text-muted);
}

.model-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.token-grid {
  display: grid;
  grid-template-columns: 1.15fr repeat(3, 1fr);
  gap: 5px;
}

.token-cell {
  min-width: 0;
  padding: 6px 7px;
  background: color-mix(in srgb, var(--surface-low) 74%, transparent);
  border-radius: 8px;
}

.token-cell span,
.token-cell strong {
  display: block;
}

.token-cell span {
  margin-bottom: 2px;
  color: var(--text-muted);
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
}

.token-cell strong {
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  line-height: 17px;
  font-weight: var(--weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.token-cell--total strong {
  color: var(--primary);
}

.token-cell em {
  display: block;
  margin-top: 1px;
  color: var(--tertiary);
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
  font-style: normal;
  font-weight: var(--weight-semibold);
}

.session-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 8px;
  color: var(--text-muted);
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
}
</style>
