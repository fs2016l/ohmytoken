<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, useId } from 'vue'
import type { CodexScanScope, CodexScanScopeRequest } from '@shared/codex-scan-scope'
import { useI18n } from '../../i18n/useI18n'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'

const { label } = useI18n()
const request = shallowRef<CodexScanScopeRequest | null>(null)
const scope = ref<CodexScanScope>('recent')
const saving = ref(false)
const error = ref('')
const group = useId()
let unsubscribe: (() => void) | undefined
let received = 0

function receive(value: CodexScanScopeRequest | null): void {
  received++
  if (value?.id !== request.value?.id) {
    scope.value = 'recent'
    error.value = ''
  }
  request.value = value
}

async function resolve(value: CodexScanScope | null): Promise<void> {
  if (!request.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    await window.api.codexScanScopeResolve(request.value.id, value)
  } catch {
    error.value = label('Unable to save your choice. Please retry.', '无法保存选择，请重试。')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  if (!window.api.codexScanScopeRead) return
  unsubscribe = window.api.onCodexScanScopeChanged(receive)
  const initial = received
  void window.api
    .codexScanScopeRead()
    .then((value) => {
      if (received === initial) receive(value)
    })
    .catch((reason) => console.error('[codex-scan-scope]', reason))
})
onUnmounted(() => unsubscribe?.())
</script>

<template>
  <WorkspaceDialog
    class="codex-scan-scope-dialog"
    :open="!!request"
    :busy="saving"
    :title="label('Choose statistics dates', '选择统计日期')"
    @close="resolve(null)"
  >
    <fieldset class="scope-options" :disabled="saving">
      <legend>{{ label('Codex statistics dates', 'Codex 统计日期') }}</legend>
      <label class="scope-option" :class="{ selected: scope === 'recent' }">
        <input v-model="scope" type="radio" :name="group" value="recent" />
        <span>
          <span class="scope-heading">
            <strong>{{ label('Recent dates', '统计最近日期') }}</strong>
            <span class="scope-recommended">{{ label('Recommended', '推荐') }}</span>
          </span>
          <span class="scope-description">
            {{
              label(
                'Read only uncompressed Codex data from the last month for faster statistics.',
                '只统计 Codex 最近一个月的未压缩数据，统计速度更快。',
              )
            }}
          </span>
        </span>
      </label>
      <label class="scope-option" :class="{ selected: scope === 'all' }">
        <input v-model="scope" type="radio" :name="group" value="all" />
        <span>
          <span class="scope-heading">
            <strong>{{ label('All dates', '统计全部日期') }}</strong>
          </span>
          <span class="scope-description">
            {{
              label(
                'Read all local Codex history, including compressed archives. Large histories take longer.',
                '统计 Codex 全部本地历史，包括压缩归档；数据较多时耗时更长。',
              )
            }}
          </span>
        </span>
      </label>
    </fieldset>
    <p class="scope-note">
      {{
        label(
          'Only Codex is affected. Other agents keep their existing statistics behavior. You can choose again with Full refresh.',
          '此选择仅影响 Codex，其他 Agent 保持原有统计方式。之后可通过全量刷新重新选择。',
        )
      }}
    </p>
    <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
    <template #footer>
      <button type="button" class="workspace-button" :disabled="saving" @click="resolve(null)">
        {{ label('Cancel', '取消') }}
      </button>
      <button
        type="button"
        class="workspace-button workspace-button--primary"
        :disabled="saving"
        @click="resolve(scope)"
      >
        {{ label('Start statistics', '开始统计') }}
      </button>
    </template>
  </WorkspaceDialog>
</template>

<style scoped>
.scope-options {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  border: 0;
}
.scope-options legend {
  margin-bottom: 16px;
  font-size: 14px;
  color: var(--text-soft);
}
.scope-option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
}
.scope-option.selected {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.scope-option:focus-within {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.scope-option input {
  flex: none;
  margin: 4px 0 0;
  accent-color: var(--primary);
}
.scope-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  line-height: 1.5;
}
.scope-heading strong {
  font-size: 14px;
  font-weight: 500;
}
.scope-recommended {
  padding: 1px 7px;
  border-radius: 6px;
  background: var(--primary);
  color: var(--primary-on);
  font-size: 11px;
}
.scope-description {
  display: block;
  margin-top: 6px;
  color: var(--text-soft);
  font-size: 13px;
  line-height: 1.6;
}
.scope-note {
  margin: 16px 0 0;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 1.7;
}
</style>
