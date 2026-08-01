<script setup lang="ts">
/* eslint-disable max-lines */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import FloatingSessionCard from '../components/floating/FloatingSessionCard.vue'
import FloatingTokenTrend from '../components/floating/FloatingTokenTrend.vue'
import MessageBanner from '../components/message/MessageBanner.vue'
import BrandMark from '../components/base/BrandMark.vue'
import {
  floatingLatestCountOptions,
  useFloatingSessions,
  type FloatingSessionItem,
} from '../composables/useFloatingSessions'
import {
  useFloatingTokenTrend,
  type FloatingRefreshInterval,
  type FloatingTrendRange,
} from '../composables/useFloatingTokenTrend'
import { useTheme } from '../composables/useTheme'
import { useI18n } from '../i18n/useI18n'
import { formatTokens } from '../utils/format'

type DropPosition = 'before' | 'after'

const { currentLang, label } = useI18n()
useTheme()

const {
  latestCount,
  pinnedSessions,
  latestSessions,
  tokenDeltas,
  isRefreshing: sessionsRefreshing,
  loadFailed: sessionsLoadFailed,
  hasSessions,
  togglePin,
  movePinned,
  persistPinnedOrder,
  refresh: refreshSessions,
} = useFloatingSessions()

const {
  range,
  groupBy,
  refreshInterval,
  sessionsExpanded,
  stats,
  isLoading: trendLoading,
  loadFailed: trendLoadFailed,
  lastUpdatedAt,
  refresh: refreshTrend,
} = useFloatingTokenTrend()

const rangeOptions: FloatingTrendRange[] = ['1h', '5h', '24h', '7d']
const refreshOptions: FloatingRefreshInterval[] = [0, 30_000, 60_000, 300_000, 900_000]
const latestCountOptions = floatingLatestCountOptions
const now = ref(Date.now())
const isAlwaysOnTop = ref(true)
const isAlwaysOnTopReady = ref(false)
const isChangingAlwaysOnTop = ref(false)
const draggingKey = ref('')
const dropTargetKey = ref('')
const dropPosition = ref<DropPosition | null>(null)
let clockTimer: ReturnType<typeof setInterval> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let disposed = false

const isRefreshing = computed(() => sessionsRefreshing.value || trendLoading.value)
const cacheTokens = computed(() => stats.value.cacheReadTokens + stats.value.cacheWriteTokens)
const sessionSummary = computed(() => {
  const pinned = pinnedSessions.value.length
  const latest = latestSessions.value.length
  return label(`${pinned} pinned · ${latest} recent`, `${pinned} 个置顶 · ${latest} 个最近会话`)
})

const trendTitle = computed(() => {
  const rangeLabels: Record<FloatingTrendRange, [string, string]> = {
    '1h': ['Last hour', '最近 1 小时'],
    '5h': ['Last 5 hours', '最近 5 小时'],
    '24h': ['Last 24 hours', '最近 24 小时'],
    '7d': ['Last 7 days', '最近 7 天'],
  }
  const copy = rangeLabels[range.value]
  return label(copy[0], copy[1])
})

const refreshStatus = computed(() => {
  if (isRefreshing.value) return label('Refreshing local usage...', '正在刷新本地用量...')
  if (refreshInterval.value === 0) return label('Auto refresh is off', '自动刷新已关闭')
  return label(
    `Refreshes every ${refreshIntervalLabel(refreshInterval.value, 'en')}`,
    `每${refreshIntervalLabel(refreshInterval.value, 'zh')}刷新`,
  )
})

const updatedLabel = computed(() => {
  if (!lastUpdatedAt.value) return label('Waiting for data', '等待数据')
  const elapsedSeconds = Math.max(0, Math.floor((now.value - lastUpdatedAt.value) / 1000))
  if (elapsedSeconds < 10) return label('Updated just now', '刚刚更新')
  if (elapsedSeconds < 60)
    return label(`Updated ${elapsedSeconds}s ago`, `${elapsedSeconds} 秒前更新`)
  const minutes = Math.floor(elapsedSeconds / 60)
  return label(`Updated ${minutes}m ago`, `${minutes} 分钟前更新`)
})

