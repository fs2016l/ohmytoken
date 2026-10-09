<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '../../i18n/useI18n'

const props = defineProps<{ ip?: string | null }>()
const { label } = useI18n()
const revealed = ref(false)
watch(
  () => props.ip,
  () => {
    revealed.value = false
  },
)
const displayIp = computed(() => {
  if (!props.ip) return '—'
  if (revealed.value) return props.ip
  return props.ip.includes(':')
    ? `${props.ip.split(':').slice(0, 2).join(':')}:…`
    : `${props.ip.split('.').slice(0, 2).join('.')}.*.*`
})
const toggleLabel = computed(() =>
  revealed.value ? label('Hide full IP', '隐藏完整 IP') : label('Show full IP', '显示完整 IP'),
)
</script>

<template>
  <div class="network-ip-value">
    <strong class="network-ip">{{ displayIp }}</strong>
    <button
      v-if="ip"
      type="button"
      class="network-ip-toggle"
      :aria-label="toggleLabel"
      :title="toggleLabel"
      :aria-pressed="revealed"
      @click="revealed = !revealed"
    >
      <span class="material-symbols-outlined" aria-hidden="true">
        {{ revealed ? 'visibility_off' : 'visibility' }}
      </span>
    </button>
  </div>
</template>
