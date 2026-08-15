# Workspace File Explorer（只读文件树 + 预览 Tab）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `view === 'chat'` 的聊天视图内新增中栏文件树 + 右栏多 Tab 工作区；用户可在文件树中浏览当前工作区真实目录，点击代码/文档/图片文件追加只读预览 Tab，同时保留「聊天」Tab 恒存可随时切回对话。

**Architecture:** 主进程新增 `fileExplorer.ts`（带严格 `withinWorkspace` 路径守卫），通过 `wraith:fs:*` IPC 暴露 flat 树枚举、文本读取、系统 shell 操作；前端新增 3 个纯函数库（filePreviewKind / fileTreeModel）+ 3 个组件（WorkbenchTabBar / FileTreePanel / FilePreviewPanel），在 `App.tsx` chat 分支用两列 Grid 把现有 Sidebar / FileTreePanel / WorkbenchArea 拼成三栏结构。Tab 状态（聊天恒存 + 文件可关）、文件树宽度、可见性均在 App 层管理并持久化到 localStorage。

**Tech Stack:** TypeScript 5.5 + React 18.3 + Tailwind 3.4 + Vitest 2 + Electron 32 + highlight.js 11（代码高亮）+ react-markdown 9（Markdown 预览，已有）+ Node.js `fs/promises`（主进程文件访问）+ Electron `shell` API（reveal/openExternal）

## Global Constraints

- 零写入：整个链路不提供任何 `writeFile / mkdir / rename / rm`；前端 UI 不出现相关按钮
- 路径安全：所有 `wraith:fs:*` IPC 通过**同一个** `withinWorkspace(absPath, getWorkspaceRoot())` 守卫；守卫包含：绝对路径 + normalize 消除 `..` + realpath 解 symlink + 前缀匹配；失败只返回「路径不在工作区」的中文错误串，不抛堆栈
- 黑名单目录（主进程过滤，不是前端隐藏）：`node_modules / .git / target / dist / build / .idea / .vscode / .DS_Store / Thumbs.db`
- Payload 上限：`fs.tree` 最多 500 条节点 / 512KB 总大小；`fs.readText` 最多 1.5MB（1_572_864 字节），超限截断并标记
- Tab 不变量：`workbenchTabs[0].id === 'chat'` 恒真；聊天 Tab 不渲染关闭按钮；关闭当前 active 的文件 Tab 后 activeId 自动变为 `'chat'`
- 不破坏现有 view 切换：侧栏 plugins / browser / documents 等仍是单面板；只有 `view === 'chat'` 时文件树才显示
- 侧栏入口不切 view：点「资料 → 文件」只是 toggle `fileTreeVisible`；用独立 prop `fileExplorerActive` 控制高亮，不走 `activeNav`（那是 view 切换专用的）
- 遵循用户偏好：**TDD（RED before GREEN）**，每个任务先写失败测试再实现；完成后跑对应命令
- Node/Electron：主进程代码是 TypeScript ESM（`type: module` in package.json），import 用 ESM 语法，`__dirname` 用 `import.meta.dirname` 代替
- Windows 路径规范：所有路径比较前用 `path.resolve(p)` 归一，比较前缀用 `path.sep` 拼接根路径后 `startsWith`

---

### Task 1: 类型定义 + 纯函数库（filePreviewKind / fileTreeModel）

**Files:**
- Modify: `desktop/src/shared/types.ts`（末尾追加 `FsNode`、`PreviewKind`、`FsTreeResult` 接口）
- Create: `desktop/src/renderer/lib/filePreviewKind.ts`
- Create: `desktop/src/renderer/lib/fileTreeModel.ts`
- Test: `desktop/test/filePreviewKind.test.ts`
- Test: `desktop/test/fileTreeModel.test.ts`

**Interfaces:**
- Consumes: 无纯代码依赖；types.ts 不 consume 其他任务产出
- Produces:
  ```ts
  // types.ts 追加
  export interface FsNode {
    path: string          // 绝对路径, path.resolve 归一
    parentPath: string    // 父目录绝对路径;根节点(workspace自身)为 ''
    name: string          // basename
    kind: 'dir' | 'file' | 'symlink'
    size?: number         // 文件字节;目录不填
    mtime?: number        // 修改时间 epoch ms
  }
  export interface FsTreeResult { nodes: FsNode[]; truncated: boolean }
  export type PreviewKind = 'code' | 'markdown' | 'image' | 'pdf' | 'binary'
  ```
  - `previewKind(path: string): PreviewKind`（按扩展名小写匹配）
  - `MAX_TEXT_BYTES = 1_572_864` 常量（1.5MB）
  - `buildTreeFromFlat(nodes: FsNode[], rootPath: string): { root: TreeNode; flatIndex: Map<string, FsNode> }`（TreeNode 是前端渲染用的 children 树）
  - `insertSubtree(flatIndex: Map<string, FsNode>, parentPath: string, newNodes: FsNode[]): void`（懒加载子节点时合并进现有 flatIndex，in-place mutate）
  - TreeNode 结构（fileTreeModel 内部导出）: `{ node: FsNode; children: TreeNode[] }`

- [ ] **Step 1: 写 filePreviewKind 失败测试**

Create `desktop/test/filePreviewKind.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { previewKind, MAX_TEXT_BYTES } from '../src/renderer/lib/filePreviewKind'

describe('previewKind 扩展名识别', () => {
  it('代码类扩展名', () => {
    expect(previewKind('Foo.java')).toBe('code')
    expect(previewKind('bar.ts')).toBe('code')
    expect(previewKind('ui.tsx')).toBe('code')
    expect(previewKind('app.py')).toBe('code')
    expect(previewKind('go.mod')).toBe('code')
    expect(previewKind('Cargo.toml')).toBe('code')
    expect(previewKind('db.sql')).toBe('code')
  })
  it('大小写不敏感', () => {
    expect(previewKind('PHOTO.JPG')).toBe('image')
    expect(previewKind('ReadMe.MD')).toBe('markdown')
  })
  it('Markdown 类', () => {
    expect(previewKind('README.md')).toBe('markdown')
    expect(previewKind('notes.markdown')).toBe('markdown')
  })
  it('图片类', () => {
    expect(previewKind('a.png')).toBe('image')
    expect(previewKind('a.jpeg')).toBe('image')
    expect(previewKind('a.gif')).toBe('image')
    expect(previewKind('a.svg')).toBe('image')
    expect(previewKind('a.webp')).toBe('image')
  })
  it('PDF', () => {
    expect(previewKind('report.pdf')).toBe('pdf')
  })
  it('未知扩展名一律 binary', () => {
    expect(previewKind('archive.zip')).toBe('binary')
    expect(previewKind('app.exe')).toBe('binary')
    expect(previewKind('data')).toBe('binary')   // 无扩展名
  })
  it('MAX_TEXT_BYTES = 1.5MB', () => {
    expect(MAX_TEXT_BYTES).toBe(1024 * 1024 * 1.5)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd desktop && npm test -- filePreviewKind`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写 filePreviewKind 最小实现**

Create `desktop/src/renderer/lib/filePreviewKind.ts`:
```ts
import type { PreviewKind } from '../../shared/types'

/** 文本文件预览单请求字节上限 (1.5 MB) */
export const MAX_TEXT_BYTES = 1_572_864

const CODE_EXTS = new Set([
  'java','ts','tsx','js','jsx','mjs','cjs','py','go','rs','json','yaml','yml','toml','xml',
  'sh','bash','zsh','ps1','psm1','bat','cmd','css','scss','less','html','htm','sql','kt',
  'kts','scala','rb','php','mdx','c','h','cpp','cc','hpp','cs','r','lua','pl','swift',
  'dart','rust','mod','gradle','properties','ini','conf','env','dockerfile','makefile',
  'ipynb','svelte','vue','graphql','gql','proto','avsc','tf','tfvars','nix','ex','exs',
])

const MD_EXTS = new Set(['md', 'markdown'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'])
const PDF_EXTS = new Set(['pdf'])

/** 依据文件扩展名返回预览类型;永远不抛,默认返回 'binary'。 */
export function previewKind(filePath: string): PreviewKind {
  const basename = filePath.split(/[\\/]/).pop() ?? filePath
  const idx = basename.lastIndexOf('.')
  const ext = idx === -1 ? '' : basename.slice(idx + 1).toLowerCase()
  if (ext === '') return 'binary'
  if (CODE_EXTS.has(ext)) return 'code'
  if (MD_EXTS.has(ext)) return 'markdown'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (PDF_EXTS.has(ext)) return 'pdf'
  return 'binary'
}
```

- [ ] **Step 4: 跑测试确认通过**
Run: `cd desktop && npm test -- filePreviewKind`
Expected: 全 PASS

- [ ] **Step 5: 追加 types.ts 接口**

