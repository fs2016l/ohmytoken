<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AnalyticsDimension, UsageAnalytics, UsageAnalyticsFilter } from '@shared/analytics'
import type { SessionSort, TokenUsageUserSession } from '@shared/models'
import { sumMoneyInUsd } from '@shared/cost-currency'
import SegmentedControl from '../base/SegmentedControl.vue'
import DropdownChevron from '../base/DropdownChevron.vue'
import ScrollRegion from '../base/ScrollRegion.vue'
import PaginationBar from '../base/PaginationBar.vue'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import AnimatedCost from '../base/AnimatedCost.vue'
import { useI18n } from '../../i18n/useI18n'
import { usePageState } from '../../composables/usePageState'
import { useTableTabState } from '../../composables/useTableTabState'
import { usePageResource } from '../../composables/usePageResource'
import { useCostCurrency } from '../../composables/useCostCurrency'
import { useScanStatus } from '../../composables/useScanStatus'
import { getAgentName } from '../../config/agents'
import AgentMark from '../base/AgentMark.vue'
import ModelMark from '../base/ModelMark.vue'
import { sessionKey } from '../../utils/session-display'
import { displayTimestamp } from '../../utils/date-range'
import { downloadCsv } from '../../utils/csv'
import { comparisonDay, type ComparisonMode } from '../../utils/analytics-trend'
const props = defineProps<{
  data: UsageAnalytics | null
  comparison: UsageAnalytics | null
  comparisonMode: ComparisonMode
  filter: UsageAnalyticsFilter
  expanded: boolean
}>()
const dimension = defineModel<'projects' | 'agents' | 'models' | 'sessions' | 'dates'>({
  required: true,
})
const emit = defineEmits<{
  expand: []
  model: [id: string]
  session: [value: TokenUsageUserSession]
}>()
const { label } = useI18n(),
  { exchange } = useCostCurrency(),
  scan = useScanStatus()
const state = usePageState('analytics-table', {
  page: 1,
  size: 10,
  sort: 'totalTokens',
  direction: 'desc',
  expanded: [] as string[],
})
const tabs = useTableTabState(
  'analytics-table',
  () => dimension.value,
  state,
  {
    page: 1,
    size: 10,
    sort: 'totalTokens',
    direction: 'desc',
    expanded: [],
  },
  dimension.value,
)
const scroller = ref<InstanceType<typeof ScrollRegion> | null>(null),
  exporting = ref(false),
  exportError = ref('')
