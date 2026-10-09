<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { UsageApiRecordFilter, TokenUsageApiCall } from '@shared/models'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import PaginationBar from '../base/PaginationBar.vue'
import CopyText from '../base/CopyText.vue'
import DropdownChevron from '../base/DropdownChevron.vue'
import ApiCallCost from './ApiCallCost.vue'
import { useI18n } from '../../i18n/useI18n'
import { usePageResource } from '../../composables/usePageResource'
import { useScanStatus } from '../../composables/useScanStatus'
import { displayTimestamp } from '../../utils/date-range'
import { formatNumber, combinedCache } from '../../utils/number-format'
const props = defineProps<{ filter: UsageApiRecordFilter; name: string }>()
const emit = defineEmits<{ close: [] }>()
const { label } = useI18n()
const scan = useScanStatus()
const page = ref(1),
  size = ref(10),
  expanded = ref<string[]>([])
const parameters = computed(() => ({ ...props.filter, page: page.value, pageSize: size.value }))
const key = computed(() => JSON.stringify(parameters.value))
const resource = usePageResource(
  () => [key.value, scan.revision.value],
  async () => {
    const requested = key.value
    const result = await window.api.getUsageApiRecords(parameters.value)
    return { key: requested, result }
  },
  null as { key: string; result: Awaited<ReturnType<Window['api']['getUsageApiRecords']>> } | null,
)
const result = computed(() =>
  resource.data.value?.key === key.value ? resource.data.value.result : null,
)
watch(
  () => props.filter,
  () => {
    page.value = 1
    expanded.value = []
  },
  { deep: true },
)
watch(
  () => resource.data.value,
  (data) => {
    if (data?.key === key.value && page.value !== data.result.page) page.value = data.result.page
  },
)
function rowKey(row: TokenUsageApiCall): string {
  return JSON.stringify([row.agent, row.apiCallId, row.sessionId, row.date, row.model])
}
function toggle(row: TokenUsageApiCall): void {
  const id = rowKey(row)
  expanded.value = expanded.value.includes(id)
    ? expanded.value.filter((value) => value !== id)
    : [...expanded.value, id]
}
</script>
<template>
  <WorkspaceDialog
    open
    wide
    class="api-records-dialog"
    :title="label('API call details', 'API 调用明细')"
    @close="emit('close')"
  >
    <p class="records-context">{{ name }}</p>
    <p class="records-caption">
      {{
        label(
          'Source call records within the selected dates and filters.',
          '当前日期与筛选范围内的来源调用记录。',
        )
      }}
    </p>
    <div v-if="resource.error.value" class="workspace-error" role="alert">
      {{ label('Could not load call records.', '调用记录读取失败。') }}
      <button type="button" class="workspace-link" @click="resource.refresh">
        {{ label('Retry', '重试') }}
      </button>
    </div>
    <div class="records-table" :aria-busy="resource.busy.value">
      <table v-if="result?.items.length">
        <thead>
          <tr>
            <th>{{ label('Time / model', '时间 / 模型') }}</th>
            <th>{{ label('Tokens', 'Token 总量') }}</th>
            <th>{{ label('Input', '输入') }}</th>
            <th>{{ label('Output', '输出') }}</th>
            <th>{{ label('Cache', '缓存') }}</th>
            <th>{{ label('Reasoning', '推理') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in result.items" :key="rowKey(row)">
            <tr :class="{ expanded: expanded.includes(rowKey(row)) }">
              <td>
                <button
                  type="button"
                  class="record-summary"
                  :aria-expanded="expanded.includes(rowKey(row))"
                  @click="toggle(row)"
                >
                  <DropdownChevron :open="expanded.includes(rowKey(row))" direction="right" />
                  <span>
                    <strong>{{ displayTimestamp(row.timestamp || row.date) }}</strong>
                    <small :title="row.model">{{ row.model || '—' }}</small>
                  </span>
                </button>
              </td>
              <td>{{ formatNumber(row.totalTokens) }}</td>
              <td>{{ formatNumber(row.inputTokens) }}</td>
              <td>{{ formatNumber(row.outputTokens) }}</td>
              <td>{{ formatNumber(combinedCache(row)) }}</td>
              <td>{{ formatNumber(row.reasoningTokens) }}</td>
            </tr>
            <tr v-if="expanded.includes(rowKey(row))" class="record-expanded">
              <td colspan="6">
                <dl>
                  <dt>{{ label('Call ID', '调用 ID') }}</dt>
                  <dd>
                    <CopyText
                      :value="row.apiCallId"
                      :label="label('Copy call ID', '复制调用 ID')"
                    />
                  </dd>
                  <dt>{{ label('Session ID', '会话 ID') }}</dt>
                  <dd>
                    <CopyText
                      :value="row.sessionId"
                      :label="label('Copy session ID', '复制会话 ID')"
                    />
                  </dd>
                  <template v-if="row.subAgentName">
                    <dt>{{ label('Child agent', '子 Agent') }}</dt>
                    <dd>{{ row.subAgentName }}</dd>
                  </template>
                  <template v-if="row.projectPath">
                    <dt>{{ label('Directory', '工作目录') }}</dt>
                    <dd>{{ row.projectPath }}</dd>
                  </template>
                  <dt>{{ label('Source time', '来源时间') }}</dt>
                  <dd>{{ row.rawTimestamp || '—' }}</dd>
                  <template v-if="row.turn">
                    <dt>{{ label('Request', '请求') }}</dt>
                    <dd>
                      {{
                        row.turn.userInitiated
                          ? label('User initiated', '用户发起')
                          : label('Agent activity', 'Agent 活动')
                      }}
                      · {{ row.turn.id }}
                    </dd>
                  </template>
                </dl>
                <ApiCallCost v-if="row.costAssessment" :assessment="row.costAssessment" />
                <p v-else class="records-caption">
                  {{ label('Cost details unavailable', '费用明细暂不可用') }}
                </p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <div v-else class="workspace-empty">
        {{
          resource.busy.value
            ? label('Loading call records…', '正在读取调用记录…')
            : label(
                'No readable call records in this range. Some sources only provide usage totals.',
                '当前范围没有可读取的逐条调用记录，部分来源仅提供用量汇总。',
              )
        }}
      </div>
    </div>
    <PaginationBar
      v-model:page="page"
      v-model:page-size="size"
      :total="result?.total || 0"
      :busy="resource.busy.value"
    />
  </WorkspaceDialog>
</template>
<style scoped>
.api-records-dialog {
  --dialog-width: 960px;
}
.records-context {
  margin: 0;
  font-size: 15px;
  overflow-wrap: anywhere;
}
.records-caption {
  font-size: 12px;
  color: var(--text-muted);
  margin: 8px 0 20px;
}
.records-table {
  overflow: auto;
  min-height: 200px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
th,
td {
  text-align: right;
  padding: 12px 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
th {
  color: var(--text-muted);
  font-weight: 400;
}
th:first-child,
td:first-child {
  text-align: left;
}
.record-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  color: var(--text);
  background: transparent;
  border: 0;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.record-summary > .material-symbols-outlined {
  color: var(--text-muted);
  font-size: 18px;
}
.record-summary strong {
  font-weight: 400;
}
.record-summary small {
  display: block;
  max-width: 240px;
  margin-top: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-muted);
}
.expanded,
.record-expanded {
  background: var(--surface-low);
}
.record-expanded td {
  padding: 16px;
  white-space: normal;
}
dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 20px;
  margin: 0;
  line-height: 1.5;
}
dt {
  color: var(--text-muted);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
