import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { existsSync } from 'node:fs'
import type {
  MonitorCollectorMessage,
  MonitorIssue,
  MonitorPlatform,
  MonitorProcess,
} from '../../shared/network-monitor'
import { MonitorMessageReader } from './protocol'

export class MonitorCollectorError extends Error {
  issue: MonitorIssue
  constructor(issue: MonitorIssue) {
    super(issue)
    this.issue = issue
  }
}
interface CollectorOptions {
  platform: MonitorPlatform
  helperPath: string
  message: (message: MonitorCollectorMessage) => void
  failure: (issue: MonitorIssue) => void
}

export class NativeNetworkCollector {
  private options: CollectorOptions
  private child?: ChildProcessWithoutNullStreams
  private socket?: Socket
  private heartbeat?: ReturnType<typeof setInterval>
  private timer?: ReturnType<typeof setTimeout>
  private stopping = false
  private ready = false
  private epoch = 0
  private rejectStart?: (error: Error) => void
  private finishStop?: (acknowledged: boolean) => void
  private fileCommand = ''
  private fileAck?: { epoch: number; timer: ReturnType<typeof setTimeout> }
  constructor(options: CollectorOptions) {
    this.options = options
  }

  async start(allowPrompt: boolean): Promise<void> {
    if (!existsSync(this.options.helperPath))
      throw new MonitorCollectorError(
        this.options.platform === 'darwin' ? 'extension-required' : 'collector-missing',
      )
    this.stopping = false
    this.ready = false
    this.fileCommand = ''
    const epoch = ++this.epoch
    const session = randomBytes(16).toString('hex')
    return new Promise((resolve, reject) => {
      this.rejectStart = reject
      const fail = (issue: MonitorIssue): void => {
        if (this.epoch !== epoch || this.stopping) return
        const running = this.ready
        this.rejectStart = undefined
        this.close()
        if (running) this.options.failure(issue)
        else reject(new MonitorCollectorError(issue))
      }
      const reader = new MonitorMessageReader((message) => {
        if (epoch !== this.epoch) return
        if (message.type === 'file-status' && message.epoch === this.fileAck?.epoch) {
          clearTimeout(this.fileAck.timer)
          this.fileAck = undefined
        }
        if (message.type === 'ready' && !this.stopping) {
          if (this.ready) return
          this.ready = true
          clearTimeout(this.timer)
          this.timer = undefined
          this.rejectStart = undefined
          resolve()
        }
        this.options.message(message)
        if (message.type === 'stopped') {
          this.finishStop?.(true)
          this.finishStop = undefined
          this.close()
        }
        if (
          message.type === 'issue' &&
          [
            'permission-required',
            'permission-denied',
            'extension-required',
            'collector-failed',
          ].includes(message.issue)
        )
          fail(message.issue)
      })
      const data = (chunk: string): void => {
        try {
          reader.push(chunk)
        } catch {
          fail('collector-failed')
        }
      }
      const args =
        this.options.platform === 'win32'
          ? [
              '--session',
              session,
              '--parent',
              String(process.pid),
              allowPrompt ? '--allow-elevation' : '--no-elevation',
            ]
          : [
              '--monitor',
              '--parent',
              String(process.pid),
              allowPrompt ? '--allow-activation' : '--no-activation',
            ]
      const child = spawn(this.options.helperPath, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      })
      this.child = child
      // The macOS bridge also watches its parent while the user is approving
      // activation. Keep it alive before the collector becomes ready.
      this.heartbeat = setInterval(() => this.send('ping'), 2000)
      this.heartbeat.unref()
      child.stdout.setEncoding('utf8')
      if (this.options.platform === 'darwin') child.stdout.on('data', data)
      else child.stdout.resume()
      // Native errors are mapped to stable issue codes. No command lines, keys,
      // packet data, or unsanitized helper output enter logs or the renderer.
      child.stderr.resume()
      child.on('error', () => fail('collector-failed'))
      child.stdin.on('error', () => {
        if (this.options.platform === 'darwin') fail('collector-failed')
      })
      child.once('exit', (code) => {
        if (epoch !== this.epoch || this.stopping) return
        if (code === 41) fail('permission-required')
        else if (code === 42) fail('permission-denied')
        else if (code !== 0 || this.options.platform === 'darwin') fail('collector-failed')
        // The Windows unelevated launcher exits after handing off to its helper.
      })
      this.timer = setTimeout(() => fail('collector-failed'), allowPrompt ? 90000 : 15000)
      this.timer.unref()
      if (this.options.platform === 'win32') {
        const connect = (): void => {
          if (epoch !== this.epoch || this.stopping) return
          const socket = createConnection(`\\\\.\\pipe\\ohmytoken-network-${session}`)
          this.socket = socket
          let connected = false
          socket.setEncoding('utf8')
          socket.once('connect', () => {
            connected = true
          })
          socket.on('data', data)
          socket.on('error', (error) => {
            if (epoch !== this.epoch || this.stopping) return
            const code = (error as NodeJS.ErrnoException).code
            if (!connected && ['ENOENT', 'ECONNREFUSED', 'EBUSY'].includes(code ?? '')) {
              const retry = setTimeout(connect, 150)
              retry.unref()
            } else fail('collector-failed')
          })
          socket.once('close', () => {
            if (connected && !this.stopping) fail('collector-failed')
          })
        }
        connect()
      }
    })
  }
  configureFiles(configuration: {
    epoch: number
    enabled: boolean
    targets: Array<{ key: string; descendants: boolean }>
  }): void {
    if (!this.ready || this.stopping) return
    // The current macOS bundle has a network extension only. Never send the
    // Windows file command to that bridge or imply it can observe file access.
    if (this.options.platform === 'darwin') {
      const command = `unsupported-files:${configuration.epoch}:${configuration.enabled}`
      if (command !== this.fileCommand) {
        this.fileCommand = command
        this.options.message({
          type: 'file-status',
          epoch: configuration.epoch,
          state: configuration.enabled ? 'unavailable' : 'off',
        })
      }
      return
    }
    const targets = configuration.targets
      .map((row) => `${row.key}${row.descendants ? '+' : '-'}`)
      .sort()
    const command = `files ${configuration.epoch} ${configuration.enabled ? 'on' : 'off'} ${targets.join(' ')}`
    if (command === this.fileCommand) return
    this.fileCommand = command
    if (command.length > 1024 * 1024) {
      this.options.message({
        type: 'file-status',
        epoch: configuration.epoch,
        state: 'unavailable',
        issue: 'capacity-reached',
      })
      return
    }
    if (this.fileAck?.epoch !== configuration.epoch) {
      clearTimeout(this.fileAck?.timer)
      const timer = setTimeout(() => {
        this.fileAck = undefined
        this.options.message({
          type: 'file-status',
          epoch: configuration.epoch,
          state: configuration.enabled ? 'unavailable' : 'off',
        })
      }, 5000)
      timer.unref()
      this.fileAck = { epoch: configuration.epoch, timer }
    }
    this.send(command)
  }
  private send(command: string): void {
    const stream = this.options.platform === 'win32' ? this.socket : this.child?.stdin
    if (stream?.writable && !stream.destroyed) stream.write(`${command}\n`)
  }
  stop(): Promise<boolean> {
    this.stopping = true
    this.send('stop')
    this.rejectStart?.(new MonitorCollectorError('collector-failed'))
    this.rejectStart = undefined
    clearTimeout(this.timer)
    this.timer = undefined
    clearInterval(this.heartbeat)
    this.heartbeat = undefined
    // Closing the local channel also makes a privileged helper exit if the app
    // is quitting before the graceful stop acknowledgement arrives.
    return new Promise((resolve) => {
      this.finishStop = resolve
      const epoch = this.epoch
      const timeout = setTimeout(() => {
        if (epoch === this.epoch) this.close()
      }, 4000)
      timeout.unref()
    })
  }
  close(): void {
    this.stopping = true
    this.epoch++
    clearTimeout(this.fileAck?.timer)
    this.fileAck = undefined
    clearTimeout(this.timer)
    clearInterval(this.heartbeat)
    this.socket?.destroy()
    this.child?.stdin.destroy()
    this.socket = undefined
    this.child = undefined
    this.timer = undefined
    this.heartbeat = undefined
    this.finishStop?.(false)
    this.finishStop = undefined
    this.rejectStart?.(new MonitorCollectorError('collector-failed'))
    this.rejectStart = undefined
  }
}

