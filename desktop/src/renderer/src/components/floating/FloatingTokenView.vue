<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import TokenShare from '../base/TokenShare.vue'
import DesignIcon from '../base/DesignIcon.vue'
import SelectControl from '../base/SelectControl.vue'
import RollingText from '../base/RollingText.vue'
import DropdownChevron from '../base/DropdownChevron.vue'
import NetworkRefreshButton from '../network/NetworkRefreshButton.vue'
import FloatingSessionCard from './FloatingSessionCard.vue'
import SessionTurnScopeControl from '../agent/SessionTurnScopeControl.vue'
import FloatingTokenTrend from './FloatingTokenTrend.vue'
import FloatingTokenSummary from './FloatingTokenSummary.vue'
import FloatingTokenRange from './FloatingTokenRange.vue'
import {
  floatingLatestCountOptions,
  useFloatingSessions,
} from '../../composables/useFloatingSessions'
import {
  useFloatingTokenTrend,
  type FloatingTrendDisplay,
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
  pinnedTurnScope,
  latestTurnScope,
  pinnedSessions,
  latestSessions,
  tokenDeltas,
  latestTurnTokenDeltas,
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
  displayMode,
  sessionsExpanded,
  stats,
  isLoading: trendBusy,
  loadFailed: trendFailed,
  lastUpdatedAt,
  refresh: refreshTrend,
} = useFloatingTokenTrend()
const breakdown = computed(() => [
  { id: 'input' as const, name: label('Input', '输入'), value: stats.value.inputTokens },
  { id: 'output' as const, name: label('Output', '输出'), value: stats.value.outputTokens },
  {
    id: 'cache' as const,
    name: label('Cache', '缓存'),
    value: stats.value.cacheReadTokens + stats.value.cacheWriteTokens,
  },
  {
    id: 'reasoning' as const,
    name: label('Reasoning', '推理'),
    value: stats.value.reasoningTokens,
  },
])
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
const groupOptions = computed<{ value: FloatingTrendDisplay; label: string }[]>(() => [
  { value: 'total', label: label('Total', '总量') },
  { value: 'model', label: label('By model', '按模型') },
  { value: 'agent', label: label('By Agent', '按 Agent') },
])
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
      v-if="compact"
      :stats="stats"
      :range-title="rangeTitle"
      :ready="lastUpdatedAt > 0"
      :updated-at="dataUpdatedAt"
      :failed="failed"
      @expand="$emit('expand')"
    />
    <div v-show="!compact" ref="scroll" class="floating-scroll" @scroll="save">
      <div class="floating-token-overview">
        <FloatingTokenRange
          v-model:range="range"
          :baseline-at="baselineAt"
          @baseline="applyBaseline"
        />
        <FloatingTokenTrend
          :stats="stats"
          :group-by="stats.groupBy"
          :total-only="displayMode === 'total'"
          :loading="trendBusy"
        >
          <template #heading>
            <RollingText
              :text="label(`${rangeTitle} usage`, `${rangeTitle}用量`)"
              :title="rangeDescription"
            />
          </template>
          <template #actions>
            <SelectControl
              v-model="displayMode"
              class="floating-group-select"
              :options="groupOptions"
              :label="label('Group usage', '用量分组')"
              compact
            />
          </template>
          <template #summary>
            <div class="floating-total">
              <AnimatedNumber
                :value="stats.totalTokens"
                :format="{ compact: true }"
                :replay="false"
              />
              <span>tokens</span>
            </div>
          </template>
        </FloatingTokenTrend>
        <div class="floating-token-breakdown">
          <div v-for="item in breakdown" :key="item.id">
            <span>{{ item.name }}</span>
            <AnimatedNumber :value="item.value" :format="{ compact: true }" :replay="false" />
            <TokenShare :usage="stats" :bucket="item.id" plain />
          </div>
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
        <SessionTurnScopeControl v-model="pinnedTurnScope" compact />
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
          :delta="
            (pinnedTurnScope === 'latest' ? latestTurnTokenDeltas : tokenDeltas).get(session.key)
          "
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
          class="floating-favorites-empty"
        >
          <span class="material-symbols-outlined" aria-hidden="true">star</span>
          <span>{{ label('Star a session to save it here.', '点击会话星标，收藏到这里') }}</span>
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
          <SessionTurnScopeControl v-model="latestTurnScope" compact @click.stop @keydown.stop />
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
          :delta="
            (latestTurnScope === 'latest' ? latestTurnTokenDeltas : tokenDeltas).get(session.key)
          "
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

<style scoped src="./floating-token-view.css"></style>
