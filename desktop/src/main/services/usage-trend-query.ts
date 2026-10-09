interface TrendRangeParams {
  from?: number
  to?: number
  baseline?: boolean
}

export function usageTrendRange(
  params: TrendRangeParams | undefined,
  now = Date.now(),
): { from: number; to: number } {
  const requestedTo = typeof params?.to === 'number' && Number.isFinite(params.to) ? params.to : now
  const to = Math.max(0, Math.min(requestedTo, now))
  const requestedFrom =
    typeof params?.from === 'number' && Number.isFinite(params.from) ? params.from : to - 86_400_000
  // A fixed baseline may be recent or older than the rolling-window limit.
  const minFrom = params?.baseline === true ? 0 : to - 31 * 86_400_000
  const maxFrom = params?.baseline === true ? to : to - 60_000
  return { from: Math.max(minFrom, Math.min(requestedFrom, maxFrom)), to }
}
