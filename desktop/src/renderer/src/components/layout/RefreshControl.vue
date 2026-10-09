<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, useId, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { ScanProgress, ScanWorkProgress } from '@shared/scan-progress'
import type { ScanMode } from '@shared/models'
import { useI18n } from '../../i18n/useI18n'
import DropdownChevron from '../base/DropdownChevron.vue'
import { getAgentName } from '../../config/agents'
import { useScanStatus } from '../../composables/useScanStatus'
import { useScanRefresh } from '../../composables/useScanRefresh'
import ScanRefreshSettings from './ScanRefreshSettings.vue'
import { useVisibleNow } from '../../composables/useVisibleNow'
import { advanceScanProgress, type ScanProgressDisplay } from '../../utils/scan-progress-display'

const { label, currentLang } = useI18n()
const route = useRoute()
const scan = useScanStatus()
const autoRefresh = useScanRefresh()
const busy = scan.busy
const localError = ref('')
const startingFromId = ref<string | null>(null)
const requestedMode = ref<ScanMode>('incremental')
const error = computed(() => localError.value || scan.error.value)
const progress = computed(() => {
  const value = scan.progress.value as ScanProgress | null
  return !busy.value || value?.scanId !== startingFromId.value ? value : null
})
const display = shallowRef<ScanProgressDisplay | null>(null)
watch(
  scan.progress,
  (value) => {
    if (value) display.value = advanceScanProgress(display.value, value as ScanProgress)
  },
  { immediate: true },
)
const succeeded = ref(false)
let successTimer: ReturnType<typeof setTimeout> | undefined
function clearSuccess(): void {
  clearTimeout(successTimer)
  succeeded.value = false
}
watch(busy, (running, wasRunning) => {
  if (running) {
    clearSuccess()
    localError.value = ''
  } else if (wasRunning && !error.value) {
    succeeded.value = true
    successTimer = setTimeout(() => {
      succeeded.value = false
    }, 1500)
  }
})
watch(error, (value) => {
  if (value) clearSuccess()
})
const value = computed(() =>
  succeeded.value ? 1 : progress.value ? (display.value?.value ?? 0) : 0,
)
const indeterminate = computed(
  () => busy.value && (!progress.value || display.value?.indeterminate),
)
const state = computed(() =>
  busy.value ? 'running' : error.value ? 'error' : succeeded.value ? 'complete' : 'idle',
)
const buttonLabel = computed(() =>
  busy.value
    ? (progress.value?.mode ?? requestedMode.value) === 'full'
      ? label('Full refresh', '全量刷新中')
      : label('Updating', '更新中')
    : error.value
      ? label('Update issue', '部分未更新')
      : succeeded.value
        ? label('Updated', '已更新')
        : label('Refresh data', '刷新数据'),
)
const now = useVisibleNow()
const updatedLabel = computed(() => {
  const timestamp = new Date(scan.updatedAt.value).getTime()
  if (!Number.isFinite(timestamp)) return label('Not updated yet', '尚未更新')
  const minutes = Math.floor(Math.max(0, now.value - timestamp) / 60_000)
  if (minutes < 1) return label('Just updated', '刚刚更新')
  if (minutes < 60) return label(`Updated ${minutes}m ago`, `${minutes} 分钟前更新`)
  return (
    label('Last updated: ', '上次更新：') +
    new Date(timestamp).toLocaleString(currentLang.value === 'zh' ? 'zh-CN' : 'en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  )
})
const phase = computed(() => {
  if (!busy.value)
    return error.value
      ? label('Some data could not be updated', '部分数据未能更新')
      : updatedLabel.value
  switch (progress.value?.phase) {
    case 'reading':
      return label('Reading local usage', '读取本地用量')
    case 'writing':
      return label('Summarizing sessions', '整理会话')
    case 'costs':
      return label('Calculating estimates', '计算预估费用')
    case 'committing':
      return label('Verifying and saving', '核验并保存')
    default:
      return label('Finding local sources', '查找本地数据')
  }
})
const steps = computed(() => {
  const current = progress.value
  const complete = current?.status === 'complete' && !error.value
  const saving = current?.phase === 'costs' || current?.phase === 'committing'
  const read =
    complete ||
    saving ||
    (!!current?.totalAgents && current.completedAgents === current.totalAgents)
  return [
    { name: label('Read local usage', '读取本地用量'), done: read, active: busy.value && !read },
    {
      name: label('Summarize sessions', '整理会话'),
      done: complete || saving,
      active:
        busy.value &&
        !saving &&
        (current?.phase === 'writing' ||
          !!current?.activeAgents?.some((item) => item.phase === 'writing')),
    },
    {
      name: label('Calculate costs and save', '计算费用并保存'),
      done: complete,
      active: busy.value && saving,
    },
  ]
})
function workLabel(work: ScanWorkProgress): string {
  const units = {
    files: label('files', '个文件'),
    bytes: label('bytes', '字节'),
    rows: label('rows', '条记录'),
    calls: label('API records', '条 API 记录'),
    sessions: label('sessions', '个会话'),
    days: label('days', '天'),
  }
  return `${work.completed.toLocaleString()}${work.total === undefined ? '' : ` / ${work.total.toLocaleString()}`} ${units[work.unit]}`
}
const open = ref(false)
const fullOpen = ref(false)
let hoverTimer: ReturnType<typeof setTimeout> | undefined
const root = ref<HTMLElement | null>(null)
const main = ref<HTMLButtonElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const panelId = useId()
const fullId = useId()
function hideFull(): void {
  clearTimeout(hoverTimer)
  fullOpen.value = false
}
function showFull(): void {
  clearTimeout(hoverTimer)
  if (!busy.value && !open.value) fullOpen.value = true
}
function leaveFull(): void {
  clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    fullOpen.value = false
  }, 180)
}
async function focusFull(): Promise<void> {
  showFull()
  await nextTick()
  root.value?.querySelector<HTMLButtonElement>('.refresh-full-action')?.focus()
}
function close(restoreFocus = false): void {
  const wasDetails = open.value
  open.value = false
  hideFull()
  if (restoreFocus) {
    ;(wasDetails ? trigger.value : main.value)?.focus()
    hideFull()
  }
}
async function toggle(): Promise<void> {
  hideFull()
  open.value = !open.value
  if (open.value) {
    await nextTick()
    panel.value?.focus({ preventScroll: true })
  }
}
function outside(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) close()
}
function focusOut(event: FocusEvent): void {
  if (event.relatedTarget && !root.value?.contains(event.relatedTarget as Node)) close()
}
async function refresh(mode: ScanMode = 'incremental'): Promise<void> {
  if (busy.value) return
  hideFull()
  requestedMode.value = mode
  startingFromId.value = scan.progress.value?.scanId ?? ''
  clearSuccess()
  localError.value = ''
  try {
    await scan.refresh(mode)
  } catch (reason) {
    localError.value = reason instanceof Error ? reason.message : String(reason)
  }
}
watch(busy, hideFull)
watch(
  () => route.fullPath,
  () => close(),
)
onMounted(() => document.addEventListener('pointerdown', outside))
onUnmounted(() => {
  clearTimeout(successTimer)
  clearTimeout(hoverTimer)
  document.removeEventListener('pointerdown', outside)
})
</script>

