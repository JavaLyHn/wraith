import { describe, it, expect } from 'vitest'
import { normalizePanel, PANEL_LABELS } from '../src/renderer/lib/panelActions'

describe('panelActions', () => {
  it('合法 id 原样返回', () => {
    expect(normalizePanel('im-gateway')).toBe('im-gateway')
    expect(normalizePanel('rag')).toBe('rag')
  })
  it('mcp 别名归一到 plugins', () => {
    expect(normalizePanel('mcp')).toBe('plugins')
    expect(normalizePanel('MCP')).toBe('plugins')
  })
  it('非法 id 返回 null', () => {
    expect(normalizePanel('nope')).toBeNull()
    expect(normalizePanel('')).toBeNull()
  })
  it('每个 PanelId 都有中文名', () => {
    expect(PANEL_LABELS['im-gateway']).toBe('IM 网关')
    expect(PANEL_LABELS['plugins']).toBe('MCP')
  })
})
