<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useBodyScrollLock } from '../../composables/useBodyScrollLock'
import { useUpdater, type UpdateInfo, type UpdateStatus } from '../../composables/useUpdater'
import { useI18n } from '../../i18n/useI18n'

type DialogStatus = Exclude<UpdateStatus, 'idle'>

const { tr } = useI18n()
const updater = useUpdater({ versionFallback: '1.0.0', latestResetMs: 2000, errorResetMs: 2000 })
const open = ref(false)
const dialogStatus = ref<DialogStatus>('checking')
const displayedInfo = ref<UpdateInfo | null>(null)
const displayedError = ref('')
const dialogRef = ref<HTMLElement>()
let unsubscribe: (() => void) | undefined

useBodyScrollLock(open)

const currentVersion = computed(() => updater.currentVersion.value || '—')
const downloadPercent = computed(() =>
  Math.max(0, Math.min(100, Math.round(updater.percent.value))),
)
const releaseDate = computed(() => displayedInfo.value?.releaseDate?.slice(0, 10) || '')
const releaseNotes = computed(() => String(displayedInfo.value?.releaseNotes || '').trim())

const statusIcon = computed(() => {
  switch (dialogStatus.value) {
    case 'checking':
      return 'sync'
    case 'available':
      return 'system_update_alt'
    case 'downloading':
      return 'downloading'
    case 'downloaded':
      return 'task_alt'
    case 'latest':
      return 'verified'
    case 'error':
      return 'cloud_off'
    default:
      return 'system_update'
  }
})

const statusTitle = computed(() => {
  switch (dialogStatus.value) {
    case 'checking':
      return tr('trayUpdateCheckingTitle')
    case 'available':
      return tr('trayUpdateAvailableTitle')
    case 'downloading':
      return tr('trayUpdateDownloadingTitle')
    case 'downloaded':
      return tr('trayUpdateDownloadedTitle')
    case 'latest':
      return tr('trayUpdateLatestTitle')
    case 'error':
      return tr('trayUpdateErrorTitle')
    default:
      return tr('checkUpdate')
  }
})

