<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  MonitorApplicationChoice,
  MonitorProcess,
  MonitorSnapshot,
} from '@shared/network-monitor'
import { isMonitorPersistentEntry, isMonitorSharedRuntime } from '@shared/network-monitor'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import SegmentedControl from '../base/SegmentedControl.vue'
import { useI18n } from '../../i18n/useI18n'
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [snapshot: MonitorSnapshot] }>()
const { label, currentLang } = useI18n()
const source = ref('file'),
  query = ref(''),
  name = ref(''),
  descendants = ref(true),
  busy = ref(false),
  error = ref(false)
const choice = ref<MonitorApplicationChoice | null>(null),
  selected = ref<MonitorProcess | null>(null),
  processes = ref<MonitorProcess[]>([])
const options = computed(() => [
  { value: 'file', label: label('Choose application', '选择应用') },
  { value: 'process', label: label('Running processes', '正在运行') },
])
const visible = computed(() =>
  processes.value
    .filter((row) =>
      `${row.name} ${row.pid} ${row.path} ${row.entryPoint ?? ''}`
        .toLowerCase()
        .includes(query.value.toLowerCase()),
    )
    .slice(0, 200),
)
const shared = computed(
  () => choice.value?.sharedRuntime || isMonitorSharedRuntime(selected.value?.path ?? ''),
)
const instanceOnly = computed(
  () => shared.value && !!selected.value && !isMonitorPersistentEntry(selected.value.entryPoint),
)
watch(
  () => props.open,
  (open) => {
    if (open) {
      choice.value = null
      selected.value = null
      name.value = ''
      source.value = 'file'
      query.value = ''
      error.value = false
      descendants.value = true
    }
  },
)
async function loadProcesses(): Promise<void> {
  busy.value = true
  error.value = false
  try {
    processes.value = await window.api.networkMonitorProcesses()
  } catch {
    error.value = true
  } finally {
    busy.value = false
  }
}
watch(source, (value) => {
  if (value === 'process') void loadProcesses()
})
async function choose(): Promise<void> {
  busy.value = true
  error.value = false
  try {
    const result = await window.api.networkMonitorChoose(currentLang.value === 'zh' ? 'zh' : 'en')
    if (result) {
      choice.value = result
      selected.value = null
      name.value = result.name
      if (result.sharedRuntime) {
        source.value = 'process'
        query.value = result.name
      }
    }
  } catch {
    error.value = true
  } finally {
    busy.value = false
  }
}
function select(row: MonitorProcess): void {
  selected.value = row
  choice.value = null
  name.value = row.name.replace(/\.exe$/i, '')
}
async function save(): Promise<void> {
  const target =
    choice.value ??
    (selected.value
      ? { path: selected.value.path, name: selected.value.name, sharedRuntime: !!shared.value }
      : null)
  if (!target || !name.value.trim()) return
  busy.value = true
  error.value = false
  try {
    const snapshot = await window.api.networkMonitorAdd({
      ...target,
      name: name.value.trim(),
      descendants: descendants.value,
      instanceKey: selected.value?.key,
    })
    emit('saved', snapshot)
    emit('close')
  } catch {
    error.value = true
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <WorkspaceDialog
    :open="open"
    :title="label('Add monitored application', '添加监测应用')"
    :busy="busy"
    drawer
    class="monitor-add-dialog"
    @close="emit('close')"
  >
    <p class="monitor-help">
      {{
        label(
          'Choose an app or a running CLI. Its child processes can be counted together.',
          '选择桌面应用或正在运行的 CLI，可将它启动的子进程一并统计。',
        )
      }}
    </p>
    <SegmentedControl
      v-model="source"
      :options="options"
      :label="label('Application source', '应用来源')"
    />
    <div v-if="source === 'file'" class="monitor-file-picker">
      <span class="material-symbols-outlined">folder_open</span>
      <p>
        {{
          choice?.name ||
          label('Windows .exe · macOS .app / executable', 'Windows .exe · macOS .app / 可执行文件')
        }}
      </p>
      <button class="workspace-button" type="button" :disabled="busy" @click="choose">
        {{ label('Browse files', '浏览文件') }}
      </button>
    </div>
    <div v-else class="monitor-process-picker">
      <div class="monitor-inline">
        <input
          v-model="query"
          class="workspace-input"
          :placeholder="label('Search name, PID or path', '搜索名称、PID 或路径')"
          :aria-label="label('Search processes', '搜索进程')"
        />
        <button class="workspace-button" type="button" :disabled="busy" @click="loadProcesses">
          {{ label('Refresh', '刷新') }}
        </button>
      </div>
      <p v-if="choice?.sharedRuntime" class="monitor-note">
        {{
          label(
            'This executable is shared by several tools. Select the exact running script below.',
            '这个程序可能被多个工具共用，请在下方选择具体的脚本进程。',
          )
        }}
      </p>
      <div
        class="monitor-process-list"
        role="listbox"
        :aria-label="label('Running processes', '正在运行的进程')"
      >
        <button
          v-for="row in visible"
          :key="row.key"
          type="button"
          role="option"
          :aria-selected="selected?.key === row.key"
          @click="select(row)"
        >
          <span>
            <strong>{{ row.name }}</strong>
            <small>PID {{ row.pid }}</small>
          </span>
          <span class="monitor-path">{{ row.entryPoint || row.path }}</span>
        </button>
        <p v-if="!visible.length" class="monitor-help">
          {{
            busy
              ? label('Reading processes…', '正在读取进程…')
              : label(
                  'No matching process. Launch the CLI, then refresh.',
                  '没有匹配进程。可以先启动 CLI，再刷新。',
                )
          }}
        </p>
      </div>
      <p v-if="processes.length > 200" class="monitor-help">
        {{
          label(
            'Showing up to 200 matches. Search to narrow the list.',
            '最多显示 200 个匹配结果，可通过搜索缩小范围。',
          )
        }}
      </p>
    </div>
    <template v-if="selected || (choice && !choice.sharedRuntime)">
      <label class="monitor-field">
        {{ label('Display name', '显示名称') }}
        <input v-model="name" maxlength="80" class="workspace-input" />
      </label>
      <p class="monitor-path">{{ selected?.entryPoint || selected?.path || choice?.path }}</p>
      <label class="monitor-checkbox">
        <input v-model="descendants" type="checkbox" />
        {{ label('Include processes launched by this application', '包含此应用启动的子进程') }}
      </label>
      <p class="monitor-help">
        {{
          label(
            'Each process is counted once. If it was launched by another monitored Agent, it remains in that Agent’s group.',
            '每个进程只统计一次。如果它由另一个已监测的 Agent 启动，仍归入那个 Agent。',
          )
        }}
      </p>
      <p v-if="instanceOnly" class="monitor-note">
        {{
          label(
            'The script entry is unavailable. This selection applies only to this process instance and expires when the app restarts.',
            '无法确认脚本入口，本次仅绑定这个进程实例；软件重启后需重新选择。',
          )
        }}
      </p>
    </template>
    <p v-if="error" role="alert" class="monitor-error">
      {{
        label(
          'Could not complete this action. Check the application and try again.',
          '操作未完成，请检查选择的应用后重试。',
        )
      }}
    </p>
    <template #footer>
      <button class="workspace-button" type="button" :disabled="busy" @click="emit('close')">
        {{ label('Cancel', '取消') }}
      </button>
      <button
        class="workspace-button workspace-button--primary"
        type="button"
        :disabled="busy || !name.trim() || (!selected && (!choice || choice.sharedRuntime))"
        @click="save"
      >
        {{ label('Add application', '添加应用') }}
      </button>
    </template>
  </WorkspaceDialog>
</template>
