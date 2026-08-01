<script setup lang="ts">
import { useI18n } from '../../i18n/useI18n'
import type { ScanResult } from '@shared/models'

interface Props {
  scanResult: ScanResult | null
  lastScanTime: string
}

defineProps<Props>()

const { tr } = useI18n()
</script>

<template>
  <section v-if="scanResult?.errors?.length" class="scan-result error">
    <div>
      <span class="material-symbols-outlined">warning</span>
      <strong>{{ tr('scanCompletedAt') }} {{ lastScanTime }}</strong>
    </div>
    <p>{{ scanResult.errors.join(' | ') }}</p>
  </section>
</template>

<style scoped>
.scan-result {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 8px;
  color: var(--tertiary);
  background: rgba(78, 222, 163, 0.08);
  border: 1px solid rgba(78, 222, 163, 0.28);
}

.scan-result.error {
  color: var(--error);
  background: rgba(255, 180, 171, 0.08);
  border-color: rgba(255, 180, 171, 0.3);
}

.scan-result div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.scan-result span,
.scan-result p {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
