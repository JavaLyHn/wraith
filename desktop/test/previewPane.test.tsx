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
})
