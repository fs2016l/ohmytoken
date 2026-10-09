<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import DesignIcon from '../base/DesignIcon.vue'
const { label } = useI18n()
const canUpload = ref(false),
  busy = ref(false),
  status = ref<'idle' | 'success' | 'error'>('idle'),
  message = ref(''),
  loadError = ref('')
let unsubscribe: (() => void) | undefined,
  revision = 0,
  disposed = false
async function load(): Promise<void> {
  const current = revision
  loadError.value = ''
  try {
    const result = await window.api.getDiagnosticUploadState()
    if (!disposed && current === revision) canUpload.value = result.canUpload
  } catch {
    if (!disposed)
      loadError.value = label('Could not read diagnostic upload status.', '无法读取诊断上传状态。')
  }
}
onMounted(() => {
  unsubscribe = window.api.onDiagnosticUploadStateChanged((value) => {
    revision++
    canUpload.value = value.canUpload
  })
  void load()
})
onBeforeUnmount(() => {
  disposed = true
  unsubscribe?.()
})
async function openLogs(): Promise<void> {
  try {
    await window.api.openDiagnosticLogs()
  } catch (reason) {
    status.value = 'error'
    message.value =
      reason instanceof Error ? reason.message : label('Could not open logs', '无法打开日志')
  }
}
async function upload(): Promise<void> {
  if (busy.value || !canUpload.value) return
  busy.value = true
  status.value = 'idle'
  message.value = ''
  try {
    const result = await window.api.uploadDiagnosticReport({
      reportType: 'manual',
      source: 'settings',
      stage: 'manual',
      summary: label('User-uploaded diagnostic logs', '用户手动上传诊断日志'),
    })
    if (result.cancelled) return
    if (typeof result.id !== 'number')
      throw new Error(label('Invalid upload result', '上传结果无效'))
    status.value = 'success'
    message.value = label(
      'Diagnostic report #' + result.id + ' uploaded',
      '诊断报告 #' + result.id + ' 已上传',
    )
    await load()
  } catch (reason) {
    status.value = 'error'
    message.value = reason instanceof Error ? reason.message : label('Upload failed', '上传失败')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section class="preference-section">
    <h2>{{ label('Local logs', '本地日志') }}</h2>
    <div class="preference-row">
      <div>
        <h3>{{ label('Application logs', '应用运行日志') }}</h3>
        <p>
          {{
            label(
              'Review recent runtime, interface and update errors.',
              '查看近期运行、界面与更新相关的错误信息',
            )
          }}
        </p>
      </div>
      <button type="button" class="workspace-button" @click="openLogs">
        {{ label('Open logs', '打开日志') }}
      </button>
    </div>
  </section>
  <section class="preference-section" :data-window-retain="busy">
    <h2>{{ label('Diagnostic report', '诊断报告') }}</h2>
    <div class="preference-card">
      <div class="preference-row">
        <DesignIcon name="settingsLogs" :size="24" />
        <div class="diagnostic-description">
          <h3>{{ label('Upload recent errors', '上传最近错误信息') }}</h3>
          <p>
            {{
              label(
                'Help locate crashes, interface issues and update failures.',
                '帮助开发者定位崩溃、界面或更新异常。',
              )
            }}
          </p>
        </div>
        <button
          v-if="canUpload"
          type="button"
          class="workspace-button workspace-button--primary"
          :disabled="busy"
          @click="upload"
        >
          {{
            busy
              ? label('Uploading…', '上传中…')
              : status === 'error'
                ? label('Retry upload', '重新上传')
                : label('Upload logs', '上传日志')
          }}
        </button>
      </div>
      <p class="preference-description">
        {{
          label(
            'You can inspect your local logs before uploading.',
            '你可以在上传前先查看本地日志。',
          )
        }}
      </p>
      <p v-if="status !== 'idle'" class="preference-status" :class="status" role="status">
        {{ message }}
      </p>
      <p v-if="loadError" class="preference-status error" role="alert">
        {{ loadError }}
        <button type="button" class="workspace-link" @click="load">
          {{ label('Retry', '重试') }}
        </button>
      </p>
    </div>
    <div class="preference-notice diagnostic-notice">
      <DesignIcon name="settingsAbout" :size="20" />
      <div>
        <h3>{{ label('Error diagnostics', '异常诊断') }}</h3>
        <p>
          {{
            label(
              'Crash, interface and update failures send a minimal diagnostic event automatically. You can manually upload recent error information when more investigation is needed.',
              '崩溃、界面和更新异常会自动发送最小诊断事件。需要进一步排查时，可以手动上传最近错误信息，帮助开发者完善软件。',
            )
          }}
        </p>
      </div>
    </div>
  </section>
</template>
<style scoped>
.diagnostic-description {
  flex: 1;
  min-width: 0;
}
.diagnostic-notice {
  margin-top: 32px;
}
</style>
