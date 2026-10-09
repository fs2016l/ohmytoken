<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import type { CloseBehavior } from '@shared/models'
import type { ReplayStorageInfo } from '@shared/replay'
import { useI18n } from '../../i18n/useI18n'
import { useCostCurrency } from '../../composables/useCostCurrency'
import DesignIcon from '../base/DesignIcon.vue'
import SelectControl from '../base/SelectControl.vue'
import SettingsReset from './SettingsReset.vue'
const { label, currentLang, setLang } = useI18n()
const { currency } = useCostCurrency()
const behavior = ref<CloseBehavior>('ask'),
  busy = ref(true),
  error = ref('')
const replayStorage = ref<ReplayStorageInfo | null>(null),
  storageBusy = ref(false),
  storageError = ref('')
let unsubscribe: (() => void) | undefined,
  revision = 0,
  disposed = false
const choices = computed(() => [
  {
    value: 'ask' as const,
    icon: 'behaviorAsk' as const,
    title: label('Ask next time', '下次询问'),
    description: label(
      'Choose whether to keep running or quit each time.',
      '每次关闭时，由你选择保留后台或退出应用。',
    ),
  },
  {
    value: 'background' as const,
    icon: 'behaviorBackground' as const,
    title: label('Minimize to taskbar', '退到任务栏'),
    description: label(
      'Hide the main window and keep the app running.',
      '收起主窗口，应用继续运行。',
    ),
  },
  {
    value: 'quit' as const,
    icon: 'behaviorQuit' as const,
    title: label('Quit the app', '直接关闭'),
    description: label('Close the application and end this run.', '退出应用并结束本次运行。'),
  },
])
async function load(): Promise<void> {
  const current = revision
  busy.value = true
  error.value = ''
  try {
    const value = await window.api.getCloseBehavior()
    if (!disposed && current === revision) behavior.value = value
  } catch (reason) {
    if (!disposed)
      error.value =
        reason instanceof Error
          ? reason.message
          : label('Could not load preference', '读取偏好失败')
  } finally {
    if (!disposed) busy.value = false
  }
}
async function change(value: CloseBehavior): Promise<void> {
  if (busy.value || value === behavior.value) return
  const previous = behavior.value,
    current = ++revision
  behavior.value = value
  busy.value = true
  error.value = ''
  try {
    const saved = await window.api.setCloseBehavior(value)
    if (!disposed && current === revision) behavior.value = saved
  } catch (reason) {
    if (!disposed && current === revision) {
      behavior.value = previous
      error.value =
        reason instanceof Error
          ? reason.message
          : label('Could not save preference', '保存偏好失败')
    }
  } finally {
    if (!disposed) busy.value = false
  }
}
function storageFailure(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason)
  if (message.includes('replay-directory-inside-installation'))
    return label(
      'Choose a folder outside the installation directory so updates cannot remove it.',
      '请选择安装目录之外的文件夹，避免升级时被清理。',
    )
  if (message.includes('replay-storage-busy'))
    return label(
      'Wait for the current generation to finish before changing its folder.',
      '请等待当前生成完成后再修改存储位置。',
    )
  return label(
    'Could not use this folder. Check that it exists and is writable.',
    '无法使用此文件夹，请确认文件夹存在且可写。',
  )
}
async function loadReplayStorage(): Promise<void> {
  storageBusy.value = true
  storageError.value = ''
  try {
    const info = await window.api.replayStorageInfo()
    if (!disposed) replayStorage.value = info
  } catch (reason) {
    if (!disposed) storageError.value = storageFailure(reason)
  } finally {
    if (!disposed) storageBusy.value = false
  }
}
async function changeReplayStorage(reset = false): Promise<void> {
  if (storageBusy.value) return
  storageBusy.value = true
  storageError.value = ''
  try {
    const info = reset
      ? await window.api.replayResetStorageDirectory()
      : await window.api.replayChooseStorageDirectory()
    if (!disposed) replayStorage.value = info
  } catch (reason) {
    if (!disposed) storageError.value = storageFailure(reason)
  } finally {
    if (!disposed) storageBusy.value = false
  }
}
async function openReplayStorage(): Promise<void> {
  storageError.value = ''
  try {
    await window.api.replayOpenFolder()
  } catch (reason) {
    storageError.value = storageFailure(reason)
  }
}
onMounted(() => {
  unsubscribe = window.api.onCloseBehaviorChanged((value) => {
    revision++
    behavior.value = value
  })
  void load()
  void loadReplayStorage()
})
onBeforeUnmount(() => {
  disposed = true
  unsubscribe?.()
})
</script>
<template>
  <section class="preference-section">
    <h2>{{ label('Interface language', '界面语言') }}</h2>
    <div class="preference-row">
      <div>
        <h3>{{ label('Display language', '显示语言') }}</h3>
        <p>{{ label('Applied immediately throughout the app.', '更改后立即应用到整个界面') }}</p>
      </div>
      <SelectControl
        class="preference-select"
        :model-value="currentLang"
        :label="label('Display language', '显示语言')"
        :options="[
          { value: 'zh', label: '简体中文' },
          { value: 'en', label: 'English' },
        ]"
        @update:model-value="setLang($event as 'zh' | 'en')"
      />
    </div>
  </section>
  <section class="preference-section">
    <h2>{{ label('Generation history location', '生成历史存储位置') }}</h2>
    <p class="preference-description">
      {{
        label(
          'New images and videos are saved here. Existing history remains readable in its original folder.',
          '新生成的图片与视频会保存在这里，已有历史仍可从原文件夹读取。',
        )
      }}
    </p>
    <div class="replay-storage-setting">
      <div class="replay-storage-path" :title="replayStorage?.directory">
        {{ replayStorage?.directory ?? label('Loading…', '正在读取…') }}
      </div>
      <div class="replay-storage-actions">
        <button
          type="button"
          class="workspace-button workspace-button--primary"
          :disabled="storageBusy"
          @click="changeReplayStorage()"
        >
          {{ label('Choose folder', '选择文件夹') }}
        </button>
        <button
          type="button"
          class="workspace-button"
          :disabled="storageBusy || !replayStorage?.selectedDirectory"
          @click="changeReplayStorage(true)"
        >
          {{ label('Restore default', '恢复默认') }}
        </button>
        <button
          type="button"
          class="workspace-link"
          :disabled="storageBusy || !replayStorage"
          @click="openReplayStorage"
        >
          {{ label('Open folder', '打开文件夹') }}
        </button>
      </div>
      <p v-if="replayStorage?.defaultReason === 'development'" class="preference-description">
        {{
          label(
            'The development build uses the app data folder by default. Choose another folder to change it.',
            '开发版默认使用应用数据目录，可通过“选择文件夹”修改。',
          )
        }}
      </p>
      <p
        v-else-if="replayStorage?.defaultReason === 'unwritable-installation'"
        class="preference-description"
      >
        {{
          label(
            'The installation folder is not writable, so the app data folder is used by default.',
            '安装目录不可写，因此默认使用应用数据目录。',
          )
        }}
      </p>
      <p class="preference-description">
        {{
          label(
            'Choose a folder outside the installation directory. Updates will keep its contents.',
            '请选择安装目录之外的文件夹；覆盖更新不会清理该位置的内容。',
          )
        }}
      </p>
      <p v-if="storageError" class="preference-status error" role="alert">{{ storageError }}</p>
    </div>
  </section>
  <section class="preference-section">
    <h2>{{ label('Currency', '计费单位') }}</h2>
    <div class="preference-row">
      <div>
        <h3>{{ label('Display currency', '显示币种') }}</h3>
        <p>
          {{
            label(
              'Used for cost estimates and plan comparisons throughout the app.',
              '用于整个软件的预估花费与套餐比价。',
            )
          }}
        </p>
      </div>
      <SelectControl
        v-model="currency"
        class="preference-select"
        :label="label('Display currency', '显示币种')"
        :options="[
          { value: 'CNY', label: label('Chinese yuan CNY', '人民币 CNY') },
          { value: 'USD', label: label('US dollar USD', '美元 USD') },
        ]"
      />
    </div>
  </section>
  <section class="preference-section">
    <h2>{{ label('Window behavior', '窗口行为') }}</h2>
    <p class="preference-description">
      {{
        label(
          'Choose what happens when you close the main window.',
          '设置点击主窗口关闭按钮后的操作。',
        )
      }}
    </p>
    <div
      class="close-choice-grid"
      role="radiogroup"
      :aria-label="label('Close behavior', '关闭窗口行为')"
    >
      <label
        v-for="choice in choices"
        :key="choice.value"
        class="close-choice"
        :class="{ selected: behavior === choice.value }"
      >
        <input
          type="radio"
          name="close-behavior"
          :value="choice.value"
          :checked="behavior === choice.value"
          :disabled="busy"
          @change="change(choice.value)"
        />
        <DesignIcon :name="choice.icon" :size="24" />
        <strong>{{ choice.title }}</strong>
        <span>{{ choice.description }}</span>
      </label>
    </div>
    <p class="preference-description">
      {{
        label(
          'Changes are saved automatically and apply the next time you close the window.',
          '更改会自动保存，并在下次关闭主窗口时生效。',
        )
      }}
    </p>
    <p v-if="error" class="workspace-error" role="alert">
      {{ error }}
      <button type="button" class="workspace-link" @click="load">
        {{ label('Retry', '重试') }}
      </button>
    </p>
  </section>
  <SettingsReset />
