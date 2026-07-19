import { describe, it, expect } from 'vitest'
import { shouldDismissSplash, SPLASH_FLOOR_MS, SPLASH_CAP_MS } from '../src/main/splash'

describe('shouldDismissSplash', () => {
  it('未到地板即便已就绪也不散', () => {
    expect(shouldDismissSplash(800, true)).toBe(false)
  })
  it('已就绪且过地板 → 散', () => {
    expect(shouldDismissSplash(SPLASH_FLOOR_MS, true)).toBe(true)
    expect(shouldDismissSplash(SPLASH_FLOOR_MS + 300, true)).toBe(true)
  })
  it('未就绪 → 一直等(logo 持续陪加载),不到失败保险天花板不散', () => {
    expect(shouldDismissSplash(3000, false)).toBe(false)
    expect(shouldDismissSplash(5000, false)).toBe(false)          // 旧行为会在此散,新行为继续等
    expect(shouldDismissSplash(SPLASH_CAP_MS - 1, false)).toBe(false)
  })
  it('到失败保险天花板 → 强制散(后端始终连不上时防卡死)', () => {
    expect(shouldDismissSplash(SPLASH_CAP_MS, false)).toBe(true)
    expect(shouldDismissSplash(SPLASH_CAP_MS + 5000, false)).toBe(true)
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
  it('shine 循环播放(加载期间持续闪烁,而非只闪一次)', () => {
    expect(html).toMatch(/animation:shine[^;]*infinite/)
  })
})
