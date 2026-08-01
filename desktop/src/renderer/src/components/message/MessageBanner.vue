<script setup lang="ts">
import { computed } from 'vue'
import MarkdownContent from '../base/MarkdownContent.vue'
import MessageImageCarousel from './MessageImageCarousel.vue'
import { useBodyScrollLock } from '../../composables/useBodyScrollLock'
import { useMessageBanner } from '../../composables/useMessageBanner'
import { useI18n } from '../../i18n/useI18n'
import type { DesktopMessage, MessagePlacement } from '../../api/http/message'

const props = withDefaults(defineProps<{ placement: MessagePlacement; compact?: boolean }>(), {
  compact: false,
})

const { currentLang, label } = useI18n()
const {
  messages,
  currentMessage,
  activeIndex,
  detailsOpen,
  rollDirection,
  next,
  previous,
  openDetails,
  openAction,
} = useMessageBanner(props.placement)
useBodyScrollLock(detailsOpen)

const title = computed(() => localTitle(currentMessage.value))
const firstImage = computed(() => currentMessage.value?.images[0] || null)

function localTitle(message: DesktopMessage | null): string {
  if (!message) return ''
  return currentLang.value === 'en'
    ? message.titleEn || message.titleZh
    : message.titleZh || message.titleEn || ''
}

function localContent(message: DesktopMessage | null): string {
  if (!message) return ''
  return currentLang.value === 'en'
    ? message.contentEn || message.contentZh
    : message.contentZh || message.contentEn || ''
}

function iconFor(level: DesktopMessage['level']): string {
  if (level === 'success') return '✓'
  if (level === 'warning') return '!'
  if (level === 'important') return '◆'
  return 'i'
}
</script>

