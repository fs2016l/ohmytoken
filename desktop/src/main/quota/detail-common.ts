import { createHash } from 'node:crypto'
import {
  QUOTA_DETAIL_SOURCES,
  type QuotaDetailQuery,
  type QuotaDetailSource,
  type QuotaDetailSourceId,
  type QuotaMetric,
  type QuotaMetricUnit,
} from '../../shared/quota-details'
import { QuotaQueryError } from './transport'
import { numberValue, object, textValue, type JsonObject } from './types'

export function records(value: unknown, limit = 1500): JsonObject[] {
  if (!Array.isArray(value)) throw new QuotaQueryError('invalid_response')
  return value.slice(0, limit).map(object)
}
export function safeText(value: unknown): string | null {
  const text = textValue(value)
  return text && text.length <= 160 && [...text].every((char) => char.charCodeAt(0) >= 32)
    ? text
    : null
}
export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
}
export function metric(
  key: string,
  value: unknown,
  unit: QuotaMetricUnit,
  label?: string,
): QuotaMetric[] {
  const parsed = numberValue(value)
  return parsed === null ? [] : [{ key, value: parsed, unit, ...(label ? { label } : {}) }]
}
export function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
export function validateDetailQuery(value: unknown): QuotaDetailQuery {
  const q = object(value)
  if (
    !validDate(q.startDate) ||
    !validDate(q.endDate) ||
    q.endDate < q.startDate ||
    Date.parse(q.endDate) - Date.parse(q.startDate) > 30 * 86400000 ||
    (q.source !== undefined && !QUOTA_DETAIL_SOURCES.includes(q.source as QuotaDetailSourceId)) ||
    (q.cursor !== undefined &&
      (typeof q.cursor !== 'string' || q.cursor.length > 4096 || !q.source))
  )
    throw new QuotaQueryError('invalid_response')
  return {
    startDate: q.startDate,
    endDate: q.endDate,
    ...(q.source ? { source: q.source as QuotaDetailSourceId } : {}),
    ...(q.cursor ? { cursor: String(q.cursor) } : {}),
    force: q.force === true,
  }
}
export function inRange(date: unknown, query: QuotaDetailQuery): date is string {
  return (
    typeof date === 'string' &&
    validDate(date.slice(0, 10)) &&
    date.slice(0, 10) >= query.startDate &&
    date.slice(0, 10) <= query.endDate
  )
}
export function detailSource(id: QuotaDetailSourceId): QuotaDetailSource {
  return {
    id,
    status: 'ok',
    checkedAt: Date.now(),
    observedAt: Date.now(),
    providerAsOf: null,
    stale: false,
    errorCode: null,
    retryAt: null,
    granularity: 'unknown',
    timeZone: null,
    metrics: [],
    rows: [],
    nextCursor: null,
    totalRows: null,
    notes: [],
  }
}
