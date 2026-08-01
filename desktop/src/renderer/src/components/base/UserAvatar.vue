<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    src?: string | null
    fallback?: string
    alt?: string
  }>(),
  {
    src: null,
    fallback: '?',
    alt: '',
  },
)

const failedSource = ref('')
const normalizedSource = computed(() => props.src?.trim() || '')
const visibleSource = computed(() =>
  normalizedSource.value && normalizedSource.value !== failedSource.value
    ? normalizedSource.value
    : '',
)

watch(normalizedSource, () => {
  failedSource.value = ''
})

function handleImageError(): void {
  failedSource.value = normalizedSource.value
}
</script>

<template>
  <span class="user-avatar-content">
    <img
      v-if="visibleSource"
      class="user-avatar-content__image"
      :src="visibleSource"
      :alt="alt"
      draggable="false"
      referrerpolicy="no-referrer"
      @error="handleImageError"
    />
    <span v-else class="user-avatar-content__fallback">{{ fallback }}</span>
  </span>
</template>

<style scoped>
.user-avatar-content {
  display: grid;
  width: 100%;
  height: 100%;
  overflow: hidden;
  place-items: center;
  border-radius: inherit;
}

.user-avatar-content__image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
