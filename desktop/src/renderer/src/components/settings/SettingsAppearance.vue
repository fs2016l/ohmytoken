<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import { useTheme } from '../../composables/useTheme'
import { useWindowMaterial } from '../../composables/useWindowMaterial'
import { getTheme } from '../../config/themes'
import { glassMaterials } from '../../config/glass-materials'
import DesignIcon from '../base/DesignIcon.vue'
import TypographySettings from './TypographySettings.vue'
import MaterialSettings from './MaterialSettings.vue'
import AppearancePreview from './AppearancePreview.vue'

const { label } = useI18n()
const { currentTheme, currentAccent, setTheme, setAccent, themes } = useTheme()
const { materialState } = useWindowMaterial()
const selection = computed(() => {
  const theme = getTheme(currentAccent.value)
  const material = glassMaterials.find((item) => item.id === materialState.value.preferences.style)!
  return [
    label(theme.name.en, theme.name.zh),
    currentTheme.value === 'light' ? label('Light', '浅色') : label('Dark', '深色'),
    label(material.name.en, material.name.zh),
  ].join(' · ')
})
</script>

<template>
  <section class="preference-section appearance-settings">
    <h2>{{ label('1  Color theme', '1  配色主题') }}</h2>
    <p class="appearance-description">
      {{
        label(
          'Choose a complete palette for your sidebar, surfaces and controls.',
          '侧栏、背景与按钮一起切换，选择一套完整配色。',
        )
      }}
    </p>
    <div class="palette-options" role="group" :aria-label="label('Color theme', '配色主题')">
      <button
        v-for="theme in themes"
        :key="theme.id"
        type="button"
        :class="{ selected: currentAccent === theme.id }"
        :aria-label="label(theme.name.en, theme.name.zh)"
        :aria-pressed="currentAccent === theme.id"
        @click="setAccent(theme.id)"
      >
        <AppearancePreview :palette="theme.id" :appearance="currentTheme" />
        <strong>
          {{ label(theme.name.en, theme.name.zh) }}
          <DesignIcon v-if="currentAccent === theme.id" name="check" :size="16" />
        </strong>
      </button>
    </div>
    <div class="appearance-mode">
      <h2>{{ label('2  Light / dark', '2  明暗模式') }}</h2>
      <div class="appearance-mode-controls">
        <div class="theme-options" role="group" :aria-label="label('Light / dark', '明暗模式')">
          <button
            v-for="mode in ['light', 'dark'] as const"
            :key="mode"
            type="button"
            class="workspace-button"
            :class="{ 'workspace-button--primary': currentTheme === mode }"
            :aria-pressed="currentTheme === mode"
            @click="setTheme(mode)"
          >
            {{ mode === 'light' ? label('Light', '浅色') : label('Dark', '深色') }}
            <DesignIcon v-if="currentTheme === mode" name="check" :size="14" />
          </button>
        </div>
        <p>{{ label('Two brightness levels of the same palette', '同一配色的两套亮度层级') }}</p>
      </div>
    </div>
  </section>
  <MaterialSettings />
  <p class="appearance-summary" aria-live="polite">
    {{ label('Current combination: ', '当前组合：') }}{{ selection }}
  </p>
  <TypographySettings />
</template>

<style scoped>
.appearance-description,
.appearance-mode-controls p,
.appearance-summary {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 21px;
}
.palette-options {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-top: 20px;
}
.palette-options > button {
  min-width: 0;
  padding: 12px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--text);
  background: var(--surface-low);
  cursor: pointer;
}
.palette-options > button:hover {
  border-color: var(--primary-border);
}
.palette-options > button.selected {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 1px var(--primary);
}
.palette-options strong {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  font-size: 14px;
  font-weight: 500;
}
.palette-options strong :deep(.design-icon) {
  color: var(--primary);
}
.appearance-mode {
  margin-top: 28px;
}
.appearance-mode-controls {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 14px;
  flex-wrap: wrap;
}
.appearance-mode-controls p {
  margin: 0;
}
.theme-options {
  display: flex;
  gap: 12px;
}
.theme-options button {
  min-width: 92px;
}
.appearance-summary {
  margin: 18px 0 0;
}
@media (max-width: 1100px) {
  .palette-options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
