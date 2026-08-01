<script setup lang="ts">
const brandMarkUrl = './brand/logo-mark-256.png'
</script>

<template>
  <img class="brand-mark-image" :src="brandMarkUrl" alt="" aria-hidden="true" draggable="false" />
</template>

<style scoped>
.brand-mark-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
