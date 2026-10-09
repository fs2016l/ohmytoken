<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ProjectWorkspaceItem } from '@shared/models'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import { useI18n } from '../../i18n/useI18n'
const props = defineProps<{ project: ProjectWorkspaceItem | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const { label } = useI18n()
const name = ref('')
const notes = ref(''),
  error = ref(''),
  busy = ref(false)
watch(
  () => props.project,
  (project) => {
    name.value = project?.name || ''
    notes.value = project?.notes || ''
    error.value = ''
  },
)
async function save(): Promise<void> {
  if (!props.project || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await window.api.updateProjectNotes({
      projectId: props.project.projectId,
      notes: notes.value,
      name: name.value,
    })
    emit('saved')
    emit('close')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <WorkspaceDialog
    :open="!!project"
    :title="label('Edit project name and notes', '编辑项目备注名')"
    :busy="busy"
    @close="emit('close')"
  >
    <form id="project-notes-form" @submit.prevent="save">
      <label for="project-display-name">{{ label('Display name', '备注名') }}</label>
      <input
        id="project-display-name"
        v-model="name"
        class="workspace-input project-name"
        maxlength="80"
        required
        :disabled="busy"
        autofocus
      />
      <label for="project-notes">{{ label('Notes (optional)', '备注（可选）') }}</label>
      <textarea
        id="project-notes"
        v-model="notes"
        class="workspace-input"
        maxlength="4000"
        rows="7"
        :disabled="busy"
      />
      <p class="notes-length">{{ notes.length }} / 4,000</p>
      <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <button type="button" class="workspace-button" :disabled="busy" @click="emit('close')">
        {{ label('Cancel', '取消') }}
      </button>
      <button
        type="submit"
        form="project-notes-form"
        class="workspace-button workspace-button--primary"
        :disabled="busy || !name.trim()"
      >
        {{ busy ? label('Saving…', '保存中…') : label('Save', '保存') }}
      </button>
    </template>
  </WorkspaceDialog>
</template>
<style scoped>
label {
  display: block;
  font-size: 13px;
  margin-bottom: 12px;
}
textarea {
  display: block;
  width: 100%;
  height: auto;
  padding: 12px;
  resize: vertical;
  min-height: 140px;
}
.project-name {
  width: 100%;
  margin-bottom: 20px;
}
.notes-length {
  color: var(--text-soft);
  font-size: 12px;
  text-align: right;
  margin: 8px 0 0;
}
</style>
