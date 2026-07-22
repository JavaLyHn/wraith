# 文件产物卡 + 「打开方式」Implementation Plan(子项①)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 回复下方每个产物文件渲染成 Codex 式文件卡(文件名 + 类型标签 + 「打开方式」下拉:默认程序 / 探测到的编辑器 / 在 Finder 显示 / 下载副本),点卡体仍进右侧内容预览。

**Architecture:** Electron renderer + 主进程,零 Java。主进程新增 4 个 IPC(reveal/openWith/downloadCopy/listEditors);renderer 新组件 `FileArtifactCard` 取代 `ArtifactChips`;三个纯函数(`fileTypeLabel`/`resolveWorkspacePath`/`detectEditors`+`uniqueDownloadName`)可单测。

**Tech Stack:** TypeScript, React, Electron(shell/child_process spawn/fs), @radix-ui/react-popover(经 ui/popover), lucide-react, vitest + @testing-library/react(jsdom)。

## Global Constraints

- **不改 Java、不重打 jar**;改动仅限 `desktop/`。主 worktree `~/Desktop/wraith/desktop`。
- ⚠️ 含 **Electron 主进程 + preload** 改动 → 生效需**重启 dev App**(renderer 部分走 HMR;主/preload 不热重载)。
- macOS-only:`open -a <app> <path>` 打开;不处理其它平台。
- 「打开方式」外部操作(openPath/reveal/openWith/downloadCopy)需**绝对路径**;`diff`/write_file 的 path 可能相对 → 用 `resolveWorkspacePath(path, workspace)` 按工作区解析。内容预览(`onOpenPreview`)用原 path + content(纯 in-app,不碰 fs)。
- `openWithApp` 的 appPath **只接受** `listEditors()` 返回过的真实 `.app`(主进程校验 `.app` 结尾 + 存在)。
- 复用:`ArtifactFile`(`src/shared/artifactSummary.ts`)、`baseName`(`src/renderer/lib/paths.ts`)、`ui/popover`、`filesUnderMessages`(不变)、现有 `openArtifact`(App,预览)。
- 测试从 `desktop/` 跑:`npx vitest run <file>`、`npx tsc --noEmit`。提交只 `git add` 本任务文件,不碰仓库既有 WIP。

---

### Task 1: renderer 纯函数 `fileTypeLabel` + `resolveWorkspacePath`

**Files:**
- Create: `desktop/src/renderer/lib/fileType.ts`
- Modify: `desktop/src/renderer/lib/paths.ts`
- Test: `desktop/test/fileType.test.ts`

**Interfaces:**
- `export function fileTypeLabel(path: string): string` —— `<类别> · <EXT大写>`;无扩展 → `文件`。
- `export function resolveWorkspacePath(path: string, workspace: string | null): string` —— 绝对(`/…` 或 Windows 盘符)原样;否则 `workspace` 去尾斜杠 + `/` + path;无 workspace 原样。

- [ ] **Step 1: 写失败测试**

Create `desktop/test/fileType.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { fileTypeLabel } from '../src/renderer/lib/fileType'
import { resolveWorkspacePath } from '../src/renderer/lib/paths'

describe('fileTypeLabel', () => {
  it('文档', () => { expect(fileTypeLabel('a/README.md')).toBe('文档 · MD'); expect(fileTypeLabel('x.txt')).toBe('文档 · TXT') })
  it('代码', () => { expect(fileTypeLabel('src/a.ts')).toBe('代码 · TS'); expect(fileTypeLabel('m.py')).toBe('代码 · PY') })
  it('配置', () => expect(fileTypeLabel('pkg.json')).toBe('配置 · JSON'))
  it('样式', () => expect(fileTypeLabel('a.css')).toBe('样式 · CSS'))
  it('未知扩展 → 文件 · EXT', () => expect(fileTypeLabel('a.xyz')).toBe('文件 · XYZ'))
  it('无扩展 → 文件', () => { expect(fileTypeLabel('Makefile')).toBe('文件'); expect(fileTypeLabel('.env')).toBe('文件') })
})

describe('resolveWorkspacePath', () => {
  it('相对 + workspace 拼绝对', () => expect(resolveWorkspacePath('a/b.ts', '/proj')).toBe('/proj/a/b.ts'))
  it('workspace 尾斜杠归一', () => expect(resolveWorkspacePath('b.ts', '/proj/')).toBe('/proj/b.ts'))
  it('绝对路径原样', () => expect(resolveWorkspacePath('/abs/x', '/proj')).toBe('/abs/x'))
  it('无 workspace → 原样', () => expect(resolveWorkspacePath('b.ts', null)).toBe('b.ts'))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/fileType.test.ts`
