/**
 * Main 进程侧工作区文件访问。所有入口必经 withinWorkspace() 守卫。
 * 设计原则:零写入、payload 有上限、黑名单目录主进程过滤。
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { shell } from 'electron'
import type { FsNode, FsTreeResult } from '../shared/types'

/** 永远不进树的目录名(不区分大小写)。 */
export const IGNORED_DIR_NAMES = new Set([
  'node_modules', '.git', 'target', 'dist', 'build', '.idea', '.vscode',
])
/** 永远忽略的文件名。 */
export const IGNORED_FILE_NAMES = new Set(['.DS_Store', 'Thumbs.db'])

export const MAX_TREE_NODES = 500
/** IPC 单响应上限 (512 KB) */
export const MAX_TREE_BYTES = 524_288

/**
 * 路径安全单入口守卫。返回 normalize 后的绝对路径;违规直接 throw。
 * 注意: realpath 解 symlink 在 list/read/stat 内部调用各自在打开文件后再做;这里只做静态路径校验,
 * 因为对不存在的路径做 realpath 会抛,影响目录枚举前的合法性判断。
 */
export function withinWorkspace(absPath: string, getWorkspaceRoot: () => string): string {
  if (!path.isAbsolute(absPath)) {
    throw new Error('路径必须是绝对路径')
  }
  const root = getWorkspaceRoot()
  const rootN = path.normalize(root)
  const norm = path.normalize(absPath)
  const sep = path.sep
  const inWork = norm === rootN || norm.startsWith(rootN + sep)
  if (!inWork) {
    throw new Error('路径不在工作区')
  }
  return norm
}

/** 当前 workspace 根路径自身作为 FsNode 的辅助工厂。 */
function rootFsNode(root: string): FsNode {
  const name = root.split(path.sep).filter(Boolean).pop() ?? root
  return { path: root, parentPath: '', name, kind: 'dir' }
}

/** 读一个目录,生成一层 FsNode[] (不递归)。 */
async function readDirLayer(
  dirPath: string,
  getWorkspaceRoot: () => string,
): Promise<FsNode[]> {
  withinWorkspace(dirPath, getWorkspaceRoot)
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const out: FsNode[] = []
  for (const e of entries) {
    const lower = e.name.toLowerCase()
    if (e.isDirectory() && IGNORED_DIR_NAMES.has(lower)) continue
    if (e.isFile() && IGNORED_FILE_NAMES.has(lower)) continue
    const abs = path.join(dirPath, e.name)
    const kind: FsNode['kind'] = e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'symlink' : 'file'
    const node: FsNode = { path: abs, parentPath: dirPath, name: e.name, kind }
    if (e.isFile()) {
      try {
        const st = await fs.stat(abs, { bigint: false })
        node.size = Number(st.size)
        node.mtime = st.mtimeMs
      } catch { /* stat 失败不丢节点,size/mtime 留空即可 */ }
    } else if (e.isDirectory()) {
      try {
        const st = await fs.stat(abs, { bigint: false })
        node.mtime = st.mtimeMs
      } catch { /* ignore */ }
    }
    out.push(node)
  }
  return out
}

/**
 * BFS 列出当前工作区 flat 节点。默认最多 maxDepth = 2 层,防止巨型项目首屏卡死。
 * rootPath 必须严格等于 getWorkspaceRoot()——否则 renderer 可能伪造其他根。
 */
export async function listTree(
  rootPath: string,
  getWorkspaceRoot: () => string,
  opts: { maxDepth?: number } = {},
): Promise<FsTreeResult> {
  const root = getWorkspaceRoot()
  const normRoot = path.normalize(rootPath)
  if (path.normalize(root) !== normRoot) {
    throw new Error('只能枚举当前绑定的工作区')
  }
  const maxDepth = opts.maxDepth ?? 2
  const nodes: FsNode[] = [rootFsNode(normRoot)]
  let truncated = false
  const queue: { dir: string; depth: number }[] = [{ dir: normRoot, depth: 1 }]
  let byteBudget = MAX_TREE_BYTES - 256
  while (queue.length) {
    const head = queue.shift()!
    if (head.depth > maxDepth) continue
    if (nodes.length >= MAX_TREE_NODES) { truncated = true; break }
    let layer: FsNode[] = []
    try {
      layer = await readDirLayer(head.dir, getWorkspaceRoot)
    } catch { /* 某层权限不足跳过,不影响整体 */ }
    for (const n of layer) {
      if (nodes.length >= MAX_TREE_NODES) { truncated = true; break }
      const estBytes = n.path.length * 2 + n.name.length * 2 + 32
      if (byteBudget - estBytes <= 0) { truncated = true; break }
      byteBudget -= estBytes
      nodes.push(n)
      if (n.kind === 'dir' && head.depth < maxDepth) {
        queue.push({ dir: n.path, depth: head.depth + 1 })
      }
    }
  }
  return { nodes, truncated }
}

/** 读文本内容,UTF-8 优先,失败回退 GBK(中文 Windows 常见历史文件)。超过 maxBytes 截断。 */
export async function readText(
  absPath: string,
  getWorkspaceRoot: () => string,
  maxBytes = 1_572_864,
): Promise<{ content: string; truncated: boolean; size: number }> {
  const p = withinWorkspace(absPath, getWorkspaceRoot)
  const fh = await fs.open(p, 'r')
  try {
    const stat = await fh.stat()
    const toRead = Math.min(Number(stat.size), maxBytes + 1)
    const buf = Buffer.allocUnsafe(toRead)
    const { bytesRead } = await fh.read(buf, 0, toRead, 0)
    const slice = buf.subarray(0, bytesRead)
    const truncated = bytesRead > maxBytes
    const useSlice = truncated ? slice.subarray(0, maxBytes) : slice
    const dec = new TextDecoder('utf-8', { fatal: false })
    let content = dec.decode(useSlice)
    // 检测 replacement chars 的比例:>2% 认为不是 UTF-8,退回 GBK
    let bad = 0
    for (const ch of content) if (ch === '\uFFFD') bad++
    if (content.length > 0 && bad / content.length > 0.02) {
      try {
        // @ts-ignore - TextDecoder 的 'gbk' 在 Node/Electron 中可用,类型库可能漏
        content = new TextDecoder('gbk', { fatal: false }).decode(useSlice)
      } catch { /* 退化保留 UTF-8 结果即可 */ }
    }
    return { content, truncated, size: Number(stat.size) }
  } finally {
    await fh.close().catch(() => {})
  }
}

export async function statFile(absPath: string, getWorkspaceRoot: () => string): Promise<FsNode> {
  const p = withinWorkspace(absPath, getWorkspaceRoot)
  const st = await fs.stat(p, { bigint: false })
  const parent = path.dirname(p)
  const name = path.basename(p)
  const kind: FsNode['kind'] = st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'symlink' : 'file'
  return {
    path: p,
    parentPath: parent === p ? '' : parent,
    name,
    kind,
    size: st.isFile() ? Number(st.size) : undefined,
    mtime: st.mtimeMs,
  }
}

export async function revealInFolder(absPath: string, getWorkspaceRoot: () => string): Promise<void> {
  const p = withinWorkspace(absPath, getWorkspaceRoot)
  shell.showItemInFolder(p)
}

export async function openWithDefault(absPath: string, getWorkspaceRoot: () => string): Promise<void> {
  const p = withinWorkspace(absPath, getWorkspaceRoot)
  const err = await shell.openPath(p)
  if (err) throw new Error(err)
}
