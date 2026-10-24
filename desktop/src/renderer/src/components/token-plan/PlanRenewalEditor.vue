<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { PlanRenewal, PlanRenewalInput, RenewalCycle } from '../../../../shared/plan-renewals'
import {
  isRenewalColor,
  localRenewalDate,
  parseRenewalDate,
} from '../../../../shared/plan-renewals'
import { TOKEN_PLAN_PROVIDERS } from '../../config/token-plan-providers'
import { useI18n } from '../../i18n/useI18n'
import { useRenewalLabels } from '../../composables/useRenewalLabels'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import SelectControl from '../base/SelectControl.vue'
import SingleDateControl from '../base/SingleDateControl.vue'
import VendorMark from '../base/VendorMark.vue'
import PlanRenewalColorControl from './PlanRenewalColorControl.vue'

const props = defineProps<{ item: PlanRenewal | null; busy: boolean; error: string }>()
const emit = defineEmits<{ close: []; save: [input: PlanRenewalInput]; remove: [id: string] }>()
const { label, currentLang } = useI18n()
const { cycleName, providerName } = useRenewalLabels()
const draft = reactive<PlanRenewalInput>({
  ...(props.item ? { id: props.item.id } : {}),
  name: props.item?.name ?? '',
  providerId: props.item?.providerId ?? 'other',
  renewOn: props.item?.renewOn ?? localRenewalDate(),
  cycle: props.item?.cycle ?? 'monthly',
  intervalDays: props.item?.intervalDays ?? 30,
  notes: props.item?.notes ?? '',
  color: props.item?.color ?? null,
})
const initialDraft = JSON.stringify(draft)
const dirty = computed(() => JSON.stringify(draft) !== initialDraft)
const cycles: RenewalCycle[] = ['monthly', 'quarterly', 'yearly', 'custom']
const valid = computed(
  () =>
    draft.name.trim() &&
    parseRenewalDate(draft.renewOn) &&
    (draft.color == null || isRenewalColor(draft.color)) &&
    (draft.cycle !== 'custom' ||
      (Number.isInteger(draft.intervalDays) &&
        draft.intervalDays! >= 1 &&
        draft.intervalDays! <= 3650)),
)
function save(): void {
  if (!valid.value || props.busy) return
  emit('save', { ...draft, intervalDays: draft.cycle === 'custom' ? draft.intervalDays : null })
}
</script>

