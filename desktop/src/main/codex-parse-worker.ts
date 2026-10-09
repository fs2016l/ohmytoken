import { parentPort } from 'node:worker_threads'
import { CodexScanner } from './scanners/codex.scanner'
import type { CodexParseRequest, CodexParseReply } from './scanners/codex-parse-pool'

if (!parentPort) throw new Error('日志解析线程缺少通信端口')
const port = parentPort
port.on('message', (request: CodexParseRequest) => {
  let reply: CodexParseReply
  try {
    const parser = new CodexScanner(request.state ? [request.state] : [])
    const session = parser.parseRolloutWithCursor(request.file, request.context)
    reply = {
      index: request.index,
      result: { session, sourceStates: parser.takeScanStateUpdates() },
    }
  } catch (error) {
    reply = { index: request.index, error: error instanceof Error ? error.message : String(error) }
  }
  port.postMessage(reply)
})
