<script setup lang="ts">
import { computed } from 'vue'
import type { AiEndpointResult } from '@shared/network-check'
import { useNetworkLabels } from '../../composables/useNetworkLabels'
import { isNetworkPassed } from '../../utils/network-display'
import DesignIcon from '../base/DesignIcon.vue'
const props = defineProps<{ result?: AiEndpointResult }>()
const { label, stateText, accessText } = useNetworkLabels()
const tone = computed(() =>
  isNetworkPassed(props.result)
    ? 'success'
    : props.result?.state === 'failed' || props.result?.status === 'restricted'
      ? 'error'
      : ['authentication', 'reachable'].includes(props.result?.status ?? '')
        ? 'info'
        : 'soft',
)
const icon = computed(() =>
  tone.value === 'error'
    ? 'networkX'
    : tone.value === 'success' ||
        (props.result?.state === 'done' &&
          ['challenge', 'reachable'].includes(props.result.status ?? ''))
      ? 'check'
      : 'networkMinus',
)
const text = computed(() =>
  props.result?.state !== 'done'
    ? stateText(props.result?.state)
    : isNetworkPassed(props.result)
      ? label('Connected', '连通')
      : accessText(props.result.status),
)
</script>
<template>
  <span class="network-connection" :class="'network-connection--' + tone">
    <DesignIcon :name="icon" :size="16" />
    <span>{{ text }}</span>
  </span>
</template>
<style scoped>
.network-connection {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 20px;
}
.network-connection--success .design-icon {
  color: var(--success);
}
.network-connection--error {
  color: var(--error);
}
.network-connection--info {
  color: var(--info);
}
</style>
