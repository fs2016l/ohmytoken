/**
 * Qoder Scanner（对应 Java QoderScanner.java）
 *
 * 仅检测 Qoder 安装是否存在（%LOCALAPPDATA%/.qoder-cn）。
 * 目录存在但无可靠的 token 解析方式 → scan 返回空数组。
 */
import { existsSync } from 'fs'
import type { AgentScanner, TokenUsageRecord } from './types'
import { getQoderPath } from '../lib/paths'

export class QoderScanner implements AgentScanner {
  readonly agentName = 'qoder'

  isAvailable(): boolean {
    return existsSync(getQoderPath())
  }

  async scan(): Promise<TokenUsageRecord[]> {
    // Qoder 目录存在但无可靠的 token 解析方式
    // 仅检测安装状态（由 isAvailable() 负责），不返回占位记录
    return []
  }
}
