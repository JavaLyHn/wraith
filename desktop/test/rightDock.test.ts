import { describe, it, expect } from 'vitest'
import { clampColumnWidth, normalizeUrl } from '../src/renderer/lib/rightDock'

describe('clampColumnWidth', () => {
  it('区间内原样', () => { expect(clampColumnWidth(500, 1200)).toBe(500) })
  it('低于 min(320)夹到 320', () => { expect(clampColumnWidth(100, 1200)).toBe(320) })
  it('高于 max(0.7*winW)夹到 max', () => { expect(clampColumnWidth(1000, 1200)).toBe(840) })
  it('窄窗:max 不低于 320', () => { expect(clampColumnWidth(500, 400)).toBe(320) })
})

describe('normalizeUrl', () => {
  it('空 → about:blank', () => { expect(normalizeUrl('   ')).toBe('about:blank') })
  it('无协议补 https://', () => { expect(normalizeUrl('example.com')).toBe('https://example.com') })
  it('已带协议原样', () => {
    expect(normalizeUrl('http://x.com')).toBe('http://x.com')
    expect(normalizeUrl('https://y.com/a?b=1')).toBe('https://y.com/a?b=1')
  })
  it('about: 原样', () => { expect(normalizeUrl('about:blank')).toBe('about:blank') })
})
