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

import { buildSplashHtml } from '../src/main/splash'

describe('buildSplashHtml', () => {
  const html = buildSplashHtml('data:image/png;base64,AAAA')
  it('内联传入的 logo data URI', () => {
    expect(html).toContain('src="data:image/png;base64,AAAA"')
  })
  it('含幽灵浮现入场动画关键帧', () => {
    expect(html).toContain('@keyframes ghostIn')
  })
  it('含散去 hook(__dismiss + dismiss class)', () => {
    expect(html).toContain('window.__dismiss')
    expect(html).toContain("classList.add('dismiss')")
  })
  it('含 reduced-motion 降级', () => {
    expect(html).toContain('prefers-reduced-motion')
  })
  it('背景透明', () => {
    expect(html).toContain('background:transparent')
  })
  it('含渐变光泽扫过(shine)动画 + logo mask', () => {
    expect(html).toContain('@keyframes shine')
    expect(html).toContain('mask:url(data:image/png;base64,AAAA)')
  })
})
