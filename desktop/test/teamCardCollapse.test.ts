import { describe, expect, it } from 'vitest'
import { resolveExpanded, nextGlobalMode, globalToggleLabel } from '../src/renderer/lib/teamCardCollapse'

describe('resolveExpanded', () => {
  it('单块 override 赢过全局与 auto', () => {
    expect(resolveExpanded('k', false, { k: true }, 'collapsed')).toBe(true)
    expect(resolveExpanded('k', true, { k: false }, 'expanded')).toBe(false)
  })
  it('无 override 时全局 expanded/collapsed 生效', () => {
    expect(resolveExpanded('k', false, {}, 'expanded')).toBe(true)
    expect(resolveExpanded('k', true, {}, 'collapsed')).toBe(false)
  })
  it('auto 用 autoDefault', () => {
    expect(resolveExpanded('k', true, {}, 'auto')).toBe(true)
    expect(resolveExpanded('k', false, {}, 'auto')).toBe(false)
  })
  it('override=false 被尊重,不与"无 override"混淆', () => {
    expect(resolveExpanded('k', true, { k: false }, 'auto')).toBe(false)
  })
})

describe('nextGlobalMode', () => {
  it('expanded → collapsed', () => expect(nextGlobalMode('expanded')).toBe('collapsed'))
  it('collapsed → expanded', () => expect(nextGlobalMode('collapsed')).toBe('expanded'))
  it('auto → expanded(首次点即展开全部)', () => expect(nextGlobalMode('auto')).toBe('expanded'))
})

describe('globalToggleLabel', () => {
  it('expanded 显示折叠全部', () => expect(globalToggleLabel('expanded')).toBe('▾ 折叠全部'))
  it('auto/collapsed 显示展开全部', () => {
    expect(globalToggleLabel('auto')).toBe('▸ 展开全部')
    expect(globalToggleLabel('collapsed')).toBe('▸ 展开全部')
  })
})
