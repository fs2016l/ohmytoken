<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import DesignIcon from '../base/DesignIcon.vue'
import SelectControl from '../base/SelectControl.vue'
import DropdownChevron from '../base/DropdownChevron.vue'
import NetworkRefreshButton from '../network/NetworkRefreshButton.vue'
import FloatingSessionCard from './FloatingSessionCard.vue'
import FloatingTokenTrend from './FloatingTokenTrend.vue'
import FloatingTokenSummary from './FloatingTokenSummary.vue'
import FloatingTokenRange from './FloatingTokenRange.vue'
import {
  floatingLatestCountOptions,
  useFloatingSessions,
} from '../../composables/useFloatingSessions'
import {
  useFloatingTokenTrend,
  type FloatingTrendRange,
} from '../../composables/useFloatingTokenTrend'
import { useVisibleNow } from '../../composables/useVisibleNow'
import { useScanRefresh } from '../../composables/useScanRefresh'
import { useScanStatus } from '../../composables/useScanStatus'
import { SCAN_REFRESH_INTERVALS, isScanRefreshInterval } from '@shared/scan-refresh'
import { useFloatingScroll } from '../../composables/useFloatingScroll'
import { useFloatingSessionMotion } from '../../composables/useFloatingSessionMotion'
import { useI18n } from '../../i18n/useI18n'
import type { FloatingWorkspace } from '@shared/floating-window'

