/** Antigravity 2.x 本地用量元数据；只解码统计与计时字段，不保留消息内容。 */
export interface AntigravityUsage {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  thinkingTokens: number
  responseTokens?: number
  modelEnum?: number
  messageId?: string
  responseId?: string
  providerMessageId?: string
}

export interface AntigravityChatMetadata {
  usage?: AntigravityUsage
  modelEnum?: number
  responseModel?: string
  displayName?: string
  startedAtMs?: number
  timeToFirstTokenMs?: number
  streamDurationMs?: number
}

export interface AntigravityGeneration extends AntigravityChatMetadata {
  stepIndices: number[]
}

export interface AntigravityStepMetadata {
  createdAtMs?: number
  firstTokenAtMs?: number
  finishedAtMs?: number
  completedAtMs?: number
  usage?: AntigravityUsage
  modelEnum?: number
  /** step 来源枚举：本机数据中 2 为模型、4 为用户明确输入、5 为系统，与 transcript 的 source 一一对应。 */
  source?: number
  /** step 带工具调用；其参数整块下发，原生流窗口不覆盖这部分输出生成。 */
  toolCall?: true
}

export const ANTIGRAVITY_USER_EXPLICIT_SOURCE = 4

type Field = { number: number; wire: number; value?: bigint; bytes?: Uint8Array }

class WireReader {
  private offset = 0
  private readonly data: Uint8Array

  constructor(data: Uint8Array) {
    this.data = data
  }

  get done(): boolean {
    return this.offset === this.data.length
  }

  varint(): bigint {
    let value = 0n
    for (let index = 0; index < 10; index++) {
      if (this.offset >= this.data.length) throw new Error('截断的 protobuf varint')
      const byte = this.data[this.offset++]
      if (index === 9 && byte > 1) throw new Error('protobuf varint 超出 uint64')
      value |= BigInt(byte & 0x7f) << BigInt(index * 7)
      if (byte < 0x80) return value
    }
    throw new Error('无效的 protobuf varint')
  }

  field(): Field {
    const tag = safeNumber(this.varint())
    const number = Math.floor(tag / 8)
    const wire = tag % 8
    if (number < 1 || number > 0x1fffffff) throw new Error('无效的 protobuf field number')
    if (wire === 0) return { number, wire, value: this.varint() }
    if (wire === 2) {
      const length = safeNumber(this.varint())
      const end = this.offset + length
      if (end > this.data.length) throw new Error('截断的 protobuf message')
      const bytes = this.data.subarray(this.offset, end)
      this.offset = end
      return { number, wire, bytes }
    }
    if (wire === 1 || wire === 5) {
      this.offset += wire === 1 ? 8 : 4
      if (this.offset > this.data.length) throw new Error('截断的 protobuf fixed field')
      return { number, wire }
    }
    throw new Error(`不支持的 protobuf wire type: ${wire}`)
  }
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('protobuf 数值超出安全整数')
  return Number(value)
}

function* fields(data: Uint8Array): Generator<Field> {
  const reader = new WireReader(data)
  while (!reader.done) yield reader.field()
}

function scalar(field: Field): number | undefined {
  if (field.wire !== 0 || field.value === undefined)
    throw new Error(`protobuf 字段 ${field.number} 应为 varint`)
  return safeNumber(field.value)
}

function modelText(field: Field): string | undefined {
  if (!field.bytes || field.bytes.length > 256) return undefined
  const text = Buffer.from(field.bytes).toString('utf8').trim()
  return text && !/\p{Cc}/u.test(text) && !text.includes('\ufffd') ? text : undefined
}

/** Timestamp 和 Duration 都由 seconds/nanos 组成；负时长与异常纳秒不参与统计。 */
function secondsAndNanos(data: Uint8Array): number | undefined {
  let seconds = 0n
  let nanos = 0n
  for (const field of fields(data)) {
    if ([1, 2].includes(field.number) && field.wire !== 0)
      throw new Error(`protobuf 时间字段 ${field.number} 应为 varint`)
    if (field.wire !== 0 || field.value === undefined) continue
    if (field.number === 1) seconds = BigInt.asIntN(64, field.value)
    if (field.number === 2) nanos = BigInt.asIntN(32, field.value)
  }
  if (seconds < 0n || nanos < 0n || nanos >= 1_000_000_000n) return undefined
  const millis = Number(seconds) * 1000 + Number(nanos) / 1_000_000
  return Number.isFinite(millis) && millis >= 0 && millis <= Number.MAX_SAFE_INTEGER
    ? millis
    : undefined
}

function timestamp(data: Uint8Array): number | undefined {
  const value = secondsAndNanos(data)
  return value !== undefined && value > 0 && value <= 8_640_000_000_000_000
    ? Math.trunc(value)
    : undefined
}

