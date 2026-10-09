<script setup lang="ts">
import { computed, nextTick, onDeactivated, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import {
  AI_NETWORK_SERVICES,
  type CheckState,
  type NetworkCheckSnapshot,
} from '@shared/network-check'
import DropdownChevron from '../base/DropdownChevron.vue'
import { useNetworkLabels } from '../../composables/useNetworkLabels'

const props = defineProps<{
  snapshot: NetworkCheckSnapshot | null
  busy: boolean
  error: string
  elapsed: number
}>()
const emit = defineEmits<{ start: []; cancel: [] }>()
const { label, formatTime } = useNetworkLabels()
const running = computed(() => props.snapshot?.status === 'running')
const succeeded = ref(false)
let successTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => props.snapshot?.status,
  (status, previous) => {
    clearTimeout(successTimer)
    succeeded.value = status === 'completed' && previous === 'running' && !props.error
    if (succeeded.value)
      successTimer = setTimeout(() => {
        succeeded.value = false
      }, 1500)
  },
)
const state = computed(() =>
  props.busy ? 'running' : props.error ? 'error' : succeeded.value ? 'complete' : 'idle',
)
const indeterminate = computed(() => props.busy && (!running.value || !props.snapshot?.total))
const percent = computed(() =>
  succeeded.value
    ? 100
    : !running.value || !props.snapshot?.total
      ? 0
      : Math.round(Math.min(1, Math.max(0, props.snapshot.completed / props.snapshot.total)) * 100),
)
const buttonLabel = computed(() =>
  props.busy
    ? props.snapshot?.cancelling
      ? label('Stopping', '正在停止')
      : indeterminate.value
        ? label('Preparing', '准备体检')
        : label(`Checking ${percent.value}%`, `体检中 ${percent.value}%`)
    : props.error
      ? label('Retry check', '重试体检')
      : succeeded.value
        ? label('Checked', '体检完成')
        : props.snapshot?.runId
          ? label('Run again', '重新体检')
          : label('Start check', '开始体检'),
)
const statusLabel = computed(() =>
  props.busy
    ? label('In progress', '进行中')
    : props.error
      ? label('Needs attention', '需处理')
      : props.snapshot?.status === 'cancelled'
        ? label('Stopped', '已停止')
        : props.snapshot?.status === 'completed'
          ? label('Completed', '已完成')
          : label('Ready', '就绪'),
)
const targetLabel = computed(() => {
  const target = props.snapshot?.target ?? 'all'
  if (target === 'ip') return label('Exit and IP information', '出口与 IP 信息')
  if (target === 'dns') return label('DNS exit', 'DNS 出口')
  return (
    AI_NETWORK_SERVICES.find((service) => service.id === target)?.name ??
    label('Full network check', '完整网络体检')
  )
})
const groups = computed(() => {
  const snapshot = props.snapshot
  if (!snapshot?.runId) return []
  const target = snapshot.target ?? 'all'
  const definitions: Array<{ name: string; states: CheckState[] }> = []
  if (target === 'all' || target === 'ip')
    definitions.push({
      name: label('Exit and IP information', '出口与 IP 信息'),
      states: [
        ...snapshot.sources.map((source) => source.state),
        snapshot.ipv6.state,
        snapshot.registration.state,
      ],
    })
  if (target === 'all' || target === 'dns')
    definitions.push({
      name: label('DNS exit', 'DNS 出口'),
      states: [snapshot.dns.geolocation.state === 'checking' ? 'checking' : snapshot.dns.state],
    })
  const services = AI_NETWORK_SERVICES.filter(
    (service) => target === 'all' || service.id === target,
  )
  if (services.length) {
    const ids = new Set(
      services.flatMap((service) => service.endpoints.map((endpoint) => endpoint.id)),
    )
    definitions.push({
      name: label('AI service access', 'AI 服务访问'),
      states: snapshot.endpoints
        .filter((endpoint) => ids.has(endpoint.id))
        .map((endpoint) => endpoint.state),
    })
  }
  return definitions.map((group) => {
    const completed = group.states.filter((value) => value === 'done' || value === 'failed').length
    const failed = group.states.filter((value) => value === 'failed').length
    return {
      name: group.name,
      completed,
      total: group.states.length,
      failed,
      done: group.states.length > 0 && completed === group.states.length,
      active: running.value && group.states.includes('checking'),
    }
  })
})
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const panelId = useId()
function close(restoreFocus = false): void {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}
async function toggle(): Promise<void> {
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
onMounted(() => document.addEventListener('pointerdown', outside))
onDeactivated(() => close())
onUnmounted(() => {
  clearTimeout(successTimer)
  document.removeEventListener('pointerdown', outside)
})
</script>

<template>
  <div
    ref="root"
    class="refresh-control network-check-control"
    :data-state="state"
    @focusout="focusOut"
    @keydown.esc.stop.prevent="close(true)"
  >
    <div class="refresh-control-buttons">
      <button
        class="refresh-main"
        type="button"
        :aria-label="buttonLabel"
        :disabled="busy"
        @click="emit('start')"
      >
        <span v-if="!busy" class="material-symbols-outlined refresh-icon" aria-hidden="true">
          {{ error ? 'error_outline' : succeeded ? 'check' : 'refresh' }}
        </span>
        <span class="refresh-label" role="status">{{ buttonLabel }}</span>
        <span
          v-if="busy || succeeded"
          class="refresh-track"
          role="progressbar"
          :aria-label="label('Network check progress', '网络体检进度')"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-valuenow="indeterminate ? undefined : percent"
          :aria-valuetext="`${targetLabel} · ${snapshot?.completed ?? 0} / ${snapshot?.total ?? 0}`"
        >
          <span
            :key="snapshot?.runId"
            class="refresh-fill"
            :class="{ 'refresh-fill--unknown': indeterminate }"
            :style="{ width: `${percent}%` }"
          />
        </span>
      </button>
      <button
        ref="trigger"
        class="refresh-details-toggle"
        type="button"
        :aria-label="label('Check progress', '体检进度')"
        aria-haspopup="dialog"
        :aria-expanded="open"
        :aria-controls="open ? panelId : undefined"
        @click="toggle"
      >
        <DropdownChevron :open="open" />
      </button>
    </div>
    <Transition name="refresh-popover">
      <div v-if="open" class="refresh-details-anchor refresh-bubble">
        <section
          :id="panelId"
          ref="panel"
          class="refresh-details"
          role="dialog"
          tabindex="-1"
          :aria-label="label('Check progress', '体检进度')"
        >
          <header>
            <strong>{{ label('Network check', '网络体检') }}</strong>
            <span class="refresh-detail-status">
              <i />
              {{ statusLabel }}
            </span>
          </header>
          <p class="refresh-phase">{{ targetLabel }}</p>
          <p v-if="snapshot?.runId" class="refresh-count" role="status">
            {{ snapshot.completed }} / {{ snapshot.total }} {{ label('checks', '项') }} ·
            {{ elapsed }} {{ label('seconds', '秒') }}
          </p>
          <ol v-if="groups.length" class="refresh-steps">
            <li
              v-for="group in groups"
              :key="group.name"
              :class="{
                'is-done': group.done,
                'is-active': group.active,
                'has-issues': group.failed > 0,
              }"
            >
              <span class="refresh-step-icon" aria-hidden="true">
                <span v-if="group.done" class="material-symbols-outlined">
                  {{ group.failed ? 'error_outline' : 'check' }}
                </span>
              </span>
              <span>
                {{ group.name }}
                <small v-if="group.failed">
                  {{ label(`${group.failed} unavailable`, `${group.failed} 项暂不可用`) }}
                </small>
              </span>
              <span class="network-step-count">{{ group.completed }} / {{ group.total }}</span>
            </li>
          </ol>
          <div v-if="error && !busy" class="refresh-error">
            <p>{{ error }}</p>
          </div>
          <footer>
            <span>
              {{
                busy
                  ? label('Results appear as each check finishes.', '检测结果逐项返回。')
                  : snapshot?.finishedAt
                    ? `${label('Last checked', '最近体检')} ${formatTime(snapshot.finishedAt)}`
                    : label('Start a check to see its progress.', '开始体检后可在此查看进度。')
              }}
            </span>
            <button
              v-if="running"
              type="button"
              class="workspace-link"
              :disabled="snapshot?.cancelling"
              @click="emit('cancel')"
            >
              {{ label('Stop', '停止体检') }}
            </button>
            <button v-else-if="error" type="button" class="workspace-link" @click="emit('start')">
              {{ label('Retry', '重试') }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </div>
</template>

<style scoped src="../../styles/refresh-control.css"></style>
<style scoped>
.network-check-control .refresh-details {
  max-height: calc(100dvh - 180px);
}
.network-step-count {
  margin-left: auto;
  white-space: nowrap;
  color: var(--text-soft);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.refresh-steps small {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--warning);
}
.has-issues.is-done .refresh-step-icon {
  color: var(--warning);
  border-color: var(--warning);
  background: var(--surface-low);
}
.refresh-details footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.refresh-details footer button {
  flex-shrink: 0;
}
</style>
