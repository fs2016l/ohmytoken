<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import { formatDateTime } from '../../utils/date-time'

const props = defineProps<{ timestamp?: number | null }>()
const { label } = useI18n()
const text = computed(() => formatDateTime(props.timestamp))
const datetime = computed(() =>
  text.value === '—' ? undefined : new Date(props.timestamp!).toISOString(),
)
</script>

<template>
  <time v-if="datetime" :datetime="datetime" :title="text">
    {{ label('Updated ', '更新于 ') }}{{ text }}
  </time>
</template>
