<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../i18n/useI18n'
import PageIntro from '../components/base/PageIntro.vue'
import UserAvatar from '../components/base/UserAvatar.vue'
import TypographySettings from '../components/settings/TypographySettings.vue'
import { useTheme, type Theme } from '../composables/useTheme'
import { useAppSettings } from '../composables/useAppSettings'
import { useAuth } from '../composables/useAuth'
import { useUpdater } from '../composables/useUpdater'
import { submitFeedback as submitFeedbackRequest } from '../api/http/feedback'
import { openConfiguredUrl } from '../api/runtime-config'
import type { CloseBehavior } from '@shared/models'

const { currentLang, setLang, tr, label } = useI18n()
const { currentTheme, setTheme } = useTheme()
const { settings, updateLanguage, updateTheme, updateSystemNotifications } = useAppSettings()
const closeBehavior = ref<CloseBehavior>('ask')
const closeBehaviorLoading = ref(true)
const closeBehaviorError = ref('')
let stopCloseBehaviorListener: (() => void) | null = null

const { currentUser, login, logout } = useAuth()

// ── Sync settings JSON with i18n/theme state ──────────────────────────────
watch(currentLang, (lang) => {
  updateLanguage(lang)
})
watch(currentTheme, (theme) => {
  updateTheme(theme)
})
onMounted(() => {
  updateLanguage(currentLang.value)
  updateTheme(currentTheme.value)
  stopCloseBehaviorListener = window.api.onCloseBehaviorChanged((behavior) => {
    closeBehavior.value = behavior
  })
  void window.api
    .getCloseBehavior()
    .then((behavior) => {
      closeBehavior.value = behavior
    })
    .catch((error) => {
      closeBehaviorError.value =
        error instanceof Error
          ? error.message
          : label('Failed to load preference.', '读取偏好失败。')
    })
    .finally(() => {
      closeBehaviorLoading.value = false
    })
})

async function changeCloseBehavior(behavior: CloseBehavior): Promise<void> {
  if (closeBehaviorLoading.value || closeBehavior.value === behavior) return
  const previous = closeBehavior.value
  closeBehavior.value = behavior
  closeBehaviorLoading.value = true
  closeBehaviorError.value = ''
  try {
    closeBehavior.value = await window.api.setCloseBehavior(behavior)
  } catch (error) {
    closeBehavior.value = previous
    closeBehaviorError.value =
      error instanceof Error ? error.message : label('Failed to save preference.', '保存偏好失败。')
  } finally {
    closeBehaviorLoading.value = false
  }
}

async function doLogin(): Promise<void> {
  try {
    await login()
  } catch (err) {
    console.error('[SettingsPage] 打开登录窗口失败:', err)
  }
}

async function doLogout(): Promise<void> {
  try {
    await logout()
  } catch (err) {
    console.error('[SettingsPage] 登出失败:', err)
  }
}

function openAccountDetails() {
  void openConfiguredUrl('accountPageUrl').catch((error) => {
    console.error('[SettingsPage] 打开账号中心失败:', error)
  })
}

// ── Version / update check ────────────────────────────────────────────────
// 状态机由 useUpdater 单例维护：idle → checking → available → downloading → downloaded → (重启)
//                                                ↘ latest       ↘ error
const updater = useUpdater({ versionFallback: settings.version })
const updateStatus = updater.status
const updateInfo = computed(() => updater.info.value ?? { version: '' })
const downloadProgress = updater.progress
const errorMessage = updater.error
const currentVersion = updater.currentVersion
const checkUpdate = updater.check
const startDownload = updater.download
const installNow = updater.install

onMounted(() => {
  void updater.init()
})

/**
 * 渲染 changelog：releaseNotes 可能是字符串 / Markdown / HTML。
 * 为避免引入 markdown 解析器与 XSS 风险，统一按纯文本渲染（textContent）。
 */
function renderNotes(): string {
  const notes = updater.info.value?.releaseNotes
  if (notes == null) return ''
  // electron-updater 的 releaseNotes 也可能是数组（分段），这里只处理字符串
  return String(notes)
}

/** 字节数转人类可读（KB/MB/GB），用于下载进度展示 */
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

// ── Local diagnostic logs ────────────────────────────────────────────────
const diagnosticUploading = ref(false)
const diagnosticStatus = ref<'idle' | 'success' | 'error'>('idle')
const diagnosticMessage = ref('')
const diagnosticCanUpload = ref(false)
let stopDiagnosticUploadStateListener: (() => void) | null = null

