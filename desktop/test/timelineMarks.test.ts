import { describe, it, expect } from 'vitest'
import { timelineMarksAttrs, type RulerMarkAttr } from '../src/renderer/lib/timelineMarks'
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
// 测试用例：严格按照 plan §5.1 编号 1..15
// ---------------------------------------------------------------------------

describe('timelineMarksAttrs', () => {
  it('1. 空 [] → 输出 []（长度 0）', () => {
    const result = timelineMarksAttrs([])
    expect(result).toEqual([])
    expect(result).toHaveLength(0)
  })

  it('2. 单个 user → 输出 [{ hid:"u1", markType:"dot" }]；长度=1', () => {
    const nodes = groupToolRuns([mkUser('hi')])
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ hid: 'u1', markType: 'dot' })
  })

  it('3. user → message(第一个) → [dot u1, square a1]', () => {
    const nodes = groupToolRuns([mkUser('hi'), mkMsg('hello')])
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ hid: 'u1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'a1', markType: 'square' })
  })

  it('4. user → message → message → [dot u1, square a1, null a1]', () => {
    const nodes = groupToolRuns([mkUser('hi'), mkMsg('a'), mkMsg('b')])
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ hid: 'u1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'a1', markType: 'square' })
    expect(result[2]).toEqual({ hid: 'a1', markType: null })
  })

  it('5. user → toolGroup(1 张 write_file) → [dot u1, diamond a1]', () => {
    const nodes = groupToolRuns([mkUser('hi'), mkTool('c1', 'write_file')])
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ hid: 'u1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'a1', markType: 'diamond' })
  })

  it('6. user → 单个 tool item(type=tool, name=execute_command, 非 group 场景) → [dot u1, diamond a1]', () => {
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
    expect(result[0]).toEqual({ hid: 'u1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'a1', markType: 'diamond' })
  })

  it('7. user → toolGroup(3 张 write_file 卡片) → [dot u1, diamond a1]', () => {
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
    expect(result[0]).toEqual({ hid: 'u1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'a1', markType: 'diamond' })
  })

  it('8. user → 3 个连续 tool(write_file) → groupToolRuns 合成 1 个 toolGroup → [dot u1, diamond a1]', () => {
    const items: Item[] = [
      mkUser('hi'),
      mkTool('c1', 'write_file'),
      mkTool('c2', 'write_file'),
      mkTool('c3', 'write_file'),
    ]
    const nodes = groupToolRuns(items)
    expect(nodes).toHaveLength(2)
    expect(nodes[0].kind).toBe('item')
    expect(nodes[1].kind).toBe('toolGroup')
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ hid: 'u1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'a1', markType: 'diamond' })
  })

  it('9. 配额耗尽：user → toolGroup(wf) → msg → toolGroup(wf) → msg → toolGroup(wf) → msg → toolGroup(wf) → 前 3 个 diamond，第 4 个 null', () => {
    const items: Item[] = [
      mkUser('hi'),
      mkTool('c1', 'write_file'),
      mkMsg('m1'),
      mkTool('c2', 'write_file'),
      mkMsg('m2'),
      mkTool('c3', 'write_file'),
      mkMsg('m3'),
      mkTool('c4', 'write_file'),
    ]
    const nodes = groupToolRuns(items)
    // nodes 顺序: [user, toolGroup(c1), msg(m1), toolGroup(c2), msg(m2), toolGroup(c3), msg(m3), toolGroup(c4)]
    expect(nodes).toHaveLength(8)
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(8)
    expect(result[0]).toEqual({ hid: 'u1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'a1', markType: 'diamond' })
    expect(result[2]).toEqual({ hid: 'a1', markType: 'square' })
    expect(result[3]).toEqual({ hid: 'a1', markType: 'diamond' })
    expect(result[4]).toEqual({ hid: 'a1', markType: null })
    expect(result[5]).toEqual({ hid: 'a1', markType: 'diamond' })
    expect(result[6]).toEqual({ hid: 'a1', markType: null })
    expect(result[7]).toEqual({ hid: 'a1', markType: null })
  })

  it('10. 连续两个 user：user1 → msg1 → user2 → msg2 → [dot u1, square a1, dot u2, square a2]', () => {
    const nodes = groupToolRuns([mkUser('u1'), mkMsg('m1'), mkUser('u2'), mkMsg('m2')])
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(4)
    expect(result[0]).toEqual({ hid: 'u1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'a1', markType: 'square' })
    expect(result[2]).toEqual({ hid: 'u2', markType: 'dot' })
    expect(result[3]).toEqual({ hid: 'a2', markType: 'square' })
  })

  it('11. 无根 user（直接 message 开头，3 条 message）→ [square prelude, null prelude, null prelude]', () => {
    const nodes = groupToolRuns([mkMsg('m1'), mkMsg('m2'), mkMsg('m3')])
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ hid: 'prelude', markType: 'square' })
    expect(result[1]).toEqual({ hid: 'prelude', markType: null })
    expect(result[2]).toEqual({ hid: 'prelude', markType: null })
  })

  it('12. 只读工具：toolGroup([read_file, grep_code, mcp__foo, search_code, web_search, glob_files, web_fetch, list_dir, execute_command, mcp__bar]) → execute_command 白名单，1 个 diamond', () => {
    const nodes = groupToolRuns([
      mkUser('hi'),
      mkTool('c1', 'read_file'),
      mkTool('c2', 'grep_code'),
      mkTool('c3', 'mcp__foo'),
      mkTool('c4', 'search_code'),
      mkTool('c5', 'web_search'),
      mkTool('c6', 'glob_files'),
      mkTool('c7', 'web_fetch'),
      mkTool('c8', 'list_dir'),
      mkTool('c9', 'execute_command'),
      mkTool('c10', 'mcp__bar'),
    ])
    expect(nodes).toHaveLength(2)
    expect(nodes[1].kind).toBe('toolGroup')
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ hid: 'u1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'a1', markType: 'diamond' })
  })

  it('13. 混合完整场景：[user, thinking, toolGroup([read_file, write_file]), msg, tool(name=execute_command)]', () => {
    const items: Item[] = [
      mkUser('hi'),
      mkThinking('t1', 'thinking...'),
      mkTool('c1', 'read_file'),
      mkTool('c2', 'write_file'),
      mkMsg('m1'),
      mkTool('c3', 'execute_command'),
    ]
    const nodes = groupToolRuns(items)
    // nodes: [user(item), thinking(item), toolGroup(c1,c2), msg(item), toolGroup(c3)]
    expect(nodes).toHaveLength(5)
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(5)
    expect(result[0]).toEqual({ hid: 'u1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'a1', markType: null })
    expect(result[2]).toEqual({ hid: 'a1', markType: 'diamond' })
    expect(result[3]).toEqual({ hid: 'a1', markType: 'square' })
    expect(result[4]).toEqual({ hid: 'a1', markType: 'diamond' })
    const markTypes = result.map(r => r.markType)
    expect(markTypes).toEqual(['dot', null, 'diamond', 'square', 'diamond'])
    const hids = result.map(r => r.hid)
    expect(hids).toEqual(['u1', 'a1', 'a1', 'a1', 'a1'])
  })

  it('14. ToolGroup 首张是 read_file、第 2 张 write_file、第 3 张 write_file → 整个 Group 标 1 个 diamond', () => {
    const nodes = groupToolRuns([
      mkUser('hi'),
      mkTool('c1', 'read_file'),
      mkTool('c2', 'write_file'),
      mkTool('c3', 'write_file'),
    ])
    expect(nodes).toHaveLength(2)
    expect(nodes[1].kind).toBe('toolGroup')
    if (nodes[1].kind === 'toolGroup') {
      expect(nodes[1].cards[0].name).toBe('read_file')
      expect(nodes[1].cards[1].name).toBe('write_file')
      expect(nodes[1].cards[2].name).toBe('write_file')
    }
    const result = timelineMarksAttrs(nodes)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ hid: 'u1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'a1', markType: 'diamond' })
  })

  it('15. diff return null：[user, diff, message, diff, message] → 输出长度=5，diff 不跳过', () => {
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
    expect(result[0]).toEqual({ hid: 'u1', markType: 'dot' })
    expect(result[1]).toEqual({ hid: 'a1', markType: null })
    expect(result[2]).toEqual({ hid: 'a1', markType: 'square' })
    expect(result[3]).toEqual({ hid: 'a1', markType: null })
    expect(result[4]).toEqual({ hid: 'a1', markType: null })
  })
})