const options = computed(() => [
  { value: 'projects', label: label('Projects', '项目') },
  { value: 'agents', label: 'Agent' },
  { value: 'models', label: label('Models', '模型') },
  { value: 'sessions', label: label('Sessions', '会话') },
  { value: 'dates', label: label('Date', '日期') },
])
type Row = AnalyticsDimension & { session?: TokenUsageUserSession; children?: Row[] }
const key = (id: string): string => `${dimension.value}:${id}`
const source = computed<Row[]>(() => {
  if (!props.data || dimension.value === 'sessions') return []
  return props.data[dimension.value].map((value) => {
    const children =
      dimension.value === 'projects'
        ? props.data!.projectAgents[value.id]
        : dimension.value === 'models'
          ? props.data!.modelAgents[value.id]
          : dimension.value === 'agents'
            ? Object.entries(props.data!.modelAgents).flatMap(([model, agents]) =>
                agents
                  .filter((agent) => agent.id === value.id)
                  .map((agent) => ({ ...agent, id: model, name: model })),
              )
            : []
    return {
      ...value,
      name:
        dimension.value === 'agents'
          ? getAgentName(value.id)
          : value.name || label('Unassigned', '未关联项目'),
      children: children?.map((child) => ({
        ...child,
        name: dimension.value === 'agents' ? child.name : getAgentName(child.id),
      })),
    }
  })
})
const comparisonRange = computed(() =>
  props.comparison ? { from: props.comparison.from, to: props.comparison.to } : undefined,
)
const baseline = computed(
  () =>
    new Map(
      props.comparison && dimension.value !== 'sessions'
        ? props.comparison[dimension.value].map((row) => [row.id, row.totalTokens])
        : [],
    ),
)
const change = (row: Row): number | null => {
  if (!props.comparison || !props.data) return null
  const id =
    dimension.value === 'dates'
      ? comparisonDay(row.id, props.data, props.comparison, props.comparisonMode)
      : row.id
  const prior =
    dimension.value === 'sessions'
      ? row.session?.comparisonTokens
      : id
        ? baseline.value.get(id)
        : undefined
  return prior ? ((row.totalTokens - prior) / prior) * 100 : null
}
const columns = computed(() => [
  { key: 'lastActiveAt', name: label('Time', '时间') },
  { key: 'totalTokens', name: label('Total tokens', 'Token 总量') },
  { key: 'cost', name: label('Est. cost', '预估花费') },
  { key: 'inputTokens', name: label('Input', '输入') },
  { key: 'outputTokens', name: label('Output', '输出') },
  { key: 'cache', name: label('Cache', '缓存') },
  { key: 'reasoningTokens', name: label('Reasoning', '推理') },
  { key: 'apiCallCount', name: label('API calls', 'API 调用') },
  { key: 'turns', name: label('Turns', '对话次数') },
  { key: 'change', name: label('Token change', 'Token 环比') },
])
function sortValue(row: Row, column: string): number | string | null {
  if (column === 'name') return row.name
  if (column === 'lastActiveAt') return row.lastActiveAt ? Date.parse(row.lastActiveAt) : null
  if (column === 'cost')
    return row.costSummary?.pricedRecords
      ? (sumMoneyInUsd(row.costSummary.totals, exchange.value.snapshot)?.min ?? null)
      : null
  if (column === 'cache') return row.cacheReadTokens + row.cacheWriteTokens
  if (column === 'turns') return row.turns.complete || row.turns.count ? row.turns.count : null
  if (column === 'change') return change(row)
  if (column === 'apiCallCount' && !row.apiCallCountComplete && !row.apiCallCount) return null
  return row[column as keyof Row] as number
}
const sorted = computed(() =>
  [...source.value].sort((a, b) => {
    const av = sortValue(a, state.sort),
      bv = sortValue(b, state.sort)
    if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1
    const diff =
      typeof av === 'string' && typeof bv === 'string'
        ? av.localeCompare(bv)
        : Number(av) - Number(bv)
    return (state.direction === 'asc' ? diff : -diff) || a.id.localeCompare(b.id)
  }),
)
const sessionSort = computed<SessionSort>(
  () =>
    (({
      name: 'title',
      lastActiveAt: 'recent',
      totalTokens: 'tokens',
      inputTokens: 'input',
      outputTokens: 'output',
      cache: 'cache',
      reasoningTokens: 'reasoning',
      cost: 'cost',
      apiCallCount: 'calls',
      turns: 'turns',
      change: 'change',
    })[state.sort] as SessionSort) || 'tokens',
)
const sessionResource = usePageResource(
  () => [
    dimension.value,
    props.filter,
    comparisonRange.value,
    state.page,
    state.size,
    state.sort,
    state.direction,
    scan.revision.value,
  ],
  () =>
    dimension.value === 'sessions'
      ? window.api.getSessionWorkspace({
          ...props.filter,
          comparison: comparisonRange.value,
          page: state.page,
          pageSize: state.size,
          sortBy: sessionSort.value,
          sortDirection: state.direction as 'asc' | 'desc',
          costExchangeRate: exchange.value.snapshot?.rates.CNY,
        })
      : Promise.resolve(null),
  null as Awaited<ReturnType<Window['api']['getSessionWorkspace']>> | null,
)
function sessionRow(session: TokenUsageUserSession): Row {
  return {
    ...session,
    id: sessionKey(session),
    name: session.title || session.sessionId,
    sessionCount: 1,
    sessionCountComplete: true,
    apiCallCount: session.apiCallCount || 0,
    apiCallCountComplete: session.apiCallCountComplete !== false,
    turns: session.turns || { count: 0, complete: false },
    lastActiveAt: session.endedAt || session.startedAt || session.date,
    session,
    children: undefined,
  }
}
const pageRows = computed(() =>
  dimension.value === 'sessions'
    ? sessionResource.data.value?.items.map(sessionRow) || []
    : sorted.value.slice((state.page - 1) * state.size, state.page * state.size),
)
const total = computed(() =>
  dimension.value === 'sessions' ? sessionResource.data.value?.total || 0 : source.value.length,
)
const rows = computed(() =>
  pageRows.value.flatMap((row) => [
    { row, child: false, key: key(row.id) },
    ...(state.expanded.includes(key(row.id)) ? row.children || [] : []).map((child) => ({
      row: child,
      child: true,
      key: `${key(row.id)}:${child.id}`,
    })),
  ]),
)
watch(
  () =>
    [JSON.stringify(props.filter), JSON.stringify(comparisonRange.value), !!props.data] as const,
  ([filter, comparison], [previousFilter, previousComparison, wasReady]) => {
    // The first async comparison result restores the page; it is not a new filter choice.
    if (filter === previousFilter && (!wasReady || comparison === previousComparison)) return
    tabs.resetPaging(true)
    scroller.value?.scrollToTop()
  },
)
watch(
  () => [state.sort, state.direction, state.size],
  () => {
    if (tabs.switching.value) return
    tabs.resetPaging()
    scroller.value?.scrollToTop()
  },
  { flush: 'sync' },
)
watch(
  () => [total.value, dimension.value, sessionResource.busy.value, tabs.switching.value],
  () => {
    if (
      tabs.switching.value ||
      (dimension.value !== 'sessions' && !props.data) ||
      (dimension.value === 'sessions' &&
        (sessionResource.busy.value || !sessionResource.data.value))
    )
      return
    state.page = Math.min(state.page, Math.max(1, Math.ceil(total.value / state.size)))
  },
)
watch(
  () => state.page,
  () => {
    if (!tabs.switching.value) scroller.value?.scrollToTop()
  },
  { flush: 'sync' },
)
function sort(column: string): void {
  state.direction = state.sort === column && state.direction === 'desc' ? 'asc' : 'desc'
  state.sort = column
}
function toggle(row: Row): void {
  const id = key(row.id)
  state.expanded = state.expanded.includes(id)
    ? state.expanded.filter((value) => value !== id)
    : [...state.expanded, id]
}
function open(row: Row, child: boolean): void {
  if (row.session) emit('session', row.session)
  else if ((dimension.value === 'models' && !child) || (dimension.value === 'agents' && child))
    emit('model', row.id)
  else toggle(row)
}
async function exportRows(): Promise<void> {
  exporting.value = true
  exportError.value = ''
  const exportDimension = dimension.value,
    exportFrom = props.data?.from || 'all',
    exportTo = props.data?.to || 'all'
  const sortBy = sessionSort.value,
    sortDirection = state.direction as 'asc' | 'desc',
    comparison = comparisonRange.value && { ...comparisonRange.value },
    revision = scan.revision.value
  try {
    let items = sorted.value
    if (exportDimension === 'sessions') {
      items = []
      const filter = structuredClone(JSON.parse(JSON.stringify(props.filter)))
      for (let page = 1; ; page++) {
        const result = await window.api.getSessionWorkspace({
          ...filter,
          comparison,
          page,
          pageSize: 100,
          sortBy,
          sortDirection,
          costExchangeRate: exchange.value.snapshot?.rates.CNY,
        })
        items.push(...result.items.map(sessionRow))
        if (page >= result.totalPages) break
      }
    }
    if (scan.revision.value !== revision)
      throw new Error(
        label('Usage changed during export. Please retry.', '导出期间用量已更新，请重试。'),
      )
    downloadCsv(`ohmytoken-${exportDimension}-${exportFrom}-${exportTo}.csv`, [
      [
        'id',
        'name',
        'last_active',
        'tokens',
        'input',
        'output',
        'cache_read',
        'cache_write',
        'reasoning',
        'api_calls',
        'api_calls_complete',
        'turns',
        'turns_complete',
        'USD_min',
        'USD_max',
        'CNY_min',
        'CNY_max',
        'priced_tokens',
        'total_cost_records',
        'priced_cost_records',
      ],
      ...items.map((row) => [
        row.id,
        row.name,
        row.lastActiveAt,
        row.totalTokens,
        row.inputTokens,
        row.outputTokens,
        row.cacheReadTokens,
        row.cacheWriteTokens,
        row.reasoningTokens,
        row.apiCallCountComplete || row.apiCallCount ? row.apiCallCount : null,
        String(row.apiCallCountComplete),
        row.turns.complete || row.turns.count ? row.turns.count : null,
        String(row.turns.complete),
        ...(['USD', 'CNY'] as const).flatMap((currency) => {
          const money = row.costSummary?.totals.find((value) => value.currency === currency)
          return [money?.min, money?.max]
        }),
        row.costSummary?.pricedTokens,
        row.costSummary?.totalRecords,
        row.costSummary?.pricedRecords,
      ]),
    ])
  } catch (error) {
    exportError.value = error instanceof Error ? error.message : String(error)
  } finally {
    exporting.value = false
  }
}
</script>
<template>
  <section
    class="workspace-table-frame analytics-detail-table"
    :class="{ 'analytics-detail-table--expanded': expanded }"
  >
    <header>
      <SegmentedControl
        v-model="dimension"
        appearance="light"
        :options="options"
        :label="label('Detail dimension', '明细维度')"
      />
      <span class="muted">{{ total }} {{ label('items', '项') }}</span>
      <div class="detail-actions">
        <button
          type="button"
          class="workspace-button workspace-button--icon"
          :disabled="exporting"
          :aria-label="label('Export all filtered data', '导出全部筛选数据')"
          @click="exportRows"
        >
          <span class="material-symbols-outlined">download</span>
        </button>
        <button
          type="button"
          class="workspace-button workspace-button--icon"
          :aria-label="
            expanded ? label('Restore table', '恢复表格') : label('Expand table', '展开表格')
          "
          :aria-expanded="expanded"
          @click="emit('expand')"
        >
          <span class="material-symbols-outlined">
            {{ expanded ? 'fullscreen_exit' : 'fullscreen' }}
          </span>
        </button>
      </div>
    </header>
    <p v-if="sessionResource.error.value || exportError" class="workspace-error" role="alert">
      {{ sessionResource.error.value || exportError }}
      <button type="button" class="workspace-link" @click="sessionResource.refresh()">
        {{ label('Retry', '重试') }}
      </button>
    </p>
    <ScrollRegion
      :key="dimension"
      ref="scroller"
      page-key="analytics-table"
      :region="tabs.region(dimension)"
      :ready="dimension !== 'sessions' || !sessionResource.busy.value"
      :label="label('Usage detail rows', '用量明细列表')"
    >
      <table class="workspace-table">
        <colgroup>
          <col class="name-column" />
          <col v-for="column in columns" :key="column.key" class="metric-column" />
        </colgroup>
        <thead>
          <tr>
            <th>
              <button type="button" @click="sort('name')">
                {{ label('Name', '名称') }}
                <span>
                  {{ state.sort === 'name' ? (state.direction === 'asc' ? '↑' : '↓') : '↕' }}
                </span>
              </button>
            </th>
            <th
              v-for="column in columns"
              :key="column.key"
              :aria-sort="
                state.sort === column.key
                  ? state.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              "
            >
              <button
                type="button"
                :class="{ sorted: state.sort === column.key }"
                @click="sort(column.key)"
              >
                {{ column.name }}
                <span>
                  {{ state.sort === column.key ? (state.direction === 'asc' ? '↑' : '↓') : '↕' }}
                </span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rows" :key="item.key" :class="{ child: item.child }">
            <td>
              <div class="detail-row-name">
                <button
                  v-if="item.row.children?.length"
                  type="button"
                  class="expand-row"
                  :aria-label="label('Toggle breakdown', '展开或收起构成')"
                  :aria-expanded="state.expanded.includes(key(item.row.id))"
                  @click="toggle(item.row)"
                >
                  <DropdownChevron
                    :open="state.expanded.includes(key(item.row.id))"
                    direction="right"
                  />
                </button>
                <button
                  type="button"
                  class="row-name"
                  :title="item.row.name"
                  @click="open(item.row, item.child)"
                >
                  <AgentMark
                    v-if="dimension === 'agents' && !item.child"
                    :agent="item.row.id"
                    :size="14"
                    class="row-mark"
                  />
                  <ModelMark
                    v-else-if="dimension === 'agents' && item.child"
                    :model="item.row.id"
                    :size="14"
                    class="row-mark"
                  />
                  <ModelMark
                    v-else-if="dimension === 'models' && !item.child"
                    :model="item.row.id"
                    :size="14"
                    class="row-mark"
                  />
                  <AgentMark
                    v-else-if="item.child && (dimension === 'models' || dimension === 'projects')"
                    :agent="item.row.id"
                    :size="14"
                    class="row-mark"
                  />
                  {{ item.row.name }}
                  <small v-if="dimension !== 'dates' && !item.child">
                    {{
                      item.row.sessionCountComplete || item.row.sessionCount
                        ? `${item.row.sessionCountComplete ? '' : '≥ '}${item.row.sessionCount}`
                        : '—'
                    }}
                    {{ label('sessions', '个会话') }}
                  </small>
                </button>
              </div>
            </td>
            <td class="time-column">
              {{
                item.row.lastActiveAt?.length === 10
                  ? item.row.lastActiveAt
                  : item.row.lastActiveAt
                    ? displayTimestamp(item.row.lastActiveAt)
                    : '—'
              }}
            </td>
            <td><AnimatedNumber :value="item.row.totalTokens" :format="{ compact: true }" /></td>
            <td><AnimatedCost :summary="item.row.costSummary" :note="false" /></td>
            <td><AnimatedNumber :value="item.row.inputTokens" :format="{ compact: true }" /></td>
            <td><AnimatedNumber :value="item.row.outputTokens" :format="{ compact: true }" /></td>
            <td>
              <AnimatedNumber
                :value="item.row.cacheReadTokens + item.row.cacheWriteTokens"
                :format="{ compact: true }"
              />
            </td>
            <td>
              <AnimatedNumber :value="item.row.reasoningTokens" :format="{ compact: true }" />
            </td>
            <td>
              <AnimatedNumber
                :prefix="!item.row.apiCallCountComplete && item.row.apiCallCount ? '≥' : ''"
                :value="
                  item.row.apiCallCountComplete || item.row.apiCallCount
                    ? item.row.apiCallCount
                    : null
                "
                :format="{ compact: true }"
              />
            </td>
            <td>
              <AnimatedNumber
                :prefix="!item.row.turns.complete && item.row.turns.count ? '≥' : ''"
                :value="
                  item.row.turns.complete || item.row.turns.count ? item.row.turns.count : null
                "
                :format="{ compact: true }"
              />
            </td>
            <td>
              <span v-if="!item.child && change(item.row) !== null">
                {{ change(item.row)! >= 0 ? '+' : '' }}
                <AnimatedNumber :value="change(item.row)" :format="{ percent: true }" />
              </span>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length" class="workspace-empty">
        {{
          sessionResource.busy.value
            ? label('Loading…', '正在加载…')
            : label('No matching usage', '没有符合筛选条件的用量')
        }}
      </div>
    </ScrollRegion>
    <PaginationBar
      v-model:page="state.page"
      v-model:page-size="state.size"
      :total="total"
      :busy="sessionResource.busy.value"
    />
  </section>
