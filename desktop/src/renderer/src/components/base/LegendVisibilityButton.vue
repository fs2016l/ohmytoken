<script setup lang="ts">
import { computed } from 'vue'
import type { LegendVisibilityState } from '../../composables/useLegendSelection'
import { useI18n } from '../../i18n/useI18n'

const props = defineProps<{ state: LegendVisibilityState }>()
const emit = defineEmits<{ toggle: [] }>()
const { label } = useI18n()

const actionLabel = computed(() => {
  if (props.state === 'all') {
    return label('All shown; click to hide all', '已全部显示；点击全部隐藏')
  }
  if (props.state === 'partial') {
    return label('Partially shown; click to show all', '部分显示；点击全部显示')
  }
  return label('All hidden; click to show all', '已全部隐藏；点击全部显示')
})
</script>

<template>
  <button
    class="legend-visibility-button"
    :class="`is-${state}`"
    type="button"
    :title="actionLabel"
    :aria-label="actionLabel"
    :data-state="state"
    @click="emit('toggle')"
  >
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2.7 12s3.45-5.7 9.3-5.7 9.3 5.7 9.3 5.7-3.45 5.7-9.3 5.7S2.7 12 2.7 12Z" />
      <circle v-if="state === 'all'" cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
      <path v-else-if="state === 'partial'" d="M8.2 12h7.6" stroke-width="2.8" />
      <path v-else d="M4.2 4.2 19.8 19.8" stroke-width="2.1" />
    </svg>
  </button>
</template>

<style scoped>
.legend-visibility-button {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--text-muted);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease,
    border-color 0.15s ease;
}

.legend-visibility-button.is-all {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 8%, var(--surface-container));
  border-color: color-mix(in srgb, var(--primary) 24%, var(--border));
}

.legend-visibility-button.is-partial {
  color: var(--accent-orange);
  background: color-mix(in srgb, var(--accent-orange) 12%, var(--surface-container));
  border-color: color-mix(in srgb, var(--accent-orange) 38%, var(--border));
}

.legend-visibility-button:hover {
  background: var(--surface-container-high);
  border-color: var(--border-strong);
}

.legend-visibility-button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--primary) 70%, transparent);
  outline-offset: 1px;
}

.legend-visibility-button svg {
  width: 19px;
  height: 19px;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