function rangeLabel(value: FloatingTrendRange): string {
  if (value === '1h') return label('1H', '1小时')
  if (value === '5h') return label('5H', '5小时')
  if (value === '24h') return label('24H', '24小时')
  return label('7D', '7天')
}

function refreshIntervalLabel(value: FloatingRefreshInterval, lang = currentLang.value): string {
  if (value === 0) return lang === 'zh' ? '关闭' : 'Off'
  if (value === 30_000) return lang === 'zh' ? '30 秒' : '30s'
  if (value === 60_000) return lang === 'zh' ? '1 分钟' : '1m'
  if (value === 300_000) return lang === 'zh' ? '5 分钟' : '5m'
  return lang === 'zh' ? '15 分钟' : '15m'
}

let refreshSelectionStartedByPointer = false

function startRefreshIntervalPointerSelection(): void {
  refreshSelectionStartedByPointer = true
}

function resetRefreshIntervalPointerSelection(): void {
  refreshSelectionStartedByPointer = false
}

function finishRefreshIntervalSelection(event: Event): void {
  if (!refreshSelectionStartedByPointer) return
  refreshSelectionStartedByPointer = false
  const select = event.currentTarget
  if (!(select instanceof HTMLSelectElement)) return
  requestAnimationFrame(() => {
    if (document.activeElement === select) select.blur()
  })
}

async function refreshAll(runScan = true): Promise<void> {
  if (isRefreshing.value) return
  await refreshSessions(runScan)
  await refreshTrend()
}

function scheduleAutoRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
  if (disposed || refreshInterval.value === 0) return
  refreshTimer = setTimeout(async () => {
    await refreshAll(true)
    scheduleAutoRefresh()
  }, refreshInterval.value)
}

watch(refreshInterval, scheduleAutoRefresh)
watch([range, groupBy], () => void refreshTrend())

onMounted(() => {
  disposed = false
  document.documentElement.classList.add('floating-window-root')
  document.body.classList.add('floating-window-body')
  void loadAlwaysOnTopSetting()
  void refreshAll(true).finally(scheduleAutoRefresh)
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 10_000)
})

onUnmounted(() => {
  disposed = true
  document.documentElement.classList.remove('floating-window-root')
  document.body.classList.remove('floating-window-body')
  if (refreshTimer) clearTimeout(refreshTimer)
  if (clockTimer) clearInterval(clockTimer)
})

function startPinnedDrag(key: string): void {
  draggingKey.value = key
  dropTargetKey.value = ''
  dropPosition.value = null
}

function overPinnedCard(targetKey: string | null, position: DropPosition | null): void {
  if (!draggingKey.value) return
  if (!targetKey || !position || draggingKey.value === targetKey) {
    dropTargetKey.value = ''
    dropPosition.value = null
    return
  }
  dropTargetKey.value = targetKey
  dropPosition.value = position
  movePinned(draggingKey.value, targetKey, position)
}

function finishPinnedDrag(): void {
  const hadActiveDrag = Boolean(draggingKey.value)
  draggingKey.value = ''
  dropTargetKey.value = ''
  dropPosition.value = null
  if (hadActiveDrag) persistPinnedOrder()
}

async function loadAlwaysOnTopSetting(): Promise<void> {
  try {
    isAlwaysOnTop.value = await window.api.isFloatingWindowAlwaysOnTop()
  } catch (error) {
    console.error('[floating-window] 读取置顶状态失败:', error)
  } finally {
    isAlwaysOnTopReady.value = true
  }
}

async function toggleAlwaysOnTop(): Promise<void> {
  if (!isAlwaysOnTopReady.value || isChangingAlwaysOnTop.value) return
  isChangingAlwaysOnTop.value = true
  try {
    isAlwaysOnTop.value = await window.api.setFloatingWindowAlwaysOnTop(!isAlwaysOnTop.value)
  } catch (error) {
    console.error('[floating-window] 切换置顶状态失败:', error)
  } finally {
    isChangingAlwaysOnTop.value = false
  }
}