</template>
<style scoped>
.analytics-detail-table {
  flex: 1;
  min-height: 0;
}
.analytics-detail-table > header {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 48px;
  padding: 8px 20px;
  flex: none;
  font-size: 12px;
}
.detail-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.detail-actions button {
  height: 32px;
  width: 32px;
}
.detail-actions .material-symbols-outlined {
  font-size: 18px;
}
.workspace-table {
  table-layout: fixed;
  width: 1280px;
  min-width: 100%;
  font-size: 12px;
}
.name-column {
  width: 240px;
}
.metric-column {
  width: 104px;
}
.workspace-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 32px;
  padding: 4px 8px;
  text-align: center;
  font-size: 11px;
}
.workspace-table th:first-child {
  text-align: left;
  padding-left: 20px;
}
.workspace-table th button {
  padding: 0;
  background: transparent;
  border: 0;
  color: var(--text-soft);
  cursor: pointer;
  font-size: inherit;
  white-space: nowrap;
}
.workspace-table th button.sorted {
  color: var(--accent);
}
.workspace-table th button:disabled {
  cursor: default;
}
.workspace-table td {
  height: 44px;
  text-align: center;
  padding: 4px 8px;
  font-family: var(--font-number);
  font-variant-numeric: tabular-nums;
}
.workspace-table td:first-child {
  text-align: left;
  font-family: var(--font-ui);
  padding-left: 16px;
}
.workspace-table .time-column {
  font-size: 10px;
  color: var(--text-soft);
}
.detail-row-name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.expand-row {
  border: 0;
  background: transparent;
  color: var(--text-soft);
  padding: 0;
  cursor: pointer;
  display: flex;
}
.expand-row span {
  font-size: 18px;
}
.row-name {
  background: transparent;
  border: 0;
  color: var(--text);
  padding: 0;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
  font-size: 12px;
  min-width: 0;
}
.row-mark {
  margin-right: 6px;
}
.row-name small {
  display: block;
  color: var(--text-soft);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.child td:first-child {
  padding-left: 44px;
}
.child .row-name {
  color: var(--text-muted);
}
</style>
