<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MonitorFileActivity } from '@shared/network-monitor'
import SelectControl from '../base/SelectControl.vue'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import { useI18n } from '../../i18n/useI18n'
import { monitorBytes, monitorEndpoint, monitorTime } from '../../utils/network-monitor-display'
const props = defineProps<{ activity?: MonitorFileActivity; running: boolean }>()
const emit = defineEmits<{ connections: [ids: string[]] }>()
const { label } = useI18n()
const selected = ref(''),
  filter = ref(''),
  filesOpen = ref(false)
const events = computed(() => props.activity?.events ?? [])
const options = computed(() => [
  { value: '', label: label('All applications', '全部应用') },
  ...[
    ...new Map(
      events.value.map((row) => [row.groupId, { value: row.groupId, label: row.groupName }]),
    ).values(),
  ],
])
const filtered = computed(() =>
  events.value.filter((event) => !filter.value || event.groupId === filter.value),
)
const detail = computed(
  () => filtered.value.find((row) => row.id === selected.value) ?? filtered.value[0],
)
watch(
  () => detail.value?.id,
  (id) => {
    selected.value = id ?? ''
    filesOpen.value = false
  },
  { immediate: true },
)
watch(events, (rows) => {
  if (filter.value && !rows.some((row) => row.groupId === filter.value)) filter.value = ''
})
const status = computed(() => {
  switch (props.activity?.state) {
    case 'starting':
      return label('Waiting for the file collector…', '正在等待文件采集程序…')
    case 'permission-required':
      return label(
        'macOS file observation needs Endpoint Security authorization and Full Disk Access.',
        'macOS 文件关联需要额外系统授权及完全磁盘访问权限。',
      )
    case 'unavailable':
      return label(
        'File observation is unavailable in this build or system configuration. Network monitoring remains available.',
        '当前版本或系统配置暂不支持文件关联，流量监测仍可使用。',
      )
    case 'stopped':
      return label(
        'File association stopped. Previous events are retained for this run.',
        '文件关联已停止，本次事件仍可查看。',
      )
    case 'running':
      return props.running
        ? label(
            'Observing file access; no qualifying association yet. This does not establish that no files were uploaded.',
            '正在观察文件访问，尚无达到条件的关联事件；不代表没有上传文件。',
          )
        : label('Start monitoring to observe file access.', '开始监测后观察文件访问。')
    default:
      return label(
        'Enable File association to relate file access to network uploads.',
        '开启“文件关联”后，观察文件访问与上传流量的关联。',
      )
  }
})
const title = (kind: string): string =>
  kind === 'archive'
    ? label('Upload after archive access', '访问压缩文件后出现上传流量')
    : label('Upload after concentrated file access', '集中访问文件后出现上传流量')
