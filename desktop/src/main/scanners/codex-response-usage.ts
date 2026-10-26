import type { TokenUsageApiCall } from './types'

export interface PendingCodexResponseUsage {
  usageSignature: string
  turnId: string
  call: TokenUsageApiCall
}

/**
 * TokenUsageRecord 在完成响应时先落盘，随后 TokenCount 再发布同一用量快照。
 * 按轮次和互斥前的完整 usage 配对，不能把两个来源相加，也不能只按 usage 去重
 * 不同 response_id 的请求。未匹配项进入检查点，兼容快照跨批次写入。
 */
export class CodexResponseUsage {
  private readonly pending = new Map<string, PendingCodexResponseUsage>()
  private readonly byUsage = new Map<string, Set<string>>()

  constructor(state: readonly PendingCodexResponseUsage[] = []) {
    for (const entry of state) this.add(entry.usageSignature, entry.turnId, { ...entry.call })
  }

  add(usageSignature: string, turnId: string, call: TokenUsageApiCall): void {
    if (this.pending.has(call.apiCallId)) return
    this.pending.set(call.apiCallId, { usageSignature, turnId, call })
    const ids = this.byUsage.get(usageSignature) ?? new Set<string>()
    ids.add(call.apiCallId)
    this.byUsage.set(usageSignature, ids)
  }

  match(usageSignature: string, turnId: string): TokenUsageApiCall | undefined {
    const ids = this.byUsage.get(usageSignature)
    for (const id of ids ?? []) {
      const entry = this.pending.get(id)!
      if (turnId && entry.turnId && entry.turnId !== turnId) continue
      ids!.delete(id)
      if (!ids!.size) this.byUsage.delete(usageSignature)
      this.pending.delete(id)
      return entry.call
    }
    return undefined
  }

  get checkpointComplete(): boolean {
    return this.pending.size <= 64
  }

  snapshot(): PendingCodexResponseUsage[] {
    // 不把整段未配对历史复制进每个检查点。超过上限时标记不可恢复，续写从
    // 更早的完整检查点或文件头重读，仍保留所有原生请求及准确去重。
    return [...this.pending.values()]
      .slice(-64)
      .map((entry) => ({ ...entry, call: { ...entry.call } }))
  }
}
