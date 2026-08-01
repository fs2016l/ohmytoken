import { openDatabase } from './sqlite-storage.service'
import type { PushMessage } from './sse.service'

interface NotificationRow {
  id: string
  type: string
  read: number
  created_at: number
  raw_data: string
}

export interface NotificationItem {
  id: string
  type: string
  read: boolean
  createdAt: number
  rawData: Record<string, unknown>
}

const MAX_NOTIFICATIONS = 50

export function insertNotification(message: PushMessage): void {
  if (message.type === 'connected') return
  if (
    message.type === 'custom' &&
    (message.operation === 'offline' ||
      message.operation === 'delete' ||
      message.showInNotificationCenter === false)
  )
    return

  const db = openDatabase()
  const ts = Date.now()
  const id = `${ts}-${Math.random().toString(36).slice(2, 8)}`

  db.prepare(
    `INSERT OR REPLACE INTO notifications (id, type, read, created_at, raw_data)
     VALUES (@id, @type, 0, @created_at, @raw_data)`,
  ).run({
    id,
    type: message.type,
    created_at: ts,
    raw_data: JSON.stringify(message),
  })

  db.prepare(
    `DELETE FROM notifications
     WHERE id NOT IN (
       SELECT id FROM notifications ORDER BY created_at DESC LIMIT ?
     )`,
  ).run(MAX_NOTIFICATIONS)
}

export function listNotifications(
  filter: 'all' | 'unread' | 'read' = 'all',
  limit = MAX_NOTIFICATIONS,
): NotificationItem[] {
  const db = openDatabase()
  const sql = {
    all: 'SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?',
    unread: 'SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC LIMIT ?',
    read: 'SELECT * FROM notifications WHERE read = 1 ORDER BY created_at DESC LIMIT ?',
  }[filter]

  const rows = db.prepare(sql).all(limit) as NotificationRow[]
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    read: row.read === 1,
    createdAt: row.created_at,
    rawData: JSON.parse(row.raw_data) as Record<string, unknown>,
  }))
}

export function markNotificationRead(id: string): void {
  const db = openDatabase()
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id)
}

export function markAllNotificationsRead(): void {
  const db = openDatabase()
  db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run()
}

export function deleteNotification(id: string): void {
  const db = openDatabase()
  db.prepare('DELETE FROM notifications WHERE id = ?').run(id)
}
