<script setup lang="ts">
import { ref } from 'vue'
import type { AppLanguage } from '@shared/app-preferences'
import BrandMark from '../base/BrandMark.vue'
import '../../composables/useTheme'

defineEmits<{ choose: [language: AppLanguage] }>()
const language = ref<AppLanguage>(navigator.language.startsWith('zh') ? 'zh' : 'en')
</script>

<template>
  <main class="language-setup">
    <section class="language-setup-card" aria-labelledby="language-setup-title">
      <BrandMark class="language-setup-brand" :size="40" />
      <h1 id="language-setup-title">
        Choose your language
        <br />
        <span>选择界面语言</span>
      </h1>
      <div class="language-setup-options" role="radiogroup" aria-label="Language / 界面语言">
        <label :class="{ selected: language === 'zh' }">
          <input v-model="language" type="radio" name="setup-language" value="zh" />
          <strong>简体中文</strong>
          <span>默认计费单位：人民币 CNY</span>
        </label>
        <label :class="{ selected: language === 'en' }">
          <input v-model="language" type="radio" name="setup-language" value="en" />
          <strong>English</strong>
          <span>Default currency: US dollar USD</span>
        </label>
      </div>
      <p>
        {{
          language === 'zh'
            ? '之后可在通用设置中分别更改语言和计费单位。'
            : 'You can change language and currency separately in General settings.'
        }}
      </p>
      <button
        type="button"
        class="workspace-button workspace-button--primary"
        @click="$emit('choose', language)"
      >
        {{ language === 'zh' ? '继续' : 'Continue' }}
      </button>
    </section>
  </main>
</template>

<style scoped>
.language-setup {
  display: grid;
  place-items: center;
  min-height: 100dvh;
  padding: 32px;
  background: var(--bg-base);
  color: var(--text);
}
.language-setup-card {
  width: min(100%, 520px);
  padding: 32px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-low);
}
.language-setup-brand {
  width: 40px;
  height: 40px;
}
h1 {
  font-size: 24px;
  line-height: 1.5;
  margin: 20px 0;
}
h1 span {
  font-size: 18px;
  font-weight: 400;
  color: var(--text-muted);
}
.language-setup-options {
  display: grid;
  gap: 12px;
}
.language-setup-options label {
  display: grid;
  grid-template-columns: 20px 1fr;
  gap: 4px 12px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}
.language-setup-options label.selected {
  background: var(--primary-soft);
  border-color: var(--primary-border);
}
.language-setup-options input {
  grid-row: span 2;
  align-self: center;
  accent-color: var(--accent);
  width: 18px;
  height: 18px;
  margin: 0;
}
.language-setup-options strong {
  font-size: 16px;
  line-height: 24px;
}
.language-setup-options span,
p {
  font-size: 13px;
  line-height: 20px;
  color: var(--text-muted);
}
p {
  margin: 20px 0;
}
.workspace-button {
  width: 100%;
}
</style>
