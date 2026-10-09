<script setup lang="ts">
defineProps<{ items: { id: string; label: string }[] }>()
</script>

<template>
  <footer class="card-stats-footer">
    <span v-for="item in items" :key="item.id" class="footer-stat" :data-stat="item.id">
      <span class="footer-stat-value"><slot :name="item.id" /></span>
      <span class="footer-stat-label" :title="item.label">{{ item.label }}</span>
    </span>
  </footer>
</template>

<style scoped>
.card-stats-footer {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  flex: none;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 16px;
}
.footer-stat {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  gap: 4px;
  text-align: center;
  white-space: nowrap;
}
.footer-stat + .footer-stat::before {
  content: '';
  position: absolute;
  inset: 10px auto 10px 0;
  width: 1px;
  background: var(--border);
}
.footer-stat-value {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  max-width: 100%;
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}
.footer-stat-label,
.footer-stat-value :deep(.animated-cost) {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.footer-stat-value :deep(.material-symbols-outlined) {
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 400;
  line-height: 1;
  font-style: normal;
}
</style>
