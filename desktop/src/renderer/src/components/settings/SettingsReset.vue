<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import { resetBrowsingState } from '../../composables/usePageState'
import { resetWindowMaterial } from '../../composables/useWindowMaterial'
import { useReplayTask } from '../../replay/replay-task'
import { restoreDefaultSettings } from '../../utils/restore-default-settings'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'

const { label } = useI18n()
const task = useReplayTask()
const generating = computed(() => task.busy.value || task.preparing.value)
const open = ref(false)
const busy = ref(false)
const failed = ref(false)

async function restore(): Promise<void> {
  if (busy.value || generating.value) return
  busy.value = true
  failed.value = false
  try {
    await restoreDefaultSettings({
      api: window.api,
      storage: localStorage,
      resetMaterial: resetWindowMaterial,
      resetBrowsing: resetBrowsingState,
    })
    window.location.reload()
  } catch {
    failed.value = true
    busy.value = false
  }
}
</script>

<template>
  <section class="preference-section" :data-window-retain="busy">
    <h2>{{ label('Restore default settings', '恢复默认设置') }}</h2>
    <div class="preference-row">
      <div>
        <h3>{{ label('Reset app preferences', '重置应用偏好') }}</h3>
        <p>
          {{
            label(
              'Restore appearance, page filters, refresh, window and export preferences.',
              '恢复外观、页面筛选、刷新、窗口与导出偏好。',
            )
          }}
        </p>
      </div>
      <button
        type="button"
        class="workspace-button"
        :disabled="busy || generating"
        @click="open = true"
      >
        {{ label('Restore default settings', '恢复默认设置') }}
      </button>
    </div>
    <p v-if="generating" class="preference-description" role="status">
      {{
        label(
          'Wait for generation to finish before restoring settings.',
          '请等待当前生成完成后再恢复设置。',
        )
      }}
    </p>
  </section>
  <WorkspaceDialog
    :open="open"
    :busy="busy"
    :title="label('Restore default settings?', '恢复默认设置？')"
    @close="open = false"
  >
    <div class="reset-description">
      <p>
        {{
          label(
            'Restore the light Classic theme, solid background, default fonts and tonal charts. Reset page filters, sorting and export preferences; close the mini window and turn off automatic refresh and network monitoring.',
            '恢复浅色经典主题、纯色背景、默认字体和同色系图表，重置页面筛选、排序与导出偏好，关闭悬浮窗、自动刷新和网络监控。',
          )
        }}
      </p>
      <p>
        {{
          label(
            'Your current language, sign-in, usage data, favorites, monitored app list, feedback draft, generated files and storage location will be kept. The interface will reload when finished.',
            '保留当前语言、登录状态、用量数据、收藏、监控应用列表、反馈草稿、生成文件及其存储位置。完成后界面会自动刷新。',
          )
        }}
      </p>
      <p v-if="failed" class="workspace-error" role="alert">
        {{
          label(
            'Some preferences could not be restored. Completed changes have been kept; please retry.',
            '部分设置未能恢复，已完成的更改已保留，请重试。',
          )
        }}
      </p>
      <p v-if="generating" role="status">
        {{
          label(
            'Wait for generation to finish before restoring settings.',
            '请等待当前生成完成后再恢复设置。',
          )
        }}
      </p>
    </div>
    <template #footer>
      <button type="button" class="workspace-button" :disabled="busy" @click="open = false">
        {{ label('Cancel', '取消') }}
      </button>
      <button
        type="button"
        class="workspace-button workspace-button--primary"
        :disabled="busy || generating"
        @click="restore"
      >
        {{ busy ? label('Restoring…', '正在恢复…') : label('Restore defaults', '确认恢复') }}
      </button>
    </template>
  </WorkspaceDialog>
</template>

<style scoped>
.reset-description {
  color: var(--text-soft);
  font-size: 14px;
  line-height: 1.7;
}
.reset-description p {
  margin: 0 0 16px;
}
.reset-description p:last-child {
  margin-bottom: 0;
}
</style>
