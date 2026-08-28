// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import PreviewPane from '../src/renderer/components/PreviewPane'

afterEach(() => cleanup())

describe('PreviewPane', () => {
  it('null → 占位', () => {
    render(<PreviewPane preview={null} />)
    expect(screen.getByText(/点击产物文件/)).toBeTruthy()
  })
  it('content → 渲染 ArtifactPreview(文件名)', () => {
    render(<PreviewPane preview={{ kind: 'content', filePath: 'sub/a.md', content: '# 标题' }} />)
    expect(screen.getByText('a.md')).toBeTruthy()
  })
  it('diff → 渲染 diff-preview 容器', () => {
    render(<PreviewPane preview={{ kind: 'diff', filePath: 'sub/a.ts', before: 'x', after: 'y' }} />)
    expect(screen.getByTestId('diff-preview')).toBeTruthy()
  })
  it('diff 分支:DiffView 先显示 loading 状态', () => {
    render(<PreviewPane preview={{ kind: 'diff', filePath: 'a.ts', before: 'x', after: 'y' }} />)
    // DiffView 新行为:先显示 loading 状态,Monaco 加载完成/失败后才显示 diff-view 或 fallback
    expect(screen.getByTestId('diff-loading')).toBeTruthy()
  })
  it('diff 分支:有分两列切换按钮,点击翻转 aria-pressed', () => {
    render(<PreviewPane preview={{ kind: 'diff', filePath: 'a.ts', before: 'x', after: 'y' }} />)
    const btn = screen.getByTestId('diff-split-toggle')
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })
})
