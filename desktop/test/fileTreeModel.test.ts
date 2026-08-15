import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { buildTreeFromFlat, insertSubtree } from '../src/renderer/lib/fileTreeModel'
import type { FsNode } from '../src/shared/types'

const n = (p: string, kind: 'dir'|'file', parentPath = ''): FsNode => {
  const name = p.split(/[\\/]/).pop()!
  return { path: p, parentPath: parentPath || p.slice(0, -name.length - 1).replace(/[\\/]$/, '') || '', name, kind }
}

describe('buildTreeFromFlat', () => {
  it('3 层目录正确归组', () => {
    const root = 'd:\\wraith'
    const nodes: FsNode[] = [
      { ...n(root, 'dir'), parentPath: '' },
      n('d:\\wraith\\policy', 'dir', root),
      n('d:\\wraith\\policy\\sandbox', 'dir', 'd:\\wraith\\policy'),
      n('d:\\wraith\\policy\\sandbox\\A.java', 'file', 'd:\\wraith\\policy\\sandbox'),
      n('d:\\wraith\\policy\\sandbox\\B.java', 'file', 'd:\\wraith\\policy\\sandbox'),
      n('d:\\wraith\\plan', 'dir', root),
    ]
    const { root: tree, flatIndex } = buildTreeFromFlat(nodes, root)
    expect(tree.node.path).toBe(root)
    expect(tree.children).toHaveLength(2)   // policy, plan
    const policy = tree.children.find(c => c.node.name === 'policy')!
    expect(policy.children).toHaveLength(1) // sandbox
    const sandbox = policy.children[0]
    expect(sandbox.children).toHaveLength(2) // A.java, B.java
    expect(flatIndex.get('d:\\wraith\\policy\\sandbox\\A.java')?.name).toBe('A.java')
  })

  it('insertSubtree 合并懒加载子节点进 flatIndex', () => {
    const root = 'd:\\wraith'
    const firstLoad: FsNode[] = [
      { ...n(root, 'dir'), parentPath: '' },
      n('d:\\wraith\\deep', 'dir', root),
    ]
    const { root: tree, flatIndex } = buildTreeFromFlat(firstLoad, root)
    expect(flatIndex.size).toBe(2)
    // 用户展开 deep 目录,后端懒加载其子节点
    const lazy: FsNode[] = [
      n('d:\\wraith\\deep\\sub', 'dir', 'd:\\wraith\\deep'),
      n('d:\\wraith\\deep\\X.txt', 'file', 'd:\\wraith\\deep'),
    ]
    insertSubtree(flatIndex, 'd:\\wraith\\deep', lazy)
    expect(flatIndex.size).toBe(4)
    expect(flatIndex.get('d:\\wraith\\deep\\X.txt')?.kind).toBe('file')
    // 同时 buildTreeFromFlat 重新跑一遍应该正确归组 (insertSubtree 只改 flatIndex, build 是纯函数)
    const allNodes = Array.from(flatIndex.values())
    const { root: rebuilt } = buildTreeFromFlat(allNodes, root)
    const deep = rebuilt.children.find(c => c.node.name === 'deep')!
    expect(deep.children).toHaveLength(2)
  })

  it('F1: root 缺失时合成根节点并加入 flatIndex', () => {
    const root = 'd:\\projects\\myapp'
    const nodes: FsNode[] = [
      n('d:\\projects\\myapp\\src', 'dir', root),
      n('d:\\projects\\myapp\\src\\index.ts', 'file', 'd:\\projects\\myapp\\src'),
      n('d:\\projects\\myapp\\README.md', 'file', root),
    ]
    const { root: tree, flatIndex } = buildTreeFromFlat(nodes, root)
    const rootFromIndex = flatIndex.get(root)
    expect(rootFromIndex).toBeDefined()
    expect(rootFromIndex?.kind).toBe('dir')
    expect(rootFromIndex?.parentPath).toBe('')
    expect(rootFromIndex?.path).toBe(root)
    expect(tree.node).toBe(rootFromIndex)
    expect(tree.children.length).toBeGreaterThanOrEqual(1)
  })

  it('F2: path.normalize 防御 POSIX 斜杠和 dot segments', () => {
    const root = '/home/user/workspace'
    const rootN = path.normalize(root)
    const srcN = path.normalize('/home/user/workspace/src')
    const mainN = path.normalize('/home/user/workspace/src/main.ts')
    const readmeN = path.normalize('/home/user/workspace/README.md')
    const nodes: FsNode[] = [
      {
        path: '/home/user/./workspace/src',
        parentPath: '/home/user/./workspace/./.',
        name: 'src',
        kind: 'dir',
      },
      {
        path: '/home/user/./workspace/src/./lib/../main.ts',
        parentPath: '/home/user/./workspace/src',
        name: 'main.ts',
        kind: 'file',
      },
      {
        path: '/home/a/../user/workspace/./README.md',
        parentPath: '/home/a/../user/./workspace',
        name: 'README.md',
        kind: 'file',
      },
    ]
    const { root: tree, flatIndex } = buildTreeFromFlat(nodes, root)
    for (const key of flatIndex.keys()) {
      expect(key).not.toMatch(/[\\/]\.\.?[\\/]/)
      expect(key).not.toMatch(/[\\/]\.\.$/)
      expect(key).not.toMatch(/[\\/]\.$/)
    }
    expect(tree.node.path).toBe(rootN)
    const srcChild = tree.children.find(c => c.node.name === 'src')
    expect(srcChild).toBeDefined()
    expect(srcChild?.node.parentPath).toBe(rootN)
    const mainTs = flatIndex.get(mainN)
    expect(mainTs).toBeDefined()
    expect(mainTs?.name).toBe('main.ts')
    expect(mainTs?.parentPath).toBe(srcN)
    const readme = flatIndex.get(readmeN)
    expect(readme).toBeDefined()
    expect(readme?.parentPath).toBe(rootN)
  })
})
