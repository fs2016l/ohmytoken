import {
  EXCHANGE_RATE_SOURCE,
  type ExchangeRateSnapshot,
  type ExchangeRateState,
} from '../../shared/cost-currency'
import {
  CLOUD_REFERENCE_CHECK_INTERVAL_MS,
  CLOUD_REFERENCE_RETRY_INTERVAL_MS,
} from '../../shared/cloud-reference-sync'

const MAX_BYTES = 64 * 1024

export interface ExchangeRateCache extends ExchangeRateState {
  checkedAt: number
}

function validDate(value: unknown, now: number): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && time <= now && new Date(time).toISOString().slice(0, 10) === value
}

export function validateExchangeRate(
  value: unknown,
  now = Date.now(),
): ExchangeRateSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const rate = value as Partial<ExchangeRateSnapshot>
  const fetched = typeof rate.fetchedAt === 'string' ? Date.parse(rate.fetchedAt) : NaN
  if (
    rate.base !== 'USD' ||
    !['ECB', 'manual'].includes(rate.source ?? '') ||
    (rate.source === 'ECB' && rate.sourceUrl !== EXCHANGE_RATE_SOURCE) ||
    !validDate(rate.asOf, now) ||
    !Number.isFinite(fetched) ||
    fetched > now + 60000 ||
    rate.asOf > new Date(fetched).toISOString().slice(0, 10) ||
    rate.rates?.USD !== 1 ||
    typeof rate.rates.CNY !== 'number' ||
    !Number.isFinite(rate.rates.CNY) ||
    rate.rates.CNY <= 0 ||
    rate.rates.CNY >= 100000 ||
    !Number.isSafeInteger(rate.revision) ||
    rate.revision! < 0
  )
    return null
  return {
    base: 'USD',
    rates: { USD: 1, CNY: rate.rates.CNY },
    asOf: rate.asOf,
    fetchedAt: rate.fetchedAt!,
    source: rate.source!,
    sourceUrl: rate.source === 'ECB' ? EXCHANGE_RATE_SOURCE : null,
    revision: rate.revision!,
  }
}

async function readRateDocument(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error('Exchange rate download failed')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) throw new Error('Exchange rate document is too large')
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export class ExchangeRateStore {
  private snapshot: ExchangeRateSnapshot | null = null
  private refreshFailed = false
  private checkedAt = 0
  private loaded: Promise<void> | undefined
  private pending: Promise<ExchangeRateState> | undefined
  private attemptedAt: number | undefined

  private readonly options: {
    url: string | (() => Promise<string>)
    read: () => Promise<unknown>
    write: (cache: ExchangeRateCache) => Promise<void>
    fetch?: typeof fetch
    now?: () => number
    /** com 内容接口要求设备凭证等身份头；第三方源不传。 */
    headers?: () => Promise<Record<string, string>>
  }

  constructor(options: ExchangeRateStore['options']) {
    this.options = options
  }

  async get(force = false): Promise<ExchangeRateState> {
    const now = (this.options.now ?? Date.now)()
    this.loaded ??= this.options
      .read()
      .then((value) => {
        if (!value || typeof value !== 'object') return
        const cache = value as Partial<ExchangeRateCache>
        if (
          typeof cache.checkedAt !== 'number' ||
          !Number.isFinite(cache.checkedAt) ||
          cache.checkedAt <= 0 ||
          cache.checkedAt > now ||
          typeof cache.refreshFailed !== 'boolean'
        )
          return
        this.snapshot = validateExchangeRate(cache.snapshot, now)
        if (!this.snapshot) return
        this.checkedAt = cache.checkedAt
        this.refreshFailed = cache.refreshFailed
      })
      .catch(() => undefined)
    await this.loaded
    if (this.pending) return this.pending
    const sinceAttempt = this.attemptedAt === undefined ? Infinity : now - this.attemptedAt
    const fresh = this.snapshot && now - this.checkedAt < CLOUD_REFERENCE_CHECK_INTERVAL_MS
    const skipRefresh =
      !force &&
      (this.refreshFailed
        ? sinceAttempt < CLOUD_REFERENCE_RETRY_INTERVAL_MS
        : fresh || sinceAttempt < CLOUD_REFERENCE_CHECK_INTERVAL_MS)
    if (skipRefresh) return this.state()
    this.attemptedAt = now
    this.pending = this.refresh(now).finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  private state(): ExchangeRateState {
    return { snapshot: this.snapshot, refreshFailed: this.refreshFailed }
  }

  private async refresh(now: number): Promise<ExchangeRateState> {
    try {
      const response = await (this.options.fetch ?? fetch)(
        typeof this.options.url === 'function' ? await this.options.url() : this.options.url,
        {
          signal: AbortSignal.timeout(8000),
          redirect: 'error',
          headers: {
            Accept: 'application/json',
            ...(this.options.headers ? await this.options.headers() : {}),
          },
        },
      )
      const body = (await readRateDocument(response)) as { code?: number; data?: ExchangeRateState }
      if (body?.code !== 200 || typeof body.data?.refreshFailed !== 'boolean')
        throw new Error('Invalid exchange rate response')
      const next = validateExchangeRate(body.data.snapshot, now)
      if (!next) throw new Error('Exchange rate unavailable')
      // A manual override may deliberately use an older date. Cloud revisions determine order.
      if (
        this.snapshot &&
        (next.revision < this.snapshot.revision ||
          (next.revision === this.snapshot.revision &&
            JSON.stringify(next) !== JSON.stringify(this.snapshot)))
      )
        throw new Error('Exchange rate revision moved backwards')
      this.snapshot = next
      this.refreshFailed = body.data.refreshFailed
      this.checkedAt = now
      await this.options.write({ ...this.state(), checkedAt: now }).catch(() => undefined)
    } catch {
      this.refreshFailed = true
    }
    return this.state()
  }
}
