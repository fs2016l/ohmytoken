<script setup lang="ts">
import { computed, defineAsyncComponent, inject, onMounted, ref, watch } from 'vue'
import { discoveryPageKey } from '@shared/discovery-ui'
import DiscoveryHost from '../discovery/DiscoveryHost.vue'
import { useRoute, useRouter } from 'vue-router'
import { navigationGroups as groups } from '../../config/navigation'
import { settingsNavigationGroups, isSettingsPath } from '../../config/settings-navigation'
import { usePageState } from '../../composables/usePageState'
import { useWorkspaceNavigation } from '../../composables/useWorkspaceNavigation'
import { useI18n } from '../../i18n/useI18n'
import { useUpdater } from '../../composables/useUpdater'
import { useMessageDetails } from '../../composables/useMessageDetails'
import { discoveryPageTransition } from '../../utils/discovery-navigation'
import RefreshControl from './RefreshControl.vue'
import HeaderDisplayControls from './HeaderDisplayControls.vue'
import UserMenu from './UserMenu.vue'
import RoutePageHost from './RoutePageHost.vue'
import MessageBanner from '../message/MessageBanner.vue'
import BrandMark from '../base/BrandMark.vue'
import DesignIcon from '../base/DesignIcon.vue'
import CloseBehaviorDialog from './CloseBehaviorDialog.vue'
import TrayUpdateDialog from './TrayUpdateDialog.vue'
import LoginRequiredDialog from './LoginRequiredDialog.vue'

const { label } = useI18n()
const MessageDetails = defineAsyncComponent(() => import('../message/MessageDetails.vue'))
const {
  message: announcement,
  unavailable: announcementUnavailable,
  close: closeAnnouncement,
} = useMessageDetails()
const route = useRoute()
// The browser reference fixture opts out to compare the original pages with the remote build.
const remoteDiscovery = inject('remote-discovery-enabled', true)
const inDiscovery = computed(() => remoteDiscovery && discoveryPageKey(route.path) !== null)
const remoteOverlay = ref(false)
watch(
  () => route.fullPath,
  () => {
    if (announcement.value || announcementUnavailable.value) closeAnnouncement()
  },
)
const workspaceNavigation = useWorkspaceNavigation(useRouter())
const pageTransition = ref('workspace-page')
watch(
  () => route.path,
  (to, from) => {
    pageTransition.value = discoveryPageTransition(from, to)
  },
  { flush: 'sync' },
)
function enablePage(element: Element): void {
  element.removeAttribute('inert')
}
function disablePage(element: Element): void {
  element.setAttribute('inert', '')
}
const settingsNavigation = usePageState('settings-navigation', {
  destination: '/settings/general',
  returnTo: '/agent',
})
const inSettings = computed(() => route.path === '/settings' || isSettingsPath(route.path))
const sidebarGroups = computed(() => (inSettings.value ? settingsNavigationGroups : groups))
const settingsDestination = computed(() =>
  isSettingsPath(settingsNavigation.destination)
    ? settingsNavigation.destination
    : '/settings/general',
)
const workspaceDestination = computed(() =>
  /^\/(agent(?:-download)?|sessions|projects|token|analytics|codingplan|insight|network-check|generation-history)(?:[/?]|$)/.test(
    settingsNavigation.returnTo,
  )
    ? settingsNavigation.returnTo
    : '/agent',
)
watch(
  () => route.fullPath,
  (path) => {
    if (isSettingsPath(route.path)) settingsNavigation.destination = route.path
    else if (!inSettings.value && route.matched.length) settingsNavigation.returnTo = path
  },
  { immediate: true },
)
const active = (path: string): boolean => route.path === path || route.path.startsWith(path + '/')
const breadcrumb = computed(() => {
  for (const group of groups)
    for (const item of group.items)
      if (active(item.to))
        return [label(group.title[0], group.title[1]), label(item.title[0], item.title[1])]
  return [label('Workspace', '工作台'), label('Settings', '设置')]
})
const updater = useUpdater({ latestResetMs: 2000, errorResetMs: 2000 })
const updateDialog = ref<InstanceType<typeof TrayUpdateDialog>>()
const updateStatus = updater.status
const updateShown = computed(() =>
  ['available', 'downloading', 'paused', 'waiting-network', 'verifying', 'downloaded'].includes(
    updateStatus.value,
  ),
)
const updateLabel = computed(() =>
  updateStatus.value === 'paused'
    ? label('Continue', '继续下载')
    : updateStatus.value === 'waiting-network'
      ? label('Waiting', '等待网络')
      : updateStatus.value === 'verifying'
        ? label('Verifying', '校验中')
        : updateStatus.value === 'downloading'
          ? `${Math.max(0, Math.min(100, Math.round(updater.percent.value)))}%`
          : updateStatus.value === 'downloaded'
            ? label('Restart', '重启更新')
            : label('Update', '发现新版'),
)
const updateTitle = computed(() =>
  updateStatus.value === 'downloading'
    ? label(`View download progress: ${updateLabel.value}`, `查看下载进度：${updateLabel.value}`)
    : updateStatus.value === 'downloaded'
      ? label('View ready update', '查看已下载的更新')
      : label('View new version', '查看新版本'),
)
function showUpdateDialog(): void {
  void updateDialog.value?.show()
}
onMounted(() => {
  void updater.init()
})
</script>

