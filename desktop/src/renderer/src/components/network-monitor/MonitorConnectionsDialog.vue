<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { MonitorGroup } from '@shared/network-monitor'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import SegmentedControl from '../base/SegmentedControl.vue'
import SelectControl from '../base/SelectControl.vue'
import { useI18n } from '../../i18n/useI18n'
import { monitorBytes, monitorEndpoint, monitorTime } from '../../utils/network-monitor-display'
const props = defineProps<{
  open: boolean
  groups: MonitorGroup[]
  focusConnections?: string[]
  running: boolean
}>()
const emit = defineEmits<{ close: [] }>()
const { label } = useI18n()
const query = ref(''),
  scope = ref('remote'),
  activity = ref('all'),
  application = ref(''),
  sort = ref('sent'),
  descending = ref(true),
  page = ref(0)
const paused = ref(false)
const frozen = shallowRef<MonitorGroup[]>([])
const source = computed(() => (!props.open ? [] : paused.value ? frozen.value : props.groups))
const scopes = computed(() => [
  { value: 'remote', label: label('Upload / download', '上传 / 下载') },
  { value: 'local', label: label('Local / proxy', '本机通信 / 代理') },
])
const activityOptions = computed(() => [
  { value: 'all', label: label('All', '全部') },
  { value: 'active', label: label('Transferring', '正在传输') },
  { value: 'idle', label: label('No current traffic', '暂无流量') },
])
const applications = computed(() => [
  { value: '', label: label('All Agents', '全部 Agent') },
  ...source.value.map((group) => ({
    value: group.id,
    label: `${group.name} · PID ${group.members.find((row) => row.key === group.rootKey)?.pid ?? '—'}`,
  })),
])
const columns = computed(
  () =>
    [
      { key: 'sent', label: label('Uploaded', '上传量') },
      { key: 'received', label: label('Downloaded', '下载量') },
      { key: 'sendRate', label: label('Upload speed', '上传速度') },
      { key: 'receiveRate', label: label('Download speed', '下载速度') },
    ] as const,
)
const relatedOnly = ref(false)
const tableViewport = ref<HTMLElement | null>(null)
const rows = computed(() => {
  const search = query.value.trim().toLocaleLowerCase()
  return source.value
    .flatMap((group) => {
      const members = new Map(group.members.map((member) => [member.key, member]))
      return group.connections.map((connection) => ({
        group,
        connection,
        member: members.get(connection.processKey),
      }))
    })
    .filter(
      ({ group, connection, member }) =>
        (!application.value || group.id === application.value) &&
        connection.local === (scope.value === 'local') &&
        (!relatedOnly.value || props.focusConnections?.includes(connection.id)) &&
        (activity.value === 'all' ||
          (activity.value === 'active') === connection.sendRate + connection.receiveRate > 0) &&
        (!search ||
          `${group.name} ${member?.name} ${member?.pid} ${member?.path} ${monitorEndpoint(connection.remoteAddress, connection.remotePort)} ${connection.protocol}`
            .toLocaleLowerCase()
            .includes(search)),
    )
    .sort((a, b) => {
      const key = sort.value as 'sent' | 'received' | 'sendRate' | 'receiveRate'
      return (
        (descending.value ? -1 : 1) * (a.connection[key] - b.connection[key]) ||
        a.connection.id.localeCompare(b.connection.id)
      )
    })
})
const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / 50)))
const visible = computed(() =>
  rows.value.slice(
    Math.min(page.value, pageCount.value - 1) * 50,
    (Math.min(page.value, pageCount.value - 1) + 1) * 50,
  ),
)
watch([query, scope, activity, application, relatedOnly], () => {
  page.value = 0
  if (tableViewport.value) tableViewport.value.scrollTop = 0
})
watch(page, () => {
  if (tableViewport.value) tableViewport.value.scrollTop = 0
})
watch(
  () => props.open,
  (open) => {
    paused.value = false
    frozen.value = []
    page.value = 0
    if (open) {
      query.value = ''
      scope.value = 'remote'
      application.value = ''
      activity.value = 'all'
      relatedOnly.value = !!props.focusConnections?.length
    }
  },
)
function pause(): void {
  if (!paused.value)
    frozen.value = props.groups.map((group) => ({
      ...group,
      members: group.members.map((row) => ({ ...row })),
      connections: group.connections.map((row) => ({ ...row })),
    }))
  else frozen.value = []
  paused.value = !paused.value
}
function order(key: string): void {
  if (sort.value === key) descending.value = !descending.value
  else {
    sort.value = key
    descending.value = true
  }
}
</script>
<template>
  <WorkspaceDialog
    :open="open"
    :title="label('Real-time connections', '实时连接')"
    wide
    class="monitor-live-dialog"
    @close="emit('close')"
  >
    <div class="monitor-live-toolbar">
      <SegmentedControl
        v-model="scope"
        :options="scopes"
        :label="label('Connection scope', '连接范围')"
      />
      <span class="monitor-help">
        {{
          paused
            ? label('Table paused; monitoring continues', '表格已暂停，后台继续监测')
            : running
              ? label('Updates every second', '每秒更新')
              : label('Retained readings', '已停止，保留读数')
        }}
      </span>
      <button class="workspace-button" type="button" @click="pause">
        {{ paused ? label('Resume updates', '恢复刷新') : label('Pause updates', '暂停刷新') }}
      </button>
    </div>
    <div class="monitor-live-toolbar">
      <SegmentedControl
        v-model="activity"
        :options="activityOptions"
        :label="label('Traffic activity', '传输状态')"
      />
      <input
        v-model="query"
        class="workspace-input monitor-live-search"
        type="search"
        :aria-label="label('Search connections', '搜索连接')"
        :placeholder="label('IP, port, Agent or process', '搜索 IP、端口、Agent 或进程')"
      />
      <SelectControl
        v-model="application"
        class="monitor-live-app-filter"
        :options="applications"
        :label="label('Filter Agent', '筛选 Agent')"
      />
    </div>
    <label v-if="focusConnections?.length" class="monitor-checkbox">
      <input v-model="relatedOnly" type="checkbox" />
      {{ label('Only connections associated with this event', '仅查看此事件关联的连接') }}
    </label>
    <div ref="tableViewport" class="monitor-live-table-wrap">
      <table class="monitor-table monitor-live-table">
        <colgroup>
          <col class="monitor-live-destination-column" />
          <col class="monitor-live-process-column" />
          <col span="2" class="monitor-live-total-column" />
          <col span="2" class="monitor-live-rate-column" />
          <col class="monitor-live-time-column" />
        </colgroup>
        <thead>
          <tr>
            <th>{{ label('Destination', '目标地址') }}</th>
            <th>{{ label('Agent / process', 'Agent / 进程') }}</th>
            <th
              v-for="column in columns"
              :key="column.key"
              :aria-sort="sort === column.key ? (descending ? 'descending' : 'ascending') : 'none'"
            >
              <button type="button" @click="order(column.key)">
                {{ column.label }}
                <span aria-hidden="true">
                  {{ sort === column.key ? (descending ? '↓' : '↑') : '↕' }}
                </span>
              </button>
            </th>
            <th>{{ label('Last activity', '最近活动') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in visible"
            :key="row.connection.id"
            :class="{ 'monitor-related-row': focusConnections?.includes(row.connection.id) }"
          >
            <td class="monitor-number">
              <span
                class="monitor-live-cell-text"
                :title="monitorEndpoint(row.connection.remoteAddress, row.connection.remotePort)"
              >
                {{ monitorEndpoint(row.connection.remoteAddress, row.connection.remotePort) }}
              </span>
              <small>
                {{ row.connection.protocol.toUpperCase() }} ·
                {{ label('IP observed', '已观测 IP') }}
              </small>
            </td>
            <td>
              <strong class="monitor-live-cell-text" :title="row.group.name">
                {{ row.group.name }}
              </strong>
              <small :title="row.member?.path">
                {{ row.member?.name || '—' }} · {{ row.member?.pid ?? '—' }}
              </small>
            </td>
            <td class="monitor-number upload">{{ monitorBytes(row.connection.sent) }}</td>
            <td class="monitor-number">{{ monitorBytes(row.connection.received) }}</td>
            <td class="monitor-number upload">{{ monitorBytes(row.connection.sendRate) }}/s</td>
            <td class="monitor-number download">
              {{ monitorBytes(row.connection.receiveRate) }}/s
            </td>
            <td class="monitor-number">
              {{ monitorTime(row.connection.lastSeenAt) }}
              <small>
                {{ label('First observed', '首次观测') }}
                {{ monitorTime(row.connection.firstSeenAt) }}
              </small>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length" class="monitor-empty monitor-help">
        {{
          relatedOnly
            ? label(
                'Associated connections are no longer in the retained list. Their evidence remains in the event.',
                '关联连接已不在保留列表中，可在事件详情查看当时的地址和流量。',
              )
            : label('No matching connections observed.', '尚未观测到匹配的连接。')
        }}
      </p>
    </div>
    <div class="monitor-live-toolbar monitor-help">
      <span>
        {{ rows.length }} {{ label('retained connections', '条保留连接') }} ·
        {{ label('Current run only', '仅本次运行') }}
      </span>
      <div class="monitor-inline">
        <button class="workspace-button" type="button" :disabled="page <= 0" @click="page--">
          {{ label('Previous', '上一页') }}
        </button>
        <span>{{ Math.min(page + 1, pageCount) }} / {{ pageCount }}</span>
        <button
          class="workspace-button"
          type="button"
          :disabled="page + 1 >= pageCount"
          @click="page++"
        >
          {{ label('Next', '下一页') }}
        </button>
      </div>
    </div>
    <p class="monitor-help monitor-live-footnote">
      {{
        scope === 'local'
          ? label(
              'Local proxy traffic does not establish cloud delivery.',
              '本机代理通信不代表已确认上传到云端。',
            )
          : label(
              'Includes LAN traffic. IP addresses do not establish service ownership. No traffic now does not mean the connection is closed.',
              '含局域网通信。IP 不能证明服务商归属；暂无流量不代表连接已关闭。',
            )
      }}
    </p>
  </WorkspaceDialog>
</template>
