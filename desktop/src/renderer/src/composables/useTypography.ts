import { ref } from 'vue'
import {
  DEFAULT_CODE_FONT,
  DEFAULT_INTERFACE_FONT,
  DEFAULT_NUMBER_FONT,
  isCodeFont,
  isNumberFont,
  isInterfaceFont,
  type CodeFont,
  type InterfaceFont,
  type NumberFont,
} from '../config/typography'

const INTERFACE_STORAGE_KEY = 'app-interface-font'
const CODE_STORAGE_KEY = 'app-code-font'
const NUMBER_STORAGE_KEY = 'app-number-font'
const CHANNEL_NAME = 'app-typography'

type TypographyMessage =
  | { kind: 'interface'; value: InterfaceFont }
  | { kind: 'code'; value: CodeFont }
  | { kind: 'number'; value: NumberFont }

function loadInterfaceFont(): InterfaceFont {
  const stored = localStorage.getItem(INTERFACE_STORAGE_KEY)
  return isInterfaceFont(stored) ? stored : DEFAULT_INTERFACE_FONT
}

function loadCodeFont(): CodeFont {
  const stored = localStorage.getItem(CODE_STORAGE_KEY)
  return isCodeFont(stored) ? stored : DEFAULT_CODE_FONT
}

function loadNumberFont(): NumberFont {
  const stored = localStorage.getItem(NUMBER_STORAGE_KEY)
  return isNumberFont(stored) ? stored : DEFAULT_NUMBER_FONT
}

const currentInterfaceFont = ref<InterfaceFont>(loadInterfaceFont())
const currentCodeFont = ref<CodeFont>(loadCodeFont())
const currentNumberFont = ref<NumberFont>(loadNumberFont())

function syncDocument(): void {
  const root = document.documentElement
  root.dataset.uiFont = currentInterfaceFont.value
  root.dataset.codeFont = currentCodeFont.value
  root.dataset.numberFont = currentNumberFont.value
}

syncDocument()

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)

function applyMessage(message: TypographyMessage): void {
  if (message.kind === 'interface' && isInterfaceFont(message.value)) {
    currentInterfaceFont.value = message.value
  } else if (message.kind === 'code' && isCodeFont(message.value)) {
    currentCodeFont.value = message.value
  } else if (message.kind === 'number' && isNumberFont(message.value)) {
    currentNumberFont.value = message.value
  }
  syncDocument()
}

if (channel) {
  channel.onmessage = (event: MessageEvent<TypographyMessage>) => applyMessage(event.data)
}

window.addEventListener('storage', (event) => {
  if (event.key === INTERFACE_STORAGE_KEY) {
    currentInterfaceFont.value = isInterfaceFont(event.newValue)
      ? event.newValue
      : DEFAULT_INTERFACE_FONT
  } else if (event.key === CODE_STORAGE_KEY) {
    currentCodeFont.value = isCodeFont(event.newValue) ? event.newValue : DEFAULT_CODE_FONT
  } else if (event.key === NUMBER_STORAGE_KEY) {
    currentNumberFont.value = isNumberFont(event.newValue) ? event.newValue : DEFAULT_NUMBER_FONT
  } else {
    return
  }

  syncDocument()
})

function setInterfaceFont(font: InterfaceFont): void {
  if (!isInterfaceFont(font)) return
  currentInterfaceFont.value = font
  syncDocument()
  localStorage.setItem(INTERFACE_STORAGE_KEY, font)
  channel?.postMessage({ kind: 'interface', value: font } satisfies TypographyMessage)
}

function setCodeFont(font: CodeFont): void {
  if (!isCodeFont(font)) return
  currentCodeFont.value = font
  syncDocument()
  localStorage.setItem(CODE_STORAGE_KEY, font)
  channel?.postMessage({ kind: 'code', value: font } satisfies TypographyMessage)
}

function setNumberFont(font: NumberFont): void {
  if (!isNumberFont(font)) return
  currentNumberFont.value = font
  syncDocument()
  localStorage.setItem(NUMBER_STORAGE_KEY, font)
  channel?.postMessage({ kind: 'number', value: font } satisfies TypographyMessage)
}

export function useTypography() {
  return {
    currentInterfaceFont,
    currentCodeFont,
    currentNumberFont,
    setInterfaceFont,
    setCodeFont,
    setNumberFont,
  }
}
