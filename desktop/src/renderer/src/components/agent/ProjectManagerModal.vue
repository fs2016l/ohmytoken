<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ProjectUsageStat, TrackedProject } from '@shared/models'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import { useI18n } from '../../i18n/useI18n'
import DropdownChevron from '../base/DropdownChevron.vue'
const props = defineProps<{ open: boolean; projects: ProjectUsageStat[] }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { label } = useI18n()
const items = ref<TrackedProject[]>([]),
  ignored = ref<TrackedProject[]>([])
const query = ref('')
const editing = ref(''),
  name = ref(''),
  path = ref('')
const busy = ref(false),
  loading = ref(false),
  error = ref(''),
  status = ref('')
const confirmation = ref<'remove' | ''>('')
const selected = computed(() => items.value.find((project) => project.id === editing.value))
const canSave = computed(() => !busy.value && !!name.value.trim() && !!path.value)
function filterProjects(projects: TrackedProject[]): TrackedProject[] {
  const search = query.value.trim().toLowerCase()
  return search
    ? projects.filter(
        (project) =>
          project.name.toLowerCase().includes(search) ||
          project.path.toLowerCase().includes(search),
      )
    : projects
}
const visibleProjects = computed(() => filterProjects(items.value))
const visibleIgnored = computed(() => filterProjects(ignored.value))
async function load(): Promise<void> {
  loading.value = true
  try {
    ;[items.value, ignored.value] = await Promise.all([
      window.api.projectsList(),
      window.api.getIgnoredProjects(),
    ])
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}
function reset(): void {
  editing.value = ''
  name.value = ''
  path.value = ''
  confirmation.value = ''
}
function edit(project: TrackedProject): void {
  if (busy.value) return
  editing.value = project.id
  name.value = project.name
  path.value = project.path
  confirmation.value = ''
  error.value = ''
  status.value = ''
}
watch(
  () => props.open,
  (open) => {
    if (open) {
      reset()
      query.value = ''
      error.value = ''
      status.value = ''
      void load()
    }
  },
)
async function chooseDirectory(): Promise<void> {
  if (busy.value) return
  try {
    const selectedPath = await window.api.selectProjectDirectory()
    if (selectedPath) path.value = selectedPath
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}
async function mutate(action: () => Promise<unknown>, message: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  status.value = ''
  try {
    await action()
    reset()
    await load()
    status.value = message
    emit('changed')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busy.value = false
  }
}
async function save(): Promise<void> {
  if (!canSave.value) return
  const values = { name: name.value.trim(), path: path.value }
  await mutate(
    () =>
      editing.value
        ? window.api.updateProject({ ...values, projectId: editing.value })
        : window.api.saveProject(values),
    label('Project saved.', '项目已保存。'),
  )
}
async function remove(): Promise<void> {
  await mutate(
    () => window.api.removeProject(editing.value),
    label(
      'Project excluded from statistics. You can restore it below.',
      '项目已移出统计范围，可以从已忽略项目中恢复。',
    ),
  )
}
async function restore(id: string): Promise<void> {
  await mutate(() => window.api.restoreProject(id), label('Project restored.', '项目已恢复。'))
}
</script>
<template>
  <WorkspaceDialog
    :open="open"
    :title="label('Manage project folders', '管理项目目录')"
    :busy="busy"
    wide
    @close="emit('close')"
  >
    <div class="project-manager">
      <aside>
        <input
          v-model="query"
          type="search"
          class="workspace-input project-search"
          :placeholder="label('Search projects', '搜索项目')"
          :aria-label="label('Search projects', '搜索项目')"
        />
        <button type="button" class="workspace-button" :disabled="busy" @click="reset">
          + {{ label('Add project', '添加项目') }}
        </button>
        <p v-if="loading" class="manager-status" role="status">
          {{ label('Loading…', '读取中…') }}
        </p>
        <ul class="selection-list">
          <li v-for="project in visibleProjects" :key="project.id">
            <button
              type="button"
              :class="{ active: editing === project.id }"
              :disabled="busy"
              @click="edit(project)"
            >
              <b>{{ project.name }}</b>
              <span :title="project.path">{{ project.path }}</span>
            </button>
          </li>
        </ul>
        <p
          v-if="query.trim() && !visibleProjects.length && !visibleIgnored.length && !loading"
          class="manager-status"
          role="status"
        >
          {{ label('No matching projects', '没有符合条件的项目') }}
        </p>
        <details v-if="visibleIgnored.length" :open="Boolean(query.trim())">
          <summary class="disclosure-summary">
            <DropdownChevron disclosure direction="right" />
            {{
              label(
                `Ignored projects (${visibleIgnored.length})`,
                `已忽略项目（${visibleIgnored.length}）`,
              )
            }}
          </summary>
          <div v-for="project in visibleIgnored" :key="project.id" class="ignored-project">
            <span :title="project.path">{{ project.name }}</span>
            <button
              type="button"
              class="workspace-link"
              :disabled="busy"
              @click="restore(project.id)"
            >
              {{ label('Restore', '恢复') }}
            </button>
          </div>
        </details>
      </aside>
      <form class="project-editor" @submit.prevent="save">
        <h3>
          {{ editing ? label('Edit project', '编辑项目') : label('Add project', '添加项目') }}
        </h3>
        <label for="project-name">{{ label('Project name', '项目名称') }}</label>
        <input
          id="project-name"
          v-model="name"
          class="workspace-input"
          maxlength="80"
          :disabled="busy"
          required
          autofocus
        />
        <label>{{ label('Project folder', '项目目录') }}</label>
        <div class="folder-choice">
          <span>{{ path || label('Choose a project folder', '选择项目目录') }}</span>
          <button type="button" class="workspace-button" :disabled="busy" @click="chooseDirectory">
            {{ label('Browse', '浏览') }}
          </button>
        </div>
        <p class="manager-help">
          {{
            label(
              'Usage belongs to the closest matching project folder. Renaming or hiding a project keeps the source sessions.',
              '用量归属到最匹配的项目目录。重命名或隐藏项目会保留原始会话。',
            )
          }}
        </p>
        <div v-if="selected?.directories && selected.directories.length > 1" class="linked-folders">
          <strong>{{ label('Included folders', '已包含目录') }}</strong>
          <p v-for="directory in selected.directories" :key="directory">{{ directory }}</p>
        </div>
        <div class="editor-actions">
          <button type="button" class="workspace-button" :disabled="busy" @click="reset">
            {{ label('Reset', '重置') }}
          </button>
          <button
            type="submit"
            class="workspace-button workspace-button--primary"
            :disabled="!canSave"
          >
            {{ busy ? label('Saving…', '保存中…') : label('Save project', '保存项目') }}
          </button>
        </div>
        <section v-if="editing" class="project-management-actions">
          <button
            type="button"
            class="workspace-link remove-project"
            :disabled="busy"
            @click="confirmation = 'remove'"
          >
            {{ label('Exclude project from statistics', '将项目移出统计范围') }}
          </button>
          <div v-if="confirmation" class="confirmation" role="alert">
            <p>
              {{
                label(
                  'Hide this project from statistics? You can restore it from the ignored list.',
                  '将此项目从统计中隐藏？之后可从已忽略列表恢复。',
                )
              }}
            </p>
            <button
              type="button"
              class="workspace-button"
              :disabled="busy"
              @click="confirmation = ''"
            >
              {{ label('Cancel', '取消') }}
            </button>
            <button type="button" class="workspace-button" :disabled="busy" @click="remove">
              {{ label('Confirm', '确认') }}
            </button>
          </div>
        </section>
      </form>
    </div>
    <p v-if="error" class="workspace-error" role="alert">
      {{ error }}
      <button type="button" class="workspace-link" @click="load">
        {{ label('Reload projects', '重新读取项目') }}
      </button>
    </p>
    <p v-if="status" class="manager-status" role="status">{{ status }}</p>
  </WorkspaceDialog>
</template>
<style scoped>
.project-manager {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  gap: 24px;
}
aside {
  border-right: 1px solid var(--border);
  padding-right: 20px;
  min-width: 0;
}
aside > button {
  width: 100%;
}
.project-search {
  display: block;
  margin-bottom: 8px;
}
ul {
  margin: 16px 0;
  padding: 0;
  list-style: none;
  max-height: 340px;
  overflow: auto;
}
li > button {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: 8px;
  padding: 12px;
  color: var(--text);
  background: transparent;
  cursor: pointer;
}
li > button:hover {
  background: var(--bg-hover);
}
li > button.active {
  background: var(--primary-soft);
}
li b {
  display: block;
  font-size: 13px;
  font-weight: 500;
}
li span {
  display: block;
  font-size: 11px;
  color: var(--text-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 6px;
}
summary {
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}
.ignored-project {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  font-size: 12px;
}
.ignored-project span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-editor {
  min-width: 0;
}
h3 {
  font-size: 16px;
  font-weight: 500;
  margin: 0 0 20px;
}
label {
  display: block;
  margin: 16px 0 8px;
  font-size: 13px;
}
.workspace-input {
  width: 100%;
}
.folder-choice {
  display: flex;
  align-items: center;
  gap: 12px;
}
.folder-choice > span {
  flex: 1;
  overflow-wrap: anywhere;
  font-size: 12px;
  color: var(--text-muted);
}
.manager-help {
  font-size: 12px;
  color: var(--text-soft);
  line-height: 20px;
  margin: 16px 0;
}
.linked-folders {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.linked-folders p {
  color: var(--text-muted);
}
.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin: 20px 0;
}
.project-management-actions {
  border-top: 1px solid var(--border);
  margin-top: 24px;
}
.remove-project {
  margin-top: 20px;
  color: var(--error);
}
.confirmation {
  border: 1px solid var(--border);
  padding: 12px;
  border-radius: 8px;
  margin-top: 16px;
  font-size: 12px;
  line-height: 20px;
}
.confirmation p {
  margin: 0 0 12px;
}
.confirmation button + button {
  margin-left: 8px;
}
.manager-status {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 16px;
}
</style>
