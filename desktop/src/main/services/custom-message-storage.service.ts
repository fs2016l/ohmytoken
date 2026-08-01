import type {
  CustomMessageData,
  CustomMessageEvent,
  CustomMessagePlacement,
  CustomMessageReceipt,
} from '../../shared/custom-message'
import { openDatabase } from './sqlite-storage.service'

const DEFAULT_DURATION_SECONDS = 8
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000
const INACTIVE_MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_STORED_MESSAGES = 2_000
const MAX_PENDING_RECEIPTS = 5_000
const MAX_RECEIPT_ATTEMPTS = 20
let lastMaintenanceAt = 0

function maintainStorage(now = Date.now()): void {
  if (now - lastMaintenanceAt < MAINTENANCE_INTERVAL_MS) return
  lastMaintenanceAt = now
  const db = openDatabase()
  db.transaction(() => {
    db.prepare('DELETE FROM custom_message_receipts WHERE created_at < ? OR attempts >= ?').run(
      now - RECEIPT_RETENTION_MS,
      MAX_RECEIPT_ATTEMPTS,
    )
    db.prepare(
      'DELETE FROM custom_message_receipts WHERE id NOT IN (' +
        'SELECT id FROM custom_message_receipts ORDER BY id DESC LIMIT ?)',
    ).run(MAX_PENDING_RECEIPTS)
    db.prepare('DELETE FROM custom_messages WHERE active = 0 AND updated_at < ?').run(
      now - INACTIVE_MESSAGE_RETENTION_MS,
    )
    db.prepare(
      'DELETE FROM custom_messages WHERE active = 0 AND message_uid NOT IN (' +
        'SELECT message_uid FROM custom_messages ORDER BY updated_at DESC LIMIT ?)',
    ).run(MAX_STORED_MESSAGES)
  })()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizeImages(value: unknown): CustomMessageData['images'] {
  if (!Array.isArray(value)) return []
  const result: CustomMessageData['images'] = []
  const ids = new Set<number>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const input = entry as Record<string, unknown>
    const id = Number(input.id)
    const imageUrl = optionalString(input.imageUrl)
    if (!Number.isSafeInteger(id) || id <= 0 || !imageUrl || ids.has(id)) continue
    ids.add(id)
    result.push({ id, imageUrl, actionUrl: optionalString(input.actionUrl) })
  }
  return result
}

function normalizeMessage(value: unknown): CustomMessageData | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const id = Number(input.id)
  const messageUid = optionalString(input.messageUid)
  const titleZh = optionalString(input.titleZh)
  const contentZh = optionalString(input.contentZh)
  if (!Number.isSafeInteger(id) || id <= 0 || !messageUid || !titleZh || !contentZh) return null

  const scopeValue = optionalString(input.displayScope)
  const displayScope: CustomMessageData['displayScope'] =
    scopeValue === 'main' || scopeValue === 'floating' || scopeValue === 'both'
      ? scopeValue
      : 'both'
  const levelValue = optionalString(input.level)
  const level: CustomMessageData['level'] =
    levelValue === 'success' ||
    levelValue === 'warning' ||
    levelValue === 'important' ||
    levelValue === 'info'
      ? levelValue
      : 'info'
  const priority = Number(input.priority)
  const duration = Number(input.displayDurationSeconds)
  return {
    id,
    messageUid,
    status: 'published',
    titleZh,
    titleEn: optionalString(input.titleEn),
    contentZh,
    contentEn: optionalString(input.contentEn),
    level,
    displayScope,
    showInNotificationCenter: input.showInNotificationCenter !== false,
    images: normalizeImages(input.images),
    priority: Number.isFinite(priority) ? priority : 0,
    displayDurationSeconds: Number.isFinite(duration) ? duration : DEFAULT_DURATION_SECONDS,
    startAt: optionalString(input.startAt),
    endAt: optionalString(input.endAt),
    pushedAt: optionalString(input.pushedAt),
    createTime: optionalString(input.createTime),
    updateTime: optionalString(input.updateTime),
  }
}

export function cacheCustomMessages(
  values: unknown[],
  placement: CustomMessagePlacement,
): CustomMessageData[] {
  maintainStorage()
  const db = openDatabase()
  const messages = values.map(normalizeMessage).filter((item): item is CustomMessageData => !!item)
  const now = Date.now()
  const deactivateOlder = db.prepare(
    'UPDATE custom_messages SET active = 0, updated_at = ? WHERE message_id = ? AND message_uid <> ?',
  )
  const upsert = db.prepare(`
    INSERT INTO custom_messages
      (message_uid, message_id, display_scope, active, received_at, updated_at, raw_data)
    VALUES (?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(message_uid) DO UPDATE SET
      message_id = excluded.message_id,
      display_scope = excluded.display_scope,
      active = 1,
      updated_at = excluded.updated_at,
      raw_data = excluded.raw_data
  `)
  const queue = db.prepare(`
    INSERT OR IGNORE INTO custom_message_receipts
      (message_id, message_uid, event, placement, attempts, next_attempt_at, created_at, updated_at)
    VALUES (?, ?, 'delivered', ?, 0, 0, ?, ?)
  `)
  db.transaction(() => {
    for (const message of messages) {
      deactivateOlder.run(now, message.id, message.messageUid)
      upsert.run(
        message.messageUid,
        message.id,
        message.displayScope,
        now,
        now,
        JSON.stringify(message),
      )
      queue.run(message.id, message.messageUid, placement, now, now)
    }
  })()
  return messages
}

