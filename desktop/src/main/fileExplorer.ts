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
 * 单节点 IPC 体积估算(UTF-16 2B/字符近似)。
 * envelope = V8 对象头 + JSON 结构字符 + kind/size/mtime 数字字段的序列化开销。
 * parentPath 必须计入: 它是完整目录路径,与 path 同量级,漏算会让实际响应体明显超过预算。
 */
export const NODE_ENVELOPE_BYTES = 96
export function estimateNodeBytes(n: FsNode): number {
  return (n.path.length + n.parentPath.length + n.name.length) * 2 + NODE_ENVELOPE_BYTES
}

/**
 * 路径安全单入口守卫。返回 normalize 后的绝对路径;违规直接 throw。
 * 注意: 这里只做静态路径校验,不解析 symlink ——
 * 1) 对不存在的路径做 realpath 会抛,影响目录枚举前的合法性判断;
 * 2) follow-symlink 场景由 resolveRealWithin 在真正打开文件前兜底(见其注释)。
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

/**
 * realpath 结果的二次断言(纯函数,便于注入测试)。
 * Windows 大小写不敏感: realpath 返回"真实大小写",可能与绑定 root 的拼写不一致
 * (用户手输 config 的小写盘符),两侧 fold 成小写再比较,避免合法文件被误拒。
 */
export function assertRealWithin(
  realPath: string,
  getWorkspaceRoot: () => string,
  isWindows: boolean,
): string {
  const rootN = path.normalize(getWorkspaceRoot())
  const realN = path.normalize(realPath)
  const sep = path.sep
  let inWork: boolean
  if (isWindows) {
    const rootL = rootN.toLowerCase()
    const realL = realN.toLowerCase()
    inWork = realL === rootL || realL.startsWith(rootL + sep)
  } else {
    inWork = realN === rootN || realN.startsWith(rootN + sep)
  }
  if (!inWork) {
    throw new Error('路径不在工作区')
  }
  return realN
}

/**
 * 第二道守卫(spec §8 第 4 关): fs.realpath 解析 symlink 链后再复验落在工作区内。
 * fs.open / fs.stat / shell.openPath 都会 follow symlink —— 只过 withinWorkspace 静态校验
 * 验证的是"链接自身的路径",在 workspace 里放一个指向外部文件的符号链接即可绕过校验
 * 读取工作区外的内容。所有会打开/读取/唤起系统程序的入口必须先走这里。
 */
export async function resolveRealWithin(
  absPath: string,
  getWorkspaceRoot: () => string,
  realpath: (p: string) => Promise<string> = (p) => fs.realpath(p),
): Promise<string> {
  const norm = withinWorkspace(absPath, getWorkspaceRoot)
  const real = await realpath(norm)
  return assertRealWithin(real, getWorkspaceRoot, process.platform === 'win32')
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
 * BFS 列出工作区 flat 节点,以 rootPath(工作区根或其任意子目录,懒加载展开用)为起点。
 * 默认最多 maxDepth = 2 层,防止巨型项目首屏卡死。
 * 伪造其他根由 withinWorkspace 挡(工作区外/.. 逃逸直接拒),不要求严格等于根 ——
 * 否则子目录懒加载请求全被"只能枚举当前绑定的工作区"拒绝,展开永远无内容。
 */
export async function listTree(
  rootPath: string,
  getWorkspaceRoot: () => string,
  opts: { maxDepth?: number } = {},
): Promise<FsTreeResult> {
  const normRoot = withinWorkspace(rootPath, getWorkspaceRoot)
  const isWorkspaceRoot = path.normalize(getWorkspaceRoot()) === normRoot
  const maxDepth = opts.maxDepth ?? 2
  // 仅工作区根调用返回自身节点(renderer 的 resolveRootPath 依赖 !parentPath 找根);
  // 子目录调用若返回自身,parentPath:'' 会把已有节点顶成孤儿、挂到根下重复显示
  const nodes: FsNode[] = isWorkspaceRoot ? [rootFsNode(normRoot)] : []
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
      const estBytes = estimateNodeBytes(n)
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
  const p = await resolveRealWithin(absPath, getWorkspaceRoot)
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
    // 编码检测回退 GBK:
    // 1) 触发: 出现 replacement char,且比例 >2%,或内容很短(<64 字符)时只要有 1 个就触发 ——
    //    比例阈值在极短内容上是统计噪声,老中文小文件常被漏检。
    // 2) 采纳: GBK 重解的 replacement char 数量必须严格更少才替换 ——
    //    UTF-8 文件局部损坏 1 字节时,盲目换 GBK 会把整篇变成乱码(比保留局部 U+FFFD 更糟)。
    let bad = 0
    for (const ch of content) if (ch === '\uFFFD') bad++
    const ratio = content.length > 0 ? bad / content.length : 0
    if (bad > 0 && (ratio > 0.02 || content.length < 64)) {
      try {
        // @ts-ignore - TextDecoder 的 'gbk' 在 Node/Electron 中可用,类型库可能漏
        const gbk = new TextDecoder('gbk', { fatal: false }).decode(useSlice)
        let gbkBad = 0
        for (const ch of gbk) if (ch === '\uFFFD') gbkBad++
        if (gbkBad < bad) content = gbk
      } catch { /* 编码不可用时保留 UTF-8 结果 */ }
    }
    return { content, truncated, size: Number(stat.size) }
  } finally {
    await fh.close().catch(() => {})
  }
}

export async function statFile(absPath: string, getWorkspaceRoot: () => string): Promise<FsNode> {
  const p = await resolveRealWithin(absPath, getWorkspaceRoot)
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
  const p = await resolveRealWithin(absPath, getWorkspaceRoot)
  shell.showItemInFolder(p)
}

export async function openWithDefault(absPath: string, getWorkspaceRoot: () => string): Promise<void> {
  const p = await resolveRealWithin(absPath, getWorkspaceRoot)
  const err = await shell.openPath(p)
  if (err) throw new Error(err)
}
