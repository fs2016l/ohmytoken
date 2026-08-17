<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ProjectUsageStat } from '@shared/models'
import { useI18n } from '../../i18n/useI18n'
import { useBodyScrollLock } from '../../composables/useBodyScrollLock'
import { formatTokens } from '../../utils/format'

const props = defineProps<{
  open: boolean
  projects: ProjectUsageStat[]
}>()

const emit = defineEmits<{
  close: []
  changed: []
}>()

const { label, tr } = useI18n()
const nameInput = ref<HTMLInputElement>()
const projectForm = ref<HTMLFormElement>()
const projectName = ref('')
const selectedPath = ref('')
const editingProjectId = ref('')
const busy = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')
const pendingDeleteId = ref('')
const PROJECT_COLORS = ['#8b5cf6', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#e879f9']

const selectedProject = computed(() =>
  props.projects.find((project) => project.projectId === editingProjectId.value),
)
const totalManagedTokens = computed(() =>
  props.projects.reduce((total, project) => total + project.totalTokens, 0),
)
const hasDraft = computed(() => Boolean(projectName.value || selectedPath.value))
const canSubmit = computed(
  () => !busy.value && Boolean(projectName.value.trim()) && Boolean(selectedPath.value),
)

useBodyScrollLock(() => props.open)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    resetForm()
    errorMessage.value = ''
    statusMessage.value = ''
    void nextTick(() => nameInput.value?.focus())
  },
)

function close(): void {
  if (busy.value) return
  emit('close')
}

function projectColor(index: number): string {
  return PROJECT_COLORS[index % PROJECT_COLORS.length]
}

function resetForm(focus = false): void {
  editingProjectId.value = ''
  projectName.value = ''
  selectedPath.value = ''
  pendingDeleteId.value = ''
  if (focus) void nextTick(() => nameInput.value?.focus())
}

function startAddProject(): void {
  if (busy.value) return
  resetForm(true)
  errorMessage.value = ''
  statusMessage.value = ''
}

function beginEdit(project: ProjectUsageStat): void {
  if (busy.value) return
  editingProjectId.value = project.projectId
  projectName.value = project.name
  selectedPath.value = project.path
  pendingDeleteId.value = ''
  errorMessage.value = ''
  statusMessage.value = ''
  void nextTick(() => {
    projectForm.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    nameInput.value?.focus()
    nameInput.value?.select()
  })
}

function cancelEdit(): void {
  if (busy.value) return
  resetForm(true)
  errorMessage.value = ''
  statusMessage.value = ''
}

async function chooseDirectory(): Promise<void> {
  if (busy.value) return
  errorMessage.value = ''
  const path = await window.api.selectProjectDirectory()
  if (path) selectedPath.value = path
}

