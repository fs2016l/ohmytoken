<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'
import {
  localRenewalDate,
  moveRenewalOrder,
  renewalIsPending,
  renewalStatus,
  type PlanRenewal,
  type PlanRenewalInput,
} from '../../../../shared/plan-renewals'
import { usePlanRenewals } from '../../composables/usePlanRenewals'
import { useRenewalLabels } from '../../composables/useRenewalLabels'
import { useFloatingCardDrag } from '../../composables/useFloatingCardDrag'
import { useI18n } from '../../i18n/useI18n'
import { motion } from '../../config/motion'
import SegmentedControl from '../base/SegmentedControl.vue'
import VendorMark from '../base/VendorMark.vue'
import PlanRenewalEditor from './PlanRenewalEditor.vue'
import PlanRenewalCalendar from './PlanRenewalCalendar.vue'
import PlanRenewalCountdown from './PlanRenewalCountdown.vue'

const { label } = useI18n()
const { providerName, cycleText, statusText } = useRenewalLabels()
const { items, loading, busy, error, load, save, remove, reorder, complete } = usePlanRenewals()
const today = ref(localRenewalDate())
const filter = ref('all')
const editorOpen = ref(false),
  editing = ref<PlanRenewal | null>(null)
const dragging = ref(''),
  previewOrder = ref<string[] | null>(null)
const counts = computed(() => ({
  soon: items.value.filter((item) => renewalStatus(item.renewOn, today.value) === 'soon').length,
  pending: items.value.filter((item) => renewalIsPending(item.renewOn, today.value)).length,
  normal: items.value.filter((item) => !renewalIsPending(item.renewOn, today.value)).length,
}))
const filters = computed(() => [
  {
    value: 'all',
    label: label(`All subscriptions ${items.value.length}`, `全部套餐 ${items.value.length}`),
  },
  {
    value: 'pending',
    label: label(`Pending ${counts.value.pending}`, `待续费 ${counts.value.pending}`),
  },
  { value: 'normal', label: label(`Normal ${counts.value.normal}`, `正常 ${counts.value.normal}`) },
])
const ordered = computed(() => {
  const rank = new Map(
    (previewOrder.value ?? items.value.map((item) => item.id)).map((id, index) => [id, index]),
  )
  return [...items.value].sort(
    (a, b) => (rank.get(a.id) ?? items.value.length) - (rank.get(b.id) ?? items.value.length),
  )
})
const visible = computed(() =>
  ordered.value.filter(
    (item) =>
      filter.value === 'all' ||
      (renewalIsPending(item.renewOn, today.value) ? 'pending' : 'normal') === filter.value,
  ),
)
function openEditor(item: PlanRenewal | null = null): void {
  if (busy.value || loading.value) return
  error.value = ''
  editing.value = item
  editorOpen.value = true
}
async function saveRecord(input: PlanRenewalInput): Promise<void> {
  if (await save(input)) editorOpen.value = false
}
async function deleteRecord(id: string): Promise<void> {
  if (await remove(id)) editorOpen.value = false
}
async function commitOrder(): Promise<void> {
  dragging.value = ''
  const next = previewOrder.value
  if (next && next.some((id, index) => id !== items.value[index]?.id)) await reorder(next)
  previewOrder.value = null
}
function cancelDrag(): void {
  dragging.value = ''
  previewOrder.value = null
}
const { start: startDrag } = useFloatingCardDrag({
  enabled: () => !busy.value && !loading.value && !editorOpen.value,
  scroll: '.renewal-rows',
  key: (card) => card.dataset.renewalId ?? '',
  cards: (card) => [
    ...(card.closest('.renewal-rows')?.querySelectorAll<HTMLElement>('[data-renewal-id]') ?? []),
  ],
  previewClass: 'renewal-row-drag-preview',
  draggingClass: 'renewal-row--dragging',
  dropMotion: { duration: motion.reorder, easing: motion.ease },
  onStart: (id) => {
    previewOrder.value = items.value.map((item) => item.id)
    dragging.value = id
  },
  onOver: (target, position) => {
    if (previewOrder.value && target && position)
      previewOrder.value = moveRenewalOrder(previewOrder.value, dragging.value, target, position)
  },
  onEnd: () => {
    void commitOrder()
  },
  onCancel: cancelDrag,
})
function reorderWithKeyboard(event: KeyboardEvent, id: string): void {
  if (!['ArrowUp', 'ArrowDown'].includes(event.key) || busy.value || dragging.value) return
  event.preventDefault()
  const index = visible.value.findIndex((item) => item.id === id)
  const target = visible.value[index + (event.key === 'ArrowUp' ? -1 : 1)]
  if (!target) return
  previewOrder.value = moveRenewalOrder(
    items.value.map((item) => item.id),
    id,
    target.id,
    event.key === 'ArrowUp' ? 'before' : 'after',
  )
  void commitOrder()
}
let clock: ReturnType<typeof setInterval> | undefined
function stopClock(): void {
  clearInterval(clock)
  clock = undefined
}
function startClock(): void {
  stopClock()
  today.value = localRenewalDate()
  clock = setInterval(() => {
    today.value = localRenewalDate()
  }, 60_000)
}
onMounted(startClock)
onActivated(startClock)
onDeactivated(() => {
  stopClock()
  editorOpen.value = false
})
onUnmounted(stopClock)
</script>

