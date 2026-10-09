<script setup lang="ts">
import { computed, ref } from 'vue'
import DesignIcon from '../base/DesignIcon.vue'
import MessageTitle from './MessageTitle.vue'
import MessageSwitcher from './MessageSwitcher.vue'
import { useMessageBanner } from '../../composables/useMessageBanner'
import { useI18n } from '../../i18n/useI18n'
import type { DesktopMessage, MessagePlacement } from '../../api/http/message'

const props = withDefaults(defineProps<{ placement: MessagePlacement; compact?: boolean }>(), {
  compact: false,
})

const { currentLang, label } = useI18n()
const switching = ref(false)
const {
  messages,
  currentMessage,
  activeIndex,
  rollDirection,
  detailsOpen,
  next,
  previous,
  openDetails,
  setTitleDuration,
} = useMessageBanner(props.placement, switching)

const title = computed(() => localTitle(currentMessage.value))
const titleKey = computed(() => `${currentMessage.value?.messageUid}:${title.value}`)

function hideLeavingTitle(element: Element): void {
  element.setAttribute('aria-hidden', 'true')
}

function localTitle(message: DesktopMessage | null): string {
  if (!message) return ''
  return currentLang.value === 'en'
    ? message.titleEn || message.titleZh
    : message.titleZh || message.titleEn || ''
}
</script>

<template>
  <div
    v-if="currentMessage"
    class="message-host"
    :class="[
      `message-host--${placement}`,
      { 'message-host--compact': compact, 'message-host--expanded': detailsOpen },
    ]"
  >
    <div :class="['message-banner', `message-banner--${currentMessage.level}`]">
      <MessageSwitcher
        :count="messages.length"
        :active-index="activeIndex"
        @previous="previous"
        @next="next"
        @open-details="openDetails(currentMessage)"
        @active-change="switching = $event"
      />
      <button
        class="message-main"
        type="button"
        :title="title"
        :aria-label="
          placement === 'floating'
            ? detailsOpen
              ? label('Collapse announcement', '收起公告')
              : label('Expand announcement', '展开公告')
            : label('Show message details', '查看消息详情')
        "
        :aria-expanded="placement === 'floating' ? detailsOpen : undefined"
        :aria-controls="placement === 'floating' ? 'floating-announcement-details' : undefined"
        :aria-description="title"
        @click="openDetails(currentMessage)"
      >
        <span class="message-separator" aria-hidden="true"></span>
        <span class="message-copy">
          <Transition
            :name="rollDirection === 'down' ? 'message-flip-down' : 'message-flip-up'"
            @before-leave="hideLeavingTitle"
          >
            <MessageTitle
              :key="titleKey"
              :text="title"
              :message-uid="currentMessage.messageUid"
              :paused="detailsOpen || switching"
              @duration-change="setTitleDuration"
            />
          </Transition>
        </span>
        <span class="message-detail" aria-hidden="true">
          <span v-if="placement === 'main'">{{ label('View details', '查看详情') }}</span>
          <DesignIcon class="message-detail-chevron" name="chevronRight" :size="14" />
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.message-host {
  --message-height: 36px;
  position: relative;
  min-width: 0;
  min-height: var(--message-height);
  overflow: hidden;
  -webkit-app-region: no-drag;
}
.message-banner {
  --message-color: var(--primary);
  width: 100%;
  max-width: 100%;
  min-height: var(--message-height);
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
}
.message-banner--success {
  --message-color: var(--success);
}
.message-banner--warning {
  --message-color: var(--warning);
}
.message-banner--important {
  --message-color: var(--error);
}
.message-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: var(--message-height);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 2px;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--motion-hover) var(--motion-ease);
}
.message-main:hover {
  background: color-mix(in srgb, var(--message-color) 5%, transparent);
}
.message-separator {
  flex: 0 0 1px;
  height: 14px;
  background: var(--border-strong);
}
.message-copy {
  display: grid;
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 20px;
  overflow: hidden;
  perspective: 240px;
}
.message-copy strong {
  grid-area: 1 / 1;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: 13px;
  font-weight: var(--weight-medium);
  line-height: 20px;
  backface-visibility: hidden;
  transform-origin: center;
}
.message-main:focus-visible {
  outline: 2px solid var(--message-color);
  outline-offset: -2px;
}
.message-detail {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  color: var(--message-color);
  font-size: var(--type-caption);
  font-weight: var(--weight-medium);
  line-height: var(--leading-caption);
  white-space: nowrap;
}
.message-host--compact {
  --message-height: 32px;
}
.message-host--floating {
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.message-host--floating .message-banner {
  width: 100%;
  gap: 2px;
}
.message-host--floating .message-main {
  gap: 8px;
}
.message-host--floating .message-copy {
  flex: 1;
}
.message-host--floating .message-copy strong {
  font-size: var(--type-caption);
}
.message-host--floating .message-detail {
  color: var(--text-muted);
}
.message-host--floating .message-detail-chevron {
  transform: rotate(90deg);
  transition: transform var(--motion-detail) ease-in-out;
}
.message-host--floating.message-host--expanded .message-detail-chevron {
  transform: rotate(-90deg);
}
.message-host--floating.message-host--expanded .message-main {
  background: color-mix(in srgb, var(--message-color) 5%, transparent);
}
.message-flip-up-enter-active,
.message-flip-down-enter-active {
  transition:
    transform 360ms cubic-bezier(0.16, 1, 0.3, 1) 140ms,
    opacity 220ms ease-out 100ms;
}
.message-flip-up-leave-active,
.message-flip-down-leave-active {
  position: absolute;
  inset: 0;
  transition:
    transform 240ms cubic-bezier(0.2, 0.7, 0.3, 1),
    opacity 160ms ease-out;
}
.message-flip-up-enter-from {
  transform: translateY(6px) rotateX(-65deg);
  opacity: 0;
}
.message-flip-up-leave-to {
  transform: translateY(-6px) rotateX(65deg);
  opacity: 0;
}
.message-flip-down-enter-from {
  transform: translateY(-6px) rotateX(65deg);
  opacity: 0;
}
.message-flip-down-leave-to {
  transform: translateY(6px) rotateX(-65deg);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .message-host--floating .message-detail-chevron,
  .message-flip-up-enter-active,
  .message-flip-up-leave-active,
  .message-flip-down-enter-active,
  .message-flip-down-leave-active {
    transition: none;
  }
}
</style>
