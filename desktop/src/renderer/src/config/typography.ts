export const INTERFACE_FONT_IDS = [
  'system',
  'inter',
  'noto-sans-sc',
  'ibm-plex-sans',
  'source-sans-3',
  'source-han-sans',
  'source-serif-4',
  'source-han-serif',
] as const

export const CODE_FONT_IDS = [
  'system',
  'jetbrains-mono',
  'ibm-plex-mono',
  'source-code-pro',
] as const

export const NUMBER_FONT_IDS = [
  'interface',
  'system-mono',
  'inter',
  'ibm-plex-sans',
  'jetbrains-mono',
  'ibm-plex-mono',
  'source-code-pro',
] as const

export type InterfaceFont = (typeof INTERFACE_FONT_IDS)[number]
export type CodeFont = (typeof CODE_FONT_IDS)[number]
export type NumberFont = (typeof NUMBER_FONT_IDS)[number]

export interface LocalizedFontName {
  en: string
  zh: string
}

export interface FontWeightProfile {
  regular: number
  medium: number
  semibold: number
  display: number
}

export interface FontOption<Id extends string> {
  id: Id
  name: LocalizedFontName
  weights: FontWeightProfile
}

const STANDARD_WEIGHTS: FontWeightProfile = {
  regular: 400,
  medium: 500,
  semibold: 600,
  display: 600,
}

export const DEFAULT_INTERFACE_FONT: InterfaceFont = 'system'
export const DEFAULT_CODE_FONT: CodeFont = 'system'
export const DEFAULT_NUMBER_FONT: NumberFont = 'interface'

export const interfaceFontOptions: readonly FontOption<InterfaceFont>[] = [
  {
    id: 'system',
    name: { en: 'System Sans', zh: '系统默认' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'inter',
    name: { en: 'Inter', zh: 'Inter' },
    weights: { ...STANDARD_WEIGHTS, display: 650 },
  },
  {
    id: 'noto-sans-sc',
    name: { en: 'Noto Sans SC', zh: 'Noto Sans SC' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'ibm-plex-sans',
    name: { en: 'IBM Plex Sans', zh: 'IBM Plex Sans' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'source-sans-3',
    name: { en: 'Source Sans 3', zh: 'Source Sans 3' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'source-han-sans',
    name: { en: 'Source Han Sans SC', zh: '思源黑体' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'source-serif-4',
    name: { en: 'Source Serif 4', zh: 'Source Serif 4' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'source-han-serif',
    name: { en: 'Source Han Serif SC', zh: '思源宋体' },
    weights: STANDARD_WEIGHTS,
  },
]

export const codeFontOptions: readonly FontOption<CodeFont>[] = [
  {
    id: 'system',
    name: { en: 'System Mono', zh: '系统等宽字体' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'jetbrains-mono',
    name: { en: 'JetBrains Mono', zh: 'JetBrains Mono' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'ibm-plex-mono',
    name: { en: 'IBM Plex Mono', zh: 'IBM Plex Mono' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'source-code-pro',
    name: { en: 'Source Code Pro', zh: 'Source Code Pro' },
    weights: STANDARD_WEIGHTS,
  },
]

export const numberFontOptions: readonly FontOption<NumberFont>[] = [
  {
    id: 'interface',
    name: { en: 'Follow interface font', zh: '跟随界面字体' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'system-mono',
    name: { en: 'System Mono', zh: '系统等宽字体' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'inter',
    name: { en: 'Inter', zh: 'Inter' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'ibm-plex-sans',
    name: { en: 'IBM Plex Sans', zh: 'IBM Plex Sans' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'jetbrains-mono',
    name: { en: 'JetBrains Mono', zh: 'JetBrains Mono' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'ibm-plex-mono',
    name: { en: 'IBM Plex Mono', zh: 'IBM Plex Mono' },
    weights: STANDARD_WEIGHTS,
  },
  {
    id: 'source-code-pro',
    name: { en: 'Source Code Pro', zh: 'Source Code Pro' },
    weights: STANDARD_WEIGHTS,
  },
]

export function isInterfaceFont(value: unknown): value is InterfaceFont {
  return INTERFACE_FONT_IDS.includes(value as InterfaceFont)
}

export function isCodeFont(value: unknown): value is CodeFont {
  return CODE_FONT_IDS.includes(value as CodeFont)
}

export function isNumberFont(value: unknown): value is NumberFont {
  return NUMBER_FONT_IDS.includes(value as NumberFont)
}
