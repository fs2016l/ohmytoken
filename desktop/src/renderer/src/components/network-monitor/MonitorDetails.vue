<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MonitorGroup } from '@shared/network-monitor'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import SegmentedControl from '../base/SegmentedControl.vue'
import { useI18n } from '../../i18n/useI18n'
import {
  monitorBytes,
  monitorEndpoint,
  monitorHasTraffic,
  monitorTime,
} from '../../utils/network-monitor-display'
const props = defineProps<{ group: MonitorGroup | null }>()
const emit = defineEmits<{ close: [] }>()
const { label } = useI18n(),
  view = ref('connections'),
  showIdle = ref(false)
const members = computed(() =>
  (props.group?.members ?? [])
    .filter((member) => showIdle.value || monitorHasTraffic(member))
    .toSorted((a, b) => b.sent + b.localSent - a.sent - a.localSent || b.received - a.received),
)
const connections = computed(() =>
  (props.group?.connections ?? []).toSorted(
    (a, b) => b.sent - a.sent || b.lastSeenAt - a.lastSeenAt,
  ),
)
const options = computed(() => [
  { value: 'processes', label: label('Processes', '关联进程') },
  { value: 'connections', label: label('Connections', '连接去向') },
])
</script>
<template>
  <WorkspaceDialog
    :open="!!group"
    :title="group?.name || label('Application details', '应用详情')"
    drawer
    class="monitor-detail-dialog"
    @close="emit('close')"
  >
    <template v-if="group">
      <div class="monitor-detail-totals">
        <div>
          <span>{{ label('Uploaded', '上传量') }}</span>
          <strong>{{ monitorBytes(group.sent) }}</strong>
        </div>
        <div>
          <span>{{ label('Downloaded', '下载量') }}</span>
          <strong>{{ monitorBytes(group.received) }}</strong>
        </div>
      </div>
      <p class="monitor-help">
        {{
          label(
            'Includes tools launched by this application. These bytes do not establish that source code or a file was uploaded.',
            '包含该应用启动的关联工具。这里的字节数不能证明上传了源代码或某个文件。',
          )
        }}
      </p>
      <SegmentedControl
        v-model="view"
        :options="options"
        :label="label('Detail type', '详情类别')"
      />
      <div v-if="view === 'processes'" class="monitor-members">
        <label class="monitor-checkbox">
          <input v-model="showIdle" type="checkbox" />
          {{ label('Include processes with no observed traffic', '显示没有流量的关联进程') }}
        </label>
        <p class="monitor-help">
          {{
            label(
              'Sorted by upload. A process-tree relationship does not mean the process is transmitting.',
              '按上传量排序；属于进程树不代表正在联网或上传。',
            )
          }}
        </p>
        <article
          v-for="member in members"
          :key="member.key"
          :class="{ 'monitor-child': member.reason !== 'application' }"
        >
          <div>
            <strong>{{ member.name }}</strong>
            <small>
              {{
                member.reason === 'application'
                  ? label('Root', '根进程')
                  : member.reason === 'responsible-app'
                    ? label('Acting for app', '系统代发进程')
                    : label('Child / launched tool', '子进程 / 关联工具')
              }}
              · PID {{ member.pid }}
              <template v-if="member.parentPid">
                · {{ label('Parent', '父进程') }} {{ member.parentPid }}
              </template>
            </small>
          </div>
          <span class="monitor-path">{{ member.entryPoint || member.path }}</span>
          <div class="monitor-help">
            <span>↑ {{ monitorBytes(member.sent) }} · ↓ {{ monitorBytes(member.received) }}</span>
            <span>
              {{ member.exitedAt ? label('Exited', '已退出') : label('Running', '运行中') }}
            </span>
          </div>
          <p v-if="member.localSent || member.localReceived" class="monitor-help">
            {{ label('Local traffic', '本地通信') }} · ↑ {{ monitorBytes(member.localSent) }} · ↓
            {{ monitorBytes(member.localReceived) }}
          </p>
        </article>
        <p v-if="!members.length" class="monitor-help">
          {{
            label(
              'No process with observed traffic yet. Enable the option above to see the process tree.',
              '尚未观测到有流量的进程，可勾选上方选项查看完整进程树。',
            )
          }}
        </p>
      </div>
      <div v-else class="monitor-connections">
        <p class="monitor-help">
          {{
            label(
              'Retained connections sorted by upload. Multiple requests can share a connection; IP ownership is unverified.',
              '显示保留的连接，按累计上传量排序。一条连接可能包含多次请求，服务商归属尚未确认。',
            )
          }}
        </p>
        <article v-for="connection in connections" :key="connection.id">
          <div>
            <strong>{{ monitorEndpoint(connection.remoteAddress, connection.remotePort) }}</strong>
            <small>{{ connection.protocol.toUpperCase() }}</small>
          </div>
          <p class="monitor-help">
            {{ group.members.find((member) => member.key === connection.processKey)?.name || '—' }}
            · PID
            {{ group.members.find((member) => member.key === connection.processKey)?.pid ?? '—' }}
          </p>
          <p class="monitor-help">
            {{ label('Observed', '观测时间') }} {{ monitorTime(connection.firstSeenAt) }} —
            {{ monitorTime(connection.lastSeenAt) }}
          </p>
          <p class="monitor-help">
            {{ label('Local endpoint', '本机端点') }}
            {{ monitorEndpoint(connection.localAddress, connection.localPort) }}
          </p>
          <div class="monitor-help">
            <span>
              ↑ {{ monitorBytes(connection.sent) }} · ↓ {{ monitorBytes(connection.received) }}
            </span>
            <span>
              {{
                connection.local
                  ? label('Local proxy / loopback', '本地代理 / 回环')
                  : label('Remote', '远端')
              }}
            </span>
          </div>
        </article>
        <p v-if="!group.connections.length" class="monitor-help">
          {{ label('No connection observed in this run.', '本次尚未观测到连接。') }}
        </p>
      </div>
      <div v-if="group.localSent || group.localReceived" class="monitor-note">
        <strong>
          {{ label('Local traffic', '本地通信') }} · ↑ {{ monitorBytes(group.localSent) }} · ↓
          {{ monitorBytes(group.localReceived) }}
        </strong>
        <p>
          {{
            label(
              'Traffic to a local proxy is separate from remote totals. A shared proxy’s outbound traffic cannot be attributed to one Agent reliably.',
              '与本地代理的通信单独统计，不并入远端总量；共用代理的外发流量无法可靠分配给某一个 Agent。',
            )
          }}
        </p>
      </div>
    </template>
  </WorkspaceDialog>
</template>
