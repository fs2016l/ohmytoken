<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useUpdater, type UpdateInfo, type UpdateStatus } from '../../composables/useUpdater'
import { useI18n } from '../../i18n/useI18n'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import DesignIcon from '../base/DesignIcon.vue'

type DialogStatus = Exclude<UpdateStatus, 'idle'>

const { tr, label } = useI18n()
const updater = useUpdater({ versionFallback: '1.0.0', latestResetMs: 2000, errorResetMs: 2000 })
const open = ref(false)
const dialogStatus = ref<DialogStatus>('checking')
const displayedInfo = ref<UpdateInfo | null>(null)
const displayedError = ref('')
let unsubscribe: (() => void) | undefined

const currentVersion = computed(() => updater.currentVersion.value || '—')
const downloadPercent = computed(() =>
  Math.max(0, Math.min(100, Math.round(updater.percent.value))),
)
const releaseDate = computed(() => displayedInfo.value?.releaseDate?.slice(0, 10) || '')
const releaseNotes = computed(() => String(displayedInfo.value?.releaseNotes || '').trim())
const statusIcons = {
  checking: 'networkRefresh',
  available: 'update',
  downloading: 'download',
  paused: 'download',
  'waiting-network': 'networkRefresh',
  verifying: 'circleCheck',
  downloaded: 'circleCheck',
  latest: 'circleCheck',
  error: 'networkInfo',
} as const
const statusTitles = {
  checking: 'trayUpdateCheckingTitle',
  available: 'trayUpdateAvailableTitle',
  downloading: 'trayUpdateDownloadingTitle',
  downloaded: 'trayUpdateDownloadedTitle',
  latest: 'trayUpdateLatestTitle',
  error: 'trayUpdateErrorTitle',
} as const
const statusTitle = computed(() => {
  if (dialogStatus.value === 'paused') return label('Download paused', '下载已暂停')
  if (dialogStatus.value === 'waiting-network') return label('Waiting for network', '等待网络恢复')
  if (dialogStatus.value === 'verifying') return label('Verifying update', '正在校验更新')
  return tr(statusTitles[dialogStatus.value])
})
const versionDescription = computed(() => {
  if (
    ['downloading', 'paused', 'waiting-network', 'verifying', 'downloaded'].includes(
      dialogStatus.value,
    ) &&
    displayedInfo.value?.version
  )
    return `Oh My Token v${displayedInfo.value.version}`
  return `${tr('trayUpdateCurrentVersion')} v${currentVersion.value}`
})

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function syncFromUpdater(): void {
  const status = updater.status.value
  // Keep the result visible after the shared updater resets to idle.
  if (status === 'idle') return
  dialogStatus.value = status
  if (updater.info.value) displayedInfo.value = { ...updater.info.value }
  if (status === 'error') displayedError.value = updater.error.value || tr('trayUpdateUnknownError')
}

async function runCheck(): Promise<void> {
  dialogStatus.value = 'checking'
  displayedInfo.value = null
  displayedError.value = ''
  await updater.init()
  await updater.check()
  syncFromUpdater()
}

async function show(): Promise<void> {
  if (open.value) return
  const hasActiveUpdate = () =>
    [
      'checking',
      'available',
      'downloading',
      'paused',
      'waiting-network',
      'verifying',
      'downloaded',
    ].includes(updater.status.value)
  if (hasActiveUpdate()) syncFromUpdater()
  else {
    dialogStatus.value = 'checking'
    displayedInfo.value = null
    displayedError.value = ''
  }
  open.value = true
  await updater.init()
  if (hasActiveUpdate()) syncFromUpdater()
  else await runCheck()
}

function close(): void {
  open.value = false
}

async function download(): Promise<void> {
  if (updater.status.value === 'downloading') return
  dialogStatus.value = 'downloading'
  displayedError.value = ''
  await updater.download()
  syncFromUpdater()
}

watch([updater.status, updater.info, updater.error], () => {
  if (open.value) syncFromUpdater()
})

onMounted(() => {
  unsubscribe = window.api.onTrayCheckUpdateRequested(() => void show())
})
onUnmounted(() => unsubscribe?.())

defineExpose({ show })
</script>