export function decodeAntigravityUsage(data: Uint8Array): AntigravityUsage {
  const usage: AntigravityUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    thinkingTokens: 0,
  }
  for (const field of fields(data)) {
    if ([7, 11, 12].includes(field.number)) {
      if (field.wire !== 2) throw new Error(`protobuf 用量身份字段 ${field.number} 应为 string`)
      const value = modelText(field)
      if (field.number === 7) usage.messageId = value
      if (field.number === 11) usage.responseId = value
      if (field.number === 12) usage.providerMessageId = value
      continue
    }
    if (![1, 2, 3, 4, 5, 9, 10].includes(field.number)) continue
    const value = scalar(field)
    if (value === undefined) continue
    // #1 是 Model enum，输入用量只有 #2，不能把枚举值作为 system prompt。
    if (field.number === 1) usage.modelEnum = value
    if (field.number === 2) usage.inputTokens = value
    if (field.number === 3) usage.outputTokens = value
    if (field.number === 4) usage.cacheWriteTokens = value
    if (field.number === 5) usage.cacheReadTokens = value
    if (field.number === 9) usage.thinkingTokens = value
    if (field.number === 10) usage.responseTokens = value
  }
  return usage
}

export function hasUsage(usage: AntigravityUsage | undefined): boolean {
  return (
    !!usage &&
    usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens > 0
  )
}

export function sameUsage(a: AntigravityUsage, b: AntigravityUsage): boolean {
  return (
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.cacheReadTokens === b.cacheReadTokens &&
    a.cacheWriteTokens === b.cacheWriteTokens &&
    a.thinkingTokens === b.thinkingTokens &&
    (a.responseTokens === undefined ||
      b.responseTokens === undefined ||
      a.responseTokens === b.responseTokens)
  )
}

export function inconsistentBuckets(usage: AntigravityUsage): boolean {
  return (
    usage.thinkingTokens > usage.outputTokens ||
    (usage.responseTokens !== undefined &&
      usage.responseTokens !==
        usage.outputTokens - Math.min(usage.outputTokens, usage.thinkingTokens))
  )
}

export function usageIdentity(usage: AntigravityUsage | undefined): string | undefined {
  if (usage?.responseId) return `response:${usage.responseId}`
  if (usage?.providerMessageId) return `provider-message:${usage.providerMessageId}`
  if (usage?.messageId) return `message:${usage.messageId}`
  return undefined
}

function decodeChatMetadata(data: Uint8Array): AntigravityChatMetadata {
  const result: AntigravityChatMetadata = {}
  for (const field of fields(data)) {
    if ([4, 9, 11, 12, 19, 21, 22].includes(field.number) && field.wire !== 2)
      throw new Error(`protobuf chat 字段 ${field.number} 应为 message/string`)
    if (field.number === 3) result.modelEnum = scalar(field)
    if (field.number === 4 && field.bytes) result.usage = decodeAntigravityUsage(field.bytes)
    if (field.number === 9 && field.bytes) {
      for (const start of fields(field.bytes)) {
        if (start.number === 4 && start.bytes) result.startedAtMs = timestamp(start.bytes)
      }
    }
    if (field.number === 11 && field.bytes) result.timeToFirstTokenMs = secondsAndNanos(field.bytes)
    if (field.number === 12 && field.bytes) result.streamDurationMs = secondsAndNanos(field.bytes)
    if (field.number === 19) result.responseModel = modelText(field)
    if (field.number === 21) result.displayName = modelText(field)
    if (field.number === 22 && !result.responseModel) result.responseModel = modelText(field)
  }
  return result
}

export function decodeAntigravityGeneration(data: Uint8Array): AntigravityGeneration {
  const result: AntigravityGeneration = { stepIndices: [] }
  for (const field of fields(data)) {
    if (field.number === 1 && field.wire !== 2) throw new Error('protobuf chat_model 应为 message')
    if (field.number === 1 && field.bytes) Object.assign(result, decodeChatMetadata(field.bytes))
    if (field.number !== 2) continue
    if (field.wire === 0) {
      const value = scalar(field)
      if (value !== undefined) result.stepIndices.push(value)
    } else if (field.wire === 2 && field.bytes) {
      const reader = new WireReader(field.bytes)
      while (!reader.done) result.stepIndices.push(safeNumber(reader.varint()))
    } else {
      throw new Error('protobuf step_indices 应为 uint32 或 packed uint32')
    }
  }
  result.stepIndices = [...new Set(result.stepIndices)]
  return result
}

export function decodeAntigravityStepMetadata(data: Uint8Array): AntigravityStepMetadata {
  const result: AntigravityStepMetadata = {}
  for (const field of fields(data)) {
    if ([1, 4, 6, 7, 8, 9].includes(field.number) && field.wire !== 2)
      throw new Error(`protobuf step 字段 ${field.number} 应为 message`)
    if (field.bytes) {
      // #4 是工具调用（调用 ID、工具名、参数）；只记录存在与否，不解码参数内容。
      if (field.number === 4) result.toolCall = true
      if (field.number === 1) result.createdAtMs = timestamp(field.bytes)
      if (field.number === 6) result.firstTokenAtMs = timestamp(field.bytes)
      if (field.number === 7) result.finishedAtMs = timestamp(field.bytes)
      if (field.number === 8) result.completedAtMs = timestamp(field.bytes)
      if (field.number === 9) result.usage = decodeAntigravityUsage(field.bytes)
    }
    if (field.number === 11) result.modelEnum = scalar(field)
    // 来源字段是由本机数据核对得到的，类型不符时只放弃轮次依据，不让整段用量不可读。
    if (field.number === 3 && field.wire === 0) result.source = scalar(field)
  }
  return result
}
