import type Database from 'better-sqlite3'
import {
  AI_NETWORK_SERVICES,
  IP_QUALITY_SOURCES,
  type NetworkCheckSnapshot,
} from '../../shared/network-check'
import { emptyEndpoint } from './ai-probes'
import { emptyIpQuality } from './ip-quality'

type Check = (value: unknown) => boolean
const text: Check = (value) => typeof value === 'string' && value.length <= 8192
const number: Check = (value) => typeof value === 'number' && Number.isFinite(value)
const integer: Check = (value) => number(value) && Number.isSafeInteger(value) && Number(value) >= 0
const timestamp: Check = (value) => integer(value) && Number(value) <= 8.64e15
const boolean: Check = (value) => typeof value === 'boolean'
const nullable =
  (check: Check): Check =>
  (value) =>
    value === null || check(value)
const optional =
  (check: Check): Check =>
  (value) =>
    value === undefined || check(value)
const oneOf =
  (...values: unknown[]): Check =>
  (value) =>
    values.includes(value)
const array =
  (check: Check, limit = 128): Check =>
  (value) =>
    Array.isArray(value) && value.length <= limit && value.every(check)
const object =
  (fields: Record<string, Check>): Check =>
  (value) =>
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(fields).every(([key, check]) => check((value as Record<string, unknown>)[key]))
const state = oneOf('pending', 'checking', 'done', 'failed', 'cancelled')
const route = oneOf('direct', 'proxy', 'unknown')
const issue = nullable(
  oneOf(
    'timeout',
    'dns',
    'tls',
    'connection',
    'proxy_auth',
    'rate_limited',
    'authentication',
    'invalid_response',
    'unavailable',
    'cancelled',
    'no_ip',
  ),
)
const access = oneOf(
  'accessible',
  'precheck_passed',
  'reachable',
  'region_limited',
  'restricted',
  'challenge',
  'authentication',
  'rate_limited',
  'unknown',
  'error',
)
const networkType = nullable(
  oneOf('residential', 'hosting', 'business', 'mobile', 'education', 'isp'),
)
const exit = object({ state, ip: nullable(text), source: text, route, issue })
const nullableTime = nullable(timestamp)
const source = object({
  id: text,
  state,
  issue,
  ip: nullable(text),
  country: nullable(text),
  countryCode: nullable(text),
  region: nullable(text),
  city: nullable(text),
  asn: nullable(text),
  organization: nullable(text),
  companyName: nullable(text),
  timezone: nullable(text),
  postalCode: nullable(text),
  usageType: networkType,
  companyType: networkType,
  riskScore: nullable(number),
  sourceUpdatedAt: nullableTime,
  observedAt: nullableTime,
  cached: boolean,
  factors: object(
    Object.fromEntries(
      ['proxy', 'tor', 'vpn', 'hosting', 'abuse', 'robot', 'compromised', 'mobile'].map((key) => [
        key,
        nullable(boolean),
      ]),
    ),
  ),
})
const endpoint = object({
  id: text,
  state,
  issue,
  status: nullable(access),
  reason: nullable(
    oneOf(
      'page_received',
      'api_received',
      'region_response',
      'region_redirect',
      'browser_verification',
      'login_required',
      'http_rate_limit',
      'http_forbidden',
      'unexpected_response',
      'redirect_unconfirmed',
      'network_error',
      'network_region_precheck',
      'region_policy',
      'auth_response',
      'ip_denied',
      'response_incomplete',
    ),
  ),
  httpStatus: nullable(integer),
  elapsedMs: nullable(number),
  route,
  destination: nullable(text),
  checkedAt: nullableTime,
  requiresAuth: boolean,
  retryAt: nullableTime,
  region: nullable(
    object({
      country: text,
      source: oneOf('edge', 'page'),
      status: oneOf('supported', 'not_listed', 'conditional'),
      policyUrl: text,
      reviewedAt: text,
    }),
  ),
  evidence: array(
    object({
      kind: oneOf('entry', 'region_trace', 'preflight', 'page_region'),
      url: text,
      destination: text,
      status: access,
      httpStatus: nullable(integer),
      elapsedMs: number,
      checkedAt: timestamp,
      observedIp: nullable(text),
      country: nullable(text),
      issue,
    }),
    16,
  ),
})
const snapshotShape = object({
  revision: integer,
  runId: integer,
  status: oneOf('completed'),
  cancelling: oneOf(false),
  mode: oneOf('system', 'direct'),
  target: optional(oneOf('all', 'ip', 'dns', ...AI_NETWORK_SERVICES.map((service) => service.id))),
  issue: optional(issue),
  startedAt: timestamp,
  finishedAt: timestamp,
  completed: integer,
  total: integer,
  exit,
  ipv6: exit,
  registration: object({
    state,
    ip: nullable(text),
    countries: array(text),
    registries: array(text),
    observedAt: nullableTime,
    cached: boolean,
    issue,
  }),
  dns: object({
    state,
    resolvers: array(object({ ip: text, hits: integer })),
    completedProbes: integer,
    route,
    observedAt: nullableTime,
    issue,
    retryAt: nullableTime,
    geolocation: object({
      state,
      exit: nullable(exit),
      locations: array(
        object({
          ip: text,
          countryCode: nullable(text),
          asn: nullable(text),
          organization: nullable(text),
        }),
      ),
      observedAt: nullableTime,
      issue,
      retryAt: nullableTime,
    }),
  }),
  sources: array(source, 64),
  endpoints: array(endpoint, 64),
})

