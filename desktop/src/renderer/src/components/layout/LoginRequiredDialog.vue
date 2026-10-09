<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useLoginPrompt } from '../../composables/useLoginPrompt'
import { useI18n } from '../../i18n/useI18n'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import DesignIcon from '../base/DesignIcon.vue'

const prompt = useLoginPrompt()
const { isLoggedIn } = useAuth()
const { label } = useI18n()
watch(isLoggedIn, (loggedIn) => {
  if (loggedIn) prompt.cancel()
})
onBeforeUnmount(prompt.cancel)
</script>

<template>
  <WorkspaceDialog
    class="login-required-dialog"
    :open="prompt.open.value"
    :busy="prompt.busy.value"
    :title="label('Sign in to continue', '登录后继续')"
    aria-describedby="login-required-description"
    @close="prompt.cancel"
  >
    <div class="login-required-content">
      <div class="login-required-summary">
        <div class="login-required-icon" aria-hidden="true">
          <DesignIcon name="person" :size="32" />
        </div>
        <div>
          <h3>{{ label('This feature requires sign in', '此功能需要登录') }}</h3>
          <p id="login-required-description">
            {{
              label(
                'Sign in to your account to continue using this feature.',
                '登录账号后，即可继续使用此功能。',
              )
            }}
          </p>
        </div>
      </div>
      <p class="login-required-hint">
        <DesignIcon name="login" :size="18" aria-hidden="true" />
        {{ label('The sign-in page will open in your browser.', '将在浏览器中打开登录页面。') }}
      </p>
      <p v-if="prompt.failed.value" class="login-required-error" role="alert">
        {{
          label('Could not open the sign-in page. Please try again.', '无法打开登录页面，请重试。')
        }}
      </p>
    </div>
    <template #footer>
      <button
        type="button"
        class="workspace-button"
        :disabled="prompt.busy.value"
        @click="prompt.cancel"
      >
        {{ label('Not now', '暂不登录') }}
      </button>
      <button
        type="button"
        class="workspace-button workspace-button--primary"
        :disabled="prompt.busy.value"
        autofocus
        @click="prompt.confirm"
      >
        {{ prompt.busy.value ? label('Opening…', '正在打开…') : label('Sign in now', '立即登录') }}
        <span v-if="!prompt.busy.value" aria-hidden="true">→</span>
      </button>
    </template>
  </WorkspaceDialog>
</template>

<style scoped>
.login-required-dialog {
  --dialog-width: 520px;
}
.login-required-content {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.login-required-summary {
  display: flex;
  align-items: center;
  gap: 20px;
}
.login-required-icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  flex: none;
  border-radius: 12px;
  background: var(--primary-soft);
  color: var(--primary-soft-text);
}
h3 {
  margin: 0 0 6px;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}
p {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--text-muted);
}
.login-required-hint {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--primary-soft);
}
.login-required-hint :deep(.design-icon) {
  color: var(--accent);
}
.login-required-error {
  color: var(--error);
}
</style>
