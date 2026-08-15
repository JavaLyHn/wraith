// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.stubGlobal('wraith', {
    fs: {
      readText: vi.fn().mockResolvedValue({ content: 'line1\nline2\n', truncated: false, size: 12 }),
      stat: vi.fn().mockResolvedValue({ path: 'd:/x/A.java', parentPath: 'd:/x', name: 'A.java', kind: 'file', size: 12, mtime: 1_700_000_000_000 }),
      reveal: vi.fn().mockResolvedValue(undefined),
      openExternal: vi.fn().mockResolvedValue(undefined),
    },
  })
})

describe('PreviewKind 判定对齐 previewKind (shared)', () => {
  it('代码扩展名 -> code', async () => {
    const { previewKind } = await import('../src/renderer/lib/filePreviewKind')
    expect(previewKind('a.java')).toBe('code')
    expect(previewKind('a.md')).toBe('markdown')
    expect(previewKind('a.png')).toBe('image')
    expect(previewKind('a.pdf')).toBe('pdf')
    expect(previewKind('a.bin')).toBe('binary')
  })
})

describe('FilePreviewPanel renderer branches (smoke)', () => {
  it('code path 渲染行号 (1~2)', async () => {
    const { render, screen } = await import('@testing-library/react')
    const { default: FilePreviewPanel } = await import('../src/renderer/components/FilePreviewPanel')
    render(<FilePreviewPanel path="d:/x/A.java" kind="code" />)
    const els = await screen.findAllByText('A.java', {}, { timeout: 5000 })
    expect(els.length).toBeGreaterThan(0)
    await new Promise(r => setTimeout(r, 50))
    const lnEls = document.querySelectorAll('.preview-ln')
    expect(lnEls.length).toBeGreaterThan(0)
    const firstLn = Array.from(lnEls).find(e => e.textContent?.trim() === '1')
    expect(firstLn).toBeTruthy()
  }, 10000)

  it('binary 路径: 无 hljs,直接大小信息', async () => {
    const { render, screen } = await import('@testing-library/react')
    const { default: FilePreviewPanel } = await import('../src/renderer/components/FilePreviewPanel')
    render(<FilePreviewPanel path="d:/x/A.bin" kind="binary" />)
    await screen.findByText(/二进制|不支持预览/, {}, { timeout: 2000 })
  })
})