function isSnapshot(value: unknown): value is NetworkCheckSnapshot {
  if (!snapshotShape(value)) return false
  const report = value as NetworkCheckSnapshot
  return (
    report.runId > 0 &&
    report.completed <= report.total &&
    report.finishedAt! >= report.startedAt! &&
    [report.sources, report.endpoints].every(
      (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
    )
  )
}

/** One local report in the app database; in-flight checks never replace it. */
export class NetworkCheckSnapshotStore {
  private readonly db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
    db.exec(`
      CREATE TABLE IF NOT EXISTS network_check_snapshots (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL
      );
    `)
  }

  load(): NetworkCheckSnapshot | null {
    try {
      const row = this.db
        .prepare('SELECT schema_version, snapshot_json FROM network_check_snapshots WHERE id = 1')
        .get() as { schema_version: number; snapshot_json: string } | undefined
      if (!row || row.schema_version !== 1 || row.snapshot_json.length > 1024 * 1024) return null
      const report: unknown = JSON.parse(row.snapshot_json)
      if (!isSnapshot(report)) return null
      // Align with the current catalog when a release adds or removes a check.
      report.sources = IP_QUALITY_SOURCES.map(
        ({ id }) => report.sources.find((item) => item.id === id) ?? emptyIpQuality(id),
      )
      report.endpoints = AI_NETWORK_SERVICES.flatMap((service) => service.endpoints).map(
        ({ id }) => report.endpoints.find((item) => item.id === id) ?? emptyEndpoint(id),
      )
      return report
    } catch {
      // Missing, incomplete or incompatible reports must not prevent a fresh check.
      return null
    }
  }

  save(snapshot: NetworkCheckSnapshot): void {
    if (snapshot.status !== 'completed') return
    try {
      // A single atomic upsert completes before publishing, including immediately before quit.
      this.db
        .prepare(
          `
        INSERT INTO network_check_snapshots (id, schema_version, updated_at, snapshot_json)
        VALUES (1, 1, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          schema_version = excluded.schema_version,
          updated_at = excluded.updated_at,
          snapshot_json = excluded.snapshot_json
      `,
        )
        .run(snapshot.finishedAt, JSON.stringify(snapshot))
    } catch (error) {
      console.warn('[network-check] Could not save the local report:', error)
    }
  }
}
