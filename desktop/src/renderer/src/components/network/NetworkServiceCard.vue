<script setup lang="ts">
import type { AiNetworkService, AiEndpointResult } from '@shared/network-check'
import { useNetworkLabels } from '../../composables/useNetworkLabels'
import NetworkConnectionStatus from './NetworkConnectionStatus.vue'
import NetworkServiceBrand from './NetworkServiceBrand.vue'
import NetworkRefreshButton from './NetworkRefreshButton.vue'
defineProps<{
  service: AiNetworkService
  results: Record<string, AiEndpointResult>
  running: boolean
  disabled: boolean
}>()
defineEmits<{ open: []; refresh: [] }>()
const { label } = useNetworkLabels()
</script>
<template>
  <article class="network-service-card" :data-service="service.id">
    <button
      class="network-service-open"
      type="button"
      :aria-label="label(`${service.name} access details`, `${service.name} 访问详情`)"
      @click="$emit('open')"
    >
      <span class="network-service-name">
        <NetworkServiceBrand :service="service.id" />
        <strong>{{ service.name }}</strong>
      </span>
      <span class="network-service-entries">
        <span
          v-for="endpoint in service.endpoints"
          :key="endpoint.id"
          class="network-service-entry"
        >
          <span>
            {{
              endpoint.kind === 'api'
                ? 'API'
                : endpoint.kind === 'studio'
                  ? 'AI Studio'
                  : label('Web', '网页')
            }}
          </span>
          <NetworkConnectionStatus :result="results[endpoint.id]" />
        </span>
      </span>
    </button>
    <NetworkRefreshButton
      class="network-service-refresh"
      :label="label(`Retest ${service.name}`, `重测 ${service.name}`)"
      :running="running"
      :disabled="disabled"
      @click="$emit('refresh')"
    />
  </article>
</template>
<style scoped>
.network-service-card {
  position: relative;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-low);
  transition: border-color var(--motion-hover);
}
.network-service-card:hover {
  border-color: var(--primary-border);
}
.network-service-open {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  border: 0;
  background: none;
  width: 100%;
  height: 100%;
  min-height: 120px;
  padding: 12px;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font: inherit;
  border-radius: inherit;
}
.network-service-name {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 24px;
  min-height: 28px;
}
.network-service-name strong {
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.network-service-entries {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.network-service-entry {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 8px;
  font-size: 12px;
  line-height: 20px;
  color: var(--text-soft);
}
.network-service-refresh {
  position: absolute;
  top: 14px;
  right: 8px;
}
@container (max-width: 1100px) {
  .network-service-entry {
    grid-template-columns: 55px minmax(0, 1fr);
  }
  .network-service-name strong {
    font-size: 14px;
  }
}
</style>
