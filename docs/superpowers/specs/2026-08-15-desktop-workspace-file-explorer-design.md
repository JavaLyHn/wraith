# Desktop Workspace File Explorer（只读工作区文件树 + 预览 Tab）

日期: 2026-08-15
状态: 待审阅

## 1. 背景与现状

当前 Wraith 桌面端主视图是**单面板切换**模式（枚举 `chat | plugins | browser | documents | settings ...`），同一时间只显示一个面板，由 `App.tsx` 的 `view` state 切换。侧栏「资料」组现有一项「文档」（`DocumentsPanel.tsx`），它管理的是 `~/.wraith/documents/` 资料库——用户主动拖入/添加的扁平文件，**不是当前项目的真实文件系统**。

用户的需求（对齐 Trae Work 截图）是：**在聊天视图内同屏显示当前工作区的文件树，点击文件后在右侧 Tab 内只读预览代码、文档、图片等内容**，同时保留聊天流可随时切回。

---

## 2. 目标

1. **聊天视图内新增「左文件树 + 右 Tab 栏」双栏主区**（方案 A）：`view === 'chat'` 时主区从整块聊天，变成 `FileTreePanel (260px) + WorkbenchArea (其余)` 两列
2. **文件树只读展示当前工作区真实目录结构**：文件夹可展开/折叠、文件可点击选中、可拖拽分隔条改宽度、可整体折叠隐藏
3. **点击文件追加只读预览 Tab**：代码高亮、Markdown 渲染、图片显示、PDF/二进制显示占位 + 「用系统默认应用打开」
4. **「聊天」Tab 恒存不可关**：预览和对话随时切换、互不干扰
5. **零写入动作**：文件树无新建/重命名/删除/拖拽上传，仅读

### 3. 非目标

- **不做文件编辑**：预览区纯 read-only，不做 Monaco 等代码编辑器集成
- **不做写入文件系统的操作**：无新建文件夹、无重命名、无删除、无复制/粘贴
- **不替换现有 DocumentsPanel**：「文档（资料库）」功能独立保留，侧栏「资料」组新增一项「文件」（本功能），两者分开
- **不碰其他 view 的现有 UX**：plugins / browser / rag / memory / snapshots 等面板仍单面板全屏
- **不做多选/批量操作 / 右键菜单**：MVP 只做单击选中 + 单文件预览
- **不做文件内容搜索**：VSCode 的 `Ctrl+Shift+F` 级全局搜索不在本次范围（后续可迭代）
- **不做 diff / git status 装饰**：文件名旁的 `M / ? / A` git 徽标不在本次

---

## 4. 架构总览

### 4.1 布局变化（`App.tsx` 主渲染分支）

**现状（view === 'chat'）**：
```
+-----------+---------------------------+
|  Sidebar  |   Transcript + Composer   |
|           |   (单块占满)              |
+-----------+---------------------------+
```

**目标（view === 'chat' 且 fileTreeVisible === true）**：
```
+-----------+-----------------+---------------------------------+
|  Sidebar  |  FileTreePanel  |  TabBar + WorkbenchArea         |
|           |  (260px 可拖宽) |  [聊天][文件1.java][MD]         |
|           |                 |  -----------------------------  |
|           |                 |  聊天 Tab → Transcript+Composer |
|           |                 |  预览 Tab → FilePreviewPanel   |
+-----------+-----------------+---------------------------------+
```

**折叠文件树后（fileTreeVisible === false）**：退回现状，保持与老用户 100% 视觉一致。

### 4.2 组件新增与变更矩阵

