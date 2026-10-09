import { ipcRenderer } from 'electron'
import { THIRD_PARTY_IPC as IPC, type ThirdPartyNoticesAPI } from '../shared/third-party-notices'

export const thirdPartyNoticesAPI: ThirdPartyNoticesAPI = {
  thirdPartyNoticesList: () => ipcRenderer.invoke(IPC.NOTICES_LIST),
  thirdPartyNoticesRead: (id, document) => ipcRenderer.invoke(IPC.NOTICES_READ, id, document),
  thirdPartyNoticesOpenChromium: () => ipcRenderer.invoke(IPC.NOTICES_CHROMIUM),
}