onMounted(async () => {
  let stateChangedWhileLoading = false
  stopDiagnosticUploadStateListener = window.api.onDiagnosticUploadStateChanged((state) => {
    stateChangedWhileLoading = true
    diagnosticCanUpload.value = state.canUpload
  })

  try {
    const state = await window.api.getDiagnosticUploadState()
    if (!stateChangedWhileLoading) diagnosticCanUpload.value = state.canUpload
  } catch {
    if (!stateChangedWhileLoading) diagnosticCanUpload.value = true
  }
})

onUnmounted(() => {
  stopCloseBehaviorListener?.()
  stopCloseBehaviorListener = null
  stopDiagnosticUploadStateListener?.()
  stopDiagnosticUploadStateListener = null
  if (feedbackResetTimer !== null) window.clearTimeout(feedbackResetTimer)
  feedbackResetTimer = null
})

async function uploadDiagnosticLogs(): Promise<void> {
  if (diagnosticUploading.value) return
  diagnosticUploading.value = true
  diagnosticStatus.value = 'idle'
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

    diagnosticStatus.value = 'success'
    diagnosticMessage.value = label(
      `Diagnostic report #${result.id} uploaded`,
      `诊断报告 #${result.id} 已上传`,
    )
    const uploadState = await window.api.getDiagnosticUploadState().catch(() => null)
    if (uploadState) diagnosticCanUpload.value = uploadState.canUpload
  } catch (error) {
    diagnosticStatus.value = 'error'
    diagnosticMessage.value =
      error instanceof Error ? error.message : label('Upload failed', '上传失败')
  } finally {
    diagnosticUploading.value = false
  }
}

async function openDiagnosticLogs(): Promise<void> {
  await window.api.openDiagnosticLogs()
}

// ── Feedback form ─────────────────────────────────────────────────────────
type FeedbackType = 'bug' | 'feature' | 'other'

const feedbackTypes: readonly FeedbackType[] = ['bug', 'feature', 'other']
const feedbackType = ref<FeedbackType>('feature')
const feedbackTitle = ref('')
const feedbackContent = ref('')
const feedbackSubmitted = ref(false)
const feedbackError = ref('')
const feedbackSubmitting = ref(false)
let feedbackResetTimer: number | null = null

function scheduleFeedbackReset(): void {
  if (feedbackResetTimer !== null) window.clearTimeout(feedbackResetTimer)
  feedbackResetTimer = window.setTimeout(() => {
    feedbackError.value = ''
    feedbackSubmitted.value = false
    feedbackResetTimer = null
  }, 3000)
}

function isFeedbackType(type: string): type is FeedbackType {
  return feedbackTypes.includes(type as FeedbackType)
}

function getFeedbackErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return tr('feedbackSubmitFailed')
}