<template>
  <WorkspaceDialog
    class="update-dialog"
    :class="`status-${dialogStatus}`"
    :open="open"
    :title="tr('trayUpdateEyebrow')"
    @close="close"
  >
    <template #heading>
      <h2 class="dialog-heading">
        <DesignIcon name="update" :size="16" />
        {{ tr('trayUpdateEyebrow') }}
      </h2>
    </template>

    <div class="update-status">
      <div class="status-visual" aria-hidden="true">
        <DesignIcon
          :name="statusIcons[dialogStatus]"
          :size="23"
          :class="{ spinning: dialogStatus === 'checking' }"
        />
      </div>
      <div class="dialog-copy" aria-live="polite">
        <h3>{{ statusTitle }}</h3>
        <p>
          {{ dialogStatus === 'checking' ? tr('trayUpdateCheckingDesc') : versionDescription }}
        </p>
      </div>
    </div>

    <div v-if="dialogStatus === 'available' && displayedInfo" class="release-card">
      <div class="release-heading">
        <span>{{ label("What's new", '本次更新') }}</span>
        <strong>v{{ displayedInfo.version }}</strong>
      </div>
      <p v-if="releaseNotes" class="release-notes">{{ releaseNotes }}</p>
      <p v-else class="release-notes">{{ tr('trayUpdateNoReleaseNotes') }}</p>
      <p v-if="releaseDate" class="release-date">{{ releaseDate }}</p>
    </div>

    <template
      v-else-if="['downloading', 'paused', 'waiting-network', 'verifying'].includes(dialogStatus)"
    >
      <div class="download-card">
        <div class="progress-heading">
          <span>{{ tr('trayUpdateDownloadProgress') }}</span>
          <strong>{{ downloadPercent }}%</strong>
        </div>
        <div
          class="progress-track"
          role="progressbar"
          :aria-label="tr('trayUpdateDownloadProgress')"
          :aria-valuenow="downloadPercent"
          :aria-valuemin="0"
          :aria-valuemax="100"
        >
          <span class="progress-fill" :style="{ width: `${downloadPercent}%` }" />
        </div>
        <div v-if="updater.progress.value" class="progress-meta">
          <span>
            {{ label('Downloaded', '已下载') }}
            {{ formatBytes(updater.progress.value.transferred) }}
          </span>
          <span>{{ label('Total', '共') }} {{ formatBytes(updater.progress.value.total) }}</span>
        </div>
      </div>
      <p class="status-detail">
        {{
          dialogStatus === 'paused'
            ? label(
                'Your progress is saved. Continue whenever you are ready.',
                '进度已保存，点击继续下载即可恢复。',
              )
            : dialogStatus === 'waiting-network'
              ? label(
                  'Download will resume automatically when the network recovers.',
                  '网络恢复后将自动继续下载。',
                )
              : dialogStatus === 'verifying'
                ? label(
                    'Checking the package and preparing installation…',
                    '正在校验更新包并准备安装…',
                  )
                : tr('trayUpdateDownloadingDesc')
        }}
      </p>
    </template>

    <p v-else-if="dialogStatus === 'downloaded'" class="status-detail">
      {{ tr('trayUpdateDownloadedDesc') }}
    </p>
    <p v-else-if="dialogStatus === 'latest'" class="status-detail result-detail">
      {{ tr('trayUpdateLatestDesc') }}
    </p>
    <p v-else-if="dialogStatus === 'error'" class="error-card" role="alert">
      {{ displayedError }}
    </p>
    <p v-else class="status-detail result-detail">
      {{ tr('trayUpdateCurrentVersion') }} v{{ currentVersion }}
    </p>

    <template #footer>
      <template v-if="['downloading', 'paused', 'waiting-network'].includes(dialogStatus)">
        <button class="workspace-button quiet-action" type="button" @click="close">
          {{ dialogStatus === 'paused' ? tr('close') : tr('trayUpdateBackgroundDownload') }}
        </button>
        <button
          class="workspace-button workspace-button--primary"
          type="button"
          @click="dialogStatus === 'paused' ? updater.resume() : updater.pause()"
        >
          {{
            dialogStatus === 'paused'
              ? label('Continue download', '继续下载')
              : label('Pause download', '暂停下载')
          }}
        </button>
      </template>
      <template v-else-if="dialogStatus === 'available'">
        <button class="workspace-button quiet-action" type="button" @click="close">
          {{ tr('trayUpdateLater') }}
        </button>
        <button class="workspace-button workspace-button--primary" type="button" @click="download">
          <DesignIcon name="download" :size="14" />
          {{ label('Download update', '下载更新') }}
        </button>
      </template>
      <template v-else-if="dialogStatus === 'downloaded'">
        <button class="workspace-button quiet-action" type="button" @click="close">
          {{ tr('trayUpdateLater') }}
        </button>
        <button
          class="workspace-button workspace-button--primary"
          type="button"
          @click="updater.install"
        >
          <DesignIcon name="floatingRefresh" :size="14" />
          {{ label('Restart and update', '重启并更新') }}
        </button>
      </template>
      <template v-else-if="dialogStatus === 'latest'">
        <button class="workspace-button quiet-action" type="button" @click="runCheck">
          <DesignIcon name="networkRefresh" :size="14" />
          {{ tr('trayUpdateCheckAgain') }}
        </button>
        <button class="workspace-button workspace-button--primary" type="button" @click="close">
          {{ tr('trayUpdateDone') }}
        </button>
      </template>
      <template v-else-if="dialogStatus === 'error'">
        <button class="workspace-button quiet-action" type="button" @click="close">
          {{ tr('close') }}
        </button>
        <button
          class="workspace-button workspace-button--primary"
          type="button"
          @click="updater.info.value ? updater.resume() : runCheck()"
        >
          <DesignIcon name="networkRefresh" :size="14" />
          {{ tr('updateRetry') }}
        </button>
      </template>
      <button v-else class="workspace-button" type="button" @click="close">
        {{
          dialogStatus === 'downloading'
            ? tr('trayUpdateBackgroundDownload')
            : tr('trayUpdateRunInBackground')
        }}
      </button>
    </template>
  </WorkspaceDialog>
