/**
 * API 层 barrel — 统一入口
 *
 * 调用方使用：
 *   import api from '@/api'
 *
 * 内部分层：
 *   - ipc/  本地 IPC（Electron 主进程，包装 window.api.*）
 *   - http/ 远程 HTTP（ohmytokencom 后端，axios 实例）
 */

// IPC：默认 export（保持现有 Agent 页面调用方式）
export { default } from './ipc'
export { api } from './ipc'

// HTTP：命名 export
export { ohmytokenApi } from './http'
