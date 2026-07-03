import { describe, it, expect } from 'vitest'
import { buildApprovalResponse, validateArgsJson } from '../src/shared/buildApprovalResponse'

const base = {
  toolName: 'execute_command',
  originalArgsJson: '{"command":"echo hi"}',
  editedCommand: null as string | null,
  editedArgsJson: null as string | null,
  allowNetwork: false,
  sessionAllowTool: false,
}

describe('buildApprovalResponse', () => {
  it('未修改 → APPROVED,无 modifiedArgs/allowNetwork', () => {
    expect(buildApprovalResponse(base)).toEqual({ decision: 'APPROVED' })
  })
  it('命令被编辑 → MODIFIED,modifiedArgs 里 command 替换、其余字段保留', () => {
    const r = buildApprovalResponse({
      ...base,
      originalArgsJson: '{"command":"echo hi","cwd":"/p"}',
      editedCommand: 'echo bye',
    })
    expect(r.decision).toBe('MODIFIED')
    expect(JSON.parse(r.modifiedArgs!)).toEqual({ command: 'echo bye', cwd: '/p' })
  })
  it('命令编辑框值与原命令相同 → 视为未修改(APPROVED)', () => {
    expect(buildApprovalResponse({ ...base, editedCommand: 'echo hi' }).decision).toBe('APPROVED')
  })
  it('通用 JSON 编辑且与原文不同 → MODIFIED,原样透传', () => {
    const r = buildApprovalResponse({
      ...base, toolName: 'some_tool', editedArgsJson: '{"a":1}', originalArgsJson: '{"a":0}',
    })
    expect(r).toEqual({ decision: 'MODIFIED', modifiedArgs: '{"a":1}' })
  })
  it('通用 JSON 非法 → 视为未修改(上层 UI 已禁用提交,这里兜底)', () => {
    expect(buildApprovalResponse({
      ...base, toolName: 'some_tool', editedArgsJson: '{bad', originalArgsJson: '{}',
    }).decision).toBe('APPROVED')
  })
  it('sessionAllowTool 且未修改 → APPROVED_ALL', () => {
    expect(buildApprovalResponse({ ...base, sessionAllowTool: true }).decision).toBe('APPROVED_ALL')
  })
  it('修改优先于 sessionAllowTool(UI 会禁用,函数兜底为 MODIFIED)', () => {
    expect(buildApprovalResponse({ ...base, editedCommand: 'x', sessionAllowTool: true }).decision).toBe('MODIFIED')
  })
  it('allowNetwork=true 时附带 allowNetwork,且可与 MODIFIED 组合', () => {
    expect(buildApprovalResponse({ ...base, allowNetwork: true })).toEqual({ decision: 'APPROVED', allowNetwork: true })
    const r = buildApprovalResponse({ ...base, editedCommand: 'curl x', allowNetwork: true })
    expect(r.decision).toBe('MODIFIED')
    expect(r.allowNetwork).toBe(true)
  })
})

describe('validateArgsJson', () => {
  it('合法 JSON → null;非法 → 错误信息', () => {
    expect(validateArgsJson('{"a":1}')).toBeNull()
    expect(validateArgsJson('{oops')).toBeTypeOf('string')
  })
  it('空串视为非法 JSON(JSON.parse("") 抛出),返回错误信息字符串而非 null', () => {
    // 设计语义:editedArgsJson===null 表示"未开启编辑",空串('')表示用户清空了编辑器内容。
    // JSON.parse('') 抛出 SyntaxError,validateArgsJson 返回错误信息,UI 据此内联展示错误并禁用提交。
    // 此为有意设计:空串不是合法 JSON,不应被当作"未修改"处理。
    expect(validateArgsJson('')).toBeTypeOf('string')
    expect(validateArgsJson('')).not.toBeNull()
  })
})
