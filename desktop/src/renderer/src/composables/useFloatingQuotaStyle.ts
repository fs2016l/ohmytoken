import { ref } from 'vue'

export type FloatingQuotaStyle = 'bars' | 'orbs'

const storageKey = 'floating-quota-style'

function readStyle(): FloatingQuotaStyle {
  try {
    return localStorage.getItem(storageKey) === 'orbs' ? 'orbs' : 'bars'
  } catch {
    return 'bars'
  }
}

// 浮窗标签栏的切换按钮与额度列表共用同一状态，偏好保存在当前设备。
const style = ref<FloatingQuotaStyle>(readStyle())

export function useFloatingQuotaStyle() {
  function toggle(): void {
    style.value = style.value === 'bars' ? 'orbs' : 'bars'
    try {
      localStorage.setItem(storageKey, style.value)
    } catch {
      // 存储不可用时只在本次运行中生效。
    }
  }
  return { style, toggle }
}