<template>
  <WorkspaceDialog
    open
    class="renewal-editor"
    :title="
      item ? label('Edit renewal date', '编辑续费时间') : label('Add subscription', '添加套餐')
    "
    :busy="busy"
    @close="emit('close')"
  >
    <form
      id="plan-renewal-form"
      class="renewal-form"
      :data-window-retain="busy || dirty"
      @submit.prevent="save"
    >
      <p v-if="item" class="renewal-editor-subtitle">
        {{ providerName(item.providerId) }} · {{ item.name }}
      </p>
      <label class="renewal-field" for="renewal-name">
        <span>{{ label('Subscription name', '套餐名称') }}</span>
        <input
          id="renewal-name"
          v-model="draft.name"
          class="workspace-input"
          maxlength="120"
          :disabled="busy"
          required
          autofocus
          :placeholder="label('e.g. Codex Pro', '例如 Codex Pro')"
        />
      </label>
      <div class="renewal-field">
        <span>{{ label('Provider', '厂商') }}</span>
        <SelectControl
          v-model="draft.providerId"
          :disabled="busy"
          :label="label('Provider', '厂商')"
          :options="[
            ...TOKEN_PLAN_PROVIDERS.map((provider) => ({
              value: provider.id,
              label: currentLang === 'zh' ? provider.nameZh : provider.nameEn,
            })),
            { value: 'other', label: label('Other / custom', '其他 / 自定义') },
          ]"
        >
          <template #value="{ option, label: selectedLabel }">
            <span class="renewal-provider-option">
              <span
                v-if="option?.value === 'other'"
                class="material-symbols-outlined"
                aria-hidden="true"
              >
                widgets
              </span>
              <VendorMark v-else :provider="String(option?.value ?? 'other')" :size="18" />
              <span>{{ selectedLabel }}</span>
            </span>
          </template>
          <template #option="{ option }">
            <span class="renewal-provider-option">
              <span
                v-if="option.value === 'other'"
                class="material-symbols-outlined"
                aria-hidden="true"
              >
                widgets
              </span>
              <VendorMark v-else :provider="String(option.value)" :size="18" />
              <span>{{ option.label }}</span>
            </span>
          </template>
        </SelectControl>
      </div>
      <div class="renewal-field">
        <label for="renewal-date">{{ label('Next renewal date', '下次续费日期') }}</label>
        <SingleDateControl
          id="renewal-date"
          v-model="draft.renewOn"
          :label="label('Next renewal date', '下次续费日期')"
          :disabled="busy"
        />
      </div>
      <fieldset class="renewal-cycle" :disabled="busy">
        <legend>{{ label('Renewal cycle', '续费周期') }}</legend>
        <div class="renewal-cycle-options">
          <label v-for="cycle in cycles" :key="cycle" :class="{ selected: draft.cycle === cycle }">
            <input v-model="draft.cycle" type="radio" name="renewal-cycle" :value="cycle" />
            {{ cycleName(cycle) }}
          </label>
        </div>
      </fieldset>
      <label v-if="draft.cycle === 'custom'" class="renewal-interval" for="renewal-interval">
        {{ label('Every', '每') }}
        <input
          id="renewal-interval"
          v-model.number="draft.intervalDays"
          type="number"
          min="1"
          max="3650"
          step="1"
          class="workspace-input"
          :disabled="busy"
          required
          :aria-label="label('Custom interval in days', '自定义间隔天数')"
        />
        {{ label('days', '天续费') }}
      </label>
      <div class="renewal-field">
        <span>{{ label('Calendar color', '色块颜色') }}</span>
        <PlanRenewalColorControl v-model="draft.color" :disabled="busy" />
      </div>
      <label class="renewal-field" for="renewal-notes">
        <span>{{ label('Notes (optional)', '备注（选填）') }}</span>
        <textarea
          id="renewal-notes"
          v-model="draft.notes"
          class="workspace-input"
          maxlength="2000"
          rows="3"
          :disabled="busy"
        />
      </label>
      <p class="renewal-editor-hint">
        <span class="material-symbols-outlined" aria-hidden="true">info</span>
        {{
          label(
            'The calendar repeats this date according to the renewal cycle.',
            '日历会根据续费周期自动排列后续日期。',
          )
        }}
      </p>
      <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <button
        v-if="item"
        type="button"
        class="workspace-button renewal-delete"
        :disabled="busy"
        @click="emit('remove', item.id)"
      >
        {{ label('Delete record', '删除记录') }}
      </button>
      <button type="button" class="workspace-button" :disabled="busy" @click="emit('close')">
        {{ label('Cancel', '取消') }}
      </button>
      <button
        type="submit"
        form="plan-renewal-form"
        class="workspace-button workspace-button--primary"
        :disabled="busy || !valid"
      >
        {{ busy ? label('Saving…', '保存中…') : label('Save', '保存') }}
      </button>
    </template>
  </WorkspaceDialog>
</template>

<style scoped>
.renewal-form {
  display: grid;
  gap: 16px;
}
.renewal-field {
  display: grid;
  gap: 9px;
  font-size: 13px;
}
.renewal-field :is(.workspace-input, .select-control) {
  width: 100%;
}
.renewal-field textarea {
  height: auto;
  padding: 10px 12px;
  resize: vertical;
  min-height: 76px;
}
.renewal-editor-subtitle {
  margin: 0;
  color: var(--text-soft);
  font-size: 13px;
}
.renewal-provider-option {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.renewal-provider-option > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.renewal-provider-option > .material-symbols-outlined {
  flex: none;
  font-size: 18px;
}
.renewal-cycle {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.renewal-cycle legend {
  font-size: 13px;
  margin-bottom: 9px;
}
.renewal-cycle-options {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}
.renewal-cycle-options label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
}
.renewal-cycle-options .selected {
  color: var(--primary-soft-text);
  background: var(--primary-soft);
  border-color: var(--primary-border);
}
.renewal-cycle-options input {
  accent-color: var(--primary);
  margin: 0;
}
.renewal-interval {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.renewal-interval input {
  width: 90px;
}
.renewal-editor-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 10px;
  color: var(--primary-soft-text);
  background: var(--primary-soft);
  border-radius: 8px;
  font-size: 12px;
}
.renewal-editor-hint .material-symbols-outlined {
  font-size: 18px;
}
.renewal-delete {
  margin-right: auto;
  color: var(--error);
  border-color: transparent;
  background: transparent;
}
@media (max-width: 520px) {
  .renewal-cycle-options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