| # | 新增/修改 | 路径 | 职责 |
|---|---|---|---|
| 1 | **新增** | `components/FileTreePanel.tsx` | 文件树：读取 RPC、展开/折叠目录、选中高亮、头部工具栏（刷新/折叠全部/隐藏文件树） |
| 2 | **新增** | `components/FilePreviewPanel.tsx` | 单文件只读预览：代码高亮 / Markdown / 图片 / 二进制占位，顶部路径条 + 辅助操作按钮 |
| 3 | **新增** | `components/WorkbenchTabBar.tsx` | Tab 栏：「聊天」Tab 恒存 + N 个文件 Tab 可关可切，横向溢出滚动 |
| 4 | **新增** | `lib/fileTreeModel.ts` | 纯函数：`FsNode` 类型定义 + 根据 flat list 构建树 + 过滤（可选） |
| 5 | **新增** | `lib/filePreviewKind.ts` | 纯函数：根据文件扩展名/魔法字节判定预览类型（code/md/image/pdf/binary） |
| 6 | **新增** | `desktop/src/main/fileExplorer.ts` | 主进程后端：枚举目录、读取文件内容（带 size + 路径安全守卫） |
| 7 | **修改** | `desktop/src/main/index.ts` | 注册 IPC：`fs:tree` / `fs:readText` / `fs:readBinary` / `fs:reveal` / `fs:openExternal` |
| 8 | **修改** | `desktop/src/preload/index.ts` | 暴露 `window.wraith.fs.*` 类型化桥（参照 `documents.*` 模式） |
| 9 | **修改** | `desktop/src/shared/types.ts` | 新增 `FsNode`、`FsReadResult`、`PreviewKind` 等接口 |
| 10 | **修改** | `desktop/src/renderer/App.tsx` | 主布局新增 FileTreePanel + Workbench 双栏；新增 `workbenchTabs` / `activeTabId` state；fileTreeVisible / treeWidth state 并持久化到 localStorage；侧栏 TOOL_GROUPS「资料」组追加「文件」项 |
| 11 | **修改** | `desktop/src/renderer/components/Sidebar.tsx` | TOOL_GROUPS 的资料组：label「文档」→「文档（资料库）」避免歧义；保持 `nav: 'documents'` 不变；新增 `nav: 'fileExplorer'`（或复用现有，用 App 侧 state 控制显隐——本 spec 走独立 ToolNav） |
| 12 | **修改** | `desktop/src/renderer/styles/tokens.css` | 可选：补文件树选中行、Tab 活跃下划线、预览代码行号所需的少量 token |

### 4.3 数据流

```
FileTreePanel 用户点击文件夹展开
    └─► window.wraith.fs.tree(path) ──► main/fileExplorer.ts (带安全校验)
                                          └─► 返回 FsNode[]
FileTreePanel 用户点击文件
    └─► App.openFileTab(absPath)
          ├─► 去重：已打开则切 activeTabId，不新建
          └─► 新建：追加 workbenchTabs 数组，设为 activeTabId

Workbench 根据 activeTabId 渲染：
  ├─ id === 'chat'            ──► Transcript + Composer（现有）
  └─ id === 'file:${absPath}' ──► FilePreviewPanel(absPath)
                                     └─► window.wraith.fs.readText(absPath, maxChars)
                                        window.wraith.fs.readBinary(absPath, maxBytes)
```

---

## 5. 文件树（FileTreePanel）详细设计

### 5.1 IPC 契约 — `window.wraith.fs.tree(rootPath, opts?)`

- **入参**：`rootPath` 必填（当前 workspace 根，由 App 从 `state.workspace` 传入）；`opts` 可选：`maxDepth?: number` 限制深度（默认 2，防止巨型项目首屏卡死）
- **出参**：`Promise<{ nodes: FsNode[]; truncated: boolean }>`。`nodes` 一律是 **flat list**（每条含 `path / parentPath / name / kind / size? / mtime?`），由前端 `fileTreeModel.buildTreeFromFlat()` 建树；返回 flat 的好处是后续按目录懒加载 children（§5.4 深度展开）时，后端只回那一小段子节点 flat 数组，前端 `insertSubtree` 合并即可，不需要做全树深 diff
- **安全性**：
  1. `rootPath` 必须严格等于当前绑定的 workspace 路径（App 端保证）；后端再做一次 guard：任何节点 abs path 不得以 `..` 逃逸 workspace 根，逃逸则该节点被跳过并记 warning
  2. 默认忽略的目录（黑名单，不可配置，后端写死）：`node_modules`、`.git`、`target`（Java/Maven）、`dist`、`build`、`.idea`、`.vscode`、`.DS_Store`、`Thumbs.db`、`~/.wraith/documents`（不相关）
  3. 单目录最多返回 500 条，超限截断 + 返回 `truncated: true` 标记，前端显示「还有 N 项未加载，双击该文件夹单独展开」
  4. 单条响应 payload 上限 512KB；超过只返根目录一层 + 截断警告

