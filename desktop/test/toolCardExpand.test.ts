import { describe, it, expect } from 'vitest'
import { toolCardDefaultExpanded } from '../src/renderer/lib/toolCardExpand'

describe('toolCardDefaultExpanded', () => {
  it('运行中(done:false)→展开', () => {
    expect(toolCardDefaultExpanded({ done: false })).toBe(true)
  })
  it('完成且成功(done:true, ok:true)→折叠', () => {
    expect(toolCardDefaultExpanded({ done: true, ok: true })).toBe(false)
  })
  it('失败(done:true, ok:false)→展开', () => {
    expect(toolCardDefaultExpanded({ done: true, ok: false })).toBe(true)
  })
  it('完成但 ok 未定义(done:true)→折叠', () => {
    expect(toolCardDefaultExpanded({ done: true })).toBe(false)
  })
})
