# 已编辑文件卡 — 查看更改/审核/撤销 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把回复下方"被改文件"呈现为统一卡(新建/已编辑 + 查看更改/审核/撤销 + 打开方式),查看更改/审核→右侧 diff,撤销→文件级写回 before。

**Architecture:** 纯桌面(Electron renderer + 主进程),零 Java/零 jar。数据层给 `ArtifactFile` 加 `before`;右侧「预览」段升级为 `内容 | diff` 判别联合;撤销经主进程新 IPC 落盘并独立校验工作区路径。

**Tech Stack:** TypeScript / React / Electron / vitest + @testing-library/react(jsdom)/ Radix Popover / Monaco DiffView。

## Global Constraints

- 仅改桌面 `desktop/`,**不改 Java 后端、不重打 jar**。主进程/preload 改动 → 需重启 dev App(无 HMR)。
- 每个任务只 `git add` 该任务涉及的具体文件,**绝不 `git add .`**;绝不碰 WIP:`README.md`、`demo/pom.xml`、`.claude/settings.json`、`demo/src/Hello.java`、`progress.md`、`.superpowers/`。
- 提交信息结尾附:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 与 `Claude-Session: https://claude.ai/code/session_01E6qtyEJFHAxiMsCSKsjpQh`。
- 撤销是破坏性写:主进程用 `resolvePersistedWorkspace(app.getPath('userData'))` 取工作区,`isPathWithinWorkspace` 为真才动手,`before` 5MB 上限;**绝不信任 renderer 传入的绝对路径**。
- 审核 与 查看更改 v1 **同行为**(都开右侧 diff),保留双入口对齐 #61,非疏漏。
- `before === null`(仅 no-op 重写、无 diff)→ 查看更改/审核/撤销 一律不渲染(本就无变化)。
- 测试运行:`cd desktop && npx vitest run <file>`(单文件)/ `npx vitest run`(全量);类型:`npx tsc --noEmit`。
- macOS-only;不处理 Windows 路径细节。

---

### Task 1: `ArtifactFile.before` + deriveFiles 合并 + 修所有 fixture

**Files:**
- Modify: `desktop/src/shared/artifactSummary.ts`
- Test: `desktop/test/artifactSummary.test.ts`、`desktop/test/filesUnderMessages.test.ts`、`desktop/test/summaryPopover.test.tsx`、`desktop/test/fileArtifactCard.test.tsx`

**Interfaces:**
- Produces: `interface ArtifactFile { path: string; kind: 'created' | 'modified'; content: string; before: string | null }`;`deriveFiles`/`filesUnderMessages` 返回带 `before` 的对象。
- Consumes: 无(数据层基座)。

- [ ] **Step 1: 更新测试断言(先失败)** — `artifactSummary.test.ts` 里所有 `.files` / `deriveFiles` 的 `toEqual` 补 `before`:
  - L17 → `{ path: 'README.md', kind: 'created', content: '你好2', before: '' }`
  - L18 → `{ path: 'src/a.ts', kind: 'modified', content: 'new', before: 'old' }`
  - L27 → `{ path: 'README.md', kind: 'modified', content: '你好', before: null }`
  - L37 → `[{ path: 'a.txt', kind: 'modified', content: 'v2', before: 'v1' }]`
  - L45 → `{ path: 'new.md', kind: 'created', content: 'x', before: '' }`
  - L153 → `[{ path: 'a.md', kind: 'modified', content: 'v2', before: null }]`
  - L161 → `[{ path: 'new.md', kind: 'created', content: 'x', before: '' }]`
  （L52、L168、L172 为空数组,不改。）
  `filesUnderMessages.test.ts` 全部经 `wf`(write_file only)构造 → 每个断言对象补 `before: null`(L15、L21、L22、L29、L30、L47、L52)。
  `summaryPopover.test.tsx` L13 输入 fixture:created 补 `before: ''`、modified 补 `before: null`。
  `fileArtifactCard.test.tsx` L8 `const file` 补 `before: ''`(Task 5 会重写此文件,此处仅让其编译)。

- [ ] **Step 2: 运行确认失败** — `cd desktop && npx vitest run test/artifactSummary.test.ts`
  Expected: FAIL(实际对象缺 `before`,或 TS 报 `before` 不存在于 ArtifactFile)。