async function submitFeedback(): Promise<void> {
  if (feedbackSubmitting.value) return

  const category = feedbackType.value
  const content = feedbackContent.value.trim()

  if (!isFeedbackType(category)) {
    feedbackError.value = tr('feedbackInvalidType')
    window.setTimeout(() => {
      feedbackError.value = ''
    }, 3000)
    return
  }
  if (!content) {
    feedbackError.value = tr('feedbackContentRequired')
    window.setTimeout(() => {
      feedbackError.value = ''
    }, 3000)
    return
  }

  const user = currentUser.value

  feedbackSubmitting.value = true
  try {
    await submitFeedbackRequest({
      category,
      title: feedbackTitle.value.trim(),
      content,
      contact: user ? user.email || user.username : '',
    })

    feedbackSubmitted.value = true
    feedbackTitle.value = ''
    feedbackContent.value = ''
    feedbackType.value = 'feature'
    scheduleFeedbackReset()
  } catch (err) {
    console.error('[SettingsPage] 提交反馈失败:', err)
    feedbackError.value = getFeedbackErrorMessage(err)
    window.setTimeout(() => {
      feedbackError.value = ''
    }, 3000)
  } finally {
    feedbackSubmitting.value = false
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
const userInitial = computed(() => {
  if (!currentUser.value) return '?'
  const name = currentUser.value.nickname || currentUser.value.username
  return name.charAt(0).toUpperCase()
})

// 版本号显示：使用运行时读取的 currentVersion，回退到 settings.version
const versionString = computed(() => currentVersion.value || settings.version)
</script>

<template>
  <main class="settings-page">
    <PageIntro
      class="settings-intro"
      icon="tune"
      :eyebrow="label('PREFERENCES', '偏好设置')"
      :title="tr('settings')"
      :subtitle="tr('settingsSubtitle')"
    />

    <div class="settings-body">
      <!-- ── Section: Account ─────────────────────────────────────── -->
      <section class="settings-section">
        <h2 class="section-title">
          <span class="material-symbols-outlined filled-icon">account_circle</span>
          {{ tr('accountSettings') }}
        </h2>

        <div v-if="currentUser" class="setting-row account-row">
          <div class="setting-info">
            <div class="user-display">
              <div class="user-avatar">
                <UserAvatar
                  :src="currentUser.avatar"
                  :fallback="userInitial"
                  :alt="currentUser.nickname || currentUser.username"
                />
              </div>
              <div>
                <span class="setting-name">{{ currentUser.nickname || currentUser.username }}</span>
                <span class="setting-desc">
                  {{ tr('loggedInAs') }} · {{ currentUser.username }}
                </span>
              </div>
            </div>
          </div>
          <div class="setting-control account-actions">
            <button class="btn btn-outline" type="button" @click="openAccountDetails">
              <span class="material-symbols-outlined">manage_accounts</span>
              {{ tr('accountDetails') }}
            </button>
            <button class="btn btn-danger-outline" type="button" @click="doLogout">
              <span class="material-symbols-outlined">logout</span>
              {{ tr('logout') }}
            </button>
          </div>
        </div>

        <div v-else class="setting-row account-row">
          <div class="setting-info">
            <div class="user-display">
              <div class="user-avatar user-avatar-guest">
                <span class="material-symbols-outlined">person_off</span>
              </div>
              <div>
                <span class="setting-name">{{ tr('notLoggedIn') }}</span>
                <span class="setting-desc">{{ tr('notLoggedInDesc') }}</span>
              </div>
            </div>
          </div>
          <div class="setting-control account-actions">
            <button class="btn btn-primary" type="button" @click="doLogin">
              <span class="material-symbols-outlined">login</span>
              {{ tr('loginBtn') }}
            </button>
          </div>
        </div>
      </section>

      <!-- ── Section: General ─────────────────────────────────────── -->
      <section class="settings-section">
        <h2 class="section-title">
          <span class="material-symbols-outlined filled-icon">tune</span>
          {{ tr('generalSettings') }}
        </h2>

        <!-- Language -->
        <div class="setting-row">
          <span class="row-icon material-symbols-outlined" aria-hidden="true">translate</span>
          <div class="setting-info">
            <span class="setting-name">{{ tr('language') }}</span>
            <span class="setting-desc">{{ tr('languageDesc') }}</span>
          </div>
          <div class="setting-control">
            <select
              class="setting-select"
              :value="currentLang"
              @change="setLang(($event.target as HTMLSelectElement).value as 'en' | 'zh')"
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        <!-- Theme -->
        <div class="setting-row">
          <span class="row-icon material-symbols-outlined" aria-hidden="true">palette</span>
          <div class="setting-info">
            <span class="setting-name">{{ tr('theme') }}</span>
            <span class="setting-desc">{{ tr('themeDesc') }}</span>
          </div>
          <div class="setting-control">
            <select
              class="setting-select"
              :value="currentTheme"
              @change="setTheme(($event.target as HTMLSelectElement).value as Theme)"
            >
              <option value="dark">{{ tr('themeDark') }}</option>
              <option value="light">{{ tr('themeLight') }}</option>
            </select>
          </div>
        </div>

        <!-- Main-window close behavior. Main process is the single source of truth. -->
        <div class="setting-row close-behavior-row">
          <span class="row-icon material-symbols-outlined" aria-hidden="true">move_to_inbox</span>
          <div class="setting-info">
            <span class="setting-name">{{ tr('closeBehavior') }}</span>
            <span class="setting-desc">{{ tr('closeBehaviorDesc') }}</span>
            <span v-if="closeBehaviorError" class="setting-inline-error">
              {{ closeBehaviorError }}
            </span>
          </div>
          <div
            class="setting-control close-behavior-control"
            role="radiogroup"
            :aria-label="tr('closeBehavior')"
          >
            <button
              class="close-behavior-option"
              :class="{ active: closeBehavior === 'ask' }"
              type="button"
              role="radio"
              :aria-checked="closeBehavior === 'ask'"
              :disabled="closeBehaviorLoading"
              @click="changeCloseBehavior('ask')"
            >
              <span class="material-symbols-outlined">help</span>
              {{ tr('closeBehaviorAsk') }}
            </button>
            <button
              class="close-behavior-option"
              :class="{ active: closeBehavior === 'background' }"
              type="button"
              role="radio"
              :aria-checked="closeBehavior === 'background'"
              :disabled="closeBehaviorLoading"
              @click="changeCloseBehavior('background')"
            >
              <span class="material-symbols-outlined">dock_to_right</span>
              {{ tr('closeBehaviorBackground') }}
            </button>
            <button
              class="close-behavior-option"
              :class="{ active: closeBehavior === 'quit' }"
              type="button"
              role="radio"
              :aria-checked="closeBehavior === 'quit'"
              :disabled="closeBehaviorLoading"
              @click="changeCloseBehavior('quit')"
            >
              <span class="material-symbols-outlined">power_settings_new</span>
              {{ tr('closeBehaviorQuit') }}
            </button>
          </div>
        </div>
      </section>

      <!-- ── Section: Notifications ─────────────────────────────── -->
      <section class="settings-section">
        <h2 class="section-title">
          <span class="material-symbols-outlined filled-icon">notifications</span>
          {{ tr('notificationSettings') }}
        </h2>

        <div class="setting-row">
          <span class="row-icon material-symbols-outlined" aria-hidden="true">notifications</span>
          <div class="setting-info">
            <span class="setting-name">{{ tr('systemNotifications') }}</span>
            <span class="setting-desc">{{ tr('systemNotificationsDesc') }}</span>
          </div>
          <div class="setting-control notification-toggle-control">
            <span class="setting-toggle-state">
              {{
                settings.systemNotificationsEnabled
                  ? tr('systemNotificationsOn')
                  : tr('systemNotificationsOff')
              }}
            </span>
            <button
              class="setting-switch"
              :class="{ active: settings.systemNotificationsEnabled }"
              type="button"
              role="switch"
              :aria-checked="settings.systemNotificationsEnabled"
              :aria-label="tr('systemNotifications')"
              @click="updateSystemNotifications(!settings.systemNotificationsEnabled)"
            >
              <span class="setting-switch-thumb"></span>
            </button>
          </div>
        </div>
      </section>

      <!-- ── Section: Version ───────────────────────────────────── -->
      <section class="settings-section version-section">
        <h2 class="section-title">
          <span class="material-symbols-outlined filled-icon">system_update</span>
          {{ tr('versionSettings') }}
        </h2>

        <!-- Version -->
        <div class="setting-row">
          <span class="row-icon material-symbols-outlined" aria-hidden="true">tag</span>
          <div class="setting-info">
            <span class="setting-name">{{ tr('version') }}</span>
            <span class="setting-desc">v{{ versionString }}</span>
          </div>
          <div class="setting-control">
            <!-- idle: 显示"检查更新" -->
            <button
              v-if="updateStatus === 'idle'"
              class="btn btn-outline"
              type="button"
              @click="checkUpdate"
            >
              <span class="material-symbols-outlined">refresh</span>
              {{ tr('checkUpdate') }}
            </button>
            <!-- checking: 显示"检查中..."禁用按钮 -->
            <button
              v-else-if="updateStatus === 'checking'"
              class="btn btn-outline"
              type="button"
              disabled
            >
              <span class="material-symbols-outlined spinning">autorenew</span>
              {{ tr('checkingUpdate') }}
            </button>
            <!-- available: 显示"立即下载" -->
            <button
              v-else-if="updateStatus === 'available'"
              class="btn btn-primary"
              type="button"
              @click="startDownload"
            >
              <span class="material-symbols-outlined">download</span>
              {{ tr('updateDownload') }}
            </button>
            <!-- downloading: 显示进度百分比禁用按钮 -->
            <button
              v-else-if="updateStatus === 'downloading'"
              class="btn btn-outline"
              type="button"
              disabled
            >
              <span class="material-symbols-outlined spinning">downloading</span>
              {{ Math.round(downloadProgress?.percent ?? 0) }}%
            </button>
            <!-- downloaded: 用户显式启动可见的 NSIS 安装器并查看安装进度 -->
            <button
              v-else-if="updateStatus === 'downloaded'"
              class="btn btn-outline"
              type="button"
              @click="installNow"
            >
              <span class="material-symbols-outlined">restart_alt</span>
              {{ tr('updateInstall') }}
            </button>
            <!-- latest: 显示"已是最新版本"禁用按钮 -->
            <button
              v-else-if="updateStatus === 'latest'"
              class="btn btn-outline"
              type="button"
              disabled
            >
              <span class="material-symbols-outlined">check_circle</span>
              {{ tr('upToDate') }}
            </button>
            <!-- error: 显示"重试" -->
            <button v-else class="btn btn-outline" type="button" @click="checkUpdate">
              <span class="material-symbols-outlined">refresh</span>
              {{ tr('updateRetry') }}
            </button>
          </div>
        </div>

        <!-- 新版本信息 + changelog（available / downloading / downloaded 都展示） -->
        <div
          v-if="
            ['available', 'downloading', 'downloaded'].includes(updateStatus) && updateInfo.version
          "
          class="update-detail-row"
        >
          <div class="update-detail-header">
            <span class="material-symbols-outlined">system_update</span>
            <div>
              <span class="update-detail-version">
                {{ tr('updateNewVersion') }}: v{{ updateInfo.version }}
              </span>
              <span v-if="updateInfo.releaseDate" class="update-detail-date">
                {{ tr('updateReleaseDate') }}: {{ updateInfo.releaseDate.slice(0, 10) }}
              </span>
            </div>
          </div>
          <div v-if="renderNotes()" class="update-changelog" v-text="renderNotes()"></div>
        </div>

        <!-- 下载进度条 -->
        <div v-if="updateStatus === 'downloading' && downloadProgress" class="update-progress-row">
          <div class="update-progress-bar">
            <div
              class="update-progress-fill"
              :style="{ width: `${downloadProgress.percent}%` }"
            ></div>
          </div>
          <div class="update-progress-meta">
            <span>
              {{ formatBytes(downloadProgress.transferred) }} /
              {{ formatBytes(downloadProgress.total) }}
            </span>
            <span>{{ Math.round(downloadProgress.percent) }}%</span>
          </div>
        </div>

        <!-- 下载完成提示 -->
        <div v-if="updateStatus === 'downloaded'" class="update-ready-row">
          <span class="material-symbols-outlined filled-icon success-icon">check_circle</span>
          <span>{{ tr('updateReadyToInstall') }}</span>
        </div>

        <!-- 错误信息 -->
        <div v-if="updateStatus === 'error' && errorMessage" class="update-error-row">
          <span class="material-symbols-outlined">error</span>
          <span>{{ errorMessage }}</span>
        </div>
      </section>

      <!-- ── Section: Diagnostic logs ─────────────────────────────── -->
      <section class="settings-section">
        <h2 class="section-title">
          <span class="material-symbols-outlined filled-icon">troubleshoot</span>
          {{ label('Diagnostic logs', '诊断日志') }}
        </h2>
        <div class="setting-row">
          <span class="row-icon material-symbols-outlined">description</span>
          <div class="setting-info">
            <span class="setting-name">{{ label('Local application logs', '本地应用日志') }}</span>
            <span class="setting-desc">
              {{
                label(
                  'Crash, renderer, and update failures silently send a minimal diagnostic event. You can also click Upload logs to send recent error information and help developers improve the software.',
                  '崩溃、界面和更新异常会静默发送最小诊断事件；也可以点击“上传日志”，发送最近错误信息帮助开发者完善软件。',
                )
              }}
            </span>
          </div>
          <div class="setting-control">
            <button class="btn btn-outline" type="button" @click="openDiagnosticLogs">
              <span class="material-symbols-outlined">folder_open</span>
              {{ label('Open logs', '打开日志') }}
            </button>
            <button
              v-if="diagnosticCanUpload"
              class="btn btn-primary"
              type="button"
              :disabled="diagnosticUploading"
              @click="uploadDiagnosticLogs"
            >
              <span class="material-symbols-outlined">upload</span>
              {{
                diagnosticUploading
                  ? label('Uploading…', '上传中…')
                  : label('Upload logs', '上传日志')
              }}
            </button>
          </div>
        </div>
        <div
          v-if="diagnosticStatus !== 'idle'"
          :class="diagnosticStatus === 'error' ? 'update-error-row' : 'update-ready-row'"
        >
          <span class="material-symbols-outlined">
            {{ diagnosticStatus === 'error' ? 'error' : 'check_circle' }}
          </span>
          <span>{{ diagnosticMessage }}</span>
        </div>
      </section>

      <TypographySettings />

      <!-- ── Section: Feedback ─────────────────────────────────────── -->
      <section class="settings-section">
        <h2 class="section-title">
          <span class="material-symbols-outlined filled-icon">feedback</span>
          {{ tr('feedback') }}
        </h2>

        <div class="feedback-block">
          <div class="feedback-header">
            <span class="setting-name">{{ tr('feedback') }}</span>
            <span class="setting-desc">{{ tr('feedbackDesc') }}</span>
          </div>

          <div v-if="!feedbackSubmitted" class="feedback-form">
            <div v-if="feedbackError" class="feedback-error">
              <span class="material-symbols-outlined">error</span>
              <span>{{ feedbackError }}</span>
            </div>
            <div class="form-group">
              <label>{{ tr('feedbackType') }}</label>
              <div class="segmented-group">
                <button
                  type="button"
                  class="seg-btn"
                  :class="{ active: feedbackType === 'bug' }"
                  @click="feedbackType = 'bug'"
                >
                  <span class="material-symbols-outlined">bug_report</span>
                  <span>{{ tr('feedbackTypeBug') }}</span>
                </button>
                <button
                  type="button"
                  class="seg-btn"
                  :class="{ active: feedbackType === 'feature' }"
                  @click="feedbackType = 'feature'"
                >
                  <span class="material-symbols-outlined">lightbulb</span>
                  <span>{{ tr('feedbackTypeFeature') }}</span>
                </button>
                <button
                  type="button"
                  class="seg-btn"
                  :class="{ active: feedbackType === 'other' }"
                  @click="feedbackType = 'other'"
                >
                  <span class="material-symbols-outlined">more_horiz</span>
                  <span>{{ tr('feedbackTypeOther') }}</span>
                </button>
              </div>
            </div>
            <div class="form-group">
              <label>{{ tr('feedbackTitle') }}</label>
              <input
                v-model="feedbackTitle"
                type="text"
                class="form-input"
                :placeholder="tr('feedbackTitlePlaceholder')"
              />
            </div>
            <div class="form-group">
              <label>{{ tr('feedbackContent') }}</label>
              <textarea
                v-model="feedbackContent"
                class="form-textarea"
                rows="4"
                :placeholder="tr('feedbackContentPlaceholder')"
              ></textarea>
            </div>
            <button
              class="btn btn-primary btn-full"
              type="button"
              :disabled="feedbackSubmitting"
              @click="submitFeedback"
            >
              <span class="material-symbols-outlined">send</span>
              {{ feedbackSubmitting ? tr('feedbackSubmitting') : tr('feedbackSubmit') }}
            </button>
          </div>

          <div v-else class="feedback-success">
            <span class="material-symbols-outlined filled-icon success-icon">check_circle</span>
            <span>{{ tr('feedbackSubmitted') }}</span>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 20px;
  line-height: 1;
  letter-spacing: 0;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  font-feature-settings: 'liga';
  -webkit-font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
  font-variation-settings:
    'FILL' 0,
    'wght' 400,
    'GRAD' 0,
    'opsz' 24;
}
.filled-icon {
  font-variation-settings:
    'FILL' 1,
    'wght' 500,
    'GRAD' 0,
    'opsz' 24;
}

.settings-page {
  flex: 1;
}

.settings-body {
  display: flex;
  flex-direction: column;
}

/* ── Section card ─────────────────────────────────────────────────────── */
.settings-section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 8px 0;
  box-shadow: var(--shadow-card);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-soft);
  padding: 16px 24px 8px;
  margin: 0;
}