function pinSession(session: FloatingSessionItem): void {
  togglePin(session)
}

async function closeWindow(): Promise<void> {
  try {
    await window.api.closeFloatingWindow()
  } catch {
    // IPC 响应前窗口可能已经销毁，无需向用户报错。
  }
}
</script>

<template>
  <div class="floating-window">
    <div class="window-drag-handle" aria-hidden="true"><span></span></div>
    <header class="window-bar">
      <div class="window-drag-title">
        <span class="live-mark" :class="{ paused: refreshInterval === 0 }">
          <BrandMark />
          <i></i>
        </span>
        <div>
          <strong>{{ label('Token Monitor', 'Token 监测') }}</strong>
          <small>{{ refreshStatus }}</small>
        </div>
      </div>
      <MessageBanner class="window-message" placement="floating" compact />

      <div class="window-controls">
        <button
          class="topmost-button"
          :class="{ 'is-active': isAlwaysOnTop }"
          type="button"
          :disabled="!isAlwaysOnTopReady || isChangingAlwaysOnTop"
          :aria-pressed="isAlwaysOnTop"
          :aria-label="
            isAlwaysOnTop
              ? label('Turn off always on top', '取消小窗置顶')
              : label('Keep window always on top', '将小窗置顶')
          "
          :title="
            isAlwaysOnTop
              ? label('Always on top is on · Click to turn it off', '小窗已置顶 · 点击取消置顶')
              : label('Always on top is off · Click to turn it on', '小窗未置顶 · 点击保持在最前面')
          "
          @click="toggleAlwaysOnTop"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M8 2.8h8v1.7l-1 1V10l2.1 2.1V14H13v7l-1 2-1-2v-7H6.9v-1.9L9 10V5.5l-1-1V2.8Z"
            />
            <path v-if="!isAlwaysOnTop" class="topmost-slash" d="m5 5 14 14" />
          </svg>
          <span class="topmost-state" aria-hidden="true"></span>
        </button>
        <label class="refresh-control" :title="label('Auto refresh interval', '自动刷新间隔')">
          <svg class="refresh-control__clock" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 2h6v2H9V2Zm3 3a8.5 8.5 0 1 1-8.5 8.5A8.5 8.5 0 0 1 12 5Zm0 2a6.5 6.5 0 1 0 6.5 6.5A6.5 6.5 0 0 0 12 7Zm-1 2h2v3.9l3 1.8-1 1.7-4-2.4V9Z"
            />
          </svg>
          <span class="refresh-control__value">{{ refreshIntervalLabel(refreshInterval) }}</span>
          <svg class="refresh-control__chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m7.4 9.4 4.6 4.6 4.6-4.6L18 10.8l-6 6-6-6 1.4-1.4Z" />
          </svg>
          <select
            v-model.number="refreshInterval"
            :aria-label="label('Auto refresh interval', '自动刷新间隔')"
            @pointerdown="startRefreshIntervalPointerSelection"
            @keydown="resetRefreshIntervalPointerSelection"
            @change="finishRefreshIntervalSelection"
            @blur="resetRefreshIntervalPointerSelection"
          >
            <option v-for="interval in refreshOptions" :key="interval" :value="interval">
              {{ refreshIntervalLabel(interval) }}
            </option>
          </select>
        </label>
        <button
          class="window-button"
          :class="{ spinning: isRefreshing }"
          type="button"
          :disabled="isRefreshing"
          :aria-label="label('Scan and refresh now', '立即扫描并刷新')"
          :title="label('Scan and refresh now', '立即扫描并刷新')"
          @click="refreshAll(true)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18.6 6.4A8 8 0 1 0 20 14h-2.1A6 6 0 1 1 16.7 7.7L14 10.4h7V3.5l-2.4 2.9Z" />
          </svg>
        </button>
        <span class="window-control-separator" aria-hidden="true"></span>
        <button
          class="window-button window-button--close"
          type="button"
          :aria-label="label('Close floating window', '关闭悬浮窗')"
          :title="label('Close floating window', '关闭悬浮窗')"
          @click="closeWindow"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="m6.7 5.3 5.3 5.3 5.3-5.3 1.4 1.4-5.3 5.3 5.3 5.3-1.4 1.4-5.3-5.3-5.3 5.3-1.4-1.4 5.3-5.3-5.3-5.3 1.4-1.4Z"
            />
          </svg>
        </button>
      </div>
    </header>

    <main class="floating-content">
      <section class="trend-card">
        <div class="trend-heading">
          <div>
            <span class="eyebrow">{{ label('TOKEN USAGE', 'TOKEN 用量') }}</span>
            <h1>{{ trendTitle }}</h1>
            <small>{{ updatedLabel }}</small>
          </div>
          <div class="range-tabs" role="group" :aria-label="label('Time range', '时间范围')">
            <button
              v-for="value in rangeOptions"
              :key="value"
              type="button"
              :class="{ active: range === value }"
              @click="range = value"
            >
              {{ rangeLabel(value) }}
            </button>
          </div>
        </div>

        <div class="metric-grid">
          <div class="metric metric--primary">
            <span>{{ label('Total', '总量') }}</span>
            <strong>{{ formatTokens(stats.totalTokens) }}</strong>
          </div>
          <div class="metric">
            <span>{{ label('Input', '输入') }}</span>
            <strong>{{ formatTokens(stats.inputTokens) }}</strong>
          </div>
          <div class="metric">
            <span>{{ label('Output', '输出') }}</span>
            <strong>{{ formatTokens(stats.outputTokens) }}</strong>
          </div>
          <div class="metric">
            <span>{{ label('Cache', '缓存') }}</span>
            <strong>{{ formatTokens(cacheTokens) }}</strong>
          </div>
        </div>

        <div class="trend-toolbar">
          <div class="dimension-tabs" role="group" :aria-label="label('Break down by', '统计维度')">
            <button
              type="button"
              :class="{ active: groupBy === 'agent' }"
              @click="groupBy = 'agent'"
            >
              {{ label('Agent', '智能体') }}
            </button>
            <button
              type="button"
              :class="{ active: groupBy === 'model' }"
              @click="groupBy = 'model'"
            >
              {{ label('Model', '模型') }}
            </button>
          </div>
          <span>{{ label('Wheel to zoom · drag to pan', '滚轮缩放 · 拖动平移') }}</span>
        </div>

        <div v-if="trendLoadFailed" class="load-banner">
          <span>{{ label('Unable to load Token trend', 'Token 趋势加载失败') }}</span>
          <button type="button" @click="refreshTrend">{{ label('Retry', '重试') }}</button>
        </div>
        <FloatingTokenTrend :stats="stats" :group-by="groupBy" :loading="trendLoading" />
      </section>

      <section class="sessions-panel" :class="{ expanded: sessionsExpanded }">
        <button
          class="sessions-toggle"
          type="button"
          :aria-expanded="sessionsExpanded"
          @click="sessionsExpanded = !sessionsExpanded"
        >
          <span class="sessions-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 4v2h10V8H7Zm0 4v2h7v-2H7Z"
              />
            </svg>
          </span>
          <span class="sessions-copy">
            <strong>{{ label('User sessions', '用户会话') }}</strong>
            <small>{{ sessionSummary }}</small>
          </span>
          <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m7.4 9.4 4.6 4.6 4.6-4.6L18 10.8l-6 6-6-6 1.4-1.4Z" />
          </svg>
        </button>

        <div v-if="sessionsExpanded" class="sessions-content">
          <div class="session-options">
            <span>{{ label('Pinned sessions stay at the top', '置顶会话始终显示在顶部') }}</span>
            <div
              class="count-tabs"
              role="group"
              :aria-label="label('Number of latest sessions', '最新会话显示数量')"
            >
              <button
                v-for="count in latestCountOptions"
                :key="count"
                type="button"
                :class="{ active: latestCount === count }"
                @click="latestCount = count"
              >
                {{ count }}
              </button>
            </div>
          </div>
          <div v-if="sessionsLoadFailed" class="load-banner">
            <span>{{ label('Unable to refresh sessions', '会话刷新失败') }}</span>
            <button type="button" @click="refreshSessions(false)">
              {{ label('Retry', '重试') }}
            </button>
          </div>

          <section v-if="pinnedSessions.length > 0" class="session-section">
            <div class="section-title">
              <span>{{ label('Pinned', '已置顶') }}</span>
              <small>{{ label('Drag a card to reorder', '拖动卡片调整顺序') }}</small>
            </div>
            <TransitionGroup name="session-reorder" tag="div" class="session-stack">
              <FloatingSessionCard
                v-for="session in pinnedSessions"
                :key="session.key"
                :session="session"
                :pinned="true"
                :dragging="draggingKey === session.key"
                :drop-position="
                  dropTargetKey === session.key && draggingKey !== session.key ? dropPosition : null
                "
                :delta="tokenDeltas.get(session.key)"
                :now="now"
                @toggle-pin="pinSession"
                @drag-start="startPinnedDrag"
                @drag-over="overPinnedCard"
                @drag-end="finishPinnedDrag"
              />
            </TransitionGroup>
          </section>

          <section v-if="latestCount > 0 && latestSessions.length > 0" class="session-section">
            <div class="section-title">
              <span>{{ label('Latest sessions', '最新会话') }}</span>
              <small>{{ label('Most recently active first', '最近活跃优先') }}</small>
            </div>
            <div class="session-stack">
              <FloatingSessionCard
                v-for="session in latestSessions"
                :key="session.key"
                :session="session"
                :pinned="false"
                :delta="tokenDeltas.get(session.key)"
                :now="now"
                @toggle-pin="pinSession"
              />
            </div>
          </section>

          <div v-if="!sessionsRefreshing && !hasSessions" class="empty-state">
            <strong>{{ label('No user sessions yet', '暂无用户级会话') }}</strong>
            <span>
              {{
                label('Sessions appear after scanning local Agents', '扫描本地 Agent 后会自动显示')
              }}
            </span>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style>
