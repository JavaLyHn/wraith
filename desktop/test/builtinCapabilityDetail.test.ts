import { describe, it, expect } from 'vitest'
import { joinBuiltinTools } from '../src/renderer/lib/builtinCapabilityDetail'
import type { BuiltinToolView } from '../src/shared/types'

const catalog: BuiltinToolView[] = [
  { name: 'read_file', description: '读取文件', parameters: { type: 'object' } },
  { name: 'write_file', description: '写入文件' },
]

describe('joinBuiltinTools', () => {
  it('全命中 → 带后端描述/参数,missing=false', () => {
    const rows = joinBuiltinTools(['read_file', 'write_file'], catalog)
    expect(rows).toEqual([
      { name: 'read_file', description: '读取文件', parameters: { type: 'object' }, missing: false },
      { name: 'write_file', description: '写入文件', parameters: undefined, missing: false },
    ])
  })
  it('目录里找不到的工具名 → missing=true,描述空', () => {
    const rows = joinBuiltinTools(['read_file', 'ghost_tool'], catalog)
    expect(rows[1]).toEqual({ name: 'ghost_tool', description: '', parameters: undefined, missing: true })
  })
  it('空目录(加载失败回落)→ 全部 missing,仍保留工具名', () => {
    const rows = joinBuiltinTools(['read_file', 'write_file'], [])
    expect(rows.map(r => r.missing)).toEqual([true, true])
    expect(rows.map(r => r.name)).toEqual(['read_file', 'write_file'])
  })
  it('空工具名单 → 空数组', () => {
    expect(joinBuiltinTools([], catalog)).toEqual([])
  })
})
