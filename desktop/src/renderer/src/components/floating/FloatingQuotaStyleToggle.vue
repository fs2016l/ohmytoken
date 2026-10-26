<script setup lang="ts">
import { computed } from 'vue'
import { useFloatingQuotaStyle } from '../../composables/useFloatingQuotaStyle'
import { useI18n } from '../../i18n/useI18n'

const { label } = useI18n()
const { style, toggle } = useFloatingQuotaStyle()
// 图标画的是点击后会切换到的样式：条形时显示圆球，圆球时显示条形。
const next = computed(() => (style.value === 'bars' ? 'orbs' : 'bars'))
const text = computed(() =>
  next.value === 'orbs'
    ? label('Switch to orb view', '切换为圆球样式')
    : label('Switch to bar view', '切换为条形样式'),
)
</script>

<template>
  <button
    type="button"
    class="floating-quota-style-toggle"
    :data-next="next"
    :title="text"
    :aria-label="text"
    @click="toggle"
  >
    <svg v-if="next === 'orbs'" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4.5" cy="8" r="3.4" />
      <circle cx="11.5" cy="8" r="3.4" />
      <path class="floating-quota-style-liquid" d="M1.15 8.7A3.4 3.4 0 0 0 7.85 8.7Z" />
      <path class="floating-quota-style-liquid" d="M8.15 8.7A3.4 3.4 0 0 0 14.85 8.7Z" />
    </svg>
    <svg v-else viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.5h11M2.5 8h7M2.5 11.5h9" />
    </svg>
  </button>
</template>

<style scoped>
/* 覆盖在“额度”标签的右端，只在额度视图展开时出现，不改变标签宽度。 */
.floating-quota-style-toggle {
  position: absolute;
  top: 12px;
  right: 24px;
  bottom: 8px;
  display: grid;
  place-items: center;
  width: 34px;
  height: calc(var(--control-height) - 8px);
  margin: auto 0;
  padding: 0;
  border: none;
  border-radius: 0 4px 4px 0;
  background: transparent;
  color: var(--primary-on);
  cursor: pointer;
  transition: background var(--motion-fast, 160ms) var(--motion-ease, ease);
}
.floating-quota-style-toggle::before {
  content: '';
  position: absolute;
  top: calc(50% - 7px);
  left: 0;
  width: 1px;
  height: 14px;
  background: color-mix(in srgb, var(--primary-on) 33%, transparent);
  pointer-events: none;
}
.floating-quota-style-toggle:hover,
.floating-quota-style-toggle:focus-visible {
  background: color-mix(in srgb, var(--primary-on) 18%, transparent);
}
.floating-quota-style-toggle:active {
  background: color-mix(in srgb, var(--primary-on) 26%, transparent);
}
.floating-quota-style-toggle:focus-visible {
  outline: 2px solid var(--primary-on);
  outline-offset: -2px;
}
.floating-quota-style-toggle svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
}
.floating-quota-style-toggle circle {
  stroke-width: 1.3;
}
.floating-quota-style-toggle path {
  stroke-width: 2;
}
.floating-quota-style-toggle .floating-quota-style-liquid {
  fill: currentColor;
  stroke: none;
}
</style>