html.floating-window-root,
body.floating-window-body {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: transparent;
}
body.floating-window-body #app {
  min-height: 0;
  height: 100vh;
}
</style>

<style scoped>
.floating-window {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text);
  background: var(--surface);
  border: 0;
  border-radius: 18px;
  box-shadow:
    0 2px 8px rgba(15, 23, 42, 0.3),
    0 0 0 1px color-mix(in srgb, var(--border-strong) 70%, transparent);
  user-select: none;
}
.window-drag-handle {
  flex: 0 0 26px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--surface-container) 94%, transparent);
  cursor: grab;
  -webkit-app-region: drag;
}
.window-drag-handle:active {
  cursor: grabbing;
}
.window-drag-handle span {
  width: 46px;
  height: 4px;
  background: color-mix(in srgb, var(--text-muted) 42%, transparent);
  border-radius: 999px;
  pointer-events: none;
}
.window-bar {
  flex: 0 0 auto;
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 8px 8px 12px;
  background: color-mix(in srgb, var(--surface-container) 94%, transparent);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
}
.window-drag-title {
  min-width: 0;
  flex: 0 1 122px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.window-message {
  flex: 1 1 260px;
  min-width: 90px;
  max-width: 520px;
  -webkit-app-region: no-drag;
}

.window-drag-title > div {
  min-width: 0;
}
.window-drag-title strong,
.window-drag-title small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.window-drag-title strong {
  font-size: 12px;
  line-height: 17px;
  font-weight: var(--weight-semibold);
}
.window-drag-title small {
  margin-top: 1px;
  color: var(--text-muted);
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
}
.live-mark {
  position: relative;
  flex: 0 0 27px;
  width: 27px;
  height: 27px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--tertiary) 15%, transparent);
  border-radius: 9px;
}
.live-mark i {
  position: absolute;
  right: 1px;
  bottom: 1px;
  width: 6px;
  height: 6px;
  background: var(--tertiary);
  border: 1px solid var(--surface-container);
  border-radius: 50%;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--tertiary) 12%, transparent);
}
.live-mark :deep(.brand-mark-image) {
  width: 23px;
  height: 23px;
}
.live-mark.paused {
  background: color-mix(in srgb, var(--text-soft) 12%, transparent);
}
.live-mark.paused i {
  background: var(--text-soft);
  box-shadow: none;
}
.window-controls {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: color-mix(in srgb, var(--surface-low) 88%, transparent);
  border: 1px solid var(--border);
  border-radius: 11px;
  box-shadow: 0 1px 2px rgba(2, 6, 23, 0.05);
  -webkit-app-region: no-drag;
}

