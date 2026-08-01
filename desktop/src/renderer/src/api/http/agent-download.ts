/**
 * 智能体下载目录 API。
 * 目录内容由 ohmytokencom 后端控制，桌面端只负责展示并打开官方页面。
 */
import { ohmytokenApi } from './index'

export interface AgentDownloadItem {
  id: number
  agentCode: string
  name: string
  nameEn?: string
  vendor: string
  vendorEn?: string
  description: string
  descriptionEn?: string
  category: 'coding' | 'general'
  logoUrl?: string
  officialUrl: string
  highlights: string[]
  highlightsEn: string[]
  featured: boolean
}

export function getAgentDownloads() {
  return ohmytokenApi.get('/agent-download/list')
}
