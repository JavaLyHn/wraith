import { describe, expect, it } from 'vitest'
import { topBarLeftPad } from '../src/renderer/lib/topBar'

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
