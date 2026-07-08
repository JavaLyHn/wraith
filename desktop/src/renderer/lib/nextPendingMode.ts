import type { RunMode } from '../../shared/types'

/** 提交后模式保持不变（粘性）：用户选定的模式一直生效，直到手动切换。 */
export function pendingModeAfterSubmit(current: RunMode): RunMode {
  return current
}
