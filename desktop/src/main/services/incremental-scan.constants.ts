/**
 * Persisted scanner contract revision.
 *
 * Revision 3 changes scanner coverage, stable IDs, de-duplication and several token
 * bucket semantics. Every existing installation must rebuild its baseline once.
 */
export const SCANNER_REVISION = 3

/** 只让口径发生变化的 Agent 重建，避免无关来源重复全量扫描。 */
const AGENT_SCANNER_REVISIONS: Readonly<Record<string, number>> = {
  codex: 5,
  'minimax-code': 4,
  qwen: 4,
}

export function scannerRevisionForAgent(agent: string): number {
  return AGENT_SCANNER_REVISIONS[agent] ?? SCANNER_REVISION
}
