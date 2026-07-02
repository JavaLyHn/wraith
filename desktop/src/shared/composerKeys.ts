/**
 * Composer 发送判定 — 纯 TS。
 * IME 组合态(选词确认)的 Enter 绝不发送:isComposing 为主判,
 * keyCode 229 兜 Safari/旧 Chromium(组合会话期间 keydown 恒为 229)。
 * running 中 Enter 不发送(输入框解锁供打草稿)。
 */
export interface EnterKeyInfo {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode?: number
}

export function shouldSendOnEnter(k: EnterKeyInfo, running: boolean): boolean {
  if (running) return false
  if (k.key !== 'Enter' || k.shiftKey) return false
  if (k.isComposing || k.keyCode === 229) return false
  return true
}
