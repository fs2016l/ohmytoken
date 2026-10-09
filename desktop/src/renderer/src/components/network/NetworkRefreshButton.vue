<script setup lang="ts">
import { ref } from 'vue'
import DesignIcon from '../base/DesignIcon.vue'
import { useMotionVisibility } from '../../composables/useMotionVisibility'
defineProps<{
  label: string
  running?: boolean
  disabled?: boolean
  text?: boolean
  floating?: boolean
}>()
defineEmits<{ click: [] }>()
const element = ref<HTMLElement | null>(null)
const { visible, reduced } = useMotionVisibility(element)
</script>
<template>
  <button
    ref="element"
    type="button"
    class="network-refresh"
    :disabled="disabled || running"
    :aria-label="label"
    :title="label"
    @click.stop="$emit('click')"
  >
    <DesignIcon
      :name="floating ? 'floatingRefresh' : 'networkRefresh'"
      :size="16"
      :class="{ 'network-spinning': running && visible && !reduced }"
    />
    <span v-if="text">{{ label }}</span>
  </button>
</template>
<style scoped>
.network-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 32px;
  min-height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.network-refresh:hover {
  color: var(--primary-soft-text);
  background: var(--primary-soft);
}
.network-refresh:disabled {
  cursor: default;
}
.network-spinning {
  animation: refresh-rotation 1s linear infinite;
}
@keyframes refresh-rotation {
  to {
    transform: rotate(360deg);
  }
}
</style>