.topmost-button {
  position: relative;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}
.topmost-button:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface-container-high);
}
.topmost-button.is-active {
  color: var(--primary);
  background: var(--primary-soft);
}
.topmost-button:disabled {
  cursor: default;
  opacity: 0.55;
}
.topmost-button svg {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  fill: currentColor;
}
.topmost-button .topmost-slash {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 2.2;
}
.topmost-state {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 4px;
  height: 4px;
  background: currentColor;
  border: 1px solid var(--surface-low);
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.topmost-button.is-active .topmost-state {
  opacity: 1;
}
.refresh-control {
  position: relative;
  width: 68px;
  height: 28px;
  flex: 0 0 68px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 5px;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}
.refresh-control:hover {
  color: var(--text);
  background: var(--surface-container-high);
}
.refresh-control:focus-within {
  outline: 2px solid color-mix(in srgb, var(--primary) 65%, transparent);
  outline-offset: 1px;
}
.refresh-control__clock {
  width: 13px;
  height: 13px;
  flex: 0 0 13px;
  fill: currentColor;
}
.refresh-control__value {
  overflow: hidden;
  font-size: var(--type-caption);
  line-height: 1;
  font-weight: var(--weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.refresh-control__chevron {
  width: 10px;
  height: 10px;
  flex: 0 0 10px;
  fill: currentColor;
  opacity: 0.7;
}
.refresh-control select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  opacity: 0;
  cursor: pointer;
  outline: 0;
}
.window-button {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
.window-button:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface-bright);
}
.window-button--close:hover:not(:disabled) {
  color: #fff;
  background: #c42b1c;
}
.window-button:disabled {
  opacity: 0.55;
}
.window-button svg {
  width: 15px;
  height: 15px;
  fill: currentColor;
}
.window-control-separator {
  width: 1px;
  height: 16px;
  flex: 0 0 1px;
  margin: 0 1px;
  background: var(--border);
}
.window-button.spinning svg {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.floating-content {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 9px;
  background: var(--bg-base);
  -webkit-app-region: no-drag;
}
.floating-content::-webkit-scrollbar {
  width: 6px;
}
.floating-content::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 99px;
}
.trend-card,
.sessions-panel {
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
}
.trend-card {
  padding: 12px;
}
.trend-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.trend-heading > div:first-child {
  min-width: 0;
}
.eyebrow {
  display: block;
  color: var(--primary);
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.09em;
}
.trend-heading h1 {
  margin: 2px 0 0;
  color: var(--text);
  font-size: 17px;
  line-height: 22px;
  font-weight: var(--weight-semibold);
}
.trend-heading small {
  display: block;
  margin-top: 1px;
  color: var(--text-muted);
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
}
.range-tabs,
.dimension-tabs,
.count-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.range-tabs button,
.dimension-tabs button,
.count-tabs button {
  min-width: 33px;
  height: 26px;
  padding: 0 6px;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: 6px;
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
  cursor: pointer;
}
.range-tabs button.active,
.dimension-tabs button.active,
.count-tabs button.active {
  color: var(--primary-on);
  background: var(--primary);
  box-shadow: 0 1px 5px color-mix(in srgb, var(--primary) 22%, transparent);
}
.metric-grid {
  display: grid;
  grid-template-columns: 1.25fr repeat(3, 1fr);
  gap: 6px;
  margin: 11px 0 9px;
}
.metric {
  min-width: 0;
  padding: 7px 8px;
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 9px;
}
.metric--primary {
  background: color-mix(in srgb, var(--primary) 9%, var(--surface-container));
  border-color: color-mix(in srgb, var(--primary) 28%, var(--border));
}
.metric span,
.metric strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.metric span {
  color: var(--text-muted);
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
}
.metric strong {
  margin-top: 2px;
  color: var(--text);
  font-size: 12px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}
.metric--primary strong {
  color: var(--primary);
}
.trend-toolbar {
  min-height: 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.dimension-tabs button {
  min-width: 52px;
}
.trend-toolbar > span {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.load-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 6px 0;
  padding: 7px 9px;
  color: var(--error);
  background: color-mix(in srgb, var(--error) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--error) 28%, transparent);
  border-radius: 8px;
  font-size: var(--type-caption);
}
.load-banner button {
  padding: 2px 7px;
  color: var(--error);
  background: transparent;
  border: 1px solid currentColor;
  border-radius: 5px;
  font: inherit;
  cursor: pointer;
}
.sessions-panel {
  margin-top: 9px;
  overflow: hidden;
}
.sessions-toggle {
  width: 100%;
  min-height: 56px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  color: var(--text);
  background: transparent;
  border: 0;
  text-align: left;
  cursor: pointer;
}
.sessions-toggle:hover {
  background: var(--surface-container);
}
.sessions-icon {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  border-radius: 9px;
}
.sessions-icon svg,
.chevron {
  width: 17px;
  height: 17px;
  fill: currentColor;
}
.sessions-copy {
  min-width: 0;
  flex: 1;
}
.sessions-copy strong,
.sessions-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sessions-copy strong {
  font-size: var(--type-caption);
  line-height: 16px;
}
.sessions-copy small {
  margin-top: 1px;
  color: var(--text-muted);
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
}
.chevron {
  flex: 0 0 auto;
  color: var(--text-muted);
  transition: transform 0.18s ease;
}
.sessions-panel.expanded .chevron {
  transform: rotate(180deg);
}
.sessions-content {
  padding: 0 10px 11px;
  border-top: 1px solid var(--border);
}
.session-options {
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 6px 0;
}
.session-options > span {
  color: var(--text-muted);
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
}
.count-tabs {
  margin-left: auto;
}
.count-tabs button {
  min-width: 31px;
}
.session-section + .session-section {
  margin-top: 13px;
}
.section-title {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  margin: 0 2px 6px;
}
.section-title span {
  color: var(--text-muted);
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
  font-weight: var(--weight-semibold);
}
.section-title small {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-stack {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
:deep(.session-reorder-move) {
  transition: transform 0.18s cubic-bezier(0.2, 0, 0, 1) !important;
}
.empty-state {
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: var(--text-muted);
  text-align: center;
}
.empty-state strong {
  color: var(--text-muted);
  font-size: 12px;
}
.empty-state span {
  margin-top: 4px;
  font-size: var(--type-caption);
}
@media (max-width: 560px) {
  .window-bar:has(.window-message) .window-drag-title {
    flex: 0 0 28px;
  }
  .window-bar:has(.window-message) .window-drag-title > div,
  .window-message :deep(.message-pager),
  .window-message :deep(.message-detail) {
    display: none;
  }
}

@media (max-width: 430px) {
  .window-bar {
    gap: 6px;
    padding-inline: 8px;
  }
  .window-drag-title {
    flex: 0 0 28px;
  }
  .window-drag-title > div {
    display: none;
  }
  .window-bar:not(:has(.window-message)) .window-drag-title {
    flex: 0 1 122px;
  }
  .window-bar:not(:has(.window-message)) .window-drag-title > div {
    display: block;
  }
  .window-message {
    min-width: 0;
    flex: 1 1 auto;
  }
  .window-controls {
    flex: 0 0 auto;
  }
  .window-message :deep(.message-pager),
  .window-message :deep(.message-detail) {
    display: none;
  }
  .range-tabs {
    flex: 0 0 auto;
  }
  .metric-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .trend-toolbar > span {
    display: none;
  }
}
</style>
