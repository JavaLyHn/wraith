// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import DiffCard from '../src/renderer/components/DiffCard'

afterEach(() => cleanup())

describe('DiffCard 右侧入口', () => {
  it('点「在右侧打开」调 onOpenArtifact(filePath, after),且不折叠', () => {
    const onOpen = vi.fn()
    render(<DiffCard filePath="README.md" before="" after="你好" onOpenArtifact={onOpen} />)
    const toggle = screen.getByTestId('diff-card-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByTestId('diff-card-open'))
    expect(onOpen).toHaveBeenCalledWith('README.md', '你好')
    expect(toggle.getAttribute('aria-expanded')).toBe('true') // 打开右侧不影响展开态
  })

  it('无 onOpenArtifact 时不渲染右侧入口', () => {
    render(<DiffCard filePath="a.md" before="" after="x" />)
    expect(screen.queryByTestId('diff-card-open')).toBeNull()
  })

  it('点切换按钮仍能折叠/展开', () => {
    render(<DiffCard filePath="a.md" before="" after="x" onOpenArtifact={vi.fn()} />)
    const toggle = screen.getByTestId('diff-card-toggle')
    expect(screen.getByTestId('diff-card-toggle-label').getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })
})