async function saveProject(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    if (editingProjectId.value) {
      await window.api.updateProject({
        projectId: editingProjectId.value,
        name: projectName.value.trim(),
        path: selectedPath.value,
      })
      statusMessage.value = tr('projectUpdated')
    } else {
      await window.api.saveProject({
        name: projectName.value.trim(),
        path: selectedPath.value,
      })
      statusMessage.value = label('Project saved.', '项目已保存。')
    }
    resetForm()
    emit('changed')
    await nextTick()
    nameInput.value?.focus()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

async function removeProject(projectId: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    await window.api.removeProject(projectId)
    resetForm()
    statusMessage.value = label('Project removed from statistics.', '项目已移出统计范围。')
    emit('changed')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="project-modal">
      <div
        v-if="open"
        class="project-modal-overlay"
        role="presentation"
        @mousedown.self="close"
        @keydown.esc="close"
      >
        <section
          class="project-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-manager-title"
        >
          <header class="project-modal-header">
            <div class="header-mark" aria-hidden="true">
              <span class="material-symbols-outlined">folder_managed</span>
            </div>
            <div class="header-copy">
              <h2 id="project-manager-title">{{ tr('manageProjects') }}</h2>
            </div>
            <div class="header-actions">
              <button
                class="header-add-button"
                :class="{ active: !editingProjectId }"
                type="button"
                :disabled="busy"
                @click="startAddProject"
              >
                <span class="material-symbols-outlined">add</span>
                <span class="button-label">{{ tr('addProject') }}</span>
              </button>
              <button
                class="close-button"
                type="button"
                :aria-label="tr('close')"
                :disabled="busy"
                @click="close"
              >
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>
          </header>

          <div class="project-modal-body">
            <aside class="project-library-pane">
              <div class="library-heading">
                <div>
                  <span>{{ tr('savedProjects') }}</span>
                  <strong>
                    {{
                      label(
                        `${projects.length} project${projects.length === 1 ? '' : 's'}`,
                        `${projects.length} 个项目`,
                      )
                    }}
                  </strong>
                </div>
                <span class="project-count">{{ String(projects.length).padStart(2, '0') }}</span>
              </div>

              <div class="usage-summary">
                <span class="summary-icon material-symbols-outlined">data_usage</span>
                <span class="summary-copy">
                  <small>{{ label('Tracked token usage', '累计统计词元') }}</small>
                  <strong>{{ formatTokens(totalManagedTokens) }}</strong>
                </span>
                <span class="summary-status">
                  <i></i>
                  {{ label('LOCAL', '本地') }}
                </span>
              </div>

              <div v-if="projects.length" class="project-list">
                <button
                  v-for="(project, index) in projects"
                  :key="project.projectId"
                  class="project-list-item"
                  :class="{ selected: editingProjectId === project.projectId }"
                  type="button"
                  :aria-current="editingProjectId === project.projectId ? 'true' : undefined"
                  :disabled="busy"
                  @click="beginEdit(project)"
                >
                  <span
                    class="project-avatar"
                    :style="{
                      color: projectColor(index),
                      backgroundColor: `${projectColor(index)}18`,
                      borderColor: `${projectColor(index)}38`,
                    }"
                  >
                    <span class="material-symbols-outlined">folder</span>
                  </span>
                  <span class="project-copy">
                    <strong>{{ project.name }}</strong>
                    <small :title="project.path">{{ project.path }}</small>
                  </span>
                  <span class="project-item-meta">
                    <strong>{{ formatTokens(project.totalTokens) }}</strong>
                    <span class="material-symbols-outlined">chevron_right</span>
                  </span>
                </button>
              </div>

              <div v-else class="empty-project-list">
                <span class="material-symbols-outlined">create_new_folder</span>
                <strong>{{ tr('noProjects') }}</strong>
              </div>
            </aside>

            <main class="project-editor-pane">
              <div class="editor-heading">
                <span class="editor-mode-icon material-symbols-outlined">
                  {{ editingProjectId ? 'edit_square' : 'create_new_folder' }}
                </span>
                <div>
                  <h3>{{ editingProjectId ? tr('editProject') : tr('addProject') }}</h3>
                </div>
                <span v-if="selectedProject" class="editor-project-chip">
                  <i></i>
                  {{ selectedProject.name }}
                </span>
              </div>

              <div
                v-if="errorMessage || statusMessage"
                class="manager-message"
                :class="{ 'is-error': errorMessage }"
                aria-live="polite"
              >
                <span class="material-symbols-outlined">
                  {{ errorMessage ? 'error' : 'check_circle' }}
                </span>
                <span>{{ errorMessage || statusMessage }}</span>
              </div>

              <form ref="projectForm" class="project-form" @submit.prevent="saveProject">
                <label class="field-group">
                  <span class="field-heading">
                    <span>{{ tr('projectName') }}</span>
                    <small>{{ projectName.length }}/80</small>
                  </span>
                  <span class="input-shell">
                    <span class="material-symbols-outlined">label</span>
                    <input
                      ref="nameInput"
                      v-model="projectName"
                      maxlength="80"
                      autocomplete="off"
                      :placeholder="tr('projectNamePlaceholder')"
                      :disabled="busy"
                    />
                  </span>
                </label>

                <div class="field-group">
                  <span class="field-heading">
                    <span>{{ tr('directory') }}</span>
                    <small>{{ label('Local folder', '本地目录') }}</small>
                  </span>
                  <button
                    class="directory-picker"
                    type="button"
                    :class="{ selected: selectedPath }"
                    :disabled="busy"
                    @click="chooseDirectory"
                  >
                    <span class="directory-icon material-symbols-outlined">folder_open</span>
                    <span class="directory-copy">
                      <strong>{{ selectedPath ? tr('directory') : tr('chooseDirectory') }}</strong>
                      <small :title="selectedPath">
                        {{ selectedPath || tr('noDirectorySelected') }}
                      </small>
                    </span>
                    <span class="browse-label">
                      {{ tr('browse') }}
                      <span class="material-symbols-outlined">arrow_forward</span>
                    </span>
                  </button>
                </div>

                <div class="mapping-note">
                  <span class="material-symbols-outlined">shield_lock</span>
                  <span>
                    {{
                      label(
                        'Only the folder mapping is saved. Your local sessions and files are never changed.',
                        '这里只保存目录映射，不会修改或删除你的本地会话与文件。',
                      )
                    }}
                  </span>
                </div>

                <div
                  v-if="pendingDeleteId && pendingDeleteId === editingProjectId"
                  class="remove-confirmation"
                  role="alert"
                >
                  <span class="danger-icon material-symbols-outlined">folder_delete</span>
                  <span class="danger-copy">
                    <strong>{{ tr('removeProjectConfirm') }}</strong>
                    <small>
                      {{
                        label(
                          'The project disappears from statistics, but local data stays untouched.',
                          '项目将从统计中移除，但本地数据不会受到影响。',
                        )
                      }}
                    </small>
                  </span>
                  <span class="danger-actions">
                    <button type="button" :disabled="busy" @click="pendingDeleteId = ''">
                      {{ tr('cancel') }}
                    </button>
                    <button
                      class="confirm-remove"
                      type="button"
                      :disabled="busy"
                      @click="removeProject(editingProjectId)"
                    >
                      {{ tr('confirmRemove') }}
                    </button>
                  </span>
                </div>

                <footer class="editor-footer">
                  <button
                    v-if="editingProjectId && pendingDeleteId !== editingProjectId"
                    class="remove-project-button"
                    type="button"
                    :disabled="busy"
                    @click="pendingDeleteId = editingProjectId"
                  >
                    <span class="material-symbols-outlined">delete</span>
                    {{ label('Remove from statistics', '移出统计') }}
                  </button>
                  <span v-else></span>

                  <div class="form-actions">
                    <button
                      v-if="editingProjectId || hasDraft"
                      class="secondary-button"
                      type="button"
                      :disabled="busy"
                      @click="cancelEdit"
                    >
                      {{ editingProjectId ? tr('cancelProjectEdit') : label('Clear', '清空') }}
                    </button>
                    <button class="save-button" type="submit" :disabled="!canSubmit">
                      <span class="material-symbols-outlined">
                        {{ editingProjectId ? 'save' : 'add' }}
                      </span>
                      {{ editingProjectId ? tr('saveProjectChanges') : tr('saveProject') }}
                    </button>
                  </div>
                </footer>
              </form>
            </main>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.project-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1400;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, #111827 72%, transparent);
  backdrop-filter: blur(18px) saturate(0.78);
}

