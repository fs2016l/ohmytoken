<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { openConfiguredUrl } from '../../api/runtime-config'
import UserAvatar from '../base/UserAvatar.vue'
import DesignIcon from '../base/DesignIcon.vue'
const { label } = useI18n(),
  { currentUser, isHydrating, login, logout } = useAuth()
const busy = ref(false),
  waiting = ref(false),
  error = ref('')
const name = computed(
  () =>
    currentUser.value?.nickname || currentUser.value?.username || label('Not signed in', '未登录'),
)
watch(currentUser, () => {
  waiting.value = false
  error.value = ''
})
async function authenticate(signOut = false): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (signOut) {
      await logout()
      waiting.value = false
    } else {
      await login()
      waiting.value = !currentUser.value
    }
  } catch (reason) {
    error.value =
      reason instanceof Error
        ? reason.message
        : label('Could not update your session', '无法更新登录状态')
  } finally {
    busy.value = false
  }
}
async function account(): Promise<void> {
  error.value = ''
  try {
    await openConfiguredUrl('accountPageUrl')
  } catch {
    error.value = label('Could not open the account page', '无法打开账号页面')
  }
}
</script>
<template>
  <section class="preference-card account-preference">
    <div class="preference-row">
      <div class="account-identity">
        <span class="settings-account-avatar">
          <UserAvatar
            v-if="currentUser"
            :src="currentUser.avatar"
            :fallback="name.charAt(0).toUpperCase()"
            :alt="name"
          />
          <DesignIcon v-else name="person" :size="24" />
        </span>
        <div>
          <h3>{{ isHydrating ? label('Loading…', '正在加载…') : name }}</h3>
          <p>
            {{
              currentUser
                ? currentUser.email || currentUser.username
                : label(
                    'Sign in to view and manage your account.',
                    '登录后，在这里查看和管理你的账号。',
                  )
            }}
          </p>
        </div>
      </div>
      <div class="account-preference-actions" :data-window-retain="busy">
        <template v-if="currentUser">
          <button type="button" class="workspace-button" :disabled="busy" @click="account">
            {{ label('Account details', '账号详情') }}
          </button>
          <button
            type="button"
            class="workspace-button"
            :disabled="busy"
            @click="authenticate(true)"
          >
            {{ label('Sign out', '退出登录') }}
          </button>
        </template>
        <button
          v-else
          type="button"
          class="workspace-button workspace-button--primary"
          :disabled="busy || isHydrating"
          @click="authenticate()"
        >
          {{
            busy
              ? label('Opening…', '正在打开…')
              : waiting
                ? label('Reopen sign-in', '重新打开登录页')
                : label('Sign in', '登录')
          }}
        </button>
      </div>
    </div>
    <p class="preference-description" role="status">
      {{
        currentUser
          ? label(
              'Your discovery favorites follow this account across devices.',
              '发现模块的收藏会跟随此账号同步。',
            )
          : waiting
            ? label(
                'Complete sign-in in your browser. The app will update automatically.',
                '请在浏览器完成登录，完成后账号状态会自动同步回应用。',
              )
            : label(
                'Sign-in continues in your system browser.',
                '点击登录后，将在系统浏览器中继续。',
              )
      }}
    </p>
    <p v-if="error" class="preference-status error" role="alert">{{ error }}</p>
  </section>
  <section class="preference-section account-instructions">
    <h2>{{ label('How to sign in', '登录方式') }}</h2>
    <ol>
      <li>
        <span>01</span>
        <div>
          <h3>{{ label('Continue in your browser', '在浏览器中继续') }}</h3>
          <p>
            {{
              label(
                'The sign-in page opens in your system browser.',
                '使用系统浏览器打开登录页面。',
              )
            }}
          </p>
        </div>
      </li>
      <li>
        <span>02</span>
        <div>
          <h3>{{ label('Return automatically after sign-in', '登录后自动返回') }}</h3>
          <p>
            {{
              label(
                'Your account status is synchronized back to the app.',
                '完成登录后，账号状态会同步到应用。',
              )
            }}
          </p>
        </div>
      </li>
    </ol>
  </section>
</template>
<style scoped>
.account-preference {
  min-height: 208px;
}
.account-identity {
  display: flex;
  gap: 24px;
  align-items: center;
}
.settings-account-avatar {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  flex: none;
  border-radius: 50%;
  background: var(--surface-low);
  color: var(--text-muted);
  overflow: hidden;
}
.account-preference-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.account-instructions {
  border-top: 1px solid var(--border);
  padding-top: 32px;
  margin-top: 32px;
}
ol {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
li > span {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--text-muted);
  background: var(--surface-container);
  font: 14px var(--font-number);
}
li h3 {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
}
li p {
  margin: 2px 0 0;
  font-size: 13px;
  line-height: 22px;
  color: var(--text-soft);
}
</style>
