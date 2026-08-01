/**
 * Scanner 接口（对应 Java AgentScanner.java）
 */
import type {
  ScanMode,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
  TokenUsageSession,
} from '../../shared/models'

export type { ScannerUsageDetails, TokenUsageApiCall, TokenUsageRecord, TokenUsageSession }

export interface ScannerScanContext {
  mode: ScanMode
  /** epoch milliseconds；incremental 时为上次成功水位向前回看 5 小时。 */
  sinceMs?: number
  scanStartedAtMs: number
}

export interface AgentScanner {
  /** Agent 名称 */
  readonly agentName: string
  /** 检测是否安装可用 */
  isAvailable(): boolean
  /** 扫描 token 用量数据 */
  scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]>
  /** 扫描日聚合、会话汇总和 API 轮次明细；未实现时回退 scan() */
  scanDetailed?(context?: ScannerScanContext): Promise<ScannerUsageDetails>
}
