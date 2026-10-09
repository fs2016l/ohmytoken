export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'paused'
  | 'waiting-network'
  | 'verifying'
  | 'downloaded'
  | 'latest'
  | 'error'

export interface UpdateInfo {
  version: string
  releaseDate?: string
  releaseNotes?: string | null
}

export interface DownloadProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond?: number
}

export interface UpdateState {
  status: UpdateStatus
  info: UpdateInfo | null
  progress: DownloadProgress | null
  error: string | null
}

export interface UpdateAsset extends UpdateInfo {
  /** Stable tracking URL; never persist the expiring CDN redirect. */
  url: string
  feedUrl: string
  fileName: string
  size: number
  sha512: string
  platform: string
  arch: string
}
