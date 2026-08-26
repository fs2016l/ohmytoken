/**
 * Scanner 注册表（对应 Java ScanService 的 List<AgentScanner> 自动发现）
 *
 * 顺序与 Java 保持一致，新增 Scanner 只需实现接口并在 allScanners 注册。
 */
import type { AgentScanner } from './types'
import { ClaudeCodeScanner } from './claude-code.scanner'
import { CodexScanner } from './codex.scanner'
import { OpenCodeScanner } from './opencode.scanner'
import { ZCodeScanner } from './zcode.scanner'
import { MiniMaxCodeScanner } from './minimax-code.scanner'
import { KimiWorkScanner } from './kimiwork.scanner'
import { KimiCodeScanner } from './kimi-code.scanner'
import { WorkBuddyScanner } from './workbuddy.scanner'
import { GeminiScanner } from './gemini.scanner'
import { QwenScanner } from './qwen.scanner'
import { OpenClawScanner } from './openclaw.scanner'
import { GrokScanner } from './grok.scanner'
import { ZedScanner } from './zed.scanner'
import { GooseScanner } from './goose.scanner'
import { HermesScanner } from './hermes.scanner'

export { ClaudeCodeScanner } from './claude-code.scanner'
export { CodexScanner } from './codex.scanner'
export { OpenCodeScanner } from './opencode.scanner'
export { ZCodeScanner } from './zcode.scanner'
export { MiniMaxCodeScanner } from './minimax-code.scanner'
export { KimiWorkScanner } from './kimiwork.scanner'
export { KimiCodeScanner } from './kimi-code.scanner'
export { WorkBuddyScanner } from './workbuddy.scanner'
export { GeminiScanner } from './gemini.scanner'
export { QwenScanner } from './qwen.scanner'
export { OpenClawScanner } from './openclaw.scanner'
export { GrokScanner } from './grok.scanner'
export { ZedScanner } from './zed.scanner'
export { GooseScanner } from './goose.scanner'
export { HermesScanner } from './hermes.scanner'
export type { AgentScanner, TokenUsageRecord } from './types'

/** 全部 Scanner 实例（单例），ScanService 遍历此数组执行扫描 */
export const allScanners: AgentScanner[] = [
  new ClaudeCodeScanner(),
  new CodexScanner(),
  new OpenCodeScanner(),
  new ZCodeScanner(),
  new MiniMaxCodeScanner(),
  new KimiWorkScanner(),
  new KimiCodeScanner(),
  new WorkBuddyScanner(),
  new GeminiScanner(),
  new QwenScanner(),
  new OpenClawScanner(),
  new GrokScanner(),
  new ZedScanner(),
  new GooseScanner(),
  new HermesScanner(),
]