### 5.2 FsNode 类型（types.ts）

```ts
export interface FsNode {
  /** 绝对路径 */
  path: string
  /** 父目录绝对路径；根节点（workspace 自己）为 '' */
  parentPath: string
  /** basename */
  name: string
  kind: 'dir' | 'file' | 'symlink'
  /** 文件字节；目录为 undefined 或 0（实现时统一 undefined） */
  size?: number
  /** 修改时间 epoch ms；缺失为 undefined */
  mtime?: number
  /** 后端深度限制时被截断，提示用户 */
  truncated?: boolean
}
```

### 5.3 UI 结构

```
┌──────────────────────────────┐
│ 📁 wraith   [⟳] [⇲] [⇤]      │ ← header: 根名（相对项目切换器的 basename）
├──────────────────────────────┤   + 刷新 / 全部折叠 / 隐藏文件树 三个图标按钮
│ ▸ .image                     │ ← 折叠目录
│ ▾ policy                     │ ← 展开目录 (caret 旋转 90°)
│   ▾ sandbox                  │
│     · AppContainerSupport.ja │ ← 文件；hover 改 row 背景
│     ☕ PowerShellBomTest.jav │ ← 选中：紫色弱背景 + 左 3px 竖条（参照 activeNav）
│ ▸ plan                       │
│ ...                          │
└──────────────────────────────┘
```

### 5.4 展开/折叠策略

- **首屏加载**：`maxDepth = 2`——展示根 + 根下一层的内容，根下一层的目录默认折叠
- **用户点展开一个未加载目录**：如果该目录的 children 没在已加载 flat map 里（即后端截断的深层目录），单独调用一次 `fs.tree(dirPath, { maxDepth: 1 })` 然后合并到本地树
- **折叠状态本地 state**：`expandedPaths: Set<string>`，默认 `rootPath ∈ expandedPaths`；不持久化（每次打开文件树按首屏策略来，简单稳定）
- **「折叠全部」按钮**：`expandedPaths = new Set([rootPath])`，只留根展开

### 5.5 宽度 & 隐藏

- **默认宽度**：260px，最小值 180px，最大值 480px
- **拖拽分隔条**：在 FileTreePanel 右缘贴一条 3px 宽隐形 col-resize 条，hover 现紫色背景，mousedown 开始监听 document mousemove，更新 `treeWidth` 并持久化到 `localStorage['wraith.workspace.treeWidth']`
- **隐藏文件树**：点右上角 `⇤` 或拖到小于 180px 时 → `fileTreeVisible = false`，持久化到 localStorage。隐藏后入口：
  - 方案①（推荐）：侧栏「资料」组的「文件」Nav 项，点击 toggle 可见性（而非切 view）
  - 方案②：聊天区左上角加一个小图标。选①，避免再给 Transcript 加装饰

### 5.6 侧栏入口

