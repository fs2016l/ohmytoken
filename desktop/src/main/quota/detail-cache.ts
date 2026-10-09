import type {
  QuotaDetailQuery,
  QuotaDetails,
  QuotaDetailSource,
  QuotaDetailSourceId,
} from '../../shared/quota-details'
import { detailSource, digest, validateDetailQuery } from './detail-common'
import { detailSources, fetchAccountDetail } from './detail-fetch'
import { QuotaQueryError } from './transport'
import { isQuotaRegionError } from './query-error'
import { object, type DiscoveredConnection } from './types'

interface Entry {
  account: string
  fingerprint: string
  query: QuotaDetailQuery
  source: QuotaDetailSource
}
const MAX_ENTRIES = 48
export class QuotaDetailCache {
  private entries = new Map<string, Entry>()
  private pending = new Map<string, Promise<QuotaDetailSource>>()
  private identities = new Map<string, string>()
  private active = 0
  private queue: Array<() => void> = []
  private fetchSource: typeof fetchAccountDetail
  private now: () => number
  constructor(fetchSource = fetchAccountDetail, now = Date.now) {
    this.fetchSource = fetchSource
    this.now = now
  }
  reconcile(connections: DiscoveredConnection[]): void {
    this.identities = new Map(connections.map((c) => [c.public.id, c.fingerprint]))
    for (const [key, entry] of this.entries)
      if (this.identities.get(entry.account) !== entry.fingerprint) this.entries.delete(key)
  }
  serialize(): string {
    const entries = [...this.entries.values()].filter(
      (e) => !e.query.cursor && e.source.observedAt !== null,
    )
    let size = 0
    const bounded = entries.reverse().filter((entry) => {
      size += Buffer.byteLength(JSON.stringify(entry))
      return size < 7 * 1024 * 1024
    })
    return JSON.stringify({ version: 1, entries: bounded.reverse() })
  }
  restore(raw: string): void {
    if (Buffer.byteLength(raw) > 8 * 1024 * 1024) return
    try {
      const payload = object(JSON.parse(raw))
      if (payload.version !== 1 || !Array.isArray(payload.entries)) return
      for (const value of payload.entries.slice(-MAX_ENTRIES)) {
        const entry = object(value),
          source = object(entry.source)
        if (
          typeof entry.account !== 'string' ||
          !/^[a-f0-9]{32}$/.test(entry.account) ||
          typeof entry.fingerprint !== 'string' ||
          entry.fingerprint.length > 128
        )
          continue
        const query = validateDetailQuery(entry.query)
        if (
          query.cursor ||
          !query.source ||
          source.id !== query.source ||
          !Array.isArray(source.metrics) ||
          !Array.isArray(source.rows) ||
          !Array.isArray(source.notes) ||
          typeof source.checkedAt !== 'number' ||
          typeof source.observedAt !== 'number'
        )
          continue
        // Cache contains only our normalized schema; reject incompatible/corrupt payloads as a whole.
        if (
          source.rows.length > 6000 ||
          source.metrics.length > 200 ||
          JSON.stringify(source).length > 1500000
        )
          continue
        const restored = { ...source, stale: true } as unknown as QuotaDetailSource
        if (!validSource(restored)) continue
        const item: Entry = {
          account: entry.account,
          fingerprint: entry.fingerprint,
          query,
          source: restored,
        }
        this.entries.set(this.key(item.account, item.fingerprint, query), item)
      }
    } catch {
      /* 缓存损坏时重新查询。 */
    }
  }
  private key(id: string, fingerprint: string, query: QuotaDetailQuery): string {
    return digest([
      id,
      fingerprint,
      query.startDate,
      query.endDate,
      query.source,
      query.cursor ?? '',
    ])
  }
  async query(connection: DiscoveredConnection, input: QuotaDetailQuery): Promise<QuotaDetails> {
    const query = validateDetailQuery(input)
    const allowed = detailSources(connection)
    if (query.source && !allowed.includes(query.source)) throw new QuotaQueryError('unsupported')
    if (
      query.cursor &&
      ![...this.entries.values()].some(
        (e) =>
          e.account === connection.public.id &&
          e.fingerprint === connection.fingerprint &&
          e.query.source === query.source &&
          e.query.startDate === query.startDate &&
          e.query.endDate === query.endDate &&
          e.source.nextCursor === query.cursor,
      )
    )
      throw new QuotaQueryError('invalid_response')
    const sources = await Promise.all(
      (query.source ? [query.source] : allowed).map((source) =>
        this.refresh(connection, { ...query, source }),
      ),
    )
    return {
      connectionId: connection.public.id,
      startDate: query.startDate,
      endDate: query.endDate,
      sources,
    }
  }
  private refresh(
    connection: DiscoveredConnection,
    query: QuotaDetailQuery & { source: QuotaDetailSourceId },
  ): Promise<QuotaDetailSource> {
    const key = this.key(connection.public.id, connection.fingerprint, query)
    const previous = this.entries.get(key)?.source
    if (
      previous &&
      ((previous.retryAt ?? 0) > this.now() ||
        (!query.force &&
          !previous.stale &&
          !previous.errorCode &&
          this.now() - previous.checkedAt < 300000))
    )
      return Promise.resolve(previous)
    const pending = this.pending.get(key)
    if (pending) return pending
    const work = this.run(connection, query, previous)
      .then((source) => {
        if (this.identities.get(connection.public.id) === connection.fingerprint) {
          this.entries.delete(key)
          this.entries.set(key, {
            account: connection.public.id,
            fingerprint: connection.fingerprint,
            query: { ...query, force: false },
            source,
          })
          while (this.entries.size > MAX_ENTRIES)
            this.entries.delete(this.entries.keys().next().value!)
        }
        return source
      })
      .finally(() => {
        this.pending.delete(key)
      })
    this.pending.set(key, work)
    return work
  }
  private async run(
    connection: DiscoveredConnection,
    query: QuotaDetailQuery & { source: QuotaDetailSourceId },
    previous?: QuotaDetailSource,
  ): Promise<QuotaDetailSource> {
    if (this.active >= 3) await new Promise<void>((resolve) => this.queue.push(resolve))
    else this.active++
    try {
      const source = await this.fetchSource(connection, query.source, query)
      return { ...source, checkedAt: this.now(), observedAt: this.now() }
    } catch (error) {
      const code = error instanceof QuotaQueryError ? error.code : 'network_error'
      return {
        ...(previous ?? detailSource(query.source)),
        observedAt: previous?.observedAt ?? null,
        checkedAt: this.now(),
        stale: Boolean(previous?.observedAt),
        status: previous?.observedAt ? 'partial' : code === 'unsupported' ? 'unsupported' : 'error',
        errorCode: code,
        retryAt: isQuotaRegionError(code)
          ? null
          : error instanceof QuotaQueryError && error.retryAt
            ? error.retryAt
            : this.now() + 60000,
      }
    } finally {
      const next = this.queue.shift()
      if (next) next()
      else this.active--
    }
  }
}

function validSource(source: QuotaDetailSource): boolean {
  const safe = (v: unknown, max = 200): boolean =>
    typeof v === 'string' && v.length <= max && [...v].every((char) => char.charCodeAt(0) >= 32)
  const metrics = (v: unknown): boolean =>
    Array.isArray(v) &&
    v.length <= 200 &&
    v.every((x) => {
      const m = object(x)
      return (
        safe(m.key) &&
        safe(m.unit, 20) &&
        typeof m.value === 'number' &&
        Number.isFinite(m.value) &&
        m.value >= 0 &&
        (m.label === undefined || safe(m.label))
      )
    })
  return (
    metrics(source.metrics) &&
    source.rows.every((v) => {
      const row = object(v)
      return (
        safe(row.id, 600) &&
        (row.time === null || safe(row.time)) &&
        safe(row.label, 600) &&
        (row.category === null || safe(row.category)) &&
        metrics(row.metrics)
      )
    }) &&
    source.notes.every((v) => safe(v, 80)) &&
    (source.nextCursor === null || safe(source.nextCursor, 4096)) &&
    (source.timeZone === null || safe(source.timeZone))
  )
}
