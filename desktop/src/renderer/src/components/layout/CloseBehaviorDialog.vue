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

onMounted(() => {
  unsubscribe = window.api.onTrayCloseRequested(() => void showDialog())
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  unsubscribe?.()
  window.removeEventListener('keydown', onKeydown)
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
            <div class="dialog-illustration" aria-hidden="true">
              <span class="illustration-glow"></span>
              <span class="material-symbols-outlined">move_to_inbox</span>
              <span class="status-dot"></span>
            </div>
            <div>
              <span class="dialog-eyebrow">OHMYTOKEN</span>
              <h2 id="close-dialog-title">{{ tr('closeDialogTitle') }}</h2>
              <p>{{ tr('closeDialogSubtitle') }}</p>
            </div>
          </header>

          <div class="choice-grid">
            <button
              ref="backgroundButton"
              class="choice-card background-choice"
              type="button"
              :disabled="resolving"
              @click="resolve('background')"
            >
              <span class="choice-icon">
                <span class="material-symbols-outlined">dock_to_right</span>
              </span>
              <span class="choice-copy">
                <span class="choice-title-row">
                  <strong>{{ tr('backgroundOptionTitle') }}</strong>
                  <small>{{ tr('recommended') }}</small>
                </span>
                <span>{{ tr('backgroundOptionDesc') }}</span>
              </span>
              <span class="choice-arrow material-symbols-outlined">arrow_forward</span>
            </button>

            <button
              class="choice-card quit-choice"
              type="button"
              :disabled="resolving"
              @click="resolve('quit')"
            >
              <span class="choice-icon">
                <span class="material-symbols-outlined">power_settings_new</span>
              </span>
              <span class="choice-copy">
                <strong>{{ tr('quitOptionTitle') }}</strong>
                <span>{{ tr('quitOptionDesc') }}</span>
              </span>
              <span class="choice-arrow material-symbols-outlined">arrow_forward</span>
            </button>
          </div>

          <footer class="dialog-footer">
            <label class="remember-choice">
              <input v-model="remember" type="checkbox" :disabled="resolving" />
              <span class="custom-checkbox">
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

<style scoped>
.close-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1600;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, #020617 72%, transparent);
  backdrop-filter: blur(14px) saturate(0.8);
}

.close-dialog {
  position: relative;
  width: min(560px, 100%);
  overflow: hidden;
  padding: 30px;
  color: var(--text);
  background:
    radial-gradient(
      circle at 12% -8%,
      color-mix(in srgb, var(--primary) 18%, transparent),
      transparent 38%
    ),
    var(--surface-low);
  border: 1px solid color-mix(in srgb, var(--primary) 24%, var(--border));
  border-radius: 22px;
  box-shadow:
    0 30px 90px rgba(2, 6, 23, 0.55),
    inset 0 1px 0 color-mix(in srgb, white 7%, transparent);
}

.close-button {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--text-muted);
  background: color-mix(in srgb, var(--surface-container-high) 70%, transparent);
  border: 1px solid var(--border);
  border-radius: 11px;
}

.close-button:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border-strong);
  transform: translateY(-1px);
}

.close-button .material-symbols-outlined {
  font-size: 19px;
}

.dialog-header {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 18px;
  padding-right: 36px;
}

.dialog-illustration {
  position: relative;
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  color: white;
  background: linear-gradient(145deg, #7c3aed, #4f46e5 58%, #2563eb);
  border: 1px solid color-mix(in srgb, white 18%, transparent);
  border-radius: 19px;
  box-shadow: 0 14px 30px color-mix(in srgb, var(--primary) 30%, transparent);
}

.dialog-illustration > .material-symbols-outlined {
  position: relative;
  z-index: 1;
  font-size: 31px;
}

.illustration-glow {
  position: absolute;
  inset: 7px;
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.22), transparent 58%);
  border-radius: 14px;
}

.status-dot {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 15px;
  height: 15px;
  background: #34d399;
  border: 3px solid var(--surface-low);
  border-radius: 999px;
}

.dialog-eyebrow {
  display: block;
  margin-bottom: 5px;
  color: var(--primary);
  font-size: 10px;
  font-weight: var(--weight-bold);
  letter-spacing: 0.18em;
}

