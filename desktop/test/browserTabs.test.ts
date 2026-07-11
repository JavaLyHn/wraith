import { describe, it, expect } from 'vitest'
import {
  newBrowserTab, addBrowserTab, closeBrowserTab, setActiveBrowserTab, patchBrowserTab,
  type BrowserTabsState,
} from '../src/renderer/lib/browserTabs'

const empty: BrowserTabsState = { tabs: [], activeId: null }

describe('newBrowserTab', () => {
  it('空白标签默认字段', () => {
    expect(newBrowserTab('x')).toEqual({
      id: 'x', title: '新标签页', url: '', loading: false, failed: false, canBack: false, canForward: false,
    })
  })
})

describe('addBrowserTab', () => {
  it('追加并激活新标签', () => {
    const s = addBrowserTab(empty, newBrowserTab('a'))
    expect(s.tabs.map(t => t.id)).toEqual(['a'])
    expect(s.activeId).toBe('a')
    const s2 = addBrowserTab(s, newBrowserTab('b'))
    expect(s2.tabs.map(t => t.id)).toEqual(['a', 'b'])
    expect(s2.activeId).toBe('b')
  })
})

describe('closeBrowserTab', () => {
  const three: BrowserTabsState = {
    tabs: [newBrowserTab('a'), newBrowserTab('b'), newBrowserTab('c')], activeId: 'b',
  }
  it('关活动标签 → 激活左邻居', () => {
    const s = closeBrowserTab(three, 'b')
    expect(s.tabs.map(t => t.id)).toEqual(['a', 'c'])
    expect(s.activeId).toBe('a')
  })
  it('关第一个(活动)→ 激活右邻居', () => {
    const s = closeBrowserTab({ ...three, activeId: 'a' }, 'a')
    expect(s.activeId).toBe('b')
  })
  it('关非活动标签 → 活动不变', () => {
    const s = closeBrowserTab(three, 'c')
    expect(s.activeId).toBe('b')
  })
  it('关到空 → activeId null', () => {
    const s = closeBrowserTab({ tabs: [newBrowserTab('a')], activeId: 'a' }, 'a')
    expect(s.tabs).toEqual([])
    expect(s.activeId).toBeNull()
  })
  it('关不存在 id → 原样返回', () => {
    const s = closeBrowserTab(three, 'zzz')
    expect(s).toBe(three)
  })
})

describe('setActiveBrowserTab', () => {
  const s0: BrowserTabsState = { tabs: [newBrowserTab('a'), newBrowserTab('b')], activeId: 'a' }
  it('存在才切', () => {
    expect(setActiveBrowserTab(s0, 'b').activeId).toBe('b')
  })
  it('不存在 id → 原样', () => {
    expect(setActiveBrowserTab(s0, 'zzz')).toBe(s0)
  })
})

describe('patchBrowserTab', () => {
  const s0: BrowserTabsState = { tabs: [newBrowserTab('a'), newBrowserTab('b')], activeId: 'a' }
  it('只更新目标标签的指定字段(浅合并)', () => {
    const s = patchBrowserTab(s0, 'b', { title: 'X', loading: true })
    const b = s.tabs.find(t => t.id === 'b')!
    expect(b.title).toBe('X')
    expect(b.loading).toBe(true)
    expect(b.url).toBe('')          // 未传的字段保持
    expect(s.tabs.find(t => t.id === 'a')!.title).toBe('新标签页')  // 其他标签不动
    expect(s.activeId).toBe('a')
  })
  it('不存在 id → 原样、不新增', () => {
    const s = patchBrowserTab(s0, 'zzz', { title: 'X' })
    expect(s).toBe(s0)
    expect(s.tabs.length).toBe(2)
  })
})
