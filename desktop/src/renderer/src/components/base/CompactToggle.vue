<script setup lang="ts">
import { nextTick, ref } from 'vue'

const props = defineProps<{
  active: boolean
  label: string
  offLabel: string
  onLabel: string
  disabled?: boolean
}>()
const emit = defineEmits<{ change: [active: boolean] }>()
const root = ref<HTMLElement | null>(null)
function keydown(event: KeyboardEvent): void {
  if (props.disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const active = event.key === 'Home' ? false : event.key === 'End' ? true : !props.active
  emit('change', active)
  void nextTick(() => root.value?.querySelectorAll('button')[Number(active)]?.focus())
}
</script>
<template>
  <div
    ref="root"
    class="compact-toggle"
    :class="{ 'is-on': active }"
    role="group"
    :aria-label="label"
    @keydown="keydown"
  >
    <span class="compact-toggle-thumb" aria-hidden="true" />
    <button
      type="button"
      :aria-label="offLabel"
      :title="offLabel"
      :aria-pressed="!active"
      :tabindex="active ? -1 : 0"
      :disabled="disabled"
      @click="emit('change', false)"
    >
      <slot name="off" />
    </button>
    <button
      type="button"
      :aria-label="onLabel"
      :title="onLabel"
      :aria-pressed="active"
      :tabindex="active ? 0 : -1"
      :disabled="disabled"
      @click="emit('change', true)"
    >
      <slot name="on" />
    </button>
  </div>
</template>
<style scoped>
.compact-toggle {
  --toggle-track: color-mix(in srgb, var(--text-soft) 12%, var(--bg-elevated));
  --toggle-thumb: var(--bg-elevated);
  --toggle-thumb-edge: color-mix(in srgb, var(--primary) 12%, transparent);
  --toggle-selected-color: var(--primary);
  position: relative;
  display: inline-grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: minmax(0, 1fr);
  flex: none;
  height: 30px;
  min-width: 66px;
  padding: 3px;
  border: 1px solid color-mix(in srgb, var(--text-soft) 20%, var(--bg-elevated));
  border-radius: 999px;
  background: var(--toggle-track);
  -webkit-app-region: no-drag;
}
html[data-theme='dark'] .compact-toggle {
  --toggle-track: color-mix(in srgb, var(--bg-elevated) 60%, var(--surface-container));
  --toggle-thumb: var(--primary);
  --toggle-thumb-edge: color-mix(in srgb, var(--primary) 30%, transparent);
  --toggle-selected-color: var(--primary-on);
}
.compact-toggle-thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc((100% - 6px) / 2);
  border-radius: 999px;
  background: var(--toggle-thumb);
  box-shadow:
    inset 0 0 0 1px var(--toggle-thumb-edge),
    0 1px 4px color-mix(in srgb, var(--primary) 16%, transparent);
  pointer-events: none;
  transition:
    transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
    background 180ms ease;
}
.is-on .compact-toggle-thumb {
  transform: translateX(100%);
}
.compact-toggle > button {
  position: relative;
  display: grid;
  place-items: center;
  height: 100%;
  min-height: 0;
  min-width: 28px;
  padding: 0 6px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text);
  font: 500 11px/20px var(--font-sans);
  cursor: pointer;
  transition:
    color 180ms ease,
    opacity 180ms ease;
}
button[aria-pressed='true'] {
  color: var(--toggle-selected-color);
}
button:not(:disabled):hover {
  color: var(--toggle-selected-color);
}
button[aria-pressed='false']:not(:disabled):hover {
  color: var(--text);
}
button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
button:disabled {
  cursor: wait;
  opacity: 0.55;
}
@media (prefers-reduced-motion: reduce) {
  .compact-toggle-thumb,
  button {
    transition: none;
  }
}
</style>