Open `desktop/src/shared/types.ts`，在文件最末尾（`CloseExecutePayload` 之后，若无则 append），加：
```ts
// ---------------------------------------------------------------------------
// 工作区文件树 & 预览 (file explorer)
// ---------------------------------------------------------------------------

/** 文件树 flat 节点 (IPC 返回的单条记录)。path/parentPath 都已经过 path.resolve 归一。 */
export interface FsNode {
  path: string
  /** 根节点 (workspace 自身) 的 parentPath 为 ''。 */
  parentPath: string
  name: string
  kind: 'dir' | 'file' | 'symlink'
  /** 文件字节数;目录始终 undefined (避免前后端对 0 / undefined 语义分歧)。 */
  size?: number
  /** 修改时间 epoch ms。读取失败时 undefined。 */
  mtime?: number
}

/** `fs.tree` 返回值: flat 节点数组 + 是否被截断(提示用户单独展开深层目录)。 */
export interface FsTreeResult {
  nodes: FsNode[]
  truncated: boolean
}

/** 文件预览分发类别: 决定 FilePreviewPanel 的渲染分支。 */
export type PreviewKind = 'code' | 'markdown' | 'image' | 'pdf' | 'binary'
```

- [ ] **Step 6: 写 fileTreeModel 失败测试**

Create `desktop/test/fileTreeModel.test.ts`:
```ts
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
```

- [ ] **Step 7: 跑测试确认失败**
Run: `cd desktop && npm test -- fileTreeModel`
Expected: FAIL（模块不存在）

- [ ] **Step 8: 写 fileTreeModel 最小实现**

Create `desktop/src/renderer/lib/fileTreeModel.ts`:
```ts
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
  const flatIndex = new Map<string, FsNode>()
  for (const n of nodes) flatIndex.set(n.path, n)

  const byParent = new Map<string, TreeNode[]>()
  const all = new Map<string, TreeNode>()
  for (const n of nodes) {
    const tn: TreeNode = { node: n, children: [] }
    all.set(n.path, tn)
    const key = n.parentPath || ''
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(tn)
  }
  // 挂载 children:先按 parent 拼
  for (const [parentPath, kids] of byParent) {
    if (parentPath === '') continue   // root 的 kids 最后处理
    const p = all.get(parentPath)
    if (p) p.children.push(...kids)
    else {
      // 父节点丢失(常见于截断返回),容错挂到 root 的 parent='' 桶
      const rootBucket = byParent.get('') ?? []
      rootBucket.push(...kids)
      byParent.set('', rootBucket)
    }
  }
  const rootNode = all.get(rootPath) ?? {
    node: { path: rootPath, parentPath: '', name: rootPath.split(/[\\/]/).pop() || rootPath, kind: 'dir' as const },
    children: [],
  }
  const rootChildren = byParent.get('') ?? []
  rootNode.children.push(...rootChildren.filter(c => c.node.path !== rootNode.node.path))
  // sort:目录先于文件,同类按名字不区分大小写
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
  for (const n of newNodes) {
    // 即便已存在也覆写(保证 mtime 刷新)
    flatIndex.set(n.path, n)
  }
}
```

- [ ] **Step 9: 跑测试确认通过**
Run: `cd desktop && npm test -- fileTreeModel`
Expected: 全 PASS

- [ ] **Step 10: 跑类型检查**
Run: `cd desktop && npm run typecheck`
Expected: 0 errors

- [ ] **Step 11: 提交**
```bash
cd d:\wraith
git add desktop/src/shared/types.ts desktop/src/renderer/lib/filePreviewKind.ts desktop/src/renderer/lib/fileTreeModel.ts desktop/test/filePreviewKind.test.ts desktop/test/fileTreeModel.test.ts
git commit -m "feat(desktop): file explorer — types + pure helper libs (preview kind + tree model)"
```

---

### Task 2: 主进程 fileExplorer.ts (路径守卫 + 目录枚举 + 文本读取)

**Files:**
- Create: `desktop/src/main/fileExplorer.ts`
- Test: `desktop/test/fileExplorerGuard.test.ts`（只测 withinWorkspace 纯逻辑，不调真实 fs）

**Interfaces:**
- Consumes: types 中的 `FsNode / FsTreeResult`（通过 preload/types 虽然是 renderer 的 shared，但 main 也能 `import from '../shared/types'`）
- Produces:
  - `withinWorkspace(absPath: string, getRoot: () => string): string`——返回规范化后的真实路径；逃逸 throw Error
  - `listTree(rootPath: string, getRoot: () => string, opts?: { maxDepth?: number }): Promise<FsTreeResult>`
  - `readText(absPath: string, getRoot: () => string, maxBytes?: number): Promise<{ content: string; truncated: boolean; size: number }>`
  - `statFile(absPath: string, getRoot: () => string): Promise<FsNode>`
  - `revealInFolder(absPath: string, getRoot: () => string): Promise<void>` → `shell.showItemInFolder`
  - `openWithDefault(absPath: string, getRoot: () => string): Promise<void>` → `shell.openPath`，非空错误串 throw new Error(err)
  - 常量：`IGNORED_DIR_NAMES`、`IGNORED_FILE_NAMES`、`MAX_TREE_NODES = 500`、`MAX_TREE_BYTES = 524_288`（512KB）

- [ ] **Step 1: 写 withinWorkspace 纯逻辑测试**

Create `desktop/test/fileExplorerGuard.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
// withinWorkspace 会被 fileExplorer.ts 导出;我们只测纯逻辑,所以直接 import named
import { withinWorkspace } from '../src/main/fileExplorer'

/** path.sep 的跨平台结果通过动态 import node:path。 */
import path from 'node:path'

const ROOT_WIN = 'd:\\wraith'
const getWin = () => ROOT_WIN
const ROOT_POSIX = '/home/user/project'
const getPosix = () => ROOT_POSIX

describe('withinWorkspace 路径守卫', () => {
  // Windows 系列
  if (path.sep === '\\') {
    it('正常工作区内文件放行并 normalize', () => {
      expect(withinWorkspace('d:\\wraith\\src\\Foo.java', getWin)).toBe('d:\\wraith\\src\\Foo.java')
      expect(withinWorkspace('d:\\wraith\\src\\.\\Foo.java', getWin)).toBe('d:\\wraith\\src\\Foo.java')
    })
    it('.. 逃逸被拒', () => {
      expect(() => withinWorkspace('d:\\wraith\\..\\other\\x.txt', getWin)).toThrow(/工作区/)
    })
    it('工作区外路径直接拒', () => {
      expect(() => withinWorkspace('d:\\other\\secret.txt', getWin)).toThrow(/工作区/)
    })
    it('root 自身也允许', () => {
      expect(withinWorkspace(ROOT_WIN, getWin)).toBe(ROOT_WIN)
    })
    it('相对路径不允许', () => {
      expect(() => withinWorkspace('src\\Foo.java', getWin)).toThrow(/绝对路径/)
    })
  }

  // POSIX 系列(Windows 上也跑——函数不依赖真实 fs,只依赖 path.normalize 行为)
  it('POSIX 正常路径', () => {
    expect(withinWorkspace('/home/user/project/src/a.ts', getPosix)).toBe('/home/user/project/src/a.ts')
  })
  it('POSIX .. 逃逸', () => {
    expect(() => withinWorkspace('/home/user/project/../shadow/x', getPosix)).toThrow(/工作区/)
  })
  it('POSIX 相对路径', () => {
    expect(() => withinWorkspace('src/a.ts', getPosix)).toThrow(/绝对路径/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd desktop && npm test -- fileExplorerGuard`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写 fileExplorer.ts 最小实现（先让 withinWorkspace + 常量 export 满足测试；其他函数留骨架但导出）**

Create `desktop/src/main/fileExplorer.ts`：
```ts
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
 * 路径安全单入口守卫。返回 normalize + realpath 后的绝对路径;违规直接 throw。
 *
 * 规则:
 *   1. 必须是绝对路径 (path.isAbsolute)
 *   2. path.normalize 去掉 /../ /./ 段
 *   3. 规范化后必须 === root 或以 root + sep 开头
 *   4. 若是符号链接: fs.realpath 解析 target,再重复 1-3 校验(防止 symlink 飞出工作区)
 *      解析失败(不存在)时直接按规范化路径做 1-3 即可;不阻塞
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
  // BFS:队列每项 { dirPath, depth } depth = 1 表示根的子目录/子文件;maxDepth=2 只展 2 层
  const queue: { dir: string; depth: number }[] = [{ dir: normRoot, depth: 1 }]
  let byteBudget = MAX_TREE_BYTES - 256  // 留 256 给 JSON envelope
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
    const toRead = Math.min(Number(stat.size), maxBytes + 1)  // +1 用于检测截断
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
      } catch { /* 退化保留 UTF-8 结果即可,不会抛 */ }
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
```

- [ ] **Step 4: 跑 withinWorkspace 测试通过**
Run: `cd desktop && npm test -- fileExplorerGuard`
Expected: 全 PASS

- [ ] **Step 5: 类型检查**
Run: `cd desktop && npm run typecheck`
Expected: 0 errors（注意如果 TextDecoder('gbk') 报 type error，用 `// @ts-ignore` 或断言 as any，保持 Node 实际能跑）

