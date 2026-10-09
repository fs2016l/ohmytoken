import {
  TOKEN_PLAN_PROVIDER_IDS,
  type TokenPlanUsageSnapshot,
  type TokenPlanWindowUsage,
} from '../../shared/token-plan'
import type { DiscoveredConnection } from './types'
import { initialPlan, parseQuota, quotaWindow } from './normalize'
import { numberValue, object, textValue } from './types'
import { QuotaQueryError } from './transport'
import { isQuotaRegionError } from './query-error'

export const QUOTA_FRESH_MS = 180_000

export function isQuotaFresh(snapshot: TokenPlanUsageSnapshot, now = Date.now()): boolean {
  return (
    !snapshot.stale &&
    snapshot.observedAt !== null &&
    now >= snapshot.observedAt &&
    now - snapshot.observedAt < QUOTA_FRESH_MS &&
    !snapshot.windows.some((row) => row.resetsAt !== null && row.resetsAt <= now)
  )
}

export class QuotaCache {
  private snapshots = new Map<string, TokenPlanUsageSnapshot>()
  private pending = new Map<string, Promise<TokenPlanUsageSnapshot>>()
  private fingerprints = new Map<string, string>()
  private waiting: Array<() => void> = []
  private running = 0

  private readonly query: (connection: DiscoveredConnection) => Promise<unknown>
  constructor(query: (connection: DiscoveredConnection) => Promise<unknown>) {
    this.query = query
  }

  reconcile(connections: DiscoveredConnection[]): void {
    const active = new Set(connections.map((row) => row.public.id))
    for (const id of this.snapshots.keys()) if (!active.has(id)) this.snapshots.delete(id)
    for (const id of this.fingerprints.keys()) if (!active.has(id)) this.fingerprints.delete(id)
    for (const row of connections) {
      if (
        this.fingerprints.has(row.public.id) &&
        this.fingerprints.get(row.public.id) !== row.fingerprint
      ) {
        this.snapshots.delete(row.public.id)
      }
      this.fingerprints.set(row.public.id, row.fingerprint)
    }
  }

  restore(snapshots: unknown[]): void {
    for (const value of snapshots.slice(0, 100)) {
      const row = object(value)
      const plan = object(row.plan)
      const id = textValue(row.connectionId)
      const observedAt = numberValue(row.observedAt)
      const providerId = TOKEN_PLAN_PROVIDER_IDS.find((provider) => provider === row.providerId)
      if (
        !id ||
        !/^[a-f0-9]{32}$/.test(id) ||
        !providerId ||
        !observedAt ||
        !textValue(plan.product) ||
        !Array.isArray(row.windows)
      )
        continue
      const windows = row.windows.slice(0, 150).flatMap((value) => {
        const item = object(value)
        const label = textValue(item.label)
        const windowId = textValue(item.id)
        if (!windowId || !label) return []
        const units: TokenPlanWindowUsage['unit'][] = [
          'tokens',
          'requests',
          'credits',
          'USD',
          'CNY',
        ]
        return [
          quotaWindow(windowId.slice(0, 150), label.slice(0, 150), {
            kind: item.kind === 'balance' || item.kind === 'tool' ? item.kind : 'model',
            windowMinutes: numberValue(item.windowMinutes),
            unlimited: item.unlimited === true,
            usedPercent: numberValue(item.usedPercent),
            remainingPercent: numberValue(item.remainingPercent),
            used: numberValue(item.used),
            limit: numberValue(item.limit),
            remaining: numberValue(item.remaining),
            startsAt: numberValue(item.startsAt),
            resetsAt: numberValue(item.resetsAt),
            unit: units.find((unit) => unit === item.unit) ?? null,
            details: Array.isArray(item.details)
              ? item.details.slice(0, 150).flatMap((value) => {
                  const detail = object(value)
                  const name = textValue(detail.name)
                  const used = numberValue(detail.used)
                  return name && used !== null ? [{ name: name.slice(0, 150), used }] : []
                })
              : [],
          }),
        ]
      })
      this.snapshots.set(id, {
        connectionId: id,
        providerId,
        observedAt,
        checkedAt: numberValue(row.checkedAt) ?? observedAt,
        stale: true,
        status: 'partial',
        errorCode: null,
        retryAt: null,
        plan: {
          product: String(plan.product).slice(0, 150),
          tier: textValue(plan.tier)?.slice(0, 120) ?? null,
          tierSource:
            plan.tierSource === 'provider' || plan.tierSource === 'login' ? plan.tierSource : null,
          expiresAt: numberValue(plan.expiresAt),
          renewalAt: numberValue(plan.renewalAt),
          parallelLimit: numberValue(plan.parallelLimit),
        },
        windows,
        models: Array.isArray(row.models)
          ? row.models
              .slice(0, 150)
              .flatMap((value) => (typeof value === 'string' ? [value.slice(0, 150)] : []))
          : [],
      })
    }
  }

  list(): TokenPlanUsageSnapshot[] {
    return [...this.snapshots.values()].map((row) => ({ ...row, stale: !isQuotaFresh(row) }))
  }

  async refresh(connection: DiscoveredConnection, force = false): Promise<TokenPlanUsageSnapshot> {
    const id = connection.public.id
    const previous = this.snapshots.get(id)
    if (
      previous &&
      ((!force && isQuotaFresh(previous)) ||
        (previous.retryAt !== null && previous.retryAt > Date.now()))
    )
      return { ...previous, stale: !isQuotaFresh(previous) }
    const existing = this.pending.get(id)
    if (existing) return existing
    const work = this.run(connection).finally(() => this.pending.delete(id))
    this.pending.set(id, work)
    return work
  }

  private async run(connection: DiscoveredConnection): Promise<TokenPlanUsageSnapshot> {
    if (this.running >= 3) await new Promise<void>((resolve) => this.waiting.push(resolve))
    else this.running++
    const id = connection.public.id
    let snapshot: TokenPlanUsageSnapshot
    try {
      const parsed = parseQuota(connection, await this.query(connection))
      snapshot = {
        connectionId: id,
        providerId: connection.public.providerId,
        status: parsed.windows.every((row) => row.available) ? 'ok' : 'partial',
        observedAt: Date.now(),
        checkedAt: Date.now(),
        stale: false,
        ...parsed,
        errorCode: null,
        retryAt: null,
      }
    } catch (error) {
      const code =
        error instanceof QuotaQueryError
          ? error.code
          : error instanceof Error && error.message === 'invalid_response'
            ? 'invalid_response'
            : 'network_error'
      const previous = this.snapshots.get(id)
      snapshot = {
        connectionId: id,
        providerId: connection.public.providerId,
        plan: previous?.plan ?? initialPlan(connection),
        windows: previous?.windows ?? [],
        models: previous?.models ?? [],
        observedAt: previous?.observedAt ?? null,
        checkedAt: Date.now(),
        stale: true,
        status: previous?.observedAt ? 'partial' : 'error',
        errorCode: code,
        retryAt: isQuotaRegionError(code)
          ? null
          : error instanceof QuotaQueryError && error.retryAt
            ? error.retryAt
            : Date.now() + 60_000,
      }
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.running--
    }
    if (this.fingerprints.get(id) === connection.fingerprint) this.snapshots.set(id, snapshot)
    return snapshot
  }
}