</template>
<style scoped>
.replay-storage-setting {
  margin-top: 16px;
}
.replay-storage-path {
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-container);
  color: var(--text);
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
  user-select: text;
}
.replay-storage-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.replay-storage-actions .workspace-button {
  min-width: 0;
  padding-inline: 16px;
}
.close-choice-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  margin: 16px 0;
}
.close-choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 12px;
  position: relative;
  min-height: 150px;
  cursor: pointer;
  transition:
    border-color var(--motion-hover),
    background var(--motion-hover);
}
.close-choice.selected {
  border-color: var(--primary-border);
  background: var(--primary-soft);
}
.close-choice .design-icon {
  color: var(--text-soft);
  margin-bottom: 16px;
}
.close-choice.selected .design-icon {
  color: var(--accent);
}
.close-choice input {
  position: absolute;
  top: 24px;
  right: 24px;
  width: 20px;
  height: 20px;
  accent-color: var(--accent);
  margin: 0;
}
.close-choice strong {
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}
.close-choice > span:last-child {
  color: var(--text-soft);
  font-size: 12px;
  line-height: 20px;
}
.close-choice:has(:disabled) {
  cursor: wait;
}
@media (prefers-reduced-motion: reduce) {
  .close-choice {
    transition: none;
  }
}
</style>
