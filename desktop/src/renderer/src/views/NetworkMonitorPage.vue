<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MonitorIssue, MonitorState } from '@shared/network-monitor'
import PageSurface from '../components/base/PageSurface.vue'
import MonitorManageDialog from '../components/network-monitor/MonitorManageDialog.vue'
import MonitorTrend from '../components/network-monitor/MonitorTrend.vue'
import MonitorAddDialog from '../components/network-monitor/MonitorAddDialog.vue'
import MonitorDetails from '../components/network-monitor/MonitorDetails.vue'
import MonitorConnectionsDialog from '../components/network-monitor/MonitorConnectionsDialog.vue'
import MonitorFileEvents from '../components/network-monitor/MonitorFileEvents.vue'
import { useNetworkMonitor } from '../composables/useNetworkMonitor'
import { useI18n } from '../i18n/useI18n'
import { monitorBytes, monitorDuration } from '../utils/network-monitor-display'
import '../styles/network-monitor.css'
const { label } = useI18n()
const { snapshot, pending, error, apply, request } = useNetworkMonitor()
const adding = ref(false),
  selected = ref(''),
  managing = ref(false),
  connectionsOpen = ref(false)
const connectionFocus = ref<string[]>([])
const state = computed(() => snapshot.value?.state ?? 'off')
const active = computed(() => state.value === 'running' || state.value === 'starting')
const hasData = computed(
  () =>
    !!snapshot.value &&
    ['running', 'stopped', 'error'].includes(state.value) &&
    (state.value !== 'error' || snapshot.value.groups.length > 0),
)
const detail = computed(
  () => snapshot.value?.groups.find((group) => group.id === selected.value) ?? null,
)
const elapsed = computed(() =>
  snapshot.value?.startedAt
    ? monitorDuration(
        (snapshot.value.stoppedAt ?? snapshot.value.updatedAt) - snapshot.value.startedAt,
      )
    : '00:00:00',
)
const states: Record<MonitorState, [string, string]> = {
  off: ['Not monitoring', '未开启'],
  starting: ['Starting…', '正在启动…'],
  running: ['Monitoring', '监测中'],
  stopped: ['Stopped', '已停止'],
  error: ['Needs attention', '需要处理'],
}
const issues: Record<MonitorIssue, [string, string]> = {
  'permission-required': [
    'Administrator permission is needed. Click Start to authorize the helper.',
    '需要系统权限，点击“开始监测”可授权采集程序。',
  ],
  'permission-denied': [
    'System authorization was canceled. You can try again when ready.',
    '系统授权已取消，可稍后重新开始。',
  ],
  'collector-missing': [
    'The network collector is missing. Install a build that includes it.',
    '当前版本未包含网络采集程序，请安装包含该组件的版本。',
  ],
  'extension-required': [
    'macOS needs the signed network extension. Enable it in System Settings after installation.',
    'macOS 需要已签名的网络扩展，安装后需在系统设置中允许。',
  ],
  'extension-approval-required': [
    'Allow the OhMyToken network extension in System Settings to continue.',
    '请在系统设置中允许 OhMyToken 网络扩展，授权后会继续启动。',
  ],
  'collector-failed': [
    'The collector could not keep running. Previous readings are retained; restart to begin a new run.',
    '采集程序未能继续运行，已有读数已保留；重新开始会建立新的统计。',
  ],
  'unsupported-platform': ['This platform is not supported.', '当前系统暂不支持。'],
  'events-lost': [
    'Some system events were lost. Totals may be lower than actual traffic.',
    '部分系统事件丢失，当前总量可能低于实际流量。',
  ],
  'identity-unavailable': [
    'Some observed traffic could not be attributed reliably. Confirmed totals are still counted; unresolved bytes are excluded.',
    '部分已观测流量无法可靠归属；已确认的流量仍正常统计，未确认部分不并入总量。',
  ],
  'capacity-reached': [
    'The collector reached its safety limit. This run is incomplete.',
    '达到采集容量上限，本次统计不完整。',
  ],
  'new-flows-only': [
    'macOS reports new connections after monitoring starts. Restart an already-running Agent to include its connections.',
    'macOS 从开启监测后的新连接开始统计。对于已运行的 Agent，重启它后可纳入后续连接。',
  ],
}
const localSent = computed(
  () => snapshot.value?.groups.reduce((sum, group) => sum + group.localSent, 0) ?? 0,
)
const totals = computed(() => [
  {
    label: label('Total uploaded', '总计上传'),
    note: label('Includes LAN traffic; not a file size', '含局域网通信；不等于文件大小'),
    value: monitorBytes(hasData.value ? snapshot.value?.sent : null),
    icon: '↑',
    primary: true,
  },
  {
    label: label('Total downloaded', '总计下载'),
    note: label('Local loopback counted separately', '本机回环通信单独统计'),
    value: monitorBytes(hasData.value ? snapshot.value?.received : null),
    icon: '↓',
  },
  {
    label: label('Upload / download speed', '上传 / 下载速度'),
    note: label('Total for monitored process groups', '受监测进程组的合计速率'),
    rates: [
      {
        direction: 'upload',
        label: label('Upload speed', '上传速度'),
        value: hasData.value ? `${monitorBytes(snapshot.value?.sendRate)}/s` : '—',
        icon: '↑',
      },
      {
        direction: 'download',
        label: label('Download speed', '下载速度'),
        value: hasData.value ? `${monitorBytes(snapshot.value?.receiveRate)}/s` : '—',
        icon: '↓',
      },
    ],
    icon: '↕',
  },
  {
    label: label('File association events', '文件关联事件'),
    note: label('Time correlation, not confirmed uploads', '依据时间关联，尚未确认文件已上传'),
    value:
      snapshot.value?.fileActivity.totalEvents ||
      ['running', 'stopped'].includes(snapshot.value?.fileActivity.state ?? '')
        ? String(snapshot.value?.fileActivity.totalEvents ?? 0)
        : '—',
    icon: '△',
  },
])
function toggle(): void {
  if (active.value) void request('stop', () => window.api.networkMonitorStop())
  else void request('start', () => window.api.networkMonitorStart())
}
function setAutoStart(event: Event): void {
  void request('setting', () =>
    window.api.networkMonitorAutoStart((event.target as HTMLInputElement).checked),
  )
}
function setFileAssociation(event: Event): void {
  void request('files', () =>
    window.api.networkMonitorFileAssociation((event.target as HTMLInputElement).checked),
  )
}
function showConnections(ids: string[] = []): void {
  connectionFocus.value = ids
  connectionsOpen.value = true
}
function setRule(id: string, enabled: boolean): void {
  void request('rule', () => window.api.networkMonitorRule(id, { enabled }))
}
function remove(id: string): void {
  void request('rule', () => window.api.networkMonitorRemove(id))
}
</script>
<template>
  <PageSurface page-key="network-monitor" class="network-monitor-page">
    <div class="workspace-heading">
      <div>
        <div class="monitor-title-row">
          <h1>{{ label('Traffic monitoring', '流量监控') }}</h1>
          <span class="monitor-experimental-note" role="note">
            {{
              label(
                'This feature is experimental and may be unstable.',
                '此功能处于试验阶段，尚不稳定。',
              )
            }}
          </span>
        </div>
        <p>
          {{
            label(
              'Follow upload destinations and possible links to file access.',
              '查看上传去向，发现文件访问与上传流量的关联。',
            )
          }}
        </p>
      </div>
      <div class="monitor-inline">
        <button
          type="button"
          class="workspace-button workspace-button--primary"
          @click="adding = true"
        >
          ＋ {{ label('Add application', '添加应用') }}
        </button>
        <button
          type="button"
          class="workspace-button"
          :disabled="pending === 'stop' || (!snapshot && !!pending)"
          @click="toggle"
        >
          {{
            active ? label('Stop monitoring', '停止监测') : label('Start monitoring', '开始监测')
          }}
        </button>
      </div>
    </div>
    <div class="monitor-status-bar">
      <div class="monitor-inline">
        <span class="monitor-status" :class="state">
          <i />
          {{ label(...states[state]) }}
        </span>
        <span>{{ label('This run', '本次运行') }} · {{ elapsed }}</span>
        <span v-if="snapshot && !snapshot.complete" class="monitor-incomplete">
          {{ label('Incomplete traffic data', '流量数据不完整') }}
        </span>
        <label class="monitor-file-toggle">
          <span class="monitor-switch">
            <input
              type="checkbox"
              role="switch"
              :checked="snapshot?.settings.fileAssociation || false"
              :disabled="pending === 'files'"
              @change="setFileAssociation"
            />
            <span />
          </span>
          {{ label('File association', '文件关联') }}
        </label>
      </div>
      <div class="monitor-inline">
        <span>
          {{
            label(
              'Monitoring records are not retained after restarting the app',
              '重启软件后不保留观测记录',
            )
          }}
        </span>
        <label
          class="monitor-checkbox"
          :title="
            label(
              'Starts when system permission is already available.',
              '已有系统权限时自动开始；缺少权限时等待手动开启。',
            )
          "
        >
          <input
            type="checkbox"
            :checked="snapshot?.settings.autoStart || false"
            :disabled="pending === 'setting'"
            @change="setAutoStart"
          />
          {{ label('Start with the app', '随软件启动监测') }}
        </label>
      </div>
    </div>
    <div v-if="error" class="monitor-note monitor-error" role="alert">
      {{ label('The action failed. Please retry.', '操作失败，请重试。') }}
    </div>
    <div v-if="snapshot?.issues.length" class="monitor-note" role="status">
      <p v-for="issue in snapshot.issues" :key="issue">{{ label(...issues[issue]) }}</p>
      <p v-if="snapshot.unknownEvents">
        {{ label('Unattributed traffic records', '未归属流量记录') }}：{{
          snapshot.unknownEvents
        }}
        · {{ label('Upload', '上传') }} {{ monitorBytes(snapshot.unattributedSent) }} ·
        {{ label('Download', '下载') }} {{ monitorBytes(snapshot.unattributedReceived) }} ·
        {{ label('Local', '本机通信') }} ↑ {{ monitorBytes(snapshot.unattributedLocalSent) }} ↓
        {{ monitorBytes(snapshot.unattributedLocalReceived) }}
      </p>
    </div>
    <div class="monitor-metrics">
      <article v-for="metric in totals" :key="metric.label" :class="{ primary: metric.primary }">
        <span>{{ metric.label }}</span>
        <div v-if="metric.rates" class="monitor-metric-rates">
          <div
            v-for="rate in metric.rates"
            :key="rate.direction"
            class="monitor-metric-rate"
            :class="rate.direction"
            role="group"
            :aria-label="rate.label"
            :title="rate.label"
          >
            <span aria-hidden="true">{{ rate.icon }}</span>
            <strong>{{ rate.value }}</strong>
          </div>
        </div>
        <strong v-else>{{ metric.value }}</strong>
        <small>{{ metric.note }}</small>
        <i aria-hidden="true">{{ metric.icon }}</i>
      </article>
    </div>
    <div class="monitor-overview">
      <section class="monitor-chart-card">
        <header>
          <h2>{{ label('Live traffic', '实时流量') }}</h2>
          <div class="monitor-inline monitor-help">
            <span class="monitor-legend upload">{{ label('Upload', '上传') }}</span>
            <span class="monitor-legend download">{{ label('Download', '下载') }}</span>
            <button class="workspace-button" type="button" @click="showConnections()">
              {{ label('View live connections', '查看实时连接') }} ↗
            </button>
          </div>
        </header>
        <div class="monitor-chart">
          <MonitorTrend
            v-if="snapshot?.trend.length"
            :points="snapshot.trend"
            :events="snapshot.fileActivity.events"
          />
          <div v-else class="monitor-chart-empty">
            <span class="monitor-empty-line" />
            <p>
              {{
                active
                  ? label('Waiting for the first sample…', '等待首次采样…')
                  : label('Start monitoring to see live traffic', '开始监测后显示实时流量')
              }}
            </p>
          </div>
        </div>
        <p class="monitor-chart-caption">
          {{ label('Last 60 seconds · upload and download speeds', '最近 60 秒 · 上传与下载速度') }}
        </p>
      </section>
      <section class="monitor-groups monitor-compact-groups">
        <header>
          <h2>{{ label('Monitored applications', '监测应用') }}</h2>
          <button class="monitor-text-button" type="button" @click="managing = true">
            {{ label('Manage', '管理应用') }} ↗
          </button>
        </header>
        <div v-if="snapshot?.groups.length" class="monitor-table-wrap">
          <table class="monitor-table">
            <thead>
              <tr>
                <th>{{ label('Application', '应用') }}</th>
                <th>{{ label('Uploaded', '上传量') }}</th>
                <th>{{ label('Running processes', '运行进程') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="group in snapshot.groups" :key="group.id">
                <td>
                  <button
                    type="button"
                    class="monitor-app-button"
                    :aria-label="label('View ' + group.name, '查看 ' + group.name)"
                    @click="selected = group.id"
                  >
                    <span class="monitor-app-mark">{{ group.name.slice(0, 1) }}</span>
                    <span>
                      <strong>{{ group.name }}</strong>
                      <small>
                        PID
                        {{
                          group.members.find((member) => member.key === group.rootKey)?.pid ?? '—'
                        }}
                        ·
                        {{
                          group.source === 'custom'
                            ? label('Custom', '手动添加')
                            : label('Recognized', '自动识别')
                        }}
                        <template v-if="!group.enabled">· {{ label('Paused', '已暂停') }}</template>
                      </small>
                    </span>
                  </button>
                </td>
                <td class="monitor-number upload">
                  {{ monitorBytes(group.sent) }}
                  <small v-if="group.localSent">
                    + {{ monitorBytes(group.localSent) }} {{ label('local', '本机') }}
                  </small>
                </td>
                <td class="monitor-number">{{ group.liveProcesses }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="monitor-empty">
          <span class="material-symbols-outlined">monitoring</span>
          <strong>
            {{
              active
                ? label('No matching Agent process yet', '尚未发现匹配的 Agent 进程')
                : label('Start with an Agent you want to observe', '从你想观察的 Agent 开始')
            }}
          </strong>
          <p>
            {{
              label(
                'Common Agents are recognized automatically. Add an application or choose a running CLI.',
                '自动识别常见 Agent，也可手动添加应用或选择正在运行的 CLI。',
              )
            }}
          </p>
        </div>
        <p class="monitor-chart-caption">
          {{
            label(
              'Includes related child processes · sorted by upload',
              '含关联子进程 · 按上传量排序',
            )
          }}
        </p>
      </section>
    </div>
    <MonitorFileEvents
      :activity="snapshot?.fileActivity"
      :running="state === 'running'"
      @connections="showConnections"
    />
    <div class="monitor-footnotes">
      <p>
        {{
          label(
            'Counts start with monitoring. Stopping retains this run; restarting clears it. Closing to the tray keeps monitoring active; fully exiting clears the records.',
            '从开启监测时开始计数；停止后保留本次读数，再次开启重新统计。收进托盘后继续监测，完全退出软件后清空记录。',
          )
        }}
      </p>
      <p>
        {{
          label(
            'Upload includes API requests and LAN traffic. File associations are clues, not proof of uploaded content. No request contents are decrypted or stored; all analysis stays on this device.',
            '上传量包含 API 请求和局域网通信。文件关联仅提供线索，无法确认上传内容。不会解密或保存请求内容，统计与分析仅在本机进行。',
          )
        }}
      </p>
      <p v-if="localSent">
        {{ label('Local / proxy traffic counted separately', '本机通信 / 代理流量单独统计') }}：{{
          monitorBytes(localSent)
        }}
        · {{ label('Cloud delivery is unverified', '是否上传到云端尚未确认') }}
      </p>
    </div>
    <MonitorManageDialog
      :open="managing"
      :rules="snapshot?.settings.rules ?? []"
      :pending="pending === 'rule'"
      @close="managing = false"
      @toggle="setRule"
      @remove="remove"
    />
    <MonitorConnectionsDialog
      :open="connectionsOpen"
      :groups="snapshot?.groups ?? []"
      :running="state === 'running'"
      :focus-connections="connectionFocus"
      @close="connectionsOpen = false"
    />
    <MonitorAddDialog :open="adding" @close="adding = false" @saved="apply" />
    <MonitorDetails :group="detail" @close="selected = ''" />
  </PageSurface>
</template>
