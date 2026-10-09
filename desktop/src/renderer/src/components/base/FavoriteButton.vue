<script setup lang="ts">
import type { LocalFavoriteTarget } from '@shared/local-favorites'
import { localFavoriteKey } from '@shared/local-favorites'
import { useLocalFavorites } from '../../composables/useLocalFavorites'
import { useI18n } from '../../i18n/useI18n'
const props = defineProps<{ target: LocalFavoriteTarget }>()
const favorites = useLocalFavorites()
const { label } = useI18n()
</script>
<template>
  <button
    type="button"
    class="favorite-button"
    :class="{ selected: favorites.contains(target) }"
    :disabled="!favorites.ready.value || favorites.pending.value.has(localFavoriteKey(target))"
    :aria-pressed="favorites.contains(target)"
    :title="
      favorites.contains(target)
        ? label('Remove from favorites', '取消收藏')
        : label('Add to favorites', '收藏到收藏夹')
    "
    :aria-label="
      favorites.contains(target)
        ? label('Remove favorite', '取消收藏')
        : label('Add favorite', '收藏')
    "
    @click.stop="favorites.set(props.target, !favorites.contains(target))"
  >
    <span class="material-symbols-outlined" aria-hidden="true">star</span>
  </button>
</template>
<style scoped>
.favorite-button {
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
  transition: color var(--motion-hover);
}
.favorite-button .material-symbols-outlined {
  font-size: 18px;
}
.favorite-button:hover,
.favorite-button.selected {
  color: var(--accent);
}
.favorite-button.selected .material-symbols-outlined {
  font-variation-settings: 'FILL' 1;
}
.favorite-button:disabled {
  opacity: 0.45;
  cursor: default;
}
.favorite-button:focus-visible {
  outline: 2px solid var(--primary-border);
  outline-offset: 1px;
}
</style>
