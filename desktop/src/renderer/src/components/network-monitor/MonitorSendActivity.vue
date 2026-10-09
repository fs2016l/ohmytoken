<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MonitorGroup } from '@shared/network-monitor'
import SegmentedControl from '../base/SegmentedControl.vue'
import { useI18n } from '../../i18n/useI18n'
import { monitorBytes, monitorEndpoint, monitorTime } from '../../utils/network-monitor-display'

const props = defineProps<{ groups: MonitorGroup[] }>()
const emit = defineEmits<{ inspect: [id: string] }>()
const { label } = useI18n()
const scope = ref('remote'),
  largeOnly = ref(false)
const options = computed(() => [
  { value: 'remote', label: label('Remote', '远端发送') },
  { value: 'local', label: label('Local / proxy', '本地通信') },
])
const rows = computed(() =>
  props.groups
    .flatMap((group) =>
      group.connections
        .filter(
          (connection) => connection.sent > 0 && connection.local === (scope.value === 'local'),
        )
        .filter((connection) => !largeOnly.value || connection.sent >= 10 * 1024 * 1024)
        .map((connection) => ({
          connection,
          group,
          member: group.members.find((row) => row.key === connection.processKey),
        })),
    )
    .sort(
      (a, b) =>
        b.connection.sent - a.connection.sent || b.connection.lastSeenAt - a.connection.lastSeenAt,
    ),
)
</script>
<template>
  <section class="monitor-groups monitor-send-activity">
    <header>
      <div>
        <h2>{{ label('Where data was sent', '发送明细') }}</h2>
        <p class="monitor-help">
          {{
            label(
              'Recent connections, sorted by cumulative bytes sent',
              '最近连接 · 按累计发送量排序',
            )
          }}
        </p>
      </div>
      <SegmentedControl
        v-model="scope"
        :options="options"
        :label="label('Traffic destination', '发送范围')"
      />
    </header>
    <div class="monitor-activity-description">
      <p class="monitor-help">
        {{
          scope === 'local'
            ? label(
                'Local proxy traffic is not proof that it reached a cloud server.',
                '发给本地代理的数据，不代表已确认发往云端。',
              )
            : label(
                'A connection can carry many requests. Its cumulative size is not a file size or proof of a code upload.',
                '一条连接可能承载多次请求；累计发送量不等于单个文件大小，也不能证明上传了代码。',
              )
        }}
      </p>
      <label class="monitor-checkbox">
        <input v-model="largeOnly" type="checkbox" />
        {{ label('Cumulative ≥ 10 MB', '累计 ≥ 10 MB') }}
      </label>
    </div>
    <div v-if="rows.length" class="monitor-table-wrap">
      <table class="monitor-table monitor-activity-table">
        <thead>
          <tr>
            <th>{{ label('Observed time', '观测时间段') }}</th>
            <th>{{ label('Application / sending process', '应用 / 发送进程') }}</th>
            <th>{{ label('Destination IP / port', '目标 IP / 端口') }}</th>
            <th>{{ label('Cumulative sent', '累计发送') }}</th>
            <th>
              <span class="sr-only">{{ label('Details', '详情') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows.slice(0, 20)" :key="row.connection.id">
            <td class="monitor-number">
              {{ monitorTime(row.connection.firstSeenAt) }}
              <small>— {{ monitorTime(row.connection.lastSeenAt) }}</small>
            </td>
            <td>
              <strong>{{ row.group.name }}</strong>
              <small>{{ row.member?.name || '—' }} · PID {{ row.member?.pid ?? '—' }}</small>
            </td>
            <td class="monitor-number">
              {{ monitorEndpoint(row.connection.remoteAddress, row.connection.remotePort) }}
              <small>
                {{ row.connection.protocol.toUpperCase() }} ·
                {{ label('Ownership unverified', '服务商归属未确认') }}
              </small>
            </td>
            <td class="monitor-number upload">
              {{ monitorBytes(row.connection.sent) }}
              <small v-if="row.connection.sent >= 10 * 1024 * 1024">
                {{ label('Cumulative ≥ 10 MB', '累计 ≥ 10 MB') }}
              </small>
            </td>
            <td>
              <button
                type="button"
                class="workspace-button workspace-button--icon"
                :aria-label="
                  label(
                    'Inspect connection for ' + row.group.name,
                    '查看 ' + row.group.name + ' 的连接',
                  )
                "
                @click="emit('inspect', row.group.id)"
              >
                ↗
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="monitor-activity-empty monitor-help">
      {{
        largeOnly
          ? label(
              'No retained connection meets this threshold. This does not establish that no files were sent.',
              '当前保留的连接中没有达到阈值的记录，不能据此判断没有发送文件。',
            )
          : label('No sending activity observed in this scope yet.', '此范围内尚未观测到发送活动。')
      }}
    </p>
    <p v-if="rows.length > 20" class="monitor-activity-empty monitor-help">
      {{
        label(
          'Showing the 20 largest retained connections. Open application details for more.',
          '显示保留记录中发送量最大的 20 条，更多连接可在应用详情查看。',
        )
      }}
    </p>
  </section>
</template>
