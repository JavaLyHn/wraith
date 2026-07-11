import { describe, it, expect } from 'vitest'
import { addTab, closeTab, setActive, shortTabLabel, type TabsState } from '../src/renderer/lib/terminalTabs'

const empty: TabsState = { tabs: [], activeId: null }

describe('addTab', () => {
  it('追加并激活新标签', () => {
    const s = addTab(empty, { id: 'a', label: 'A' })
    expect(s.tabs.map(t => t.id)).toEqual(['a'])
    expect(s.activeId).toBe('a')
    const s2 = addTab(s, { id: 'b', label: 'B' })
    expect(s2.tabs.map(t => t.id)).toEqual(['a', 'b'])
    expect(s2.activeId).toBe('b')
  })
})

describe('closeTab', () => {
  const three: TabsState = { tabs: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], activeId: 'b' }
  it('关活跃标签 → 激活前一个', () => {
    const s = closeTab(three, 'b')
    expect(s.tabs.map(t => t.id)).toEqual(['a', 'c'])
    expect(s.activeId).toBe('a')
  })
  it('关第一个(活跃)→ 激活后一个', () => {
    const s = closeTab({ ...three, activeId: 'a' }, 'a')
    expect(s.activeId).toBe('b')
  })
  it('关非活跃标签 → 活跃不变', () => {
    const s = closeTab(three, 'c')
    expect(s.activeId).toBe('b')
  })
  it('关到空 → activeId null', () => {
    const s = closeTab({ tabs: [{ id: 'a', label: 'A' }], activeId: 'a' }, 'a')
    expect(s.tabs).toEqual([])
    expect(s.activeId).toBeNull()
  })
})

describe('setActive', () => {
  it('切换活跃', () => {
    const s = setActive({ tabs: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], activeId: 'a' }, 'b')
    expect(s.activeId).toBe('b')
  })
})

describe('shortTabLabel', () => {
  it('取 cwd basename', () => {
    expect(shortTabLabel('/Users/x/proj', 0)).toBe('proj')
    expect(shortTabLabel('/Users/x/proj/', 0)).toBe('proj')
  })
  it('空 cwd → 终端 N', () => {
    expect(shortTabLabel('', 0)).toBe('终端 1')
    expect(shortTabLabel('', 2)).toBe('终端 3')
  })
})
