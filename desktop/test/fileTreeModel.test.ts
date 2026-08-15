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
})