Sidebar TOOL_GROUPS「资料」组：
```diff
  label: '资料',
  items: [
+   { nav: 'fileExplorer', testId: 'nav-file-explorer', label: '文件', Icon: FolderTree },
    { nav: 'documents',    testId: 'nav-documents',    label: '文档（资料库）', Icon: FolderOpen },
  ],
```
- 点「文件」：不切 view（仍在 chat），只是 `setFileTreeVisible(v => !v)` toggle；active 时高亮（`activeNav === 'fileExplorer'` 实际 active 态用 `fileTreeVisible === true && activeNav !== null 时`——实现时由 App 传一个 `fileTreeOpen: boolean` 到 Sidebar，替换 activeNav 的那套对照，**这里不能新增真正的 ToolNav 值去切 view**，否则就出 chat 了。修正：`activeNav` 不再判断它，新增独立 prop `fileExplorerActive: boolean` 传给 Sidebar 决定「文件」这一行的高亮 class）。

---

## 6. Workbench Tab 区 & 状态管理

### 6.1 状态模型（App.tsx 新增）

```ts
type WorkbenchTab =
  | { id: 'chat'; title: '聊天' }
  | { id: `file:${string}`; title: string; path: string; kind: PreviewKind }

/** 打开的 Tab 列表（聊天恒在第 0 位） */
const [workbenchTabs, setWorkbenchTabs] = useState<WorkbenchTab[]>([{ id: 'chat', title: '聊天' }])
/** 当前激活 Tab id；默认 'chat' */
const [activeTabId, setActiveTabId] = useState<string>('chat')
```

### 6.2 不变量

1. `workbenchTabs[0] === { id: 'chat' }` 永远成立（聊天 Tab 不可关、不可重排、不可删除）
2. 文件 Tab 的 id 使用前缀 `'file:' + absPath`，保证同一文件不会重复开 Tab
3. `activeTabId` 必须是 `workbenchTabs` 里存在的 id；若关闭当前 active Tab → active 退回 chat（因为 chat 恒存）

### 6.3 Tab 行为

- **点击 FileTree 里的文件**：
  1. 计算 `id = 'file:' + absPath`
  2. 若 workbenchTabs 已有该 id：只 `setActiveTabId(id)`，切换高亮
  3. 若没有：`setWorkbenchTabs(prev => [...prev, { id, title: basename, path: absPath, kind: previewKind(absPath) }])`；`setActiveTabId(id)`
- **Tab 点击**：`setActiveTabId(id)`
- **Tab 关闭 ×**：
  - 聊天 Tab：无关闭按钮
  - 文件 Tab：关后若 active 是它 → `activeTabId = 'chat'`

### 6.4 TabBar UI

```
┌────────────────────────────────────────────────────────┐
│[💬 聊天] [☕ PowerShellBomTest.java ×] [📄 AGENTS.md ×] │ ← 超出宽度可横向滚
└────────────────────────────────────────────────────────┘
```

- 聊天 Tab：用 💬 图标，无关闭按钮；active 用紫色 2px 底边线（和 mockup 一致）
- 文件 Tab：图标按 `docIconKind()` / `previewKind()` 映射后缀到图标；basename 显示，太长 truncate，tooltip 显完整路径
- Tab hover：`bg-surface`（和 DocumentsPanel 搜索框一致的视觉语言）

---

## 7. 预览面板（FilePreviewPanel）

### 7.1 PreviewKind 分发（`filePreviewKind.ts`）

按扩展名（小写化后）分 5 类：

| Kind | 扩展名示例 | 渲染方式 |
|---|---|---|
| `code` | `.java/.ts/.tsx/.js/.py/.go/.rs/.json/.yaml/.yml/.toml/.xml/.sh/.ps1/.bat/.css/.scss/.html/.sql/.kt/.scala/.rb/.php/.mdx/.c/.h/.cpp/.cs/.r` | 代码高亮 + line 号 |
| `markdown` | `.md/.markdown` | 用现有 Transcript 内同一份 Markdown renderer 渲染（避免两套样式） |
| `image` | `.png/.jpg/.jpeg/.gif/.webp/.svg/.bmp/.ico` | `<img>` 居中 + 自适应 |
| `pdf` | `.pdf` | 占位卡：「PDF 需用默认应用打开」+ 打开按钮 |
| `binary` | 其余 + 文本大小超 `MAX_TEXT_BYTES`（1.5MB） | 占位卡：文件名 + 大小 + mtime + 「用系统默认应用打开」按钮 |

