export const AGENT_DEVICE_ID_HEADER = 'X-Ohmytoken-Device-Id'
export const AGENT_USER_ID_HEADER = 'X-Ohmytoken-User-Id'

export interface AgentRequestIdentity {
  deviceId: string
  userId: number | null
}

export function agentIdentityHeaders(identity: AgentRequestIdentity): Record<string, string> {
  return {
    [AGENT_DEVICE_ID_HEADER]: identity.deviceId,
    ...(identity.userId !== null ? { [AGENT_USER_ID_HEADER]: String(identity.userId) } : {}),
  }
}
