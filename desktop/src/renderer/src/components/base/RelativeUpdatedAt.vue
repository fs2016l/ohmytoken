<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import { useVisibleNow } from '../../composables/useVisibleNow'
import { formatDateTime, formatUpdatedAgo } from '../../utils/date-time'

const props = defineProps<{ timestamp?: number | null }>()
const { label } = useI18n()
const now = useVisibleNow(1000)
const absoluteTime = computed(() => formatDateTime(props.timestamp))
const datetime = computed(() =>
  absoluteTime.value === '—' ? undefined : new Date(props.timestamp!).toISOString(),
)
const text = computed(() => formatUpdatedAgo(props.timestamp, now.value, label))
</script>

<template>
  <time v-if="datetime" :datetime="datetime" :title="absoluteTime">{{ text }}</time>
</template>