<template>
  <div v-if="currentMessage" class="message-host" :class="{ 'message-host--compact': compact }">
    <Transition :name="rollDirection === 'down' ? 'message-roll-down' : 'message-roll-up'">
      <div
        :key="`${currentMessage.id}:${currentMessage.pushedAt || currentMessage.updateTime || ''}`"
        :class="['message-banner', `message-banner--${currentMessage.level}`]"
      >
        <button class="message-main" type="button" @click="openDetails(currentMessage)">
          <img v-if="firstImage" :src="firstImage.imageUrl" alt="" />
          <span v-else class="message-icon">{{ iconFor(currentMessage.level) }}</span>
          <span class="message-copy">
            <strong>{{ title }}</strong>
          </span>
        </button>

        <div v-if="messages.length > 1" class="message-pager">
          <button
            type="button"
            :aria-label="label('Previous message', '上一条消息')"
            @click="previous"
          >
            ↑
          </button>
          <span>{{ activeIndex + 1 }}/{{ messages.length }}</span>
          <button type="button" :aria-label="label('Next message', '下一条消息')" @click="next">
            ↓
          </button>
        </div>
        <button
          class="message-detail"
          type="button"
          :aria-label="label('Show message details', '查看消息详情')"
          @click="openDetails(currentMessage)"
        >
          ↗
        </button>
      </div>
    </Transition>

    <Teleport to="body">
      <div
        v-if="detailsOpen && currentMessage"
        class="message-modal-backdrop"
        @mousedown.self="detailsOpen = false"
      >
        <section
          :class="['message-modal', `message-modal--${currentMessage.level}`]"
          role="dialog"
          aria-modal="true"
        >
          <button
            class="modal-close"
            type="button"
            :aria-label="label('Close details', '关闭详情')"
            @click="detailsOpen = false"
          >
            ×
          </button>
          <MessageImageCarousel
            v-if="currentMessage.images.length"
            :key="currentMessage.messageUid"
            :images="currentMessage.images"
            :title="localTitle(currentMessage)"
            @open="openAction(currentMessage, $event)"
          />
          <div class="modal-content">
            <span class="modal-type">
              <i>{{ iconFor(currentMessage.level) }}</i>
              {{ label('Message', '消息通知') }}
            </span>
            <h2>{{ localTitle(currentMessage) }}</h2>
            <MarkdownContent
              class="message-markdown"
              :content="localContent(currentMessage)"
              @link="openAction(currentMessage, $event)"
            />
            <div class="modal-actions">
              <button type="button" @click="detailsOpen = false">
                {{ label('Close', '关闭') }}
              </button>
            </div>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.message-host {
  position: relative;
  min-width: 0;
  min-height: 42px;
  overflow: hidden;
  -webkit-app-region: no-drag;
}
.message-banner {
  --message-color: var(--primary);
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  padding: 3px 5px;
  color: var(--text);
  background: color-mix(in srgb, var(--message-color) 8%, var(--surface-low));
  border: 1px solid color-mix(in srgb, var(--message-color) 30%, var(--border));
  border-radius: 11px;
  box-shadow: 0 4px 16px color-mix(in srgb, var(--message-color) 8%, transparent);
}
.message-banner--success {
  --message-color: #10b981;
}
.message-banner--warning {
  --message-color: #f59e0b;
}
.message-banner--important {
  --message-color: #ef4444;
}
.message-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px;
  color: inherit;
  background: transparent;
  border: 0;
  text-align: left;
  cursor: pointer;
}
.message-main img,
.message-icon {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border-radius: 8px;
}
.message-main img {
  object-fit: cover;
}
.message-icon {
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--message-color);
  font-size: 13px;
  font-weight: var(--weight-semibold);
}
.message-copy {
  min-width: 0;
}
.message-copy strong,
.message-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.message-copy strong {
  font-size: 12px;
  line-height: 16px;
}
.message-copy small {
  margin-top: 1px;
  color: var(--text-muted);
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
}
.message-pager {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 1px;
  color: var(--text-muted);
  font-size: var(--type-caption);
}
.message-pager button,
.message-detail {
  width: 24px;
  height: 26px;
  padding: 0;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
}
.message-pager button {
  font-size: 12px;
  font-weight: var(--weight-semibold);
}
.message-pager button:hover,
.message-detail:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--message-color) 10%, transparent);
}
.message-detail {
  font-size: 13px;
}
.message-host--compact {
  min-height: 34px;
}
.message-host--compact .message-banner {
  min-height: 34px;
  padding: 2px 3px;
  border-radius: 9px;
}
.message-host--compact .message-main img,
.message-host--compact .message-icon {
  flex-basis: 26px;
  width: 26px;
  height: 26px;
  border-radius: 7px;
}
.message-host--compact .message-copy small {
  display: none;
}
.message-host--compact .message-copy strong {
  font-size: var(--type-caption);
  line-height: var(--leading-caption);
}
.message-host--compact .message-detail {
  width: 20px;
  height: 24px;
}
.message-host--compact .message-pager span {
  display: none;
}
.message-roll-up-enter-active,
.message-roll-up-leave-active,
.message-roll-down-enter-active,
.message-roll-down-leave-active {
  transition:
    transform 0.32s cubic-bezier(0.22, 0.75, 0.28, 1),
    opacity 0.32s ease;
}
.message-roll-up-leave-active,
.message-roll-down-leave-active {
  position: absolute;
  inset: 0;
  width: 100%;
}
.message-roll-up-enter-from {
  transform: translateY(100%);
  opacity: 0;
}
.message-roll-up-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
.message-roll-down-enter-from {
  transform: translateY(-100%);
  opacity: 0;
}
.message-roll-down-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .message-roll-up-enter-active,
  .message-roll-up-leave-active,
  .message-roll-down-enter-active,
  .message-roll-down-leave-active {
    transition: none;
  }
}
.message-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(3, 7, 18, 0.62);
  backdrop-filter: blur(5px);
  -webkit-app-region: no-drag;
}
.message-modal {
  --message-color: var(--primary);
  position: relative;
  width: min(620px, calc(100vw - 32px));
  max-height: min(780px, calc(100vh - 32px));
  overflow: auto;
  color: var(--text);
  background: var(--surface-low);
  border: 1px solid color-mix(in srgb, var(--message-color) 38%, var(--border));
  border-radius: 18px;
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.45);
}
.message-modal--success {
  --message-color: #10b981;
}
.message-modal--warning {
  --message-color: #f59e0b;
}
.message-modal--important {
  --message-color: #ef4444;
}
.modal-close {
  position: absolute;
  z-index: 2;
  top: 10px;
  right: 10px;
  width: 32px;
  height: 32px;
  color: var(--text);
  background: color-mix(in srgb, var(--surface-low) 84%, transparent);
  border: 1px solid var(--border);
  border-radius: 9px;
  font-size: 20px;
  cursor: pointer;
}
.modal-content {
  padding: 24px;
}
.modal-type {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--message-color);
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.4px;
}
.modal-type i {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--message-color);
  border-radius: 7px;
  font-style: normal;
}
.modal-content h2 {
  margin: 12px 0 10px;
  color: var(--text);
  font-size: 22px;
  line-height: 1.3;
}
.message-markdown {
  margin: 0;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1.75;
  user-select: text;
}
.modal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 22px;
  justify-content: flex-end;
}
.modal-actions button {
  min-height: 36px;
  padding: 0 14px;
  color: var(--text);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 9px;
  font-weight: var(--weight-semibold);
  cursor: pointer;
}
@media (max-width: 700px) {
  .message-copy small {
    display: none;
  }
  .message-main img,
  .message-icon {
    flex-basis: 28px;
    width: 28px;
    height: 28px;
  }
}
</style>
