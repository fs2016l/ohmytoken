<script setup lang="ts">
import { useAppSettings } from '../../composables/useAppSettings'
import { useI18n } from '../../i18n/useI18n'
import {
  codeFontOptions,
  interfaceFontOptions,
  isCodeFont,
  isInterfaceFont,
  isNumberFont,
  numberFontOptions,
  type LocalizedFontName,
} from '../../config/typography'

const { tr, label } = useI18n()
const { settings, updateInterfaceFont, updateCodeFont, updateNumberFont } = useAppSettings()

function localizedName(name: LocalizedFontName): string {
  return label(name.en, name.zh)
}

function onInterfaceFontChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (isInterfaceFont(value)) updateInterfaceFont(value)
}

function onCodeFontChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (isCodeFont(value)) updateCodeFont(value)
}

function onNumberFontChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (isNumberFont(value)) updateNumberFont(value)
}
</script>

<template>
  <section class="settings-section typography-section">
    <h2 class="section-title">
      <span class="material-symbols-outlined filled-icon" aria-hidden="true">text_fields</span>
      {{ tr('typographySettings') }}
    </h2>

    <div class="setting-row">
      <span class="row-icon material-symbols-outlined" aria-hidden="true">text_fields</span>
      <div class="setting-info">
        <span class="setting-name">{{ tr('interfaceFont') }}</span>
        <span class="setting-desc">{{ tr('interfaceFontDesc') }}</span>
      </div>
      <div class="setting-control">
        <select
          class="setting-select typography-select"
          :aria-label="tr('interfaceFont')"
          :value="settings.interfaceFont"
          @change="onInterfaceFontChange"
        >
          <option v-for="option in interfaceFontOptions" :key="option.id" :value="option.id">
            {{ localizedName(option.name) }}
          </option>
        </select>
      </div>
    </div>

    <div class="setting-row">
      <span class="row-icon material-symbols-outlined" aria-hidden="true">code</span>
      <div class="setting-info">
        <span class="setting-name">{{ tr('codeFont') }}</span>
        <span class="setting-desc">{{ tr('codeFontDesc') }}</span>
      </div>
      <div class="setting-control">
        <select
          class="setting-select typography-select"
          :aria-label="tr('codeFont')"
          :value="settings.codeFont"
          @change="onCodeFontChange"
        >
          <option v-for="option in codeFontOptions" :key="option.id" :value="option.id">
            {{ localizedName(option.name) }}
          </option>
        </select>
      </div>
    </div>

    <div class="setting-row">
      <span class="row-icon material-symbols-outlined" aria-hidden="true">tag</span>
      <div class="setting-info">
        <span class="setting-name">{{ tr('numberFont') }}</span>
        <span class="setting-desc">{{ tr('numberFontDesc') }}</span>
      </div>
      <div class="setting-control">
        <select
          class="setting-select typography-select"
          :aria-label="tr('numberFont')"
          :value="settings.numberFont"
          @change="onNumberFontChange"
        >
          <option v-for="option in numberFontOptions" :key="option.id" :value="option.id">
            {{ localizedName(option.name) }}
          </option>
        </select>
      </div>
    </div>
  </section>
</template>
