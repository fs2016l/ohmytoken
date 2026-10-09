<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import { useUpdater } from '../../composables/useUpdater'
import { openConfiguredUrl, type RuntimeUrlKey } from '../../api/runtime-config'
import BrandMark from '../base/BrandMark.vue'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import ThirdPartyNoticesDialog from './ThirdPartyNoticesDialog.vue'
const { label } = useI18n()
const updater = useUpdater({ latestResetMs: null, errorResetMs: null })
const { status, info, progress, error, currentVersion } = updater
const actionError = ref('')
const noticesOpen = ref(false)
const buttonText = computed(
  () =>
    ({
      idle: label('Check for updates', '检查更新'),
      checking: label('Checking…', '检查中…'),
      available: label('Download update', '下载更新'),
      downloading: label('Pause download', '暂停下载'),
      paused: label('Continue download', '继续下载'),
      'waiting-network': label('Pause download', '暂停下载'),
      verifying: label('Verifying…', '正在校验…'),
      downloaded: label('Install update', '安装更新'),
      latest: label('Up to date', '已是最新版本'),
      error: label('Retry', '重试'),
    })[status.value],
)
const percent = computed(() => Math.max(0, Math.min(100, progress.value?.percent || 0)))
const description = computed(
  () =>
    ({
      idle: label(
        'Stay up to date with new features and improvements.',
        '保持更新，获得新的功能与改进。',
      ),
      checking: label('Checking for a new version…', '正在检查新版本…'),
      available: label('A new version is available.', '发现新版本，可以开始下载。'),
      downloading: label(
        'Downloading the update. You can keep using the app.',
        '正在下载更新，你可以继续使用应用。',
      ),
      paused: label('Download paused. Your progress is saved.', '下载已暂停，进度已保存。'),
      'waiting-network': label(
        'Waiting for the network. Download will resume automatically.',
        '正在等待网络恢复，随后会自动继续下载。',
      ),
      verifying: label(
        'Verifying the update and preparing installation…',
        '正在校验更新包并准备安装…',
      ),
      downloaded: label(
        'The update is ready. Install it when you are ready to restart.',
        '更新已准备好，可以开始安装。',
      ),
      latest: label('You are running the latest available version.', '当前已是最新可用版本。'),
      error: label('The update could not be completed. Please retry.', '更新未能完成，请重试。'),
    })[status.value],
)
function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)))
  return (value / 1024 ** unit).toFixed(unit ? 1 : 0) + ' ' + ['B', 'KB', 'MB', 'GB'][unit]
}
async function act(): Promise<void> {
  actionError.value = ''
  if (status.value === 'available') await updater.download()
  else if (['downloading', 'waiting-network'].includes(status.value)) await updater.pause()
  else if (status.value === 'paused' || (status.value === 'error' && info.value))
    await updater.resume()
  else if (status.value === 'downloaded') {
    try {
      await window.api.installUpdate()
    } catch {
      actionError.value = label(
        'Could not launch the installer. Please retry.',
        '无法启动安装程序，请重试。',
      )
    }
  } else await updater.check()
}
async function open(key: RuntimeUrlKey): Promise<void> {
  actionError.value = ''
  try {
    await openConfiguredUrl(key)
  } catch {
    actionError.value = label('Could not open this page. Please retry.', '无法打开此页面，请重试。')
  }
}
onMounted(() => {
  void updater.init()
})
</script>
<template>
  <section class="preference-section">
    <div class="about-brand">
      <span><BrandMark :size="28" /></span>
      <strong>Oh My Token</strong>
    </div>
    <p class="preference-description">
      {{
        label('Your AI assistant. Bring your dreams to life with AI.', '你的AI助手，用AI实现梦想吧')
      }}
    </p>
    <div class="preference-card updater-card">
      <div class="preference-row">
        <div>
          <h3>
            {{
              [
                'available',
                'downloading',
                'paused',
                'waiting-network',
                'verifying',
                'downloaded',
              ].includes(status) && info?.version
                ? label('New version ' + info.version, '发现新版本 ' + info.version)
                : label('Check for a new version', '检查新版本')
            }}
          </h3>
          <p>{{ label('Current version', '当前版本') }} {{ currentVersion || '—' }}</p>
        </div>
        <button
          type="button"
          class="workspace-button workspace-button--primary"
          :disabled="['checking', 'verifying', 'latest'].includes(status)"
          @click="act"
        >
          {{ buttonText }}
        </button>
      </div>
      <p class="preference-description" role="status">{{ description }}</p>
      <div
        v-if="
          progress &&
          ['downloading', 'paused', 'waiting-network', 'verifying', 'error'].includes(status)
        "
        class="updater-progress"
      >
        <progress :value="percent" max="100" :aria-label="label('Download progress', '下载进度')" />
        <div>
          <span>
            {{ formatBytes(progress?.transferred || 0) }} / {{ formatBytes(progress?.total || 0) }}
          </span>
          <span>
            <AnimatedNumber :value="percent" :format="{ decimals: 0 }" />
            %
          </span>
        </div>
      </div>
      <div class="settings-release-notes">
        <p v-if="info?.releaseDate" class="preference-description">
          {{ label('Released', '发布日期') }} {{ info.releaseDate.slice(0, 10) }}
        </p>
        <p v-if="info?.releaseNotes" class="release-text">{{ info.releaseNotes }}</p>
        <p v-else class="preference-description">
          {{
            label(
              'Release notes appear here after checking for updates.',
              '检查更新后，版本说明会显示在这里。',
            )
          }}
        </p>
      </div>
      <p v-if="status === 'error' && error" class="preference-status error" role="alert">
        {{ error }}
      </p>
    </div>
  </section>
  <section class="preference-section">
    <h2>{{ label('Learn more', '了解更多') }}</h2>
    <div class="preference-row">
      <div>
        <h3>{{ label('Official website', '官方网站') }}</h3>
        <p>{{ label('Product information and the latest news', '查看产品介绍与最新动态') }}</p>
      </div>
      <button type="button" class="workspace-button" @click="open('websiteUrl')">
        {{ label('Visit website', '访问官网') }} ↗
      </button>
    </div>
    <div class="preference-row">
      <div>
        <h3>{{ label('Privacy policy', '隐私政策') }}</h3>
        <p>{{ label('Learn about information handling and privacy', '了解信息处理与隐私说明') }}</p>
      </div>
      <button type="button" class="workspace-button" @click="open('privacyPolicyUrl')">
        {{ label('View policy', '查看政策') }} ↗
      </button>
    </div>
    <div class="preference-row">
      <div>
        <h3>{{ label('Open-source software notices', '开源软件声明') }}</h3>
        <p>
          {{
            label(
              'View third-party components, copyright and license texts',
              '看第三方组件、版权与许可证原文',
            )
          }}
        </p>
      </div>
      <button type="button" class="workspace-button" @click="noticesOpen = true">
        {{ label('View notices', '查看声明') }}
      </button>
    </div>
    <p v-if="actionError" class="preference-status error" role="alert">{{ actionError }}</p>
  </section>
  <ThirdPartyNoticesDialog :open="noticesOpen" @close="noticesOpen = false" />