export function applyCustomSseMessage(value: Record<string, unknown>): void {
  const operation = optionalString(value.operation)
  const id = Number(value.id)
  if (operation === 'offline' || operation === 'delete') {
    if (Number.isSafeInteger(id) && id > 0) deactivateCustomMessage(id)
    return
  }
  if (operation !== 'published') return
  const message = normalizeMessage(value)
  if (!message) return
  const placement: CustomMessagePlacement =
    message.displayScope === 'floating' ? 'floating' : 'main'
  cacheCustomMessages([message], placement)
}

export function listCachedCustomMessages(placement: CustomMessagePlacement): CustomMessageData[] {
  const rows = openDatabase()
    .prepare(
      `SELECT raw_data FROM custom_messages
       WHERE active = 1 AND (display_scope = 'both' OR display_scope = ?)
       ORDER BY updated_at DESC`,
    )
    .all(placement) as Array<{ raw_data: string }>
  const result: CustomMessageData[] = []
  for (const row of rows) {
    try {
      const message = normalizeMessage(JSON.parse(row.raw_data))
      if (message) result.push(message)
    } catch {
      void 0
    }
  }
  return result
}

export function reconcileCustomMessages(
  placement: CustomMessagePlacement,
  activeMessageUids: string[],
): void {
  const db = openDatabase()
  const valid = [...new Set(activeMessageUids.filter((uid) => typeof uid === 'string' && uid))]
  const scopeSql = "(display_scope = 'both' OR display_scope = ?)"
  if (valid.length === 0) {
    db.prepare(`UPDATE custom_messages SET active = 0, updated_at = ? WHERE ${scopeSql}`).run(
      Date.now(),
      placement,
    )
    return
  }
  const placeholders = valid.map(() => '?').join(',')
  const now = Date.now()
  const deactivateMissing = db.prepare(
    `UPDATE custom_messages SET active = 0, updated_at = ?
     WHERE ${scopeSql} AND message_uid NOT IN (${placeholders})`,
  )
  const reactivateValid = db.prepare(
    `UPDATE custom_messages SET active = 1, updated_at = ?
     WHERE ${scopeSql} AND active = 0 AND message_uid IN (${placeholders})`,
  )
  db.transaction(() => {
    deactivateMissing.run(now, placement, ...valid)
    reactivateValid.run(now, placement, ...valid)
  })()
}

export function deactivateCustomMessage(messageId: number): void {
  openDatabase()
    .prepare('UPDATE custom_messages SET active = 0, updated_at = ? WHERE message_id = ?')
    .run(Date.now(), messageId)
}

export function queueCustomMessageReceipt(
  messageId: number,
  messageUid: string,
  event: CustomMessageEvent,
  placement: CustomMessagePlacement,
): void {
  maintainStorage()
  const now = Date.now()
  openDatabase()
    .prepare(
      `INSERT OR IGNORE INTO custom_message_receipts
       (message_id, message_uid, event, placement, attempts, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
    )
    .run(messageId, messageUid, event, placement, now, now)
}

export function listPendingCustomMessageReceipts(): CustomMessageReceipt[] {
  maintainStorage()
  return openDatabase()
    .prepare(
      `SELECT id, message_id AS messageId, message_uid AS messageUid, event, placement, attempts
       FROM custom_message_receipts
       WHERE next_attempt_at <= ?
       ORDER BY id
       LIMIT 50`,
    )
    .all(Date.now()) as CustomMessageReceipt[]
}

export function markCustomMessageReceiptSent(id: number): void {
  openDatabase().prepare('DELETE FROM custom_message_receipts WHERE id = ?').run(id)
}

export function markCustomMessageReceiptFailed(id: number, error: string): void {
  const db = openDatabase()
  const row = db.prepare('SELECT attempts FROM custom_message_receipts WHERE id = ?').get(id) as
    { attempts: number } | undefined
  if (!row) return
  const attempts = row.attempts + 1
  if (attempts >= MAX_RECEIPT_ATTEMPTS) {
    db.prepare('DELETE FROM custom_message_receipts WHERE id = ?').run(id)
    return
  }
  const delay = Math.min(300_000, 5_000 * 2 ** Math.min(attempts - 1, 6))
  db.prepare(
    `UPDATE custom_message_receipts
     SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
     WHERE id = ?`,
  ).run(attempts, Date.now() + delay, error.slice(0, 500), Date.now(), id)
}
