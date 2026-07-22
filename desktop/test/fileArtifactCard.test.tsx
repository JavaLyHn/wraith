// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import FileArtifactCard, { OpenWithMenu } from '../src/renderer/components/FileArtifactCard'
import type { ArtifactFile } from '../src/shared/artifactSummary'
import type { EditorApp } from '../src/shared/editors'

const file: ArtifactFile = { path: 'sub/README.md', kind: 'created', content: '你好', before: '' }
const editors: EditorApp[] = [{ name: 'VS Code', appPath: '/Applications/Visual Studio Code.app' }]

function mockWraith() {
  const w = {
    openPath: vi.fn(() => Promise.resolve()),
    revealInFinder: vi.fn(() => Promise.resolve()),
    openWithApp: vi.fn(() => Promise.resolve()),
    downloadCopy: vi.fn(() => Promise.resolve('/Users/x/Downloads/README.md')),
  }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = w
  return w
}

beforeEach(() => mockWraith())
afterEach(() => cleanup())

describe('FileArtifactCard', () => {
  it('显示文件名 baseName + 类型标签', () => {
    render(<FileArtifactCard file={file} workspace="/proj" editors={editors} onOpenPreview={vi.fn()} />)
    expect(screen.getByText('README.md')).toBeTruthy()
    expect(screen.getByText('文档 · MD')).toBeTruthy()
  })

  it('点文件名 → onOpenPreview(path, content)', () => {
    const onOpenPreview = vi.fn()
    render(<FileArtifactCard file={file} workspace="/proj" editors={editors} onOpenPreview={onOpenPreview} />)
    fireEvent.click(screen.getByTestId('file-artifact-open-preview'))
    expect(onOpenPreview).toHaveBeenCalledWith('sub/README.md', '你好')
  })
})

describe('OpenWithMenu', () => {
  it('默认/编辑器/Finder/下载 用绝对路径调对应 IPC', () => {
    const w = mockWraith()
    render(<OpenWithMenu file={file} workspace="/proj" editors={editors} />)
    fireEvent.click(screen.getByTestId('openwith-default'))
    expect(w.openPath).toHaveBeenCalledWith('/proj/sub/README.md')
    fireEvent.click(screen.getByTestId('openwith-editor-0'))
    expect(w.openWithApp).toHaveBeenCalledWith('/proj/sub/README.md', '/Applications/Visual Studio Code.app')
    fireEvent.click(screen.getByTestId('openwith-reveal'))
    expect(w.revealInFinder).toHaveBeenCalledWith('/proj/sub/README.md')
    fireEvent.click(screen.getByTestId('openwith-download'))
    expect(w.downloadCopy).toHaveBeenCalledWith('/proj/sub/README.md')
  })

  it('editors 为空时只有固定项(默认/Finder/下载)', () => {
    render(<OpenWithMenu file={file} workspace="/proj" editors={[]} />)
    expect(screen.queryByTestId('openwith-editor-0')).toBeNull()
    expect(screen.getByTestId('openwith-default')).toBeTruthy()
    expect(screen.getByTestId('openwith-reveal')).toBeTruthy()
    expect(screen.getByTestId('openwith-download')).toBeTruthy()
  })

  it('onAction 在点击后被调(供关闭 popover)', () => {
    const onAction = vi.fn()
    render(<OpenWithMenu file={file} workspace="/proj" editors={editors} onAction={onAction} />)
    fireEvent.click(screen.getByTestId('openwith-default'))
    expect(onAction).toHaveBeenCalled()
  })
})
