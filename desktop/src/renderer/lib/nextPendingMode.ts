import type { RunMode } from '../../shared/types'

/** 提交后模式复位：逐条语义——发完永远回 react。 */
export function pendingModeAfterSubmit(_current: RunMode): RunMode {
  return 'react'
}
