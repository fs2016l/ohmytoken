<script setup lang="ts">
withDefaults(
  defineProps<{
    name:
      | 'play'
      | 'pause'
      | 'download'
      | 'folder'
      | 'race'
      | 'trend'
      | 'share'
      | 'wide'
      | 'tall'
      | 'refresh'
      | 'close'
      | 'expand'
    size?: number
  }>(),
  { size: 20 },
)
const paths = {
  play: 'M8 5l11 7-11 7z',
  pause: 'M8 5v14M16 5v14',
  download: 'M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4',
  folder: 'M3 6h6l2 3h10v11H3zM3 6V4h7l2 3h8v2',
  race: 'M4 4v16h17M8 7h12M8 12h8M8 17h4',
  trend: 'M3 18l5-7 5 3 8-10M16 4h5v5',
  share: 'M12 3v9h9M8 4a9 9 0 1 0 12 12M16 3a8 8 0 0 1 5 5',
  wide: 'M3 5h18v12H3zM8 21h8M12 17v4',
  tall: 'M7 2h10v20H7zM11 18h2',
  refresh: 'M20 8a8 8 0 1 0 0 9M20 3v5h-5',
  close: 'M6 6l12 12M6 18 18 6',
  expand: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
}
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name]" />
  </svg>
</template>
