import { computed, ref, watch } from 'vue'
import type { TokenUsageUserSession } from '@shared/models'

const STORAGE_KEY = 'floating-session-preferences'
export const floatingLatestCountOptions = [1, 3, 5, 10] as const
const DEFAULT_LATEST_COUNT = 5
const MAX_LATEST_COUNT = 10
const AUTO_REFRESH_MS = 30_000

export interface FloatingSessionItem {
  key: string
  agent: string
  rootSessionId: string
  title?: string
  startedAt: string
  endedAt: string
  models: string[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  reasoningTokens: number
  apiCallCount: number
  childCount: number
}

interface PinnedSessionRecord {
  key: string
  agent: string
  rootSessionId: string
  snapshot: FloatingSessionItem
}

interface StoredPreferences {
  latestCount: number
  pinned: PinnedSessionRecord[]
}

function clampLatestCount(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_LATEST_COUNT
  const clamped = Math.min(MAX_LATEST_COUNT, Math.max(1, Math.trunc(parsed)))
  return floatingLatestCountOptions.reduce(
    (closest, option) =>
      Math.abs(option - clamped) < Math.abs(closest - clamped) ? option : closest,
    DEFAULT_LATEST_COUNT,
  )
}

export function floatingSessionKey(agent: string, rootSessionId: string): string {
  return `${agent}\u0000${rootSessionId}`
}

function fromUserSession(session: TokenUsageUserSession): FloatingSessionItem {
  return {
    key: floatingSessionKey(session.agent, session.rootSessionId),
    agent: session.agent,
    rootSessionId: session.rootSessionId,
    title: session.title,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    models: [...session.models],
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    cacheReadTokens: session.cacheReadTokens,
    cacheWriteTokens: session.cacheWriteTokens,
    totalTokens: session.totalTokens,
    reasoningTokens: session.reasoningTokens,
    apiCallCount: session.apiCallCount,
    childCount: session.children.length,
  }
}

function isFloatingSessionItem(value: unknown): value is FloatingSessionItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<FloatingSessionItem>
  return (
    typeof item.agent === 'string' &&
    typeof item.rootSessionId === 'string' &&
    typeof item.totalTokens === 'number' &&
    Array.isArray(item.models)
  )
}

function loadPreferences(): StoredPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { latestCount: DEFAULT_LATEST_COUNT, pinned: [] }
    const parsed = JSON.parse(raw) as Partial<StoredPreferences>
    const pinned = Array.isArray(parsed.pinned)
      ? parsed.pinned.flatMap((record) => {
          if (!record || typeof record !== 'object') return []
          const candidate = record as Partial<PinnedSessionRecord>
          if (
            typeof candidate.agent !== 'string' ||
            typeof candidate.rootSessionId !== 'string' ||
            !isFloatingSessionItem(candidate.snapshot)
          ) {
            return []
          }
          const key = floatingSessionKey(candidate.agent, candidate.rootSessionId)
          return [
            { ...candidate, key, snapshot: { ...candidate.snapshot, key } } as PinnedSessionRecord,
          ]
        })
      : []
    return { latestCount: clampLatestCount(parsed.latestCount), pinned }
  } catch {
    return { latestCount: DEFAULT_LATEST_COUNT, pinned: [] }
  }
}

