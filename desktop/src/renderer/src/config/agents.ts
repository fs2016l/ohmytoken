export const agentOrder = [
  'claude-code',
  'codex',
  'minimax-code',
  'opencode',
  'zcode',
  'workbuddy',
  'kimiwork',
] as const

export type KnownAgent = (typeof agentOrder)[number]

export const agentColors: Record<string, string> = {
  'claude-code': '#8b80f9',
  codex: '#f59e0b',
  'minimax-code': '#fb7185',
  opencode: '#34d399',
  zcode: '#22c55e',
  workbuddy: '#f472b6',
  kimiwork: '#60a5fa',
}

export const modelPalette = [
  '#8b80f9',
  '#22d3ee',
  '#34d399',
  '#f59e0b',
  '#f472b6',
  '#64748b',
  '#a78bfa',
  '#6758d9',
  '#fb7185',
] as const

export const agentNames: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'minimax-code': 'MiniMax Code',
  opencode: 'OpenCode',
  zcode: 'Z Code',
  workbuddy: 'WorkBuddy',
  kimiwork: 'KimiWork',
}

export function getAgentName(agent: string): string {
  return agentNames[agent] || agent
}

export function sortAgents(agents: string[]): string[] {
  return [...agents].sort((a, b) => {
    const ai = agentOrder.indexOf(a as KnownAgent)
    const bi = agentOrder.indexOf(b as KnownAgent)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

export function getModelColor(modelName: string, orderedModelNames: string[]): string {
  const index = orderedModelNames.indexOf(modelName)
  if (index >= 0) return modelPalette[index % modelPalette.length]

  const fallbackIndex =
    Math.abs([...modelName].reduce((sum, char) => sum + char.charCodeAt(0), 0)) %
    modelPalette.length
  return modelPalette[fallbackIndex]
}
