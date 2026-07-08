import { describe, it, expect } from 'vitest'
import { VadSegmenter, DEFAULT_VAD } from '../src/renderer/lib/vadSegmenter'

const feedN = (seg: VadSegmenter, level: number, totalMs: number, stepMs = 100): (ReturnType<VadSegmenter['feed']>)[] => {
  const out = []
  for (let t = 0; t < totalMs; t += stepMs) out.push(seg.feed(level, stepMs))
  return out
}

describe('VadSegmenter', () => {
  it('有语音后静音累积到 silenceHoldMs → cut(silence)', () => {
    const s = new VadSegmenter()
    feedN(s, 0.5, 1000)                         // 1s 有声(> minSegmentMs)
    const during = feedN(s, 0.0, DEFAULT_VAD.silenceHoldMs - 100)  // 静音还不够
    expect(during.some(d => d.cut)).toBe(false)
    const d = s.feed(0.0, 200)                  // 再补静音越过阈值
    expect(d).toEqual({ cut: true, reason: 'silence' })
  })

  it('持续有声到 maxSegmentMs → cut(maxlen)', () => {
    const s = new VadSegmenter()
    const decisions = feedN(s, 0.5, DEFAULT_VAD.maxSegmentMs + 200)
    const cut = decisions.find(d => d.cut)
    expect(cut?.reason).toBe('maxlen')
  })

  it('太短(< minSegmentMs)即使静音也不 cut', () => {
    const s = new VadSegmenter()
    s.feed(0.5, 100)                            // 100ms 有声,远小于 minSegmentMs
    const d = s.feed(0.0, DEFAULT_VAD.silenceHoldMs + 100)
    expect(d.cut).toBe(false)
  })

  it('从未出现语音(纯静音)→ 不 cut', () => {
    const s = new VadSegmenter()
    const decisions = feedN(s, 0.0, DEFAULT_VAD.maxSegmentMs + 500)
    expect(decisions.every(d => !d.cut)).toBe(true)
  })

  it('reset 后重新计数', () => {
    const s = new VadSegmenter()
    feedN(s, 0.5, 1000); s.feed(0.0, DEFAULT_VAD.silenceHoldMs + 200)
    s.reset()
    const d = s.feed(0.0, DEFAULT_VAD.silenceHoldMs + 200)  // reset 后无语音 → 不 cut
    expect(d.cut).toBe(false)
  })
})