- 文本文件（code/markdown）先读前 1.5MB；超了不继续，首屏显示「文件过大，只展示前 1.5MB · 请用外部编辑器查看」
- 二进制/image：不预读字节（避免把 100MB 的 exe 塞进 IPC），渲染卡或 `<img src="file:///...">` 时让 Chromium 自己按需要请求

### 7.2 IPC 契约

- `window.wraith.fs.readText(absPath, maxChars?): Promise<{ content: string; truncated: boolean; size: number; encoding: 'utf-8' }>`
  - 安全：后端校验 absPath 必须是 workspace 根下、是文件、非 symlink 指向 workspace 外（symlink 跟随 target 判定）
  - 编码：先按 UTF-8 读；出现 replacement char 且（比例 >2%，或内容 <64 字符时只要有 1 个）→ 试 GBK 重解，仅当 GBK 结果的 replacement char 数量严格更少才采纳（防止 UTF-8 局部损坏 1 字节被误换成整篇 GBK 乱码）
- `window.wraith.fs.stat(absPath): Promise<FsNode>`：预览头用来展示路径、大小、mtime
- `window.wraith.fs.reveal(absPath): Promise<void>` → `shell.showItemInFolder(p)`
- `window.wraith.fs.openExternal(absPath): Promise<void>` → `shell.openPath(p)`，失败把错误串 throw 出来（renderer 用 `ipcErrorText` 剥掉前缀）

### 7.3 路径条 & 辅助操作（预览顶部）

```
┌──────────────────────────────────────────────────────────────────┐
│ src/test/java/.../sandbox/PowerShellBomTest.java   [📎 @引用] [🗀] [⇲] │
├──────────────────────────────────────────────────────────────────┤
│  1  package com.lyhn.wraith.policy.sandbox;                      │
│  2                                                                 │
│ ... 代码高亮 + line 号 + hover 行背景 + 当前行高亮                 │
└──────────────────────────────────────────────────────────────────┘
```

三个辅助按钮：
- **「📎 @引用到输入」**：把 `@path`（相对 workspace 根的路径，用 `@src/test/java/.../Foo.java` 的格式，和现有 @path mention 语法一致）追加到 Composer 的输入框末尾；若当前 active tab 不是聊天 → 切回聊天并 focus 输入框。**实现方式**：App 层暴露 `appendToInput(text)` 回调，把文本塞到 `inputValue` 的后面（类似 LocalPathMentionExpander 的结果）
- **「🗀 在资源管理器中显示」** → `fs.reveal(absPath)`
- **「⇲ 外部打开」** → `fs.openExternal(absPath)`

### 7.4 代码高亮选择

**选型：`highlight.js`（CDN 不可行，所以直接 npm 安装 `highlight.js`）**。

理由：
- 仓库现有依赖里检查：先 `Read desktop/package.json` 确认有没有；若没有，引入它（shiki 太重、带 wasm 包，体积是 highlight.js 5x+；Wraith 桌面端只预览，不需要 100+ 语言，highlight.js 常用 40 种语言 + 暗色主题「atom-one-dark」够用）
- 备选（零依赖）：用现有的 `<pre><code>` + 手动染色关键字，但会和 Transcript 里代码块的已有渲染不一致。选 highlight.js，和 Transcript 的代码渲染器做一次对齐（主题 CSS 变量复用 `tokens.css` 里的 `--code-*`，两者看起来一样）

### 7.5 预览尺寸 & 滚动

- 预览区完全占满 WorkbenchArea 除 TabBar 外的空间：`flex: 1; min-height: 0; overflow: auto`
- 代码/Markdown：左 padding 16px，top padding 12px，`line-height: 1.65`；line 号宽度固定 40px，右对齐，`user-select: none`，颜色 `fg-subtle`
- 图片：`max-width: 100%` + 居中 + `object-fit: contain`，背景 `bg-muted` 做棋盘格（可选）
- 二进制占位卡：居中 480px 宽的浅面板