- [ ] **Step 6: 提交**
```bash
git add desktop/src/main/fileExplorer.ts desktop/test/fileExplorerGuard.test.ts
git commit -m "feat(desktop): file explorer — main process guard + tree/text/stat/shell APIs"
```

---

### Task 3: IPC 桥接（main handlers + preload 暴露）

**Files:**
- Modify: `desktop/src/main/index.ts`（找 `wraith:documents:*` 五个 handler 的相邻区域，追加五个 `wraith:fs:*`）
- Modify: `desktop/src/preload/index.ts`（在 `documents` 桥的下方追加 `window.wraith.fs`）

**Interfaces:**
- Consumes: Task 2 导出的 `listTree / readText / statFile / revealInFolder / openWithDefault` 函数 + `withinWorkspace` 守卫
- Produces: renderer 可直接调用 `window.wraith.fs.tree(root, opts)`、`readText(p, max?)`、`stat(p)`、`reveal(p)`、`openExternal(p)`

- [ ] **Step 1: 看现有 documents handler 的模式**

打开 `desktop/src/main/index.ts` 搜索 `wraith:documents:list`（约 1580 行附近），记下它用 `docsDir()` 动态获取路径的闭包模式。我们参照它写 `getWsRoot()` 闭包：

- [ ] **Step 2: 在 main/index.ts 追加 5 个 wraith:fs:* handler**

找 `ipcMain.handle('wraith:documents:reveal' ...)` 之后的一行（约 line 1615），插入：

```ts
// ---- wraith:fs:* 工作区文件树 + 只读预览 (全链路 withinWorkspace 守卫) ----
// workspace 路径必须动态读:用户可以在运行中切换项目
const getWorkspaceRoot = (): string => {
  // settings.ts 里 workspace 的持久化字段:参照 settings.ts 的 workspace key
  // 如果 settings.ts export 了读取器直接用;否则退而求其次:
  //   从 App state 经由 backend RPC 同步到 main 的状态来源
  // -- 本项目中,App 启动后会把 workspace 通过 app-server session 同步到 backend.ts;
  //    backend.ts 有 state.workspace 的来源。main 侧统一从 settingsStore 读当前 workspace:
  return settings.getSync().workspace ?? (process.cwd())
  // 注:如果 settings schema 没有 workspace 字段,改从 backend.getState().workspace 读取;
  //    实际集成时按现有 settings/backend 真实接口调整,原则是必须动态读,不可启动时固化
}
import * as fileX from './fileExplorer'

ipcMain.handle('wraith:fs:tree', async (_e, rootPath: string, opts?: { maxDepth?: number }) => {
  return fileX.listTree(rootPath, getWorkspaceRoot, opts)
})
ipcMain.handle('wraith:fs:readText', async (_e, absPath: string, maxBytes?: number) => {
  return fileX.readText(absPath, getWorkspaceRoot, maxBytes)
})
ipcMain.handle('wraith:fs:stat', async (_e, absPath: string) => {
  return fileX.statFile(absPath, getWorkspaceRoot)
})
ipcMain.handle('wraith:fs:reveal', async (_e, absPath: string) => {
  return fileX.revealInFolder(absPath, getWorkspaceRoot)
})
ipcMain.handle('wraith:fs:openExternal', async (_e, absPath: string) => {
  return fileX.openWithDefault(absPath, getWorkspaceRoot)
})
```

**注意事项**:
- `getWorkspaceRoot` 的实现要对照 `settings.ts` 里真实的字段；如果 settings schema 的确没有 `workspace` 字段，改成：`import * as backend from './backend'` 然后 `backend.currentWorkspace()`（看 backend.ts 暴露什么），原则是**不启动固化一个路径常量**

- [ ] **Step 3: preload/index.ts 追加 window.wraith.fs 类型 + 桥**

打开 `desktop/src/preload/index.ts`，定位 `documents: { ... }` 桥（约 line 822），在其后追加：

```ts
  /** 工作区文件浏览器:只读,所有路径必经 main 侧 withinWorkspace 守卫。入参必须是绝对路径。 */
  fs: {
    tree(rootPath: string, opts?: { maxDepth?: number }) {
      return ipcRenderer.invoke('wraith:fs:tree', rootPath, opts) as ReturnType<typeof import('../main/fileExplorer').listTree>
    },
    readText(absPath: string, maxBytes?: number) {
      return ipcRenderer.invoke('wraith:fs:readText', absPath, maxBytes) as ReturnType<typeof import('../main/fileExplorer').readText>
    },
    stat(absPath: string) {
      return ipcRenderer.invoke('wraith:fs:stat', absPath) as Promise<import('../shared/types').FsNode>
    },
    reveal(absPath: string) {
      return ipcRenderer.invoke('wraith:fs:reveal', absPath) as Promise<void>
    },
    openExternal(absPath: string) {
      return ipcRenderer.invoke('wraith:fs:openExternal', absPath) as Promise<void>
    },
  },
```

然后找到类型声明区（preload/index.ts 顶部的 `WraithAPI` 接口里），在 `documents` 类型下方追加同名：
```ts
  fs: {
    tree(rootPath: string, opts?: { maxDepth?: number }): Promise<import('../shared/types').FsTreeResult>
    readText(absPath: string, maxBytes?: number): Promise<{ content: string; truncated: boolean; size: number }>
    stat(absPath: string): Promise<import('../shared/types').FsNode>
    reveal(absPath: string): Promise<void>
    openExternal(absPath: string): Promise<void>
  }
```

- [ ] **Step 4: 类型检查**
Run: `cd desktop && npm run typecheck`
Expected: 0 errors（重点：preload 的接口声明和 renderer 侧 shared/types 类型对得上）

- [ ] **Step 5: 提交**
```bash
git add desktop/src/main/index.ts desktop/src/preload/index.ts
git commit -m "feat(desktop): file explorer — wire wraith:fs:* IPC on main + preload bridge"
```

---

### Task 4: 安装 highlight.js 依赖 + tokens.css 追加样式片段

**Files:**
- Modify: `desktop/package.json`（dependencies 加 `"highlight.js": "^11.10.0"`）
- Modify: `desktop/src/renderer/styles/tokens.css`（末尾追加 3 个片段：`.ft-row-selected` / `.wb-tab-bar` / `.preview-ln`）

**Interfaces:**
- Consumes: 无
- Produces: renderer 侧可 `import hljs from 'highlight.js'` + 三个 CSS class 可直接用

- [ ] **Step 1: 写 tokens.css 的 style 片段（无需测试，肉眼验）**

在 `desktop/src/renderer/styles/tokens.css` 末尾 append：
```css
/* =========================================================
 * File Explorer (workspace) visual tokens
 * 与现有 tokens.css 的变量语义保持一致。
 * ========================================================= */

/* --- FileTreePanel:选中行 --- */
.ft-row-selected {
  position: relative;
  background: rgb(var(--brand-rgb, 139 92 246) / 0.14);
  color: rgb(var(--fg-rgb));
}
.ft-row-selected::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: rgb(var(--brand-rgb, 139 92 246));
}

/* --- WorkbenchTabBar:活跃 tab 下划线 --- */
.wb-tab-active {
  border-bottom-width: 2px;
  border-bottom-style: solid;
  border-bottom-color: rgb(var(--brand-rgb, 139 92 246));
}
.wb-tab-close:hover {
  background: rgb(var(--fg-rgb) / 0.06);
  color: rgb(var(--fg-rgb));
}

/* --- FilePreviewPanel:行号 + 代码行 hover --- */
.preview-line {
  display: block;
  padding: 0 16px 0 0;
}
.preview-line:hover {
  background: rgb(var(--fg-rgb) / 0.03);
}
.preview-ln {
  display: inline-block;
  width: 40px;
  margin-right: 16px;
  text-align: right;
  color: rgb(var(--fg-subtle-rgb));
  user-select: none;
  -webkit-user-select: none;
}
.preview-code {
  font-family: "SF Mono", Consolas, Menlo, "Cascadia Mono", "Liberation Mono", monospace;
  font-size: 12.5px;
  line-height: 1.65;
  white-space: pre;
  overflow-x: auto;
}

/* highlight.js 主题和 tokens 的 fg/bg 对齐 (atom-one-dark 的轻量适配) */
.hljs {
  background: transparent;
  color: rgb(var(--fg-rgb));
}
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-section, .hljs-link { color: #c586c0; }
.hljs-string, .hljs-title, .hljs-name, .hljs-type, .hljs-attribute, .hljs-symbol, .hljs-bullet, .hljs-addition, .hljs-template-tag, .hljs-template-variable { color: #ce9178; }
.hljs-comment, .hljs-quote, .hljs-deletion, .hljs-meta { color: #6a9955; font-style: italic; }
.hljs-number, .hljs-regexp, .hljs-built_in, .hljs-builtin-name { color: #b5cea8; }
.hljs-function .hljs-title, .hljs-title.function_ { color: #dcdcaa; }
.hljs-class .hljs-title, .hljs-title.class_, .hljs-title.class_.inherited__ { color: #4ec9b0; }
.hljs-variable, .hljs-attr { color: #9cdcfe; }
.hljs-tag, .hljs-name { color: #569cd6; }
```

