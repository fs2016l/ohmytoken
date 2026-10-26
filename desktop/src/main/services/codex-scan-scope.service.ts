import { app, type BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ScanOptions, ScanResult } from '../../shared/models'
import type { CodexScanScopeRequest } from '../../shared/codex-scan-scope'
import { IPC } from '../ipc/channels'
import { isoLocalDateTime } from '../lib/date-utils'
import { CodexScanScopeController } from './codex-scan-scope-controller'
import { performScan } from './scan.service'

let mainWindow: (() => BrowserWindow | null) | undefined
let observedWindow: BrowserWindow | undefined

export function configureCodexScanScope(windowGetter: () => BrowserWindow | null): void {
  mainWindow = windowGetter
}

function publish(request: CodexScanScopeRequest | null): void {
  const window = mainWindow?.()
  if (!window || window.isDestroyed()) {
    if (request) throw new Error('无法打开统计日期选择，请先打开主窗口')
    return
  }
  if (request) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    if (observedWindow !== window) {
      observedWindow = window
      window.once('closed', () => {
        observedWindow = undefined
        const pending = codexScanScope.read()
        if (pending) void codexScanScope.resolve(pending.id, null)
      })
    }
  }
  if (!window.webContents.isDestroyed())
    window.webContents.send(IPC.CODEX_SCAN_SCOPE_CHANGED, request)
}

export const codexScanScope = new CodexScanScopeController({
  load: () => {
    try {
      return JSON.parse(
        readFileSync(join(app.getPath('userData'), 'codex-scan-scope.json'), 'utf8'),
      ).scope
    } catch {
      return null
    }
  },
  save: (scope) => {
    const directory = app.getPath('userData')
    const path = join(directory, 'codex-scan-scope.json')
    mkdirSync(directory, { recursive: true })
    writeFileSync(path + '.tmp', JSON.stringify({ scope }), { mode: 0o600 })
    renameSync(path + '.tmp', path)
  },
  publish,
})

/** 在任何读取/解压开始前选择 Codex 范围，普通增量沿用上次选择。 */
export async function performScopedScan(options: ScanOptions = {}): Promise<ScanResult> {
  const mode = options.mode === 'full' ? 'full' : 'incremental'
  const scope = await codexScanScope.choose(mode)
  if (scope === null)
    return {
      cancelled: true,
      scanTime: isoLocalDateTime(),
      mode,
      totalRecords: 0,
      records: [],
      scannedAgents: [],
      errors: [],
      detectedAgents: [],
    }
  return performScan({ mode, codexScope: scope })
}