.dialog-header h2 {
  margin: 0;
  color: var(--text);
  font-size: 24px;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.dialog-header p {
  margin: 7px 0 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.choice-grid {
  display: grid;
  gap: 10px;
  margin-top: 26px;
}

.choice-card {
  width: 100%;
  min-height: 86px;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 14px;
  padding: 14px 15px;
  color: var(--text);
  text-align: left;
  background: color-mix(in srgb, var(--surface-container-high) 74%, transparent);
  border: 1px solid var(--border);
  border-radius: 15px;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease;
}

.choice-card:hover:not(:disabled),
.choice-card:focus-visible {
  z-index: 1;
  transform: translateY(-2px);
}

.background-choice:hover:not(:disabled),
.background-choice:focus-visible {
  background: color-mix(in srgb, var(--primary) 11%, var(--surface-container-high));
  border-color: color-mix(in srgb, var(--primary) 56%, var(--border));
  box-shadow: 0 12px 26px color-mix(in srgb, var(--primary) 13%, transparent);
}

.quit-choice:hover:not(:disabled),
.quit-choice:focus-visible {
  background: color-mix(in srgb, #fb7185 8%, var(--surface-container-high));
  border-color: color-mix(in srgb, #fb7185 45%, var(--border));
}

.choice-icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 13%, transparent);
  border-radius: 13px;
}

.quit-choice .choice-icon {
  color: #fb7185;
  background: color-mix(in srgb, #fb7185 11%, transparent);
}

.choice-icon .material-symbols-outlined {
  font-size: 23px;
}

.choice-copy {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.choice-copy strong {
  font-size: 14px;
  font-weight: var(--weight-semibold);
}

.choice-copy > span:last-child {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.choice-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.choice-title-row small {
  padding: 3px 7px;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary) 22%, transparent);
  border-radius: 999px;
  font-size: 10px;
  font-weight: var(--weight-semibold);
}

.choice-arrow {
  color: var(--text-soft);
  font-size: 19px;
  transition: transform 0.18s ease;
}

.choice-card:hover:not(:disabled) .choice-arrow {
  transform: translateX(3px);
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}

.remember-choice {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.remember-choice input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.custom-checkbox {
  width: 19px;
  height: 19px;
  display: grid;
  place-items: center;
  color: transparent;
  background: var(--bg-base);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  transition: all 0.16s ease;
}

.custom-checkbox .material-symbols-outlined {
  font-size: 15px;
  font-weight: 700;
}

.remember-choice input:checked + .custom-checkbox {
  color: white;
  background: var(--primary);
  border-color: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 13%, transparent);
}

.remember-choice input:focus-visible + .custom-checkbox {
  outline: 2px solid color-mix(in srgb, var(--primary) 65%, transparent);
  outline-offset: 2px;
}

.continue-button {
  flex: 0 0 auto;
  min-height: 36px;
  padding: 0 14px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 12px;
  font-weight: var(--weight-semibold);
}

.continue-button:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface-container-high);
  border-color: var(--border-strong);
}

.close-button:disabled,
.choice-card:disabled,
.continue-button:disabled,
.remember-choice:has(input:disabled) {
  cursor: wait;
  opacity: 0.68;
}

.close-dialog-enter-active,
.close-dialog-leave-active {
  transition: opacity 0.2s ease;
}

.close-dialog-enter-active .close-dialog,
.close-dialog-leave-active .close-dialog {
  transition:
    opacity 0.2s ease,
    transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.close-dialog-enter-from,
.close-dialog-leave-to {
  opacity: 0;
}

.close-dialog-enter-from .close-dialog,
.close-dialog-leave-to .close-dialog {
  opacity: 0;
  transform: translateY(10px) scale(0.975);
}

@media (max-width: 620px) {
  .close-dialog-backdrop {
    padding: 14px;
  }

  .close-dialog {
    padding: 24px 18px 20px;
    border-radius: 18px;
  }

  .dialog-header {
    grid-template-columns: 52px minmax(0, 1fr);
    gap: 13px;
    padding-right: 32px;
  }

  .dialog-illustration {
    width: 52px;
    height: 52px;
    border-radius: 15px;
  }

  .dialog-header h2 {
    font-size: 20px;
  }

  .choice-card {
    grid-template-columns: 40px minmax(0, 1fr);
  }

  .choice-icon {
    width: 40px;
    height: 40px;
  }

  .choice-arrow {
    display: none;
  }

  .dialog-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .continue-button {
    width: 100%;
  }
}
</style>
