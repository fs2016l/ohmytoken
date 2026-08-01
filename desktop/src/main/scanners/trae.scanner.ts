/**
 * Trae Scanner（对应 Java TraeScanner.java）
 *
 * 仅检测 Trae 安装是否存在（%APPDATA%/Trae CN）。
 * Trae 数据库可能被运行中的应用锁定，且无可靠的 token 解析方式 → scan 返回空数组。
 */
import { existsSync } from 'fs'
import type { AgentScanner, TokenUsageRecord } from './types'
import { getTraePath } from '../lib/paths'

export class TraeScanner implements AgentScanner {
  readonly agentName = 'trae'

  isAvailable(): boolean {
    return existsSync(getTraePath())
  }

  async scan(): Promise<TokenUsageRecord[]> {
    // Trae 数据库可能被运行中的应用锁定，且无可靠的 token 解析方式
    // 仅检测安装状态（由 isAvailable() 负责），不返回占位记录
    return []
  }
}
