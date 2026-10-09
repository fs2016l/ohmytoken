<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import { useTheme } from '../../composables/useTheme'
import CompactToggle from '../base/CompactToggle.vue'

const { label } = useI18n()
const { currentTheme, setTheme } = useTheme()
const visible = ref(false)
const changing = ref(false)
const failed = ref(false)
let request = 0
let unsubscribe: (() => void) | undefined
async function syncVisibility(): Promise<void> {
  const serial = ++request
  try {
    const value = await window.api.isFloatingWindowVisible()
    if (serial === request) visible.value = value
  } catch {
    failed.value = true
  }
}
async function setVisible(value: boolean): Promise<void> {
  if (changing.value) return
  changing.value = true
  failed.value = false
  try {
    if (value) await window.api.showFloatingWindow()
    else await window.api.closeFloatingWindow()
  } catch {
    failed.value = true
  } finally {
    await syncVisibility()
    changing.value = false
  }
}
onMounted(() => {
  unsubscribe = window.api.onFloatingWindowVisibilityChanged((value) => {
    request++
    visible.value = value
  })
  void syncVisibility()
  window.addEventListener('focus', syncVisibility)
})
onUnmounted(() => {
  request++
  unsubscribe?.()
  window.removeEventListener('focus', syncVisibility)
})
</script>
<template>
  <div class="header-display-controls">
    <div
      class="header-mini-control"
      :class="{ 'is-visible': visible, 'has-error': failed }"
      :aria-busy="changing"
    >
      <svg
        class="header-mini-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        aria-hidden="true"
      >
        <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
        <path class="mini-window-line" d="M7 8h6" />
        <rect class="mini-window-inset" x="11" y="11" width="7" height="5.5" rx="1" />
      </svg>
      <CompactToggle
        :active="visible"
        :label="label('Mini window', '小窗')"
        :off-label="label('Close mini window', '关闭小窗')"
        :on-label="label('Open mini window', '打开小窗')"
        :disabled="changing"
        @change="setVisible"
      >
        <template #off>{{ label('Off', '关') }}</template>
        <template #on>{{ label('On', '开') }}</template>
      </CompactToggle>
      <span v-if="failed" class="header-control-error" role="alert">
        {{ label('Could not switch the mini window. Try again.', '小窗切换失败，请重试。') }}
      </span>
    </div>
    <CompactToggle
      class="header-theme-control"
      :active="currentTheme === 'dark'"
      :label="label('Appearance', '主题')"
      :off-label="label('Switch to light mode', '切换到亮色模式')"
      :on-label="label('Switch to dark mode', '切换到暗色模式')"
      @change="setTheme($event ? 'dark' : 'light')"
    >
      <template #off>
        <svg
          class="theme-sun"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3.5" />
          <g class="sun-rays">
            <path
              d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            />
          </g>
        </svg>
      </template>
      <template #on>
        <svg
          class="theme-moon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M20.4 14.4A8.5 8.5 0 0 1 9.6 3.6a8.5 8.5 0 1 0 10.8 10.8Z" />
          <path class="moon-star" d="M17.5 3.5v4m-2-2h4" />
        </svg>
      </template>
    </CompactToggle>
  </div>
</template>
<style scoped>
.header-display-controls,
.header-mini-control {
  display: flex;
  align-items: center;
  flex: none;
}
.header-display-controls {
  gap: 12px;
}
.header-mini-control {
  position: relative;
  gap: 6px;
}
.header-mini-icon {
  width: 18px;
  height: 18px;
  color: var(--text-soft);
  transition: color 200ms ease;
}
.mini-window-inset {
  transform-box: fill-box;
  transform-origin: center;
  fill: transparent;
  transition:
    transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
    fill 200ms ease;
}
.mini-window-line {
  stroke-dasharray: 6;
  stroke-dashoffset: 0;
  transition: stroke-dashoffset 260ms ease;
}
.is-visible .header-mini-icon {
  color: var(--primary);
}
.is-visible .mini-window-inset {
  transform: scale(1.12);
  fill: currentColor;
}
.is-visible .mini-window-line {
  stroke-dashoffset: 3;
}
.has-error .header-mini-icon {
  color: var(--warning);
}
.header-control-error {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 121;
  width: max-content;
  max-width: 240px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--surface-low);
  box-shadow: var(--shadow-popover);
  color: var(--warning);
  font-size: 12px;
}
.theme-sun,
.theme-moon {
  width: 15px;
  height: 15px;
  transition:
    transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 200ms ease;
}
.sun-rays {
  transform-origin: 12px 12px;
  transition: transform 400ms cubic-bezier(0.22, 1, 0.36, 1);
}
.theme-moon {
  transform: rotate(-18deg) scale(0.9);
}
.moon-star {
  opacity: 0;
  transform: translateY(2px);
  transition:
    opacity 180ms ease,
    transform 320ms ease;
}
.header-theme-control.is-on .theme-sun {
  transform: rotate(45deg) scale(0.86);
}
.header-theme-control.is-on .sun-rays {
  transform: rotate(45deg);
}
.header-theme-control.is-on .theme-moon {
  transform: rotate(0) scale(1);
}
.header-theme-control.is-on .moon-star {
  opacity: 1;
  transform: translateY(0);
}
@media (prefers-reduced-motion: reduce) {
  .header-mini-icon,
  .mini-window-inset,
  .mini-window-line,
  .theme-sun,
  .theme-moon,
  .sun-rays,
  .moon-star {
    transition: none;
  }
}
</style>