.section-title .material-symbols-outlined {
  font-size: 18px;
  color: var(--primary);
}

/* ── Setting row ──────────────────────────────────────────────────────── */
.setting-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 24px;
  border-top: 1px solid var(--border);
}

.settings-section .setting-row:first-of-type {
  border-top: 1px solid var(--border);
}

.row-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--surface-container);
  color: var(--primary);
  font-size: 20px;
  border: 1px solid var(--border);
}

.setting-info {
  flex: 1;
  min-width: 0;
}

.setting-name {
  display: block;
  font-size: 15px;
  font-weight: var(--weight-medium);
  color: var(--text);
  margin-bottom: 3px;
}

.setting-desc {
  display: block;
  font-size: 13px;
  color: var(--text-soft);
}

.setting-control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.setting-inline-error {
  display: block;
  margin-top: 5px;
  color: #fb7185;
  font-size: 11px;
}

.close-behavior-control {
  display: grid;
  grid-template-columns: repeat(3, minmax(96px, 1fr));
  gap: 4px;
  padding: 4px;
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 12px;
}

.close-behavior-option {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  color: var(--text-soft);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 11px;
  font-weight: var(--weight-semibold);
  white-space: nowrap;
  transition:
    color 0.16s ease,
    background 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.close-behavior-option .material-symbols-outlined {
  font-size: 17px;
}

.close-behavior-option:hover:not(:disabled),
.close-behavior-option:focus-visible {
  color: var(--text);
  background: var(--surface-container-high);
}

.close-behavior-option.active {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--bg-base));
  border-color: color-mix(in srgb, var(--primary) 34%, var(--border));
  box-shadow: 0 4px 12px color-mix(in srgb, var(--primary) 10%, transparent);
}

