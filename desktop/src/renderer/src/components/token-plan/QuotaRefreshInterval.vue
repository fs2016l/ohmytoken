<script setup lang="ts">
import { computed } from 'vue'
import SelectControl from '../base/SelectControl.vue'
import { QUOTA_REFRESH_INTERVALS } from '@shared/token-plan'
import { useI18n } from '../../i18n/useI18n'

defineProps<{ modelValue: number; compact?: boolean; placement?: 'top' | 'auto' }>()
defineEmits<{ 'update:modelValue': [value: number] }>()
const { label } = useI18n()
const options = computed(() =>
  QUOTA_REFRESH_INTERVALS.map((value) => ({
    value,
    label: !value
      ? label('Manual', '手动刷新')
      : value < 60_000
        ? label(`Every ${value / 1000}s`, `每 ${value / 1000} 秒`)
        : label(`Every ${value / 60_000}m`, `每 ${value / 60_000} 分钟`),
  })),
)
</script>

<template>
  <SelectControl
    :model-value="modelValue"
    :options="options"
    :label="label('Quota refresh interval', '额度刷新间隔')"
    :compact="compact"
    :placement="placement"
    @update:model-value="$emit('update:modelValue', Number($event))"
  />
</template>
