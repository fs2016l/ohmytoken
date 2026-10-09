import type Database from 'better-sqlite3'
import type {
  FavoriteSessionSnapshot,
  LocalFavorite,
  LocalFavoriteTarget,
  LocalFavoriteType,
} from '../../shared/local-favorites'
import { localFavoriteKey } from '../../shared/local-favorites'
import { ensureLocalFavoriteSchema } from './local-favorite-schema'
import { normalizeLatestGeneration } from '../../shared/generation-timing'
import { normalizeLatestTurnFirstToken } from '../../shared/turn-timing'

const LIMIT = 10_000
const hasControlCharacters = (value: string): boolean =>
  Array.from(value).some((character) => character.charCodeAt(0) < 32)
const numbers = [
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'totalTokens',
  'reasoningTokens',
  'apiCallCount',
  'childCount',
] as const

export function validateFavoriteTarget(input: unknown): LocalFavoriteTarget & { agent: string } {
  if (!input || typeof input !== 'object') throw new Error('Invalid favorite')
  const target = input as LocalFavoriteTarget
  if (target.type !== 'session' && target.type !== 'project')
    throw new Error('Invalid favorite type')
  if (
    typeof target.id !== 'string' ||
    !target.id ||
    target.id.length > 2048 ||
    hasControlCharacters(target.id)
  )
    throw new Error('Invalid favorite ID')
  if (
    target.type === 'session' &&
    (typeof target.agent !== 'string' ||
      !target.agent ||
      target.agent.length > 128 ||
      hasControlCharacters(target.agent))
  )
    throw new Error('Invalid favorite Agent')
  return { type: target.type, id: target.id, agent: target.type === 'session' ? target.agent! : '' }
}

/** Only aggregate display fields may be imported from the old floating preferences. */
function cleanSnapshot(
  input: unknown,
  target: LocalFavoriteTarget,
): FavoriteSessionSnapshot | null {
  if (!input || typeof input !== 'object' || target.type !== 'session') return null
  const value = input as FavoriteSessionSnapshot
  if (
    value.agent !== target.agent ||
    value.rootSessionId !== target.id ||
    numbers.some(
      (key) => typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0,
    )
  )
    return null
  if (
    !Array.isArray(value.models) ||
    value.models.length > 100 ||
    value.models.some((model) => typeof model !== 'string' || model.length > 1024)
  )
    return null
  if (
    typeof value.startedAt !== 'string' ||
    value.startedAt.length > 100 ||
    typeof value.endedAt !== 'string' ||
    value.endedAt.length > 100
  )
    return null
  return {
    agent: target.agent!,
    rootSessionId: target.id,
    title: typeof value.title === 'string' ? value.title.slice(0, 4096) : undefined,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    models: [...value.models],
    ...(Object.fromEntries(numbers.map((key) => [key, value[key]])) as Pick<
      FavoriteSessionSnapshot,
      (typeof numbers)[number]
    >),
    apiCallCountComplete: value.apiCallCountComplete === false ? false : undefined,
    latestGeneration: normalizeLatestGeneration(value.latestGeneration),
    latestTurnFirstToken: normalizeLatestTurnFirstToken(value.latestTurnFirstToken),
    turns:
      value.turns && Number.isSafeInteger(value.turns.count) && value.turns.count >= 0
        ? { count: value.turns.count, complete: value.turns.complete === true }
        : undefined,
  }
}

interface Row {
  entity_type: LocalFavoriteType
  entity_id: string
  agent: string
  position: number
  created_at: number
  snapshot_json: string | null
}

