<script setup lang="ts">
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { useI18n } from '../../i18n/useI18n'
defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{ open: boolean; title: string; busy?: boolean; wide?: boolean; drawer?: boolean }>(),
  { busy: false, wide: false, drawer: false },
)
const emit = defineEmits<{ close: [] }>()
const { label } = useI18n()
const dialog = ref<HTMLDialogElement | null>(null)
let active = true
async function sync(): Promise<void> {
  await nextTick()
  if (props.open && active) {
    if (!dialog.value?.open) dialog.value?.showModal()
  } else dialog.value?.close()
}
function close(): void {
  if (!props.busy) emit('close')
}
function outside(event: MouseEvent): void {
  if (!dialog.value || event.target !== dialog.value) return
  const bounds = dialog.value.getBoundingClientRect()
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    close()
}
watch(() => props.open, sync, { immediate: true })
onActivated(() => {
  active = true
  void sync()
})
onDeactivated(() => {
  active = false
  dialog.value?.close()
})
onBeforeUnmount(() => dialog.value?.close())
</script>
<template>
  <Teleport to="body">
    <dialog
      v-bind="$attrs"
      ref="dialog"
      class="workspace-dialog"
      :class="{ wide, drawer }"
      :aria-label="title"
      :aria-busy="busy"
      @cancel.prevent="close"
      @click="outside"
    >
      <header>
        <slot name="heading">
          <h2>{{ title }}</h2>
        </slot>
        <slot name="actions" />
        <button
          type="button"
          class="workspace-button workspace-button--icon"
          :disabled="busy"
          :aria-label="label('Close', '关闭')"
          @click="close"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </header>
      <div class="dialog-content"><slot /></div>
      <footer v-if="$slots.footer"><slot name="footer" /></footer>
    </dialog>
  </Teleport>
</template>
<style scoped>
.workspace-dialog {
  margin: auto;
  width: min(var(--dialog-width, 520px), calc(100vw - 64px));
  max-height: calc(100vh - 80px);
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-popover);
}
.workspace-dialog.wide {
  width: min(var(--dialog-width, 860px), calc(100vw - 64px));
}
.workspace-dialog.drawer {
  margin: 0 0 0 auto;
  height: 100dvh;
  max-height: 100dvh;
  width: min(var(--dialog-width, 416px), calc(100vw - 64px));
  border-radius: 16px 0 0 16px;
}
.workspace-dialog.drawer[open] {
  animation: drawer-enter var(--motion-detail, 300ms) var(--motion-ease);
}
.workspace-dialog[open] {
  display: flex;
  flex-direction: column;
  animation: dialog-enter var(--motion-popover) var(--motion-ease);
}
.workspace-dialog::backdrop {
  background: color-mix(in srgb, var(--text) 22%, transparent);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
h2 {
  font-size: 18px;
  font-weight: 500;
  margin: 0;
}
header button {
  border-color: transparent;
  background: transparent;
}
.dialog-content {
  min-height: 0;
  overflow: auto;
  padding: 24px;
}
footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 16px 24px;
  border-top: 1px solid var(--border);
  flex: none;
}
@keyframes dialog-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes drawer-enter {
  from {
    opacity: 0;
    transform: translateX(36px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .workspace-dialog[open],
  .workspace-dialog.drawer[open] {
    animation: none;
  }
}
</style>
