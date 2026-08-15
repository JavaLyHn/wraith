import path from 'node:path'
import type { FsNode } from '../../shared/types'

/** 用于渲染的 children 树节点。完全由 flat FsNode[] 派生,纯函数重建无副作用。 */
export interface TreeNode {
  node: FsNode
  children: TreeNode[]
}

/**
 * Build children tree from flat FsNode[] + 返回 path → FsNode 的 flat 索引 (方便懒加载子节点合并)。
 * 父节点缺失时子节点会被挂到 root 下(容错,不抛)。
 */
export function buildTreeFromFlat(nodes: FsNode[], rootPath: string): { root: TreeNode; flatIndex: Map<string, FsNode> } {
  const rootN = path.normalize(rootPath)
  const normalizedNodes: FsNode[] = nodes.map(n => ({
    ...n,
    path: path.normalize(n.path),
    parentPath: n.parentPath ? path.normalize(n.parentPath) : '',
  }))

  const flatIndex = new Map<string, FsNode>()
  for (const n of normalizedNodes) flatIndex.set(n.path, n)

  const byParent = new Map<string, TreeNode[]>()
  const all = new Map<string, TreeNode>()
  for (const n of normalizedNodes) {
    const tn: TreeNode = { node: n, children: [] }
    all.set(n.path, tn)
    const key = n.parentPath || ''
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(tn)
  }
  for (const [parentPath, kids] of byParent) {
    if (parentPath === '') continue
    const p = all.get(parentPath)
    if (p) p.children.push(...kids)
    else {
      const rootBucket = byParent.get('') ?? []
      rootBucket.push(...kids)
      byParent.set('', rootBucket)
    }
  }
  let rootNode = all.get(rootN)
  if (!rootNode) {
    const synthesized: FsNode = {
      path: rootN,
      parentPath: '',
      name: rootN.split(/[\\/]/).pop() || rootN,
      kind: 'dir',
    }
    rootNode = { node: synthesized, children: [] }
    flatIndex.set(rootN, synthesized)
  }
  const rootChildren = byParent.get('') ?? []
  rootNode.children.push(...rootChildren.filter(c => c.node.path !== rootNode.node.path))
  const sort = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => {
      const ak = a.node.kind, bk = b.node.kind
      if (ak !== bk) {
        if (ak === 'dir') return -1
        if (bk === 'dir') return 1
      }
      return a.node.name.localeCompare(b.node.name, undefined, { sensitivity: 'base' })
    })
    nodes.forEach(c => sort(c.children))
  }
  sort(rootNode.children)
  return { root: rootNode, flatIndex }
}

/** 把懒加载得到的 parentPath 子节点 flat list 合并进已有的 flatIndex (in-place mutate)。 */
export function insertSubtree(flatIndex: Map<string, FsNode>, _parentPath: string, newNodes: FsNode[]): void {
  for (const raw of newNodes) {
    const n: FsNode = {
      ...raw,
      path: path.normalize(raw.path),
      parentPath: raw.parentPath ? path.normalize(raw.parentPath) : '',
    }
    flatIndex.set(n.path, n)
  }
}