---

## 8. 主进程安全守卫（硬要求）

所有 `fs:*` IPC 都必须在**同一个 guard 函数**里先过三关：

```
function withinWorkspace(absPath: string): string {
  1. absPath 必须是绝对路径（Node path.isAbsolute）
  2. 规范化（path.normalize），消除 /../ /./ 段
  3. 规范化后必须以 workspaceRootPath + sep 开头，或 === workspaceRootPath 自身
  4. 若是 symlink：fs.realpath 解析目标，再重复 1-3 校验
  5. 不通过：throw new Error('Path out of workspace')，记一条 audit log
}
```

- **workspaceRootPath 的来源**：main 侧已有 `config.workspace`（或 app-server 的 workspace 绑定）；IPC 处理函数必须闭包捕获 `() => currentWorkspacePath`（因为 workspace 可切换），**不能在启动时固化**
- `fs.tree(rootPath)`：`rootPath` 必须等于 `currentWorkspacePath`，否则直接拒——防止 renderer 伪造别的根目录
- 失败一律不返回堆栈详情，只返回「路径不在工作区」中文错误串，由 renderer 侧的 `ipcErrorText` 统一剥壳显示

---

## 9. 改动清单（和 §4.2 对齐，方便 implementation 拆子任务）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `desktop/src/shared/types.ts` | 追加 `FsNode`、`PreviewKind`、`WorkbenchTab`（或局部类型即可，看实现，放 shared 给 preload 用）接口 |
| 2 | `desktop/src/main/fileExplorer.ts`（新增） | `withinWorkspace` guard + `listTree(root, opts)` / `readText(p, maxChars)` / `stat(p)` / `reveal(p)` / `openExternal(p)`；所有入参过 guard |
| 3 | `desktop/src/main/index.ts` | 注册 `wraith:fs:tree` / `wraith:fs:readText` / `wraith:fs:stat` / `wraith:fs:reveal` / `wraith:fs:openExternal` 五个 handler；引入 `fileExplorer.ts` |
| 4 | `desktop/src/preload/index.ts` | 暴露 `window.wraith.fs = { tree, readText, stat, reveal, openExternal }`；补类型声明（和 `documents` 对齐的写法） |
| 5 | `desktop/src/renderer/lib/filePreviewKind.ts`（新增） | `previewKind(path)` → `PreviewKind`；`MAX_TEXT_BYTES = 1_572_864`（1.5MB）常量 |
| 6 | `desktop/src/renderer/lib/fileTreeModel.ts`（新增） | `buildTreeFromFlat(nodes, rootPath)`、`insertSubtree(map, parentPath, newNodes)`；纯函数 + 单测 |
| 7 | `desktop/src/renderer/components/WorkbenchTabBar.tsx`（新增） | 接收 `tabs / activeId / onActivate / onClose` 渲染 TabBar；聊天 Tab 无 close 按钮 |
| 8 | `desktop/src/renderer/components/FileTreePanel.tsx`（新增） | 接收 `workspace / width / onWidthChange / onHide / onOpenFile` props；展开折叠 + 选中高亮 + 宽度拖拽 3px 条 + 工具栏 |
| 9 | `desktop/src/renderer/components/FilePreviewPanel.tsx`（新增） | 接收 `path / kind`；调 `fs.readText / fs.stat`；渲染 5 类 preview；顶部 3 操作按钮调用 App 传的 `onReferenceToInput / onReveal / onOpenExternal` |
| 10 | `desktop/src/renderer/App.tsx` | 主布局改造 chat 分支为双列 Grid；新增 `fileTreeVisible / treeWidth / workbenchTabs / activeTabId` state；新增 `toggleFileExplorer / openFileTab / closeFileTab / activateTab / appendToInput` 回调；把 `appendToInput` 传进 Transcript 所在的 Composer 封装（或直接操作 inputValue setter） |
| 11 | `desktop/src/renderer/components/Sidebar.tsx` | TOOL_GROUPS「资料」组：加 `fileExplorer` 项（Icon 用 `FolderTree`，label「文件」）；原 `documents` label 改「文档（资料库）」；新增 `fileExplorerActive` prop 控制这行高亮（不改 activeNav 语义，因为点「文件」不切 view） |
| 12 | `desktop/src/renderer/styles/tokens.css` | 追加 `.ft-row-selected`（`--brand-soft` 背景 + 左 3px 竖条）、`.wb-tab-active`（底边线 2px 紫色）、`.preview-ln`（line 号列宽 40px）3 个样式片段 |
| 13 | `desktop/package.json` | 追加 `highlight.js` 依赖；**版本锁定 `^11.10.0`** |

