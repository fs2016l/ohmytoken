<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useBodyScrollLock } from '../../composables/useBodyScrollLock'
import { useI18n } from '../../i18n/useI18n'

type CloseDecision = 'background' | 'quit' | 'cancel'

const { tr } = useI18n()
const open = ref(false)
const remember = ref(false)
const resolving = ref(false)
const backgroundButton = ref<HTMLButtonElement>()
const documentVisible = ref(!document.hidden)
const particleStyles = Array.from({ length: 18 }, (_, index) => ({
  '--particle-x': `${26 + ((index * 37) % 68)}%`,
  '--particle-y': `${15 + ((index * 29) % 69)}%`,
  '--particle-size': `${1.2 + (index % 4) * 0.45}px`,
  '--particle-duration': `${3.2 + (index % 5) * 0.55}s`,
  '--particle-delay': `${-index * 0.67}s`,
}))
let unsubscribe: (() => void) | undefined

useBodyScrollLock(open)

async function showDialog(): Promise<void> {
  remember.value = false
  open.value = true
  await nextTick()
  backgroundButton.value?.focus()
}

async function resolve(decision: CloseDecision): Promise<void> {
  if (!open.value || resolving.value) return
  resolving.value = true
  try {
    const handled = await window.api.resolveTrayClose({
      decision,
      remember: decision === 'cancel' ? false : remember.value,
    })
    if (handled) open.value = false
  } catch (error) {
    console.error('[tray] 处理关闭选择失败:', error)
  } finally {
    resolving.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open.value) void resolve('cancel')
}

function trackBackgroundPointer(event: PointerEvent): void {
  if (resolving.value) return
  const button = event.currentTarget as HTMLButtonElement
  const bounds = button.getBoundingClientRect()
  button.style.setProperty('--choice-pointer-x', `${event.clientX - bounds.left}px`)
  button.style.setProperty('--choice-pointer-y', `${event.clientY - bounds.top}px`)
}

function syncDocumentVisibility(): void {
  documentVisible.value = !document.hidden
}

onMounted(() => {
  unsubscribe = window.api.onTrayCloseRequested(() => void showDialog())
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('visibilitychange', syncDocumentVisibility)
})

onUnmounted(() => {
  unsubscribe?.()
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('visibilitychange', syncDocumentVisibility)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="close-dialog">
      <div v-if="open" class="close-dialog-backdrop" @click.self="resolve('cancel')">
        <section
          class="close-dialog"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="'close-dialog-title'"
        >
          <button
            class="close-button"
            type="button"
            :aria-label="tr('close')"
            :disabled="resolving"
            @click="resolve('cancel')"
          >
            <span class="material-symbols-outlined">close</span>
          </button>

          <header class="dialog-header">
            <span class="dialog-icon material-symbols-outlined" aria-hidden="true">web</span>
            <h2 id="close-dialog-title">{{ tr('closeDialogTitle') }}</h2>
          </header>

          <div class="choice-grid">
            <button
              ref="backgroundButton"
              class="choice-card background-choice"
              type="button"
              :disabled="resolving"
              @pointermove="trackBackgroundPointer"
              @click="resolve('background')"
            >
              <span
                class="choice-particles"
                :class="{ 'motion-paused': !documentVisible || resolving }"
                aria-hidden="true"
              >
                <span
                  v-for="(style, index) in particleStyles"
                  :key="index"
                  class="choice-particle"
                  :style="style"
                ></span>
              </span>
              <span class="choice-spotlight" aria-hidden="true"></span>
              <span class="choice-icon" aria-hidden="true">
                <span class="material-symbols-outlined">dock_to_right</span>
              </span>
              <span class="choice-copy">
                <strong>{{ tr('backgroundOptionTitle') }}</strong>
              </span>
              <span class="choice-arrow material-symbols-outlined" aria-hidden="true">
                north_east
              </span>
            </button>

            <button
              class="choice-card quit-choice"
              type="button"
              :disabled="resolving"
              @click="resolve('quit')"
            >
              <span class="choice-icon" aria-hidden="true">
                <span class="material-symbols-outlined">power_settings_new</span>
              </span>
              <span class="choice-copy">
                <strong>{{ tr('quitOptionTitle') }}</strong>
              </span>
              <span class="choice-arrow material-symbols-outlined" aria-hidden="true">
                north_east
              </span>
            </button>
          </div>

          <footer class="dialog-footer">
            <label class="remember-choice">
              <input v-model="remember" type="checkbox" :disabled="resolving" />
              <span class="custom-checkbox" aria-hidden="true">
                <span class="material-symbols-outlined">check</span>
              </span>
              <span>{{ tr('rememberCloseChoice') }}</span>
            </label>
            <button
              class="continue-button"
              type="button"
              :disabled="resolving"
              @click="resolve('cancel')"
            >
              {{ tr('keepUsingApp') }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="../../styles/close-behavior-dialog.css"></style>
