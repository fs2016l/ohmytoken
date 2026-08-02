import { computed, ref, watch } from 'vue'
import api from '../api'
import { agentNames, agentOrder, getAgentName, getModelColor } from '../config/agents'
import type {
  AgentModelStats,
  Comparisons,
  ComparisonPair,
  DailyStats,
  HourlyUsageStats,
  ModelAgentStats,
  ModelStats,
  MonthlyStats,
  Overview,
  PageResult,
  ScanMode,
  ScanResult,
  TokenUsageApiCall,
  TokenUsageUserSession,
} from '@shared/models'

type ApiResponse<T> = { data: T }
export type ModelFilter = 'all' | 'with-data'
export type QuickRange = 'today' | 'week' | 'month' | 'all'
export type ModalMode = 'agent' | 'model'
export type DetailLevel = 'summary' | 'sessions' | 'apiCalls'
type ActiveDetailFilter = { agent?: string; model?: string; from?: string; to?: string }

function normalizeOverview(data: Overview | null | undefined): Overview | null {
  return data ?? null
}

function hasUsableDate<T extends { date: string }>(item: T): boolean {
  return Boolean(item.date && item.date !== 'detected')
}

function findOnlyUsageDate(groups: ReadonlyArray<ReadonlyArray<DailyStats>>): string | null {
  const usageDates = new Set<string>()

  for (const group of groups) {
    for (const row of group) {
      if (!hasUsableDate(row) || Number(row.totalTokens) <= 0) continue
      usageDates.add(row.date.replace(/\//g, '-'))
      if (usageDates.size > 1) return null
    }
  }

  return usageDates.values().next().value ?? null
}

export function formatDateInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getWeekMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff)
  return d
}

export function formatComparison(comp: ComparisonPair | null | undefined): string {
  if (!comp) return '—'
  const prefix = comp.change >= 0 ? '+' : ''
  return `${prefix}${comp.change.toFixed(1)}%`
}

