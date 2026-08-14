import { describe, it, expect } from 'vitest'
import { timelineMarksAttrs } from '../src/renderer/lib/timelineMarks'
import { groupToolRuns } from '../src/renderer/lib/groupToolRuns'
import type { Item, ToolCard } from '../src/shared/transcriptReducer'

// ---------------------------------------------------------------------------
// 测试辅助构造函数
// ---------------------------------------------------------------------------

function mkTool(callId: string, name: string): Item {
  const card: ToolCard = { callId, name, argsJson: '{}', output: '', done: true }
  return { type: 'tool', card }
}

function mkMsg(text: string): Item {
  return { type: 'message', text }
}

function mkUser(text: string): Item {
  return { type: 'user', text }
}

function mkThinking(label: string, text: string): Item {
  return { type: 'thinking', label, text, done: true }
}

function mkDiff(filePath: string): Item {
  return { type: 'diff', filePath, before: '', after: '' }
}

// ---------------------------------------------------------------------------
// 测试用例：一问一答算一条横线，用户发完消息中断也算一条
// ---------------------------------------------------------------------------

describe('timelineMarksAttrs', () => {
  it('1. 空 [] → 输出 []', () => {
    const result = timelineMarksAttrs([])
    expect(result).toEqual([])
  })

  it('2. 单个 user（中断/无回答）→ [dot turn1]', () => {
    const nodes = groupToolRuns([mkUser('hi')])
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ hid: 'turn1', markType: 'dot' })
  })

  it('3. user → message → [dot turn1, null turn1]（一问一答=一条横线）', () => {
    const nodes = groupToolRuns([mkUser('hi'), mkMsg('hello')])
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ hid: 'turn1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'turn1', markType: null })
  })

  it('4. user → message → message → [dot turn1, null turn1, null turn1]', () => {
    const nodes = groupToolRuns([mkUser('hi'), mkMsg('a'), mkMsg('b')])
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ hid: 'turn1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'turn1', markType: null })
    expect(result[2]).toEqual({ hid: 'turn1', markType: null })
  })

  it('5. user → toolGroup(write_file) → [dot turn1, null turn1]', () => {
    const nodes = groupToolRuns([mkUser('hi'), mkTool('c1', 'write_file')])
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ hid: 'turn1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'turn1', markType: null })
  })

  it('6. user → 单个 tool item(execute_command) → [dot turn1, null turn1]', () => {
    const nodes: ReturnType<typeof groupToolRuns> = [
      { kind: 'item', item: mkUser('hi'), originalIdx: 0 },
      {
        kind: 'item',
        item: mkTool('c1', 'execute_command'),
        originalIdx: 1,
      },
    ]
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ hid: 'turn1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'turn1', markType: null })
  })

  it('7. user → toolGroup(3 张 write_file) → [dot turn1, null turn1]', () => {
    const nodes = groupToolRuns([
      mkUser('hi'),
      mkTool('c1', 'write_file'),
      mkTool('c2', 'write_file'),
      mkTool('c3', 'write_file'),
    ])
    expect(nodes).toHaveLength(2)
    expect(nodes[1].kind).toBe('toolGroup')
    if (nodes[1].kind === 'toolGroup') {
      expect(nodes[1].cards).toHaveLength(3)
    }
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ hid: 'turn1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'turn1', markType: null })
  })

  it('8. 两轮对话：user1 → msg1 → user2 → msg2 → [dot turn1, null turn1, dot turn2, null turn2]', () => {
    const nodes = groupToolRuns([mkUser('u1'), mkMsg('m1'), mkUser('u2'), mkMsg('m2')])
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(4)
    expect(result[0]).toEqual({ hid: 'turn1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'turn1', markType: null })
    expect(result[2]).toEqual({ hid: 'turn2', markType: 'dot' })
    expect(result[3]).toEqual({ hid: 'turn2', markType: null })
  })

  it('9. 无根 user（直接 message 开头）→ [null prelude, null prelude, null prelude]', () => {
    const nodes = groupToolRuns([mkMsg('m1'), mkMsg('m2'), mkMsg('m3')])
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ hid: 'prelude', markType: null })
    expect(result[1]).toEqual({ hid: 'prelude', markType: null })
    expect(result[2]).toEqual({ hid: 'prelude', markType: null })
  })

  it('10. 中断的 user（连续两个 user 之间无 agent 回答）→ 各算一条横线', () => {
    const nodes = groupToolRuns([mkUser('u1'), mkUser('u2')])
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ hid: 'turn1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'turn2', markType: 'dot' })
  })

  it('11. 混合工具：user → read_file → write_file → msg → execute_command → 全部 null markType（只有 user 有 dot）', () => {
    const items: Item[] = [
      mkUser('hi'),
      mkTool('c1', 'read_file'),
      mkTool('c2', 'write_file'),
      mkMsg('m1'),
      mkTool('c3', 'execute_command'),
    ]
    const nodes = groupToolRuns(items)
    // nodes: [user(item), toolGroup(c1,c2), msg(item), toolGroup(c3)]
    expect(nodes).toHaveLength(4)
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(4)
    expect(result[0]).toEqual({ hid: 'turn1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'turn1', markType: null })
    expect(result[2]).toEqual({ hid: 'turn1', markType: null })
    expect(result[3]).toEqual({ hid: 'turn1', markType: null })
    // 只有 user 消息产生 dot 标记
    const dots = result.filter(r => r.markType === 'dot')
    expect(dots).toHaveLength(1)
  })

  it('12. diff 不跳过：[user, diff, message, diff, message] → 输出长度=5', () => {
    const items: Item[] = [
      mkUser('hi'),
      mkDiff('a.ts'),
      mkMsg('m1'),
      mkDiff('b.ts'),
      mkMsg('m2'),
    ]
    const nodes = groupToolRuns(items)
    expect(nodes).toHaveLength(5)
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(5)
    expect(result[0]).toEqual({ hid: 'turn1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'turn1', markType: null })
    expect(result[2]).toEqual({ hid: 'turn1', markType: null })
    expect(result[3]).toEqual({ hid: 'turn1', markType: null })
    expect(result[4]).toEqual({ hid: 'turn1', markType: null })
  })

  it('13. 三轮完整对话 + 中断：user1→msg1→user2→tool→msg2→user3(中断)', () => {
    const items: Item[] = [
      mkUser('u1'), mkMsg('m1'),
      mkUser('u2'), mkTool('c1', 'read_file'), mkMsg('m2'),
      mkUser('u3'), // 中断，无 agent 回答
    ]
    const nodes = groupToolRuns(items)
    const result = timelineMarksAttrs(nodes)
    // 7 nodes: user, msg, user, toolGroup, msg, user
    expect(nodes).toHaveLength(6)
    expect(result).toHaveLength(6)
    // 三轮各有 dot
    const dots = result.filter(r => r.markType === 'dot')
    expect(dots).toHaveLength(3)
    expect(dots[0].hid).toBe('turn1')
    expect(dots[1].hid).toBe('turn2')
    expect(dots[2].hid).toBe('turn3')
    // 所有非 user 项共享当前轮次 hid
    expect(result[1].hid).toBe('turn1')
    expect(result[3].hid).toBe('turn2')
    expect(result[4].hid).toBe('turn2')
  })

  it('14. thinking 不产生标记：user → thinking → msg → [dot turn1, null turn1, null turn1]', () => {
    const nodes = groupToolRuns([mkUser('hi'), mkThinking('t1', 'thinking...'), mkMsg('m1')])
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ hid: 'turn1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'turn1', markType: null })
    expect(result[2]).toEqual({ hid: 'turn1', markType: null })
  })

  it('15. hid 唯一性验证：每轮的 hid 不同于其它轮', () => {
    const items: Item[] = [
      mkUser('u1'), mkMsg('m1'),
      mkUser('u2'), mkMsg('m2'),
      mkUser('u3'), mkMsg('m3'),
    ]
    const nodes = groupToolRuns(items)
    const result = timelineMarksAttrs(nodes)
    const dotHids = result.filter(r => r.markType === 'dot').map(r => r.hid)
    expect(dotHids).toEqual(['turn1', 'turn2', 'turn3'])
    expect(new Set(dotHids).size).toBe(3)
  })
})
