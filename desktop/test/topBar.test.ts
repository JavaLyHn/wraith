import { describe, expect, it } from 'vitest'
import { topBarLeftPad, shouldShowWindowControls } from '../src/renderer/lib/topBar'

describe('topBarLeftPad', () => {
  it('darwin → 让开交通灯', () => {
    expect(topBarLeftPad('darwin')).toBe('pl-[80px]')
  })
  it('非 darwin → 贴左', () => {
    for (const p of ['win32', 'linux', 'freebsd', '']) {
      expect(topBarLeftPad(p)).toBe('pl-2')
    }
  })
})

describe('shouldShowWindowControls', () => {
  it('仅 win32 显示自绘窗控', () => {
    expect(shouldShowWindowControls('win32')).toBe(true)
    for (const p of ['darwin', 'linux', 'freebsd', '']) {
      expect(shouldShowWindowControls(p)).toBe(false)
    }
  })
})