<template>
  <section
    class="renewal-manager"
    :aria-label="label('Subscription renewals', '套餐续费')"
    :data-window-retain="busy || undefined"
  >
    <header class="renewal-heading">
      <div>
        <h2>{{ label('Subscription renewals', '套餐续费') }}</h2>
        <p>
          {{ label('Manually record your next renewal dates.', '手动记录套餐的下次续费日期。') }}
        </p>
      </div>
    </header>
    <div class="renewal-feedback">
      <div v-if="error && !editorOpen" class="workspace-error renewal-error" role="alert">
        <span>{{ error }}</span>
        <button type="button" class="workspace-button" :disabled="busy || loading" @click="load">
          {{ label('Retry', '重试') }}
        </button>
      </div>
      <p
        v-else
        class="renewal-notice"
        :class="{ 'renewal-notice--clear': !counts.soon }"
        role="status"
      >
        <span class="material-symbols-outlined" aria-hidden="true">
          {{ counts.soon ? 'schedule' : 'event_available' }}
        </span>
        {{
          counts.soon
            ? label(
                `${counts.soon} subscriptions are due within 7 days.`,
                `未来 7 天有 ${counts.soon} 个套餐需要续费`,
              )
            : label('No renewals due within 7 days.', '未来 7 天暂无套餐需要续费')
        }}
      </p>
    </div>
    <div class="renewal-layout">
      <section
        class="renewal-list-panel"
        :aria-label="label('Subscriptions', '套餐列表')"
        :aria-busy="loading || busy"
      >
        <div class="renewal-list-toolbar">
          <SegmentedControl
            v-model="filter"
            :options="filters"
            :label="label('Renewal status', '续费状态')"
            compact
          />
          <button
            type="button"
            class="workspace-button workspace-button--primary renewal-add"
            :disabled="loading || busy"
            :aria-label="label('Add subscription', '添加套餐')"
            :title="label('Add subscription', '添加套餐')"
            @click="openEditor()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">add</span>
            {{ label('Add', '添加套餐') }}
          </button>
        </div>
        <p class="renewal-sort-hint">
          <span class="material-symbols-outlined" aria-hidden="true">drag_indicator</span>
          {{ label('Drag subscriptions to reorder', '拖动套餐可自由排序') }}
        </p>
        <div v-if="loading" class="workspace-empty" role="status">
          {{ label('Loading…', '正在加载…') }}
        </div>
        <div v-else-if="!items.length" class="workspace-empty">
          <span class="material-symbols-outlined" aria-hidden="true">event</span>
          <strong>{{ label('No subscriptions yet', '还没有续费记录') }}</strong>
          <p>
            {{
              label(
                'Add a subscription to keep its renewal date here.',
                '添加套餐，记录它的下次续费日期。',
              )
            }}
          </p>
        </div>
        <div v-else-if="!visible.length" class="workspace-empty">
          {{ label('No matching subscriptions', '没有符合条件的套餐') }}
        </div>
        <div
          v-else
          class="renewal-table"
          role="table"
          :aria-label="label('Subscription renewal list', '套餐续费列表')"
        >
          <div class="renewal-table-head renewal-row" role="row">
            <span class="renewal-name-heading" role="columnheader">
              {{ label('Subscription', '套餐') }}
            </span>
            <span class="renewal-next-heading" role="columnheader">
              {{ label('Next renewal', '下次续费') }}
            </span>
            <span role="columnheader">{{ label('Status', '状态') }}</span>
            <span class="renewal-edit-heading" role="columnheader">
              {{ label('Edit', '操作') }}
            </span>
          </div>
          <TransitionGroup
            tag="div"
            name="renewal-reorder"
            class="renewal-rows"
            role="rowgroup"
            :style="{ '--renewal-reorder-duration': `${motion.reorder}ms` }"
          >
            <div
              v-for="item in visible"
              :key="item.id"
              class="renewal-row"
              role="row"
              :class="{ 'renewal-row--dragging': dragging === item.id }"
              :data-renewal-id="item.id"
              @pointerdown="startDrag"
            >
              <div class="renewal-name" role="cell">
                <span
                  class="renewal-drag-handle"
                  role="button"
                  :tabindex="busy ? -1 : 0"
                  :aria-label="
                    label(
                      `Reorder ${item.name}; use up and down arrows`,
                      `排序 ${item.name}，可使用上下方向键`,
                    )
                  "
                  @keydown="reorderWithKeyboard($event, item.id)"
                />
                <VendorMark :provider="item.providerId" :size="24" />
                <div class="renewal-name-text">
                  <strong :title="item.name">{{ item.name }}</strong>
                  <span :title="item.notes || providerName(item.providerId)">
                    {{ providerName(item.providerId) }}
                  </span>
                </div>
              </div>
              <div class="renewal-next" role="cell">
                <PlanRenewalCountdown :item="item" :today="today" />
                <div class="renewal-date">
                  <time :datetime="item.renewOn">{{ item.renewOn }}</time>
                  <span>{{ cycleText(item) }}</span>
                </div>
              </div>
              <div class="renewal-status-cell" role="cell">
                <span
                  class="renewal-status"
                  :class="
                    renewalIsPending(item.renewOn, today)
                      ? 'renewal-status--pending'
                      : 'renewal-status--normal'
                  "
                  :title="statusText(item, today)"
                >
                  {{
                    renewalIsPending(item.renewOn, today)
                      ? label('Pending', '待续费')
                      : label('Normal', '正常')
                  }}
                </span>
                <button
                  v-if="renewalIsPending(item.renewOn, today)"
                  type="button"
                  class="workspace-button workspace-button--icon renewal-complete"
                  :disabled="busy"
                  :aria-label="label(`Mark ${item.name} as renewed`, `完成 ${item.name} 的续费`)"
                  :title="
                    label('Renewed · advance the next renewal date', '已完成续费，更新下次续费日期')
                  "
                  @click="complete(item)"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">check</span>
                </button>
              </div>
              <div role="cell">
                <button
                  type="button"
                  class="workspace-button workspace-button--icon"
                  :disabled="busy"
                  :aria-label="label(`Edit ${item.name}`, `编辑 ${item.name}`)"
                  @click="openEditor(item)"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">edit</span>
                </button>
              </div>
            </div>
          </TransitionGroup>
        </div>
        <p class="renewal-list-help">
          <span class="material-symbols-outlined" aria-hidden="true">info</span>
          {{
            label(
              'Dates and order are saved locally. Update them anytime.',
              '日期和顺序保存在本机，可随时修改。',
            )
          }}
        </p>
      </section>
      <PlanRenewalCalendar
        :items="ordered"
        :today="today"
        :busy="busy || loading"
        @edit="openEditor"
      />
    </div>
    <PlanRenewalEditor
      v-if="editorOpen"
      :key="editing?.id ?? 'new'"
      :item="editing"
      :busy="busy"
      :error="error"
      @close="editorOpen = false"
      @save="saveRecord"
      @remove="deleteRecord"
    />
  </section>
</template>

<style scoped src="./plan-renewal-manager.css"></style>

<style>
.renewal-row-drag-preview {
  position: fixed;
  z-index: 10020;
  inset: 0 auto auto 0;
  pointer-events: none;
  opacity: 0.95;
  border: 1px solid var(--primary-border);
  border-radius: 8px;
  box-shadow: var(--shadow-popover);
  background: var(--surface-low);
  will-change: transform;
}
</style>
