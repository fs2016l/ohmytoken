<script setup lang="ts">
import { useAppSettings } from '../../composables/useAppSettings'
import { useI18n } from '../../i18n/useI18n'
import SelectControl from '../base/SelectControl.vue'
import {
  codeFontOptions,
  interfaceFontOptions,
  numberFontOptions,
  isCodeFont,
  isInterfaceFont,
  isNumberFont,
} from '../../config/typography'
const { label } = useI18n()
const { settings, updateInterfaceFont, updateCodeFont, updateNumberFont } = useAppSettings()
function change(kind: 'interface' | 'code' | 'number', value: string): void {
  if (kind === 'interface' && isInterfaceFont(value)) updateInterfaceFont(value)
  if (kind === 'code' && isCodeFont(value)) updateCodeFont(value)
  if (kind === 'number' && isNumberFont(value)) updateNumberFont(value)
}
</script>
<template>
  <section class="preference-section typography-preferences">
    <h2>{{ label('Typography', '字体排版') }}</h2>
    <div class="preference-row">
      <div>
        <h3>{{ label('Interface font', '界面字体') }}</h3>
        <p>{{ label('Interface text and Chinese characters', '中文与界面文字') }}</p>
      </div>
      <SelectControl
        class="preference-select"
        :label="label('Interface font', '界面字体')"
        :model-value="settings.interfaceFont"
        :options="
          interfaceFontOptions.map((option) => ({
            value: option.id,
            label: label(option.name.en, option.name.zh),
          }))
        "
        @update:model-value="change('interface', $event)"
      />
    </div>
    <div class="preference-row">
      <div>
        <h3>{{ label('Code font', '代码字体') }}</h3>
        <p>{{ label('Code snippets in conversations', '会话中的代码片段') }}</p>
      </div>
      <SelectControl
        class="preference-select"
        :label="label('Code font', '代码字体')"
        :model-value="settings.codeFont"
        :options="
          codeFontOptions.map((option) => ({
            value: option.id,
            label: label(option.name.en, option.name.zh),
          }))
        "
        @update:model-value="change('code', $event)"
      />
    </div>
    <div class="preference-row">
      <div>
        <h3>{{ label('Number font', '数字字体') }}</h3>
        <p>{{ label('Token counts and costs', 'Token 与费用数字') }}</p>
      </div>
      <SelectControl
        class="preference-select"
        :label="label('Number font', '数字字体')"
        :model-value="settings.numberFont"
        :options="
          numberFontOptions.map((option) => ({
            value: option.id,
            label: label(option.name.en, option.name.zh),
          }))
        "
        @update:model-value="change('number', $event)"
      />
    </div>
    <div class="typography-preview" :aria-label="label('Font preview', '字体预览')">
      <span>{{ label('Preview', '预览') }}</span>
      <p>Oh My Token&#12288;中文界面 Aa</p>
      <p class="numeric">128,640.0</p>
      <code>totalTokens</code>
    </div>
  </section>
</template>
<style scoped>
.preference-row + .preference-row {
  border-top: 1px solid var(--border);
}
.typography-preview {
  display: flex;
  align-items: center;
  gap: 36px;
  flex-wrap: wrap;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-container);
  font-size: 14px;
  line-height: 22px;
}
.typography-preview > span {
  color: var(--text-soft);
  font-size: 12px;
}
.typography-preview > p {
  margin: 0;
}
.typography-preview > p:first-of-type {
  flex: 1;
}
.typography-preview code {
  font: 13px var(--font-mono);
  color: var(--text-muted);
  background: transparent;
}
</style>
