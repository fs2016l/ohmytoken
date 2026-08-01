<script setup lang="ts">
import { computed } from 'vue'
import BaseDatePicker from '../base/BaseDatePicker.vue'
import { useI18n } from '../../i18n/useI18n'
import type { QuickRange } from '../../composables/useAgentStats'
import type { ScanMode } from '@shared/models'

interface Props {
  dateFrom: string
  dateTo: string
  quickRange: QuickRange | null
  lastScanDisplay: string
  isScanning: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:dateFrom': [value: string]
  'update:dateTo': [value: string]
  setQuickRange: [range: QuickRange]
  scan: [mode: ScanMode]
}>()

const { tr } = useI18n()

const fromModel = computed({
  get: () => props.dateFrom,
  set: (value: string | undefined) => emit('update:dateFrom', value || ''),
})

const toModel = computed({
  get: () => props.dateTo,
  set: (value: string | undefined) => emit('update:dateTo', value || ''),
})

function clickInnerInput(evt: MouseEvent): void {
  ;(evt.currentTarget as HTMLElement | null)?.querySelector('input')?.click()
}
</script>

<template>
  <section class="control-bar">
    <div class="control-left">
      <div class="date-tile-new" @click="clickInnerInput">
        <span class="material-symbols-outlined">calendar_today</span>
        <span class="date-copy">
          <small>{{ tr('startDateLabel') }}</small>
          <BaseDatePicker v-model="fromModel" />
        </span>
      </div>
      <div class="date-tile-new" @click="clickInnerInput">
        <span class="material-symbols-outlined">calendar_today</span>
        <span class="date-copy">
          <small>{{ tr('endDateLabel') }}</small>
          <BaseDatePicker v-model="toModel" />
        </span>
      </div>
      <div class="quick-tabs">
        <button
          :class="{ active: quickRange === 'today' }"
          type="button"
          @click="emit('setQuickRange', 'today')"
        >
          {{ tr('today') }}
        </button>
        <button
          :class="{ active: quickRange === 'week' }"
          type="button"
          @click="emit('setQuickRange', 'week')"
        >
          {{ tr('thisWeek') }}
        </button>
        <button
          :class="{ active: quickRange === 'month' }"
          type="button"
          @click="emit('setQuickRange', 'month')"
        >
          {{ tr('thisMonth') }}
        </button>
        <button
          :class="{ active: quickRange === 'all' }"
          type="button"
          @click="emit('setQuickRange', 'all')"
        >
          {{ tr('allTime') }}
        </button>
      </div>
    </div>
    <div class="control-right">
      <div class="scan-meta">
        <span>{{ tr('lastScan') }}: {{ lastScanDisplay }}</span>
        <div class="scan-state">
          <span class="state-item" :class="{ ready: !isScanning }">
            <i></i>
            {{ tr('ready') }}
          </span>
          <span class="state-item" :class="{ active: isScanning }">
            <i></i>
            {{ tr('scanningStatus') }}
          </span>
        </div>
      </div>
      <div class="scan-actions">
        <button
          class="scan-primary"
          :class="{ scanning: isScanning }"
          :disabled="isScanning"
          type="button"
          @click="emit('scan', 'incremental')"
        >
          <span class="material-symbols-outlined" :class="{ spin: isScanning }">
            {{ isScanning ? 'progress_activity' : 'bolt' }}
          </span>
          {{ isScanning ? tr('scanning') : tr('startScan') }}
        </button>
        <div class="scan-full-panel">
          <button
            class="scan-full"
            :disabled="isScanning"
            type="button"
            :title="tr('fullRescanHint')"
            @click="emit('scan', 'full')"
          >
            <span class="material-symbols-outlined">history</span>
            {{ tr('fullRescan') }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.control-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 8px;
  background: var(--surface-container);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
}

.control-left,
.control-right,
.scan-state {
  display: flex;
  align-items: center;
}

.control-left {
  flex-wrap: wrap;
  gap: 16px;
  min-width: 0;
}

.control-right {
  justify-content: flex-end;
  gap: 24px;
  margin-left: auto;
}

.date-tile-new {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 12px;
  background: var(--surface-container-high);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  cursor: pointer;
}

.date-tile-new .material-symbols-outlined {
  color: var(--primary);
  font-size: 20px;
}

.date-copy,
.date-tile-new .date-copy {
  display: grid;
  gap: 2px;
}

.date-tile-new small {
  color: var(--text-soft);
  font-family: var(--font-number);
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-caption);
  text-transform: uppercase;
}

.quick-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  min-height: 40px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.quick-tabs button {
  min-width: 60px;
  min-height: 32px;
  padding: 0 16px;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: 2px;
  font-size: 14px;
  font-weight: var(--weight-semibold);
}

.quick-tabs button.active,
.quick-tabs button:hover {
  color: var(--text);
  background: var(--surface-container-high);
}

.scan-meta {
  display: grid;
  justify-items: end;
  gap: 7px;
}

.scan-meta > span {
  color: var(--text-soft);
  font-size: 12px;
  opacity: 0.7;
}

.scan-state {
  gap: 24px;
}

.state-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-soft);
  font-family: var(--font-sans);
  font-size: 12px;
  text-transform: uppercase;
  opacity: 0.4;
}

.state-item.ready,
.state-item.active {
  color: var(--text);
  opacity: 1;
}

.state-item i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-strong);
}

.state-item.ready i {
  background: var(--tertiary);
  box-shadow: 0 0 8px rgba(78, 222, 163, 0.4);
}

.state-item.active i {
  background: var(--primary);
  box-shadow: 0 0 8px rgba(208, 188, 255, 0.45);
}

.scan-primary {
  border: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 8px;
  transition:
    transform 0.15s ease,
    background 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease;
  min-height: 44px;
  padding: 0 24px;
  color: var(--primary-on);
  background: var(--primary);
  font-weight: var(--weight-semibold);
  font-size: 16px;
  white-space: nowrap;
  box-shadow: 0 10px 30px rgba(208, 188, 255, 0.1);
}

.scan-actions {
  position: relative;
  display: inline-flex;
}

.scan-full-panel {
  position: absolute;
  right: 0;
  bottom: 100%;
  z-index: 20;
  padding-bottom: 8px;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(4px);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease,
    visibility 0.15s ease;
}

.scan-actions:hover .scan-full-panel,
.scan-actions:focus-within .scan-full-panel {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translateY(0);
}

.scan-full {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 38px;
  padding: 0 16px;
  color: var(--text);
  background: var(--surface-container-high);
  border: 1px solid var(--primary);
  border-radius: 8px;
  font-size: 13px;
  font-weight: var(--weight-semibold);
  white-space: nowrap;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
  transition:
    background 0.15s ease,
    filter 0.15s ease,
    transform 0.15s ease;
}

.scan-full:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.scan-full:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.scan-full .material-symbols-outlined {
  color: var(--primary);
  font-size: 18px;
}

.scan-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.1);
}

.scan-primary:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 820px) {
  .control-bar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
