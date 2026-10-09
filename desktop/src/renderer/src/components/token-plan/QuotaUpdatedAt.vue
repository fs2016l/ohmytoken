<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import { useVisibleNow } from '../../composables/useVisibleNow'
import { formatDateTime } from '../../utils/date-time'

const props = defineProps<{ observedAt?: number | null }>()
const { label } = useI18n()
const now = useVisibleNow()
const absoluteTime = computed(() => formatDateTime(props.observedAt))
const datetime = computed(() =>
  absoluteTime.value === '—' ? undefined : new Date(props.observedAt!).toISOString(),
)
const text = computed(() => {
  const timestamp = props.observedAt
  if (timestamp == null || absoluteTime.value === '—') return ''
  const minutes = Math.floor(Math.max(0, now.value - timestamp) / 60_000)
  if (minutes < 1) return label('Updated just now', '刚刚更新')
  if (minutes < 60) return label(`Updated ${minutes}m ago`, `${minutes} 分钟前更新`)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return label(`Updated ${hours}h ago`, `${hours} 小时前更新`)
  const days = Math.floor(hours / 24)
  return label(`Updated ${days}d ago`, `${days} 天前更新`)
})
</script>

<template>
  <time v-if="datetime" :datetime="datetime" :title="absoluteTime">{{ text }}</time>
</template>