</template>
<style scoped>
.about-brand {
  display: flex;
  align-items: center;
  gap: 16px;
}
.about-brand > span {
  width: 28px;
  height: 28px;
}
.about-brand strong {
  font-size: 28px;
  line-height: 40px;
  font-weight: 500;
}
.about-brand + .preference-description {
  margin: 24px 0 32px;
}
.updater-card {
  min-height: 236px;
}
.updater-card .workspace-button {
  min-width: 180px;
}
.settings-release-notes {
  border-top: 1px solid var(--border);
  margin-top: 24px;
  padding-top: 20px;
}
.release-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 22px;
  color: var(--text-muted);
  margin: 0;
}
.updater-progress {
  margin-top: 24px;
}
progress {
  width: 100%;
  height: 6px;
  border: 0;
  appearance: none;
  border-radius: 3px;
  overflow: hidden;
}
progress::-webkit-progress-bar {
  background: var(--border);
}
progress::-webkit-progress-value {
  background: var(--accent);
  transition: width var(--motion-number) var(--motion-ease);
}
.updater-progress > div {
  display: flex;
  justify-content: space-between;
  font: 12px/20px var(--font-number);
  color: var(--text-muted);
  margin-top: 8px;
}
@media (prefers-reduced-motion: reduce) {
  progress::-webkit-progress-value {
    transition: none;
  }
}
</style>
