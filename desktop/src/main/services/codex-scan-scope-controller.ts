import {
  isCodexScanScope,
  type CodexScanScope,
  type CodexScanScopeRequest,
} from '../../shared/codex-scan-scope'
import type { ScanMode } from '../../shared/models'

interface Dependencies {
  load: () => unknown
  save: (scope: CodexScanScope) => Promise<void> | void
  publish: (request: CodexScanScopeRequest | null) => void
}

/** 所有窗口与自动刷新共用一次选择；关闭对话框时保持已有统计与偏好。 */
export class CodexScanScopeController {
  private scope: CodexScanScope | null | undefined
  private nextId = 1
  private pending?: {
    request: CodexScanScopeRequest
    promise: Promise<CodexScanScope | null>
    resolve: (scope: CodexScanScope | null) => void
  }
  private saving = false
  private readonly dependencies: Dependencies

  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies
  }

  read(): CodexScanScopeRequest | null {
    return this.pending?.request ?? null
  }

  choose(mode: ScanMode): Promise<CodexScanScope | null> {
    if (this.pending) return this.pending.promise
    if (this.scope === undefined) {
      const stored = this.dependencies.load()
      this.scope = isCodexScanScope(stored) ? stored : null
    }
    if (mode !== 'full' && this.scope) return Promise.resolve(this.scope)
    let resolve!: (scope: CodexScanScope | null) => void
    const promise = new Promise<CodexScanScope | null>((done) => {
      resolve = done
    })
    this.pending = { request: { id: this.nextId++, mode }, promise, resolve }
    try {
      this.dependencies.publish(this.pending.request)
    } catch (error) {
      this.pending = undefined
      resolve(null)
      return Promise.reject(error)
    }
    return promise
  }

  async resolve(id: number, scope: CodexScanScope | null): Promise<void> {
    if (scope !== null && !isCodexScanScope(scope)) throw new Error('Invalid Codex scan scope')
    const pending = this.pending
    if (!pending || pending.request.id !== id || this.saving) return
    this.saving = true
    try {
      if (scope !== null) {
        await this.dependencies.save(scope)
        this.scope = scope
      }
      this.pending = undefined
      try {
        this.dependencies.publish(null)
      } finally {
        pending.resolve(scope)
      }
    } finally {
      this.saving = false
    }
  }
}
