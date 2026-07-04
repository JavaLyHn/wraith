import { describe, it, expect } from 'vitest'
import { maskId, bindPhaseLabel } from '../src/renderer/lib/gatewayLabels'

describe('maskId', () => {
  it('masks the middle of long ids', () => {
    expect(maskId('1905004340')).toBe('1905****4340')
  })
  it('handles short ids and null', () => {
    expect(maskId(null)).toBe('—')
    expect(maskId('abcd')).toBe('ab****')
  })
})

describe('bindPhaseLabel', () => {
  it('renders each phase; secret-invalid uses provided message', () => {
    expect(bindPhaseLabel('bound')).toContain('绑定成功')
    expect(bindPhaseLabel('scanning')).toContain('扫码')
    expect(bindPhaseLabel('secret-invalid', '自定义提示')).toBe('自定义提示')
    expect(bindPhaseLabel('failed')).toContain('失败')
    expect(bindPhaseLabel('cancelled')).toContain('取消')
  })
})
