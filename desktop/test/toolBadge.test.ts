import { describe, it, expect } from 'vitest'
import { toolBadgeLabel } from '../src/shared/toolBadge'
import type { ToolCard } from '../src/shared/transcriptReducer'

function card(over: Partial<ToolCard>): ToolCard {
  return { callId: 'c1', name: 'read_file', argsJson: '{}', output: '', done: true, ...over }
}

describe('toolBadgeLabel', () => {
  it('execute_command 成功显 ✓ 完成(不显误导性 exit 0);失败保留退出码', () => {
    expect(toolBadgeLabel(card({ name: 'execute_command', ok: true, exitCode: 0 }))).toBe('✓ 完成')
    expect(toolBadgeLabel(card({ name: 'execute_command', ok: false, exitCode: 127 }))).toBe('exit 127')
  })
  it('execute_command 缺 exitCode:成功 ✓ 完成,失败兜底 exit 1', () => {
    expect(toolBadgeLabel(card({ name: 'execute_command', ok: true }))).toBe('✓ 完成')
    expect(toolBadgeLabel(card({ name: 'execute_command', ok: false }))).toBe('exit 1')
  })
  it('非命令工具无进程语义:✓ 完成 / ✗ 失败', () => {
    expect(toolBadgeLabel(card({ name: 'web_search', ok: true }))).toBe('✓ 完成')
    expect(toolBadgeLabel(card({ name: 'read_file', ok: false }))).toBe('✗ 失败')
  })
  it('ok 未知(undefined)视为成功——与旧徽标行为一致', () => {
    expect(toolBadgeLabel(card({ name: 'glob_files' }))).toBe('✓ 完成')
  })
  it('未完成一律 running…', () => {
    expect(toolBadgeLabel(card({ name: 'web_search', done: false }))).toBe('running…')
    expect(toolBadgeLabel(card({ name: 'execute_command', done: false }))).toBe('running…')
  })
})
