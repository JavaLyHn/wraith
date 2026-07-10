import { describe, it, expect } from 'vitest'
import { hasToolParams } from '../src/renderer/lib/toolParams'

describe('hasToolParams', () => {
  it('null/undefined → false', () => {
    expect(hasToolParams(null)).toBe(false)
    expect(hasToolParams(undefined)).toBe(false)
  })
  it('非对象(字符串/数字)→ false', () => {
    expect(hasToolParams('x')).toBe(false)
    expect(hasToolParams(42)).toBe(false)
  })
  it('空对象 → false', () => {
    expect(hasToolParams({})).toBe(false)
  })
  it('非空对象 → true', () => {
    expect(hasToolParams({ type: 'object' })).toBe(true)
  })
})