- [ ] **Step 2: 安装 highlight.js**
```bash
cd desktop && npm install --save-exact highlight.js@11.10.0
```
Verify：package.json 出现 `"highlight.js": "11.10.0"` 精确版本号（无 ^）

- [ ] **Step 3: 类型检查 & 测试跑通（无回归）**
Run:
```bash
cd desktop && npm run typecheck
cd desktop && npm test
```
Expected: 0 errors / 全 PASS

- [ ] **Step 4: 提交（必须提交 package-lock.json 的变更）**
```bash
git add desktop/package.json desktop/package-lock.json desktop/src/renderer/styles/tokens.css
git commit -m "feat(desktop): file explorer — add highlight.js and visual tokens CSS"
```

---

### Task 5: WorkbenchTabBar 组件

**Files:**
- Create: `desktop/src/renderer/components/WorkbenchTabBar.tsx`
- Test: `desktop/test/workbenchTabBar.test.tsx`

**Interfaces:**
- Consumes: `PreviewKind`（shared/types），图标走 lucide-react（已装 1.24）
- Produces: `<WorkbenchTabBar tabs activeId onActivate onClose />`，不变量：`tabs[0].id === 'chat'` 时不渲染 close

- [ ] **Step 1: 写不变量 + 渲染测试（RED）**

Create `desktop/test/workbenchTabBar.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WorkbenchTabBar from '../src/renderer/components/WorkbenchTabBar'
import type { PreviewKind } from '../src/shared/types'

type Tab =
  | { id: 'chat'; title: string }
  | { id: `file:${string}`; title: string; path: string; kind: PreviewKind }

const tabs: Tab[] = [
  { id: 'chat', title: '聊天' },
  { id: 'file:d:\\wraith\\A.java', title: 'A.java', path: 'd:\\wraith\\A.java', kind: 'code' },
  { id: 'file:d:\\wraith\\B.md', title: 'B.md', path: 'd:\\wraith\\B.md', kind: 'markdown' },
]

describe('WorkbenchTabBar', () => {
  it('聊天 tab 在第 0 位,无关闭按钮;其他 tab 有 close', () => {
    render(<WorkbenchTabBar tabs={tabs} activeId="chat" onActivate={()=>{}} onClose={()=>{}} />)
    const chatTab = screen.getByText('聊天')
    expect(chatTab).toBeTruthy()
    // 聊天 tab 附近找不到 close(用 title 找)
    const closeBtns = screen.getAllByTitle(/关闭/)
    // 2 个文件 tab → 2 个 close 按钮
    expect(closeBtns).toHaveLength(2)
  })

  it('点击 tab 触发 onActivate(id),忽略 chat close 回调(即使调用)', () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    render(<WorkbenchTabBar tabs={tabs} activeId="chat" onActivate={onActivate} onClose={onClose} />)
    fireEvent.click(screen.getByText('A.java'))
    expect(onActivate).toHaveBeenCalledWith('file:d:\\wraith\\A.java')
    fireEvent.click(screen.getByTitle(/关闭.*A\.java/) ?? screen.getAllByTitle(/关闭/)[0])
    expect(onClose).toHaveBeenCalledWith('file:d:\\wraith\\A.java')
  })

  it('active tab 渲染 wb-tab-active class(视觉契约)', () => {
    const { container } = render(<WorkbenchTabBar tabs={tabs} activeId="file:d:\\wraith\\A.java" onActivate={()=>{}} onClose={()=>{}} />)
    const active = container.querySelector('.wb-tab-active')
    expect(active?.textContent).toContain('A.java')
  })
})
```

- [ ] **Step 2: 跑测试失败**
Run: `cd desktop && npm test -- workbenchTabBar`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 WorkbenchTabBar**

Create `desktop/src/renderer/components/WorkbenchTabBar.tsx`:
```tsx
import { MessageSquare, FileText, FileSpreadsheet, FileImage, FileType, File as FileIcon, X } from 'lucide-react'
import type { PreviewKind } from '../../shared/types'
import { previewKind } from '../lib/filePreviewKind'

export type WorkbenchTab =
  | { id: 'chat'; title: string }
  | { id: `file:${string}`; title: string; path: string; kind: PreviewKind }

interface Props {
  tabs: WorkbenchTab[]
  activeId: string
  onActivate: (id: WorkbenchTab['id']) => void
  onClose: (fileTabId: Extract<WorkbenchTab['id'], `file:${string}`>) => void
}

const ICON_FOR_KIND: Record<PreviewKind, typeof FileText> = {
  code: FileText,
  markdown: FileText,
  image: FileImage,
  pdf: FileType,
  binary: FileIcon,
}
void FileSpreadsheet   // 保留扩展位,避免 tree-shaker 清掉(未来用于 excel 预览 icon)

export default function WorkbenchTabBar({ tabs, activeId, onActivate, onClose }: Props): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="工作区 Tab"
      className="flex flex-nowrap items-stretch gap-0 overflow-x-auto border-b border-border bg-bg-muted px-1"
      style={{ scrollbarWidth: 'none' }}
    >
      {tabs.map((t) => {
        const active = t.id === activeId
        const isChat = t.id === 'chat'
        const Icon = isChat ? MessageSquare : ICON_FOR_KIND[(t as Extract<WorkbenchTab, { kind: PreviewKind }>).kind]
        const fileId = isChat ? null : (t.id as Extract<WorkbenchTab['id'], `file:${string}`>)
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            title={isChat ? '聊天' : (t as Extract<WorkbenchTab, { path: string }>).path}
            onClick={() => onActivate(t.id)}
            className={
              'group relative flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition-colors ' +
              (active
                ? 'wb-tab-active text-fg bg-bg'
                : 'border-transparent text-fg-muted hover:bg-surface hover:text-fg')
            }
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.5} aria-hidden />
            <span className="max-w-[160px] truncate">{t.title}</span>
            {!isChat && fileId && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`关闭 ${t.title}`}
                title={`关闭 ${t.title}`}
                onClick={(e) => { e.stopPropagation(); onClose(fileId) }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClose(fileId) } }}
                className="wb-tab-close ml-1 inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded text-fg-subtle opacity-70 hover:opacity-100"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// 附带:基于 absPath 构造 WorkbenchTab 的纯工厂 (App.tsx 使用)
export function makeFileTab(absPath: string): Extract<WorkbenchTab, { id: `file:${string}` }> {
  const name = absPath.split(/[\\/]/).pop() ?? absPath
  const kind = previewKind(absPath)
  const id = `file:${absPath}` as const
  // @ts-ignore - TS 对模板字面量 id 的推断有时打结;运行时保证前缀正确
  return { id, title: name, path: absPath, kind }
}
```

- [ ] **Step 4: 跑测试通过**
Run: `cd desktop && npm test -- workbenchTabBar`
Expected: 全 PASS（若第二个测试中 getByTitle 的定位比较 fragile，换成 `getAllByTitle('关闭')[0]` 即可）

- [ ] **Step 5: 类型检查**
Run: `cd desktop && npm run typecheck`

- [ ] **Step 6: 提交**
```bash
git add desktop/src/renderer/components/WorkbenchTabBar.tsx desktop/test/workbenchTabBar.test.tsx
git commit -m "feat(desktop): file explorer — WorkbenchTabBar with chat-immutable invariant"
```

---

### Task 6: FileTreePanel 组件

**Files:**
- Create: `desktop/src/renderer/components/FileTreePanel.tsx`
- Test: `desktop/test/fileTreePanelRender.test.tsx`（只测渲染和展开折叠的 JS 状态流，不测真 IPC）

**Interfaces:**
- Consumes: `window.wraith.fs.tree`，`buildTreeFromFlat / insertSubtree`（Task 1），`makeFileTab`（Task 5）
- Produces: `<FileTreePanel workspace width onWidthChange onHide onOpenFile />` props 组件
  - props:
    - `workspace: string` — 当前项目根路径
    - `width: number` — 当前像素宽（父组件持久化后传）
    - `onWidthChange(w: number): void` — 拖拽右缘触发
    - `onHide(): void` — 点击右上角 ⇤
    - `onRefreshRequest?(): void` — 刷新按钮点击（父组件可决定是否触发树重载；默认内部也重载）
    - `onOpenFile(absPath: string): void` — 单击文件触发；App 侧用这个调用 `openFileTab`

- [ ] **Step 1: 写轻量渲染测试（RED）**