Expected: FAIL —— 模块/导出不存在。

- [ ] **Step 3: 实现**

Create `desktop/src/renderer/lib/fileType.ts`:
```ts
/** 产物文件的类型标签(按扩展名):`<类别> · <EXT>`;无扩展名 → `文件`。纯函数。 */
const CATEGORY: Record<string, string> = {
  md: '文档', markdown: '文档', txt: '文档', rst: '文档', adoc: '文档',
  ts: '代码', tsx: '代码', js: '代码', jsx: '代码', mjs: '代码', cjs: '代码',
  py: '代码', java: '代码', go: '代码', rs: '代码', c: '代码', cc: '代码', cpp: '代码',
  h: '代码', hpp: '代码', sh: '代码', rb: '代码', php: '代码', swift: '代码', kt: '代码', sql: '代码',
  json: '配置', yaml: '配置', yml: '配置', toml: '配置', ini: '配置', xml: '配置', env: '配置',
  css: '样式', scss: '样式', less: '样式',
}

export function fileTypeLabel(path: string): string {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return '文件' // 无扩展名 或 dotfile(.env 等)
  const ext = base.slice(dot + 1)
  const cat = CATEGORY[ext.toLowerCase()] ?? '文件'
  return `${cat} · ${ext.toUpperCase()}`
}
```

在 `desktop/src/renderer/lib/paths.ts` 末尾追加:
```ts
/** 相对路径按 workspace 拼绝对(供打开/揭示/下载等 fs 操作);绝对路径(POSIX /… 或 Windows 盘符)原样;无 workspace 原样。 */
export function resolveWorkspacePath(path: string, workspace: string | null): string {
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) return path
  return workspace ? workspace.replace(/\/+$/, '') + '/' + path : path
}
```

- [ ] **Step 4: 跑测试 + tsc**

Run: `cd desktop && npx vitest run test/fileType.test.ts` → PASS。
Run: `cd desktop && npx tsc --noEmit` → 无输出。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/lib/fileType.ts desktop/src/renderer/lib/paths.ts desktop/test/fileType.test.ts
git commit -m "feat(desktop): fileTypeLabel + resolveWorkspacePath 纯函数(文件卡用)"
```

---

### Task 2: 主进程纯函数 `detectEditors` + `uniqueDownloadName` + `EditorApp` 类型

**Files:**
- Create: `desktop/src/shared/editors.ts`
- Create: `desktop/src/main/fileOpen.ts`
- Test: `desktop/test/fileOpen.test.ts`

**Interfaces:**
- `export interface EditorApp { name: string; appPath: string }`(`src/shared/editors.ts`)。
- `export function detectEditors(appPaths: readonly string[]): EditorApp[]` —— 从绝对 `.app` 路径列表里,按已知表顺序挑出已装编辑器(basename 匹配),去重(按 name)。
- `export function uniqueDownloadName(existing: ReadonlySet<string>, base: string): string` —— base 不冲突原样;否则 `name (2).ext`、`name (3).ext`… 递增。

- [ ] **Step 1: 写失败测试**

Create `desktop/test/fileOpen.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { detectEditors, uniqueDownloadName } from '../src/main/fileOpen'

describe('detectEditors', () => {
  it('只返回已知已装项,按表序,appPath 正确', () => {
    const paths = [
      '/Applications/Visual Studio Code.app',
      '/Applications/Xcode.app',
      '/Applications/Unknown.app',
      '/Users/x/Applications/Zed.app',
    ]
    expect(detectEditors(paths)).toEqual([
      { name: 'VS Code', appPath: '/Applications/Visual Studio Code.app' },
      { name: 'Xcode', appPath: '/Applications/Xcode.app' },
      { name: 'Zed', appPath: '/Users/x/Applications/Zed.app' },
    ])
  })
  it('空列表 → 空', () => expect(detectEditors([])).toEqual([]))
  it('同名多份取首个(去重)', () => {
    expect(detectEditors(['/Applications/Terminal.app', '/Users/x/Applications/Terminal.app']))
      .toEqual([{ name: 'Terminal', appPath: '/Applications/Terminal.app' }])
  })
})

