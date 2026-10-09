<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import { useTheme } from '../../composables/useTheme'
import { useWindowMaterial } from '../../composables/useWindowMaterial'
import { glassMaterials } from '../../config/glass-materials'
import DesignIcon from '../base/DesignIcon.vue'
import AppearancePreview from './AppearancePreview.vue'

const { label } = useI18n()
const { currentTheme, currentAccent } = useTheme()
const { materialState, materialPending, materialFailed, setMaterial } = useWindowMaterial()
const fallback = computed(() => {
  if (materialFailed.value)
    return label('Could not save the material. Please try again.', '材质设置未保存，请重试。')
  if (materialState.value.preferences.style === 'solid' || !materialState.value.reason) return ''
  if (materialState.value.reason === 'reduced-transparency')
    return label(
      'Transparency is disabled in system accessibility settings. A solid surface is shown.',
      '系统已关闭透明效果或启用高对比度，当前显示纯色背景。',
    )
  return label(
    'Native glass is unavailable on this device. A solid surface is shown.',
    '此设备暂时无法启用原生玻璃，当前显示纯色背景。',
  )
})
async function choose(item: (typeof glassMaterials)[number]): Promise<void> {
  if (materialState.value.preferences.style === item.id && !materialFailed.value) return
  await setMaterial(item.id)
}
</script>

<template>
  <section class="preference-section material-settings">
    <h2>{{ label('3  Window material', '3  窗口材质') }}</h2>
    <p class="material-intro">
      {{
        label(
          'Main and floating windows share this finish. Your palette and light / dark choice stay the same.',
          '主窗口与浮窗同步生效，保留当前配色和明暗。',
        )
      }}
    </p>
    <div class="material-options" role="group" :aria-label="label('Window material', '窗口材质')">
      <button
        v-for="item in glassMaterials"
        :key="item.id"
        type="button"
        :disabled="materialPending"
        :aria-label="label(item.name.en, item.name.zh)"
        :aria-pressed="materialState.preferences.style === item.id"
        :class="{ selected: materialState.preferences.style === item.id }"
        @click="choose(item)"
      >
        <AppearancePreview
          :palette="currentAccent"
          :appearance="currentTheme"
          :material="item.id"
        />
        <strong>
          {{ label(item.name.en, item.name.zh) }}
          <DesignIcon v-if="materialState.preferences.style === item.id" name="check" :size="16" />
        </strong>
        <small>{{ label(item.description.en, item.description.zh) }}</small>
      </button>
    </div>
    <p class="material-hint">
      {{
        label(
          'Previewed over the same background. Actual glass picks up your desktop; text and data panels stay opaque.',
          '预览使用同一背景。实际玻璃随桌面透色，文字与数据面板保持清晰。',
        )
      }}
    </p>
    <p v-if="fallback" class="material-fallback" role="status">{{ fallback }}</p>
  </section>
</template>

<style scoped>
.material-intro,
.material-hint,
.material-fallback {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 21px;
  color: var(--text-muted);
}
.material-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 20px;
}
.material-options button {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--text);
  background: var(--surface-low);
  cursor: pointer;
  text-align: left;
}
.material-options button:hover:not(:disabled) {
  border-color: var(--primary-border);
}
.material-options button.selected {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 1px var(--primary);
}
.material-options button:disabled {
  cursor: wait;
}
.material-options :deep(.appearance-preview) {
  aspect-ratio: 2.6;
}
.material-options strong {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  font-size: 14px;
  font-weight: 500;
}
.material-options small {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-muted);
}
.material-hint {
  margin-top: 16px;
}
.material-fallback {
  color: var(--warning);
}
@media (max-width: 900px) {
  .material-options {
    grid-template-columns: 1fr;
  }
}
</style>
