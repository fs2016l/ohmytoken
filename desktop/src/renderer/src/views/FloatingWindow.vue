<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type ComponentPublicInstance,
} from 'vue'
import BrandMark from '../components/base/BrandMark.vue'
import DesignIcon from '../components/base/DesignIcon.vue'
import SegmentedControl from '../components/base/SegmentedControl.vue'
import AnchoredPopover from '../components/base/AnchoredPopover.vue'
import MessageBanner from '../components/message/MessageBanner.vue'
import FloatingTokenView from '../components/floating/FloatingTokenView.vue'
import FloatingQuotaView from '../components/floating/FloatingQuotaView.vue'
import FloatingResizeFrame from '../components/floating/FloatingResizeFrame.vue'
import NetworkRefreshButton from '../components/network/NetworkRefreshButton.vue'
import { useTheme } from '../composables/useTheme'
import { useFloatingEdgeMotion } from '../composables/useFloatingEdgeMotion'
import { useMotionVisibility } from '../composables/useMotionVisibility'
import { useFloatingCollapseMotion } from '../composables/useFloatingCollapseMotion'
import { refreshTokenPlanUsage } from '../composables/useTokenPlanUsage'
import { useMessageDetails } from '../composables/useMessageDetails'
import { useI18n } from '../i18n/useI18n'
import type { FloatingEdgeState, FloatingWorkspace } from '@shared/floating-window'
import { motion } from '../config/motion'

useTheme()
const { label } = useI18n()
const MessageDetails = defineAsyncComponent(
  () => import('../components/message/MessageDetails.vue'),
)
const { message: announcement, close: closeAnnouncement } = useMessageDetails()
const mode = ref(localStorage.getItem('floating-view') === 'quota' ? 'quota' : 'token')
const collapsed = ref(false)
const pinned = ref(true)
const ready = ref(false)
const resizeHandles = ref(false)
const busy = ref(false)
const refreshing = ref(false)
const tokenView = shallowRef<InstanceType<typeof FloatingTokenView> | null>(null)
const issue = ref('')
const menu = ref(false)
const attention = ref(false)
const pinPulse = ref(false)
let pinPulseTimer: number | undefined
const header = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const monitor = ref<HTMLElement | null>(null)
const { reduced } = useMotionVisibility(panel)
const { animateCollapse, animating: collapseAnimating } = useFloatingCollapseMotion(
  panel,
  monitor,
  reduced,
)
const announcementLeaving = ref(false)
const monitorActive = ref(true)
const edge = ref<FloatingEdgeState>({ enabled: true, edge: null, hidden: false })
useFloatingEdgeMotion(edge, panel)
let unsubscribeEdge: (() => void) | undefined
let interactionObserver: MutationObserver | undefined
let reportedInteraction: boolean | undefined
function updateInteraction(): void {
  // Closed native popovers stay mounted, so DOM presence alone does not mean interaction.
  const overlayOpen = Array.from(
    document.querySelectorAll<HTMLElement>(
      'dialog[open], [popover]:popover-open, [role="dialog"], [role="alertdialog"]',
    ),
  ).some(
    (element) =>
      element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible',
  )
  const active =
    !!announcement.value ||
    announcementLeaving.value ||
    busy.value ||
    menu.value ||
    overlayOpen ||
    document.documentElement.classList.contains('floating-reorder-active')
  if (active === reportedInteraction) return
  reportedInteraction = active
  void window.api.setFloatingWindowInteracting(active).catch(() => {})
}
async function changeEdgeAutoHide(): Promise<void> {
  try {
    edge.value = await window.api.setFloatingWindowEdgeEnabled(!edge.value.enabled)
  } catch {
    issue.value = label('Could not change edge auto-hide.', '贴边隐藏设置失败。')
  }
}
function reveal(): void {
  void window.api.showFloatingWindow()
}
function revealOnHover(): void {
  void window.api.revealFloatingWindowFromEdge().catch(() => {})
}
watch(menu, updateInteraction)
watch(busy, updateInteraction, { flush: 'sync' })
watch(announcement, updateInteraction)
watch(announcementLeaving, updateInteraction)
watch(
  announcement,
  (value, previous) => {
    announcementLeaving.value = !value && !!previous
    if (!value) monitorActive.value = true
  },
  { flush: 'sync' },
)
let restoreCollapsed: boolean | null = null
watch(
  [() => !!announcement.value, ready, busy, announcementLeaving],
  ([reading, initialized, working, leaving]) => {
    if (!initialized || working) return
    if (reading && restoreCollapsed === null) {
      restoreCollapsed = collapsed.value
      menu.value = false
      if (collapsed.value) void changeCollapsed()
    } else if (!reading && !leaving && restoreCollapsed !== null) {
      const restore = restoreCollapsed
      restoreCollapsed = null
      if (restore !== collapsed.value) void changeCollapsed()
    }
  },
)
watch(
  () => [edge.value.hidden, edge.value.transition] as const,
  ([hidden, transition]) => {
    if (!hidden && !transition) void nextTick(resizeCollapsed)
  },
)
const menuButton = ref<HTMLElement | null>(null)
const options = computed(() => [
  { value: 'token', label: 'Token' },
  { value: 'quota', label: label('Quota', '额度') },
])
let observer: ResizeObserver | undefined
let lastCollapsedHeight = 0
const collapsedHeight = (): number => {
  const style = getComputedStyle(document.body)
  return Math.ceil(
    (panel.value?.getBoundingClientRect().height ?? 240) +
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingBottom),
  )
}

