import { describe, it, expect } from 'vitest'
import {
  HOTZONE_PX, SIDEBAR_WIDTH, DOCK_ANIM_MS, dockPlaceholderWidth, dockInnerClass,
} from '../src/renderer/lib/sidebarDock'

describe('常量', () => {
  it('热区 8 / 宽 240 / 动画 200', () => {
    expect(HOTZONE_PX).toBe(8)
    expect(SIDEBAR_WIDTH).toBe(240)
    expect(DOCK_ANIM_MS).toBe(200)
  })
})

describe('dockPlaceholderWidth', () => {
  it('展开 240 / 折叠 0', () => {
    expect(dockPlaceholderWidth(false)).toBe(240)
    expect(dockPlaceholderWidth(true)).toBe(0)
  })
})

describe('dockInnerClass', () => {
  it('展开态:流内 h-full w-60(忽略 peek)', () => {
    expect(dockInnerClass(false, false)).toBe('h-full w-60')
    expect(dockInnerClass(false, true)).toBe('h-full w-60')
  })
  it('折叠+peek:绝对浮层且 translate-x-0、无隐藏类', () => {
    const c = dockInnerClass(true, true)
    expect(c).toContain('absolute left-0 top-0 z-50')
    expect(c).toContain('rounded-r-xl shadow-2xl')
    expect(c).toContain('transition-transform duration-200 ease-out')
    expect(c).toContain('translate-x-0')
    expect(c).not.toContain('-translate-x-full')
    expect(c).not.toContain('pointer-events-none')
  })
  it('折叠+!peek:隐于左侧外 + pointer-events-none', () => {
    const c = dockInnerClass(true, false)
    expect(c).toContain('absolute left-0 top-0 z-50')
    expect(c).toContain('-translate-x-full')
    expect(c).toContain('pointer-events-none')
    expect(c).not.toContain('translate-x-0')
  })
})
