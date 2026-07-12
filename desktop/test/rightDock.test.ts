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

import { fitZoom, FIT_TARGET_WIDTH, FIT_MIN_ZOOM } from '../src/renderer/lib/rightDock'

describe('fitZoom', () => {
  it('面板 ≥ 目标宽 → 1(不缩)', () => {
    expect(fitZoom(1000, 1000)).toBe(1)
    expect(fitZoom(1400, 1000)).toBe(1)
  })
  it('窄面板 → 面板宽/目标宽', () => {
    expect(fitZoom(600, 1000)).toBeCloseTo(0.6, 5)
    expect(fitZoom(800, 1000)).toBeCloseTo(0.8, 5)
  })
  it('极窄面板夹到下限 FIT_MIN_ZOOM', () => {
    expect(fitZoom(300, 1000)).toBe(FIT_MIN_ZOOM)
  })
  it('非法宽度 → 1(安全)', () => {
    expect(fitZoom(0, 1000)).toBe(1)
    expect(fitZoom(-5, 1000)).toBe(1)
    expect(fitZoom(600, 0)).toBe(1)
  })
  it('默认目标宽 = FIT_TARGET_WIDTH', () => {
    expect(fitZoom(FIT_TARGET_WIDTH)).toBe(1)
    expect(fitZoom(FIT_TARGET_WIDTH / 2)).toBeCloseTo(0.5, 5)
  })
})
