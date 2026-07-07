import { describe, it, expect } from 'vitest'
import { micLevel, waveBars, idleBars } from '../src/renderer/lib/waveform'

describe('micLevel', () => {
  it('全静音(128) → 0', () => {
    expect(micLevel(new Uint8Array([128, 128, 128, 128]))).toBe(0)
  })
  it('满偏差 → 接近 1', () => {
    expect(micLevel(new Uint8Array([255, 0, 255, 0]))).toBeGreaterThan(0.9)
  })
  it('空数组 → 0', () => {
    expect(micLevel(new Uint8Array([]))).toBe(0)
  })
})

describe('waveBars', () => {
  it('返回 n 个,全在 [0.1,1]', () => {
    const b = waveBars(0.5, 1.2, 5)
    expect(b).toHaveLength(5)
    for (const h of b) { expect(h).toBeGreaterThanOrEqual(0.1); expect(h).toBeLessThanOrEqual(1) }
  })
  it('level 越大,竖条跨度越大(说话浪更高)', () => {
    const span = (a: number[]): number => Math.max(...a) - Math.min(...a)
    expect(span(waveBars(1, 0, 5))).toBeGreaterThan(span(waveBars(0, 0, 5)))
  })
  it('纯函数:相同输入相同输出', () => {
    expect(waveBars(0.5, 1, 4)).toEqual(waveBars(0.5, 1, 4))
  })
})

describe('idleBars', () => {
  it('返回 n 个,全在 (0,1],中间最高', () => {
    const b = idleBars(5)
    expect(b).toHaveLength(5)
    for (const h of b) { expect(h).toBeGreaterThan(0); expect(h).toBeLessThanOrEqual(1) }
    expect(Math.max(...b)).toBe(b[2])
  })
})
