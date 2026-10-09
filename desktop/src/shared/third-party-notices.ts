export const THIRD_PARTY_IPC = {
  NOTICES_LIST: 'third-party-notices:list',
  NOTICES_READ: 'third-party-notices:read',
  NOTICES_CHROMIUM: 'third-party-notices:chromium',
} as const

export interface ThirdPartyEntry {
  id: string
  name: string
  version: string
  license: string
  category: 'package' | 'font' | 'runtime'
  project: string
  source: string
  documents: { name: string; source: string }[]
  external?: 'chromium'
}

export interface ThirdPartyCatalogue {
  applicationVersion: string
  entries: ThirdPartyEntry[]
}

export interface ThirdPartyNoticesAPI {
  thirdPartyNoticesList(): Promise<ThirdPartyCatalogue>
  thirdPartyNoticesRead(id: string, document: number): Promise<string>
  thirdPartyNoticesOpenChromium(): Promise<void>
}