export function useAgentStats() {
  const overview = ref<Overview | null>(null)
  const overviewFixed = ref<Overview | null>(null)
  const dailyStats = ref<DailyStats[]>([])
  const dailyModelStats = ref<DailyStats[]>([])
  const hourlyAgentStats = ref<HourlyUsageStats[]>([])
  const hourlyModelStats = ref<HourlyUsageStats[]>([])
  const monthlyStats = ref<MonthlyStats[]>([])
  const modelStats = ref<ModelStats[]>([])
  const fixedDaily = ref<DailyStats[]>([])
  const isScanning = ref(false)
  const scanResult = ref<ScanResult | null>(null)
  const lastScanTime = ref(localStorage.getItem('last-scan-time') || '')
  const comparisons = ref<Comparisons | null>(null)

  const modelFilter = ref<ModelFilter>('with-data')
  const dateFrom = ref(localStorage.getItem('date-from') || '')
  const dateTo = ref(localStorage.getItem('date-to') || '')
  const selectedQuickRange = ref<QuickRange | null>(null)

  const showModal = ref(false)
  const modalMode = ref<ModalMode>('agent')
  const selectedAgent = ref('')
  const selectedAgentName = ref('')
  const agentModelData = ref<AgentModelStats[]>([])
  const selectedModel = ref('')
  const modelAgentData = ref<ModelAgentStats[]>([])
  const isLoadingDetail = ref(false)
  const detailLevel = ref<DetailLevel>('summary')
  const sessionRows = ref<TokenUsageUserSession[]>([])
  const apiCallRows = ref<TokenUsageApiCall[]>([])
  const selectedSessionId = ref('')
  const activeDetailFilter = ref<ActiveDetailFilter>({})
  const sessionPage = ref(1)
  const sessionPageSize = ref(20)
  const sessionTotal = ref(0)
  const apiPage = ref(1)
  const apiPageSize = ref(20)
  const apiTotal = ref(0)
  const detailPage = computed(() =>
    detailLevel.value === 'sessions' ? sessionPage.value : apiPage.value,
  )
  const detailPageSize = computed(() =>
    detailLevel.value === 'sessions' ? sessionPageSize.value : apiPageSize.value,
  )
  const detailTotal = computed(() =>
    detailLevel.value === 'sessions' ? sessionTotal.value : apiTotal.value,
  )

  const availableAgents = computed(() => {
    const totals = overviewFixed.value?.agentTotals || {}
    const seen = new Set<string>([...agentOrder, ...Object.keys(totals)])
    return [...seen].filter((agent) => (totals[agent] || 0) > 0)
  })

  const totalAgents = computed(() => availableAgents.value.length)
  const totalModels = computed(
    () => Object.keys(overviewFixed.value?.modelTotals || {}).length || modelStats.value.length,
  )
  const todayUsage = computed(() => overviewFixed.value?.todayUsage || 0)
  const weekUsage = computed(() => overviewFixed.value?.weekUsage || 0)
  const monthUsage = computed(() => overviewFixed.value?.monthUsage || 0)
  const lastScanDisplay = computed(() => lastScanTime.value || scanResult.value?.scanTime || '')

  const quickRange = computed<QuickRange | null>(() => {
    const now = new Date()
    const today = formatDateInput(now)
    const weekStart = getWeekMonday(now)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const monthEndStr = formatDateInput(monthEnd)

    const matches: Record<QuickRange, boolean> = {
      all: !dateFrom.value && !dateTo.value,
      today: dateFrom.value === today && dateTo.value === today,
      week: dateFrom.value === formatDateInput(weekStart) && dateTo.value === today,
      month: dateFrom.value === formatDateInput(monthStart) && dateTo.value === monthEndStr,
    }
    const selected = selectedQuickRange.value
    if (selected && matches[selected]) return selected
    if (matches.all) return 'all'
    if (matches.today) return 'today'
    if (matches.week) return 'week'
    if (matches.month) return 'month'
    return null
  })

  const filteredModels = computed(() => {
    const sorted = [...modelStats.value].sort(
      (a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model),
    )
    return sorted.filter((model) => {
      if (modelFilter.value === 'with-data' && model.totalTokens <= 0) return false
      return true
    })
  })

  const sortedModelNames = computed(() =>
    [...modelStats.value]
      .filter((model) => model.totalTokens > 0)
      .sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model))
      .map((model) => model.model),
  )

  const hourlyTrendDate = computed<string | null>(() =>
    findOnlyUsageDate([dailyStats.value, dailyModelStats.value]),
  )

  const singleDayRange = computed(() => hourlyTrendDate.value !== null)

  function modelColor(modelName: string): string {
    return getModelColor(modelName, sortedModelNames.value)
  }

  function modelAgents(model: ModelStats): string[] {
    return Object.keys(model.agentTokens || {})
  }

  function getDateParams(): { from?: string; to?: string } {
    const params: { from?: string; to?: string } = {}
    if (dateFrom.value) params.from = dateFrom.value.replace(/\//g, '-')
    if (dateTo.value) params.to = dateTo.value.replace(/\//g, '-')
    return params
  }

  function resetDrilldownRows(): void {
    detailLevel.value = 'summary'
    sessionRows.value = []
    apiCallRows.value = []
    selectedSessionId.value = ''
    activeDetailFilter.value = {}
    sessionPage.value = 1
    sessionTotal.value = 0
    apiPage.value = 1
    apiTotal.value = 0
  }

  function setActiveDetailFilter(filter: ActiveDetailFilter): ActiveDetailFilter {
    activeDetailFilter.value = filter
    return filter
  }

  async function loadSessionPage(filter: ActiveDetailFilter): Promise<void> {
    isLoadingDetail.value = true
    try {
      const res = (await api.get('/stats/user-sessions', {
        params: {
          ...filter,
          page: sessionPage.value,
          pageSize: sessionPageSize.value,
        },
      })) as ApiResponse<PageResult<TokenUsageUserSession>>
      sessionRows.value = res.data.items || []
      sessionPage.value = res.data.page
      sessionPageSize.value = res.data.pageSize
      sessionTotal.value = res.data.total
    } catch (error) {
      sessionRows.value = []
      sessionTotal.value = 0
      console.error('Failed to fetch session detail:', error)
    } finally {
      isLoadingDetail.value = false
    }
  }

  function currentApiFilter(): ActiveDetailFilter & {
    rootSessionId?: string
  } {
    if (!selectedSessionId.value) return activeDetailFilter.value
    return {
      ...activeDetailFilter.value,
      agent: selectedAgent.value,
      rootSessionId: selectedSessionId.value,
    }
  }

  async function loadApiPage(): Promise<void> {
    isLoadingDetail.value = true
    try {
      const res = (await api.get('/stats/api-records', {
        params: {
          ...currentApiFilter(),
          page: apiPage.value,
          pageSize: apiPageSize.value,
        },
      })) as ApiResponse<PageResult<TokenUsageApiCall>>
      apiCallRows.value = res.data.items || []
      apiPage.value = res.data.page
      apiPageSize.value = res.data.pageSize
      apiTotal.value = res.data.total
    } catch (error) {
      apiCallRows.value = []
      apiTotal.value = 0
      console.error('Failed to fetch API call detail:', error)
    } finally {
      isLoadingDetail.value = false
    }
  }

  async function fetchComparisons(): Promise<void> {
    try {
      const res = (await api.get('/stats/comparisons')) as ApiResponse<Comparisons>
      comparisons.value = res.data
    } catch (error) {
      console.error('Failed to fetch comparisons:', error)
    }
  }

  async function fetchOverview(): Promise<void> {
    try {
      const res = (await api.get('/stats/overview', {
        params: getDateParams(),
      })) as ApiResponse<Overview>
      overview.value = normalizeOverview(res.data)
    } catch (error) {
      console.error('Failed to fetch overview:', error)
    }
  }

  async function fetchOverviewFixed(): Promise<void> {
    try {
      const res = (await api.get('/stats/overview')) as ApiResponse<Overview>
      overviewFixed.value = normalizeOverview(res.data)
    } catch (error) {
      console.error('Failed to fetch fixed overview:', error)
    }
  }

  async function fetchDailyStats(): Promise<void> {
    try {
      const res = (await api.get('/stats/daily', { params: getDateParams() })) as ApiResponse<
        DailyStats[]
      >
      dailyStats.value = (res.data || []).filter(hasUsableDate)
    } catch (error) {
      console.error('Failed to fetch daily stats:', error)
      dailyStats.value = []
    }
  }

  async function fetchDailyModelStats(): Promise<void> {
    try {
      const res = (await api.get('/stats/model/daily', { params: getDateParams() })) as ApiResponse<
        DailyStats[]
      >
      dailyModelStats.value = (res.data || []).filter(hasUsableDate)
    } catch (error) {
      console.error('Failed to fetch daily model stats:', error)
      dailyModelStats.value = []
    }
  }

  async function fetchHourlyStats(): Promise<void> {
    const date = hourlyTrendDate.value
    if (!date) {
      hourlyAgentStats.value = []
      hourlyModelStats.value = []
      return
    }

    try {
      const [agentRes, modelRes] = await Promise.all([
        api.get('/stats/hourly', { params: { date, groupBy: 'agent' } }) as Promise<
          ApiResponse<HourlyUsageStats[]>
        >,
        api.get('/stats/hourly', { params: { date, groupBy: 'model' } }) as Promise<
          ApiResponse<HourlyUsageStats[]>
        >,
      ])
      hourlyAgentStats.value = agentRes.data || []
      hourlyModelStats.value = modelRes.data || []
    } catch (error) {
      console.error('Failed to fetch hourly stats:', error)
      hourlyAgentStats.value = []
      hourlyModelStats.value = []
    }
  }

  async function fetchMonthlyStats(): Promise<void> {
    try {
      const monthlyParams: { from?: string; to?: string } = {}
      if (dateFrom.value) monthlyParams.from = dateFrom.value.substring(0, 7)
      if (dateTo.value) monthlyParams.to = dateTo.value.substring(0, 7)
      const res = (await api.get('/stats/monthly', { params: monthlyParams })) as ApiResponse<
        MonthlyStats[]
      >
      monthlyStats.value = res.data || []
    } catch (error) {
      console.error('Failed to fetch monthly stats:', error)
    }
  }

  async function fetchModelStats(): Promise<void> {
    try {
      const res = (await api.get('/stats/model', { params: getDateParams() })) as ApiResponse<
        ModelStats[]
      >
      modelStats.value = res.data || []
    } catch (error) {
      console.error('Failed to fetch model stats:', error)
    }
  }

  async function fetchFixedData(): Promise<void> {
    try {
      const res = (await api.get('/stats/daily')) as ApiResponse<DailyStats[]>
      fixedDaily.value = (res.data || []).filter(hasUsableDate)
    } catch (error) {
      console.error('Failed to fetch fixed daily stats:', error)
    }
  }

  async function refreshAll(): Promise<void> {
    const dailyStatsReady = Promise.all([fetchDailyStats(), fetchDailyModelStats()])

    await Promise.all([
      fetchOverview(),
      fetchOverviewFixed(),
      dailyStatsReady.then(() => fetchHourlyStats()),
      fetchMonthlyStats(),
      fetchModelStats(),
      fetchFixedData(),
      fetchComparisons(),
    ])
  }

  async function performScan(mode: ScanMode = 'incremental'): Promise<void> {
    if (isScanning.value) return
    isScanning.value = true
    try {
      const res = (await api.post('/scan', { mode })) as ApiResponse<ScanResult>
      scanResult.value = res.data
      lastScanTime.value = new Date().toLocaleString()
      localStorage.setItem('last-scan-time', lastScanTime.value)
      await refreshAll()
    } catch (error) {
      console.error('Scan failed:', error)
      const message = error instanceof Error ? error.message : String(error)
      scanResult.value = {
        scanTime: new Date().toISOString(),
        totalRecords: 0,
        records: [],
        scannedAgents: [],
        detectedAgents: [],
        errors: [`Network error: ${message}`],
      }
    } finally {
      isScanning.value = false
    }
  }

  function setQuickRange(range: QuickRange): void {
    selectedQuickRange.value = range
    if (range === 'all') {
      applyDateRange('', '')
      return
    }

    const now = new Date()
    const start = new Date(now)
    if (range === 'week') {
      start.setTime(getWeekMonday(now).getTime())
    } else if (range === 'month') {
      start.setDate(1)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      applyDateRange(formatDateInput(start), formatDateInput(end))
      return
    }

    applyDateRange(formatDateInput(start), formatDateInput(now))
  }

  function applyDateRange(from: string, to: string): void {
    const unchanged = dateFrom.value === from && dateTo.value === to
    dateFrom.value = from
    dateTo.value = to
    if (unchanged) void refreshAll()
  }

  async function showAgentDetail(agent: string): Promise<void> {
    modalMode.value = 'agent'
    selectedAgent.value = agent
    selectedAgentName.value = getAgentName(agent)
    selectedModel.value = ''
    showModal.value = true
    isLoadingDetail.value = true
    agentModelData.value = []
    modelAgentData.value = []
    resetDrilldownRows()
    try {
      const res = (await api.get(`/stats/agent/${agent}`, {
        params: getDateParams(),
      })) as ApiResponse<AgentModelStats[]>
      agentModelData.value = res.data || []
    } catch (error) {
      console.error('Failed to fetch agent detail:', error)
    } finally {
      isLoadingDetail.value = false
    }
  }

  async function showModelDetail(model: string): Promise<void> {
    modalMode.value = 'model'
    selectedAgent.value = ''
    selectedAgentName.value = ''
    selectedModel.value = model
    showModal.value = true
    isLoadingDetail.value = true
    agentModelData.value = []
    modelAgentData.value = []
    resetDrilldownRows()
    try {
      const res = (await api.get('/stats/model/agents', {
        params: { model, ...getDateParams() },
      })) as ApiResponse<ModelAgentStats[] | ModelAgentStats | null>
      const data = res.data
      modelAgentData.value = Array.isArray(data) ? data : data ? [data] : []
    } catch (error) {
      console.error('Failed to fetch model detail:', error)
    } finally {
      isLoadingDetail.value = false
    }
  }

  async function showSessionsForAgentModel(agent: string, model: string): Promise<void> {
    modalMode.value = 'agent'
    selectedAgent.value = agent
    selectedAgentName.value = getAgentName(agent)
    selectedModel.value = model
    detailLevel.value = 'sessions'
    sessionPage.value = 1
    sessionTotal.value = 0
    sessionRows.value = []
    apiCallRows.value = []
    selectedSessionId.value = ''
    const filter = setActiveDetailFilter({ agent, model, ...getDateParams() })
    await loadSessionPage(filter)
  }

  async function showSessionsForModelAgent(model: string, agent: string): Promise<void> {
    modalMode.value = 'model'
    selectedModel.value = model
    selectedAgent.value = agent
    selectedAgentName.value = getAgentName(agent)
    detailLevel.value = 'sessions'
    sessionPage.value = 1
    sessionTotal.value = 0
    sessionRows.value = []
    apiCallRows.value = []
    selectedSessionId.value = ''
    const filter = setActiveDetailFilter({ agent, model, ...getDateParams() })
    await loadSessionPage(filter)
  }

  async function showApiCallsForSession(session: TokenUsageUserSession): Promise<void> {
    selectedAgent.value = session.agent
    selectedAgentName.value = getAgentName(session.agent)
    selectedSessionId.value = session.rootSessionId
    detailLevel.value = 'apiCalls'
    apiPage.value = 1
    apiTotal.value = 0
    apiCallRows.value = []
    await loadApiPage()
  }

  async function showAllUserSessions(
    mode: ModalMode,
    scope: Pick<ActiveDetailFilter, 'agent' | 'model'> = {},
  ): Promise<void> {
    const agent = scope.agent?.trim() || ''
    const model = scope.model?.trim() || ''
    modalMode.value = mode
    selectedAgent.value = agent
    selectedAgentName.value = agent ? getAgentName(agent) : ''
    selectedModel.value = model
    showModal.value = true
    detailLevel.value = 'sessions'
    sessionPage.value = 1
    sessionTotal.value = 0
    if (!agent && !model) {
      agentModelData.value = []
      modelAgentData.value = []
    }
    sessionRows.value = []
    apiCallRows.value = []
    selectedSessionId.value = ''
    const filter = setActiveDetailFilter({
      ...getDateParams(),
      ...(agent ? { agent } : {}),
      ...(model ? { model } : {}),
    })
    await loadSessionPage(filter)
  }

  async function showAllApiRecords(
    mode: ModalMode,
    scope: Pick<ActiveDetailFilter, 'agent' | 'model'> = {},
  ): Promise<void> {
    const agent = scope.agent?.trim() || ''
    const model = scope.model?.trim() || ''
    modalMode.value = mode
    selectedAgent.value = agent
    selectedAgentName.value = agent ? getAgentName(agent) : ''
    selectedModel.value = model
    showModal.value = true
    detailLevel.value = 'apiCalls'
    apiPage.value = 1
    apiTotal.value = 0
    if (!agent && !model) {
      agentModelData.value = []
      modelAgentData.value = []
    }
    sessionRows.value = []
    apiCallRows.value = []
    selectedSessionId.value = ''
    setActiveDetailFilter({
      ...getDateParams(),
      ...(agent ? { agent } : {}),
      ...(model ? { model } : {}),
    })
    await loadApiPage()
  }

  async function showUserSessionsForCurrentSelection(): Promise<void> {
    const scope =
      modalMode.value === 'agent' ? { agent: selectedAgent.value } : { model: selectedModel.value }
    await showAllUserSessions(modalMode.value, scope)
  }

  async function showApiRecordsForCurrentSelection(): Promise<void> {
    const scope =
      modalMode.value === 'agent' ? { agent: selectedAgent.value } : { model: selectedModel.value }
    await showAllApiRecords(modalMode.value, scope)
  }

  async function changeDetailPage(page: number): Promise<void> {
    if (detailLevel.value === 'sessions') {
      sessionPage.value = page
      await loadSessionPage(activeDetailFilter.value)
      return
    }
    if (detailLevel.value === 'apiCalls') {
      apiPage.value = page
      await loadApiPage()
    }
  }

  async function changeDetailPageSize(pageSize: number): Promise<void> {
    if (detailLevel.value === 'sessions') {
      sessionPageSize.value = pageSize
      sessionPage.value = 1
      await loadSessionPage(activeDetailFilter.value)
      return
    }
    if (detailLevel.value === 'apiCalls') {
      apiPageSize.value = pageSize
      apiPage.value = 1
      await loadApiPage()
    }
  }

  function backToDetailSummary(): void {
    detailLevel.value = 'summary'
    sessionRows.value = []
    apiCallRows.value = []
    selectedSessionId.value = ''
    if (modalMode.value === 'agent') {
      selectedModel.value = ''
    } else {
      selectedAgent.value = ''
      selectedAgentName.value = ''
    }
    activeDetailFilter.value = {}
  }

  function backToSessionList(): void {
    const filter = activeDetailFilter.value
    selectedAgent.value = filter.agent || ''
    selectedAgentName.value = filter.agent ? getAgentName(filter.agent) : ''
    selectedModel.value = filter.model || ''
    detailLevel.value = 'sessions'
    apiCallRows.value = []
    selectedSessionId.value = ''
  }

  function closeModal(): void {
    showModal.value = false
    selectedAgent.value = ''
    selectedAgentName.value = ''
    agentModelData.value = []
    selectedModel.value = ''
    modelAgentData.value = []
    resetDrilldownRows()
  }

  watch([dateFrom, dateTo], ([from, to]) => {
    localStorage.setItem('date-from', from)
    localStorage.setItem('date-to', to)
    void refreshAll()
  })

  return {
    overview,
    overviewFixed,
    dailyStats,
    dailyModelStats,
    hourlyAgentStats,
    hourlyModelStats,
    monthlyStats,
    modelStats,
    fixedDaily,
    isScanning,
    scanResult,
    lastScanTime,
    comparisons,
    modelFilter,
    dateFrom,
    dateTo,
    showModal,
    modalMode,
    selectedAgent,
    selectedAgentName,
    agentModelData,
    selectedModel,
    modelAgentData,
    isLoadingDetail,
    detailLevel,
    sessionRows,
    apiCallRows,
    selectedSessionId,
    activeDetailFilter,
    detailPage,
    detailPageSize,
    detailTotal,
    availableAgents,
    totalAgents,
    totalModels,
    todayUsage,
    weekUsage,
    monthUsage,
    lastScanDisplay,
    quickRange,
    filteredModels,
    sortedModelNames,
    singleDayRange,
    agentNames,
    modelColor,
    modelAgents,
    getDateParams,
    refreshAll,
    performScan,
    setQuickRange,
    showAgentDetail,
    showModelDetail,
    showSessionsForAgentModel,
    showSessionsForModelAgent,
    showApiCallsForSession,
    showAllUserSessions,
    showAllApiRecords,
    showUserSessionsForCurrentSelection,
    showApiRecordsForCurrentSelection,
    changeDetailPage,
    changeDetailPageSize,
    backToDetailSummary,
    backToSessionList,
    closeModal,
  }
}