- [ ] **Step 3: 加字段 + 改 deriveFiles** — `artifactSummary.ts`:
  接口(第 7 行)改为:
  ```ts
  export interface ArtifactFile { path: string; kind: 'created' | 'modified'; content: string; before: string | null }
  ```
  `deriveFiles` 的两个分支改为(before:diff 权威、首个非 null 胜出;content 取最新;kind created 不降级):
  ```ts
  export function deriveFiles(items: readonly Item[]): ArtifactFile[] {
    const files = new Map<string, ArtifactFile>()
    for (const item of items) {
      if (item.type === 'diff') {
        if (item.filePath) {
          const existing = files.get(item.filePath)
          const created = item.before === '' || existing?.kind === 'created'
          const before = existing?.before != null ? existing.before : item.before
          files.set(item.filePath, { path: item.filePath, kind: created ? 'created' : 'modified', content: item.after, before })
        }
      } else if (item.type === 'tool') {
        const wf = writeFileArgs(item.card)
        if (wf) {
          const existing = files.get(wf.path)
          files.set(wf.path, existing ? { ...existing, content: wf.content } : { path: wf.path, kind: 'modified', content: wf.content, before: null })
        }
      }
    }
    return [...files.values()]
  }
  ```

- [ ] **Step 4: 运行全部相关测试** — `cd desktop && npx vitest run test/artifactSummary.test.ts test/filesUnderMessages.test.ts test/summaryPopover.test.tsx && npx tsc --noEmit`
  Expected: PASS + tsc 无错。

- [ ] **Step 5: Commit**
  ```bash
  git add desktop/src/shared/artifactSummary.ts desktop/test/artifactSummary.test.ts desktop/test/filesUnderMessages.test.ts desktop/test/summaryPopover.test.tsx desktop/test/fileArtifactCard.test.tsx
  git commit -m "feat(desktop): ArtifactFile.before 贯通 deriveFiles(diff 定 before,写回撤销/diff 预览用)"
  ```

---

### Task 2: `isPathWithinWorkspace` 纯函数

**Files:**
- Modify: `desktop/src/main/fileOpen.ts`(已有 `detectEditors`/`uniqueDownloadName`)
- Test: `desktop/test/fileOpen.test.ts`(已存在,追加)

**Interfaces:**
- Produces: `export function isPathWithinWorkspace(target: string, workspace: string): boolean`
- Consumes: 无。

- [ ] **Step 1: 写失败测试** — 追加到 `fileOpen.test.ts`:
  ```ts
  import { isPathWithinWorkspace } from '../src/main/fileOpen'

  describe('isPathWithinWorkspace', () => {
    it('工作区内文件 → true', () => {
      expect(isPathWithinWorkspace('/proj/src/a.ts', '/proj')).toBe(true)
    })
    it('工作区自身 → true', () => {
      expect(isPathWithinWorkspace('/proj', '/proj')).toBe(true)
    })
    it('../ 逃逸 → false', () => {
      expect(isPathWithinWorkspace('/proj/../etc/passwd', '/proj')).toBe(false)
    })
    it('完全在外 → false', () => {
      expect(isPathWithinWorkspace('/other/x', '/proj')).toBe(false)
    })
    it('workspace 为空 → false', () => {
      expect(isPathWithinWorkspace('/proj/a', '')).toBe(false)
    })
  })
  ```

- [ ] **Step 2: 运行确认失败** — `cd desktop && npx vitest run test/fileOpen.test.ts`
  Expected: FAIL(`isPathWithinWorkspace` 未导出)。

- [ ] **Step 3: 实现** — `fileOpen.ts` 顶部确保 `import path from 'node:path'`(若已用 path 则复用),追加:
  ```ts
  /** target 是否等于或位于 workspace 之下(归一化后 path.relative 不以 .. 开头且非绝对)。workspace 空 → false。 */
  export function isPathWithinWorkspace(target: string, workspace: string): boolean {
    if (!workspace) return false
    const rel = path.relative(path.resolve(workspace), path.resolve(target))
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  }
  ```

- [ ] **Step 4: 运行确认通过** — `cd desktop && npx vitest run test/fileOpen.test.ts`
  Expected: PASS。

- [ ] **Step 5: Commit**
  ```bash
  git add desktop/src/main/fileOpen.ts desktop/test/fileOpen.test.ts
  git commit -m "feat(desktop): isPathWithinWorkspace 纯函数(撤销写回路径校验)"
  ```

---

### Task 3: `performUndo` + `undoFileEdit` IPC + preload

**Files:**
- Modify: `desktop/src/main/fileOpen.ts`(加 `performUndo`)、`desktop/src/main/index.ts`(加 handler)、`desktop/src/preload/index.ts`(暴露)
- Test: `desktop/test/fileOpen.test.ts`(追加,真实临时目录)

