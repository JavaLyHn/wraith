import { describe, it, expect } from 'vitest'
import { BUILTIN_CAPABILITIES, RECOMMENDED_MCP } from '../src/renderer/lib/pluginShowcase'

describe('BUILTIN_CAPABILITIES', () => {
  it('非空,id 唯一,每条有 icon/name/desc 且 tools 非空', () => {
    expect(BUILTIN_CAPABILITIES.length).toBeGreaterThan(0)
    const ids = new Set<string>()
    for (const c of BUILTIN_CAPABILITIES) {
      expect(ids.has(c.id)).toBe(false); ids.add(c.id)
      expect(c.icon.length).toBeGreaterThan(0)
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.desc.length).toBeGreaterThan(0)
      expect(c.tools.length).toBeGreaterThan(0)
    }
  })
  it('引用的是真实内置工具名(execute_command / grep_code / web_search 等)', () => {
    const allTools = BUILTIN_CAPABILITIES.flatMap(c => c.tools)
    for (const t of ['execute_command', 'grep_code', 'web_search', 'read_file', 'todo_write']) {
      expect(allTools).toContain(t)
    }
  })
})

describe('RECOMMENDED_MCP', () => {
  it('非空,id 唯一,每条有 icon/name/desc/command 且 args 为数组', () => {
    expect(RECOMMENDED_MCP.length).toBeGreaterThan(0)
    const ids = new Set<string>()
    for (const m of RECOMMENDED_MCP) {
      expect(ids.has(m.id)).toBe(false); ids.add(m.id)
      expect(m.icon.length).toBeGreaterThan(0)
      expect(m.name.length).toBeGreaterThan(0)
      expect(m.desc.length).toBeGreaterThan(0)
      expect(m.command.length).toBeGreaterThan(0)
      expect(Array.isArray(m.args)).toBe(true)
    }
  })
  it('含 Filesystem,且其参数带官方包名', () => {
    const fs = RECOMMENDED_MCP.find(m => m.id === 'filesystem')
    expect(fs).toBeTruthy()
    expect(fs!.args.some(a => a.includes('@modelcontextprotocol/server-filesystem'))).toBe(true)
  })
})