defineProps<{ compact?: boolean }>()
defineEmits<{ open: [destination: FloatingWorkspace]; expand: [] }>()
const { label } = useI18n()
const now = useVisibleNow()
const scanStatus = useScanStatus()
const autoRefresh = useScanRefresh()
const refreshInterval = computed({
  get: () => (autoRefresh.state.value.enabled ? autoRefresh.state.value.interval : 0),
  set: (value: number) => {
    if (value !== 0 && !isScanRefreshInterval(value)) return
    void autoRefresh.configure({
      enabled: value !== 0,
      interval: value || autoRefresh.state.value.interval,
    })
  },
})
const {
  latestCount,
  pinnedSessions,
  latestSessions,
  tokenDeltas,
  missingPinned,
  unavailableKeys,
  favoriteError,
  isRefreshing: sessionBusy,
  loadFailed: sessionFailed,
  removeMissing,
  movePinned,
  persistPinnedOrder,
  refresh: refreshSessions,
} = useFloatingSessions()
const {
  range,
  baselineAt,
  applyBaseline,
  groupBy,
  sessionsExpanded,
  stats,
  isLoading: trendBusy,
  loadFailed: trendFailed,
  lastUpdatedAt,
  refresh: refreshTrend,
} = useFloatingTokenTrend()
const refreshing = ref(false)
const scanFailed = ref(false)
const dataUpdatedAt = ref(0)
const busy = computed(
  () => refreshing.value || sessionBusy.value || trendBusy.value || scanStatus.busy.value,
)
const failed = computed(
  () => scanFailed.value || !!scanStatus.error.value || sessionFailed.value || trendFailed.value,
)
const dragging = ref('')
const dropTarget = ref<{ key: string; position: 'before' | 'after' } | null>(null)
const { scroll, save } = useFloatingScroll()
useFloatingSessionMotion(scroll, () =>
  JSON.stringify([
    pinnedSessions.value.map((session) => session.key),
    latestSessions.value.map((session) => session.key),
    missingPinned.value.map((session) => session.key),
  ]),
)
let active = false
let initialized = false
let dataRevision = -1
const rangeTitle = computed(() => {
  if (range.value === 'custom' && baselineAt.value !== null) {
    const date = new Date(baselineAt.value)
    const today = new Date(now.value).toDateString() === date.toDateString()
    const pad = (value: number): string => String(value).padStart(2, '0')
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
    const start = today
      ? `${time}:${pad(date.getSeconds())}`
      : `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${time}`
    return label(`Since ${start}`, `${start} 起`)
  }
  const names: Record<FloatingTrendRange, [string, string]> = {
    '1h': ['Last hour', '近 1 小时'],
    '5h': ['Last 5 hours', '近 5 小时'],
    '24h': ['Last 24 hours', '近 24 小时'],
    '7d': ['Last 7 days', '近 7 天'],
    custom: ['Custom baseline', '自定义基线'],
  }
  return label(...names[range.value])
})
const rangeDescription = computed(() => {
  if (range.value !== 'custom' || baselineAt.value === null) return rangeTitle.value
  const date = new Date(baselineAt.value)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const start = `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return label(`From ${start} to now`, `${start} 起 · 至今`)
})
const refreshOptions = [0, ...SCAN_REFRESH_INTERVALS]
function intervalText(value: number): string {
  if (!value) return label('Manual', '手动刷新')
  if (value < 60_000) return label(`Every ${value / 1000}s`, `每 ${value / 1000} 秒`)
  return label(`Every ${value / 60_000}m`, `每 ${value / 60_000} 分钟`)
}
const updated = computed(() => {
  if (!lastUpdatedAt.value) return label('Waiting for data', '等待数据')
  if (!dataUpdatedAt.value) return label('Cached data · awaiting refresh', '缓存数据 · 待刷新')
  const seconds = Math.max(0, Math.floor((now.value - dataUpdatedAt.value) / 1000))
  if (seconds < 60) return label('Updated just now', '刚刚更新')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return label(`Updated ${minutes}m ago`, `${minutes} 分钟前更新`)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return label(`Updated ${hours}h ago`, `${hours} 小时前更新`)
  const days = Math.floor(hours / 24)
  return label(`Updated ${days}d ago`, `${days} 天前更新`)
})
async function refresh(scan = true): Promise<boolean> {
  if (busy.value) return false
  refreshing.value = true
  scanFailed.value = false
  try {
    if (scan) {
      await scanStatus.refresh()
      scanFailed.value = !!scanStatus.error.value
    }
    dataRevision = scanStatus.revision.value
    const scannedAt = Date.parse(scanStatus.updatedAt.value) || 0
    await refreshSessions(false)
    await refreshTrend()
    if (!sessionFailed.value && !trendFailed.value) dataUpdatedAt.value = scannedAt
    return !failed.value
  } finally {
    refreshing.value = false
  }
}
defineExpose({ refresh, busy })
function resume(): void {
  if (active) return
  active = true
  visibility()
}
function pause(): void {
  active = false
}
function visibility(): void {
  if (!active || document.hidden) return
  if (!initialized || dataRevision !== scanStatus.revision.value) {
    // Read saved data on entry and after scans completed while this view was hidden.
    initialized = true
    void refresh(false)
  }
}
function dragOver(key: string | null, position: 'before' | 'after' | null): void {
  dropTarget.value = key && position ? { key, position } : null
  if (dragging.value && key && position) movePinned(dragging.value, key, position)
}
function endDrag(): void {
  if (dragging.value) void persistPinnedOrder()
  dragging.value = ''
  dropTarget.value = null
}
watch([scanStatus.revision, busy], () => {
  if (!busy.value && active && !document.hidden && dataRevision !== scanStatus.revision.value)
    void refresh(false)
})
watch([range, baselineAt, groupBy], () => {
  if (active && !document.hidden) void refreshTrend()
})
watch(latestCount, () => {
  if (active && !document.hidden) void refreshSessions(false)
})
onMounted(() => {
  document.addEventListener('visibilitychange', visibility)
  resume()
})
onActivated(resume)
onDeactivated(pause)
onUnmounted(() => {
  pause()
  document.removeEventListener('visibilitychange', visibility)
})
</script>

<template>
  <section
    class="floating-pane floating-token-pane"
    :aria-label="label('Token monitor', 'Token 监测')"
  >
    <FloatingTokenSummary
      v-show="compact"
      :stats="stats"
      :range-title="rangeTitle"
      :ready="lastUpdatedAt > 0"
      :updated-at="dataUpdatedAt"
      :failed="failed"
      @expand="$emit('expand')"
    />
    <div v-show="!compact" ref="scroll" class="floating-scroll" @scroll="save">
      <FloatingTokenRange
        v-model:range="range"
        :baseline-at="baselineAt"
        :range-title="rangeTitle"
        :range-description="rangeDescription"
        @baseline="applyBaseline"
      />
      <div class="floating-total">
        <AnimatedNumber :value="stats.totalTokens" :format="{ compact: true }" :replay="false" />
        <span>tokens</span>
      </div>
      <FloatingTokenTrend :stats="stats" :group-by="stats.groupBy" :loading="trendBusy">
        <template #actions>
          <button class="floating-link" @click="groupBy = groupBy === 'agent' ? 'model' : 'agent'">
            {{ groupBy === 'agent' ? label('By model', '按模型') : label('By Agent', '按 Agent') }}
            <DesignIcon name="floatingArrow" :size="12" />
          </button>
        </template>
      </FloatingTokenTrend>
      <div class="floating-token-breakdown floating-card">
        <div>
          <span>{{ label('Input', '输入') }}</span>
          <AnimatedNumber :value="stats.inputTokens" :format="{ compact: true }" :replay="false" />
        </div>
        <div>
          <span>{{ label('Output', '输出') }}</span>
          <AnimatedNumber :value="stats.outputTokens" :format="{ compact: true }" :replay="false" />
        </div>
        <div>
          <span>{{ label('Cache', '缓存') }}</span>
          <AnimatedNumber
            :value="stats.cacheReadTokens + stats.cacheWriteTokens"
            :format="{ compact: true }"
            :replay="false"
          />
        </div>
      </div>
      <p v-if="failed" class="floating-error" role="alert">
        {{
          label(
            'Refresh failed. Previous readings are retained; retry below.',
            '刷新失败，已保留上次读数，请在下方重试。',
          )
        }}
      </p>
      <p v-if="favoriteError" class="floating-error" role="alert">{{ favoriteError }}</p>
      <p v-if="autoRefresh.error.value" class="floating-error" role="alert">
        {{ label('Could not save refresh settings. Try again.', '刷新设置保存失败，请重试。') }}
      </p>
      <div class="floating-row floating-session-heading">
        <strong>
          {{ label('Favorites', '收藏夹') }}
          {{ pinnedSessions.length + missingPinned.length }}
        </strong>
        <button class="floating-link" @click="$emit('open', 'sessions')">
          {{ label('All sessions', '全部会话') }}
          <DesignIcon name="floatingArrow" :size="12" />
        </button>
      </div>
      <div class="floating-session-list">
        <FloatingSessionCard
          v-for="session in pinnedSessions"
          :key="session.key"
          :session="session"
          pinned
          :dragging="dragging === session.key"
          :drop-position="dropTarget?.key === session.key ? dropTarget.position : null"
          :delta="tokenDeltas.get(session.key)"
          :now="now"
          :unavailable="unavailableKeys.has(session.key)"
          @drag-start="dragging = $event"
          @drag-over="dragOver"
          @drag-end="endDrag"
        />
        <div v-for="item in missingPinned" :key="item.key" class="floating-missing-session">
          <span>
            {{ label('Session unavailable on this device', '本机暂未读到该会话') }}
            <small>{{ item.rootSessionId }}</small>
          </span>
          <button class="floating-link" @click="removeMissing(item.key)">
            {{ label('Remove favorite', '取消收藏') }}
          </button>
        </div>
        <p
          v-if="!pinnedSessions.length && !missingPinned.length"
          key="empty"
          class="floating-empty"
        >
          {{
            label(
              'Star a recent session or favorite one in the main window to find it here.',
              '点击最近会话的星标，或在主窗口收藏，即可在此快速查看。',
            )
          }}
        </p>
      </div>
      <details
        class="floating-recent"
        :open="sessionsExpanded"
        @toggle="sessionsExpanded = ($event.target as HTMLDetailsElement).open"
      >
        <summary class="disclosure-summary">
          <DropdownChevron disclosure direction="right" />
          <span>{{ label('Recent sessions', '最近会话') }}</span>
          <SelectControl
            v-model="latestCount"
            class="floating-recent-count"
            :label="label('Show recent sessions', '显示数量')"
            :options="floatingLatestCountOptions.map((value) => ({ value, label: String(value) }))"
            compact
            @click.stop
            @keydown.stop
          />
        </summary>
        <FloatingSessionCard
          v-for="session in latestSessions"
          :key="session.key"
          :session="session"
          :pinned="false"
          :delta="tokenDeltas.get(session.key)"
          :now="now"
        />
        <p v-if="!latestSessions.length" class="floating-empty">
          {{ label('No recent sessions', '暂无最近会话') }}
        </p>
      </details>
    </div>
    <footer v-show="!compact" class="floating-footer">
      <span>{{ updated }}</span>
      <div class="floating-row">
        <SelectControl
          v-model="refreshInterval"
          :disabled="!autoRefresh.ready.value || autoRefresh.saving.value"
          :label="label('Refresh interval', '刷新间隔')"
          :options="refreshOptions.map((value) => ({ value, label: intervalText(value) }))"
          compact
          placement="top"
        />
        <NetworkRefreshButton
          floating
          :label="label('Refresh usage', '刷新用量')"
          :running="busy"
          @click="refresh()"
        />
      </div>
    </footer>
  </section>
</template>

<style scoped>
.floating-total {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-top: 8px;
}
.floating-total > .animated-number {
  font-size: 40px;
  font-weight: 600;
  line-height: 52px;
  letter-spacing: -1.2px;
}
.floating-total > span:last-child {
  font-size: 11px;
  color: var(--text-muted);
}
.floating-token-breakdown {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--surface-low);
}
.floating-token-breakdown > div {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
  text-align: center;
}
.floating-token-breakdown span:first-child {
  color: var(--text-muted);
  font-size: 11px;
}
.floating-token-breakdown .animated-number {
  font-size: 14px;
  font-weight: 500;
}
.floating-session-heading {
  border-top: 1px solid var(--border);
  padding-top: 10px;
  margin-top: 8px;
  margin-bottom: 6px;
}
.floating-session-heading strong {
  font-size: 12px;
  font-weight: 500;
}
.floating-session-list {
  display: grid;
  gap: 4px;
}
.floating-missing-session {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 8px;
  border-radius: 8px;
  background: var(--surface-low);
}
.floating-missing-session > span {
  min-width: 0;
}
.floating-missing-session small {
  display: block;
  color: var(--text-muted);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.floating-missing-session button {
  flex: 0 0 auto;
}
.floating-recent {
  margin-top: 8px;
  color: var(--text-muted);
}
.floating-recent summary {
  min-height: var(--control-height-compact);
  margin-bottom: 6px;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  user-select: none;
}
.floating-recent :deep(.floating-recent-count) {
  flex: none;
  min-width: 56px;
  margin-inline-start: auto;
}
.floating-recent :deep(.session-card + .session-card) {
  margin-top: 4px;
}
</style>