.close-behavior-option:disabled {
  cursor: wait;
  opacity: 0.58;
}

/* ── Notification switch ────────────────────────────────────────────── */
.notification-toggle-control {
  gap: 10px;
}

.setting-toggle-state {
  min-width: 42px;
  color: var(--text-soft);
  font-size: 13px;
  text-align: right;
}

.setting-switch {
  position: relative;
  width: 44px;
  min-width: 44px;
  height: 24px;
  min-height: 24px;
  padding: 2px;
  overflow: hidden;
  background: var(--surface-container-high);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.setting-switch:hover {
  border-color: var(--primary);
}

.setting-switch:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(109, 59, 215, 0.18);
}

.setting-switch.active {
  background: var(--primary);
  border-color: var(--primary);
}

.setting-switch-thumb {
  display: block;
  width: 18px;
  height: 18px;
  background: var(--text-soft);
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
  transform: translateX(0);
  transition:
    background-color 0.18s ease,
    transform 0.18s ease;
}

.setting-switch.active .setting-switch-thumb {
  background: var(--primary-on);
  transform: translateX(20px);
}

/* ── Account row ──────────────────────────────────────────────────────── */
.account-row {
  align-items: center;
}

.user-display {
  display: flex;
  align-items: center;
  gap: 14px;
}