**Interfaces:**
- Consumes: `isPathWithinWorkspace`(Task 2)。
- Produces:
  - `export async function performUndo(req: { workspace: string | null; path: string; before: string; kind: 'created' | 'modified' }): Promise<{ ok: boolean; message?: string }>`
  - IPC `wraith:undoFileEdit`;preload `undoFileEdit(payload: { path: string; before: string; kind: 'created' | 'modified' }): Promise<{ ok: boolean; message?: string }>`

- [ ] **Step 1: 写失败测试** — 追加到 `fileOpen.test.ts`(顶部补 `import fs from 'node:fs'`、`import os from 'node:os'`、`import path from 'node:path'`、`import { performUndo } from '../src/main/fileOpen'`):
  ```ts
  describe('performUndo', () => {
    const mk = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-undo-'))

    it('modified → 写回 before', async () => {
      const ws = mk(); const f = path.join(ws, 'a.md')
      fs.writeFileSync(f, '新内容')
      const r = await performUndo({ workspace: ws, path: f, before: '旧内容', kind: 'modified' })
      expect(r.ok).toBe(true)
      expect(fs.readFileSync(f, 'utf8')).toBe('旧内容')
    })

    it('created → 删除文件', async () => {
      const ws = mk(); const f = path.join(ws, 'new.md')
      fs.writeFileSync(f, 'x')
      const r = await performUndo({ workspace: ws, path: f, before: '', kind: 'created' })
      expect(r.ok).toBe(true)
      expect(fs.existsSync(f)).toBe(false)
    })

    it('越界路径 → ok:false 且不动手', async () => {
      const ws = mk()
      const outside = path.join(os.tmpdir(), 'wraith-outside.md')
      fs.writeFileSync(outside, 'keep')
      const r = await performUndo({ workspace: ws, path: outside, before: 'x', kind: 'modified' })
      expect(r.ok).toBe(false)
      expect(fs.readFileSync(outside, 'utf8')).toBe('keep')
    })

    it('workspace 为空 → ok:false', async () => {
      const r = await performUndo({ workspace: null, path: '/x', before: '', kind: 'modified' })
      expect(r.ok).toBe(false)
    })

    it('before 超 5MB → ok:false', async () => {
      const ws = mk(); const f = path.join(ws, 'big.txt')
      fs.writeFileSync(f, 'small')
      const r = await performUndo({ workspace: ws, path: f, before: 'a'.repeat(5 * 1024 * 1024 + 1), kind: 'modified' })
      expect(r.ok).toBe(false)
    })
  })
  ```

- [ ] **Step 2: 运行确认失败** — `cd desktop && npx vitest run test/fileOpen.test.ts`
  Expected: FAIL(`performUndo` 未导出)。

- [ ] **Step 3: 实现 performUndo** — `fileOpen.ts` 追加(确保 `import fs from 'node:fs'`):
  ```ts
  /** 文件级撤销:modified 写回 before;created 删除。路径必须在工作区内、before ≤ 5MB。破坏性写,绝不信任调用方路径。 */
  export async function performUndo(
    req: { workspace: string | null; path: string; before: string; kind: 'created' | 'modified' },
  ): Promise<{ ok: boolean; message?: string }> {
    if (!req.workspace) return { ok: false, message: '无工作区' }
    if (!isPathWithinWorkspace(req.path, req.workspace)) return { ok: false, message: '路径超出工作区' }
    if (Buffer.byteLength(req.before, 'utf8') > 5 * 1024 * 1024) return { ok: false, message: '内容超过 5MB' }
    try {
      if (req.kind === 'created') await fs.promises.rm(req.path, { force: true })
      else await fs.promises.writeFile(req.path, req.before, 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }
  ```

- [ ] **Step 4: 运行确认通过** — `cd desktop && npx vitest run test/fileOpen.test.ts`
  Expected: PASS。

- [ ] **Step 5: 接 IPC handler** — `main/index.ts`,在 `wraith:listEditors`(约 L1385)之后加(`performUndo` 加入既有 `./fileOpen` import;`resolvePersistedWorkspace` 与 `app` 已 import):
  ```ts
  ipcMain.handle('wraith:undoFileEdit', async (_e, payload: { path: string; before: string; kind: 'created' | 'modified' }): Promise<{ ok: boolean; message?: string }> => {
    const ws = resolvePersistedWorkspace(app.getPath('userData'))
    return performUndo({ workspace: ws, path: payload.path, before: payload.before, kind: payload.kind })
  })
  ```
  改 import(L51):`import { detectEditors, uniqueDownloadName, performUndo } from './fileOpen'`。

- [ ] **Step 6: preload 暴露** — `preload/index.ts`,接口区(约 L140,`listEditors` 后)加:
  ```ts
  undoFileEdit(payload: { path: string; before: string; kind: 'created' | 'modified' }): Promise<{ ok: boolean; message?: string }>
  ```
  实现区(约 L586,`listEditors` 后)加:
  ```ts
  undoFileEdit(payload) { return ipcRenderer.invoke('wraith:undoFileEdit', payload) as Promise<{ ok: boolean; message?: string }> },
  ```

