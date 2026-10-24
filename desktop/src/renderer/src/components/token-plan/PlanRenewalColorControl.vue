<script setup lang="ts">
import { computed } from 'vue'
import { isRenewalColor } from '../../../../shared/plan-renewals'
import { useI18n } from '../../i18n/useI18n'
import { renewalColorText } from '../../utils/renewal-colors'

const props = withDefaults(defineProps<{ modelValue?: string | null; disabled?: boolean }>(), {
  modelValue: null,
  disabled: false,
})
const emit = defineEmits<{ 'update:modelValue': [color: string | null] }>()
const { label } = useI18n()
const palette = [
  { value: '#7c3aed', en: 'Purple', zh: '紫色' },
  { value: '#2563eb', en: 'Blue', zh: '蓝色' },
  { value: '#0891b2', en: 'Cyan', zh: '青色' },
  { value: '#16a34a', en: 'Green', zh: '绿色' },
  { value: '#d97706', en: 'Amber', zh: '琥珀色' },
  { value: '#e11d48', en: 'Rose', zh: '玫红色' },
  { value: '#64748b', en: 'Slate', zh: '灰色' },
]
const valid = computed(() => props.modelValue == null || isRenewalColor(props.modelValue))
const preview = computed(() =>
  isRenewalColor(props.modelValue) ? props.modelValue : 'var(--primary)',
)
const previewText = computed(() => renewalColorText(props.modelValue))
function choose(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value.trim() || null)
}
</script>

<template>
  <div class="renewal-color-control">
    <div
      class="renewal-color-options"
      role="group"
      :aria-label="label('Calendar color', '色块颜色')"
    >
      <button
        type="button"
        class="workspace-button renewal-color-auto"
        :class="{ selected: modelValue == null }"
        :aria-pressed="modelValue == null"
        :disabled="disabled"
        @click="emit('update:modelValue', null)"
      >
        {{ label('Auto', '自动') }}
      </button>
      <button
        v-for="color in palette"
        :key="color.value"
        type="button"
        class="renewal-color-swatch"
        :class="{ selected: modelValue?.toLowerCase() === color.value }"
        :style="{ '--swatch-color': color.value }"
        :aria-label="label(color.en, color.zh)"
        :title="label(color.en, color.zh)"
        :aria-pressed="modelValue?.toLowerCase() === color.value"
        :disabled="disabled"
        @click="emit('update:modelValue', color.value)"
      >
        <span aria-hidden="true" />
      </button>
    </div>
    <div class="renewal-color-custom">
      <input
        type="color"
        class="renewal-color-picker"
        :value="isRenewalColor(modelValue) ? modelValue : '#7c3aed'"
        :disabled="disabled"
        :aria-label="label('Custom color', '自定义颜色')"
        :title="label('Choose a custom color', '选择自定义颜色')"
        @input="choose"
      />
      <input
        type="text"
        class="workspace-input renewal-color-hex"
        :value="modelValue ?? ''"
        :disabled="disabled"
        :aria-label="label('Hex color', '十六进制颜色')"
        :aria-invalid="!valid"
        maxlength="7"
        placeholder="#7C3AED"
        autocomplete="off"
        :spellcheck="false"
        @input="choose"
      />
      <span
        class="renewal-color-preview"
        :style="{ '--preview-color': preview, '--preview-text': previewText }"
      >
        {{ label('Preview', '预览') }}
      </span>
      <span class="renewal-color-help">
        {{ label('Calendar and date details', '用于日历与日期清单') }}
      </span>
    </div>
    <p v-if="!valid" class="renewal-color-error" role="alert">
      {{ label('Enter a color in #RRGGBB format.', '请输入 #RRGGBB 格式的颜色。') }}
    </p>
  </div>
</template>

<style scoped>
.renewal-color-control {
  display: grid;
  gap: 10px;
}
.renewal-color-options {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.renewal-color-custom {
  display: grid;
  grid-template-columns: 32px 104px 52px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.renewal-color-auto {
  min-height: 30px;
  height: 30px;
  padding: 0 10px;
  font-size: 12px;
}
.renewal-color-auto.selected {
  border-color: var(--primary-border);
  background: var(--primary-soft);
  color: var(--primary-soft-text);
}
.renewal-color-swatch {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 3px;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}
.renewal-color-swatch span {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--swatch-color);
}
.renewal-color-swatch.selected {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.renewal-color-swatch:hover:not(:disabled) {
  border-color: var(--border-strong, var(--border));
}
.renewal-color-swatch:focus-visible,
.renewal-color-picker:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.renewal-color-picker {
  flex: none;
  width: 32px;
  height: 32px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-low);
  cursor: pointer;
}
.renewal-color-picker::-webkit-color-swatch-wrapper {
  padding: 0;
}
.renewal-color-picker::-webkit-color-swatch {
  border: 0;
  border-radius: 4px;
}
.renewal-color-custom .renewal-color-hex {
  min-width: 0;
  width: 100%;
  height: 32px;
  min-height: 32px;
  font-size: 12px;
}
.renewal-color-preview {
  display: grid;
  place-items: center;
  min-width: 52px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--preview-text);
  background: var(--preview-color);
  font-size: 12px;
}
.renewal-color-help {
  color: var(--text-soft);
  font-size: 11px;
}
.renewal-color-error {
  margin: 0;
  color: var(--error);
  font-size: 12px;
}
</style>
