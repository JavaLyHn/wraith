import { describe, it, expect } from 'vitest'
import { withNoActivate, applyNoActivate, WS_EX_NOACTIVATE } from '../src/main/winPetStyle'

describe('withNoActivate', () => {
  it('0 → WS_EX_NOACTIVATE', () => {
    expect(withNoActivate(0)).toBe(0x08000000)
  })
  it('置位并保留既有位(如 WS_EX_LAYERED 0x80000)', () => {
    expect(withNoActivate(0x00080000)).toBe(0x00080000 | 0x08000000)
  })
  it('幂等:已置位再置仍相等', () => {
    expect(withNoActivate(WS_EX_NOACTIVATE)).toBe(WS_EX_NOACTIVATE)
  })
  it('归一为无符号 32 位整数', () => {
    const r = withNoActivate(0x12345678)
    expect(Number.isInteger(r)).toBe(true)
    expect(r).toBeGreaterThanOrEqual(0)
  })
})

describe('applyNoActivate 非 win32', () => {
  it('darwin/linux 上 no-op、不抛、不触碰 win 句柄', () => {
    // 测试宿主非 win32 → 应提前 return;若误入 win32 分支会调 getNativeWindowHandle 抛错
    const fakeWin = {
      getNativeWindowHandle() { throw new Error('不应在非 win32 被调用') },
    } as unknown as import('electron').BrowserWindow
    expect(() => applyNoActivate(fakeWin)).not.toThrow()
  })
})