.user-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: var(--weight-semibold);
  background: linear-gradient(135deg, #6d3bd7, #ab8bff);
  color: #fff;
  flex-shrink: 0;
}

.user-avatar-guest {
  background: var(--surface-container-high);
  color: var(--text-soft);
}

.account-actions {
  gap: 8px;
}

/* ── Buttons ──────────────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: var(--weight-semibold);
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s,
    opacity 0.15s;
  white-space: nowrap;
}

.btn .material-symbols-outlined {
  font-size: 18px;
}

.btn-primary {
  background: var(--primary);
  color: var(--primary-on);
}
.btn-primary:hover {
  filter: brightness(1.1);
}

.btn-outline {
  background: transparent;
  border-color: var(--border-strong);
  color: var(--text);
}
.btn-outline:hover {
  background: var(--surface-container-high);
}

.btn-danger-outline {
  background: transparent;
  border-color: var(--error);
  color: var(--error);
}
.btn-danger-outline:hover {
  background: rgba(255, 180, 171, 0.1);
}

.btn-full {
  width: 100%;
  height: 42px;
  font-size: 14px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Status badges ────────────────────────────────────────────────────── */
.status-badge {
  font-size: 12px;
  font-weight: var(--weight-semibold);
  padding: 4px 10px;
  border-radius: 20px;
  white-space: nowrap;
}
.status-ok {
  background: rgba(78, 222, 163, 0.12);
  color: var(--tertiary);
}
.status-info {
  background: rgba(208, 188, 255, 0.12);
  color: var(--primary);
}