<template>
  <div
    ref="root"
    class="refresh-control"
    data-selection-scope
    :data-state="state"
    @focusout="focusOut"
    @mouseleave="leaveFull"
    @keydown.esc.stop.prevent="close(true)"
  >
    <div data-selection-host />
    <div class="refresh-control-buttons">
      <button
        ref="main"
        class="refresh-main"
        type="button"
        :aria-label="buttonLabel"
        :disabled="busy"
        :title="error || updatedLabel"
        :aria-controls="fullOpen ? fullId : undefined"
        @mouseenter="showFull"
        @focus="showFull"
        @keydown.arrow-down.prevent="focusFull"
        @click="refresh()"
      >
        <span v-if="!busy" class="material-symbols-outlined refresh-icon" aria-hidden="true">
          {{ error ? 'error_outline' : succeeded ? 'check' : 'refresh' }}
        </span>
        <span class="refresh-label" role="status">{{ buttonLabel }}</span>
        <span
          v-if="busy || succeeded"
          class="refresh-track"
          role="progressbar"
          :aria-label="label('Update stage progress', '更新阶段进度')"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-valuenow="indeterminate ? undefined : Math.round(value * 100)"
          :aria-valuetext="phase"
        >
          <span
            :key="display?.scanId"
            class="refresh-fill"
            :class="{
              'refresh-fill--unknown': indeterminate && !value,
              'refresh-fill--waiting': indeterminate && value > 0,
            }"
            :style="{ width: `${value * 100}%` }"
          />
        </span>
      </button>
      <button
        ref="trigger"
        class="refresh-details-toggle"
        type="button"
        :aria-label="label('Update details', '更新详情')"
        aria-haspopup="dialog"
        :aria-expanded="open"
        :aria-controls="open ? panelId : undefined"
        @mouseenter="hideFull"
        @focus="hideFull"
        @click="toggle"
      >
        <DropdownChevron :open="open" />
      </button>
    </div>
    <Transition name="refresh-popover">
      <div
        v-if="fullOpen && !busy && !open"
        :id="fullId"
        class="refresh-full-popover refresh-bubble"
        @mouseenter="showFull"
        @focusin="showFull"
      >
        <button
          type="button"
          class="refresh-full-action"
          :title="
            label(
              'Re-read all local history. This may take longer.',
              '重新读取全部本地历史，耗时可能较长',
            )
          "
          @click="refresh('full')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
          {{ label('Full refresh', '全量刷新') }}
        </button>
      </div>
    </Transition>
    <Transition name="refresh-popover">
      <div v-if="open" class="refresh-details-anchor refresh-bubble">
        <section
          :id="panelId"
          ref="panel"
          class="refresh-details"
          role="dialog"
          tabindex="-1"
          :aria-label="label('Update details', '更新详情')"
        >
          <header>
            <strong>{{ label('Data update', '数据更新') }}</strong>
            <span class="refresh-detail-status">
              <i />
              {{
                busy
                  ? label('In progress', '进行中')
                  : error
                    ? label('Needs attention', '需处理')
                    : label('Ready', '就绪')
              }}
            </span>
          </header>
          <p class="refresh-phase" role="status">
            <template v-if="busy && (progress?.mode ?? requestedMode) === 'full'">
              {{ label('Full refresh', '全量刷新') }} ·
            </template>
            {{ phase }}
            <template v-if="busy && progress?.agent">· {{ getAgentName(progress.agent) }}</template>
          </p>
          <p v-if="progress?.totalAgents" class="refresh-count">
            {{ label('Processed', '已处理') }} {{ progress.completedAgents }} /
            {{ progress.totalAgents }} Agent
          </p>
          <ol v-if="busy || progress" class="refresh-steps">
            <li
              v-for="step in steps"
              :key="step.name"
              :class="{ 'is-done': step.done, 'is-active': step.active }"
            >
              <span class="refresh-step-icon" aria-hidden="true">
                <span v-if="step.done" class="material-symbols-outlined">check</span>
              </span>
              <span>{{ step.name }}</span>
            </li>
          </ol>
          <p v-if="busy && progress?.work" class="refresh-count">{{ workLabel(progress.work) }}</p>
          <ul v-if="busy && progress?.activeAgents?.length" class="refresh-agents">
            <li v-for="agent in progress.activeAgents" :key="agent.agent">
              <strong>{{ getAgentName(agent.agent) }}</strong>
              <span>
                {{
                  agent.phase === 'reading'
                    ? label('Reading', '读取中')
                    : label('Summarizing', '整理中')
                }}
              </span>
              <small v-if="agent.work">{{ workLabel(agent.work) }}</small>
            </li>
          </ul>
          <p v-if="progress?.preview?.retainedAgents.length" class="refresh-retained">
            {{
              label(
                'Keeping saved history for unavailable sources:',
                '以下来源暂不可用，保留已有历史：',
              )
            }}
            {{ progress.preview.retainedAgents.map(getAgentName).join('、') }}
          </p>
          <div v-if="error && !busy" class="refresh-error">
            <p>{{ error }}</p>
            <button class="workspace-link" type="button" @click="refresh(progress?.mode)">
              {{ label('Retry update', '重试更新') }}
            </button>
          </div>
          <ScanRefreshSettings
            :state="autoRefresh.state.value"
            :disabled="!autoRefresh.ready.value || autoRefresh.saving.value"
            :failed="autoRefresh.error.value"
            @configure="autoRefresh.configure"
          />
          <footer>
            <template v-if="busy">
              {{ label('You can keep using your existing data.', '当前仍可查看和操作已有数据。') }}
            </template>
            <small>
              {{ label('Updates local Token usage only.', '仅更新本地 Token 用量数据。') }}
            </small>
          </footer>
        </section>
      </div>
    </Transition>
  </div>
</template>

<style scoped src="../../styles/refresh-control.css"></style>
