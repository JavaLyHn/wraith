import type { FsNode } from '../../shared/types'

/**
 * 跨平台路径规范化(renderer 纯函数,不能依赖 node:path —— Vite 对 browser bundle
 * externalize Node 内建模块,运行时访问其属性会抛
 * "Module node:path has been externalized for browser compatibility")。
 * 行为对齐 path.normalize 的关键子集: 压掉重复分隔符与 . 段、解析 .. 段、去尾分隔符;
 * 保留输入的分隔符风格(Windows 盘符/反斜杠 或 POSIX 正斜杠)。
 */
export function normalizePath(p: string): string {
  if (!p) return p
  let prefix = ''
  let rest = p
  if (/^[a-zA-Z]:[\\/]/.test(p)) {
    // Windows 盘符根,统一保留首个分隔符原样
    prefix = p.slice(0, 2) + (p[2] === '/' ? '/' : '\\')
    rest = p.slice(3)
  } else if (p.startsWith('/') || p.startsWith('\\')) {
    prefix = p[0]
    rest = p.slice(1)
  }
  const sep = prefix.endsWith('\\') || (!prefix.includes('/') && p.includes('\\')) ? '\\' : '/'
  const out: string[] = []
  for (const seg of rest.split(/[\\/]/)) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!prefix) out.push('..') // 绝对路径根处的 .. 直接丢弃,与 node:path 一致
      continue
    }
    out.push(seg)
  }
  return prefix + out.join(sep)
}

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
  const rootN = normalizePath(rootPath)
  const normalizedNodes: FsNode[] = nodes.map(n => ({
    ...n,
    path: normalizePath(n.path),
    parentPath: n.parentPath ? normalizePath(n.parentPath) : '',
  }))

  const flatIndex = new Map<string, FsNode>()
  for (const n of normalizedNodes) flatIndex.set(n.path, n)

  const byParent = new Map<string, TreeNode[]>()
  const all = new Map<string, TreeNode>()
  for (const n of normalizedNodes) {
    const tn: TreeNode = { node: n, children: [] }
    all.set(n.path, tn)
    const key = n.parentPath || ''
    let bucket = byParent.get(key)
    if (!bucket) { bucket = []; byParent.set(key, bucket) }
    bucket.push(tn)
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
      path: normalizePath(raw.path),
      parentPath: raw.parentPath ? normalizePath(raw.parentPath) : '',
    }
    flatIndex.set(n.path, n)
  }
}
