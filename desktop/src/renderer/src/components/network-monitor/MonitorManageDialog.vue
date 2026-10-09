<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MonitorRule } from '@shared/network-monitor'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import { useI18n } from '../../i18n/useI18n'
import { useFloatingCardDrag } from '../../composables/useFloatingCardDrag'
import { motion } from '../../config/motion'

const props = defineProps<{ open: boolean; rules: MonitorRule[]; pending: boolean }>()
const emit = defineEmits<{
  close: []
  toggle: [id: string, enabled: boolean]
  remove: [id: string]
}>()
const { label } = useI18n()
const storageKey = 'network-monitor-application-order'
function readOrder(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(stored)
      ? [
          ...new Set(
            stored
              .slice(0, 200)
              .filter((id): id is string => typeof id === 'string' && id.length <= 100),
          ),
        ]
      : []
  } catch {
    return []
  }
}
const order = ref(readOrder())
const draft = ref<string[] | null>(null)
const dragging = ref('')
const saveFailed = ref(false)
const announcement = ref('')
const rules = computed(() => {
  const ids = draft.value ?? order.value
  const ranks = new Map(ids.map((id, index) => [id, index]))
  return [...props.rules].sort(
    (a, b) => (ranks.get(a.id) ?? ids.length) - (ranks.get(b.id) ?? ids.length),
  )
})
function saveOrder(ids: string[], moved: string): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(ids))
    order.value = ids
    saveFailed.value = false
    const name = props.rules.find((rule) => rule.id === moved)?.name ?? ''
    const position = ids.indexOf(moved) + 1
    announcement.value = label(
      `${name} moved to position ${position}`,
      `已将 ${name} 移至第 ${position} 项`,
    )
  } catch {
    saveFailed.value = true
  }
}
function moveOver(target: string | null, position: 'before' | 'after' | null): void {
  if (!dragging.value || !target || target === dragging.value || !position) return
  const ids = rules.value.map((rule) => rule.id)
  const from = ids.indexOf(dragging.value)
  if (from < 0 || !ids.includes(target)) return
  ids.splice(from, 1)
  ids.splice(ids.indexOf(target) + Number(position === 'after'), 0, dragging.value)
  draft.value = ids
}
const { start: startDrag, stop: stopDrag } = useFloatingCardDrag({
  enabled: () => props.open && !props.pending,
  key: (card) => card.dataset.rule ?? '',
  cards: (card) => [
    ...(card.closest('.monitor-rules')?.querySelectorAll<HTMLElement>('[data-rule]') ?? []),
  ],
  handle: '.monitor-rule-handle',
  previewClass: 'monitor-rule-preview',
  draggingClass: 'monitor-rule--dragging',
  dropMotion: { duration: motion.reorder, easing: motion.entranceEase },
  onStart: (id) => {
    dragging.value = id
    draft.value = rules.value.map((rule) => rule.id)
  },
  onOver: moveOver,
  onEnd: () => {
    if (draft.value)
      saveOrder(
        rules.value.map((rule) => rule.id),
        dragging.value,
      )
    draft.value = null
    dragging.value = ''
  },
  onCancel: () => {
    draft.value = null
    dragging.value = ''
  },
})
function moveWithKeyboard(id: string, event: KeyboardEvent): void {
  if (
    props.pending ||
    dragging.value ||
    !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
  )
    return
  event.preventDefault()
  const ids = rules.value.map((rule) => rule.id)
  const from = ids.indexOf(id)
  if (from < 0) return
  const to =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? ids.length - 1
        : from + (event.key === 'ArrowUp' ? -1 : 1)
  if (to < 0 || to >= ids.length || to === from) return
  ids.splice(from, 1)
  ids.splice(to, 0, id)
  saveOrder(ids, id)
}
watch(
  () => props.open,
  (open) => {
    if (!open) stopDrag()
  },
)
</script>

<template>
  <WorkspaceDialog
    :open="open"
    :title="label('Manage monitored applications', '管理监测应用')"
    class="monitor-manage-dialog"
    @close="emit('close')"
  >
    <p class="monitor-help">
      {{
        label(
          'Related child processes are grouped automatically. Turning a rule off stops future counting; existing readings remain.',
          '自动归入关联子进程；关闭规则后不再累计新流量，已有读数仍会保留。',
        )
      }}
    </p>
    <p class="monitor-help">
      {{
        label(
          'Drag the handle to reorder; the order is saved on this device. You can also use the ↑ / ↓ keys.',
          '拖动左侧手柄调整顺序，自动保存在本机；也可使用 ↑ / ↓ 键。',
        )
      }}
    </p>
    <p v-if="saveFailed" class="monitor-note monitor-error" role="alert">
      {{ label('Could not save the order. Please try again.', '顺序未能保存，请重新调整。') }}
    </p>
    <span class="monitor-sort-announcement" role="status">{{ announcement }}</span>
    <TransitionGroup
      tag="section"
      name="monitor-rule-order"
      class="monitor-rules"
      :style="{ '--monitor-reorder-duration': `${motion.reorder}ms` }"
    >
      <article
        v-for="rule in rules"
        :key="rule.id"
        class="monitor-rule"
        :class="{ 'monitor-rule--dragging': dragging === rule.id }"
        :data-rule="rule.id"
        @pointerdown="startDrag"
      >
        <button
          type="button"
          class="monitor-rule-handle"
          :aria-label="label('Reorder ' + rule.name, '调整 ' + rule.name + ' 顺序')"
          :title="label('Drag to reorder, or use ↑ / ↓', '拖动排序，或使用 ↑ / ↓ 键')"
          :disabled="pending"
          @keydown="moveWithKeyboard(rule.id, $event)"
        >
          <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
            <circle
              v-for="point in [
                [5, 4],
                [11, 4],
                [5, 10],
                [11, 10],
                [5, 16],
                [11, 16],
              ]"
              :key="point.join('-')"
              :cx="point[0]"
              :cy="point[1]"
              r="1.4"
            />
          </svg>
        </button>
        <span class="monitor-app-mark">{{ rule.name.slice(0, 1) }}</span>
        <div class="monitor-rule-info">
          <strong>{{ rule.name }}</strong>
          <p class="monitor-path">
            {{
              rule.entryPoint ||
              rule.bundlePath ||
              rule.executable ||
              label('Built-in entry recognition', '内置应用入口识别')
            }}
          </p>
          <small v-if="rule.instanceKey">
            {{ label('This process instance only', '仅当前进程实例') }}
          </small>
        </div>
        <label class="monitor-switch">
          <input
            type="checkbox"
            role="switch"
            :checked="rule.enabled"
            :aria-label="label('Monitor ' + rule.name, '监测 ' + rule.name)"
            :disabled="pending"
            @change="emit('toggle', rule.id, ($event.target as HTMLInputElement).checked)"
          />
          <span />
        </label>
        <button
          v-if="rule.source === 'custom'"
          type="button"
          class="workspace-button"
          :disabled="pending"
          @click="emit('remove', rule.id)"
        >
          {{ label('Remove', '移除') }}
        </button>
      </article>
    </TransitionGroup>
  </WorkspaceDialog>
</template>