describe('uniqueDownloadName', () => {
  it('无冲突原样', () => expect(uniqueDownloadName(new Set(), 'a.md')).toBe('a.md'))
  it('冲突 → (2)', () => expect(uniqueDownloadName(new Set(['a.md']), 'a.md')).toBe('a (2).md'))
  it('多次冲突递增', () => expect(uniqueDownloadName(new Set(['a.md', 'a (2).md']), 'a.md')).toBe('a (3).md'))
  it('无扩展名也正确', () => expect(uniqueDownloadName(new Set(['README']), 'README')).toBe('README (2)'))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/fileOpen.test.ts` → FAIL(模块不存在)。

- [ ] **Step 3: 实现**

Create `desktop/src/shared/editors.ts`:
```ts
/** 「打开方式」里可选的编辑器应用(展示名 + .app 绝对路径)。 */
export interface EditorApp { name: string; appPath: string }
```

Create `desktop/src/main/fileOpen.ts`:
```ts
import path from 'path'
import type { EditorApp } from '../shared/editors'

/** 已知编辑器:.app bundle 名 → 展示名。detectEditors 按此顺序输出已装的。 */
const KNOWN_EDITORS: { app: string; name: string }[] = [
  { app: 'Terminal.app', name: 'Terminal' },
  { app: 'Visual Studio Code.app', name: 'VS Code' },
  { app: 'Cursor.app', name: 'Cursor' },
  { app: 'Xcode.app', name: 'Xcode' },
  { app: 'IntelliJ IDEA.app', name: 'IntelliJ IDEA' },
  { app: 'IntelliJ IDEA CE.app', name: 'IntelliJ IDEA CE' },
  { app: 'Sublime Text.app', name: 'Sublime Text' },
  { app: 'Zed.app', name: 'Zed' },
]

/** 从绝对 .app 路径列表挑出已知已装编辑器,按 KNOWN_EDITORS 顺序、按 name 去重。纯函数。 */
export function detectEditors(appPaths: readonly string[]): EditorApp[] {
  const out: EditorApp[] = []
  for (const known of KNOWN_EDITORS) {
    const hit = appPaths.find(p => path.basename(p) === known.app)
    if (hit) out.push({ name: known.name, appPath: hit })
  }
  return out
}

/** 目标文件名去重:base 不冲突原样;否则 `stem (2).ext`、`(3)`… 递增。纯函数。 */
export function uniqueDownloadName(existing: ReadonlySet<string>, base: string): string {
  if (!existing.has(base)) return base
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  for (let i = 2; ; i++) {
    const cand = `${stem} (${i})${ext}`
    if (!existing.has(cand)) return cand
  }
}
```

- [ ] **Step 4: 跑测试 + tsc** → `npx vitest run test/fileOpen.test.ts` PASS;`npx tsc --noEmit` 无输出。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/shared/editors.ts desktop/src/main/fileOpen.ts desktop/test/fileOpen.test.ts
git commit -m "feat(desktop): detectEditors/uniqueDownloadName 纯函数 + EditorApp 类型"
```

---

### Task 3: 主进程 IPC + preload(reveal/openWith/downloadCopy/listEditors)

**Files:**
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/index.ts`

**Interfaces:**
- Consumes: `detectEditors`/`uniqueDownloadName`(Task 2)、`EditorApp`。
- Produces(`WraithApi`):
  - `revealInFinder(path: string): Promise<void>`
  - `openWithApp(path: string, appPath: string): Promise<void>`
  - `downloadCopy(path: string): Promise<string>`(返回 Downloads 里的目标绝对路径)
  - `listEditors(): Promise<EditorApp[]>`

- [ ] **Step 1: 主进程加 4 个 handler**

在 `desktop/src/main/index.ts`:import 区加(与其它 import 同处):
```ts
import { detectEditors, uniqueDownloadName } from './fileOpen'
import type { EditorApp } from '../shared/editors'
```
在现有 `ipcMain.handle('wraith:openPath', ...)`(约 L1351)之后追加:
```ts
ipcMain.handle('wraith:revealInFinder', (_e, p: string) => { shell.showItemInFolder(p) })
ipcMain.handle('wraith:openWithApp', (_e, p: string, appPath: string) => {
  // appPath 必须是真实 .app(来自 listEditors);不接受任意路径,防任意程序执行
  if (!appPath.endsWith('.app') || !fs.existsSync(appPath)) throw new Error('无效的应用')
  spawn('open', ['-a', appPath, p], { stdio: 'ignore', detached: true }).unref()
})
ipcMain.handle('wraith:downloadCopy', async (_e, p: string): Promise<string> => {
  const downloads = path.join(os.homedir(), 'Downloads')
  await fs.promises.mkdir(downloads, { recursive: true })
  const existing = new Set(await fs.promises.readdir(downloads).catch(() => [] as string[]))
  const dest = path.join(downloads, uniqueDownloadName(existing, path.basename(p)))
  await fs.promises.copyFile(p, dest)
  shell.showItemInFolder(dest)
  return dest
})
let editorsCache: EditorApp[] | null = null
ipcMain.handle('wraith:listEditors', (): EditorApp[] => {
  if (editorsCache) return editorsCache
  const dirs = ['/Applications', path.join(os.homedir(), 'Applications')]
  const appPaths: string[] = []
  for (const d of dirs) {
    try { for (const n of fs.readdirSync(d)) if (n.endsWith('.app')) appPaths.push(path.join(d, n)) }
    catch { /* 目录不存在,跳过 */ }
  }
  editorsCache = detectEditors(appPaths)
  return editorsCache
})
```

- [ ] **Step 2: preload 加类型 + 实现**

在 `desktop/src/preload/index.ts`:import 区加 `import type { EditorApp } from '../shared/editors'`。
在 `WraithApi` 接口里(`petsPreview` 或 `openPath` 附近)加:
```ts
  revealInFinder(path: string): Promise<void>
  openWithApp(path: string, appPath: string): Promise<void>
  downloadCopy(path: string): Promise<string>
  listEditors(): Promise<EditorApp[]>
```
在 `const wraith: WraithApi = { ... }` 里(`openPath` 实现附近)加:
```ts
  revealInFinder(p) { return ipcRenderer.invoke('wraith:revealInFinder', p) as Promise<void> },
  openWithApp(p, appPath) { return ipcRenderer.invoke('wraith:openWithApp', p, appPath) as Promise<void> },
  downloadCopy(p) { return ipcRenderer.invoke('wraith:downloadCopy', p) as Promise<string> },
  listEditors() { return ipcRenderer.invoke('wraith:listEditors') as Promise<EditorApp[]> },
```

- [ ] **Step 3: tsc**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无输出(WraithApi 接口与实现对齐;main 引用的 fileOpen/EditorApp 解析)。

- [ ] **Step 4: 全量回归(确认无破坏)**

Run: `cd desktop && npx vitest run`
Expected: 全绿(本任务不加测试;主进程 IPC 靠 tsc + Task 2 纯函数测试覆盖逻辑,真实 IPC 走后续手动眼验)。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/main/index.ts desktop/src/preload/index.ts
git commit -m "feat(desktop): 新增 revealInFinder/openWithApp/downloadCopy/listEditors IPC"
```

---

### Task 4: `FileArtifactCard` 组件

**Files:**
- Create: `desktop/src/renderer/components/FileArtifactCard.tsx`
- Test: `desktop/test/fileArtifactCard.test.tsx`

**Interfaces:**
- Consumes: `fileTypeLabel`(Task 1)、`resolveWorkspacePath`(Task 1)、`baseName`、`ArtifactFile`、`EditorApp`、`window.wraith.{openPath,revealInFinder,openWithApp,downloadCopy}`(Task 3)、`ui/popover`。
- Produces:
  - `export function OpenWithMenu(props: { file: ArtifactFile; workspace: string | null; editors: EditorApp[]; onAction?: () => void }): JSX.Element` —— 菜单按钮列表(**不含 Radix**,可直接渲染单测);各项走绝对路径调 `window.wraith.*`,点后调 `onAction?.()`(供关 popover)。
  - `export default function FileArtifactCard(props: { file: ArtifactFile; workspace: string | null; editors: EditorApp[]; onOpenPreview: (filePath: string, content: string) => void }): JSX.Element` —— 卡体 + Radix `ui/popover` 包 `OpenWithMenu`。
- **测试策略**:本仓库 jsdom 无 Radix popover 打开先例/无 pointer polyfill,故**不测 Radix 开合**——直接渲染 `OpenWithMenu` 测菜单项与回调,直接渲染 `FileArtifactCard` 测卡体与预览点击(popover 开合走 Task 5 手动眼验)。

- [ ] **Step 1: 写失败测试**

Create `desktop/test/fileArtifactCard.test.tsx`(**不测 Radix 开合**:直接渲染 `OpenWithMenu` 测菜单,直接渲染 `FileArtifactCard` 测卡体):
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import FileArtifactCard, { OpenWithMenu } from '../src/renderer/components/FileArtifactCard'
import type { ArtifactFile } from '../src/shared/artifactSummary'
import type { EditorApp } from '../src/shared/editors'

const file: ArtifactFile = { path: 'sub/README.md', kind: 'created', content: '你好' }
const editors: EditorApp[] = [{ name: 'VS Code', appPath: '/Applications/Visual Studio Code.app' }]

function mockWraith() {
  const w = {
    openPath: vi.fn(() => Promise.resolve()),
    revealInFinder: vi.fn(() => Promise.resolve()),
    openWithApp: vi.fn(() => Promise.resolve()),
    downloadCopy: vi.fn(() => Promise.resolve('/Users/x/Downloads/README.md')),
  }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = w
  return w
}

beforeEach(() => mockWraith())
afterEach(() => cleanup())

describe('FileArtifactCard', () => {
  it('显示文件名 baseName + 类型标签', () => {
    render(<FileArtifactCard file={file} workspace="/proj" editors={editors} onOpenPreview={vi.fn()} />)
    expect(screen.getByText('README.md')).toBeTruthy()
    expect(screen.getByText('文档 · MD')).toBeTruthy()
  })

  it('点文件名 → onOpenPreview(path, content)', () => {
    const onOpenPreview = vi.fn()
    render(<FileArtifactCard file={file} workspace="/proj" editors={editors} onOpenPreview={onOpenPreview} />)
    fireEvent.click(screen.getByTestId('file-artifact-open-preview'))
    expect(onOpenPreview).toHaveBeenCalledWith('sub/README.md', '你好')
  })
})

describe('OpenWithMenu', () => {
  it('默认/编辑器/Finder/下载 用绝对路径调对应 IPC', () => {
    const w = mockWraith()
    render(<OpenWithMenu file={file} workspace="/proj" editors={editors} />)
    fireEvent.click(screen.getByTestId('openwith-default'))
    expect(w.openPath).toHaveBeenCalledWith('/proj/sub/README.md')
    fireEvent.click(screen.getByTestId('openwith-editor'))
    expect(w.openWithApp).toHaveBeenCalledWith('/proj/sub/README.md', '/Applications/Visual Studio Code.app')
    fireEvent.click(screen.getByTestId('openwith-reveal'))
    expect(w.revealInFinder).toHaveBeenCalledWith('/proj/sub/README.md')
    fireEvent.click(screen.getByTestId('openwith-download'))
    expect(w.downloadCopy).toHaveBeenCalledWith('/proj/sub/README.md')
  })

  it('editors 为空时只有固定项(默认/Finder/下载)', () => {
    render(<OpenWithMenu file={file} workspace="/proj" editors={[]} />)
    expect(screen.queryByTestId('openwith-editor')).toBeNull()
    expect(screen.getByTestId('openwith-default')).toBeTruthy()
    expect(screen.getByTestId('openwith-reveal')).toBeTruthy()
    expect(screen.getByTestId('openwith-download')).toBeTruthy()
  })

  it('onAction 在点击后被调(供关闭 popover)', () => {
    const onAction = vi.fn()
    render(<OpenWithMenu file={file} workspace="/proj" editors={editors} onAction={onAction} />)
    fireEvent.click(screen.getByTestId('openwith-default'))
    expect(onAction).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/fileArtifactCard.test.tsx` → FAIL(模块不存在)。

- [ ] **Step 3: 实现**

Create `desktop/src/renderer/components/FileArtifactCard.tsx`:
```tsx
import { useState } from 'react'
import { ChevronDown, Download, FileText, FolderOpen } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { baseName, resolveWorkspacePath } from '../lib/paths'
import { fileTypeLabel } from '../lib/fileType'
import type { ArtifactFile } from '../../shared/artifactSummary'
import type { EditorApp } from '../../shared/editors'

const ITEM = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60'

/**
 * 「打开方式」菜单项列表(不含 Radix,可直接渲染单测)。各项走绝对路径调 window.wraith 的 IPC;
 * 点击后调 onAction?.()(供外层关 popover)。editors 为空时只剩固定项。
 */
export function OpenWithMenu({ file, workspace, editors, onAction }: {
  file: ArtifactFile
  workspace: string | null
  editors: EditorApp[]
  onAction?: () => void
}): JSX.Element {
  const abs = resolveWorkspacePath(file.path, workspace)
  const run = (fn: () => Promise<unknown>): void => { onAction?.(); void fn().catch(() => {}) }
  return (
    <>
      <button data-testid="openwith-default" className={ITEM} onClick={() => run(() => window.wraith.openPath(abs))}>默认程序</button>
      {editors.map(ed => (
        <button key={ed.appPath} data-testid="openwith-editor" className={ITEM}
          onClick={() => run(() => window.wraith.openWithApp(abs, ed.appPath))}>{ed.name}</button>
      ))}
      <div className="my-1 border-t border-border/60" />
      <button data-testid="openwith-reveal" className={ITEM} onClick={() => run(() => window.wraith.revealInFinder(abs))}>
        <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />在 Finder 中显示
      </button>
      <button data-testid="openwith-download" className={ITEM} onClick={() => run(() => window.wraith.downloadCopy(abs))}>
        <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />下载副本
      </button>
    </>
  )
}

/**
 * 回复下方的文件产物卡:文件名 + 类型标签 + 「打开方式」下拉(Radix popover 包 OpenWithMenu)。
 * 点卡体 → 右侧内容预览(onOpenPreview,in-app,用原 path+content)。
 */
export default function FileArtifactCard({ file, workspace, editors, onOpenPreview }: {
  file: ArtifactFile
  workspace: string | null
  editors: EditorApp[]
  onOpenPreview: (filePath: string, content: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div data-testid="file-artifact-card" className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <FileText className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.5} />
      <button
        data-testid="file-artifact-open-preview"
        onClick={() => onOpenPreview(file.path, file.content)}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
      >
        <span className="max-w-full truncate text-sm font-medium text-fg" title={file.path}>{baseName(file.path)}</span>
        <span className="text-2xs text-fg-subtle">{fileTypeLabel(file.path)}</span>
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            data-testid="file-artifact-openwith"
            className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent"
          >打开方式 <ChevronDown className="h-3 w-3" strokeWidth={1.5} /></button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52">
          <OpenWithMenu file={file} workspace={workspace} editors={editors} onAction={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
```

- [ ] **Step 4: 跑测试 + tsc**

Run: `cd desktop && npx vitest run test/fileArtifactCard.test.tsx` → PASS(FileArtifactCard 2 + OpenWithMenu 3 = 5 用例)。
Run: `cd desktop && npx tsc --noEmit` → 无输出。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/components/FileArtifactCard.tsx desktop/test/fileArtifactCard.test.tsx
git commit -m "feat(desktop): FileArtifactCard — 文件产物卡 + 打开方式下拉"
```

---

### Task 5: App editors/workspace → Transcript 用 FileArtifactCard 取代 ArtifactChips

**Files:**
- Modify: `desktop/src/renderer/App.tsx`
- Modify: `desktop/src/renderer/components/Transcript.tsx`
- Delete: `desktop/src/renderer/components/ArtifactChips.tsx`
- Delete: `desktop/test/artifactChips.test.tsx`

**Interfaces:**
- Consumes: `FileArtifactCard`(Task 4)、`window.wraith.listEditors`(Task 3)、`EditorApp`、App 现有 `openArtifact`、`state.workspace`。

- [ ] **Step 1: App 拉 editors + 传给 Transcript**

在 `desktop/src/renderer/App.tsx`:import 区加 `import type { EditorApp } from '../shared/editors'`。
在状态区(`previewArtifact` 附近,约 L176)加:
```ts
  const [editors, setEditors] = useState<EditorApp[]>([])
  useEffect(() => { void window.wraith.listEditors().then(setEditors).catch(() => {}) }, [])
```
给 `<Transcript ... />`(约 L1090,`onOpenArtifact={openArtifact}` 那处)加两个 prop:
```tsx
                      editors={editors}
                      workspace={state.workspace ?? null}
```

- [ ] **Step 2: Transcript 用 FileArtifactCard**

在 `desktop/src/renderer/components/Transcript.tsx`:
- import:把 `import ArtifactChips from './ArtifactChips'` 换成:
```tsx
import FileArtifactCard from './FileArtifactCard'
import type { EditorApp } from '../../shared/editors'
```
- `TranscriptProps` 加两个可选 prop:
```tsx
  editors?: EditorApp[]
  workspace?: string | null
```
- 函数解构参数把 `onOpenArtifact` 后加 `, editors, workspace`。
- 把渲染 chips 那行(约 L97):
```tsx
              {chips && onOpenArtifact && <ArtifactChips files={chips} onOpenArtifact={onOpenArtifact} />}
```
替换为:
```tsx
              {chips && onOpenArtifact && (
                <div className="flex gap-2.5">
                  <div className="w-6 shrink-0" aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    {chips.map(f => (
                      <FileArtifactCard key={f.path} file={f} workspace={workspace ?? null} editors={editors ?? []} onOpenPreview={onOpenArtifact} />
                    ))}
                  </div>
                </div>
              )}
```

- [ ] **Step 3: 删除 ArtifactChips 及其测试**

```bash
cd /Users/aa00945/Desktop/wraith
git rm desktop/src/renderer/components/ArtifactChips.tsx desktop/test/artifactChips.test.tsx
```

- [ ] **Step 4: tsc + 全量回归**

Run: `cd desktop && npx tsc --noEmit` → 无输出(确认无残留 ArtifactChips 引用)。
Run: `cd desktop && npx vitest run` → 全绿(artifactChips 测试已删;fileArtifactCard/fileType/fileOpen 新测试在;无回归)。

- [ ] **Step 5: 手动眼验(dev)**

⚠️ 本子项含主进程 + preload 改动 → **重启 dev App**(不是 HMR)。发"生成 readme"→ 回复下方出现文件卡(文件名 + `文档 · MD` + 「打开方式」);点文件名进右侧预览;「打开方式」列出 默认程序 + 已装编辑器 + 在 Finder 显示 + 下载副本,各项能真的打开/揭示/复制到 Downloads。

- [ ] **Step 6: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/App.tsx desktop/src/renderer/components/Transcript.tsx
git commit -m "feat(desktop): 回复下方改用 FileArtifactCard(取代 ArtifactChips)+ App 拉 editors"
```

---

## 自查(spec 覆盖)

- 文件卡(名+类型+打开方式):Task 4 FileArtifactCard ✓
- 打开方式(默认/编辑器/Finder/下载):Task 3 IPC + Task 4 菜单 ✓
- 编辑器自动探测:Task 2 detectEditors + Task 3 listEditors handler ✓
- 点卡进内容预览(保留):Task 4 onOpenPreview → App openArtifact ✓
- 相对路径解析绝对:Task 1 resolveWorkspacePath + Task 4 用它 ✓
- openWithApp 只接受真实 .app:Task 3 校验 ✓
- 取代并移除 ArtifactChips:Task 5 ✓
- 类型/命名一致:`EditorApp`/`fileTypeLabel`/`resolveWorkspacePath`/`detectEditors`/`FileArtifactCard`/`onOpenPreview` 跨任务一致 ✓
- macOS-only openWith / 无需 jar:Global Constraints ✓
