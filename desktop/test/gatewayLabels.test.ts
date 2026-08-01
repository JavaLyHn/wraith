import { describe, it, expect } from 'vitest'
import { maskId, bindPhaseLabel, platformStatusText, platformStatusColor } from '../src/renderer/lib/gatewayLabels'

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

describe('platformStatusText', () => {
  it('available + configured → 已配置', () => {
    expect(platformStatusText('available', true)).toBe('✓ 已配置')
  })
  it('available + not configured → 可配置', () => {
    expect(platformStatusText('available', false)).toBe('可配置')
  })
  it('unavailable (soon) → 即将支持,无论是否 configured', () => {
    expect(platformStatusText('soon', false)).toBe('即将支持')
    expect(platformStatusText('soon', true)).toBe('即将支持')
  })
})

describe('platformStatusColor', () => {
  it('available + configured → text-ok', () => {
    expect(platformStatusColor('available', true)).toBe('text-ok')
  })
  it('available + not configured → text-fg-subtle', () => {
    expect(platformStatusColor('available', false)).toBe('text-fg-subtle')
  })
  it('unavailable → text-fg-subtle,无论是否 configured', () => {
    expect(platformStatusColor('soon', true)).toBe('text-fg-subtle')
  })
})
