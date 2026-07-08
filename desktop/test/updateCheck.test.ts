import { describe, it, expect } from 'vitest'
import { isNewerVersion } from '../src/main/updateCheck'

describe('isNewerVersion', () => {
  it('补丁号更高 → true', () => expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true))
  it('次版本更高(跨个位)→ true', () => expect(isNewerVersion('1.1.0', '1.0.9')).toBe(true))
  it('相等 → false', () => expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false))
  it('更低 → false', () => expect(isNewerVersion('1.0.0', '2.0.0')).toBe(false))
  it('剥离前导 v', () => expect(isNewerVersion('v1.0.1', '1.0.0')).toBe(true))
  it('非法串 → 安全 false(不误报更新)', () => {
    expect(isNewerVersion('abc', '1.0.0')).toBe(false)
    expect(isNewerVersion('', '1.0.0')).toBe(false)
  })
})
