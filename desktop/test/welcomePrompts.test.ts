import { describe, it, expect } from 'vitest'
import { EXAMPLE_PROMPTS, pickExamplePrompts } from '../src/renderer/lib/welcomePrompts'

describe('pickExamplePrompts', () => {
  it('取 count 条且无重复', () => {
    const r = pickExamplePrompts(EXAMPLE_PROMPTS, 4)
    expect(r).toHaveLength(4)
    expect(new Set(r).size).toBe(4)
    r.forEach(x => expect(EXAMPLE_PROMPTS).toContain(x))
  })
  it('count ≥ 池长 → 返回全量(打乱,不丢不重)', () => {
    const r = pickExamplePrompts(EXAMPLE_PROMPTS, 999)
    expect(r).toHaveLength(EXAMPLE_PROMPTS.length)
    expect(new Set(r)).toEqual(new Set(EXAMPLE_PROMPTS))
  })
  it('count=0 → 空', () => { expect(pickExamplePrompts(EXAMPLE_PROMPTS, 0)).toEqual([]) })
  it('注入 rng 决定性', () => {
    const pool = ['a', 'b', 'c']
    const r = pickExamplePrompts(pool, 2, () => 0) // 每步 j=0
    expect(r).toHaveLength(2)
    expect(new Set(r).size).toBe(2)
  })
})
