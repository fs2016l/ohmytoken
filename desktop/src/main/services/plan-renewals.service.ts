import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { TOKEN_PLAN_PROVIDER_IDS } from '../../shared/token-plan'
import {
  localRenewalDate,
  isRenewalTimeZone,
  isRenewalTime,
  DEFAULT_RENEWAL_TIME_ZONE,
  renewalDisplayDateTime,
  isRenewalColor,
  nextRenewalDate,
  parseRenewalDate,
  renewalIsPending,
  type PlanRenewal,
  type PlanRenewalInput,
} from '../../shared/plan-renewals'

const LIMIT = 1000
const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/.test(id)

export function validatePlanRenewal(input: unknown): PlanRenewalInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid renewal')
  const value = input as PlanRenewalInput
  if (value.id !== undefined && !validId(value.id)) throw new Error('Invalid renewal ID')
  if (
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 120 ||
    Array.from(value.name).some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error('Invalid renewal name')
  if (value.providerId !== 'other' && !TOKEN_PLAN_PROVIDER_IDS.includes(value.providerId))
    throw new Error('Invalid renewal provider')
  if (!parseRenewalDate(value.renewOn)) throw new Error('Invalid renewal date')
  if (value.renewTime !== undefined && !isRenewalTime(value.renewTime))
    throw new Error('Invalid renewal time')
  if (value.timeZone !== undefined && !isRenewalTimeZone(value.timeZone))
    throw new Error('Invalid renewal time zone')
  if (!['monthly', 'quarterly', 'yearly', 'custom'].includes(value.cycle))
    throw new Error('Invalid renewal cycle')
  if (
    value.cycle === 'custom' &&
    (!Number.isInteger(value.intervalDays) || value.intervalDays! < 1 || value.intervalDays! > 3650)
  )
    throw new Error('Invalid renewal interval')
  if (typeof value.notes !== 'string' || value.notes.length > 2000 || value.notes.includes('\0'))
    throw new Error('Invalid renewal notes')
  if (value.color !== undefined && value.color !== null && !isRenewalColor(value.color))
    throw new Error('Invalid renewal color')
  return {
    ...(value.id === undefined ? {} : { id: value.id }),
    name: value.name.trim(),
    providerId: value.providerId,
    renewOn: value.renewOn,
    ...(value.renewTime === undefined ? {} : { renewTime: value.renewTime }),
    ...(value.timeZone === undefined ? {} : { timeZone: value.timeZone }),
    cycle: value.cycle,
    intervalDays: value.cycle === 'custom' ? value.intervalDays : null,
    notes: value.notes.trim(),
    ...(value.color === undefined ? {} : { color: value.color?.toLowerCase() ?? null }),
  }
}

interface Row {
  id: string
  name: string
  provider_id: PlanRenewal['providerId']
  renew_on: string
  anchor_on: string
  cycle: PlanRenewal['cycle']
  interval_days: number | null
  notes: string
  position: number
  created_at: number
  color: string | null
  renew_time: string
  time_zone: PlanRenewal['timeZone']
}