Create `desktop/test/fileTreePanelRender.test.tsx`：
```tsx
/** 只测 TreeNode 渲染:用一个假的 buildTreeFromFlat 的结果直接 feed 组件。由于真实组件默认会自己调 fs.tree,
 *  我们在组件内部设计一个可选 devOnly prop initialTree 让测试可以跳过真实 IPC,否则不对外暴露。 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import FileTreePanel from '../src/renderer/components/FileTreePanel'

describe('FileTreePanel UI contract', () => {
  it('渲染 header 三个 icon 按钮 + 根名,点击 hide 触发 onHide', () => {
    const onHide = vi.fn()
    render(
      <FileTreePanel
        workspace="d:\\wraith"
        width={260}
        onWidthChange={() => {}}
        onHide={onHide}
        onOpenFile={() => {}}
        devOnly={{ skipInitialLoad: true, showNodes: [] }}
      />
    )
    expect(screen.getByText(/wraith/)).toBeTruthy()
    // 找 title 包含 "隐藏" 的按钮 (⇤)
    const hideBtn = screen.getByTitle(/隐藏文件树/) as HTMLButtonElement
    fireEvent.click(hideBtn)
    expect(onHide).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 跑测试失败（模块不存在）**
Run: `cd desktop && npm test -- fileTreePanelRender`
Expected: FAIL

- [ ] **Step 3: 实现 FileTreePanel**

Create `desktop/src/renderer/components/FileTreePanel.tsx`:
```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, RefreshCw, ChevronLeft, FolderClosed, FolderOpen, File as FileIcon } from 'lucide-react'
import type { FsNode } from '../../shared/types'
import { buildTreeFromFlat, insertSubtree, type TreeNode } from '../lib/fileTreeModel'
import { ipcErrorText } from '../lib/ipcError'

interface Props {
  workspace: string
  width: number
  onWidthChange: (w: number) => void
  onHide: () => void
  onOpenFile: (absPath: string) => void
  onRefreshRequest?: () => void
  /** 仅测试注入用,生产不传。 */
  devOnly?: { skipInitialLoad?: boolean; showNodes?: FsNode[] }
}

/** 根据 previewKind 对应 icon?文件树这里只分 dir/file,简化;预览 kind 的图标交给 TabBar 展示。 */
function rowIcon(node: TreeNode, expanded: boolean): JSX.Element {
  if (node.node.kind === 'dir') {
    const I = expanded ? FolderOpen : FolderClosed
    return <I className="h-3.5 w-3.5 shrink-0 text-yellow-500/80" strokeWidth={1.5} />
  }
  return <FileIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.5} />
}

const MIN_W = 180
const MAX_W = 480

