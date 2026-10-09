import { app, dialog, type BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isMonitorPersistentEntry } from '../../shared/network-monitor'
import type {
  MonitorAddApplication,
  MonitorApplicationChoice,
  MonitorCollectorMessage,
  MonitorPlatform,
  MonitorProcess,
  MonitorRule,
  MonitorSettings,
  MonitorSnapshot,
} from '../../shared/network-monitor'
import { NetworkMonitorEngine } from './engine'
import {
  NativeNetworkCollector,
  MonitorCollectorError,
  listNativeProcesses,
} from './native-collector'
import { isSharedRuntime, sameMonitorTarget } from './recognition'
import { loadMonitorSettings, saveMonitorSettings } from './settings'
import { hasControlCharacters } from './validation'

const runFile = promisify(execFile)
export class NetworkMonitorService {
  private settings: MonitorSettings
  private settingsPath: string
  private engine: NetworkMonitorEngine
  private collector?: NativeNetworkCollector
  private timer?: ReturnType<typeof setInterval>
  private starting?: Promise<MonitorSnapshot>
  private stopping?: Promise<MonitorSnapshot>
  private disposed = false
  private choices = new Map<string, MonitorApplicationChoice>()
  private processes: MonitorProcess[] = []
  private processList?: Promise<MonitorProcess[]>
  private changed: (snapshot: MonitorSnapshot) => void
  private observed: () => boolean
  private platform: MonitorPlatform
  private helperPath: string
  constructor(changed: (snapshot: MonitorSnapshot) => void, observed: () => boolean = () => true) {
    this.changed = changed
    this.observed = observed
    this.platform = process.platform === 'darwin' ? 'darwin' : 'win32'
    this.settingsPath = join(app.getPath('userData'), 'network-monitor-settings.json')
    this.settings = loadMonitorSettings(this.settingsPath)
    this.engine = new NetworkMonitorEngine(this.platform, this.settings)
    const root = app.isPackaged ? process.resourcesPath : app.getAppPath()
    this.helperPath =
      this.platform === 'win32'
        ? join(
            root,
            app.isPackaged ? 'network-monitor' : 'resources/network-monitor',
            'win32-x64',
            'ohmytoken-network-monitor.exe',
          )
        : app.isPackaged
          ? join(process.resourcesPath, '..', 'MacOS', 'ohmytoken-network-monitor')
          : join(
              root,
              'resources/network-monitor',
              `darwin-${process.arch}`,
              'ohmytoken-network-monitor',
            )
  }
  snapshot(): MonitorSnapshot {
    return this.engine.snapshot()
  }
  private emit(): MonitorSnapshot {
    const snapshot = this.snapshot()
    this.changed(snapshot)
    return snapshot
  }
  initialize(): void {
    if (this.settings.autoStart) void this.start(false)
  }
  start(allowPrompt = true): Promise<MonitorSnapshot> {
    if (this.starting) return this.starting
    if (this.stopping) return this.stopping.then(() => this.start(allowPrompt))
    if (this.snapshot().state === 'running' || this.disposed)
      return Promise.resolve(this.snapshot())
    this.starting = this.begin(allowPrompt).finally(() => {
      this.starting = undefined
    })
    return this.starting
  }
  private async begin(allowPrompt: boolean): Promise<MonitorSnapshot> {
    this.engine.begin()
    this.emit()
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
      this.engine.fail('unsupported-platform')
      return this.emit()
    }
    const collector = new NativeNetworkCollector({
      platform: this.platform,
      helperPath: this.helperPath,
      message: (message) => this.receive(message),
      failure: (issue) => {
        this.engine.fail(issue)
        this.clearTimer()
        this.emit()
      },
    })
    this.collector = collector
    try {
      await collector.start(allowPrompt)
      if (this.disposed || this.stopping) {
        collector.close()
        return this.snapshot()
      }
      this.timer = setInterval(() => {
        collector.configureFiles(this.engine.fileConfiguration())
        this.engine.sample()
        if (this.observed()) this.emit()
      }, 1000)
      collector.configureFiles(this.engine.fileConfiguration())
      this.timer.unref()
    } catch (error) {
      if (!this.stopping && !this.disposed)
        this.engine.fail(error instanceof MonitorCollectorError ? error.issue : 'collector-failed')
    }
    return this.emit()
  }
  private receive(message: MonitorCollectorMessage): void {
    switch (message.type) {
      case 'ready':
        if (!this.stopping) this.engine.ready(message.startedAt)
        break
      case 'processes':
        this.engine.addProcesses(message.processes)
        break
      case 'exit':
        this.engine.exit(message.key, message.at)
        break
      case 'traffic':
        for (const sample of message.samples) this.engine.traffic(sample)
        break
      case 'files':
        for (const file of message.files) this.engine.fileAccess(message.epoch, file)
        break
      case 'file-status':
        this.engine.fileStatus(message.epoch, message.state, message.issue)
        break
      case 'unattributed':
        this.engine.unattributed(message.gap)
        break
      case 'issue':
        this.engine.issue(message.issue)
        if (this.snapshot().state === 'starting') this.emit()
        break
      case 'stopped':
        this.engine.sample()
        this.engine.stop()
        this.clearTimer()
        this.emit()
        break
    }
  }
  stop(): Promise<MonitorSnapshot> {
    if (this.stopping) return this.stopping
    this.stopping = (async () => {
      if (this.collector) {
        const acknowledged = await this.collector.stop()
        if (!acknowledged && this.snapshot().state === 'running') this.engine.issue('events-lost')
        this.collector = undefined
      }
      this.engine.sample()
      this.engine.stop()
      this.clearTimer()
      return this.emit()
    })().finally(() => {
      this.stopping = undefined
    })
    return this.stopping
  }
  private clearTimer(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }
  dispose(): void {
    this.disposed = true
    this.clearTimer()
    this.collector?.close()
    this.collector = undefined
  }
  private configure(settings: MonitorSettings): MonitorSnapshot {
    saveMonitorSettings(this.settingsPath, settings)
    this.settings = settings
    this.engine.configure(settings)
    this.collector?.configureFiles(this.engine.fileConfiguration())
    return this.emit()
  }
  setAutoStart(value: boolean): MonitorSnapshot {
    if (typeof value !== 'boolean') throw new Error('Invalid preference')
    return this.configure({ ...this.settings, autoStart: value })
  }
  setFileAssociation(value: boolean): MonitorSnapshot {
    if (typeof value !== 'boolean') throw new Error('Invalid preference')
    return this.configure({ ...this.settings, fileAssociation: value })
  }
  updateRule(
    id: string,
    value: { enabled?: boolean; name?: string; descendants?: boolean },
  ): MonitorSnapshot {
    if (!value || typeof value !== 'object') throw new Error('Invalid rule')
    const existing = this.settings.rules.find((row) => row.id === id)
    if (!existing) throw new Error('Unknown rule')
    const rule = { ...existing }
    if (value.enabled !== undefined) {
      if (typeof value.enabled !== 'boolean') throw new Error('Invalid preference')
      rule.enabled = value.enabled
    }
    if (value.name !== undefined) {
      if (
        rule.source !== 'custom' ||
        typeof value.name !== 'string' ||
        !value.name.trim() ||
        value.name.length > 80 ||
        hasControlCharacters(value.name)
      )
        throw new Error('Invalid name')
      rule.name = value.name.trim()
    }
    if (value.descendants !== undefined) {
      if (typeof value.descendants !== 'boolean' || rule.source !== 'custom')
        throw new Error('Invalid preference')
      rule.descendants = value.descendants
    }
    return this.configure({
      ...this.settings,
      rules: this.settings.rules.map((row) => (row.id === id ? rule : row)),
    })
  }
  removeRule(id: string): MonitorSnapshot {
    if (!this.settings.rules.some((row) => row.id === id && row.source === 'custom'))
      throw new Error('Unknown custom rule')
    return this.configure({
      ...this.settings,
      rules: this.settings.rules.filter((row) => row.id !== id),
    })
  }
  async listProcesses(): Promise<MonitorProcess[]> {
    if (!this.processList)
      this.processList = listNativeProcesses(this.helperPath)
        .then((rows) => {
          this.processes = rows
          return rows
        })
        .finally(() => {
          this.processList = undefined
        })
    return this.processList
  }
  async choose(
    window: BrowserWindow,
    language: 'en' | 'zh',
  ): Promise<MonitorApplicationChoice | null> {
    const selected = await dialog.showOpenDialog(window, {
      title: language === 'zh' ? '选择要监测的应用程序' : 'Choose an application to monitor',
      properties: ['openFile', 'dontAddToRecent'],
      ...(this.platform === 'win32'
        ? { filters: [{ name: 'Windows application', extensions: ['exe'] }] }
        : {}),
    })
    if (selected.canceled || !selected.filePaths[0]) return null
    let path = await realpath(selected.filePaths[0])
    let bundleId: string | undefined, bundlePath: string | undefined
    if (this.platform === 'darwin' && path.endsWith('.app')) {
      bundlePath = path
      const plist = join(path, 'Contents', 'Info.plist')
      const [id, exe] = await Promise.all([
        runFile('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist], {
          timeout: 5000,
        }),
        runFile('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist], {
          timeout: 5000,
        }),
      ])
      const executable = exe.stdout.trim()
      if (!executable || /[\\/]/u.test(executable) || hasControlCharacters(executable))
        throw new Error('Invalid application')
      bundleId = id.stdout.trim()
      path = await realpath(join(path, 'Contents', 'MacOS', executable))
      if (!path.startsWith(`${bundlePath}/`)) throw new Error('Invalid application executable')
    }
    const info = await stat(path)
    if (
      !info.isFile() ||
      (this.platform === 'win32' && !/\.exe$/i.test(path)) ||
      (this.platform === 'darwin' && !(info.mode & 0o111))
    )
      throw new Error('Choose an executable application')
    const choice = {
      path,
      name: basename(bundlePath ?? path).replace(/\.(app|exe)$/i, ''),
      bundleId,
      bundlePath,
      sharedRuntime: isSharedRuntime(path),
    }
    if (this.choices.size >= 100) this.choices.clear()
    this.choices.set(path, choice)
    return choice
  }
  add(input: MonitorAddApplication): MonitorSnapshot {
    if (
      !input ||
      typeof input !== 'object' ||
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 80 ||
      hasControlCharacters(input.name) ||
      typeof input.descendants !== 'boolean'
    )
      throw new Error('Invalid application')
    const instance = input.instanceKey
      ? this.processes.find((row) => row.key === input.instanceKey)
      : undefined
    const choice = instance
      ? {
          path: instance.path,
          bundleId: instance.bundleId,
          bundlePath: instance.bundlePath,
          sharedRuntime: isSharedRuntime(instance.path),
        }
      : this.choices.get(input.path)
    if (!choice || (input.instanceKey && !instance)) throw new Error('Select the application again')
    const rule: MonitorRule = {
      id: `custom:${randomUUID()}`,
      name: input.name.trim(),
      source: 'custom',
      enabled: true,
      executable: choice.path,
      bundleId: choice.bundleId,
      bundlePath: choice.bundlePath,
      descendants: input.descendants,
    }
    if (choice.sharedRuntime) {
      if (!instance) throw new Error('Select a running script instead of a shared runtime')
      if (isMonitorPersistentEntry(instance.entryPoint)) rule.entryPoint = instance.entryPoint
      else rule.instanceKey = instance.key
    }
    const existing = this.settings.rules.find(
      (row) => row.source === 'custom' && sameMonitorTarget(row, rule, this.platform),
    )
    if (!existing && this.settings.rules.length >= 200) throw new Error('Application limit reached')
    return this.configure({
      ...this.settings,
      rules: existing
        ? this.settings.rules.map((row) => (row === existing ? { ...rule, id: existing.id } : row))
        : [...this.settings.rules, rule],
    })
  }
}
