/**
 * 窗口状态持久化服务
 *
 * 保存用户调整后的窗口大小和位置到 ~/.ohmytoken/window-state.json，
 * 下次启动时恢复。首次启动使用默认值 1600×800。
 */
import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { getAppDataDir } from '../lib/paths'

const STATE_DIR = getAppDataDir()
const STATE_FILE = join(STATE_DIR, 'window-state.json')

/** 默认窗口大小（用户首次打开时） */
const DEFAULT_WIDTH = 1600
const DEFAULT_HEIGHT = 800

/**
 * 坐标是否位于任何一块屏幕的可视区域内（含一定容差）。
 * M10 修复：多显示器场景下拔掉外接显示器后，原窗口坐标可能落在所有屏幕之外，
 * 下次启动时窗口将出现在屏幕外不可见。此时丢弃 x/y 让 Electron 用默认居中位置。
 *
 * @param tolerance 容差像素，窗口边缘允许稍微超出屏幕（如 -50 表示允许左/上各超出 50px）
 */
function isPointInAnyDisplay(x: number, y: number, tolerance = 50): boolean {
  const displays = screen.getAllDisplays()
  for (const display of displays) {
    const b = display.bounds
    if (
      x >= b.x - tolerance &&
      x <= b.x + b.width + tolerance &&
      y >= b.y - tolerance &&
      y <= b.y + b.height + tolerance
    ) {
      return true
    }
  }
  return false
}

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized?: boolean
}

/** 读取上次保存的窗口状态，没有则返回默认值 */
export function loadWindowState(): WindowState {
  try {
    if (existsSync(STATE_FILE)) {
      const data = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
      // 合并默认值，确保 width/height 一定有
      return {
        width: data.width || DEFAULT_WIDTH,
        height: data.height || DEFAULT_HEIGHT,
        x: typeof data.x === 'number' ? data.x : undefined,
        y: typeof data.y === 'number' ? data.y : undefined,
        isMaximized: !!data.isMaximized,
      }
    }
  } catch {
    // 读取/解析失败，忽略，用默认值
  }
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
}

/**
 * 监听窗口关闭事件，关闭时保存一次大小和位置。
 * 不在 resize/move 过程中频繁写入，只在 close 时记录。
 *
 * M10 修复：保存 bounds 前校验 (x,y) 是否在任何一块屏幕内（含容差），
 * 不在则丢弃 x/y（让下次启动用默认居中位置），避免多显示器拔屏后窗口在屏幕外不可见。
 * width/height 仍正常保存。
 */
export function trackWindowState(window: BrowserWindow): void {
  window.on('close', () => {
    try {
      const bounds = window.getBounds()
      // 校验窗口左上角坐标是否在任何屏幕可视区域内
      const visible = isPointInAnyDisplay(bounds.x, bounds.y)
      const state: WindowState = {
        width: bounds.width,
        height: bounds.height,
        // 坐标在屏幕外（如外接显示器已拔掉）则丢弃，让下次创建用默认居中位置
        x: visible ? bounds.x : undefined,
        y: visible ? bounds.y : undefined,
        isMaximized: window.isMaximized(),
      }
      if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
    } catch {
      // 写入失败忽略
    }
  })
}
