export const AGENT_DEVICE_ID_HEADER = 'X-Ohmytoken-Device-Id'
export const AGENT_USER_ID_HEADER = 'X-Ohmytoken-User-Id'
export const AGENT_DEVICE_CREDENTIAL_HEADER = 'X-Ohmytoken-Device-Credential'

/** com 内容目录接口的设备准入拒绝码；401 + 该 code 表示凭证缺失/失效，应重新登记。 */
export const DEVICE_CREDENTIAL_INVALID_CODE = 7016

export interface AgentRequestIdentity {
  deviceId: string
  userId: number | null
  /** 服务端签发的内容接口准入凭证；尚未取得（登记失败或旧服务端）时为 null。 */
  deviceCredential?: string | null
}

export type AgentRequestIdentityResult =
  { status: 'ready'; identity: AgentRequestIdentity } | { status: 'unavailable'; message: string }

export function agentIdentityHeaders(identity: AgentRequestIdentity): Record<string, string> {
  return {
    [AGENT_DEVICE_ID_HEADER]: identity.deviceId,
    ...(identity.userId !== null ? { [AGENT_USER_ID_HEADER]: String(identity.userId) } : {}),
    ...(identity.deviceCredential
      ? { [AGENT_DEVICE_CREDENTIAL_HEADER]: identity.deviceCredential }
      : {}),
  }
}

export interface DeviceCredentialIssued {
  credential: string
  /** 服务端下发的空闲有效期（秒）；本地按接收时间折算绝对过期时刻。 */
  expiresIn: number
}

/** 校验注册响应里的设备凭证字段；结构不完整（如旧服务端）返回 null。 */
export function parseDeviceCredential(data: unknown): DeviceCredentialIssued | null {
  if (!data || typeof data !== 'object') return null
  const candidate = data as { credential?: unknown; expiresIn?: unknown }
  if (typeof candidate.credential !== 'string' || candidate.credential.length === 0) return null
  if (
    typeof candidate.expiresIn !== 'number' ||
    !Number.isFinite(candidate.expiresIn) ||
    candidate.expiresIn <= 0
  ) {
    return null
  }
  return { credential: candidate.credential, expiresIn: candidate.expiresIn }
}
