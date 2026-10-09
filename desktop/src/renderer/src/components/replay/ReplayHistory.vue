<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import {
  replayDimensions,
  replayFormat,
  type ReplayOptions,
  type ReplayRecord,
} from '@shared/replay'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import SegmentedControl from '../base/SegmentedControl.vue'
import SelectControl from '../base/SelectControl.vue'
import ReplayHistoryCard from './ReplayHistoryCard.vue'
import ReplayIcon from './ReplayIcon.vue'
import { useI18n } from '../../i18n/useI18n'
import { replayRecordTitle, replayTemplates } from '../../replay/replay-labels'
const props = defineProps<{ records: ReplayRecord[]; busy: boolean }>()
const emit = defineEmits<{ reuse: [options: ReplayOptions]; refresh: [] }>()
const { label } = useI18n()
const expanded = ref(false),
  kind = ref('all'),
  query = ref(''),
  dimension = ref('all'),
  page = ref(1)
const media = ref(''),
  selected = ref<ReplayRecord | null>(null),
  removing = ref<ReplayRecord | null>(null)
const working = ref(''),
  error = ref(''),
  saved = ref(false)
const tabs = computed(() =>
  [
    { value: 'all', label: label('All', '全部') },
    { value: 'animation', label: label('Animations', '动态图') },
    { value: 'image', label: label('Images', '静态图') },
    { value: 'video', label: label('Videos', '视频') },
  ].map((item) => ({
    ...item,
    label: `${item.label} ${props.records.filter((record) => item.value === 'all' || replayFormat(record.options).kind === item.value).length}`,
  })),
)
function title(record: ReplayRecord): string {
  return replayRecordTitle(record.options, label)
}
const filtered = computed(() =>
  props.records.filter((record) => {
    const format = replayFormat(record.options)
    const template = replayTemplates(label).find((item) => item.value === record.options.template)
    const text =
      `${title(record)} ${template?.title ?? ''} ${format.label} ${record.options.dimension} ${record.options.measure ?? 'tokens'} ${record.options.from} ${record.options.to} ${record.options.dimension === 'models' ? label('Model', '模型') : record.options.dimension === 'projects' ? label('Project', '项目') : 'Agent'}`.toLowerCase()
    return (
      (kind.value === 'all' || kind.value === format.kind) &&
      (dimension.value === 'all' || dimension.value === record.options.dimension) &&
      (!query.value.trim() || text.includes(query.value.trim().toLowerCase()))
    )
  }),
)
const PAGE_SIZE = 6
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
function clearFilters(): void {
  kind.value = 'all'
  dimension.value = 'all'
  query.value = ''
}
const visible = computed(() =>
  filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
)
watch([kind, query, dimension], () => {
  page.value = 1
})
watch(pages, (value) => {
  page.value = Math.min(page.value, value)
})
const selectedFormat = computed(() =>
  selected.value ? replayFormat(selected.value.options) : null,
)
const dimensions = computed(() =>
  selected.value ? replayDimensions(selected.value.options) : null,
)
const totalBytes = computed(() => props.records.reduce((sum, record) => sum + record.bytes, 0))
watch(
  () => props.records,
  (records) => {
    if (!selected.value) return
    const record = records.find((item) => item.id === selected.value!.id)
    if (!record) close()
    else if (record.status !== selected.value.status) {
      if (record.status === 'complete') void open(record)
      else selected.value = record
    }
  },
)
let request = 0
function close(): void {
  ++request
  if (media.value) URL.revokeObjectURL(media.value)
  media.value = ''
  working.value = ''
  selected.value = null
  saved.value = false
}
async function open(record: ReplayRecord): Promise<void> {
  close()
  error.value = ''
  selected.value = record
  if (record.status !== 'complete') return
  const id = request
  working.value = record.id
  try {
    const bytes = await window.api.replayRead(record.id)
    if (id !== request) return
    media.value = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: replayFormat(record.options).mime }),
    )
  } catch {
    if (id === request)
      error.value = label(
        'The saved file is missing or invalid. Regenerate it from these settings.',
        '历史文件已丢失或格式无效，可以使用此设置重新生成。',
      )
  } finally {
    if (id === request) working.value = ''
  }
}
async function save(record: ReplayRecord): Promise<void> {
  working.value = record.id
  error.value = ''
  saved.value = false
  try {
    saved.value = await window.api.replaySaveCopy(record.id)
  } catch {
    error.value = label(
      'Could not save this copy. Check the folder and file extension.',
      '另存为失败，请检查文件夹权限与文件扩展名。',
    )
  } finally {
    working.value = ''
  }
}
async function folder(): Promise<void> {
  error.value = ''
  try {
    await window.api.replayOpenFolder(
      selected.value?.status === 'complete' ? selected.value.id : undefined,
    )
  } catch {
    error.value = label('Could not open the history folder.', '暂时无法打开历史文件夹。')
  }
}
function reuse(record: ReplayRecord): void {
  close()
  expanded.value = false
  emit('reuse', record.options)
}
async function remove(): Promise<void> {
  if (!removing.value) return
  working.value = removing.value.id
  error.value = ''
  try {
    await window.api.replayRemove(removing.value.id)
    if (selected.value?.id === removing.value.id) close()
    removing.value = null
    emit('refresh')
  } catch {
    error.value = label('Could not remove this record. Please retry.', '删除历史失败，请重试。')
  } finally {
    working.value = ''
  }
}
onDeactivated(() => {
  close()
  expanded.value = false
  removing.value = null
  working.value = ''
})
onBeforeUnmount(close)
</script>
<template>
  <section class="replay-history" :aria-label="label('Recent generations', '最近生成')">
    <header>
      <div>
        <h2>{{ label('Recent generations', '最近生成') }}</h2>
        <span class="replay-count numeric">{{ records.length }}</span>
        <span class="replay-history-local">{{ label('Saved on this device', '保存在本机') }}</span>
      </div>
      <button class="replay-text-button" @click="expanded = true">
        {{ label('All history', '全部历史') }}
        <span aria-hidden="true">↗</span>
      </button>
    </header>
    <p v-if="error && !selected && !expanded" class="replay-notice error" role="alert">
      {{ error }}
    </p>
    <div v-if="!records.length" class="replay-history-empty">
      <span class="material-symbols-outlined" aria-hidden="true">photo_library</span>
      <div>
        <strong>{{ label('Your first recap belongs here', '这里，留给你的第一份回顾') }}</strong>
        <p>
          {{
            label(
              'Generated images and videos will appear here automatically.',
              '生成的图片与视频会自动保留在这里，随时预览和另存为。',
            )
          }}
        </p>
      </div>
    </div>
    <div v-else class="replay-recent-grid">
      <ReplayHistoryCard
        v-for="record in records.slice(0, 3)"
        :key="record.id"
        :record="record"
        compact
        :disabled="!!working"
        @open="open(record)"
        @save="save(record)"
      />
    </div>
  </section>
  <WorkspaceDialog
    :open="expanded"
    :title="label('All generation history', '全部生成历史')"
    class="replay-history-dialog"
    wide
    @close="expanded = false"
  >
    <template #heading>
      <div class="replay-library-heading">
        <span class="replay-library-icon">
          <span class="material-symbols-outlined" aria-hidden="true">photo_library</span>
        </span>
        <div>
          <h2>
            {{ label('All generation history', '全部生成历史') }}
            <small>{{ records.length }}</small>
          </h2>
          <p>
            {{ label('Your personal collection of AI stories', '收藏每一段 AI 使用历程') }} ·
            {{ (totalBytes / 1048576).toFixed(1) }} MB
          </p>
        </div>
      </div>
    </template>
    <template #actions>
      <button class="workspace-button" @click="folder">
        <ReplayIcon name="folder" :size="16" />
        {{ label('Open folder', '打开文件夹') }}
      </button>
    </template>
    <div class="replay-library-toolbar">
      <SegmentedControl
        v-model="kind"
        :options="tabs"
        :label="label('History type', '历史类型')"
        compact
      />
      <div>
        <input
          v-model="query"
          type="search"
          :placeholder="label('Search title, date, format…', '搜索标题、日期、格式…')"
          :aria-label="label('Search history', '搜索历史')"
        />
        <SelectControl
          v-model="dimension"
          :options="[
            { value: 'all', label: label('All dimensions', '全部维度') },
            { value: 'agents', label: 'Agent' },
            { value: 'models', label: label('Model', '模型') },
            { value: 'projects', label: label('Project', '项目') },
          ]"
          :label="label('History dimension', '历史维度')"
          compact
        />
      </div>
    </div>
    <p v-if="error && !selected" class="replay-notice error" role="alert">{{ error }}</p>
    <div v-if="visible.length" class="replay-library-grid">
      <ReplayHistoryCard
        v-for="record in visible"
        :key="record.id"
        :record="record"
        :disabled="!!working"
        @open="open(record)"
        @save="save(record)"
      />
    </div>
    <div v-else class="replay-library-empty">
      <span class="material-symbols-outlined" aria-hidden="true">search_off</span>
      <strong>
        {{
          records.length
            ? label('No matching recaps', '没有匹配的回顾')
            : label('No generations yet', '还没有生成记录')
        }}
      </strong>
      <p>
        {{
          label(
            'Try a different filter, or create a new recap.',
            '试试其他筛选条件，或创建一份新的回顾。',
          )
        }}
      </p>
      <button v-if="records.length" class="workspace-button" @click="clearFilters">
        {{ label('Clear filters', '清除筛选') }}
      </button>
    </div>
    <template #footer>
      <span class="replay-library-count">
        {{ label('Newest first', '按生成时间倒序') }} · {{ filtered.length }}
        {{ label('items', '项') }}
      </span>
      <button class="workspace-button" :disabled="page <= 1" @click="page--">
        {{ label('Previous', '上一页') }}
      </button>
      <span class="numeric">{{ page }} / {{ pages }}</span>
      <button class="workspace-button" :disabled="page >= pages" @click="page++">
        {{ label('Next', '下一页') }}
      </button>
    </template>
  </WorkspaceDialog>
  <WorkspaceDialog
    :open="!!selected"
    :title="selected ? `${title(selected)} · ${selectedFormat?.label}` : label('Preview', '预览')"
    class="replay-media-dialog"
    wide
    @close="close"
  >
    <template v-if="selected">
      <div class="replay-media-preview">
        <video
          v-if="media && selectedFormat?.kind === 'video'"
          :src="media"
          controls
          autoplay
          playsinline
        />
        <img v-else-if="media" :src="media" :alt="title(selected)" />
        <div v-else class="replay-library-empty">
          <span class="material-symbols-outlined" aria-hidden="true">
            {{ working ? 'hourglass_empty' : 'broken_image' }}
          </span>
          <strong>
            {{
              working
                ? label('Loading…', '正在加载…')
                : selected.status === 'generating'
                  ? label('Generation in progress', '正在生成')
                  : selected.status === 'cancelled'
                    ? label('Generation cancelled', '已取消生成')
                    : label('No preview available', '暂无可预览文件')
            }}
          </strong>
          <p v-if="selected.status !== 'complete'">
            {{ label('Use these settings to create a new recap.', '可以使用此设置重新生成。') }}
          </p>
        </div>
      </div>
      <div class="replay-media-info">
        <span>{{ selected.options.from }} — {{ selected.options.to }}</span>
        <span>
          {{ dimensions?.width }} × {{ dimensions?.height }} · {{ selectedFormat?.label }}
          <template v-if="selectedFormat?.kind !== 'image'">
            · {{ selected.options.duration }}s
          </template>
          · {{ (selected.bytes / 1048576).toFixed(2) }} MB
        </span>
      </div>
      <p v-if="error" class="replay-notice error" role="alert">{{ error }}</p>
      <p v-else-if="saved" class="replay-notice" role="status">
        {{ label('Copy saved.', '副本已保存。') }}
      </p>
    </template>
    <template v-if="selected" #footer>
      <button
        class="replay-text-button replay-remove"
        :disabled="!!working || selected.status === 'generating'"
        @click="removing = selected"
      >
        {{ label('Delete record', '删除记录') }}
      </button>
      <button class="workspace-button" :disabled="busy || !!working" @click="reuse(selected)">
        {{ label('Reuse settings', '使用此设置') }}
      </button>
      <button
        v-if="selected.status === 'complete'"
        class="workspace-button"
        :disabled="!!working"
        @click="folder"
      >
        {{ label('Show file', '显示文件') }}
      </button>
      <button
        v-if="selected.status === 'complete'"
        class="workspace-button primary"
        :disabled="!!working"
        @click="save(selected)"
      >
        <ReplayIcon name="download" :size="16" />
        {{ label('Save as', '另存为') }} {{ selectedFormat?.label }}
      </button>
    </template>
  </WorkspaceDialog>
  <WorkspaceDialog
    :open="!!removing"
    :title="label('Delete this record?', '删除这条生成记录？')"
    :busy="!!working"
    @close="removing = null"
  >
    <p>
      {{
        label(
          'This removes the local history file. Copies exported to other folders stay available.',
          '将删除本机历史中的文件；已导出到其他位置的副本会保留。',
        )
      }}
    </p>
    <p v-if="error" class="replay-notice error" role="alert">{{ error }}</p>
    <template #footer>
      <button class="workspace-button" :disabled="!!working" @click="removing = null">
        {{ label('Cancel', '取消') }}
      </button>
      <button class="workspace-button danger" :disabled="!!working" @click="remove">
        {{ label('Delete', '删除') }}
      </button>
    </template>
  </WorkspaceDialog>
</template>
