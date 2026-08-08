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
  it('documents 有中文名且能归一', () => {
    expect(PANEL_LABELS.documents).toBe('文档')
    expect(normalizePanel('documents')).toBe('documents')
    expect(normalizePanel('  DOCUMENTS ')).toBe('documents')
  })
  it('projects 有中文名且能归一', () => {
    expect(PANEL_LABELS.projects).toBe('项目')
    expect(normalizePanel('projects')).toBe('projects')
    expect(normalizePanel('  PROJECTS ')).toBe('projects')
  })
})
