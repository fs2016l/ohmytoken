/**
 * 信息差相关 API 接口
 * 注意：信息差数据来自 ohmytokencom 后端，使用独立的 ohmytokenApi 实例，
 * 其 baseURL 由主进程唯一配置并经 IPC 下发。
 *
 * 前端产品语义叫 insight，后端保留 News 模块命名：
 * /news/page 返回轻量目录，/news/detail/{id} 在用户打开弹窗后按需返回正文。
 */
import { ohmytokenApi } from './index'

/**
 * 信息差标签类型
 */
export interface InsightTag {
  en: string
  zh: string
}

/**
 * 信息差项类型
 */
export interface InsightItem {
  id: number
  date: string
  titleEn: string
  titleZh: string
  summaryEn: string
  summaryZh: string
  /** com 根据 COS objectKey 动态拼出的媒体 CDN URL；为空时不加载任何第三方占位图。 */
  imageUrl?: string
  tags: InsightTag[]
  source: string
  isTop: boolean
}

/**
 * 用户打开信息差详情后按 ID 获取的 Markdown 正文。
 */
export interface InsightDetail {
  id: number
  contentEn: string
  contentZh: string
}

export interface InsightPageParams {
  pageNum: number
  pageSize: number
  keyword?: string
}

export interface InsightPageResult {
  list: InsightItem[]
  total: number
  pageNum: number
  pageSize: number
  pages: number
}

interface InsightPageResponse {
  code: number
  msg?: string
  data: InsightPageResult
}

interface InsightDetailResponse {
  code: number
  msg?: string
  data: InsightDetail
}

/**
 * 分页获取信息差目录；响应只包含列表展示字段，不携带 Markdown 正文。
 */
export function getInsightsPage(params: InsightPageParams) {
  return ohmytokenApi.get<InsightPageResponse>('/news/page', { params })
}

/**
 * 用户打开详情时按需获取 Markdown 正文。
 */
export function getInsightDetail(id: number, signal?: AbortSignal) {
  return ohmytokenApi.get<InsightDetailResponse>('/news/detail/' + id, { signal })
}
