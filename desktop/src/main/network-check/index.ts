import type { NetworkCheckSnapshot } from '../../shared/network-check'
import { NetworkCheckEngine } from './engine'
import { createNetworkFetcher } from './http'
import { openDatabase } from '../services/sqlite-storage.service'
import { NetworkCheckSnapshotStore } from './snapshot-store'

export function createNetworkCheckService(
  onChange: (snapshot: NetworkCheckSnapshot) => void,
): NetworkCheckEngine {
  return new NetworkCheckEngine({
    createFetcher: createNetworkFetcher,
    onChange,
    storage: new NetworkCheckSnapshotStore(openDatabase()),
  })
}
