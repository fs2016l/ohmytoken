import {
  app,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type WebContentsDidStartNavigationEventParams,
} from 'electron'
import { promises as fs, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ReplayStore, replayStorageDirectory } from '../services/replay-storage.service'
import { ReplayLibrary } from '../services/replay-library.service'
import { REPLAY_IPC as IPC } from './replay-channels'
import {
  validReplayExportOptions,
  replayFormat,
  type ReplayBegin,
  type ReplayFailure,
} from '../../shared/replay'

export function registerReplayHandlers(getWindow: () => BrowserWindow | null): void {
  // Called after ready; no Electron paths are evaluated by importing this module.
  let replayLibrary: ReplayLibrary | undefined
  const library = (): ReplayLibrary => {
    if (replayLibrary) return replayLibrary
    const fallback = join(app.getPath('userData'), 'replays')
    const primary = replayStorageDirectory({
      isPackaged: app.isPackaged,
      platform: process.platform,
      execPath: process.execPath,
      userData: app.getPath('userData'),
    })
    let directory = fallback
    let defaultReason: 'development' | 'unwritable-installation' | null = app.isPackaged
      ? null
      : 'development'
    if (primary !== fallback) {
      try {
        mkdirSync(primary, { recursive: true })
        // Windows 目录 ACL 可能误判可写，实际写入一次再删除确认安装目录可用。
        const probe = join(primary, '.write-check')
        writeFileSync(probe, '')
        rmSync(probe, { force: true })
        directory = primary
      } catch {
        // 安装目录不可写（Program Files、只读卷等）时回退 userData。
        defaultReason = 'unwritable-installation'
      }
    }
    return (replayLibrary = new ReplayLibrary({
      defaultDirectory: directory,
      installDirectory:
        process.platform === 'darwin'
          ? dirname(dirname(dirname(process.execPath)))
          : dirname(process.execPath),
      settingsFile: join(app.getPath('userData'), 'replay-storage-location.txt'),
      defaultReason,
    }))
  }
  let active:
    | { id: string; sender: number; target: string; store: ReplayStore; dispose: () => void }
    | undefined
  let choosing = false
  let choosingStorage = false
  function check(event: IpcMainInvokeEvent): void {
    if (event.senderFrame !== event.sender.mainFrame || event.sender !== getWindow()?.webContents)
      throw new Error('Replay requires the main application window')
  }
  function checkJob(event: IpcMainInvokeEvent, id: string): void {
    check(event)
    if (active?.id !== id || active.sender !== event.sender.id) throw new Error('inactive-job')
  }
  async function saveDialog(options: ReplayBegin['options']): Promise<string | undefined> {
    const window = getWindow()
    if (!window) throw new Error('window-closed')
    const format = replayFormat(options)
    const result = await dialog.showSaveDialog(window, {
      title: options.language === 'zh' ? '导出 AI 使用回顾' : 'Export AI usage replay',
      defaultPath: join(
        app.getPath(format.kind === 'video' ? 'videos' : 'pictures'),
        `OhMyToken-${options.from}-${options.to}-${options.dimension}-${options.measure ?? 'tokens'}.${format.extension}`,
      ),
      filters: [
        {
          name: `${format.label} ${format.kind === 'video' ? 'Video' : 'Image'}`,
          extensions: [format.extension],
        },
      ],
    })
    if (result.canceled || !result.filePath) return undefined
    // Do not write one media format under a different extension or silently choose another path.
    if (extname(result.filePath).toLowerCase() !== `.${format.extension}`)
      throw new Error('invalid-extension')
    return result.filePath
  }
  async function copyMedia(id: string, target: string, store: ReplayStore): Promise<void> {
    const temp = join(dirname(target), `.ohmytoken-${randomUUID()}.part`)
    try {
      await fs.copyFile(await store.filePath(id), temp)
      await fs.rename(temp, target)
    } finally {
      await fs.unlink(temp).catch(() => {})
    }
  }
  ipcMain.handle(IPC.REPLAY_LIST, (event) => {
    check(event)
    return library().list()
  })
  ipcMain.handle(IPC.REPLAY_STORAGE_INFO, (event) => {
    check(event)
    return library().info()
  })
  ipcMain.handle(IPC.REPLAY_STORAGE_CHOOSE, async (event) => {
    check(event)
    if (active || choosing || choosingStorage) throw new Error('replay-storage-busy')
    const window = getWindow()
    if (!window) throw new Error('window-closed')
    choosingStorage = true
    try {
      const result = await dialog.showOpenDialog(window, {
        title: '选择生成历史存储文件夹 / Choose replay history folder',
        defaultPath: library().directory,
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || !result.filePaths[0]) return library().info()
      check(event)
      if (active || choosing) throw new Error('replay-storage-busy')
      return library().select(result.filePaths[0])
    } finally {
      choosingStorage = false
    }
  })
  ipcMain.handle(IPC.REPLAY_STORAGE_RESET, (event) => {
    check(event)
    if (active || choosing || choosingStorage) throw new Error('replay-storage-busy')
    return library().select(null)
  })
  ipcMain.handle(IPC.REPLAY_BEGIN, async (event, input: ReplayBegin) => {
    check(event)
    if (active || choosing || choosingStorage) throw new Error('already-generating')
    if (
      !validReplayExportOptions(input?.options) ||
      !Number.isFinite(input.totalTokens) ||
      input.totalTokens < 0 ||
      (input.totalValue !== undefined &&
        (!Number.isFinite(input.totalValue) || input.totalValue < 0))
    )
      throw new Error('invalid-options')
    choosing = true
    try {
      const target = await saveDialog(input.options)
      if (!target) return null
      check(event)
      const store = library().currentStore()
      const job = await store.begin(input)
      const interrupted = (): void => {
        if (active?.id === job.id) {
          active.dispose()
          active = undefined
          void store.cancel(job.id, 'interrupted').catch(() => {})
        }
      }
      const navigating = (details: WebContentsDidStartNavigationEventParams): void => {
        if (details.isMainFrame && !details.isSameDocument) interrupted()
      }
      const dispose = (): void => {
        event.sender.removeListener('destroyed', interrupted)
        event.sender.removeListener('render-process-gone', interrupted)
        event.sender.removeListener('did-start-navigation', navigating)
      }
      active = { id: job.id, sender: event.sender.id, target, store, dispose }
      event.sender.once('destroyed', interrupted)
      event.sender.once('render-process-gone', interrupted)
      event.sender.on('did-start-navigation', navigating)
      return job
    } finally {
      choosing = false
    }
  })
  ipcMain.handle(IPC.REPLAY_WRITE, (event, id: string, position: number, bytes: Uint8Array) => {
    checkJob(event, id)
    return active!.store.write(id, position, bytes)
  })
  ipcMain.handle(IPC.REPLAY_FINISH, async (event, id: string, thumbnail: string) => {
    checkJob(event, id)
    const job = active!
    const target = job.target
    const record = await job.store.finish(id, thumbnail)
    if (active === job) {
      job.dispose()
      active = undefined
    }
    let exported = true
    try {
      await copyMedia(id, target, job.store)
    } catch {
      exported = false
    }
    return { record, exported }
  })
  ipcMain.handle(IPC.REPLAY_CANCEL, async (event, id: string, failure?: ReplayFailure) => {
    checkJob(event, id)
    const job = active!
    const allowed: ReplayFailure[] = [
      'interrupted',
      'encoding',
      'write',
      'unsupported',
      'too-large',
    ]
    try {
      await job.store.cancel(id, allowed.includes(failure!) ? failure : undefined)
    } finally {
      if (active === job) {
        job.dispose()
        active = undefined
      }
    }
  })
  ipcMain.handle(IPC.REPLAY_READ, (event, id: string) => {
    check(event)
    return library()
      .storeFor(id)
      .then((store) => store.read(id))
  })
  ipcMain.handle(IPC.REPLAY_REMOVE, (event, id: string) => {
    check(event)
    return library()
      .storeFor(id)
      .then((store) => store.remove(id))
  })
  ipcMain.handle(IPC.REPLAY_SAVE_COPY, async (event, id: string) => {
    check(event)
    const record = (await library().list()).find(
      (item) => item.id === id && item.status === 'complete',
    )
    if (!record) throw new Error('missing-media')
    const target = await saveDialog(record.options)
    if (!target) return false
    await copyMedia(id, target, await library().storeFor(id))
    return true
  })
  ipcMain.handle(IPC.REPLAY_OPEN_FOLDER, async (event, id?: string) => {
    check(event)
    if (id) shell.showItemInFolder(await (await library().storeFor(id)).filePath(id))
    else {
      await library().currentStore().list()
      const error = await shell.openPath(library().directory)
      if (error) throw new Error('folder-unavailable')
    }
  })
}