export default function FileTreePanel({ workspace, width, onWidthChange, onHide, onOpenFile, onRefreshRequest, devOnly }: Props): JSX.Element {
  const [nodes, setNodes] = useState<FsNode[]>(devOnly?.showNodes ?? [])
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([workspace]))
  const [selected, setSelected] = useState<string | null>(null)
  const [loadingDir, setLoadingDir] = useState<Set<string>>(new Set())

  const loadRoot = useCallback(async (): Promise<void> => {
    if (devOnly?.skipInitialLoad) return
    setBusy(true); setError(null)
    try {
      const r = await window.wraith.fs.tree(workspace, { maxDepth: 2 })
      setNodes(r.nodes)
      setTruncated(r.truncated)
    } catch (err) { setError(ipcErrorText(err, '读取工作区文件列表失败')) }
    finally { setBusy(false) }
  }, [workspace, devOnly])

  useEffect(() => { void loadRoot() }, [loadRoot])

  const { root, flatIndex } = useMemo(
    () => buildTreeFromFlat(nodes, workspace),
    [nodes, workspace]
  )

  const toggleExpand = useCallback(async (dirPath: string, hasChildren: boolean): Promise<void> => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath); else next.add(dirPath)
      return next
    })
    // 如果目录没 children,说明首屏截断未加载,单独拉一层
    if (!hasChildren && !loadingDir.has(dirPath)) {
      setLoadingDir(prev => new Set(prev).add(dirPath))
      try {
        const r = await window.wraith.fs.tree(dirPath, { maxDepth: 1 })
        setNodes(prev => {
          const nextMap = new Map<string, FsNode>()
          prev.forEach(n => nextMap.set(n.path, n))
          insertSubtree(nextMap, dirPath, r.nodes)
          return Array.from(nextMap.values())
        })
      } catch { /* 忽略,用户点刷新再试 */ }
      finally { setLoadingDir(prev => { const n = new Set(prev); n.delete(dirPath); return n }) }
    }
  }, [loadingDir])

  const onRowClick = useCallback((tn: TreeNode): void => {
    setSelected(tn.node.path)
    if (tn.node.kind === 'dir') {
      void toggleExpand(tn.node.path, tn.children.length > 0)
    } else {
      onOpenFile(tn.node.path)
    }
  }, [onOpenFile, toggleExpand])

  // ---- 宽度拖拽:右缘 3px 条 ----
  const dragging = useRef<{ startX: number; startW: number } | null>(null)
  const onDragMouseDown = useCallback((e: React.MouseEvent): void => {
    e.preventDefault()
    dragging.current = { startX: e.clientX, startW: width }
    const onMove = (ev: MouseEvent): void => {
      if (!dragging.current) return
      let w = dragging.current.startW + (ev.clientX - dragging.current.startX)
      if (w < MIN_W) { onHide(); return }   // 拉到太小直接隐藏
      if (w > MAX_W) w = MAX_W
      onWidthChange(Math.round(w))
    }
    const onUp = (): void => {
      dragging.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [width, onWidthChange, onHide])

  // ---- 递归渲染树 ----
  const renderNode = (tn: TreeNode, depth: number): JSX.Element => {
    const isOpen = expanded.has(tn.node.path)
    const isSel = tn.node.path === selected
    const isDir = tn.node.kind === 'dir'
    return (
      <div key={tn.node.path}>
        <div
          role="treeitem"
          aria-selected={isSel}
          aria-expanded={isDir ? isOpen : undefined}
          onClick={() => onRowClick(tn)}
          className={
            'group flex cursor-pointer items-center gap-1 rounded-md py-1 pr-1 text-xs select-none ' +
            (isSel ? 'ft-row-selected ' : 'hover:bg-fg/5 ')
          }
          style={{ paddingLeft: 4 + depth * 14 }}
          title={tn.node.path}
        >
          {/* caret */}
          <span className="inline-flex w-3.5 shrink-0 items-center justify-center text-fg-subtle" aria-hidden>
            {isDir ? (
              <ChevronRight className={'h-3 w-3 transition-transform ' + (isOpen ? 'rotate-90' : '')} strokeWidth={2} />
            ) : (
              <span className="w-1 h-1 rounded-full bg-fg-subtle/70 inline-block mx-auto" />
            )}
          </span>
          {rowIcon(tn, isOpen)}
          <span className="truncate">{tn.node.name}</span>
          {loadingDir.has(tn.node.path) && <span className="ml-1 text-3xs text-fg-subtle">…</span>}
        </div>
        {isDir && isOpen && (
          <div role="group">
            {tn.children.length === 0 && !loadingDir.has(tn.node.path) ? (
              <div style={{ paddingLeft: 4 + (depth + 1) * 14 }} className="py-1 text-[11px] text-fg-subtle">（空目录）</div>
            ) : tn.children.map(c => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="relative flex min-h-0 flex-col border-r border-border bg-bg"
      style={{ width, flexShrink: 0 }}
      role="tree"
      aria-label="工作区文件树"
    >
      {/* 拖拽 3px 条 */}
      <div
        onMouseDown={onDragMouseDown}
        className="group absolute right-0 top-0 z-20 h-full w-[3px] cursor-col-resize"
        aria-hidden
      >
        <div className="absolute inset-y-0 right-0 w-[3px] transition-colors group-hover:bg-brand/60" />
      </div>
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <FolderOpen className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.5} />
        <span className="truncate text-sm font-semibold text-fg" title={workspace}>
          {workspace.split(/[\\/]/).filter(Boolean).pop() ?? workspace}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            title="刷新"
            disabled={busy || !!devOnly?.skipInitialLoad}
            onClick={() => { onRefreshRequest?.(); void loadRoot() }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-fg/5 hover:text-fg disabled:opacity-50"
          >
            <RefreshCw className={'h-3.5 w-3.5 ' + (busy ? 'animate-spin' : '')} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            title="折叠全部子目录"
            onClick={() => setExpanded(new Set([workspace]))}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-fg/5 hover:text-fg"
          >
            <ChevronRight className="h-3.5 w-3.5 -rotate-90" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            title="隐藏文件树"
            onClick={onHide}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-fg/5 hover:text-fg"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>
      {error && (
        <div className="mx-3 mt-2 rounded-md border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] leading-relaxed text-fg-muted">{error}</div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto py-1 pr-1" style={{ scrollbarGutter: 'stable' }}>
        {root.children.length === 0 && !busy ? (
          <div className="px-3 py-8 text-center text-xs text-fg-subtle">工作区为空</div>
        ) : root.children.map(c => renderNode(c, 0))}
      </div>
      {truncated && (
        <div className="border-t border-border px-3 py-1.5 text-[11px] text-warn bg-warn/5">
          首屏只显示前 500 项；点具体文件夹可单独展开深层目录。
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 跑测试通过**
Run: `cd desktop && npm test -- fileTreePanelRender`
Expected: PASS

- [ ] **Step 5: 类型检查**
Run: `cd desktop && npm run typecheck`

- [ ] **Step 6: 提交**
```bash
git add desktop/src/renderer/components/FileTreePanel.tsx desktop/test/fileTreePanelRender.test.tsx
git commit -m "feat(desktop): file explorer — FileTreePanel (expand/collapse/select + drag-resize)"
```

---

### Task 7: FilePreviewPanel 组件

**Files:**
- Create: `desktop/src/renderer/components/FilePreviewPanel.tsx`
- (无独立测试文件；纯渲染在 Task 10 集成时肉眼验，代码走 hljs / react-markdown，两库都已有社区保障)

**Interfaces:**
- Consumes: `window.wraith.fs.stat + readText + reveal + openExternal`；`react-markdown`（已有 9.0.1 + remark-gfm 4）；`highlight.js`（Task 4 装）
- Produces: `<FilePreviewPanel absPath kind onReference onReveal onOpenExternal />`
  - props:
    - `absPath: string`
    - `kind: PreviewKind`
    - `onReference(relPath: string): void` → 点击「📎 @引用」时调用；父组件把 `'@' + relPath` 追加到输入并切回聊天
    - `onReveal(): void` → 调 `fs.reveal(absPath)`
    - `onOpenExternal(): void` → 调 `fs.openExternal(absPath)`

- [ ] **Step 1: 写组件（视觉验收为主，代码 step 直接实现）**

Create `desktop/src/renderer/components/FilePreviewPanel.tsx`:
```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js'
import { Paperclip, FolderSearch, ExternalLink, AlertTriangle } from 'lucide-react'
import type { PreviewKind, FsNode } from '../../shared/types'
import { MAX_TEXT_BYTES } from '../lib/filePreviewKind'
import { ipcErrorText } from '../lib/ipcError'
import { relativeTime } from '../lib/snapshotView'   // 复用 snapshot 的相对时间格式,签名一致

interface Props {
  absPath: string
  kind: PreviewKind
  workspace: string
  onReference: (relPathPrefixed: string) => void
}

function relativeOfWorkspace(abs: string, ws: string): string {
  const sep = ws.includes('\\') ? '\\' : '/'
  const wsN = ws.endsWith(sep) ? ws : ws + sep
  if (abs.startsWith(wsN)) return abs.slice(wsN.length)
  return abs
}

export default function FilePreviewPanel({ absPath, kind, workspace, onReference }: Props): JSX.Element {
  const [node, setNode] = useState<FsNode | null>(null)
  const [text, setText] = useState<{ content: string; truncated: boolean; size: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadAll = useCallback(async (): Promise<void> => {
    setLoading(true); setError(null); setNode(null); setText(null)
    try {
      const [n, t] = await Promise.all([
        window.wraith.fs.stat(absPath),
        (kind === 'code' || kind === 'markdown') ? window.wraith.fs.readText(absPath, MAX_TEXT_BYTES) : Promise.resolve(null),
      ])
      setNode(n)
      if (t) setText(t)
    } catch (err) { setError(ipcErrorText(err, '读取文件失败')) }
    finally { setLoading(false) }
  }, [absPath, kind])

  useEffect(() => { void loadAll() }, [loadAll])

  const rel = relativeOfWorkspace(absPath, workspace)
  const refArg = '@' + rel.replace(/\\/g, '/')   // mention 语法用正斜杠,跨平台一致

  const doReveal = useCallback(async (): Promise<void> => {
    try { await window.wraith.fs.reveal(absPath) }
    catch (err) { setError(ipcErrorText(err, '定位失败')) }
  }, [absPath])
  const doOpen = useCallback(async (): Promise<void> => {
    try { await window.wraith.fs.openExternal(absPath) }
    catch (err) { setError(ipcErrorText(err, '打开失败')) }
  }, [absPath])

  // 代码高亮(只做 code kind;markdown 的 code block 由 react-markdown 配 hljs 自定义)
  const codeHtml = useMemo(() => {
    if (kind !== 'code' || !text) return null
    const ext = absPath.split(/[\\/]/).pop()!.split('.').pop()?.toLowerCase() ?? 'plaintext'
    const langKnown = hljs.getLanguage(ext)
    const highlighted = langKnown
      ? hljs.highlight(text.content, { language: ext, ignoreIllegals: true }).value
      : hljs.highlightAuto(text.content).value
    const lines = highlighted.split(/\r?\n/)
    return lines
  }, [text, kind, absPath])

  const pathBar = (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
      <code className="min-w-0 flex-1 truncate text-[11px] text-fg-subtle" title={absPath}>
        {rel.length ? rel : absPath}
      </code>
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="作为 @路径引用到输入框"
          onClick={() => onReference(refArg)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg-muted transition-colors hover:bg-fg/5 hover:text-fg"
        >
          <Paperclip className="h-3 w-3" strokeWidth={1.5} />@引用
        </button>
        <button
          type="button"
          title="在文件管理器中显示"
          onClick={() => void doReveal()}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg-muted transition-colors hover:bg-fg/5 hover:text-fg"
        >
          <FolderSearch className="h-3 w-3" strokeWidth={1.5} />显示
        </button>
        <button
          type="button"
          title="用系统默认应用打开"
          onClick={() => void doOpen()}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg-muted transition-colors hover:bg-fg/5 hover:text-fg"
        >
          <ExternalLink className="h-3 w-3" strokeWidth={1.5} />外部打开
        </button>
      </div>
    </div>
  )

  const sizeMeta = (
    node && (
      <div className="px-4 pt-2 text-[11px] text-fg-subtle">
        {typeof node.size === 'number' && <span>{node.size.toLocaleString()} bytes</span>}
        {typeof node.mtime === 'number' && <span className="ml-3">修改于 {relativeTime(node.mtime)}</span>}
        {text?.truncated && (
          <span className="ml-3 inline-flex items-center gap-1 text-warn"><AlertTriangle className="h-3 w-3"/>仅显示前 {(MAX_TEXT_BYTES / 1024 / 1024).toFixed(1)} MB</span>
        )}
      </div>
    )
  )

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {pathBar}
        <div className="mx-4 mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-fg-muted">{error}</div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pathBar}
      {sizeMeta}
      <div className="min-h-0 flex-1 overflow-auto py-3">
        {loading && <div className="px-4 py-6 text-xs text-fg-subtle">加载中…</div>}
        {!loading && kind === 'code' && codeHtml && (
          <pre className="preview-code m-0">
            <code>
              {codeHtml.map((lineHtml, i) => (
                <span key={i} className="preview-line">
                  <span className="preview-ln">{i + 1}</span>
                  <span dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }} />
                </span>
              ))}
            </code>
          </pre>
        )}
        {!loading && kind === 'markdown' && text && (
          <div className="px-4 text-sm text-fg">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ node, inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '')
                  const raw = String(children).replace(/\n$/, '')
                  if (!inline && match) {
                    const out = hljs.getLanguage(match[1])
                      ? hljs.highlight(raw, { language: match[1], ignoreIllegals: true }).value
                      : hljs.highlightAuto(raw).value
                    return <pre className="preview-code"><code dangerouslySetInnerHTML={{ __html: out }} /></pre>
                  }
                  return <code className={className} {...props}>{children}</code>
                },
              }}
            >
              {text.content}
            </ReactMarkdown>
            {text.truncated && <div className="mt-4 text-warn">[… 内容已截断 …]</div>}
          </div>
        )}
        {!loading && kind === 'image' && (
          <div className="flex min-h-[60%] items-center justify-center bg-fg/[0.02] px-4 py-6">
            {/* file:// 协议 + 规范化反斜杠为正 (file:///d:/...) */}
            <img
              src={'file:///' + absPath.replace(/\\/g, '/').replace(/^\/+/, '')}
              alt={absPath}
              style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          </div>
        )}
        {!loading && kind === 'pdf' && (
          <PlaceholderCard absPath={absPath} node={node} reason="PDF 预览需用外部应用打开" onOpen={doOpen} onReveal={doReveal} />
        )}
        {!loading && kind === 'binary' && (
          <PlaceholderCard absPath={absPath} node={node} reason="二进制文件不在应用内预览" onOpen={doOpen} onReveal={doReveal} />
        )}
      </div>
    </div>
  )
}

function PlaceholderCard({ absPath, node, reason, onOpen, onReveal }: {
  absPath: string; node: FsNode | null; reason: string
  onOpen: () => void; onReveal: () => void
}): JSX.Element {
  return (
    <div className="mx-auto mt-8 w-[min(480px,92%)] rounded-xl border border-border bg-surface p-5 text-center">
      <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-fg/5 text-fg-muted">
        <ExternalLink className="h-5 w-5" strokeWidth={1.5} />
      </div>
      <div className="mb-1 text-sm font-semibold text-fg">{absPath.split(/[\\/]/).pop()}</div>
      <div className="mb-3 text-xs text-fg-muted">{reason}</div>
      {node && typeof node.size === 'number' && (
        <div className="mb-4 text-[11px] text-fg-subtle">{node.size.toLocaleString()} bytes</div>
      )}
      <div className="flex justify-center gap-2">
        <button onClick={onReveal} className="rounded-md bg-fg/5 px-3 py-1.5 text-xs text-fg hover:bg-fg/10">在文件夹中显示</button>
        <button onClick={onOpen} className="rounded-md bg-brand/20 px-3 py-1.5 text-xs text-brand hover:bg-brand/30">外部打开</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**
Run: `cd desktop && npm run typecheck`
Expected: 0 errors（如果 `snapshotView.ts` 没有导出 `relativeTime`，看 `documentsView.ts` 里有没有 formatSize 之类；没有的话直接在本文件实现一个小型 `function relTime(ms){ const s = (Date.now()-ms)/1000; ... }` 即可——不 import 别人，避免跨模块耦合）

- [ ] **Step 3: 提交**
```bash
git add desktop/src/renderer/components/FilePreviewPanel.tsx
git commit -m "feat(desktop): file explorer — FilePreviewPanel (code/md/image/pdf/binary + toolbar actions)"
```

---

### Task 8: Sidebar 侧栏入口改造

**Files:**
- Modify: `desktop/src/renderer/components/Sidebar.tsx`（TOOL_GROUPS 资料组 + ToolNav 类型 + props + handlers）
- Test: 直接跑 `desktop/test/sidebarToolGroups.test.tsx`，如果字面量检测失败要补

**Interfaces:**
- Consumes: `FolderTree` from lucide-react（已装，确认 import 可用——在现有 import 里加）
- Produces:
  - 新增 ToolNav literal `'fileExplorer'`
  - Sidebar props 新增 `fileExplorerActive: boolean`（默认 false）
  - 资料组：`fileExplorer` 项（「文件」）+ `documents` 项改 label 为「文档（资料库）」
  - `fileExplorer` 项高亮 class 用 `fileExplorerActive` 判定（不用 activeNav === 'fileExplorer'，因为点「文件」不切 view）
  - 新增 prop `onOpenFileExplorer` 并在 TOOL_GROUPS 的 handlers 里调用

- [ ] **Step 1: 改 Sidebar.tsx 六处**

(1) 在现有的 `FolderOpen, ...` import 里追加 `FolderTree`：
```ts
import {
  Plus, Search, Blocks, Clock, MessageSquare, Plug, BookOpen, Brain, History, Globe, ScanSearch,
  Star, ListTree, List, Pencil, Archive, Settings, Wrench, ChevronDown, ListTodo, Shield, User, FolderOpen,
  FolderTree,   // 新增
  type LucideIcon,
} from 'lucide-react'
```

(2) 扩展 `ToolNav` union（约 line 148）：
```ts
type ToolNav = 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills'
  | 'memory' | 'snapshots' | 'policy' | 'browser' | 'rag' | 'tasks' | 'documents'
  | 'fileExplorer'   // 新增
```

(3) 改 TOOL_GROUPS「资料」组（约 line 192）：
```ts
  {
    label: '资料',
    items: [
      // 新增
      { nav: 'fileExplorer', testId: 'nav-file-explorer', label: '文件', Icon: FolderTree },
      // 原 documents label 改,Icon 保留
      { nav: 'documents',    testId: 'nav-documents',    label: '文档（资料库）', Icon: FolderOpen },
    ],
  },
```

(4) 在 `SidebarProps` 末尾（`onOpenSearch` 之前）加两个 prop：
```ts
  /** 「资料→文件」行是否高亮(由 App 根据 fileTreeVisible 传,因为它不代表 view 切换) */
  fileExplorerActive?: boolean
  /** 点「资料→文件」行的回调（toggle 文件树显示）。点它不切 view。 */
  onOpenFileExplorer: () => void
  /** 打开命令面板(搜索)。 */
  onOpenSearch: () => void
```

(5) 在 `default function Sidebar({ ... })` 参数列表里对应接收（解构接收 `fileExplorerActive = false` + `onOpenFileExplorer`）

(6) 在 `handlers` 表中加一项：
```ts
  const handlers: Record<ToolNav, () => void> = {
    // ... 原有 12 项不变
    documents: onOpenDocuments,
    fileExplorer: onOpenFileExplorer,  // 新增
  }
```

(7) **高亮 class 判定**：渲染 tool 按钮时，`fileExplorer` 行的 active 判定不能走 `activeNav === item.nav`，改为：
```tsx
  const isActiveNav = (nav: ToolNav): boolean => {
    if (nav === 'fileExplorer') return !!fileExplorerActive
    return activeNav === nav
  }
```
然后在 `className` 计算处把 `activeNav === item.nav` 替换成 `isActiveNav(item.nav)`（两处：class 中 + 渲染前的判断）。

- [ ] **Step 2: 运行现有 sidebar 相关测试**
```bash
cd desktop && npm test -- sidebar
```
重点：`sidebarToolGroups.test.tsx` 按字面量比对 TOOL_GROUPS，如果因此变红，**更新 test case 里的期望列表**（把 `fileExplorer` 新项 + 「文档（资料库）」label 改进期望），**不要删或弱化测试**。

- [ ] **Step 3: 类型检查**
```bash
cd desktop && npm run typecheck
```

- [ ] **Step 4: 提交**
```bash
git add desktop/src/renderer/components/Sidebar.tsx desktop/test/sidebarToolGroups.test.tsx
git commit -m "feat(desktop): file explorer — sidebar adds '文件' entry under 资料 group;资料库里的文档重命名"
```

---

### Task 9: App.tsx 主布局组装（核心，最后才做）

**Files:**
- Modify: `desktop/src/renderer/App.tsx`（改 view === 'chat' 分支的 JSX 渲染 + 新增 4 个 state + 5 个回调 + 给 Sidebar 传 fileExplorerActive/onOpenFileExplorer + 给 Composer 暴露 appendToInput 通路）
- Test: 不跑新测试，跑现有全套 vitest 做回归

**Interfaces:**
- Consumes: Task 5（`WorkbenchTabBar` + `WorkbenchTab` 类型 + `makeFileTab`）、Task 6（`FileTreePanel`）、Task 7（`FilePreviewPanel`）
- Produces: 最终三栏布局；所有状态集中在 App 管理；输入框 append 可用

- [ ] **Step 1: 引入 import**
在 App.tsx 的 import 段追加：
```ts
import FileTreePanel from './components/FileTreePanel'
import WorkbenchTabBar, { makeFileTab, type WorkbenchTab } from './components/WorkbenchTabBar'
import FilePreviewPanel from './components/FilePreviewPanel'
```

- [ ] **Step 2: 新增 4 个 useState（放在 view state 附近）**
```ts
  /** 文件树显示 */
  const [fileTreeVisible, setFileTreeVisible] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('wraith.workspace.fileTreeVisible')
      return v === null ? true : v === '1'
    } catch { return true }
  })
  /** 文件树宽度(像素) */
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    try {
      const n = parseInt(localStorage.getItem('wraith.workspace.treeWidth') || '', 10)
      return isFinite(n) && n >= 180 && n <= 480 ? n : 260
    } catch { return 260 }
  })
  /** 工作区 Tab。tabs[0] 恒存聊天 Tab(见 Tab 不变量 §6.2) */
  const [workbenchTabs, setWorkbenchTabs] = useState<WorkbenchTab[]>([{ id: 'chat', title: '聊天' }])
  const [activeTabId, setActiveTabId] = useState<string>('chat')
```

- [ ] **Step 3: 持久化 side effects（两个 useEffect）**
```ts
  // 持久化文件树显示状态
  useEffect(() => {
    try { localStorage.setItem('wraith.workspace.fileTreeVisible', fileTreeVisible ? '1' : '0') } catch {}
  }, [fileTreeVisible])
  // 持久化宽度
  useEffect(() => {
    try { localStorage.setItem('wraith.workspace.treeWidth', String(treeWidth)) } catch {}
  }, [treeWidth])
```

- [ ] **Step 4: 写 5 个回调（useCallback）**
```ts
  const toggleFileExplorer = useCallback(() => setFileTreeVisible(v => !v), [])
  const handleTreeWidthChange = useCallback((w: number) => setTreeWidth(w), [])

  const openFileTab = useCallback((absPath: string): void => {
    const tab = makeFileTab(absPath)
    setWorkbenchTabs(prev => {
      if (prev.some(t => t.id === tab.id)) return prev
      return [...prev, tab]
    })
    setActiveTabId(tab.id)
  }, [])

  const closeFileTab = useCallback((id: Extract<WorkbenchTab['id'], `file:${string}`>): void => {
    setWorkbenchTabs(prev => {
      if (!prev.some(t => t.id === id)) return prev
      const next = prev.filter(t => t.id !== id)
      // 不变量保证:next[0] 还是 chat
      return next
    })
    setActiveTabId(prev => (prev === id ? 'chat' : prev))
  }, [])

  const activateTab = useCallback((id: WorkbenchTab['id']): void => {
    setActiveTabId(id)
  }, [])

  /** 把 @path 文本追加到输入框(Composer 的 inputValue),并切回聊天 Tab + focus 输入框 */
  const appendToComposerInput = useCallback((text: string): void => {
    setInputValue(prev => {
      const sep = prev && !/\s$/.test(prev) ? ' ' : ''
      return prev + sep + text
    })
    setActiveTabId('chat')
    // Composer 的 textarea focus:通过现有 focus 机制或 setTimeout 兜底
    setTimeout(() => {
      const ta = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="composer-input"]')
      ta?.focus()
    }, 0)
  }, [])
```
（注：若 Composer 的 input 不是 `<textarea>`，找 Composer.tsx 实际用的 testId selector 做替换。）

- [ ] **Step 5: 给 Sidebar 传两个新 prop**
在 `<Sidebar ... />` JSX 中：
```tsx
  fileExplorerActive={fileTreeVisible && view === 'chat'}
  onOpenFileExplorer={toggleFileExplorer}
```

- [ ] **Step 6: 重构 view === 'chat' 的主渲染**
把 `else { (() => { const composer = ( ...聊天渲染...) })() }` 分支里的整块聊天渲染包裹成一个 `ChatWorkbench` 函数式组件（纯避免缩进层级；不新建文件），然后：

```tsx
) : view === 'settings' ? (
  <SettingsPanel ... />
) : (
  /* view === 'chat' */
  <div className="flex min-h-0 w-full flex-1">
    {/* FileTree(可隐藏) */}
    {fileTreeVisible && (
      <FileTreePanel
        workspace={workspace}
        width={treeWidth}
        onWidthChange={handleTreeWidthChange}
        onHide={() => setFileTreeVisible(false)}
        onOpenFile={openFileTab}
      />
    )}
    {/* Right Column: TabBar + WorkbenchArea */}
    <div className="flex min-w-0 flex-1 flex-col">
      <WorkbenchTabBar
        tabs={workbenchTabs}
        activeId={activeTabId}
        onActivate={activateTab}
        onClose={closeFileTab}
      />
      <div className="min-h-0 flex-1">
        {activeTabId === 'chat' ? (
          // 把原来整块聊天渲染放这里(welcomeEmpty + Transcript + composer/TerminalDrawer...)
          renderChatArea({ ... })
        ) : (
          (() => {
            const tab = workbenchTabs.find(t => t.id === activeTabId)
            if (!tab || tab.id === 'chat') return null
            return (
              <FilePreviewPanel
                absPath={tab.path}
                kind={tab.kind}
                workspace={workspace}
                onReference={appendToComposerInput}
              />
            )
          })()
        )}
      </div>
    </div>
  </div>
)
```

关键：原来 `else` 块里的整个 chat 渲染（`const composer = ...`，`welcomeEmpty ? ... : <Transcript>`, TerminalDrawer 等）要搬到一个内部变量 `renderChatArea`，让 Tab 切换时只替换中间不重挂载 Sidebar。

- [ ] **Step 7: 跑回归测试 + 类型检查**
```bash
cd desktop && npm run typecheck
cd desktop && npm test
```
Expected: 0 type errors / 全部通过（如果有与 Sidebar 新 `onOpenFileExplorer` prop 相关的现有 rendering 测试失败，把测试用例里的 Sidebar 渲染 props 补 `onOpenFileExplorer={() => {}}` 和 `fileExplorerActive={false}` 默认值即可）

- [ ] **Step 8: 提交**
```bash
git add desktop/src/renderer/App.tsx
git commit -m "feat(desktop): file explorer — wire FileTreePanel + TabBar + Preview into chat view layout"
```

---

### Task 10: 集成验收 + 文档（AGENTS.md 改工具分组表）

**Files:**
- Modify: `AGENTS.md`（在「导航」表中追加「工作区文件浏览器」→ 对应 FileTreePanel + WorkbenchTabBar + FilePreviewPanel）
- (无需 spec 文档更新，因为 spec 已经是写好的那份)

**Actions:**

- [ ] **Step 1: 构建 & 手工验收**
在 PowerShell 中：
```powershell
cd d:\wraith\desktop
# 1. 保证依赖装好,已经 install 过 highlight.js 了
npm run typecheck    # 0 errors
npm test             # 全通过
npm run dev          # 启动桌面端(需 --disable-gpu --no-sandbox,package.json 已有)
```

然后跑**手工验收清单（spec §10.4 15 条）**：
1. 三栏出现 + 文件树首屏两层 + 黑名单目录确实不出现
2. 目录点展开/折叠 triangle 旋转 + 子节点正确归位
3. 点代码文件 → 新 Tab 追加 + 高亮 + line 号
4. 点 Markdown → 渲染和 Transcript 视觉一致
5. 切回「聊天」Tab → Composer 输入可用
6. 点「@引用」→ 自动切回聊天，末尾追加 `@相对路径`
7. 「🗀」在文件管理器显示
8. 「⇲」系统默认应用打开
9. 拖拽右缘宽度变化 + 最小最大生效 + 关闭重开宽度记忆
10. 点 `⇤` → 树消失；侧栏「文件」再点 → 树回来
11. ProjectSwitcher 切换项目 → 文件树跟着切换
12. 大文本文件 1.5MB 截断警告
13. exe/zip → 占位卡
14. 图片文件 → `<img>` 自适应
15. 错误场景（手动切到不存在的 Tab）→ 红色错误条，不崩溃

- [ ] **Step 2: 改 AGENTS.md 导航表**
在「给新线程的导航 → 任务类型 → 先看」表中追加：
```
| 工作区文件浏览器    | App.tsx (chat view 组装) + FileTreePanel.tsx + WorkbenchTabBar.tsx + FilePreviewPanel.tsx + fileExplorer.ts (main guard) |
```

- [ ] **Step 3: 最后一次跑 typecheck + test**
```bash
cd desktop && npm run typecheck && npm test
```

- [ ] **Step 4: 提交**
```bash
cd d:\wraith
git add AGENTS.md
git commit -m "docs(agents): reference file-explorer component group in new-thread navigator"
```

---

## Plan Self-Review (Writing-Plans 要求的自查)

**1. Spec coverage:**

| Spec 章节 | 对应 Task |
|---|---|
| §4 架构总览（文件树 / workbench / tab） | Task 9（布局组装） + 5（TabBar）+ 6（FileTree） |
| §5 文件树 IPC + 展开/折叠/宽度 | Task 2（listTree）+ Task 3（IPC）+ Task 6（UI） |
| §5.1 500 条 / 512KB 截断、黑名单目录 | Task 2 `listTree` 内常量 IGNORED_* + MAX_TREE_* |
| §5.6 侧栏入口（不切 view / 独立高亮） | Task 8 Sidebar 改造 |
| §6 Tab 不变量（chat 恒存 tabs[0]） | Task 5 组件 + 测试 |
| §7 预览 5 种 kind + 3 个顶部按钮 | Task 7 FilePreviewPanel |
| §7.4 highlight.js 集成 | Task 4 安装 + tokens.css |
| §8 路径安全守卫 withinWorkspace 单入口 | Task 2 fileExplorer.ts + 纯逻辑测试 |
| §10.1 / 10.2 / 10.3 测试矩阵 | Task 1（纯函数）、Task 2（guard）、Task 5（TabBar）、Task 6 和 8（已有 side 回归） |
| §11 错误处理边界 | Task 2 截断标记 + Task 6 truncated banner + Task 7 所有 error/loading 分支渲染 |
| §12 硬约束 | Task 1-10 每条 requirements implicit 包含；Global Constraints 头已逐字抄 |

✅ 全覆盖，无缺口。

**2. Placeholder scan:**
- Plan 中无 TBD/TODO；每一步给了实际命令或完整代码片段。
- `GetWorkspaceRoot` 在 Task 3 给出了两种实现路径（settings.ts vs backend.ts），按注释要求实现者对照真实 settings/backend 代码选，不是 placeholder——两种方式都有可调用的具体函数名字。

**3. Type consistency:**
- `PreviewKind`、`FsNode` 都在 Task 1 的 types.ts 定义，后续 Task 3/4/5/6/7/9 全部 `import from '../../shared/types'`。
- `WorkbenchTab` 在 Task 5 定义并 export，Task 9（App）`import type WorkbenchTab` 对齐。
- `makeFileTab` 返回类型在 Task 5 中用 `as const` 锁字面量，App 侧消费时 match。
- 检查到的小问题：Task 7 中 `import { relativeTime } from '../lib/snapshotView'`——注释里已写「若未导出则本文件实现」，已纳入 Step 2 类型检查的 checklist。

✅ 通过，直接执行。

