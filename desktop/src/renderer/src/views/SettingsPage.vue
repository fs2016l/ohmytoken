<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useI18n } from '../i18n/useI18n'
import { settingsDestinations } from '../config/settings-navigation'
import PageSurface from '../components/base/PageSurface.vue'
import SettingsGeneral from '../components/settings/SettingsGeneral.vue'
import SettingsAppearance from '../components/settings/SettingsAppearance.vue'
import SettingsAccount from '../components/settings/SettingsAccount.vue'
import SettingsDiagnostics from '../components/settings/SettingsDiagnostics.vue'
import SettingsFeedback from '../components/settings/SettingsFeedback.vue'
import SettingsAbout from '../components/settings/SettingsAbout.vue'
import '../components/settings/settings.css'
const pages = {
  general: SettingsGeneral,
  appearance: SettingsAppearance,
  account: SettingsAccount,
  diagnostics: SettingsDiagnostics,
  feedback: SettingsFeedback,
  about: SettingsAbout,
}
const incoming = String(useRoute().params.section)
const section = (incoming in pages ? incoming : 'general') as keyof typeof pages
const page = pages[section]
const destination = settingsDestinations.find((item) => item.to === '/settings/' + section)!
const { label } = useI18n()
</script>
<template>
  <PageSurface :page-key="'settings-' + section" class="settings-destination">
    <header class="workspace-heading">
      <div>
        <h1>{{ label(destination.title[0], destination.title[1]) }}</h1>
        <p>{{ label(destination.subtitle[0], destination.subtitle[1]) }}</p>
      </div>
      <span v-if="section === 'appearance'" class="settings-save-hint">
        {{ label('Changes saved automatically', '更改自动保存') }}
      </span>
    </header>
    <component :is="page" />
  </PageSurface>
</template>
<style scoped>
.settings-save-hint {
  color: var(--text-soft);
  font-size: 12px;
  line-height: 20px;
}
</style>
