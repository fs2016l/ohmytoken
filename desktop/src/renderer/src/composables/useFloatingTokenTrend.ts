import { computed, ref, watch } from 'vue'
import type { UsageTrendStats } from '@shared/models'

export type FloatingTrendRange = '1h' | '5h' | '24h' | '7d'
export type FloatingTrendGroup = 'agent' | 'model'
export type FloatingRefreshInterval = 0 | 30_000 | 60_000 | 300_000 | 900_000

const STORAGE_KEY = 'floating-token-preferences'
const DEFAULT_RANGE: FloatingTrendRange = '24h'
const DEFAULT_GROUP: FloatingTrendGroup = 'agent'
const DEFAULT_REFRESH: FloatingRefreshInterval = 30_000

export const floatingRangeMs: Record<FloatingTrendRange, number> = {
  '1h': 60 * 60 * 1000,
  '5h': 5 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

interface StoredTrendPreferences {
  range: FloatingTrendRange
  groupBy: FloatingTrendGroup
  refreshInterval: FloatingRefreshInterval
  sessionsExpanded: boolean
}

function isRange(value: unknown): value is FloatingTrendRange {
  return value === '1h' || value === '5h' || value === '24h' || value === '7d'
}

function normalizeRange(value: unknown): FloatingTrendRange {
  if (value === '6h') return '5h'
  return isRange(value) ? value : DEFAULT_RANGE
}

function isGroup(value: unknown): value is FloatingTrendGroup {
  return value === 'agent' || value === 'model'
}

function isRefreshInterval(value: unknown): value is FloatingRefreshInterval {
  return (
    value === 0 || value === 30_000 || value === 60_000 || value === 300_000 || value === 900_000
  )
}

function loadPreferences(): StoredTrendPreferences {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '{}',
    ) as Partial<StoredTrendPreferences>
    return {
      range: normalizeRange(parsed.range),
      groupBy: isGroup(parsed.groupBy) ? parsed.groupBy : DEFAULT_GROUP,
      refreshInterval: isRefreshInterval(parsed.refreshInterval)
        ? parsed.refreshInterval
        : DEFAULT_REFRESH,
      sessionsExpanded: parsed.sessionsExpanded === true,
    }
  } catch {
    return {
      range: DEFAULT_RANGE,
      groupBy: DEFAULT_GROUP,
      refreshInterval: DEFAULT_REFRESH,
      sessionsExpanded: false,
    }
  }
}

function emptyStats(groupBy: FloatingTrendGroup): UsageTrendStats {
  const now = Date.now()
  return {
    from: now - floatingRangeMs[DEFAULT_RANGE],
    to: now,
    groupBy,
    bucketMinutes: 1,
    points: [],
    dimensionTotals: {},
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }
}

export function useFloatingTokenTrend() {
  const stored = loadPreferences()
  const range = ref<FloatingTrendRange>(stored.range)
  const groupBy = ref<FloatingTrendGroup>(stored.groupBy)
  const refreshInterval = ref<FloatingRefreshInterval>(stored.refreshInterval)
  const sessionsExpanded = ref(stored.sessionsExpanded)
  const stats = ref<UsageTrendStats>(emptyStats(stored.groupBy))
  const isLoading = ref(false)
  const loadFailed = ref(false)
  const lastUpdatedAt = ref(0)
  let requestSerial = 0

  const selectedRangeMs = computed(() => floatingRangeMs[range.value])
  const hasUsage = computed(() => stats.value.totalTokens > 0)

  function persistPreferences(): void {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        range: range.value,
        groupBy: groupBy.value,
        refreshInterval: refreshInterval.value,
        sessionsExpanded: sessionsExpanded.value,
      }),
    )
  }

  watch([range, groupBy, refreshInterval, sessionsExpanded], persistPreferences)

  async function refresh(): Promise<void> {
    const serial = ++requestSerial
    const to = Date.now()
    const from = to - selectedRangeMs.value
    const previousSpan = stats.value.to - stats.value.from
    const selectionChanged =
      stats.value.groupBy !== groupBy.value ||
      Math.abs(previousSpan - selectedRangeMs.value) > 60_000
    if (selectionChanged) {
      stats.value = { ...emptyStats(groupBy.value), from, to, groupBy: groupBy.value }
    }

    isLoading.value = true
    loadFailed.value = false

    try {
      const result = await window.api.getUsageTrendStats({ from, to, groupBy: groupBy.value })
      if (serial !== requestSerial) return
      stats.value = result
      lastUpdatedAt.value = Date.now()
    } catch (error) {
      if (serial !== requestSerial) return
      loadFailed.value = true
      console.error('[floating-window] 加载 Token 趋势失败:', error)
    } finally {
      if (serial === requestSerial) isLoading.value = false
    }
  }

  return {
    range,
    groupBy,
    refreshInterval,
    sessionsExpanded,
    stats,
    isLoading,
    loadFailed,
    lastUpdatedAt,
    selectedRangeMs,
    hasUsage,
    refresh,
  }
}