- [ ] **Step 7: 类型 + 全量** — `cd desktop && npx tsc --noEmit && npx vitest run test/fileOpen.test.ts`
  Expected: 无 TS 错、PASS。

- [ ] **Step 8: Commit**
  ```bash
  git add desktop/src/main/fileOpen.ts desktop/src/main/index.ts desktop/src/preload/index.ts desktop/test/fileOpen.test.ts
  git commit -m "feat(desktop): undoFileEdit IPC — 文件级写回 before(主进程独立校验工作区路径)"
  ```

---

### Task 4: `RightPreview` 联合 + `PreviewPane` + RightDock 委托 + App 右侧态

**Files:**
- Modify: `desktop/src/shared/artifactSummary.ts`(加 `RightPreview`)、`desktop/src/renderer/components/RightDock.tsx`、`desktop/src/renderer/App.tsx`
- Create: `desktop/src/renderer/components/PreviewPane.tsx`
- Test: `desktop/test/previewPane.test.tsx`

**Interfaces:**
- Consumes: `PreviewArtifact`(现有)、`ArtifactPreview`、`DiffView`、`baseName`。
- Produces:
  - `export type RightPreview = ({ kind: 'content' } & PreviewArtifact) | { kind: 'diff'; filePath: string; before: string; after: string }`
  - `PreviewPane({ preview }: { preview: RightPreview | null })`
  - App 暴露 `openArtifact(filePath, content)`(签名不变)与 `openDiff(filePath, before, after)`。

- [ ] **Step 1: 加 RightPreview 类型** — `artifactSummary.ts`,在 `PreviewArtifact` 定义后加:
  ```ts
  /** 右侧「预览」段内容:完整内容 或 diff。 */
  export type RightPreview =
    | ({ kind: 'content' } & PreviewArtifact)
    | { kind: 'diff'; filePath: string; before: string; after: string }
  ```

- [ ] **Step 2: 写 PreviewPane 失败测试** — `desktop/test/previewPane.test.tsx`:
  ```tsx
  // @vitest-environment jsdom
  import { describe, it, expect, afterEach } from 'vitest'
  import { render, screen, cleanup } from '@testing-library/react'
  import PreviewPane from '../src/renderer/components/PreviewPane'

  afterEach(() => cleanup())

  describe('PreviewPane', () => {
    it('null → 占位', () => {
      render(<PreviewPane preview={null} />)
      expect(screen.getByText(/点击产物文件/)).toBeTruthy()
    })
    it('content → 渲染 ArtifactPreview(文件名)', () => {
      render(<PreviewPane preview={{ kind: 'content', filePath: 'sub/a.md', content: '# 标题' }} />)
      expect(screen.getByText('a.md')).toBeTruthy()
    })
    it('diff → 渲染 diff-preview 容器', () => {
      render(<PreviewPane preview={{ kind: 'diff', filePath: 'sub/a.ts', before: 'x', after: 'y' }} />)
      expect(screen.getByTestId('diff-preview')).toBeTruthy()
    })
  })
  ```

- [ ] **Step 3: 运行确认失败** — `cd desktop && npx vitest run test/previewPane.test.tsx`
  Expected: FAIL(PreviewPane 不存在)。

