import { describe, it, expect } from 'vitest'
import { filesUnderMessages } from '../src/shared/artifactSummary'
import type { Item } from '../src/shared/transcriptReducer'

const wf = (path: string, content: string): Item =>
  ({ type: 'tool', card: { callId: 'c-' + path, name: 'write_file', argsJson: JSON.stringify({ path, content }), output: '', done: true } })
const user = (text: string): Item => ({ type: 'user', text })
const msg = (text: string): Item => ({ type: 'message', text })

describe('filesUnderMessages', () => {
  it('单回合:文件挂到该回合的 message 下标', () => {
    const items: Item[] = [user('写readme'), wf('README.md', '你好'), msg('已生成')]
    const m = filesUnderMessages(items)
    expect([...m.keys()]).toEqual([2])
    expect(m.get(2)).toEqual([{ path: 'README.md', kind: 'modified', content: '你好', before: null }])
  })

  it('一回合多文件:全挂同一 message', () => {
    const items: Item[] = [user('写两个'), wf('a.ts', 'A'), wf('b.ts', 'B'), msg('done')]
    expect(filesUnderMessages(items).get(3)).toEqual([
      { path: 'a.ts', kind: 'modified', content: 'A', before: null },
      { path: 'b.ts', kind: 'modified', content: 'B', before: null },
    ])
  })

  it('两回合:各自文件挂各自 message,不串', () => {
    const items: Item[] = [user('t1'), wf('a.ts', 'A'), msg('m1'), user('t2'), wf('b.ts', 'B'), msg('m2')]
    const m = filesUnderMessages(items)
    expect(m.get(2)).toEqual([{ path: 'a.ts', kind: 'modified', content: 'A', before: null }])
    expect(m.get(5)).toEqual([{ path: 'b.ts', kind: 'modified', content: 'B', before: null }])
  })

  it('回合有文件但无 message:回退挂到该回合的 user 项(react 提前结束场景)', () => {
    const items: Item[] = [user('t'), wf('a.ts', 'A')]
    const m = filesUnderMessages(items)
    expect([...m.keys()]).toEqual([0])
    expect(m.get(0)).toEqual([{ path: 'a.ts', kind: 'modified', content: 'A', before: null }])
  })

  it('无前导 user 且无 message:无锚点,不产生条目', () => {
    const items: Item[] = [wf('a.ts', 'A')]
    expect(filesUnderMessages(items).size).toBe(0)
  })

  it('回合有 message 但无文件:不产生条目', () => {
    const items: Item[] = [user('hi'), msg('你好')]
    expect(filesUnderMessages(items).size).toBe(0)
  })

  it('同回合多 message:文件只挂最后一条 message(last wins)', () => {
    const items: Item[] = [user('t'), msg('m1'), wf('a.ts', 'A'), msg('m2')]
    const m = filesUnderMessages(items)
    expect(m.has(1)).toBe(false)
    expect(m.get(3)).toEqual([{ path: 'a.ts', kind: 'modified', content: 'A', before: null }])
  })

  it('无前导 user:文件仍挂到隐式回合 0 的最后一条 message', () => {
    const items: Item[] = [wf('a.ts', 'A'), msg('m')]
    expect(filesUnderMessages(items).get(1)).toEqual([{ path: 'a.ts', kind: 'modified', content: 'A', before: null }])
  })
})
