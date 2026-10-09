import { ipcRenderer } from 'electron'
import { DISCOVERY_IPC, type DiscoveryNativeAPI } from '../shared/discovery-ui'

export const discoveryUiAPI: DiscoveryNativeAPI = {
  discoveryCopy: (text) => ipcRenderer.invoke(DISCOVERY_IPC.DISCOVERY_COPY, text),
  discoveryUiOpen: (pageKey, force = false) =>
    ipcRenderer.invoke(DISCOVERY_IPC.DISCOVERY_UI_OPEN, pageKey, force),
  discoveryCatalog: (request) => ipcRenderer.invoke(DISCOVERY_IPC.DISCOVERY_CATALOG, request),
}
