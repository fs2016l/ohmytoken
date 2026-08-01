import type { DesktopFeedbackSubmitParams } from '@shared/desktop-api'

export type FeedbackSubmitParams = DesktopFeedbackSubmitParams

export async function submitFeedback(params: FeedbackSubmitParams): Promise<number> {
  return await window.api.submitDesktopFeedback(params)
}
