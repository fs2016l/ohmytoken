import { deserialize, serialize } from 'node:v8'
import type { TokenUsageApiCall } from '../../shared/models'
import { eventTimestampMs } from '../scanners/incremental-utils'

type TurnPoint = [id: string, firstMs: number, user: boolean]
interface TurnData {
  version: 1
  unknown: number
  points: TurnPoint[]
}
export function encodeTurnData(calls: readonly TokenUsageApiCall[]): Buffer {
  const points = new Map<string, TurnPoint>()
  let unknown = 0
  for (const call of calls) {
    if (!call.turn) {
      unknown++
      continue
    }
    const ms = eventTimestampMs(call)
    if ((!ms && call.turn.userInitiated) || call.turn.complete === false) unknown++
    const previous = points.get(call.turn.id)
    if (!previous) points.set(call.turn.id, [call.turn.id, ms, call.turn.userInitiated])
    else {
      if (ms > 0 && (!previous[1] || ms < previous[1])) previous[1] = ms
      previous[2] &&= call.turn.userInitiated
    }
  }
  return serialize({ version: 1, unknown, points: [...points.values()] } satisfies TurnData)
}

export function decodeTurnData(data: Buffer | null): TurnData | null {
  if (!data) return null
  try {
    const value = deserialize(data) as TurnData
    return value?.version === 1 &&
      Number.isSafeInteger(value.unknown) &&
      value.unknown >= 0 &&
      Array.isArray(value.points) &&
      value.points.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 3 &&
          typeof point[0] === 'string' &&
          point[0].length > 0 &&
          point[0].length <= 512 &&
          Number.isSafeInteger(point[1]) &&
          point[1] >= 0 &&
          point[1] <= 8_640_000_000_000_000 &&
          typeof point[2] === 'boolean',
      )
      ? value
      : null
  } catch {
    return null
  }
}
