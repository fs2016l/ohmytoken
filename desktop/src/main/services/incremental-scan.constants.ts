/**
 * Persisted scanner contract revision.
 *
 * Revision 3 changes scanner coverage, stable IDs, de-duplication and several token
 * bucket semantics. Every existing installation must rebuild its baseline once.
 */
export const SCANNER_REVISION = 3

/** 只让口径发生变化的 Agent 重建，避免无关来源重复全量扫描。 */
const AGENT_SCANNER_REVISIONS: Readonly<Record<string, number>> = {
  // 回填兼容协议非空推理首输出与原生流段；版本 6 补扫 OPENCODE_DB 与 XDG 根目录。
  // Backfill compact latest-turn usage and native lifecycle evidence once; later scans remain incremental.
  // 版本 8 按 V2 原生 seq 回填无 parentID 的调用归属，并对齐缺省会话标题。
  // 版本 9 按官方数据目录解析相对 OPENCODE_DB。
  opencode: 9,
  // 回填逐 API 估算首字（首个推理或正文的原生开始时间），压缩完成后重新起算；
  // 原生轮级首 Token 仍保留，随后沿用增量检查点。
  // 版本 10 补扫 Codex 自动压缩的 .jsonl.zst 历史日志；版本 11 读取独立原生请求
  // token_usage_record，并替换同一请求的旧 token_count 身份，避免回填时重复累计。
  // 版本 12 补扫迁移后投影边界之前的子 Agent 自有轮次，父线程复制的轮次仍然排除。
  codex: 13,
  // 回填 thinking 首块推导的估算首字与估算流速，并按 custom-title 与桌面端元数据
  // 重建会话标题和侧边会话的父子关系；版本 7 让最近响应缺首字的会话沿用更早一次的首字；
  // 版本 8 用父线程 Agent 结果的末次 usage 补齐旧版子代理转录缺失的最终 output。
  // 版本 9 补扫 CLAUDE_CONFIG_DIR，保留默认目录与原有消息去重。
  // 版本 11 补扫用户级 settings.json 中的 CLAUDE_CONFIG_DIR。
  'claude-code': 11,
  // 回填单次推理的原生首 Token 与流输出计时。
  grok: 6,
  // 从完成助手消息直接回填最新 API，兼容零 decode；不再跨表猜测请求。
  // 版本 8 按 runtime turn_id 及该轮用户消息来源回填对话次数，不改变 Token 计量。
  // 版本 9 从逐次助手历史及压缩快照恢复型号，重新归属历史用量并计算参考费用。
  // 版本 11 补扫桌面端数据目录设置及迁移前目录，仍按原生身份去重。
  'minimax-code': 11,
  // 回填转录父链中原生 API 完成事件提供的生成计时；版本 7 补扫官方运行时覆写。
  qwen: 8,
  // 版本 5 修正 GEMINI_CLI_HOME 语义，并补扫 Seatbelt 运行时及默认历史。
  gemini: 6,
  // 补扫 SQLite 逐消息、压缩事件及归档；保持原消息身份和四个互斥分桶。
  openclaw: 5,
  // 解码不完整或未知编码时保留旧统计，禁止提交部分线程快照。
  zed: 5,
  // 回填 wire 的原生 step 计时；保留响应日志兜底和既有调用身份。
  // 版本 7 按 state.json 的生成/自定义标题回填会话，保留原 Token 计量。
  // 版本 9 保留迁移前默认会话目录，原生调用仍去重。
  'kimi-code': 9,
  // 从已有会话日志补齐生成计时；保留已经采集但原日志已删除的历史。
  'deepseek-harness': 5,
  // 补齐已有逐请求/逐 step 的原生首 Token 延迟和流输出计时；版本 5 按触发请求的用户消息
  // 及其 semantics.origin 回填对话次数，不改变 Token 计量。
  // 版本 7 补扫原生会话数据库覆写，与桌面 dataBaseDir 分开解析。
  zcode: 7,
  // 从桌面端逻辑会话索引及手动重命名回填标题，替换内核中的技能注入提示。
  // 版本 7 兼容先用量后 step.end 的原生计时，并按请求关联响应日志。
  kimiwork: 7,
  // 回填新版带 PID / MODEL_REQUEST 标记、逐调用 messageId 的原生计时。
  // 版本 8 补扫配置根目录覆写及迁移前默认历史。
  workbuddy: 8,
  // 读取助手消息已有的原生单次生成计时，保留会话累计用量口径。
  goose: 5,
  // 按用户明确输入的 USER_INPUT 步骤回填对话次数，不改变 Token 计量。
  antigravity: 5,
  hermes: 4,
}

export function scannerRevisionForAgent(agent: string): number {
  return AGENT_SCANNER_REVISIONS[agent] ?? SCANNER_REVISION
}
