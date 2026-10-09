<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePageState } from '../../composables/usePageState'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { submitFeedback } from '../../api/http/feedback'
import SegmentedControl from '../base/SegmentedControl.vue'
const { label } = useI18n(),
  { currentUser } = useAuth()
const state = usePageState('settings-feedback', { category: 'feature', title: '', content: '' })
const busy = ref(false),
  error = ref(''),
  submitted = ref(false)
const categories = computed(() => [
  { value: 'feature', label: label('Feature request', '功能建议') },
  { value: 'bug', label: label('Bug report', 'Bug 反馈') },
  { value: 'other', label: label('Other', '其他') },
])
async function send(): Promise<void> {
  if (busy.value) return
  error.value = ''
  submitted.value = false
  const content = state.content.trim()
  if (!content) {
    error.value = label('Please describe your feedback.', '请填写详细内容。')
    return
  }
  if (content.length > 2000 || state.title.trim().length > 200) {
    error.value = label(
      'Use at most 200 characters for the title and 2,000 for the details.',
      '标题最多 200 字，详细内容最多 2000 字。',
    )
    return
  }
  if (!['feature', 'bug', 'other'].includes(state.category)) {
    error.value = label('Choose a feedback type.', '请选择反馈类型。')
    return
  }
  busy.value = true
  const draft = JSON.stringify(state)
  try {
    await submitFeedback({
      category: state.category,
      title: state.title.trim(),
      content,
      contact: currentUser.value?.email || currentUser.value?.username || '',
    })
    submitted.value = true
    if (draft === JSON.stringify(state)) {
      state.title = ''
      state.content = ''
      state.category = 'feature'
    }
  } catch (reason) {
    error.value =
      reason instanceof Error
        ? reason.message
        : label('Could not submit feedback. Please retry.', '反馈提交失败，请重试。')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <form
    class="settings-feedback-form"
    :data-window-retain="Boolean(state.title || state.content || busy)"
    @submit.prevent="send"
  >
    <fieldset :disabled="busy">
      <legend>{{ label('Feedback type', '反馈类型') }}</legend>
      <SegmentedControl
        v-model="state.category"
        :options="categories"
        :label="label('Feedback type', '反馈类型')"
      />
      <label class="feedback-field">
        <span>
          {{ label('Title', '标题') }}
          <small>{{ label('Optional', '选填') }}</small>
        </span>
        <input
          v-model="state.title"
          type="text"
          maxlength="200"
          :placeholder="label('Briefly describe your feedback', '简要描述你的反馈')"
          :aria-label="label('Feedback title', '反馈标题')"
        />
      </label>
      <label class="feedback-field">
        <span>
          {{ label('Details', '详细内容') }}
          <small>{{ label('Required', '必填') }}</small>
        </span>
        <textarea
          v-model="state.content"
          maxlength="2000"
          :placeholder="
            label(
              'Describe your suggestion or the problem you encountered…',
              '请详细描述你的建议或遇到的问题…',
            )
          "
          :aria-label="label('Feedback details', '反馈详细内容')"
          :aria-invalid="Boolean(error && !state.content.trim())"
        />
      </label>
    </fieldset>
    <p class="preference-description">
      {{
        label(
          'For a problem, include the steps, expected result and actual behavior.',
          '描述问题时，可以提供操作步骤、预期结果与实际表现。',
        )
      }}
    </p>
    <p v-if="error" class="preference-status error" role="alert">{{ error }}</p>
    <p v-if="submitted" class="preference-status success" role="status">
      {{
        label(
          'Feedback submitted. Thank you for helping us improve.',
          '反馈已提交，感谢你帮助我们改进产品。',
        )
      }}
    </p>
    <div class="feedback-submit">
      <p>
        {{
          label(
            'Every piece of feedback helps us improve the product.',
            '每一条反馈，都会帮助我们改进产品。',
          )
        }}
      </p>
      <button type="submit" class="workspace-button workspace-button--primary" :disabled="busy">
        {{ busy ? label('Submitting…', '提交中…') : label('Submit feedback', '提交反馈') }}
      </button>
    </div>
  </form>
</template>
<style scoped>
fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
legend {
  padding: 0;
  font-size: 14px;
  line-height: 22px;
  margin-bottom: 12px;
}
.feedback-field {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 28px;
}
.feedback-field > span {
  display: flex;
  align-items: baseline;
  gap: 24px;
  font-size: 14px;
  line-height: 22px;
}
.feedback-field small {
  font-size: 12px;
  color: var(--text-soft);
}
.feedback-field input,
.feedback-field textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
  color: var(--text);
  background: var(--surface-low);
  font: 14px/22px var(--font-sans);
}
.feedback-field textarea {
  min-height: 228px;
  resize: vertical;
}
.feedback-field input::placeholder,
.feedback-field textarea::placeholder {
  color: var(--text-soft);
}
.feedback-submit {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  margin-top: 24px;
}
.feedback-submit p {
  font-size: 13px;
  line-height: 22px;
  color: var(--text-soft);
  margin: 0;
}
</style>