export function createLocalFavoriteStore(db: Database.Database) {
  ensureLocalFavoriteSchema(db)
  function list(): LocalFavorite[] {
    return (
      db
        .prepare(
          'SELECT * FROM local_favorites ORDER BY entity_type, position, created_at, agent, entity_id',
        )
        .all() as Row[]
    ).map((row) => {
      const target = { type: row.entity_type, id: row.entity_id, agent: row.agent }
      let snapshot: FavoriteSessionSnapshot | null = null
      try {
        snapshot = cleanSnapshot(JSON.parse(row.snapshot_json || 'null'), target)
      } catch {
        /* Invalid cached metadata does not remove a favorite. */
      }
      return { ...target, position: row.position, createdAt: row.created_at, snapshot }
    })
  }
  function write(input: unknown, favorite: unknown, snapshot?: unknown): void {
    const target = validateFavoriteTarget(input)
    if (typeof favorite !== 'boolean') throw new Error('Invalid favorite state')
    db.transaction(() => {
      if (!favorite) {
        db.prepare(
          'DELETE FROM local_favorites WHERE entity_type = ? AND agent = ? AND entity_id = ?',
        ).run(target.type, target.agent, target.id)
        return
      }
      const existing = db
        .prepare(
          'SELECT 1 FROM local_favorites WHERE entity_type = ? AND agent = ? AND entity_id = ?',
        )
        .get(target.type, target.agent, target.id)
      if (
        !existing &&
        (db.prepare('SELECT COUNT(*) n FROM local_favorites').get() as { n: number }).n >= LIMIT
      )
        throw new Error('Favorite limit reached')
      const cleaned = cleanSnapshot(snapshot, target)
      db.prepare(
        `INSERT INTO local_favorites(entity_type, entity_id, agent, position, created_at, snapshot_json)
        VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM local_favorites WHERE entity_type = ?), ?, ?)
        ON CONFLICT(entity_type, agent, entity_id) DO UPDATE SET snapshot_json = COALESCE(excluded.snapshot_json, local_favorites.snapshot_json)`,
      ).run(
        target.type,
        target.id,
        target.agent,
        target.type,
        Date.now(),
        cleaned ? JSON.stringify(cleaned) : null,
      )
    })()
  }
  function set(input: unknown, favorite: unknown, snapshot?: unknown): LocalFavorite[] {
    write(input, favorite, snapshot)
    return list()
  }
  function reorder(type: unknown, inputs: unknown): LocalFavorite[] {
    if (
      (type !== 'session' && type !== 'project') ||
      !Array.isArray(inputs) ||
      inputs.length > LIMIT
    )
      throw new Error('Invalid favorite order')
    const order = inputs.map(validateFavoriteTarget)
    if (
      order.some((row) => row.type !== type) ||
      new Set(order.map(localFavoriteKey)).size !== order.length
    )
      throw new Error('Invalid favorite order')
    db.transaction(() => {
      const current = list().filter((row) => row.type === type)
      const existing = new Set(current.map(localFavoriteKey))
      const requested = new Set(order.map(localFavoriteKey))
      // Another window may have added a favorite since this drag began. Retain it.
      const next = [
        ...order.filter((row) => existing.has(localFavoriteKey(row))),
        ...current.filter((row) => !requested.has(localFavoriteKey(row))),
      ]
      const statement = db.prepare(
        'UPDATE local_favorites SET position = ? WHERE entity_type = ? AND agent = ? AND entity_id = ?',
      )
      next.forEach((row, index) => statement.run(index, row.type, row.agent, row.id))
    })()
    return list()
  }
  function migrateFloating(inputs: unknown): LocalFavorite[] {
    if (!Array.isArray(inputs) || inputs.length > LIMIT)
      throw new Error('Invalid favorite migration')
    db.transaction(() => {
      if (db.prepare("SELECT 1 FROM local_favorite_migrations WHERE source = 'floating-v1'").get())
        return
      for (const input of inputs) {
        if (!input || typeof input !== 'object') continue
        const { target, snapshot } = input as { target?: unknown; snapshot?: unknown }
        let verified: LocalFavoriteTarget
        try {
          verified = validateFavoriteTarget(target)
        } catch {
          continue
        }
        if (verified.type === 'session') write(verified, true, snapshot)
      }
      db.prepare(
        "INSERT INTO local_favorite_migrations(source, applied_at) VALUES ('floating-v1', ?)",
      ).run(Date.now())
    })()
    return list()
  }
  return { list, set, reorder, migrateFloating }
}