/* ── Update detail / progress / status rows ───────────────────────────── */
.update-detail-row,
.update-progress-row,
.update-ready-row,
.update-error-row {
  padding: 14px 24px 16px;
  border-top: 1px solid var(--border);
}

.update-detail-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.update-detail-header .material-symbols-outlined {
  font-size: 22px;
  color: var(--primary);
  margin-top: 2px;
}

.update-detail-version {
  display: block;
  font-size: 14px;
  font-weight: var(--weight-semibold);
  color: var(--text);
}

.update-detail-date {
  display: block;
  font-size: 12px;
  color: var(--text-soft);
  margin-top: 2px;
}

.update-changelog {
  margin-top: 10px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--surface-container);
  border: 1px solid var(--border);
  font-size: 13px;
  color: var(--text);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
}

.update-progress-bar {
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: var(--surface-container);
  border: 1px solid var(--border);
  overflow: hidden;
}

.update-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), #ab8bff);
  transition: width 0.2s ease;
}

.update-progress-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-soft);
  margin-top: 6px;
}

.update-ready-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(78, 222, 163, 0.06);
  color: var(--tertiary);
  font-weight: var(--weight-medium);
  font-size: 13px;
}

.update-ready-row .material-symbols-outlined {
  font-size: 20px;
}

.update-error-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 180, 171, 0.08);
  color: var(--error);
  font-size: 13px;
}

