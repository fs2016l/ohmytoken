<script setup lang="ts">
withDefaults(
  defineProps<{ open?: boolean; direction?: 'down' | 'right'; disclosure?: boolean }>(),
  { open: false, direction: 'down', disclosure: false },
)
</script>
<template>
  <span
    class="dropdown-chevron material-symbols-outlined"
    :class="{
      'is-open': open,
      'dropdown-chevron--right': direction === 'right',
      'dropdown-chevron--disclosure': disclosure,
    }"
    aria-hidden="true"
  >
    {{ direction === 'right' ? 'chevron_right' : 'expand_more' }}
  </span>
</template>
<style scoped>
.dropdown-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: none;
  font-size: 16px;
  line-height: 1;
  transform: rotate(0);
  transition: transform var(--motion-popover) var(--motion-ease);
}
.dropdown-chevron.is-open {
  transform: rotate(180deg);
}
.dropdown-chevron--right.is-open {
  transform: rotate(90deg);
}
@media (prefers-reduced-motion: reduce) {
  .dropdown-chevron {
    transition: none;
  }
}
</style>
<style>
details[open] > summary > .dropdown-chevron--disclosure {
  transform: rotate(180deg);
}
details[open] > summary > .dropdown-chevron--right.dropdown-chevron--disclosure {
  transform: rotate(90deg);
}
</style>