.project-modal {
  width: min(940px, 100%);
  height: min(680px, calc(100vh - 48px));
  min-height: 560px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text);
  background: var(--surface-low);
  border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--border));
  border-radius: 22px;
  box-shadow:
    0 40px 120px rgba(2, 6, 23, 0.52),
    0 0 0 1px color-mix(in srgb, white 4%, transparent) inset;
}

.project-modal-header {
  min-height: 88px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 18px 22px;
  background:
    radial-gradient(
      circle at 0 0,
      color-mix(in srgb, var(--primary) 12%, transparent),
      transparent 34%
    ),
    color-mix(in srgb, var(--surface-container) 60%, var(--surface-low));
  border-bottom: 1px solid var(--border);
}

.header-mark {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--bg-base));
  border: 1px solid color-mix(in srgb, var(--primary) 30%, var(--border));
  border-radius: 15px;
  box-shadow: 0 10px 28px color-mix(in srgb, var(--primary) 12%, transparent);
}

.header-mark .material-symbols-outlined {
  font-size: 24px;
}

.header-copy,
.project-copy,
.directory-copy,
.editor-heading > div,
.danger-copy {
  min-width: 0;
}

.header-copy h2 {
  margin: 0;
  color: var(--text);
  font-size: 20px;
  line-height: 1.3;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}

.header-add-button,
.save-button,
.secondary-button,
.remove-project-button,
.remove-confirmation button {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: var(--weight-semibold);
}