/** User-entered subscriptions are independent of discovered accounts and cloud availability. */
export function createPlanRenewalStore(db: Database.Database, now = () => new Date()) {
  db.exec(`CREATE TABLE IF NOT EXISTS plan_renewals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    renew_on TEXT NOT NULL,
    anchor_on TEXT NOT NULL,
    cycle TEXT NOT NULL,
    interval_days INTEGER,
    notes TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    color TEXT,
    renew_time TEXT NOT NULL DEFAULT '00:00',
    time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai'
  )`)
  const columns = db.prepare('PRAGMA table_info(plan_renewals)').all() as { name: string }[]
  const hasAnchor = columns.some((column) => column.name === 'anchor_on')
  const hasColor = columns.some((column) => column.name === 'color')
  const hasTime = columns.some((column) => column.name === 'renew_time')
  const hasZone = columns.some((column) => column.name === 'time_zone')
  if (!hasAnchor || !hasColor || !hasTime || !hasZone) {
    db.transaction(() => {
      if (!hasAnchor) {
        db.exec("ALTER TABLE plan_renewals ADD COLUMN anchor_on TEXT NOT NULL DEFAULT ''")
        db.exec('UPDATE plan_renewals SET anchor_on = renew_on')
      }
      if (!hasColor) db.exec('ALTER TABLE plan_renewals ADD COLUMN color TEXT')
      if (!hasTime)
        db.exec("ALTER TABLE plan_renewals ADD COLUMN renew_time TEXT NOT NULL DEFAULT '00:00'")
      if (!hasZone)
        db.exec(
          "ALTER TABLE plan_renewals ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai'",
        )
    })()
  }
  function list(): PlanRenewal[] {
    return (
      db.prepare('SELECT * FROM plan_renewals ORDER BY position, created_at, id').all() as Row[]
    ).map((row) => ({
      id: row.id,
      name: row.name,
      providerId: row.provider_id,
      renewOn: row.renew_on,
      renewTime: row.renew_time,
      timeZone: row.time_zone,
      anchorOn: row.anchor_on,
      cycle: row.cycle,
      intervalDays: row.interval_days,
      notes: row.notes,
      position: row.position,
      createdAt: row.created_at,
      color: row.color,
    }))
  }
  function save(input: unknown): PlanRenewal[] {
    const value = validatePlanRenewal(input)
    db.transaction(() => {
      if (value.id) {
        const current = list().find((item) => item.id === value.id)
        if (!current) throw new Error('Renewal no longer exists')
        const anchorOn =
          current.renewOn === value.renewOn &&
          (value.timeZone === undefined || current.timeZone === value.timeZone) &&
          current.cycle === value.cycle &&
          current.intervalDays === value.intervalDays
            ? current.anchorOn
            : value.renewOn
        const result = db
          .prepare(
            `UPDATE plan_renewals SET
          name = ?, provider_id = ?, renew_on = ?, anchor_on = ?, cycle = ?, interval_days = ?, notes = ?, color = ?, renew_time = ?, time_zone = ?
          WHERE id = ?`,
          )
          .run(
            value.name,
            value.providerId,
            value.renewOn,
            anchorOn,
            value.cycle,
            value.intervalDays,
            value.notes,
            value.color === undefined ? current.color : value.color,
            value.renewTime ?? current.renewTime,
            value.timeZone ?? current.timeZone,
            value.id,
          )
        if (!result.changes) throw new Error('Renewal no longer exists')
      } else {
        if ((db.prepare('SELECT COUNT(*) n FROM plan_renewals').get() as { n: number }).n >= LIMIT)
          throw new Error('Renewal limit reached')
        db.prepare(
          `INSERT INTO plan_renewals
          (id, name, provider_id, renew_on, anchor_on, cycle, interval_days, notes, position, created_at, color, renew_time, time_zone)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM plan_renewals), ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          value.name,
          value.providerId,
          value.renewOn,
          value.renewOn,
          value.cycle,
          value.intervalDays,
          value.notes,
          now().getTime(),
          value.color ?? null,
          value.renewTime ?? '00:00',
          value.timeZone ?? DEFAULT_RENEWAL_TIME_ZONE,
        )
      }
    })()
    return list()
  }
  function complete(input: unknown): PlanRenewal[] {
    if (!input || typeof input !== 'object') throw new Error('Invalid renewal completion')
    const { id, renewOn, timeZone } = input as { id: unknown; renewOn: unknown; timeZone?: unknown }
    if (!validId(id) || !parseRenewalDate(renewOn)) throw new Error('Invalid renewal completion')
    if (timeZone !== undefined && !isRenewalTimeZone(timeZone))
      throw new Error('Invalid renewal time zone')
    db.transaction(() => {
      const current = list().find((item) => item.id === id)
      if (!current) throw new Error('Renewal no longer exists')
      const displayZone = timeZone ?? current.timeZone ?? DEFAULT_RENEWAL_TIME_ZONE
      const today = localRenewalDate(now(), displayZone)
      // A stale/double click must never advance an already updated subscription again.
      if (
        current.renewOn !== renewOn ||
        !renewalIsPending(renewalDisplayDateTime(current, displayZone).date, today)
      )
        return
      const sourceToday = localRenewalDate(now(), current.timeZone ?? DEFAULT_RENEWAL_TIME_ZONE)
      const next = nextRenewalDate(current, sourceToday)
      if (!next) throw new Error('No next renewal date in the supported range')
      db.prepare('UPDATE plan_renewals SET renew_on = ? WHERE id = ? AND renew_on = ?').run(
        next,
        id,
        renewOn,
      )
    })()
    return list()
  }
  function remove(id: unknown): PlanRenewal[] {
    if (!validId(id)) throw new Error('Invalid renewal ID')
    db.prepare('DELETE FROM plan_renewals WHERE id = ?').run(id)
    return list()
  }
  function reorder(input: unknown): PlanRenewal[] {
    if (
      !Array.isArray(input) ||
      input.length > LIMIT ||
      !input.every(validId) ||
      new Set(input).size !== input.length
    )
      throw new Error('Invalid renewal order')
    db.transaction(() => {
      const current = list()
      const existing = new Set(current.map((item) => item.id))
      const requested = new Set(input)
      // Keep newly added records and ignore records deleted since the drag started.
      const ids = [
        ...input.filter((id) => existing.has(id)),
        ...current.filter((item) => !requested.has(item.id)).map((item) => item.id),
      ]
      const update = db.prepare('UPDATE plan_renewals SET position = ? WHERE id = ?')
      ids.forEach((id, index) => update.run(index, id))
    })()
    return list()
  }
  return { list, save, remove, reorder, complete }
}
