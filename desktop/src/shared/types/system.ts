/** App info, update, fs tree, docs, close, preview + builtin tool views. */

export interface AppInfo { version: string; repoUrl: string; dataDir: string }
export interface UpdateResult {
  current: string
  latest: string | null
  hasUpdate: boolean
  url: string | null
  isPrerelease: boolean
  error?: string
}

/** 内置工具定义(tools.list 回传;= 模型看到的定义)。 */
export interface BuiltinToolView { name: string; description: string; parameters?: unknown }

// ---------------------------------------------------------------------------
// 桌面「文档」面板:~/.wraith/documents/ 扁平存放用户资料
// ---------------------------------------------------------------------------

/** 「文档」面板:库内一条文件记录。name 同时是所有 IPC 的入参。 */
export interface DocEntry {
  name: string
  size: number      // 字节
  addedAt: number   // epoch ms
}

/** 「文档」面板:批量入库结果。added 为最终文件名(可能带 " (2)");failed.name 为源文件 basename。 */
export interface DocAddResult {
  added: string[]
  failed: { name: string; reason: string }[]
}

// ---------------------------------------------------------------------------
// 桌面关闭行为 (close behavior)
// ---------------------------------------------------------------------------

/** 关闭主窗时用户选择的处理方式。 */
export type CloseMode = 'ask' | 'background' | 'quit'

/** renderer → main:执行用户选择的关闭动作。 */
export interface CloseExecutePayload {
  mode: 'background' | 'quit'
  /** 用户勾选了「下次别问」则把 closeMode 持久化为对应 mode;未勾则 null=保持 ask。 */
  remember: 'background' | 'quit' | null
}

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