export function useFloatingSessions() {
  const stored = loadPreferences()
  const latestCount = ref(stored.latestCount)
  const pinnedRecords = ref<PinnedSessionRecord[]>(stored.pinned)
  const latestPool = ref<FloatingSessionItem[]>([])
  const liveSessions = ref(new Map<string, FloatingSessionItem>())
  const tokenDeltas = ref(new Map<string, number>())
  const isRefreshing = ref(false)
  const loadFailed = ref(false)

  const previousTotals = new Map<string, number>()
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let autoRefreshStopped = true

  function persistPreferences(): void {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ latestCount: latestCount.value, pinned: pinnedRecords.value }),
    )
  }

  watch(latestCount, (value) => {
    const normalized = clampLatestCount(value)
    if (normalized !== value) latestCount.value = normalized
    persistPreferences()
  })

  const pinnedKeys = computed(() => new Set(pinnedRecords.value.map((record) => record.key)))

  const pinnedSessions = computed(() =>
    pinnedRecords.value.map((record) => liveSessions.value.get(record.key) ?? record.snapshot),
  )

  const latestSessions = computed(() =>
    latestPool.value
      .filter((session) => !pinnedKeys.value.has(session.key))
      .slice(0, latestCount.value),
  )

  const hasSessions = computed(
    () => pinnedSessions.value.length > 0 || latestSessions.value.length > 0,
  )

  function isPinned(key: string): boolean {
    return pinnedKeys.value.has(key)
  }

  function togglePin(session: FloatingSessionItem): void {
    const index = pinnedRecords.value.findIndex((record) => record.key === session.key)
    if (index >= 0) {
      pinnedRecords.value.splice(index, 1)
    } else {
      pinnedRecords.value.push({
        key: session.key,
        agent: session.agent,
        rootSessionId: session.rootSessionId,
        snapshot: { ...session, models: [...session.models] },
      })
    }
    persistPreferences()
  }

  function movePinned(sourceKey: string, targetKey: string, position: 'before' | 'after'): void {
    if (!sourceKey || sourceKey === targetKey) return
    const sourceIndex = pinnedRecords.value.findIndex((record) => record.key === sourceKey)
    if (sourceIndex < 0) return

    const next = [...pinnedRecords.value]
    const [record] = next.splice(sourceIndex, 1)
    const targetIndex = next.findIndex((item) => item.key === targetKey)
    if (targetIndex < 0) return
    const insertIndex = targetIndex + (position === 'after' ? 1 : 0)
    next.splice(insertIndex, 0, record)

    const unchanged = next.every((item, index) => item.key === pinnedRecords.value[index]?.key)
    if (unchanged) return
    pinnedRecords.value = next
  }

  function persistPinnedOrder(): void {
    persistPreferences()
  }

  async function fetchPinnedSession(
    record: PinnedSessionRecord,
  ): Promise<FloatingSessionItem | null> {
    try {
      const page = await window.api.getUserUsageSessions({
        agent: record.agent,
        rootSessionId: record.rootSessionId,
        page: 1,
        pageSize: 1,
      })
      return page.items[0] ? fromUserSession(page.items[0]) : null
    } catch {
      return null
    }
  }

  async function fetchLatestSessions(): Promise<FloatingSessionItem[]> {
    const sessions: FloatingSessionItem[] = []
    const seen = new Set<string>()
    let pageNumber = 1
    let totalPages = 1

    do {
      const page = await window.api.getUserUsageSessions({ page: pageNumber, pageSize: 100 })
      totalPages = page.totalPages
      for (const item of page.items) {
        const session = fromUserSession(item)
        if (seen.has(session.key)) continue
        seen.add(session.key)
        sessions.push(session)
      }

      const unpinnedCount = sessions.filter((session) => !pinnedKeys.value.has(session.key)).length
      if (unpinnedCount >= latestCount.value) break
      pageNumber += 1
    } while (pageNumber <= totalPages)

    return sessions
  }

  async function refresh(runScan = true): Promise<void> {
    if (isRefreshing.value) return
    isRefreshing.value = true
    loadFailed.value = false

    try {
      if (runScan) {
        try {
          await window.api.scanPerform({ mode: 'incremental' })
        } catch (error) {
          // 单个扫描器失败时仍读取已保存的会话数据。
          console.warn('[floating-window] 自动扫描失败:', error)
        }
      }

      const latest = await fetchLatestSessions()
      const freshMap = new Map(latest.map((session) => [session.key, session]))

      const missingPinned = pinnedRecords.value.filter((record) => !freshMap.has(record.key))
      const pinnedResults = await Promise.all(missingPinned.map(fetchPinnedSession))
      for (const session of pinnedResults) {
        if (session) freshMap.set(session.key, session)
      }

      const nextDeltas = new Map<string, number>()
      for (const [key, session] of freshMap) {
        const previous = previousTotals.get(key)
        if (previous != null && session.totalTokens > previous) {
          nextDeltas.set(key, session.totalTokens - previous)
        }
        previousTotals.set(key, session.totalTokens)
      }
      for (const key of previousTotals.keys()) {
        if (!freshMap.has(key)) {
          previousTotals.delete(key)
        }
      }

      latestPool.value = latest
      liveSessions.value = freshMap
      tokenDeltas.value = nextDeltas
      pinnedRecords.value = pinnedRecords.value.map((record) => {
        const fresh = freshMap.get(record.key)
        return fresh ? { ...record, snapshot: fresh } : record
      })
      persistPreferences()
    } catch (error) {
      loadFailed.value = true
      console.error('[floating-window] 加载用户级会话失败:', error)
    } finally {
      isRefreshing.value = false
    }
  }

  function startAutoRefresh(): void {
    stopAutoRefresh()
    autoRefreshStopped = false

    const runCycle = async (): Promise<void> => {
      await refresh(true)
      if (!autoRefreshStopped) refreshTimer = setTimeout(runCycle, AUTO_REFRESH_MS)
    }
    void runCycle()
  }

  function stopAutoRefresh(): void {
    autoRefreshStopped = true
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = null
  }

  return {
    latestCount,
    pinnedSessions,
    latestSessions,
    tokenDeltas,
    isRefreshing,
    loadFailed,
    hasSessions,
    isPinned,
    togglePin,
    movePinned,
    persistPinnedOrder,
    refresh,
    startAutoRefresh,
    stopAutoRefresh,
  }
}
