/** Direction only applies between a discovery list (including favorites) and its detail. */
export function discoveryPageTransition(from: string, to: string): string {
  const previous = /^\/(insight|agent-download)(?:\/(favorites|\d+))?$/.exec(from)
  const next = /^\/(insight|agent-download)(?:\/(favorites|\d+))?$/.exec(to)
  if (!previous || !next || previous[1] !== next[1]) return 'workspace-page'
  const wasDetail = !!previous[2] && previous[2] !== 'favorites'
  const isDetail = !!next[2] && next[2] !== 'favorites'
  if (!wasDetail && isDetail) return 'discovery-forward'
  if (wasDetail && !isDetail) return 'discovery-back'
  return 'workspace-page'
}
