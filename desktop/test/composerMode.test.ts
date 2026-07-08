import { describe, it, expect } from 'vitest'
import { pendingModeAfterSubmit } from '../src/renderer/lib/nextPendingMode'

describe('pendingModeAfterSubmit', () => {
  it('提交后保持当前模式(粘性)——选定模式一直生效直到手动切换', () => {
    expect(pendingModeAfterSubmit('plan')).toBe('plan')
    expect(pendingModeAfterSubmit('react')).toBe('react')
  })
})