function rememberTokenView(view: Element | ComponentPublicInstance | null): void {
  // Keep the cached view's refresh method available while the quota tab is active.
  if (view) tokenView.value = view as InstanceType<typeof FloatingTokenView>
}
async function refreshAll(): Promise<void> {
  if (!ready.value || busy.value || refreshing.value || tokenView.value?.busy) return
  refreshing.value = true
  menu.value = false
  issue.value = ''
  try {
    const view = tokenView.value
    const [token, quota] = await Promise.allSettled([
      view ? view.refresh() : window.api.scanPerform({ mode: 'incremental' }).then(() => true),
      refreshTokenPlanUsage(),
    ])
    const tokenFailed = token.status === 'rejected' || !token.value
    // Account failures belong to their quota cards; compact mode has no quota banner.
    const quotaFailed = !collapsed.value && (quota.status === 'rejected' || !quota.value)
    if (tokenFailed || quotaFailed) {
      const target =
        tokenFailed && quotaFailed
          ? label('Token and quota', 'Token 和额度')
          : tokenFailed
            ? 'Token'
            : label('Quota', '额度')
      issue.value = label(
        `${target} refresh failed. Saved readings are retained; please retry.`,
        `${target}刷新失败，已保留上次数据，请重试。`,
      )
    }
  } finally {
    refreshing.value = false
  }
}

