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
import type { ScanWorkProgress } from '../../shared/scan-progress'

export type { ScannerUsageDetails, TokenUsageApiCall, TokenUsageRecord, TokenUsageSession }

export interface ParserWorkerOptions {
  entry: string
  concurrency: number
  execArgv?: string[]
}

export interface ScannerScanContext {
  mode: ScanMode
  /** recent 只读取 Codex 最近一个月的未压缩来源，不自动补全历史。 */
  codexScope?: import('../../shared/codex-scan-scope').CodexScanScope
  storage?: 'session'
  /** 规则升级时合并重读结果，保留来源中已经不存在的历史。 */
  preserveHistory?: boolean
  /** epoch milliseconds；incremental 时为上次成功水位向前回看 5 小时。 */
  sinceMs?: number
  /** 首次扫描只提交近期窗口；窗口前未写过的来源可跳过，由随后的历史补扫读取。 */
  deferHistory?: boolean
  scanStartedAtMs: number
  reportProgress?: (progress: ScanWorkProgress) => void
  /** 重建时任一可读来源失败都中止替换，保留此前的完整结果。 */
  strict?: boolean
  /** 仅由后台扫描调度提供，界面不能指定执行文件。 */
  parserWorkers?: ParserWorkerOptions
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
  /** 返回本轮来源游标；由扫描落库事务与用量数据一起提交。 */
  takeScanStateUpdates?(): import('../services/scan-source-state.service').ScanSourceStateUpdate[]
}
