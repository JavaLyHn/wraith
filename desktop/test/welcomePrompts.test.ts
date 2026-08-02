import { describe, it, expect } from 'vitest'
import { PROMPT_CATEGORIES, pickExamplePrompts, isSelfContained } from '../src/renderer/lib/welcomePrompts'

describe('pickExamplePrompts', () => {
  const pool = ['a', 'b', 'c', 'd']
  it('取 count 条且无重复', () => {
    const r = pickExamplePrompts(pool, 2)
    expect(r).toHaveLength(2)
    expect(new Set(r).size).toBe(2)
    r.forEach(x => expect(pool).toContain(x))
  })
  it('count ≥ 池长 → 返回全量(打乱,不丢不重)', () => {
    const r = pickExamplePrompts(pool, 999)
    expect(r).toHaveLength(pool.length)
    expect(new Set(r)).toEqual(new Set(pool))
  })
  it('count=0 → 空', () => { expect(pickExamplePrompts(pool, 0)).toEqual([]) })
  it('注入 rng 决定性', () => {
    const r = pickExamplePrompts(['a', 'b', 'c'], 2, () => 0) // 每步 j=0
    expect(r).toHaveLength(2)
    expect(new Set(r).size).toBe(2)
  })
})

/**
 * 旧版示例是一排以冒号结尾的半句(「重构这个函数,让它更清晰:」),点一下只把半句填进输入框,
 * 冒号后面填什么还得用户自己想 —— 而首页空态服务的正是"还不知道能让它干什么"的时刻,
 * 半句等于把问题原样退回去。这组断言把"叶子必须完整可跑"钉死,免得半句被加回来。
 */
describe('示例目录', () => {
  it('每条叶子都自足:不以冒号收尾、不留占位', () => {
    for (const c of PROMPT_CATEGORIES) {
      for (const p of c.prompts) {
        expect(isSelfContained(p), `「${p}」不是完整可跑的一句话`).toBe(true)
      }
    }
  })

  it('isSelfContained 认得出半句(判据本身不能是摆设)', () => {
    expect(isSelfContained('重构这个函数,让它更清晰:')).toBe(false)   // 旧版原文
    expect(isSelfContained('为这个模块写说明文档：')).toBe(false)       // 全角冒号
    expect(isSelfContained('分析 ___ 的结构')).toBe(false)
    expect(isSelfContained('   ')).toBe(false)
    expect(isSelfContained('梳理这个目录的结构,说明每个部分是做什么的')).toBe(true)
  })

  it('每个类别至少两条建议 —— 只有一条就不值得多一层点击', () => {
    for (const c of PROMPT_CATEGORIES) {
      expect(c.prompts.length, c.label).toBeGreaterThanOrEqual(2)
    }
  })

  it('类别名与叶子都不重复', () => {
    const labels = PROMPT_CATEGORIES.map(c => c.label)
    expect(new Set(labels).size).toBe(labels.length)
    const all = PROMPT_CATEGORIES.flatMap(c => c.prompts)
    expect(new Set(all).size).toBe(all.length)
  })
})