<template>
  <div class="omt-app" :class="{ 'omt-app--settings': inSettings }">
    <aside class="omt-sidebar" :inert="remoteOverlay">
      <router-link class="omt-brand" to="/agent" aria-label="Oh My Token">
        <span><BrandMark :size="28" /></span>
        <strong>Oh My Token</strong>
      </router-link>
      <nav
        class="omt-navigation"
        :aria-label="
          inSettings
            ? label('Settings navigation', '设置导航')
            : label('Primary navigation', '主导航')
        "
      >
        <router-link
          v-if="inSettings"
          :to="workspaceDestination"
          class="omt-navigation-item omt-settings-back"
        >
          <DesignIcon name="settingsBack" />
          <span>{{ label('Back to workspace', '返回工作区') }}</span>
        </router-link>
        <section
          v-for="group in sidebarGroups"
          :key="group.title[0]"
          class="omt-navigation-group selection-list"
        >
          <h2>{{ label(group.title[0], group.title[1]) }}</h2>
          <router-link
            v-for="item in group.items"
            :key="item.to"
            :to="workspaceNavigation.destination(item.to)"
            class="omt-navigation-item"
            :class="{ 'omt-navigation-item--active': active(item.to) }"
            :aria-current="active(item.to) ? 'page' : undefined"
          >
            <DesignIcon v-if="item.icon" :name="item.icon" />
            <span v-else class="material-symbols-outlined" aria-hidden="true">folder</span>
            <span>{{ label(item.title[0], item.title[1]) }}</span>
          </router-link>
        </section>
      </nav>
      <footer class="omt-account-footer">
        <UserMenu @update="showUpdateDialog" />
        <div v-if="updateShown" class="omt-update-slot">
          <button
            class="omt-update"
            :class="{ 'omt-update--ready': updateStatus === 'downloaded' }"
            type="button"
            :title="updateTitle"
            :aria-label="updateTitle"
            aria-haspopup="dialog"
            @click="showUpdateDialog"
          >
            <DesignIcon
              :name="
                updateStatus === 'downloading'
                  ? 'download'
                  : updateStatus === 'downloaded'
                    ? 'floatingRefresh'
                    : 'update'
              "
              :size="14"
            />
            <span>{{ updateLabel }}</span>
          </button>
        </div>
        <router-link
          class="omt-settings"
          :to="settingsDestination"
          :aria-label="label('Settings', '设置')"
          :title="label('Settings', '设置')"
        >
          <DesignIcon name="settings" :size="18" />
        </router-link>
      </footer>
    </aside>
    <div class="omt-workspace">
      <header
        class="omt-header"
        :class="{ 'omt-header--settings': inSettings }"
        :inert="remoteOverlay"
      >
        <div class="omt-header-inner">
          <div
            v-if="!inSettings"
            class="omt-breadcrumb"
            :aria-label="label('Current page', '当前页面')"
          >
            <span>{{ breadcrumb[0] }}</span>
            <span>/</span>
            <span>{{ breadcrumb[1] }}</span>
          </div>
          <div class="omt-header-announcements"><MessageBanner placement="main" compact /></div>
          <div v-show="!inSettings" class="omt-header-actions">
            <RefreshControl />
            <HeaderDisplayControls />
          </div>
        </div>
      </header>
      <main class="omt-route">
        <DiscoveryHost
          v-if="remoteDiscovery"
          :active="inDiscovery && !announcement"
          @overlay="remoteOverlay = $event"
        />
        <router-view v-slot="{ Component, route: resolvedRoute }">
          <Transition
            :name="pageTransition"
            @before-enter="enablePage"
            @before-leave="disablePage"
            @leave-cancelled="enablePage"
          >
            <KeepAlive :max="16">
              <RoutePageHost
                v-if="Component && !announcement && !inDiscovery"
                :key="resolvedRoute.path"
                :component="Component"
                :page-key="resolvedRoute.path"
                :owns-surface="resolvedRoute.meta.surface === true"
              />
            </KeepAlive>
          </Transition>
        </router-view>
        <MessageDetails
          v-if="announcement"
          :key="announcement.messageUid"
          :message="announcement"
          placement="main"
          @close="closeAnnouncement"
        />
        <div v-if="announcementUnavailable" class="announcement-unavailable" role="alert">
          <span>
            {{
              label(
                'This announcement has expired or is currently unavailable.',
                '该公告已过期或暂时无法读取。',
              )
            }}
          </span>
          <button
            type="button"
            class="workspace-button workspace-button--icon"
            :aria-label="label('Close', '关闭')"
            @click="closeAnnouncement"
          >
            <DesignIcon name="floatingClose" :size="16" />
          </button>
        </div>
      </main>
    </div>
  </div>
  <CloseBehaviorDialog />
  <TrayUpdateDialog ref="updateDialog" />
  <LoginRequiredDialog />
</template>
<style scoped src="../../styles/app-layout.css"></style>
<style scoped>
.announcement-unavailable {
  position: absolute;
  top: 12px;
  left: 50%;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: calc(100% - 32px);
  padding: 8px 12px 8px 18px;
  transform: translateX(-50%);
  color: var(--text);
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-popover);
  font-size: 13px;
}
</style>
