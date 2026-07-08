import { describe, it, expect } from 'vitest'
import { OrderedAppender } from '../src/renderer/lib/orderedAppender'

describe('OrderedAppender', () => {
  it('顺序到达顺序出', () => {
    const a = new OrderedAppender()
    expect(a.arrive(0, 'hello')).toEqual(['hello'])
    expect(a.arrive(1, 'world')).toEqual(['world'])
  })

  it('乱序到达:后段先到先缓存,前段补齐后按序一起出', () => {
    const a = new OrderedAppender()
    expect(a.arrive(1, 'world')).toEqual([])          // seq 1 先到 → 缓存
    expect(a.arrive(0, 'hello')).toEqual(['hello', 'world'])
  })

  it('空串段推进序号但不产出', () => {
    const a = new OrderedAppender()
    expect(a.arrive(0, '')).toEqual([])               // 空段:静默跳过
    expect(a.arrive(1, 'hi')).toEqual(['hi'])         // 不被 seq 0 卡住
  })

  it('空段夹在中间也能让后段按序流出', () => {
    const a = new OrderedAppender()
    expect(a.arrive(2, 'c')).toEqual([])
    expect(a.arrive(0, 'a')).toEqual(['a'])
    expect(a.arrive(1, '')).toEqual(['c'])            // seq1 空 → 跳过,seq2 'c' 顺势流出
  })
})
