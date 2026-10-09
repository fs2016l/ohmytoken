import { BrowserWindow, net, powerMonitor } from 'electron'
import { IPC } from '../ipc/channels'
import { HeartbeatLoop } from './heartbeat-loop'
import { remoteUnavailableMessage } from './remote-availability'
import { getOhmytokenApiBase } from './server-config.service'
import {
  sendDesktopHeartbeat,
  syncDesktopMessages,
  reportDesktopMessageEvent,
} from './desktop-api.service'
import {
  replaceCustomMessageSnapshot,
  listPendingCustomMessageReceipts,
  markCustomMessageReceiptFailed,
  markCustomMessageReceiptSent,
} from './custom-message-storage.service'

let receiptFlush: Promise<void> | null = null
let receiptTimer: ReturnType<typeof setTimeout> | null = null
let started = false

const loop = new HeartbeatLoop({
  heartbeat: () => {
    if (!net.isOnline()) return Promise.reject(new Error('设备当前离线'))
    return sendDesktopHeartbeat()
  },
  synchronize: syncDesktopMessages,
  persist: (snapshot) => {
    replaceCustomMessageSnapshot(snapshot)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.ANNOUNCEMENTS_CHANGED)
    }
  },
  afterHeartbeat: () => queueReceiptFlush(),
  onError: (error) =>
    console.warn(
      `[heartbeat] ${remoteUnavailableMessage(getOhmytokenApiBase(), error)}，五分钟后重试`,
    ),
  now: Date.now,
  schedule: setTimeout,
  cancel: clearTimeout,
})

/** Coalesces delivered/view/click receipts from the main window and floating window. */
export function queueReceiptFlush(): void {
  if (!started || receiptTimer || receiptFlush) return
  receiptTimer = setTimeout(() => {
    receiptTimer = null
    receiptFlush = flushReceipts()
      .catch((error: unknown) => {
        console.warn('[heartbeat] 回执保留在本地，稍后重试:', error)
      })
      .finally(() => {
        receiptFlush = null
      })
  }, 300)
}

async function flushReceipts(): Promise<void> {
  for (const receipt of listPendingCustomMessageReceipts()) {
    if (!started || !net.isOnline()) break
    const result = await reportDesktopMessageEvent(receipt)
    if (result.ok) markCustomMessageReceiptSent(receipt.id)
    else {
      markCustomMessageReceiptFailed(receipt.id, result.message || '回执发送失败')
      break
    }
  }
}

const handleResume = (): void => loop.resume()
const handleSuspend = (): void => loop.suspend()

export function startAgentHeartbeat(): void {
  if (started) return
  started = true
  powerMonitor.on('resume', handleResume)
  powerMonitor.on('suspend', handleSuspend)
  loop.start()
}

export function wakeAgentHeartbeat(identityChanged = false): Promise<void> {
  return loop.wake(identityChanged)
}

export function stopAgentHeartbeat(): void {
  started = false
  loop.stop()
  powerMonitor.removeListener('resume', handleResume)
  powerMonitor.removeListener('suspend', handleSuspend)
  if (receiptTimer) clearTimeout(receiptTimer)
  receiptTimer = null
}
