// @vitest-environment jsdom
import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  beforeEach(() => {
    vi.stubGlobal('wraith', {
      fs: {
        tree: vi.fn().mockImplementation(async (_p?: string) => ({
          nodes: flat,
          truncated: false,
        })),
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
})