.update-error-row .material-symbols-outlined {
  font-size: 20px;
}

/* ── Feedback block ───────────────────────────────────────────────────── */
.feedback-block {
  padding: 20px 24px 24px;
  border-top: 1px solid var(--border);
}

.feedback-header {
  margin-bottom: 16px;
}

.feedback-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: var(--weight-medium);
  color: var(--text-muted);
  margin-bottom: 6px;
}

.form-input {
  width: 100%;
  height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface-container);
  color: var(--text);
  font-size: 14px;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
  outline: none;
}

.form-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(109, 59, 215, 0.15);
}

.form-input::placeholder {
  color: var(--text-soft);
}

.form-textarea {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface-container);
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.form-textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(109, 59, 215, 0.15);
}

.form-textarea::placeholder {
  color: var(--text-soft);
}

/* Segmented control (optimized radio style) */
.segmented-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.seg-btn {
  flex: 1;
  min-width: 96px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 40px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  background: var(--surface-container);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: var(--weight-semibold);
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;
}

.seg-btn .material-symbols-outlined {
  font-size: 18px;
}

.seg-btn:hover {
  background: var(--surface-container-high);
  color: var(--text);
}

.seg-btn.active {
  background: rgba(109, 59, 215, 0.12);
  border-color: var(--primary);
  color: var(--primary);
}

.seg-btn.active .material-symbols-outlined {
  font-variation-settings:
    'FILL' 1,
    'wght' 500,
    'GRAD' 0,
    'opsz' 20;
}

.feedback-success {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px;
  border-radius: 10px;
  background: rgba(78, 222, 163, 0.08);
  border: 1px solid rgba(78, 222, 163, 0.2);
  color: var(--tertiary);
  font-weight: var(--weight-medium);
}

.success-icon {
  font-size: 22px;
}

.feedback-error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
  border-radius: 10px;
  background: rgba(248, 113, 113, 0.08);
  border: 1px solid rgba(248, 113, 113, 0.2);
  color: #f87171;
  font-weight: var(--weight-medium);
  margin-bottom: 12px;
}

/* ── Modal ────────────────────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  backdrop-filter: blur(4px);
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.modal-card {
  width: 100%;
  max-width: 420px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  box-shadow: var(--shadow-modal);
  animation: slideUp 0.25s ease;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 0;
}

.modal-header h3 {
  font-size: 18px;
  font-weight: var(--weight-semibold);
  color: var(--text);
  margin: 0;
}

.icon-btn-plain {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: var(--text-soft);
  border-radius: 8px;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}
.icon-btn-plain:hover {
  background: var(--surface-container-high);
  color: var(--text);
}

.login-tabs {
  display: flex;
  gap: 4px;
  padding: 16px 24px 0;
  border-bottom: 1px solid var(--border);
}

.login-tabs button {
  flex: 1;
  padding: 10px 0;
  border: none;
  background: transparent;
  color: var(--text-soft);
  font-size: 13px;
  font-weight: var(--weight-semibold);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition:
    color 0.15s,
    border-color 0.15s;
}

.login-tabs button.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.login-form {
  padding: 20px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.demo-notice {
  color: var(--on-surface-variant);
  font-size: 12px;
  margin-top: 8px;
  opacity: 0.7;
}

.code-row {
  display: flex;
  gap: 8px;
}

.code-row .form-input {
  flex: 1;
}

.code-btn {
  flex-shrink: 0;
  height: 40px;
}

.login-footer {
  text-align: center;
  font-size: 13px;
  color: var(--text-soft);
  margin-top: 4px;
}

.link {
  color: var(--primary);
  text-decoration: none;
  font-weight: var(--weight-semibold);
  margin-left: 4px;
}
.link:hover {
  text-decoration: underline;
}

/* ── Responsive ───────────────────────────────────────────────────────── */

@media (max-width: 640px) {
  .setting-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  .setting-control {
    width: 100%;
  }
  .close-behavior-control {
    grid-template-columns: 1fr;
  }
  .notification-toggle-control {
    justify-content: flex-end;
  }

  .account-actions {
    width: 100%;
    flex-wrap: wrap;
  }
  .seg-btn {
    min-width: 0;
  }
}
</style>
