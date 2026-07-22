// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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
  it('diff 分支:DiffView 以 fill 模式充满(host height 100%)', () => {
    render(<PreviewPane preview={{ kind: 'diff', filePath: 'a.ts', before: 'x', after: 'y' }} />)
    // 断言在 render() 之后同步执行:Monaco 动态 import 的 reject 走微任务,
    // 此刻 DiffView 尚未 setFailed(true),host 仍是初始同步渲染出的 diff-view div。
    const host = screen.getByTestId('diff-view') as HTMLElement
    expect(host.style.height).toBe('100%')
  })
})