.header-add-button {
  padding: 0 13px;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 9%, var(--bg-base));
  border: 1px solid color-mix(in srgb, var(--primary) 28%, var(--border));
}

.header-add-button:hover:not(:disabled),
.header-add-button.active {
  color: var(--on-primary, white);
  background: var(--primary);
  border-color: var(--primary);
  box-shadow: 0 8px 22px color-mix(in srgb, var(--primary) 22%, transparent);
}

.header-add-button .material-symbols-outlined {
  font-size: 17px;
}

.close-button {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--text-soft);
  background: color-mix(in srgb, var(--bg-base) 65%, transparent);
  border: 1px solid transparent;
  border-radius: 11px;
}

.close-button:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface-container-high);
  border-color: var(--border);
}

.project-modal-body {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(280px, 0.82fr) minmax(0, 1.45fr);
}

.project-library-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 18px;
  overflow: hidden;
  background: color-mix(in srgb, var(--surface-container) 62%, var(--surface-low));
  border-right: 1px solid var(--border);
}

.library-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 3px;
}

.library-heading > div {
  display: grid;
  gap: 2px;
}

.library-heading span,
.summary-copy small,
.field-heading small {
  color: var(--text-soft);
  font-size: 10px;
}

.library-heading strong {
  color: var(--text);
  font-size: 14px;
}

.project-count {
  min-width: 34px;
  height: 28px;
  display: grid;
  place-items: center;
  color: var(--primary) !important;
  background: color-mix(in srgb, var(--primary) 10%, var(--bg-base));
  border: 1px solid color-mix(in srgb, var(--primary) 24%, var(--border));
  border-radius: 999px;
  font-family: var(--font-number);
  font-size: 11px !important;
  font-weight: var(--weight-semibold);
}

.usage-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--primary) 11%, var(--bg-base)),
    color-mix(in srgb, #38bdf8 6%, var(--bg-base))
  );
  border: 1px solid color-mix(in srgb, var(--primary) 20%, var(--border));
  border-radius: 13px;
}

.summary-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  border-radius: 10px;
  font-size: 18px;
}

.summary-copy {
  display: grid;
  gap: 2px;
}

.summary-copy strong {
  color: var(--text);
  font-family: var(--font-number);
  font-size: 15px;
}

.summary-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-soft);
  font-size: 9px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.08em;
}

.summary-status i,
.editor-project-chip i {
  width: 6px;
  height: 6px;
  background: #22c55e;
  border-radius: 50%;
  box-shadow: 0 0 0 3px color-mix(in srgb, #22c55e 12%, transparent);
}

.project-list {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 8px;
  padding-right: 3px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.project-list-item {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 11px 10px;
  color: inherit;
  background: color-mix(in srgb, var(--bg-base) 72%, transparent);
  border: 1px solid transparent;
  border-radius: 13px;
  text-align: left;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.project-list-item:hover:not(:disabled) {
  transform: translateY(-1px);
  background: var(--bg-base);
  border-color: var(--border-strong);
  box-shadow: 0 8px 24px color-mix(in srgb, #020617 8%, transparent);
}

.project-list-item.selected {
  background: color-mix(in srgb, var(--primary) 9%, var(--bg-base));
  border-color: color-mix(in srgb, var(--primary) 42%, var(--border));
  box-shadow:
    0 10px 26px color-mix(in srgb, var(--primary) 10%, transparent),
    3px 0 0 color-mix(in srgb, var(--primary) 72%, transparent) inset;
}

.project-list-item:focus-visible,
.directory-picker:focus-visible,
.header-add-button:focus-visible,
.close-button:focus-visible,
.save-button:focus-visible,
.secondary-button:focus-visible,
.remove-project-button:focus-visible,
.remove-confirmation button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--primary) 62%, transparent);
  outline-offset: 2px;
}

.project-avatar {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid;
  border-radius: 11px;
}

.project-avatar .material-symbols-outlined {
  font-size: 19px;
  font-variation-settings: 'FILL' 1;
}

.project-copy {
  display: grid;
  gap: 4px;
}

.project-copy strong,
.project-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-copy strong {
  color: var(--text);
  font-size: 12px;
}

.project-copy small {
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: 9px;
}

.project-item-meta {
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  gap: 3px;
  color: var(--text-soft);
}

.project-item-meta strong {
  color: var(--primary);
  font-family: var(--font-number);
  font-size: 10px;
}

.project-item-meta .material-symbols-outlined {
  font-size: 16px;
}

.project-list-item.selected .project-item-meta .material-symbols-outlined {
  color: var(--primary);
  transform: translateX(1px);
}

.empty-project-list {
  min-height: 190px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  padding: 24px 18px;
  color: var(--text-soft);
  background: color-mix(in srgb, var(--bg-base) 56%, transparent);
  border: 1px dashed var(--border-strong);
  border-radius: 14px;
  text-align: center;
}

.empty-project-list .material-symbols-outlined {
  color: var(--primary);
  font-size: 30px;
}

.empty-project-list strong {
  color: var(--text-muted);
  font-size: 12px;
}

.project-editor-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 26px 28px 24px;
  overflow-y: auto;
  background:
    radial-gradient(
      circle at 100% 0,
      color-mix(in srgb, var(--primary) 7%, transparent),
      transparent 34%
    ),
    var(--surface-low);
}

