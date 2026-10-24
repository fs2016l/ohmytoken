import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc/channels'
import type { PlanRenewalsAPI } from '../shared/plan-renewals'

export const planRenewalsAPI: PlanRenewalsAPI = {
  planRenewalsList: () => ipcRenderer.invoke(IPC.PLAN_RENEWALS_LIST),
  planRenewalsSave: (input) => ipcRenderer.invoke(IPC.PLAN_RENEWALS_SAVE, input),
  planRenewalsDelete: (id) => ipcRenderer.invoke(IPC.PLAN_RENEWALS_DELETE, id),
  planRenewalsReorder: (ids) => ipcRenderer.invoke(IPC.PLAN_RENEWALS_REORDER, ids),
  planRenewalsComplete: (id, renewOn) =>
    ipcRenderer.invoke(IPC.PLAN_RENEWALS_COMPLETE, { id, renewOn }),
}
