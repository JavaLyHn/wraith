import { describe, it, expect } from 'vitest'
import { groupToolRuns } from '../src/renderer/lib/groupToolRuns'
import type { Item, ToolCard } from '../src/shared/transcriptReducer'

// ---------------------------------------------------------------------------
// 测试辅助构造函数
// ---------------------------------------------------------------------------

function mkTool(callId: string): Item {
  const card: ToolCard = { callId, name: `tool_${callId}`, argsJson: '{}', output: '', done: true }
  return { type: 'tool', card }
}

function mkMsg(text: string): Item {
  return { type: 'message', text }
}

function mkUser(text: string): Item {
  return { type: 'user', text }
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe('groupToolRuns', () => {
  it('空数组→空结果', () => {
    expect(groupToolRuns([])).toEqual([])
  })

  it('单个工具→一个 toolGroup(长度 1)', () => {
    const nodes = groupToolRuns([mkTool('a')])
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind).toBe('toolGroup')
    if (nodes[0].kind === 'toolGroup') {
      expect(nodes[0].cards).toHaveLength(1)
      expect(nodes[0].cards[0].callId).toBe('a')
    }
  })

  it('连续两个工具→合并为一个 toolGroup', () => {
    const nodes = groupToolRuns([mkTool('a'), mkTool('b')])
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind).toBe('toolGroup')
    if (nodes[0].kind === 'toolGroup') {
      expect(nodes[0].cards).toHaveLength(2)
      expect(nodes[0].cards[0].callId).toBe('a')
      expect(nodes[0].cards[1].callId).toBe('b')
    }
  })

  it('连续三个工具→一个 toolGroup(3 cards)', () => {
    const nodes = groupToolRuns([mkTool('a'), mkTool('b'), mkTool('c')])
    expect(nodes).toHaveLength(1)
    if (nodes[0].kind === 'toolGroup') {
      expect(nodes[0].cards).toHaveLength(3)
    }
  })

  it('非工具 item→透传为 RenderItem', () => {
    const nodes = groupToolRuns([mkMsg('hello')])
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind).toBe('item')
    if (nodes[0].kind === 'item') {
      expect(nodes[0].item).toEqual(mkMsg('hello'))
    }
  })

  it('message 打断工具 run → 两个独立 toolGroup', () => {
    const items: Item[] = [mkTool('a'), mkMsg('mid'), mkTool('b')]
    const nodes = groupToolRuns(items)
    // [toolGroup(a), item(msg), toolGroup(b)]
    expect(nodes).toHaveLength(3)
    expect(nodes[0].kind).toBe('toolGroup')
    expect(nodes[1].kind).toBe('item')
    expect(nodes[2].kind).toBe('toolGroup')
    if (nodes[0].kind === 'toolGroup') expect(nodes[0].cards[0].callId).toBe('a')
    if (nodes[2].kind === 'toolGroup') expect(nodes[2].cards[0].callId).toBe('b')
  })

  it('顺序保留：message, tool, tool, message, tool', () => {
    const items: Item[] = [mkMsg('intro'), mkTool('a'), mkTool('b'), mkMsg('middle'), mkTool('c')]
    const nodes = groupToolRuns(items)
    // [item, toolGroup(a,b), item, toolGroup(c)]
    expect(nodes).toHaveLength(4)
    expect(nodes[0].kind).toBe('item')
    expect(nodes[1].kind).toBe('toolGroup')
    if (nodes[1].kind === 'toolGroup') {
      expect(nodes[1].cards).toHaveLength(2)
      expect(nodes[1].cards[0].callId).toBe('a')
      expect(nodes[1].cards[1].callId).toBe('b')
    }
    expect(nodes[2].kind).toBe('item')
    expect(nodes[3].kind).toBe('toolGroup')
    if (nodes[3].kind === 'toolGroup') {
      expect(nodes[3].cards[0].callId).toBe('c')
    }
  })

  it('user item 打断工具 run', () => {
    const items: Item[] = [mkTool('a'), mkUser('hi'), mkTool('b')]
    const nodes = groupToolRuns(items)
    expect(nodes).toHaveLength(3)
    expect(nodes[0].kind).toBe('toolGroup')
    expect(nodes[1].kind).toBe('item')
    expect(nodes[2].kind).toBe('toolGroup')
  })

  it('仅非工具 items → 全部 RenderItem，无 toolGroup', () => {
    const items: Item[] = [mkMsg('a'), mkUser('b'), mkMsg('c')]
    const nodes = groupToolRuns(items)
    expect(nodes).toHaveLength(3)
    expect(nodes.every(n => n.kind === 'item')).toBe(true)
  })
})