const fileName = (path: string): string => path.replaceAll('\\', '/').split('/').slice(-2).join('/')
</script>
<template>
  <section class="monitor-file-events">
    <header>
      <div class="monitor-inline">
        <h2>{{ label('File association events', '文件关联事件') }}</h2>
        <span class="monitor-badge">{{ activity?.totalEvents ?? 0 }}</span>
        <span class="monitor-help">
          {{
            label(
              'File access and upload activity close in time',
              '根据文件访问与网络上传的时间关联生成',
            )
          }}
        </span>
      </div>
      <SelectControl
        v-model="filter"
        :options="options"
        :label="label('Filter events by application', '按应用筛选事件')"
        compact
      />
    </header>
    <p v-if="activity?.issues.length" class="monitor-file-warning" role="status">
      {{
        label(
          'Some file events or paths were not retained. Association coverage is incomplete.',
          '部分文件事件或路径未能保留，关联记录不完整。',
        )
      }}
    </p>
    <p v-if="activity?.state !== 'running' && events.length" class="monitor-file-warning">
      {{ status }}
    </p>
    <div v-if="detail" class="monitor-evidence-layout">
      <div
        class="monitor-event-list"
        role="list"
        :aria-label="label('Suspected events', '疑似事件')"
      >
        <button
          v-for="event in filtered"
          :key="event.id"
          type="button"
          :aria-pressed="event.id === detail.id"
          @click="selected = event.id"
        >
          <span class="monitor-inline">
            <strong>{{ event.groupName }}</strong>
            <span class="monitor-badge">{{ label('Suspected', '疑似关联') }}</span>
            <time>{{ monitorTime(event.firstUploadAt) }}</time>
          </span>
          <span>{{ title(event.kind) }}</span>
          <small>
            {{ label('Accessed', '访问') }} {{ event.fileCount }} {{ label('files', '个文件') }} ·
            {{ label('Uploaded during interval', '期间上传') }} {{ monitorBytes(event.sent) }}
          </small>
        </button>
      </div>
      <article class="monitor-event-detail">
        <header>
          <strong>{{ label('Event details', '事件详情') }}</strong>
          <span class="monitor-help">
            {{ detail.groupName }} · {{ monitorTime(detail.firstFileAt) }}–{{
              monitorTime(detail.lastUploadAt)
            }}
          </span>
        </header>
        <p class="monitor-file-warning">
          {{
            label(
              'Suspected association; these files have not been confirmed uploaded.',
              '疑似关联，尚未确认这些文件已上传。',
            )
          }}
        </p>
        <div class="monitor-evidence-columns">
          <div>
            <h3>{{ label('Timeline', '行为时间线') }}</h3>
            <p>
              {{ monitorTime(detail.firstFileAt) }}
              <br />
              {{ label('Observed file access', '观察到文件访问') }}
            </p>
            <p>
              {{ monitorTime(detail.firstUploadAt) }}
              <br />
              {{ label('Observed upload traffic', '观察到上传流量') }}
            </p>
          </div>
          <div>
            <h3>{{ label('Files involved', '涉及文件') }}</h3>
            <p
              v-for="file in detail.files.slice(0, 3)"
              :key="file.processKey + file.path"
              class="monitor-evidence-path"
              :title="file.path"
            >
              {{ fileName(file.path) }}
            </p>
            <button class="monitor-text-button" type="button" @click="filesOpen = true">
              {{ label('View file evidence', '查看文件访问记录') }} ↗
            </button>
          </div>
          <div>
            <h3>{{ label('Evidence summary', '证据摘要') }}</h3>
            <p
              v-for="connection in detail.connections.slice(0, 2)"
              :key="connection.id"
              class="monitor-evidence-path"
            >
              {{ monitorEndpoint(connection.address, connection.port) }}
            </p>
            <p>
              {{ label('Uploaded during interval', '期间上传量') }}
              <strong>{{ monitorBytes(detail.sent) }}</strong>
            </p>
            <button
              class="monitor-text-button"
              type="button"
              @click="
                emit(
                  'connections',
                  detail.connections.map((row) => row.id),
                )
              "
            >
              {{ label('View associated connections', '查看关联连接') }} ↗
            </button>
          </div>
        </div>
        <p class="monitor-help">
          {{
            label(
              'Same process group, close in time. File contents are not collected; traffic is not a file size.',
              '同一进程组、时间接近。文件内容未采集；上传流量不代表这些文件的大小。',
            )
          }}
        </p>
        <p v-if="detail.limited" class="monitor-help">
          {{ label('Evidence is partially retained.', '此事件仅保留部分证据。') }}
        </p>
      </article>
    </div>
    <div v-else class="monitor-empty">
      <span class="material-symbols-outlined">find_in_page</span>
      <p>{{ status }}</p>
    </div>
    <details class="monitor-association-rules">
      <summary>{{ label('How association works', '如何判断疑似关联') }}</summary>
      <p>
        {{
          label(
            'Within 120 seconds: at least 10 distinct relevant files, or an archive, followed by at least 1 MB of non-loopback upload in the same process group. Code, documents, configuration and archives are included; node_modules, .git and cache directories are excluded. Windows observes read requests; this build does not support macOS file observation yet. These signals do not prove successful reads or uploaded content.',
            '在 120 秒内，同一进程组访问至少 10 个不同的相关文件，或访问压缩文件，并随后观测到至少 1 MB 非回环上传。关注代码、文档、配置和压缩文件；不纳入 node_modules、.git 和缓存目录。Windows 观察读取请求；当前版本尚未支持 macOS 文件采集。不能据此证明读取成功或确认上传内容。',
          )
        }}
      </p>
      <p>
        {{
          label(
            'Keeps at most 100 events for this run; file and connection details are bounded. Exiting clears all records.',
            '仅保留本次运行最近 100 条事件，文件及连接详情均有容量上限。退出软件后清空。',
          )
        }}
      </p>
    </details>
    <WorkspaceDialog
      :open="filesOpen"
      :title="label('File access evidence', '文件访问记录')"
      wide
      @close="filesOpen = false"
    >
      <p class="monitor-help">
        {{
          label(
            'Observed paths only, not file contents. Up to 50 access records per event.',
            '仅显示观测到的路径，不读取文件内容；每条事件最多保留 50 条访问记录。',
          )
        }}
      </p>
      <div v-if="detail" class="monitor-file-list">
        <article v-for="file in detail.files" :key="file.processKey + file.path">
          <strong>{{ file.path }}</strong>
          <small>
            PID {{ file.processKey.split(':')[0] }} · {{ monitorTime(file.firstAt) }}–{{
              monitorTime(file.lastAt)
            }}
            · {{ file.count }} {{ label('accesses', '次访问') }}
          </small>
        </article>
      </div>
    </WorkspaceDialog>
  </section>
</template>