const statusDescription = computed(() => {
  switch (dialogStatus.value) {
    case 'checking':
      return tr('trayUpdateCheckingDesc')
    case 'available':
      return tr('trayUpdateAvailableDesc')
    case 'downloading':
      return tr('trayUpdateDownloadingDesc')
    case 'downloaded':
      return tr('trayUpdateDownloadedDesc')
    case 'latest':
      return tr('trayUpdateLatestDesc')
    case 'error':
      return tr('trayUpdateErrorDesc')
    default:
      return ''
  }
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

function syncFromUpdater(status: UpdateStatus = updater.status.value): void {
  if (status === 'idle') return
  dialogStatus.value = status
  if (updater.info.value) displayedInfo.value = { ...updater.info.value }
  if (status === 'error') displayedError.value = updater.error.value || tr('trayUpdateUnknownError')
}

async function focusDialog(): Promise<void> {
  await nextTick()
  dialogRef.value?.focus()
}

async function runCheck(): Promise<void> {
  dialogStatus.value = 'checking'
  displayedInfo.value = null
  displayedError.value = ''
  await updater.init()
  await updater.check()
  syncFromUpdater()
}

async function showFromTray(): Promise<void> {
  open.value = true
  await focusDialog()
  await updater.init()
  if (['available', 'downloading', 'downloaded'].includes(updater.status.value)) {
    syncFromUpdater()
    return
  }
  await runCheck()
}

function close(): void {
  open.value = false
}

async function retry(): Promise<void> {
  await runCheck()
}

async function download(): Promise<void> {
  dialogStatus.value = 'downloading'
  displayedError.value = ''
  await updater.download()
  syncFromUpdater()
}

function install(): void {
  updater.install()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open.value) close()
}

watch(updater.status, (status) => {
  if (open.value) syncFromUpdater(status)
})

onMounted(() => {
  unsubscribe = window.api.onTrayCheckUpdateRequested(() => void showFromTray())
  window.addEventListener('keydown', onKeydown)
  void updater.init()
})

onUnmounted(() => {
  unsubscribe?.()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="tray-update-dialog">
      <div v-if="open" class="update-backdrop" @mousedown.self="close">
        <section
          ref="dialogRef"
          class="update-dialog"
          :class="`status-${dialogStatus}`"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tray-update-title"
          tabindex="-1"
        >
          <button class="dialog-close" type="button" :aria-label="tr('close')" @click="close">
            <span class="material-symbols-outlined">close</span>
          </button>

          <div class="dialog-eyebrow">
            <span class="eyebrow-dot"></span>
            {{ tr('trayUpdateEyebrow') }}
          </div>

          <div class="status-visual" aria-hidden="true">
            <span class="visual-ring"></span>
            <span
              class="material-symbols-outlined"
              :class="{ spinning: dialogStatus === 'checking' || dialogStatus === 'downloading' }"
            >
              {{ statusIcon }}
            </span>
          </div>

          <div class="dialog-copy" aria-live="polite">
            <span class="version-chip">
              {{ tr('trayUpdateCurrentVersion') }} v{{ currentVersion }}
            </span>
            <h2 id="tray-update-title">{{ statusTitle }}</h2>
            <p>{{ statusDescription }}</p>
          </div>

          <div v-if="dialogStatus === 'available' && displayedInfo" class="release-card">
            <div class="release-heading">
              <div>
                <span>{{ tr('trayUpdateNewVersion') }}</span>
                <strong>v{{ displayedInfo.version }}</strong>
              </div>
              <span v-if="releaseDate" class="release-date">
                <span class="material-symbols-outlined">calendar_today</span>
                {{ releaseDate }}
              </span>
            </div>
            <p v-if="releaseNotes" class="release-notes">{{ releaseNotes }}</p>
            <p v-else class="release-notes release-notes--muted">
              {{ tr('trayUpdateNoReleaseNotes') }}
            </p>
          </div>

          <div v-if="dialogStatus === 'downloading'" class="download-card">
            <div class="progress-heading">
              <span>{{ tr('trayUpdateDownloadProgress') }}</span>
              <strong>{{ downloadPercent }}%</strong>
            </div>
            <div class="progress-track" role="progressbar" :aria-valuenow="downloadPercent">
              <span class="progress-fill" :style="{ width: `${downloadPercent}%` }"></span>
            </div>
            <div v-if="updater.progress.value" class="progress-meta">
              <span>{{ formatBytes(updater.progress.value.transferred) }}</span>
              <span>{{ formatBytes(updater.progress.value.total) }}</span>
            </div>
          </div>

          <div v-if="dialogStatus === 'error'" class="error-card">
            <span class="material-symbols-outlined">info</span>
            <span>{{ displayedError }}</span>
          </div>

          <footer class="dialog-actions">
            <template v-if="dialogStatus === 'available'">
              <button class="secondary-action" type="button" @click="close">
                {{ tr('trayUpdateLater') }}
              </button>
              <button class="primary-action" type="button" @click="download">
                <span class="material-symbols-outlined">download</span>
                {{ tr('updateDownload') }}
              </button>
            </template>
            <template v-else-if="dialogStatus === 'downloaded'">
              <button class="secondary-action" type="button" @click="close">
                {{ tr('trayUpdateLater') }}
              </button>
              <button class="primary-action" type="button" @click="install">
                <span class="material-symbols-outlined">restart_alt</span>
                {{ tr('updateInstall') }}
              </button>
            </template>
            <template v-else-if="dialogStatus === 'latest'">
              <button class="secondary-action" type="button" @click="retry">
                <span class="material-symbols-outlined">refresh</span>
                {{ tr('trayUpdateCheckAgain') }}
              </button>
              <button class="primary-action" type="button" @click="close">
                {{ tr('trayUpdateDone') }}
              </button>
            </template>
            <template v-else-if="dialogStatus === 'error'">
              <button class="secondary-action" type="button" @click="close">
                {{ tr('close') }}
              </button>
              <button class="primary-action" type="button" @click="retry">
                <span class="material-symbols-outlined">refresh</span>
                {{ tr('updateRetry') }}
              </button>
            </template>
            <template v-else>
              <button class="secondary-action single-action" type="button" @click="close">
                {{
                  dialogStatus === 'downloading'
                    ? tr('trayUpdateBackgroundDownload')
                    : tr('trayUpdateRunInBackground')
                }}
              </button>
            </template>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.update-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1700;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, #020617 74%, transparent);
  backdrop-filter: blur(16px) saturate(0.82);
}

.update-dialog {
  --status-color: var(--primary);
  position: relative;
  width: min(520px, 100%);
  overflow: hidden;
  padding: 28px;
  color: var(--text);
  background:
    radial-gradient(
      circle at 50% -18%,
      color-mix(in srgb, var(--status-color) 22%, transparent),
      transparent 46%
    ),
    var(--surface-low);
  border: 1px solid color-mix(in srgb, var(--status-color) 30%, var(--border));
  border-radius: 24px;
  box-shadow:
    0 36px 110px rgba(2, 6, 23, 0.56),
    inset 0 1px 0 color-mix(in srgb, white 7%, transparent);
  outline: none;
}

.update-dialog.status-latest,
.update-dialog.status-downloaded {
  --status-color: #22c55e;
}

.update-dialog.status-error {
  --status-color: #fb7185;
}

.update-dialog.status-downloading {
  --status-color: #38bdf8;
}

.dialog-close {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--text-muted);
  background: color-mix(in srgb, var(--surface-container-high) 75%, transparent);
  border: 1px solid var(--border);
  border-radius: 11px;
}

.dialog-close:hover,
.dialog-close:focus-visible {
  color: var(--text);
  border-color: var(--border-strong);
}

.dialog-close .material-symbols-outlined {
  font-size: 19px;
}

.dialog-eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-soft);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.16em;
}

