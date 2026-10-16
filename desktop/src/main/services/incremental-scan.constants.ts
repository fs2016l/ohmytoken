/**
 * Persisted scanner contract revision.
 *
 * Revision 3 changes scanner coverage, stable IDs, de-duplication and several token
 * bucket semantics. Every existing installation must rebuild its baseline once.
 */
export const SCANNER_REVISION = 3

/** 只让口径发生变化的 Agent 重建，避免无关来源重复全量扫描。 */
const AGENT_SCANNER_REVISIONS: Readonly<Record<string, number>> = {
  // 回填兼容协议非空推理首输出与原生流段，随后沿用原增量窗口。
  opencode: 5,
  // 回填逐 API 估算首字（首个推理或正文的原生开始时间），压缩完成后重新起算；
  // 原生轮级首 Token 仍保留，随后沿用增量检查点。
  codex: 9,
  // 回填 thinking 首块推导的估算首字与估算流速，并按 custom-title 与桌面端元数据
  // 重建会话标题和侧边会话的父子关系；版本 7 让最近响应缺首字的会话沿用更早一次的首字。
  'claude-code': 7,
  // 回填单次推理的原生首 Token 与流输出计时。
  grok: 5,
  // 从完成助手消息直接回填最新 API，兼容零 decode；不再跨表猜测请求。
  'minimax-code': 7,
  // 回填转录父链中原生 API 完成事件提供的生成计时。
  qwen: 6,
  gemini: 4,
  // 回填 wire 的原生 step 计时；保留响应日志兜底和既有调用身份。
  'kimi-code': 6,
  // 从已有会话日志补齐生成计时；保留已经采集但原日志已删除的历史。
  'deepseek-harness': 4,
  // 补齐已有逐请求/逐 step 的原生首 Token 延迟和流输出计时。
  zcode: 4,
  kimiwork: 4,
  // 回填新版带 PID / MODEL_REQUEST 标记、逐调用 messageId 的原生计时。
  workbuddy: 6,
  // 读取助手消息已有的原生单次生成计时，保留会话累计用量口径。
  goose: 4,
}

export function scannerRevisionForAgent(agent: string): number {
  return AGENT_SCANNER_REVISIONS[agent] ?? SCANNER_REVISION
}
