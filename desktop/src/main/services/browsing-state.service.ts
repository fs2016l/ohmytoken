import { createBoundedBrowsingState } from '../../shared/browsing-state'

/** Process memory only. No browsing data survives a full application restart. */
export function createBrowsingStateStore() {
  return createBoundedBrowsingState()
}
