/**
 * 套餐相关 API 接口
 * 注意：套餐数据来自 ohmytokencom 后端，使用独立的 ohmytokenApi 实例，
 * 其 baseURL 由主进程唯一配置并经 IPC 下发。
 */
import { ohmytokenApi } from './index'

/**
 * 获取所有套餐列表（公开接口）
 * @returns 套餐列表
 */
export function getAllPlans() {
  return ohmytokenApi.get('/plan/list')
}
