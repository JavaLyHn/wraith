// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import ArtifactPreview from '../src/renderer/components/ArtifactPreview'

afterEach(() => cleanup())

describe('ArtifactPreview', () => {
  it('.md → 渲染 markdown(标题不带 #),容器带 agent-markdown', () => {
    render(<ArtifactPreview filePath="README.md" content={'# 标题\n\n正文'} />)
    const md = screen.getByTestId('artifact-markdown')
    expect(md.className).toContain('agent-markdown')
    expect(md.querySelector('h1')?.textContent).toBe('标题')
    expect(md.textContent).not.toContain('#')
  })

  it('非 md(.ts)→ 原文进 <pre>,不被 markdown 解释', () => {
    const src = 'const x = 1 // # not a heading'
    render(<ArtifactPreview filePath="src/a.ts" content={src} />)
    const code = screen.getByTestId('artifact-code')
    expect(code.tagName).toBe('PRE')
    expect(code.textContent).toBe(src)
    expect(screen.queryByTestId('artifact-markdown')).toBeNull()
  })

  it('空 content → 占位', () => {
    render(<ArtifactPreview filePath="empty.md" content="" />)
    expect(screen.getByTestId('artifact-empty')).toBeTruthy()
  })

  it('顶部显示文件名 baseName', () => {
    render(<ArtifactPreview filePath="/a/b/README.md" content="x" />)
    expect(screen.getByText('README.md')).toBeTruthy()
  })
})
