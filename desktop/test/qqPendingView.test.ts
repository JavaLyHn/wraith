import { describe, expect, it } from 'vitest'
import { sortQqPending } from '../src/renderer/lib/qqPendingView'
import type { QqPendingItem } from '../src/shared/types'

const item = (over: Partial<QqPendingItem>): QqPendingItem => ({
  id: 'x', taskName: 't', answerPreview: 'a', ts: 0, kind: 'result', ...over,
})

describe('sortQqPending', () => {
  it('审批置顶,组内按 ts 倒序', () => {
    const sorted = sortQqPending([
      item({ id: 'r-old', ts: 1 }),
      item({ id: 'ap-old', ts: 2, kind: 'approval', approvalId: 'a1' }),
      item({ id: 'r-new', ts: 9 }),
      item({ id: 'ap-new', ts: 5, kind: 'approval', approvalId: 'a2' }),
    ])
    expect(sorted.map(i => i.id)).toEqual(['ap-new', 'ap-old', 'r-new', 'r-old'])
  })

  it('不改原数组', () => {
    const input = [item({ id: 'b', ts: 1 }), item({ id: 'a', ts: 2 })]
    const copy = [...input]
    sortQqPending(input)
    expect(input).toEqual(copy)
  })

  it('空数组返回空', () => {
    expect(sortQqPending([])).toEqual([])
  })
})
