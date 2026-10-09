<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DesignIcon from '../base/DesignIcon.vue'
import { useI18n } from '../../i18n/useI18n'
import { useMotionVisibility } from '../../composables/useMotionVisibility'

const props = defineProps<{ count: number; activeIndex: number }>()
const emit = defineEmits<{
  previous: []
  next: []
  openDetails: []
  activeChange: [active: boolean]
}>()
const { label } = useI18n()
const element = ref<HTMLElement | null>(null)
const labelButton = ref<HTMLButtonElement | null>(null)
const pager = ref<HTMLElement | null>(null)
const opened = ref(false)
const multiple = computed(() => props.count > 1)
const { visible } = useMotionVisibility(element)
let hovered = false
let keyboardFocus = false
let pinned = false
let restoringFocus = false
let enterTimer: ReturnType<typeof setTimeout> | undefined
let leaveTimer: ReturnType<typeof setTimeout> | undefined

function clearTimers(): void {
  clearTimeout(enterTimer)
  clearTimeout(leaveTimer)
}

function setOpen(value: boolean, focusFirst = false): void {
  const next = value && multiple.value
  if (opened.value !== next) {
    opened.value = next
    emit('activeChange', next)
  }
  if (next && focusFirst) {
    void nextTick(() => {
      if (opened.value) pager.value?.querySelector('button')?.focus({ preventScroll: true })
    })
  }
}

function enter(event: PointerEvent): void {
  if (event.pointerType === 'touch' || !multiple.value) return
  hovered = true
  clearTimers()
  enterTimer = setTimeout(() => setOpen(true), 45)
}

function scheduleClose(): void {
  clearTimeout(leaveTimer)
  leaveTimer = setTimeout(() => {
    if (!hovered && !keyboardFocus && !pinned) setOpen(false)
  }, 180)
}

function leave(): void {
  hovered = false
  clearTimeout(enterTimer)
  scheduleClose()
}

function clickLabel(event: MouseEvent): void {
  if (!multiple.value) {
    emit('openDetails')
    return
  }
  pinned = event instanceof PointerEvent && event.pointerType === 'touch'
  setOpen(true, event.detail === 0)
}

function focusIn(event: FocusEvent): void {
  if (restoringFocus || !(event.target instanceof HTMLElement)) return
  keyboardFocus = event.target.matches(':focus-visible')
  if (!keyboardFocus) return
  clearTimers()
  setOpen(true, event.target === labelButton.value)
}

function focusOut(): void {
  void nextTick(() => {
    if (!element.value?.contains(document.activeElement)) {
      keyboardFocus = false
      pinned = false
      scheduleClose()
    }
  })
}

async function escape(event: KeyboardEvent): Promise<void> {
  if (!opened.value) return
  event.preventDefault()
  event.stopPropagation()
  clearTimers()
  keyboardFocus = false
  pinned = false
  restoringFocus = true
  setOpen(false)
  await nextTick()
  labelButton.value?.focus({ preventScroll: true })
  restoringFocus = false
}

function outsidePointer(event: PointerEvent): void {
  if (!pinned || element.value?.contains(event.target as Node)) return
  pinned = false
  setOpen(false)
}

watch([visible, multiple], ([shown, many]) => {
  if (shown && many) return
  clearTimers()
  hovered = false
  keyboardFocus = false
  pinned = false
  setOpen(false)
})
onMounted(() => document.addEventListener('pointerdown', outsidePointer))
onBeforeUnmount(() => {
  clearTimers()
  document.removeEventListener('pointerdown', outsidePointer)
  if (opened.value) emit('activeChange', false)
})
</script>

<template>
  <div
    ref="element"
    class="message-switcher"
    :class="{ 'message-switcher--open': opened, 'message-switcher--single': !multiple }"
    @pointerenter="enter"
    @pointerleave="leave"
    @pointerdown="keyboardFocus = false"
    @focusin="focusIn"
    @focusout="focusOut"
    @keydown.esc="escape"
  >
    <div class="message-switcher-rotor">
      <button
        ref="labelButton"
        class="message-label"
        type="button"
        :title="label('Announcement', '公告')"
        :aria-label="
          multiple
            ? label('Switch announcements', '切换公告')
            : label('Show message details', '查看消息详情')
        "
        :aria-expanded="multiple ? opened : undefined"
        :aria-hidden="opened"
        :inert="opened"
        @click="clickLabel"
      >
        <DesignIcon name="megaphone" :size="18" />
        <span>{{ label('Ann.', '公告') }}</span>
      </button>
      <div
        v-if="multiple"
        ref="pager"
        class="message-pager"
        role="group"
        :aria-label="label('Announcement navigation', '公告切换')"
        :aria-hidden="!opened"
        :inert="!opened"
      >
        <button
          type="button"
          :aria-label="label('Previous message', '上一条消息')"
          @click="emit('previous')"
        >
          <DesignIcon class="message-previous" name="chevronRight" :size="14" />
        </button>
        <span class="message-page-count">{{ activeIndex + 1 }}/{{ count }}</span>
        <button
          type="button"
          :aria-label="label('Next message', '下一条消息')"
          @click="emit('next')"
        >
          <DesignIcon class="message-next" name="chevronRight" :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-switcher {
  flex: 0 0 max(86px, 7.2em);
  height: 30px;
  position: relative;
  color: var(--message-color);
  font-size: var(--type-caption);
  perspective: 850px;
}
.message-switcher-rotor {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  transform-origin: center;
  transition: transform 280ms cubic-bezier(0.65, 0, 0.35, 1);
}
.message-switcher--open .message-switcher-rotor {
  transform: rotateX(-180deg);
  transition-duration: 340ms;
}
.message-label,
.message-pager {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: inherit;
  border: 0;
  border-radius: 6px;
  backface-visibility: hidden;
}
.message-label {
  gap: 6px;
  padding: 0;
  background: transparent;
  font: inherit;
  font-weight: var(--weight-medium);
  white-space: nowrap;
  transform: rotateX(0deg);
  cursor: pointer;
}
.message-pager {
  gap: 1px;
  padding: 2px;
  background: color-mix(in srgb, var(--message-color) 11%, transparent);
  transform: rotateX(180deg);
}
.message-pager button {
  flex: 0 0 24px;
  height: 26px;
  display: grid;
  place-items: center;
  padding: 0;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
  transition: background-color var(--motion-hover) var(--motion-ease);
}
.message-pager button:hover {
  background: color-mix(in srgb, var(--message-color) 12%, transparent);
}
.message-label:focus-visible,
.message-pager button:focus-visible {
  outline: 2px solid var(--message-color);
  outline-offset: -2px;
}
.message-previous {
  transform: rotate(-90deg);
}
.message-next {
  transform: rotate(90deg);
}
.message-page-count {
  flex: 1;
  min-width: 0;
  text-align: center;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.message-switcher--single .message-switcher-rotor {
  transition: none;
}
@media (pointer: coarse) {
  .message-switcher {
    flex-basis: max(120px, 10em);
    height: 44px;
  }
  .message-pager button {
    flex-basis: 44px;
    height: 44px;
  }
  .message-pager {
    padding: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .message-switcher-rotor {
    transition: none;
  }
}
</style>