export async function listNativeProcesses(helperPath: string): Promise<MonitorProcess[]> {
  if (!existsSync(helperPath)) throw new MonitorCollectorError('collector-missing')
  return new Promise((resolve, reject) => {
    const rows: MonitorProcess[] = []
    let bytes = 0,
      failed = false
    const child = spawn(helperPath, ['--list'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    const finish = (error?: Error): void => {
      if (failed) return
      failed = true
      clearTimeout(timeout)
      if (error) {
        child.kill()
        reject(error)
      } else resolve(rows)
    }
    const reader = new MonitorMessageReader((message) => {
      if (message.type === 'processes') rows.push(...message.processes)
      if (rows.length > 20000) throw new Error('Process limit exceeded')
    })
    const timeout = setTimeout(() => finish(new MonitorCollectorError('collector-failed')), 15000)
    timeout.unref()
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      bytes += chunk.length
      try {
        if (bytes > 16 * 1024 * 1024) throw new Error('Process list too large')
        reader.push(chunk)
      } catch {
        finish(new MonitorCollectorError('collector-failed'))
      }
    })
    child.stderr.resume()
    child.once('error', () => finish(new MonitorCollectorError('collector-failed')))
    child.once('close', (code) =>
      finish(code === 0 ? undefined : new MonitorCollectorError('collector-failed')),
    )
  })
}
