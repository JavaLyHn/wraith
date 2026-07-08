import { describe, it, expect } from 'vitest'
import { toolCardDefaultExpanded } from '../src/renderer/lib/toolCardExpand'
import type { ToolCard } from '../src/shared/transcriptReducer'
const mkE = (p: Partial<ToolCard>): ToolCard => ({ callId: 'x', name: 't', argsJson: '', output: '', done: true, ...p })

describe('toolCardDefaultExpanded', () => {
  it('运行中(done:false)→折叠', () => {
    expect(toolCardDefaultExpanded(mkE({ done: false }))).toBe(false)
  })
  it('完成且成功(done:true, ok:true)→折叠', () => {
    expect(toolCardDefaultExpanded(mkE({ done: true, ok: true }))).toBe(false)
  })
  it('失败(done:true, ok:false)→展开', () => {
    expect(toolCardDefaultExpanded(mkE({ done: true, ok: false }))).toBe(true)
  })
  it('完成但 ok 未定义(done:true)→折叠', () => {
    expect(toolCardDefaultExpanded(mkE({ done: true }))).toBe(false)
  })
  it('失败卡片(输出以失败标记开头)→展开', () => {
    expect(toolCardDefaultExpanded({ callId: 'x', name: 't', argsJson: '', output: '工具执行失败: boom', done: true } as never)).toBe(true)
  })
})