async function changePin(): Promise<void> {
  if (busy.value) return
  busy.value = true
  issue.value = ''
  try {
    pinned.value = await window.api.setFloatingWindowAlwaysOnTop(!pinned.value)
    if (pinned.value) {
      // Restart the tack-in pop on every activation, but not on initial restore.
      pinPulse.value = false
      void nextTick(() => {
        pinPulse.value = true
      })
      window.clearTimeout(pinPulseTimer)
      pinPulseTimer = window.setTimeout(() => {
        pinPulse.value = false
      }, 360)
    }
  } catch {
    issue.value = label('Could not change always-on-top. Please retry.', '置顶设置失败，请重试。')
  } finally {
    busy.value = false
  }
}
async function changeCollapsed(): Promise<void> {
  if (busy.value) return
  busy.value = true
  issue.value = ''
  menu.value = false
  const previous = collapsed.value
  try {
    collapsed.value = await animateCollapse(
      !previous,
      () => (collapsed.value = !previous),
      () => window.api.setFloatingWindowCollapsed(!previous, collapsedHeight()),
    )
    lastCollapsedHeight = collapsedHeight()
  } catch {
    collapsed.value = previous
    issue.value = label('Could not resize the window. Please retry.', '窗口收起失败，请重试。')
  } finally {
    busy.value = false
  }
}
async function resizeCollapsed(): Promise<void> {
  const height = collapsedHeight()
  if (
    !collapsed.value ||
    edge.value.hidden ||
    edge.value.transition ||
    busy.value ||
    Math.abs(height - lastCollapsedHeight) < 1
  )
    return
  lastCollapsedHeight = height
  try {
    await window.api.setFloatingWindowCollapsed(true, height)
  } catch {
    issue.value = label('Could not adjust the window height.', '窗口高度调整失败。')
  }
}
async function openWorkspace(destination: FloatingWorkspace): Promise<void> {
  menu.value = false
  try {
    await window.api.openFloatingWorkspace(destination)
  } catch {
    issue.value = label('Could not open the main window. Please retry.', '主窗口打开失败，请重试。')
  }
}
async function close(): Promise<void> {
  try {
    await window.api.closeFloatingWindow()
  } catch {
    /* The native window can close before the response arrives. */
  }
}
watch(mode, (value) => localStorage.setItem('floating-view', value))
onMounted(async () => {
  document.documentElement.classList.add('floating-window-root')
  document.body.classList.add('floating-window-body')
  unsubscribeEdge = window.api.onFloatingWindowEdgeChanged((value) => {
    edge.value = value
  })
  interactionObserver = new MutationObserver(updateInteraction)
  interactionObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'hidden', 'aria-hidden'],
  })
  interactionObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
  document.addEventListener('toggle', updateInteraction, true)
  updateInteraction()
  try {
    const result = await Promise.all([
      window.api.isFloatingWindowAlwaysOnTop(),
      window.api.isFloatingWindowCollapsed(),
      window.api.getFloatingWindowEdge(),
      window.api.hasFloatingWindowResizeHandles(),
    ])
    pinned.value = result[0]
    collapsed.value = result[1]
    edge.value = result[2]
    resizeHandles.value = result[3]
  } catch {
    issue.value = label('Window settings could not be read.', '窗口设置读取失败。')
  }
  ready.value = true
  await nextTick()
  if (panel.value) {
    observer = new ResizeObserver(() => void resizeCollapsed())
    observer.observe(panel.value)
  }
})
onUnmounted(() => {
  observer?.disconnect()
  unsubscribeEdge?.()
  interactionObserver?.disconnect()
  document.removeEventListener('toggle', updateInteraction, true)
  window.clearTimeout(pinPulseTimer)
  void window.api.setFloatingWindowInteracting(false).catch(() => {})
  document.documentElement.classList.remove('floating-window-root')
  document.body.classList.remove('floating-window-body')
})
</script>