---

## 10. 测试策略

### 10.1 纯函数单测（desktop/test/）

- **`filePreviewKind.test.ts`**（新增）：
  - T1：`.java → 'code'`；`.md → 'markdown'`；`.png → 'image'`；`.pdf → 'pdf'`；无扩展名 + 小体积 → `'binary'`
  - T2：大小写不敏感：`.JPG → 'image'`
- **`fileTreeModel.test.ts`**（新增）：
  - T1：flat list → tree：3 层目录正确归组
  - T2：`insertSubtree` 合并深层加载的子节点到已存 map
  - T3：`truncated: true` 节点透传

### 10.2 主进程 guard 测试（desktop/test/main 或 e2e mock）

由于现有桌面端测试框架不一定具备真 node 主进程 mock，最低保证：
- **T1**：`withinWorkspace('d:\\wraith', 'd:\\wraith\\src\\Foo.java') → pass`
- **T2**：`withinWorkspace('d:\\wraith', 'd:\\other\\secret.txt') → reject`
- **T3**：`withinWorkspace('d:\\wraith', 'd:\\wraith\\..\\other\\x') → reject`（规范化后逃逸）
- **T4**：`listTree(root)` root 不等于 workspaceRootPath → reject

### 10.3 渲染层轻量测试（desktop/test/，现有 vitest）

- **WorkbenchTabBar 不变量**：
  - T1：聊天永远在 tabs[0]，close 回调被忽略
  - T2：关 active 文件 tab → activeId 变成 'chat'
  - T3：重复开同一文件 absPath → tabs 不增长，activeId 切换
- **Sidebar 导航新增项**：`TOOL_GROUPS` 里资料组有「文件」+「文档（资料库）」两项（grep 字面量断言，防未来重构漏项——参照 `SlashCommandDiscoverabilityTest` 的思路）

### 10.4 手工验收清单（重要，必跑）

1. 启动后 chat 视图：默认显示三栏（Sidebar / FileTree 260px / 聊天 Tab）
2. 文件树：根目录展开，默认展开两层；`node_modules`、`.git`、`target` 不在列表里
3. 点折叠三角 → 目录收起/展开；caret 旋转动画
4. 点一个 Java/TS 文件 → 右侧新增同名 Tab → 代码高亮 + line 号正确显示；activeTab 紫色底边线
5. 再点一个 Markdown → 新增 Tab；Markdown 渲染和 Transcript 里代码块视觉一致
6. 切回「聊天」Tab → Transcript 和 Composer 可见；输入框正常写内容
7. 点「📎 @引用到输入」→ 自动切回聊天 Tab，输入框末尾追加 `@相对路径/Foo.java`
8. 点「🗀」→ 系统文件管理器弹出并选中该文件
9. 点「⇲」→ 用系统默认应用打开（Java 用 IDEA/VSCode，图片用照片查看器等）
10. 拖拽 FileTree 右缘 3px 条 → 宽度变化；最小 180 / 最大 480 生效；关闭重开窗口宽度记忆
11. 点 FileTree 右上「⇤」→ FileTree 消失，聊天占满；再点侧栏「资料→文件」→ FileTree 回来
12. 切换 ProjectSwitcher 到另一个项目 → FileTree 内容切换到新项目根；预览 Tab 仍保留（tab 路径跨项目时如果文件不存在，显示「文件已不存在」占位，不崩溃）
13. 大文本文件（10MB log）：只读前 1.5MB，尾部警告「截断显示」不崩溃
14. 二进制 exe / zip：占位卡显示文件名、大小、按钮，不误读二进制字节
15. 图片文件：`<img>` 正确显示，自适应容器

