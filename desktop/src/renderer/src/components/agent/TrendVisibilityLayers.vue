<script setup lang="ts">
import { computed } from 'vue'
import type { LegendVisibilityState } from '../../composables/useLegendSelection'
import { useI18n } from '../../i18n/useI18n'

const props = defineProps<{ state: LegendVisibilityState }>()
const emit = defineEmits<{ toggle: [] }>()
const { label } = useI18n()

const actionLabel = computed(() => {
  if (props.state === 'all') {
    return label('All curves shown; hide all', '已显示全部曲线；点击全部隐藏')
  }
  if (props.state === 'partial') {
    return label('Some curves shown; show all', '部分曲线显示；点击全部显示')
  }
  return label('All curves hidden; show all', '已隐藏全部曲线；点击全部显示')
})
</script>

<template>
  <button
    type="button"
    class="trend-visibility-layers"
    :class="`is-${state}`"
    :aria-label="actionLabel"
    :aria-pressed="state === 'partial' ? 'mixed' : state === 'all'"
    :title="actionLabel"
    :data-state="state"
    @click="emit('toggle')"
  >
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path class="layer layer-bottom" d="M4 10h11l5 4H9z" />
      <path class="layer layer-middle" d="M4 10h11l5 4H9z" />
      <path class="layer layer-top" d="M4 10h11l5 4H9z" />
    </svg>
  </button>
</template>

<style scoped>
.trend-visibility-layers {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 25px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  transition:
    background-color 180ms ease,
    transform 140ms ease;
}
.trend-visibility-layers:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.trend-visibility-layers:active {
  transform: scale(0.94);
}
.trend-visibility-layers:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
svg {
  display: block;
}
.layer {
  fill: var(--surface-low);
  stroke: var(--accent);
  stroke-width: 1.8;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  transform-box: view-box;
  transform-origin: center;
  transition:
    transform 380ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 280ms ease,
    stroke 280ms ease,
    fill 280ms ease;
}
.is-all .layer-top {
  transform: translate(1.2px, -5px);
}
.is-all .layer-bottom {
  transform: translate(-1.2px, 5px);
}
.is-partial .layer-top {
  transform: translate(0.4px, -1.6px) scale(0.91, 0.84);
}
.is-partial .layer-middle {
  transform: translate(-0.4px, 1.6px) scale(0.91, 0.84);
}
.is-partial .layer-bottom {
  opacity: 0;
  transform: scale(0.91, 0.84);
}
.is-none .layer {
  transform: scale(0.8125, 0.68);
}
.is-none .layer-top {
  fill: color-mix(in srgb, var(--text-soft) 16%, var(--surface-low));
  stroke: var(--text-soft);
}
.is-none .layer-middle,
.is-none .layer-bottom {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .trend-visibility-layers,
  .layer {
    transition: none;
  }
}
</style>
