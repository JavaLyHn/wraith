// @vitest-environment jsdom
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildTreeFromFlat } from '../src/renderer/lib/fileTreeModel'
import type { FsNode } from '../src/shared/types'

const n = (p: string, kind: 'dir' | 'file', parentPath = ''): FsNode => {
  const name = p.split(/[\\/]/).pop()!
  return { path: p, parentPath: parentPath || p.slice(0, -name.length - 1).replace(/[\\/]$/, '') || '', name, kind }
}

const rootP = path.normalize('d:/wrk')
const flat: FsNode[] = [
  { ...n(rootP, 'dir'), parentPath: '' },
  n('d:/wrk/a', 'dir', rootP),
  n('d:/wrk/a/b.md', 'file', 'd:/wrk/a'),
  n('d:/wrk/c.java', 'file', rootP),
]

describe('FileTreePanel model helpers (red)', () => {
  it('buildTreeFromFlat: 根 node.path === flat[0].path; children count === 2 (a + c.java)', () => {
    const { root } = buildTreeFromFlat(flat, rootP)
    expect(root.node.path).toBe(rootP)
    expect(root.children).toHaveLength(2)
    const dirA = root.children.find(c => c.node.name === 'a')!
    expect(dirA).toBeTruthy()
    expect(dirA.children).toHaveLength(1)
    expect(dirA.children[0].node.name).toBe('b.md')
  })
})

describe('FileTreePanel component (rendering)', () => {
  afterEach(async () => {
    const { cleanup } = await import('@testing-library/react')
    cleanup()
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    vi.stubGlobal('wraith', {
      fs: {
        tree: vi.fn().mockImplementation(async (p?: string) => {
          // 模拟修复后的主进程语义:根调用返回自身+一层;子目录调用只返回该目录直接子节点
          if (p && path.normalize(p) !== rootP) {
            return { nodes: [n('d:/wrk/a/b.md', 'file', p)], truncated: false }
          }
          return { nodes: flat, truncated: false }
        }),
      },
    })
  })

  it('mounts and shows root folder items after load', async () => {
    const { render, waitFor, screen } = await import('@testing-library/react')
    const { default: FileTreePanel } = await import('../src/renderer/components/FileTreePanel')
    render(<FileTreePanel rootPath={rootP} onOpenFile={() => {}} />)
    await waitFor(() => expect(screen.getByText(/wrk/)).toBeTruthy(), { timeout: 2000 })
    expect(screen.getByText('c.java')).toBeTruthy()
  })

  it('点击文件夹:按子目录路径发 IPC 请求,懒加载渲染出子节点(回归守卫)', async () => {
    const { render, waitFor, screen, fireEvent } = await import('@testing-library/react')
    const { default: FileTreePanel } = await import('../src/renderer/components/FileTreePanel')
    render(<FileTreePanel rootPath={rootP} onOpenFile={() => {}} />)
    await waitFor(() => expect(screen.getByText('a', { selector: 'span' })).toBeTruthy(), { timeout: 2000 })
    // 子节点 b.md 初始不可见(未展开)
    expect(screen.queryByText('b.md')).toBeNull()
    fireEvent.click(screen.getByText('a', { selector: 'span' }))
    await waitFor(() => expect(screen.getByText('b.md')).toBeTruthy(), { timeout: 2000 })
    // IPC 必须收到子目录路径,而非恒用根路径
    const calls = (globalThis as any).wraith.fs.tree.mock.calls as unknown[][]
    expect(calls.some(c => path.normalize(String(c[0] ?? '')) === path.normalize('d:/wrk/a'))).toBe(true)
  })
})
