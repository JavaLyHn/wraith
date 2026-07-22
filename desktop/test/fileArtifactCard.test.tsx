// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import FileArtifactCard from '../src/renderer/components/FileArtifactCard'
import { OpenWithMenu } from '../src/renderer/components/OpenWithMenu'
import type { ArtifactFile } from '../src/shared/artifactSummary'
import type { EditorApp } from '../src/shared/editors'

const created: ArtifactFile = { path: 'sub/new.md', kind: 'created', content: '新', before: '' }
const modified: ArtifactFile = { path: 'sub/a.ts', kind: 'modified', content: '新', before: '旧' }
const noop: ArtifactFile = { path: 'sub/x.md', kind: 'modified', content: '同', before: null }
const editors: EditorApp[] = [{ name: 'VS Code', appPath: '/Applications/Visual Studio Code.app' }]

function mockWraith() {
  const w = {
    openPath: vi.fn(() => Promise.resolve()),
    revealInFinder: vi.fn(() => Promise.resolve()),
    openWithApp: vi.fn(() => Promise.resolve()),
    downloadCopy: vi.fn(() => Promise.resolve('/Users/x/Downloads/new.md')),
  }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = w
  return w
}

beforeEach(() => mockWraith())
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('FileArtifactCard 头部', () => {
  it('created → 新建 baseName', () => {
    render(<FileArtifactCard file={created} workspace="/proj" editors={editors} />)
    expect(screen.getByText(/新建 new\.md/)).toBeTruthy()
  })
  it('modified → 已编辑 baseName', () => {
    render(<FileArtifactCard file={modified} workspace="/proj" editors={editors} />)
    expect(screen.getByText(/已编辑 a\.ts/)).toBeTruthy()
  })
})

describe('查看更改 / 审核 → onOpenDiff(path, before, content)', () => {
  it('查看更改 与 审核 都以 (path, before, after) 调', () => {
    const onOpenDiff = vi.fn()
    render(<FileArtifactCard file={modified} workspace="/proj" editors={editors} onOpenDiff={onOpenDiff} />)
    fireEvent.click(screen.getByTestId('file-artifact-viewdiff'))
    expect(onOpenDiff).toHaveBeenCalledWith('sub/a.ts', '旧', '新')
    fireEvent.click(screen.getByTestId('file-artifact-review'))
    expect(onOpenDiff).toHaveBeenCalledTimes(2)
  })
  it('before===null → 无 查看更改/审核/撤销', () => {
    render(<FileArtifactCard file={noop} workspace="/proj" editors={editors} onOpenDiff={vi.fn()} onUndo={vi.fn()} />)
    expect(screen.queryByTestId('file-artifact-viewdiff')).toBeNull()
    expect(screen.queryByTestId('file-artifact-review')).toBeNull()
    expect(screen.queryByTestId('file-artifact-undo')).toBeNull()
  })
})

describe('撤销', () => {
  it('confirm 后调 onUndo(file),成功显示已撤销', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onUndo = vi.fn(() => Promise.resolve(true))
    render(<FileArtifactCard file={modified} workspace="/proj" editors={editors} onUndo={onUndo} />)
    fireEvent.click(screen.getByTestId('file-artifact-undo'))
    expect(onUndo).toHaveBeenCalledWith(modified)
    await waitFor(() => expect(screen.getByText('已撤销')).toBeTruthy())
  })
  it('confirm 取消 → 不调 onUndo', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onUndo = vi.fn(() => Promise.resolve(true))
    render(<FileArtifactCard file={modified} workspace="/proj" editors={editors} onUndo={onUndo} />)
    fireEvent.click(screen.getByTestId('file-artifact-undo'))
    expect(onUndo).not.toHaveBeenCalled()
  })
  it('onUndo 失败(resolve false)→ 撤销失败提示,且不显示已撤销', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onUndo = vi.fn(() => Promise.resolve(false))
    render(<FileArtifactCard file={modified} workspace="/proj" editors={editors} onUndo={onUndo} />)
    fireEvent.click(screen.getByTestId('file-artifact-undo'))
    await screen.findByText('撤销失败')
    expect(screen.queryByText('已撤销')).toBeNull()
  })
})

describe('OpenWithMenu(抽出后)', () => {
  it('默认/编辑器/Finder/下载 用绝对路径调对应 IPC', () => {
    const w = mockWraith()
    render(<OpenWithMenu file={created} workspace="/proj" editors={editors} />)
    fireEvent.click(screen.getByTestId('openwith-default'))
    expect(w.openPath).toHaveBeenCalledWith('/proj/sub/new.md')
    fireEvent.click(screen.getByTestId('openwith-editor-0'))
    expect(w.openWithApp).toHaveBeenCalledWith('/proj/sub/new.md', '/Applications/Visual Studio Code.app')
    fireEvent.click(screen.getByTestId('openwith-reveal'))
    expect(w.revealInFinder).toHaveBeenCalledWith('/proj/sub/new.md')
    fireEvent.click(screen.getByTestId('openwith-download'))
    expect(w.downloadCopy).toHaveBeenCalledWith('/proj/sub/new.md')
  })
  it('editors 为空只有固定项', () => {
    render(<OpenWithMenu file={created} workspace="/proj" editors={[]} />)
    expect(screen.queryByTestId('openwith-editor-0')).toBeNull()
    expect(screen.getByTestId('openwith-default')).toBeTruthy()
  })
  it('OpenWithMenu onAction 在点击后被调(供关闭 popover)', () => {
    const onAction = vi.fn()
    render(<OpenWithMenu file={created} workspace="/proj" editors={editors} onAction={onAction} />)
    fireEvent.click(screen.getByTestId('openwith-default'))
    expect(onAction).toHaveBeenCalled()
  })
})
