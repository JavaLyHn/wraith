import { describe, it, expect } from 'vitest'
import { shouldDismissSplash, SPLASH_FLOOR_MS, SPLASH_CAP_MS } from '../src/main/splash'

describe('shouldDismissSplash', () => {
  it('未到地板即便已就绪也不散', () => {
    expect(shouldDismissSplash(800, true)).toBe(false)
  })
  it('已就绪且过地板 → 散', () => {
    expect(shouldDismissSplash(SPLASH_FLOOR_MS, true)).toBe(true)
    expect(shouldDismissSplash(1500, true)).toBe(true)
  })
  it('未就绪、未到天花板 → 不散', () => {
    expect(shouldDismissSplash(3000, false)).toBe(false)
  })
  it('到天花板 → 强制散(即便未就绪)', () => {
    expect(shouldDismissSplash(SPLASH_CAP_MS, false)).toBe(true)
    expect(shouldDismissSplash(5000, false)).toBe(true)
  })
  it('自定义 floor/cap 生效', () => {
    expect(shouldDismissSplash(500, true, 400, 2000)).toBe(true)
    expect(shouldDismissSplash(300, true, 400, 2000)).toBe(false)
  })
})