.editor-heading {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.editor-mode-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 9%, var(--bg-base));
  border: 1px solid color-mix(in srgb, var(--primary) 24%, var(--border));
  border-radius: 12px;
  font-size: 20px;
}

.editor-heading h3 {
  margin: 0;
  color: var(--text);
  font-size: 17px;
  line-height: 1.35;
}

.editor-project-chip {
  max-width: 150px;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  overflow: hidden;
  padding: 0 10px;
  color: var(--text-muted);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 10px;
  font-weight: var(--weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manager-message {
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  color: #16a34a;
  background: color-mix(in srgb, #22c55e 8%, transparent);
  border: 1px solid color-mix(in srgb, #22c55e 24%, transparent);
  border-radius: 10px;
  font-size: 11px;
}

.manager-message.is-error {
  color: #ef4444;
  background: color-mix(in srgb, #ef4444 8%, transparent);
  border-color: color-mix(in srgb, #ef4444 24%, transparent);
}

.manager-message .material-symbols-outlined {
  font-size: 17px;
}

.project-form {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field-group {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.field-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: var(--weight-semibold);
}

.input-shell {
  min-width: 0;
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 13px;
  color: var(--text-soft);
  background: color-mix(in srgb, var(--bg-base) 84%, transparent);
  border: 1px solid var(--border);
  border-radius: 12px;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    background 0.16s ease;
}

.input-shell:focus-within {
  background: var(--bg-base);
  border-color: color-mix(in srgb, var(--primary) 62%, var(--border));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 9%, transparent);
}

.input-shell .material-symbols-outlined {
  color: var(--primary);
  font-size: 18px;
}

.input-shell input {
  min-width: 0;
  flex: 1;
  color: var(--text);
  background: transparent;
  border: 0;
  outline: 0;
  font-size: 13px;
}

.input-shell input::placeholder {
  color: var(--text-soft);
}

.directory-picker {
  width: 100%;
  min-width: 0;
  min-height: 72px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 11px 13px;
  color: inherit;
  background: color-mix(in srgb, var(--bg-base) 74%, transparent);
  border: 1px dashed var(--border-strong);
  border-radius: 13px;
  text-align: left;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    background 0.16s ease;
}

.directory-picker:hover:not(:disabled),
.directory-picker.selected {
  background: var(--bg-base);
  border-style: solid;
  border-color: color-mix(in srgb, var(--primary) 44%, var(--border));
  box-shadow: 0 8px 24px color-mix(in srgb, var(--primary) 7%, transparent);
}

.directory-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  border-radius: 11px;
  font-size: 20px;
}

.directory-copy {
  display: grid;
  gap: 4px;
}

.directory-copy strong {
  color: var(--text-muted);
  font-size: 11px;
}

.directory-copy small {
  overflow: hidden;
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.browse-label {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--primary);
  font-size: 11px;
  font-weight: var(--weight-semibold);
}

.browse-label .material-symbols-outlined {
  font-size: 15px;
}

.mapping-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 11px;
  color: var(--text-soft);
  background: color-mix(in srgb, var(--surface-container) 58%, transparent);
  border-radius: 10px;
  font-size: 10px;
  line-height: 1.55;
}

.mapping-note .material-symbols-outlined {
  flex: 0 0 auto;
  color: #22c55e;
  font-size: 16px;
}

.remove-confirmation {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: color-mix(in srgb, #ef4444 7%, var(--bg-base));
  border: 1px solid color-mix(in srgb, #ef4444 28%, var(--border));
  border-radius: 12px;
}

.danger-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  color: #ef4444;
  background: color-mix(in srgb, #ef4444 11%, transparent);
  border-radius: 10px;
  font-size: 18px;
}

.danger-copy {
  display: grid;
  gap: 3px;
}

.danger-copy strong {
  color: var(--text);
  font-size: 10px;
}

.danger-copy small {
  color: var(--text-soft);
  font-size: 9px;
  line-height: 1.45;
}

.danger-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.remove-confirmation button {
  min-height: 30px;
  padding: 0 9px;
  color: var(--text-muted);
  background: var(--surface-container);
  border: 1px solid var(--border);
  font-size: 9px;
}

.remove-confirmation .confirm-remove {
  color: #fff;
  background: #dc2626;
  border-color: #dc2626;
}

.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: auto;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.secondary-button {
  padding: 0 13px;
  color: var(--text-muted);
  background: var(--bg-base);
  border: 1px solid var(--border);
}

.secondary-button:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface-container-high);
  border-color: var(--border-strong);
}

.save-button {
  padding: 0 16px;
  color: var(--on-primary, white);
  background: linear-gradient(
    135deg,
    var(--primary),
    color-mix(in srgb, var(--primary) 76%, #7c3aed)
  );
  border: 0;
  box-shadow: 0 10px 26px color-mix(in srgb, var(--primary) 24%, transparent);
}

.save-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 13px 30px color-mix(in srgb, var(--primary) 30%, transparent);
}

.save-button .material-symbols-outlined,
.remove-project-button .material-symbols-outlined {
  font-size: 16px;
}

.remove-project-button {
  padding: 0 11px;
  color: #ef4444;
  background: transparent;
  border: 1px solid color-mix(in srgb, #ef4444 22%, var(--border));
}

.remove-project-button:hover:not(:disabled) {
  background: color-mix(in srgb, #ef4444 8%, transparent);
  border-color: color-mix(in srgb, #ef4444 42%, var(--border));
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.project-modal-enter-active,
.project-modal-leave-active {
  transition: opacity 0.18s ease;
}

.project-modal-enter-active .project-modal,
.project-modal-leave-active .project-modal {
  transition:
    transform 0.22s ease,
    opacity 0.18s ease;
}

.project-modal-enter-from,
.project-modal-leave-to {
  opacity: 0;
}

.project-modal-enter-from .project-modal,
.project-modal-leave-to .project-modal {
  opacity: 0;
  transform: translateY(12px) scale(0.985);
}

@media (max-width: 760px) {
  .project-modal {
    height: min(760px, calc(100vh - 28px));
    min-height: 0;
  }

  .project-modal-body {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .project-library-pane {
    min-height: 250px;
    max-height: 300px;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .project-editor-pane {
    min-height: 430px;
    overflow: visible;
  }

  .project-list {
    grid-auto-flow: column;
    grid-auto-columns: minmax(245px, 82%);
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0 0 4px;
  }
}

@media (max-width: 560px) {
  .project-modal-overlay {
    align-items: end;
    padding: 8px;
  }

  .project-modal {
    height: calc(100vh - 16px);
    border-radius: 18px;
  }

  .project-modal-header {
    min-height: 76px;
    gap: 10px;
    padding: 14px;
  }

  .header-mark {
    width: 42px;
    height: 42px;
  }

  .header-add-button {
    width: 38px;
    padding: 0;
  }

  .header-add-button .button-label {
    display: none;
  }

  .project-library-pane,
  .project-editor-pane {
    padding-left: 16px;
    padding-right: 16px;
  }

  .editor-heading {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .editor-project-chip {
    display: none;
  }

  .remove-confirmation {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .danger-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }

  .editor-footer {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .remove-project-button,
  .form-actions {
    width: 100%;
  }

  .form-actions > button {
    flex: 1;
  }
}
</style>
