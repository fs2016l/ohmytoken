<script setup lang="ts">
import AppLayout from './components/layout/AppLayout.vue'
import FloatingWindow from './views/FloatingWindow.vue'

const isFloatingWindow = new URLSearchParams(window.location.search).get('window') === 'floating'
</script>

<template>
  <FloatingWindow v-if="isFloatingWindow" />
  <AppLayout v-else />
</template>