### 10.5 回归保护

- `npm run typecheck`（或 `npx tsc --noEmit`）→ 0 errors
- `npm test -- --run` → 现有 vitest 全部通过
- `mvn package`（Java 侧无改动，仅为确认 package 整体未坏）

---

## 11. 边界 & 错误处理

| 场景 | 处理方式 |
|---|---|
| 切换 workspace 后，已打开的 Tab 里文件在新项目中不存在 | 打开该 tab 时 `fs.stat` 失败 → 渲染占位卡：「文件不再属于当前工作区」+ 关闭 tab 引导按钮 |
| 文件读取权限不足 / 符号链接逃逸 / 目录被锁 | `ipcErrorText(err, '读取失败')` 在预览顶部红色错误条；内容区空白 |
| 首屏加载 tree 返回 `truncated: true`（巨型项目 500+ 项）| FileTree 底部黄色 banner：「首屏只显示前 500 项，点具体文件夹单独展开」|
| 目录首次展开 children 还没加载（展开按钮）| 该目录下插入一行灰色「加载中…」，加载完成后替换；失败显示「加载失败」 |
| 读文本 1.5MB 截断 | 预览顶部黄色 banner：「文件过大，仅显示前 1.5MB」；代码最后一行 append `// …… 已截断 ……` |
| previewKind 识别失败（扩展名未知） | 一律归 `'binary'`，占位卡提供外部打开 + 显示 |
| 用户关闭所有文件 Tab 后 | activeId 自动变成 'chat'，聊天 tab 永远留着 |

---

## 12. 硬约束

1. **绝对只读**：不提供任何 `fs.writeFile` / `fs.mkdir` / `fs.rename` / `fs.rm`；前端不出现相关 UI
2. **路径安全单入口**：主进程所有 `fs:*` IPC 必须走同一个 `withinWorkspace()` guard，不许各自写
3. **Workspace 切换感知**：`currentWorkspacePath` 必须是动态读取（闭包函数），不允许启动时固化
4. **黑名单目录**：`node_modules / .git / target / dist / build` 永不进树（后端过滤，不是前端隐藏）
5. **Payload 上限**：`readText` 默认 1.5MB、`tree` 单请求 512KB / 500 条，超限截断不崩溃
6. **Tab 不变量**：聊天 Tab 永远 tabs[0]、不可关
7. **不破坏现有 view 切换**：点侧栏 plugins/browser/documents 仍能切到对应全屏面板（此时文件树不可见，切回 chat 再显示）
8. **无障碍**：Tree 行 / Tab 均用 `role=treeitem` / `role=tab` 基础属性（不强求完整 aria 套件，至少 focusable + role）
9. **侧栏高亮不变**：点「文件」只是 toggle 文件树，不替换 activeNav 的 view 切换语义；新增独立 `fileExplorerActive` prop 控制高亮

---

## 13. 后续可迭代项（明确非 MVP，不进本次实现）

1. 文件名 git 状态装饰（M/A/?/D）
2. 右键菜单（复制路径 / 在集成终端打开 / 作为 @mention 引用等）
3. 文件内容搜索（全局 find-in-files）
4. Monaco Editor 集成（只读代码编辑 -> 可编辑 -> 保存）
5. 拖拽上传到资料库（DocumentsPanel 已有，不重复）
6. 工作区外的目录书签（Favorite）
7. 多工作区文件树同时显示（multi-root）
8. 快捷键（`Ctrl+B` 切换文件树、`Ctrl+P` 快速打开文件）
