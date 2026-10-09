import { ipcRenderer } from 'electron'
import type { ReplayAPI } from '../shared/replay'
import { REPLAY_IPC as IPC } from '../main/ipc/replay-channels'

export const replayAPI: ReplayAPI = {
  replayList: () => ipcRenderer.invoke(IPC.REPLAY_LIST),
  replayBegin: (input) => ipcRenderer.invoke(IPC.REPLAY_BEGIN, input),
  replayWrite: (id, position, bytes) => ipcRenderer.invoke(IPC.REPLAY_WRITE, id, position, bytes),
  replayFinish: (id, thumbnail) => ipcRenderer.invoke(IPC.REPLAY_FINISH, id, thumbnail),
  replayCancel: (id, failure) => ipcRenderer.invoke(IPC.REPLAY_CANCEL, id, failure),
  replayRead: (id) => ipcRenderer.invoke(IPC.REPLAY_READ, id),
  replayRemove: (id) => ipcRenderer.invoke(IPC.REPLAY_REMOVE, id),
  replaySaveCopy: (id) => ipcRenderer.invoke(IPC.REPLAY_SAVE_COPY, id),
  replayOpenFolder: (id) => ipcRenderer.invoke(IPC.REPLAY_OPEN_FOLDER, id),
  replayStorageInfo: () => ipcRenderer.invoke(IPC.REPLAY_STORAGE_INFO),
  replayChooseStorageDirectory: () => ipcRenderer.invoke(IPC.REPLAY_STORAGE_CHOOSE),
  replayResetStorageDirectory: () => ipcRenderer.invoke(IPC.REPLAY_STORAGE_RESET),
}