- [ ] **Step 4: 实现 PreviewPane** — `desktop/src/renderer/components/PreviewPane.tsx`:
  ```tsx
  import ArtifactPreview from './ArtifactPreview'
  import DiffView from './DiffView'
  import { baseName } from '../lib/paths'
  import type { RightPreview } from '../../shared/artifactSummary'

  /** 右侧「预览」段:null→占位;content→完整内容;diff→只读 DiffView。 */
  export default function PreviewPane({ preview }: { preview: RightPreview | null }): JSX.Element {
    if (preview == null) return <div className="p-3 text-xs text-fg-subtle">点击产物文件在此预览完整内容。</div>
    if (preview.kind === 'content') return <ArtifactPreview filePath={preview.filePath} content={preview.content} />
    return (
      <div data-testid="diff-preview" className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-fg">
          <span className="truncate font-mono font-semibold" title={preview.filePath}>{baseName(preview.filePath)}</span>
          <span className="shrink-0 text-2xs font-normal text-fg-subtle">· 更改</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <DiffView filePath={preview.filePath} before={preview.before} after={preview.after} />
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 5: 运行确认通过** — `cd desktop && npx vitest run test/previewPane.test.tsx`
  Expected: PASS。

- [ ] **Step 6: RightDock 委托 PreviewPane** — `RightDock.tsx`:
  - 删 `import ArtifactPreview from './ArtifactPreview'`,改为 `import PreviewPane from './PreviewPane'`;
  - import 类型:`import type { RightPreview } from '../../shared/artifactSummary'`(替换 `PreviewArtifact`);
  - props:`artifact: PreviewArtifact | null` → `preview: RightPreview | null`(同时改解构 `...compactDisabled, preview }`);
  - 'artifact' pane 正文(约 L82-86)整段替换为:
  ```tsx
  <div className={'absolute inset-0 flex flex-col ' + (pane === 'artifact' ? '' : 'hidden')}>
    <PreviewPane preview={preview} />
  </div>
  ```

- [ ] **Step 7: App 右侧态升级** — `App.tsx`:
  - import(L4):`import type { RightPreview } from '../shared/artifactSummary'`(替换 `PreviewArtifact`;若他处仍用 PreviewArtifact 则并留);
  - L178-183 替换:
  ```tsx
  const [rightPreview, setRightPreview] = useState<RightPreview | null>(null)
  const openArtifact = useCallback((filePath: string, content: string): void => {
    setRightPreview({ kind: 'content', filePath, content })
    setRightDockPane('artifact')
    setRightDockOpen(true)
  }, [])
  const openDiff = useCallback((filePath: string, before: string, after: string): void => {
    setRightPreview({ kind: 'diff', filePath, before, after })
    setRightDockPane('artifact')
    setRightDockOpen(true)
  }, [])
  ```
  - L858 `setPreviewArtifact(null)` → `setRightPreview(null)`;
  - RightDock 用法(L1121)`artifact={previewArtifact}` → `preview={rightPreview}`。

- [ ] **Step 8: 类型 + 全量** — `cd desktop && npx tsc --noEmit && npx vitest run`
  Expected: 无 TS 错、全绿。

- [ ] **Step 9: Commit**
  ```bash
  git add desktop/src/shared/artifactSummary.ts desktop/src/renderer/components/PreviewPane.tsx desktop/src/renderer/components/RightDock.tsx desktop/src/renderer/App.tsx desktop/test/previewPane.test.tsx
  git commit -m "feat(desktop): 右侧预览段升级为 内容|diff 联合 + PreviewPane + App openDiff"
  ```

---

### Task 5: 抽出 OpenWithMenu + 重写 FileArtifactCard 为统一卡

**Files:**
- Create: `desktop/src/renderer/components/OpenWithMenu.tsx`
- Modify: `desktop/src/renderer/components/FileArtifactCard.tsx`(重写)
- Test: `desktop/test/fileArtifactCard.test.tsx`(重写)

**Interfaces:**
- Consumes: `ArtifactFile`(带 `before`,Task 1)、`EditorApp`、`resolveWorkspacePath`、`baseName`、`fileTypeLabel`。
- Produces:
  - `export function OpenWithMenu(...)`(签名与现状一致,迁到新文件)
  - `FileArtifactCard` 新 props:`{ file; workspace; editors; onOpenPreview?; onOpenDiff?: (filePath, before, after) => void; onUndo?: (file: ArtifactFile) => Promise<boolean> }`
  - testid:`file-artifact-card`、`file-artifact-open-preview`、`file-artifact-viewdiff`、`file-artifact-review`、`file-artifact-undo`、`file-artifact-openwith`;OpenWithMenu 原 testid 不变。

- [ ] **Step 1: 抽 OpenWithMenu 到独立文件** — 新建 `OpenWithMenu.tsx`,把现 `FileArtifactCard.tsx` 第 1-39 行里的 `OpenWithMenu` 及其依赖(`ITEM` 常量、`Download`/`FolderOpen` from lucide、`resolveWorkspacePath` from `../lib/paths`、`ArtifactFile`/`EditorApp` 类型)原样迁入:
  ```tsx
  import { Download, FolderOpen } from 'lucide-react'
  import { resolveWorkspacePath } from '../lib/paths'
  import type { ArtifactFile } from '../../shared/artifactSummary'
  import type { EditorApp } from '../../shared/editors'

  const ITEM = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60'

  /** 「打开方式」菜单项(无 Radix,可直接单测)。各项走绝对路径调 window.wraith,点击后 onAction?.()。 */
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
        {editors.map((ed, i) => (
          <button key={ed.appPath} data-testid={`openwith-editor-${i}`} className={ITEM}
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
  ```

- [ ] **Step 2: 重写测试(先失败)** — `fileArtifactCard.test.tsx` 全量替换为:
  ```tsx
  // @vitest-environment jsdom
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
  import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
  import FileArtifactCard from '../src/renderer/components/FileArtifactCard'
  import { OpenWithMenu } from '../src/renderer/components/OpenWithMenu'
  import type { ArtifactFile } from '../src/shared/artifactSummary'
  import type { EditorApp } from '../src/shared/editors'

  const created: ArtifactFile = { path: 'sub/new.md', kind: 'created', content: '新', before: '' }
  const modified: ArtifactFile = { path: 'sub/a.ts', kind: 'modified', content: '新', before: '旧' }
  const noop: ArtifactFile = { path: 'sub/x.md', kind: 'modified', content: '同', before: null }
  const editors: EditorApp[] = [{ name: 'VS Code', appPath: '/Applications/Visual Studio Code.app' }]

  function mockWraith() {
    const w = {
      openPath: vi.fn(() => Promise.resolve()),
      revealInFinder: vi.fn(() => Promise.resolve()),
      openWithApp: vi.fn(() => Promise.resolve()),
      downloadCopy: vi.fn(() => Promise.resolve('/Users/x/Downloads/new.md')),
    }
    ;(window as unknown as { wraith: Record<string, unknown> }).wraith = w
    return w
  }

  beforeEach(() => mockWraith())
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  describe('FileArtifactCard 头部', () => {
    it('created → 新建 baseName', () => {
      render(<FileArtifactCard file={created} workspace="/proj" editors={editors} />)
      expect(screen.getByText(/新建 new\.md/)).toBeTruthy()
    })
    it('modified → 已编辑 baseName', () => {
      render(<FileArtifactCard file={modified} workspace="/proj" editors={editors} />)
      expect(screen.getByText(/已编辑 a\.ts/)).toBeTruthy()
    })
  })

  describe('查看更改 / 审核 → onOpenDiff(path, before, content)', () => {
    it('查看更改 与 审核 都以 (path, before, after) 调', () => {
      const onOpenDiff = vi.fn()
      render(<FileArtifactCard file={modified} workspace="/proj" editors={editors} onOpenDiff={onOpenDiff} />)
      fireEvent.click(screen.getByTestId('file-artifact-viewdiff'))
      expect(onOpenDiff).toHaveBeenCalledWith('sub/a.ts', '旧', '新')
      fireEvent.click(screen.getByTestId('file-artifact-review'))
      expect(onOpenDiff).toHaveBeenCalledTimes(2)
    })
    it('before===null → 无 查看更改/审核/撤销', () => {
      render(<FileArtifactCard file={noop} workspace="/proj" editors={editors} onOpenDiff={vi.fn()} onUndo={vi.fn()} />)
      expect(screen.queryByTestId('file-artifact-viewdiff')).toBeNull()
      expect(screen.queryByTestId('file-artifact-review')).toBeNull()
      expect(screen.queryByTestId('file-artifact-undo')).toBeNull()
    })
  })

  describe('撤销', () => {
    it('confirm 后调 onUndo(file),成功显示已撤销', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const onUndo = vi.fn(() => Promise.resolve(true))
      render(<FileArtifactCard file={modified} workspace="/proj" editors={editors} onUndo={onUndo} />)
      fireEvent.click(screen.getByTestId('file-artifact-undo'))
      expect(onUndo).toHaveBeenCalledWith(modified)
      await waitFor(() => expect(screen.getByText('已撤销')).toBeTruthy())
    })
    it('confirm 取消 → 不调 onUndo', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      const onUndo = vi.fn(() => Promise.resolve(true))
      render(<FileArtifactCard file={modified} workspace="/proj" editors={editors} onUndo={onUndo} />)
      fireEvent.click(screen.getByTestId('file-artifact-undo'))
      expect(onUndo).not.toHaveBeenCalled()
    })
  })

  describe('OpenWithMenu(抽出后)', () => {
    it('默认/编辑器/Finder/下载 用绝对路径调对应 IPC', () => {
      const w = mockWraith()
      render(<OpenWithMenu file={created} workspace="/proj" editors={editors} />)
      fireEvent.click(screen.getByTestId('openwith-default'))
      expect(w.openPath).toHaveBeenCalledWith('/proj/sub/new.md')
      fireEvent.click(screen.getByTestId('openwith-editor-0'))
      expect(w.openWithApp).toHaveBeenCalledWith('/proj/sub/new.md', '/Applications/Visual Studio Code.app')
      fireEvent.click(screen.getByTestId('openwith-reveal'))
      expect(w.revealInFinder).toHaveBeenCalledWith('/proj/sub/new.md')
      fireEvent.click(screen.getByTestId('openwith-download'))
      expect(w.downloadCopy).toHaveBeenCalledWith('/proj/sub/new.md')
    })
    it('editors 为空只有固定项', () => {
      render(<OpenWithMenu file={created} workspace="/proj" editors={[]} />)
      expect(screen.queryByTestId('openwith-editor-0')).toBeNull()
      expect(screen.getByTestId('openwith-default')).toBeTruthy()
    })
  })
  ```

- [ ] **Step 3: 运行确认失败** — `cd desktop && npx vitest run test/fileArtifactCard.test.tsx`
  Expected: FAIL(新卡未实现 / OpenWithMenu import 路径变更)。

- [ ] **Step 4: 重写 FileArtifactCard** — `FileArtifactCard.tsx` 全量替换为:
  ```tsx
  import { useState } from 'react'
  import { ChevronDown, FileDiff, FilePlus, RotateCcw } from 'lucide-react'
  import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
  import { baseName } from '../lib/paths'
  import { OpenWithMenu } from './OpenWithMenu'
  import type { ArtifactFile } from '../../shared/artifactSummary'
  import type { EditorApp } from '../../shared/editors'

  /**
   * 回复下方统一文件卡:新建/已编辑 + 查看更改/审核(→右侧 diff)+ 打开方式 + 撤销(文件级写回)。
   * before===null(仅 no-op 无 diff)→ 查看更改/审核/撤销 不渲染。撤销带 confirm,成功进「已撤销」态。
   */
  export default function FileArtifactCard({ file, workspace, editors, onOpenPreview, onOpenDiff, onUndo }: {
    file: ArtifactFile
    workspace: string | null
    editors: EditorApp[]
    onOpenPreview?: (filePath: string, content: string) => void
    onOpenDiff?: (filePath: string, before: string, after: string) => void
    onUndo?: (file: ArtifactFile) => Promise<boolean>
  }): JSX.Element {
    const [open, setOpen] = useState(false)
    const [undone, setUndone] = useState(false)
    const created = file.kind === 'created'
    const hasDiff = file.before !== null && !undone
    const doUndo = async (): Promise<void> => {
      if (!onUndo || file.before === null) return
      const name = baseName(file.path)
      if (!window.confirm(created ? `删除新建的 ${name}?` : `把 ${name} 恢复到编辑前?`)) return
      if (await onUndo(file)) setUndone(true)
    }
    return (
      <div data-testid="file-artifact-card" className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
        {created
          ? <FilePlus className="h-4 w-4 shrink-0 text-ok" strokeWidth={1.5} />
          : <FileDiff className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.5} />}
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <button data-testid="file-artifact-open-preview" onClick={() => onOpenPreview?.(file.path, file.content)}
            className="max-w-full truncate text-left text-sm font-medium text-fg" title={file.path}>
            {created ? '新建 ' : '已编辑 '}{baseName(file.path)}
          </button>
          {hasDiff && onOpenDiff && (
            <button data-testid="file-artifact-viewdiff" onClick={() => onOpenDiff(file.path, file.before ?? '', file.content)}
              className="text-2xs text-fg-subtle hover:text-accent">查看更改 ↗</button>
          )}
          {undone && <span data-testid="file-artifact-undone" className="text-2xs text-fg-subtle">已撤销 ✓</span>}
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button data-testid="file-artifact-openwith"
              className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent">
              打开方式 <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52">
            <OpenWithMenu file={file} workspace={workspace} editors={editors} onAction={() => setOpen(false)} />
          </PopoverContent>
        </Popover>
        {hasDiff && onOpenDiff && (
          <button data-testid="file-artifact-review" onClick={() => onOpenDiff(file.path, file.before ?? '', file.content)}
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent">审核</button>
        )}
        {hasDiff && onUndo && (
          <button data-testid="file-artifact-undo" onClick={() => void doUndo()}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-danger hover:text-danger">
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />撤销
          </button>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 5: 运行确认通过 + 类型** — `cd desktop && npx vitest run test/fileArtifactCard.test.tsx && npx tsc --noEmit`
  Expected: PASS + 无 TS 错(注意:此时 Transcript 仍以旧 props 调 FileArtifactCard,tsc 应仍通过 —— 新增的 onOpenDiff/onUndo 皆可选;若 tsc 报 Transcript 处错误,说明旧调用与新可选 props 不冲突,不应报错。真报错则记录待 Task 6 修)。

- [ ] **Step 6: Commit**
  ```bash
  git add desktop/src/renderer/components/OpenWithMenu.tsx desktop/src/renderer/components/FileArtifactCard.tsx desktop/test/fileArtifactCard.test.tsx
  git commit -m "feat(desktop): FileArtifactCard 重写为统一卡(新建/已编辑 + 查看更改/审核/撤销)+ 抽出 OpenWithMenu"
  ```

---

### Task 6: 接线 Transcript + App + 删内联 DiffCard

**Files:**
- Modify: `desktop/src/renderer/components/Transcript.tsx`、`desktop/src/renderer/App.tsx`
- Delete: `desktop/src/renderer/components/DiffCard.tsx`、`desktop/test/diffCard.test.tsx`

**Interfaces:**
- Consumes: `FileArtifactCard`(Task 5)、App 的 `openArtifact`/`openDiff`(Task 4)、`window.wraith.undoFileEdit`(Task 3)、`resolveWorkspacePath`。
- Produces: Transcript 新可选 props `onOpenDiff?: (filePath, before, after) => void`、`onUndo?: (file: ArtifactFile) => Promise<boolean>`。

- [ ] **Step 1: Transcript 接卡新回调 + 删内联 DiffCard** — `Transcript.tsx`:
  - 删 `import DiffCard from './DiffCard'`;
  - import 类型加 `ArtifactFile`:`import { filesUnderMessages } from '../../shared/artifactSummary'` 旁加 `import type { ArtifactFile } from '../../shared/artifactSummary'`;
  - `TranscriptProps` 里 `onOpenArtifact` 的 JSDoc 改为「点文件名开右侧内容预览」,并新增:
  ```ts
    /** 查看更改/审核 → 右侧 diff。 */
    onOpenDiff?: (filePath: string, before: string, after: string) => void
    /** 撤销:文件级写回 before(created 删除),返回是否成功。 */
    onUndo?: (file: ArtifactFile) => Promise<boolean>
  ```
  - 解构签名(L35)加 `onOpenDiff, onUndo`;
  - 卡渲染块(L100-109)改为(gate 去掉 `onOpenArtifact` 依赖,卡自身按 handler 有无决定按钮):
  ```tsx
  {chips && (
    <div className="flex gap-2.5">
      <div className="w-6 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {chips.map(f => (
          <FileArtifactCard key={f.path} file={f} workspace={workspace ?? null} editors={editors ?? []}
            onOpenPreview={onOpenArtifact} onOpenDiff={onOpenDiff} onUndo={onUndo} />
        ))}
      </div>
    </div>
  )}
  ```
  - diff 分支(L124-125)改为显式不渲染(内联 diff 已由消息下方卡取代):
  ```tsx
  if (item.type === 'diff') return null
  ```

- [ ] **Step 2: App 接 handleUndo + 透传** — `App.tsx`:
  - 新增(靠近 `openDiff`,Task 4 已建):
  ```tsx
  const handleUndo = useCallback(async (file: ArtifactFile): Promise<boolean> => {
    const abs = resolveWorkspacePath(file.path, state.workspace ?? null)
    try {
      const r = await window.wraith.undoFileEdit({ path: abs, before: file.before ?? '', kind: file.kind })
      return r.ok
    } catch {
      return false
    }
  }, [state.workspace])
  ```
  - 确保 import:`import { resolveWorkspacePath } from './lib/paths'`(若未 import)、`import type { ArtifactFile } from '../shared/artifactSummary'`;
  - `<Transcript>`(L1085 区)加两 props:`onOpenDiff={openDiff}` 与 `onUndo={handleUndo}`。

- [ ] **Step 3: 删 DiffCard** — 确认无残余引用后删除:
  ```bash
  cd desktop && rg -n "DiffCard" src test || echo "无残余引用"
  git rm src/renderer/components/DiffCard.tsx test/diffCard.test.tsx
  ```
  （若 `rg` 仍有命中,先清理引用再删。）

- [ ] **Step 4: 类型 + 全量** — `cd desktop && npx tsc --noEmit && npx vitest run`
  Expected: 无 TS 错、全绿(diffCard 测试已随文件删除)。

- [ ] **Step 5: Commit**
  ```bash
  git add desktop/src/renderer/components/Transcript.tsx desktop/src/renderer/App.tsx
  git commit -m "feat(desktop): 接线统一卡(查看更改→右侧diff/撤销→写回)+ 移除内联 DiffCard"
  ```

---

## 收尾(SDD 全部任务后)

- [ ] 终审:整分支代码审查(最强模型),重点:破坏性写路径安全、before 合并语义、内联 DiffCard 移除后无文件在 UI 丢失、审核==查看更改 的双入口是否会误导。
- [ ] 交付说明提醒用户:主进程新 IPC → **必须完全重启 dev App**;人工眼验:新建/已编辑卡渲染、查看更改/审核→右侧 diff、撤销(modified 写回 / created 删除 + confirm)、打开方式仍可用、before===null 文件降级正确。
