import { describe, it, expect } from 'vitest'
import { pendingModeAfterSubmit } from '../src/renderer/lib/nextPendingMode'

describe('pendingModeAfterSubmit', () => {
  it('提交后永远复位 react', () => {
    expect(pendingModeAfterSubmit('plan')).toBe('react')
    expect(pendingModeAfterSubmit('react')).toBe('react')
  })
})