<template>
  <FloatingResizeFrame
    v-if="resizeHandles && !edge.hidden && !edge.transition && !busy"
    :panel="panel"
    :collapsed="collapsed"
  />
  <button
    v-if="edge.hidden"
    class="floating-edge-hitarea"
    :aria-label="label('Show usage monitor', '展开用量小窗')"
    @mouseenter="revealOnHover"
    @click="reveal"
  />
  <div
    ref="panel"
    class="floating-window"
    :inert="edge.hidden"
    :aria-hidden="edge.hidden || undefined"
    :class="{
      'floating-window--collapsed': collapsed,
      'floating-window--resizing': collapseAnimating,
    }"
  >
    <div ref="header" class="floating-header-block">
      <header class="floating-header">
        <div class="floating-drag-title">
          <span class="floating-brand"><BrandMark :size="20" /></span>
          <strong>{{ label('Usage monitor', '用量监测') }}</strong>
        </div>
        <button
          class="floating-icon-button floating-pin-button"
          :class="{ selected: pinned, 'pin-pulse': pinPulse }"
          :disabled="!ready || busy"
          :aria-pressed="pinned"
          :aria-label="label('Always on top', '窗口置顶')"
          :title="
            pinned
              ? label('Pinned to top. Click to unpin.', '已置顶，点击取消')
              : label('Always on top', '窗口置顶')
          "
          @click="changePin"
        >
          <span class="floating-pin-glyph" aria-hidden="true">
            <DesignIcon class="pin-filled" name="floatingPin" :size="18" />
            <DesignIcon class="pin-outline" name="floatingPinOutline" :size="18" />
          </span>
        </button>
        <button
          class="floating-icon-button floating-collapse-button"
          :class="{ 'collapsed-state': collapsed }"
          :disabled="!ready || busy || !!announcement || announcementLeaving"
          :aria-expanded="!collapsed"
          :aria-label="
            collapsed ? label('Expand window', '展开窗口') : label('Collapse window', '收起窗口')
          "
          :title="
            collapsed ? label('Expand window', '展开窗口') : label('Collapse window', '收起窗口')
          "
          @click="changeCollapsed"
        >
          <svg class="floating-collapse-glyph" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path
              class="collapse-line collapse-line-a"
              d="M4.5 6H13.5"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            />
            <path
              class="collapse-line collapse-line-b"
              d="M4.5 12H13.5"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            />
            <path
              class="collapse-chevron collapse-chevron-top"
              d="M7.5 3L9 4.5L10.5 3"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              class="collapse-chevron collapse-chevron-bottom"
              d="M7.5 15L9 13.5L10.5 15"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <span v-show="!announcement" ref="menuButton" class="floating-refresh-control">
          <NetworkRefreshButton
            class="floating-icon-button"
            floating
            :running="refreshing"
            :disabled="!ready || busy || tokenView?.busy"
            :label="label('Refresh Token and quota', '刷新 Token 和额度')"
            :title="
              label(
                'Refresh Token and quota · Right-click for options',
                '刷新 Token 和额度 · 右键打开更多操作',
              )
            "
            :aria-description="
              label(
                'Right-click or press Shift+F10 for more options.',
                '右键或按 Shift+F10 打开更多操作。',
              )
            "
            @click="refreshAll"
            @contextmenu.prevent="menu = true"
            @keydown.shift.f10.prevent="menu = true"
          />
        </span>
        <button
          class="floating-icon-button"
          :aria-label="label('Close window', '关闭窗口')"
          @click="close"
        >
          <DesignIcon name="floatingClose" :size="18" />
        </button>
      </header>
      <MessageBanner class="floating-announcement" placement="floating" compact />
      <p v-if="issue" class="floating-error" role="alert">{{ issue }}</p>
    </div>
    <AnchoredPopover v-model="menu" :anchor="menuButton" :label="label('More options', '更多操作')">
      <div class="floating-menu">
        <button role="menuitemcheckbox" :aria-checked="edge.enabled" @click="changeEdgeAutoHide">
          {{ label('Edge auto-hide', '贴边自动隐藏') }}
          <span v-if="edge.enabled" aria-hidden="true">✓</span>
        </button>
        <button @click="openWorkspace('overview')">
          {{ label('Open main window', '打开主窗口') }}
          <DesignIcon name="externalLink" :size="14" />
        </button>
      </div>
    </AnchoredPopover>
    <div
      class="floating-content"
      :class="{ 'floating-content--announcement': !!announcement }"
      :style="{ '--announcement-duration': `${motion.detail}ms` }"
    >
      <div
        id="floating-announcement-details"
        class="floating-announcement-region"
        :inert="!announcement"
        :aria-hidden="!announcement"
      >
        <!-- Keep the reader mounted until the containing row finishes folding. -->
        <Transition
          :duration="reduced ? 0 : motion.detail"
          @after-enter="monitorActive = !announcement"
          @after-leave="announcementLeaving = false"
        >
          <div v-if="announcement" class="floating-announcement-body">
            <MessageDetails
              :key="announcement.messageUid"
              :message="announcement"
              placement="floating"
              @close="closeAnnouncement"
            />
          </div>
        </Transition>
      </div>
      <div
        ref="monitor"
        class="floating-monitor"
        :inert="!!announcement"
        :aria-hidden="!!announcement"
      >
        <div class="floating-tabs">
          <SegmentedControl
            v-model="mode"
            :options="options"
            :label="label('Monitor view', '监测视图')"
            :compact="collapsed"
          />
          <i
            v-if="attention && !collapsed"
            class="floating-quota-attention"
            :title="label('A followed account has low quota', '有关注账号的额度偏低')"
          />
        </div>
        <KeepAlive>
          <FloatingTokenView
            v-if="monitorActive && mode === 'token'"
            :ref="rememberTokenView"
            :compact="collapsed"
            @open="openWorkspace"
            @expand="collapsed && changeCollapsed()"
          />
          <FloatingQuotaView
            v-else-if="monitorActive && mode === 'quota'"
            :compact="collapsed"
            @open="openWorkspace"
            @attention="attention = $event"
            @expand="collapsed && changeCollapsed()"
          />
        </KeepAlive>
      </div>
    </div>
  </div>
</template>

<style src="../styles/floating-window.css"></style>
<style src="../styles/floating-summary.css"></style>
