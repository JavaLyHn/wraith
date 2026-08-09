// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import FileArtifactHoverPreview from '../src/renderer/components/FileArtifactHoverPreview'
import type { ArtifactFile } from '../src/shared/artifactSummary'
import type { EditorApp } from '../src/shared/editors'

const md: ArtifactFile = { path: 'sub/spec.md', kind: 'created', content: '# 标题\n正文', before: '' }
const editors: EditorApp[] = []

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('FileArtifactHoverPreview hover 时序', () => {
  it('hover 300ms 后显示 popover', () => {
    render(<FileArtifactHoverPreview file={md} workspace="/proj" editors={editors} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    // 299ms 不显示
    act(() => { vi.advanceTimersByTime(299) })
    expect(screen.queryByTestId('artifact-hover-popover')).toBeNull()
    // 300ms 显示
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByTestId('artifact-hover-popover')).toBeTruthy()
  })

  it('300ms 内 mouseleave 不显示', () => {
    render(<FileArtifactHoverPreview file={md} workspace="/proj" editors={editors} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(200) })
    fireEvent.mouseLeave(card)
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByTestId('artifact-hover-popover')).toBeNull()
  })

  it('mouseleave popover 200ms 后关闭', () => {
    render(<FileArtifactHoverPreview file={md} workspace="/proj" editors={editors} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.mouseLeave(card)
    act(() => { vi.advanceTimersByTime(199) })
    expect(screen.getByTestId('artifact-hover-popover')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByTestId('artifact-hover-popover')).toBeNull()
  })

  it('鼠标从卡片移到 popover 不关闭(桥接区)', () => {
    render(<FileArtifactHoverPreview file={md} workspace="/proj" editors={editors} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.mouseLeave(card)
    // 199ms 内进入 popover
    act(() => { vi.advanceTimersByTime(199) })
    const popover = screen.getByTestId('artifact-hover-popover')
    fireEvent.mouseEnter(popover)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByTestId('artifact-hover-popover')).toBeTruthy()
  })
})

describe('FileArtifactHoverPreview 内容', () => {
  it('空内容显示占位', () => {
    const empty: ArtifactFile = { path: 'sub/empty.txt', kind: 'created', content: '', before: '' }
    render(<FileArtifactHoverPreview file={empty} workspace="/proj" editors={editors} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByTestId('artifact-empty')).toBeTruthy()
  })

  it('超过 50KB 截断并显示提示', () => {
    const big: ArtifactFile = { path: 'sub/big.txt', kind: 'created', content: 'a'.repeat(50 * 1024 + 100), before: '' }
    render(<FileArtifactHoverPreview file={big} workspace="/proj" editors={editors} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByTestId('artifact-code').textContent?.length).toBeLessThanOrEqual(50 * 1024)
    expect(screen.getByText(/内容过长,预览已截断/)).toBeTruthy()
  })

  it('.md 内容走 react-markdown', () => {
    render(<FileArtifactHoverPreview file={md} workspace="/proj" editors={editors} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByTestId('artifact-markdown')).toBeTruthy()
  })
})

describe('FileArtifactHoverPreview click 行为', () => {
  it('click 文件名按钮触发 onOpenPreview,不影响 hover', () => {
    const onOpenPreview = vi.fn()
    render(<FileArtifactHoverPreview file={md} workspace="/proj" editors={editors} onOpenPreview={onOpenPreview} />)
    fireEvent.click(screen.getByTestId('file-artifact-open-preview'))
    expect(onOpenPreview).toHaveBeenCalledWith('sub/spec.md', '# 标题\n正文')
  })

  it('click 查看更改后立即关闭 popover', () => {
    const onOpenDiff = vi.fn()
    const modified: ArtifactFile = { path: 'sub/a.ts', kind: 'modified', content: '新', before: '旧' }
    render(<FileArtifactHoverPreview file={modified} workspace="/proj" editors={editors} onOpenDiff={onOpenDiff} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByTestId('artifact-hover-popover')).toBeTruthy()
    fireEvent.click(screen.getByTestId('file-artifact-viewdiff'))
    expect(screen.queryByTestId('artifact-hover-popover')).toBeNull()
  })
})