.eyebrow-dot {
  width: 7px;
  height: 7px;
  background: var(--status-color);
  border-radius: 50%;
  box-shadow: 0 0 14px var(--status-color);
}

.status-visual {
  position: relative;
  width: 76px;
  height: 76px;
  display: grid;
  place-items: center;
  margin: 26px auto 18px;
  color: var(--status-color);
  background: color-mix(in srgb, var(--status-color) 12%, var(--surface-container));
  border: 1px solid color-mix(in srgb, var(--status-color) 36%, var(--border));
  border-radius: 24px;
  box-shadow: 0 18px 42px color-mix(in srgb, var(--status-color) 18%, transparent);
}

.visual-ring {
  position: absolute;
  inset: -9px;
  border: 1px solid color-mix(in srgb, var(--status-color) 18%, transparent);
  border-radius: 30px;
}

.status-visual .material-symbols-outlined {
  font-size: 36px;
  font-variation-settings: 'FILL' 1;
}

.spinning {
  animation: update-spin 1.05s linear infinite;
}

@keyframes update-spin {
  to {
    transform: rotate(360deg);
  }
}

.dialog-copy {
  text-align: center;
}

.version-chip {
  display: inline-flex;
  padding: 4px 9px;
  color: var(--text-soft);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-family: var(--font-number);
  font-size: 10px;
}

.dialog-copy h2 {
  margin: 12px 0 7px;
  font-size: 23px;
  line-height: 1.3;
}

.dialog-copy p {
  max-width: 390px;
  margin: 0 auto;
  color: var(--text-soft);
  font-size: 13px;
  line-height: 1.6;
}

.release-card,
.download-card,
.error-card {
  margin-top: 22px;
  padding: 15px;
  background: color-mix(in srgb, var(--surface-container) 78%, transparent);
  border: 1px solid var(--border);
  border-radius: 14px;
}

.release-heading,
.progress-heading,
.progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.release-heading > div {
  display: grid;
  gap: 3px;
}

.release-heading span,
.progress-heading span {
  color: var(--text-soft);
  font-size: 11px;
}

.release-heading strong {
  color: var(--status-color);
  font-family: var(--font-number);
  font-size: 19px;
}

.release-date {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-family: var(--font-number);
}

.release-date .material-symbols-outlined {
  font-size: 14px;
}

.release-notes {
  max-height: 104px;
  margin: 13px 0 0;
  overflow-y: auto;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.release-notes--muted {
  color: var(--text-soft);
}

.progress-heading strong {
  color: var(--status-color);
  font-family: var(--font-number);
  font-size: 14px;
}

.progress-track {
  height: 8px;
  margin-top: 12px;
  overflow: hidden;
  background: var(--bg-base);
  border-radius: 999px;
}

.progress-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--status-color), #818cf8);
  border-radius: inherit;
  transition: width 0.22s ease;
}

.progress-meta {
  margin-top: 7px;
  color: var(--text-soft);
  font-family: var(--font-number);
  font-size: 10px;
}

.error-card {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  color: color-mix(in srgb, #fb7185 86%, var(--text));
  background: color-mix(in srgb, #fb7185 8%, var(--surface-container));
  border-color: color-mix(in srgb, #fb7185 30%, var(--border));
  font-size: 12px;
  line-height: 1.55;
}

.error-card .material-symbols-outlined {
  flex: 0 0 auto;
  font-size: 18px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}

.dialog-actions button {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 16px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: var(--weight-semibold);
}

.dialog-actions .material-symbols-outlined {
  font-size: 17px;
}

.secondary-action {
  color: var(--text-muted);
  background: var(--surface-container);
  border: 1px solid var(--border);
}

.secondary-action:hover,
.secondary-action:focus-visible {
  color: var(--text);
  border-color: var(--border-strong);
}

.primary-action {
  color: var(--primary-on);
  background: linear-gradient(135deg, var(--primary), #8068e8);
  border: 1px solid transparent;
  box-shadow: 0 10px 26px color-mix(in srgb, var(--primary) 24%, transparent);
}

.primary-action:hover,
.primary-action:focus-visible {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.single-action {
  margin-left: auto;
}

.tray-update-dialog-enter-active,
.tray-update-dialog-leave-active {
  transition: opacity 0.2s ease;
}

.tray-update-dialog-enter-active .update-dialog,
.tray-update-dialog-leave-active .update-dialog {
  transition:
    opacity 0.2s ease,
    transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.tray-update-dialog-enter-from,
.tray-update-dialog-leave-to {
  opacity: 0;
}

.tray-update-dialog-enter-from .update-dialog,
.tray-update-dialog-leave-to .update-dialog {
  opacity: 0;
  transform: translateY(12px) scale(0.975);
}

@media (max-width: 560px) {
  .update-backdrop {
    padding: 12px;
  }

  .update-dialog {
    padding: 24px 18px 18px;
    border-radius: 20px;
  }

  .dialog-actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .dialog-actions button {
    width: 100%;
  }
}
</style>