</template>

<style scoped>
/* WorkspaceDialog teleports its root, so target its forwarded class explicitly. */
:global(.workspace-dialog.update-dialog) {
  --dialog-width: 408px;
  --status-color: var(--accent);
  background: var(--surface-low);
}
:global(.workspace-dialog.update-dialog::backdrop) {
  background: color-mix(in srgb, var(--omt-overlay-scrim) 30%, transparent);
}
:global(.update-dialog.status-latest),
:global(.update-dialog.status-downloaded) {
  --status-color: var(--success);
}
:global(.update-dialog.status-error) {
  --status-color: var(--warning);
}
:global(.update-dialog > header) {
  padding: 14px 16px 12px 24px;
  border: 0;
}
:global(.update-dialog > .dialog-content) {
  padding: 7px 24px 24px;
}
:global(.update-dialog > footer) {
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 24px 21px;
  border: 0;
}
.dialog-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  font-weight: 500;
}
.dialog-heading .design-icon {
  color: var(--accent);
}
.update-status {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 57px;
}
.status-visual {
  display: grid;
  place-items: center;
  flex: 0 0 43px;
  width: 43px;
  height: 43px;
  border-radius: 12px;
  color: var(--status-color);
  background: color-mix(in srgb, var(--status-color) 10%, var(--surface-low));
}
.dialog-copy {
  min-width: 0;
}
.dialog-copy h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
  line-height: 1.5;
}
.dialog-copy p,
.status-detail {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.8;
}
.status-detail {
  margin-top: 15px;
}
.result-detail {
  margin-top: 21px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.release-card,
.download-card {
  margin-top: 23px;
  padding: 16px 17px 14px;
  border-radius: 9px;
  background: var(--surface-container);
}
.release-heading,
.progress-heading,
.progress-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  font-size: 12px;
}
.release-heading strong {
  color: var(--accent);
  font-weight: 500;
}
.release-notes {
  max-height: 180px;
  overflow-y: auto;
  overflow-wrap: anywhere;
  margin: 10px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.8;
  white-space: pre-wrap;
}
.release-date {
  margin: 12px 0 0;
  color: var(--text-soft);
  font-size: 11px;
}
.progress-heading strong {
  font-size: 19px;
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.progress-track {
  height: 6px;
  margin-top: 12px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--border);
}
.progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--primary);
  transition: width var(--motion-hover) var(--motion-ease);
}
.progress-meta {
  flex-wrap: wrap;
  margin-top: 9px;
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.error-card {
  margin: 21px 0 0;
  padding: 12px 14px;
  border-radius: 8px;
  color: var(--status-color);
  background: color-mix(in srgb, var(--status-color) 10%, var(--surface-low));
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.8;
}
:global(.update-dialog > footer .workspace-button) {
  min-height: 34px;
  padding: 0 14px;
  gap: 7px;
  font-size: 12px;
  border-radius: 7px;
}
.quiet-action {
  color: var(--text-muted);
  background: transparent;
  border-color: transparent;
}
.spinning {
  animation: update-spin 1.5s linear infinite;
}
@keyframes update-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 480px) {
  :global(.workspace-dialog.update-dialog) {
    width: calc(100vw - 24px);
  }
  :global(.update-dialog > header) {
    padding-left: 18px;
  }
  :global(.update-dialog > .dialog-content) {
    padding-inline: 18px;
  }
  :global(.update-dialog > footer) {
    padding-inline: 18px;
  }
  .dialog-copy h3 {
    font-size: 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
  .progress-fill {
    transition: none;
  }
}
</style>
