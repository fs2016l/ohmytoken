import { computed, ref, shallowRef, watch } from 'vue'
import type { UsageTrendStats } from '@shared/models'

export type FloatingPresetRange = '1h' | '5h' | '24h' | '7d'
export type FloatingTrendRange = FloatingPresetRange | 'custom'
export type FloatingTrendGroup = 'agent' | 'model'

const STORAGE_KEY = 'floating-token-preferences'
const DEFAULT_RANGE: FloatingPresetRange = '5h'
const DEFAULT_GROUP: FloatingTrendGroup = 'model'

export const floatingRangeMs: Record<FloatingPresetRange, number> = {
  '1h': 60 * 60 * 1000,
  '5h': 5 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

interface StoredTrendPreferences {
  range: FloatingTrendRange
  baselineAt: number | null
  groupBy: FloatingTrendGroup
  sessionsExpanded: boolean
}

function isRange(value: unknown): value is FloatingTrendRange {
  return value === '1h' || value === '5h' || value === '24h' || value === '7d' || value === 'custom'
}

function isBaseline(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Date.now()
}

function normalizeRange(value: unknown): FloatingTrendRange {
  if (value === '6h') return '5h'
  return isRange(value) ? value : DEFAULT_RANGE
}

function isGroup(value: unknown): value is FloatingTrendGroup {
  return value === 'agent' || value === 'model'
}

function loadPreferences(): StoredTrendPreferences {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '{}',
    ) as Partial<StoredTrendPreferences>
    const baselineAt = isBaseline(parsed.baselineAt) ? parsed.baselineAt : null
    const range = normalizeRange(parsed.range)
    return {
      range: range === 'custom' && baselineAt === null ? DEFAULT_RANGE : range,
      baselineAt,
      groupBy: isGroup(parsed.groupBy) ? parsed.groupBy : DEFAULT_GROUP,
      sessionsExpanded: parsed.sessionsExpanded !== false,
    }
  } catch {
    return {
      range: DEFAULT_RANGE,
      baselineAt: null,
      groupBy: DEFAULT_GROUP,
      sessionsExpanded: true,
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
  const baselineAt = ref(stored.baselineAt)
  const groupBy = ref<FloatingTrendGroup>(stored.groupBy)
  const sessionsExpanded = ref(stored.sessionsExpanded)
  const stats = shallowRef<UsageTrendStats>(emptyStats(stored.groupBy))
  const isLoading = ref(false)
  const loadFailed = ref(false)
  const lastUpdatedAt = ref(0)
  let requestSerial = 0

  const selectedRangeMs = computed(() =>
    range.value === 'custom'
      ? Math.max(0, stats.value.to - (baselineAt.value ?? stats.value.to))
      : floatingRangeMs[range.value],
  )
  const hasUsage = computed(() => stats.value.totalTokens > 0)

  function persistPreferences(): void {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        range: range.value,
        baselineAt: baselineAt.value,
        groupBy: groupBy.value,
        sessionsExpanded: sessionsExpanded.value,
      }),
    )
  }

  watch([range, baselineAt, groupBy, sessionsExpanded], persistPreferences)

  function applyBaseline(timestamp: number): void {
    if (!isBaseline(timestamp)) return
    baselineAt.value = Math.floor(timestamp / 1000) * 1000
    range.value = 'custom'
  }

  async function refresh(): Promise<void> {
    const serial = ++requestSerial
    const to = Date.now()
    const baseline = range.value === 'custom' && baselineAt.value !== null
    const from = baseline ? Math.min(baselineAt.value!, to) : to - selectedRangeMs.value
    // Commit a complete response atomically; a pending request is never zero usage.
    isLoading.value = true
    loadFailed.value = false

    try {
      const result = await window.api.getUsageTrendStats({
        from,
        to,
        groupBy: groupBy.value,
        ...(baseline ? { baseline: true } : {}),
      })
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
    baselineAt,
    applyBaseline,
    groupBy,
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
