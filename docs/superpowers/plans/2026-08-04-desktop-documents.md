# 桌面端「文档」面板 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 wraith 桌面端左侧栏新增「资料 › 文档」面板，把用户手动放入的文件拷贝进 `~/.wraith/documents/` 扁平存放，支持添加/列表/搜索/打开/定位/删除。

**Architecture:** 全部在 Electron 侧实现，不改 Java 后端。`main/documents.ts` 承担 fs 操作与路径安全（不 import electron，可纯 vitest 测）；IPC 在 `main/index.ts` 注册；`renderer/lib/documentsView.ts` 放纯展示逻辑；`DocumentsPanel.tsx` 只管渲染。目录本身是唯一真相源，不建索引文件。

**Tech Stack:** Electron + React 18 + TypeScript + Tailwind + vitest / @testing-library/react + lucide-react

设计依据：`docs/superpowers/specs/2026-08-04-desktop-documents-design.md`

## Global Constraints

- **`src/main/documents.ts` 不得 import electron**（`dialog`/`shell` 一律留在 `main/index.ts` 的 handler 里）——这是它能被纯 vitest 测的前提。
- **所有 IPC 注册在 `src/main/index.ts`**，本仓库无分文件注册先例。
- **IPC 只接受库内文件名，不接受路径**；主进程负责拼路径并做越界校验。
- **重名消歧复用 `uniqueDownloadName`**（`src/main/fileOpen.ts:28`），序号从 `(2)` 起，不另写一套。
- **拖拽取路径必须用 `window.wraith.pathForFile(file)`**，Electron 32 已移除 `File.path`。
- 面板内错误一律 inline 显示，不弹 modal；删除走就地二次确认。
- 注释与 UI 文案用中文，与仓库既有风格一致。
- 每个任务结束跑 `npx vitest run <该任务测试文件>` 必须全绿再提交。

---

### Task 1: main/documents.ts —— 存储层与路径安全

**Files:**
- Modify: `desktop/src/shared/types.ts`（追加 `DocEntry` / `DocAddResult`）
- Create: `desktop/src/main/documents.ts`
- Test: `desktop/test/documents.test.ts`

**Interfaces:**
- Consumes: `uniqueDownloadName(existing: ReadonlySet<string>, base: string): string` from `src/main/fileOpen.ts`
- Produces（类型定义**只此一处**，main 与 renderer 都从 `shared/types` 取，不各自定义）:
  - `interface DocEntry { name: string; size: number; addedAt: number }` — in `shared/types.ts`
  - `interface DocAddResult { added: string[]; failed: { name: string; reason: string }[] }` — in `shared/types.ts`
  - `documentsDir(home: string): string`
  - `ensureDocumentsDir(dir: string): Promise<void>`
  - `listDocuments(dir: string): Promise<DocEntry[]>`
  - `resolveInVault(dir: string, name: string): { status: 'ok'; path: string } | { status: 'missing' }`（非法名或越界时 **throw**）
  - `addDocuments(dir: string, sources: string[]): Promise<DocAddResult>`
  - `removeDocument(dir: string, name: string): Promise<void>`

- [ ] **Step 0: 在 shared/types.ts 追加类型**

`desktop/src/shared/types.ts` 末尾追加。放这里是因为 preload 与 renderer 都要用，而 `shared/` 是仓库既定的纯协议类型落点：

```ts
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
```

- [ ] **Step 1: 写失败测试**

创建 `desktop/test/documents.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  documentsDir, ensureDocumentsDir, listDocuments,
  resolveInVault, addDocuments, removeDocument,
} from '../src/main/documents'

let tmp: string
let vault: string

beforeEach(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wraith-docs-'))
  vault = documentsDir(tmp)
  await ensureDocumentsDir(vault)
})
afterEach(async () => { await fs.promises.rm(tmp, { recursive: true, force: true }) })

/** 造一个源文件,返回绝对路径。 */
async function srcFile(name: string, content = 'x'): Promise<string> {
  const p = path.join(tmp, name)
  await fs.promises.writeFile(p, content)
  return p
}

describe('documentsDir', () => {
  it('落在 <home>/.wraith/documents', () => {
    expect(documentsDir('/home/me')).toBe(path.join('/home/me', '.wraith', 'documents'))
  })
})

describe('ensureDocumentsDir', () => {
  it('目录不存在时创建,已存在时不报错', async () => {
    const d = path.join(tmp, 'deep', 'nested', 'documents')
    await ensureDocumentsDir(d)
    expect(fs.existsSync(d)).toBe(true)
    await ensureDocumentsDir(d)   // 第二次不抛
  })
})

describe('listDocuments', () => {
  it('空目录返回空数组', async () => {
    expect(await listDocuments(vault)).toEqual([])
  })

  it('跳过隐藏文件与子目录,只列普通文件', async () => {
    await fs.promises.writeFile(path.join(vault, 'a.pdf'), 'hello')
    await fs.promises.writeFile(path.join(vault, '.DS_Store'), 'noise')
    await fs.promises.mkdir(path.join(vault, 'sub'))
    const list = await listDocuments(vault)
    expect(list.map(e => e.name)).toEqual(['a.pdf'])
    expect(list[0].size).toBe(5)
  })

  it('按 addedAt 倒序(新的在前)', async () => {
    await fs.promises.writeFile(path.join(vault, 'old.md'), '1')
    await fs.promises.writeFile(path.join(vault, 'new.md'), '1')
    // 直接把 old 的时间戳压到过去,避免依赖真实时序
    const past = new Date(Date.now() - 60_000)
    await fs.promises.utimes(path.join(vault, 'old.md'), past, past)
    const list = await listDocuments(vault)
    expect(list[0].name).toBe('new.md')
  })

  it('目录不存在时返回空数组而不是抛', async () => {
    expect(await listDocuments(path.join(tmp, 'nope'))).toEqual([])
  })
})

describe('resolveInVault —— 路径安全', () => {
  it('正常名字返回库内路径', async () => {
    await fs.promises.writeFile(path.join(vault, 'a.pdf'), 'x')
    const r = resolveInVault(vault, 'a.pdf')
    expect(r.status).toBe('ok')
    expect(r.status === 'ok' && r.path).toBe(path.join(vault, 'a.pdf'))
  })

  it('相对路径逃逸 → 抛', () => {
    expect(() => resolveInVault(vault, '../../../etc/passwd')).toThrow(/非法文件名/)
  })

  it('绝对路径 → 抛', () => {
    expect(() => resolveInVault(vault, '/etc/passwd')).toThrow(/非法文件名/)
  })

  it('. 与 .. 与空串 → 抛', () => {
    expect(() => resolveInVault(vault, '.')).toThrow(/非法文件名/)
    expect(() => resolveInVault(vault, '..')).toThrow(/非法文件名/)
    expect(() => resolveInVault(vault, '')).toThrow(/非法文件名/)
  })

  it('库内软链指向库外 → 抛越界(realpath 才看得出来)', async () => {
    const outside = path.join(tmp, 'secret.txt')
    await fs.promises.writeFile(outside, 'sensitive')
    await fs.promises.symlink(outside, path.join(vault, 'innocent.txt'))
    expect(() => resolveInVault(vault, 'innocent.txt')).toThrow(/越界/)
  })

  it('文件不存在 → status=missing,不抛(与越界是两条分支)', () => {
    const r = resolveInVault(vault, 'ghost.pdf')
    expect(r.status).toBe('missing')
  })
})

describe('addDocuments', () => {
  it('拷贝进库并返回最终文件名', async () => {
    const s = await srcFile('report.pdf', 'content')
    const r = await addDocuments(vault, [s])
    expect(r.added).toEqual(['report.pdf'])
    expect(r.failed).toEqual([])
    expect(fs.readFileSync(path.join(vault, 'report.pdf'), 'utf8')).toBe('content')
  })

  it('重名不覆盖,走 uniqueDownloadName 从 (2) 起', async () => {
    await fs.promises.writeFile(path.join(vault, 'a.pdf'), 'old')
    const s = await srcFile('a.pdf', 'new')
    const r = await addDocuments(vault, [s])
    expect(r.added).toEqual(['a (2).pdf'])
    expect(fs.readFileSync(path.join(vault, 'a.pdf'), 'utf8')).toBe('old')      // 原文件没被动
    expect(fs.readFileSync(path.join(vault, 'a (2).pdf'), 'utf8')).toBe('new')
  })

  it('同一批里两个同名文件也各自消歧', async () => {
    const d1 = path.join(tmp, 'd1'); const d2 = path.join(tmp, 'd2')
    await fs.promises.mkdir(d1); await fs.promises.mkdir(d2)
    await fs.promises.writeFile(path.join(d1, 'same.md'), '1')
    await fs.promises.writeFile(path.join(d2, 'same.md'), '2')
    const r = await addDocuments(vault, [path.join(d1, 'same.md'), path.join(d2, 'same.md')])
    expect(r.added).toEqual(['same.md', 'same (2).md'])
  })

  it('文件夹被跳过并计入 failed,不影响同批其他文件', async () => {
    const dir = path.join(tmp, 'afolder')
    await fs.promises.mkdir(dir)
    const s = await srcFile('ok.md')
    const r = await addDocuments(vault, [dir, s])
    expect(r.added).toEqual(['ok.md'])
    expect(r.failed).toEqual([{ name: 'afolder', reason: '暂不支持文件夹' }])
  })

  it('源文件不存在时计入 failed,其余继续', async () => {
    const s = await srcFile('good.md')
    const r = await addDocuments(vault, [path.join(tmp, 'ghost.md'), s])
    expect(r.added).toEqual(['good.md'])
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0].name).toBe('ghost.md')
  })
})

describe('removeDocument', () => {
  it('删掉库内文件', async () => {
    await fs.promises.writeFile(path.join(vault, 'a.pdf'), 'x')
    await removeDocument(vault, 'a.pdf')
    expect(fs.existsSync(path.join(vault, 'a.pdf'))).toBe(false)
  })

  it('文件已不存在 → 幂等成功,不抛', async () => {
    await expect(removeDocument(vault, 'ghost.pdf')).resolves.toBeUndefined()
  })

  it('越界名字 → 抛,且不碰目标文件', async () => {
    const outside = path.join(tmp, 'keep.txt')
    await fs.promises.writeFile(outside, 'x')
    await fs.promises.symlink(outside, path.join(vault, 'link.txt'))
    await expect(removeDocument(vault, 'link.txt')).rejects.toThrow(/越界/)
    expect(fs.existsSync(outside)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd desktop && npx vitest run test/documents.test.ts
```

Expected: FAIL —— `Failed to resolve import "../src/main/documents"`

- [ ] **Step 3: 实现 main/documents.ts**

创建 `desktop/src/main/documents.ts`：

```ts
/**
 * documents —— 「文档」面板的存储层:~/.wraith/documents/ 扁平存放用户资料。
 *
 * 刻意不 import electron:dialog/shell 留在 index.ts 的 handler 里,
 * 这样本模块能在纯 Node 下被 vitest 直接测(路径逃逸那组用例才好写)。
 *
 * 目录本身是唯一真相源 —— 不建索引文件,列表全部由 readdir + stat 现算。
 */

import fs from 'fs'
import path from 'path'
import { uniqueDownloadName } from './fileOpen'
import type { DocEntry, DocAddResult } from '../shared/types'

/** 库目录:<home>/.wraith/documents。取 home 作参数,便于测试。 */
export function documentsDir(home: string): string {
  return path.join(home, '.wraith', 'documents')
}

/** 首次访问自动创建;已存在不报错。 */
export async function ensureDocumentsDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true })
}

/** 列库内普通文件,跳过隐藏文件与子目录,按 addedAt 倒序。目录不存在返回空数组。 */
export async function listDocuments(dir: string): Promise<DocEntry[]> {
  let names: string[]
  try {
    names = await fs.promises.readdir(dir)
  } catch {
    return []   // 目录还没建 = 库是空的,不是错误
  }
  const out: DocEntry[] = []
  for (const name of names) {
    if (name.startsWith('.')) continue   // .DS_Store 一类噪音
    try {
      const st = await fs.promises.stat(path.join(dir, name))
      if (!st.isFile()) continue         // 跳过子目录
      // birthtime 在部分 Linux 文件系统上为 0/无效,退回 mtime
      const birth = st.birthtimeMs
      out.push({ name, size: st.size, addedAt: birth > 0 ? birth : st.mtimeMs })
    } catch { /* 列举过程中文件消失:跳过即可 */ }
  }
  return out.sort((a, b) => b.addedAt - a.addedAt)
}

/**
 * 把库内文件名解析成绝对路径。三步顺序**不可调换**:
 *   1. 名字合法性 → 非法抛
 *   2. 存在性     → 不存在返回 missing(不抛)
 *   3. realpath 越界 → 越界抛
 * 第 2 步必须在 realpath 之前:realpathSync 对不存在的路径直接抛 ENOENT,
 * 混在一起就分不清「文件没了」(该幂等成功)和「路径越界」(该抛)。
 */
export function resolveInVault(
  dir: string,
  name: string,
): { status: 'ok'; path: string } | { status: 'missing' } {
  // 1. 名字合法性:不许有分隔符,不许是 . / .. / 空
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`非法文件名:${name}`)
  }
  const target = path.join(dir, name)

  // 2. 存在性(用 lstat:软链本身存在就算存在,交给第 3 步去揭穿)
  try {
    fs.lstatSync(target)
  } catch {
    return { status: 'missing' }
  }

  // 3. realpath 越界:字符串比较看不出软链,必须解析
  const realVault = fs.realpathSync(dir)
  const realTarget = fs.realpathSync(target)
  const rel = path.relative(realVault, realTarget)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径越界:${name}`)
  }
  return { status: 'ok', path: target }
}

/** 批量拷贝进库。单条失败不影响其余,失败原因面向用户可读。 */
export async function addDocuments(dir: string, sources: string[]): Promise<DocAddResult> {
  await ensureDocumentsDir(dir)
  const added: string[] = []
  const failed: { name: string; reason: string }[] = []
  // 同批内也要避免互相覆盖:taken 随每次入库增长
  const taken = new Set(await fs.promises.readdir(dir).catch(() => [] as string[]))

  for (const src of sources) {
    const base = path.basename(src)
    try {
      const st = await fs.promises.stat(src)
      if (st.isDirectory()) { failed.push({ name: base, reason: '暂不支持文件夹' }); continue }
      const finalName = uniqueDownloadName(taken, base)
      await fs.promises.copyFile(src, path.join(dir, finalName))
      taken.add(finalName)
      added.push(finalName)
    } catch (err) {
      failed.push({ name: base, reason: (err as Error).message })
    }
  }
  return { added, failed }
}

/** 删除库内文件。已不存在 = 幂等成功;越界抛。 */
export async function removeDocument(dir: string, name: string): Promise<void> {
  const r = resolveInVault(dir, name)
  if (r.status === 'missing') return
  await fs.promises.unlink(r.path)
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd desktop && npx vitest run test/documents.test.ts
```

Expected: PASS，全部用例绿。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/shared/types.ts desktop/src/main/documents.ts desktop/test/documents.test.ts
git commit -m "feat(desktop): 文档库存储层 —— 扁平目录 + 三步路径安全校验

~/.wraith/documents/ 的 fs 操作与路径校验。不 import electron,便于纯 vitest 测。

resolveInVault 三步顺序不可换:名字合法 → 存在性 → realpath 越界。
第 2 步必须在 realpath 前,因为 realpathSync 对不存在的路径直接抛 ENOENT,
混在一起就分不清「文件没了」(该幂等成功)和「路径越界」(该抛)。
软链逃逸只有 realpath 看得出来,字符串前缀比较会被骗过去。

重名复用 fileOpen.ts 的 uniqueDownloadName(序号从 (2) 起),不另造一套。"
```

---

### Task 2: IPC 与 preload 桥接

**Files:**
- Modify: `desktop/src/main/index.ts`（注册 5 个 handler）
- Modify: `desktop/src/preload/index.ts`（`WraithApi.documents` 接口 + 实现）

**Interfaces:**
- Consumes: Task 1 的 `documentsDir` / `ensureDocumentsDir` / `listDocuments` / `resolveInVault` / `addDocuments` / `removeDocument`，以及 `shared/types` 的 `DocEntry` / `DocAddResult`
- Produces: `window.wraith.documents` —— 供 Task 4 调用
  ```ts
  documents: {
    list(): Promise<DocEntry[]>
    add(paths?: string[]): Promise<AddResult>
    remove(name: string): Promise<void>
    open(name: string): Promise<void>
    reveal(name: string): Promise<void>
  }
  ```

本任务改的是 Electron 主/预加载进程接线，无法用 vitest 直接覆盖（仓库既有 IPC 同样没有单测），验证方式是 `tsc` 全绿 + Task 4 的组件测试通过 mock 使用这些签名。

- [ ] **Step 1: 在 main/index.ts 注册 handler**

先在文件顶部 import 段（`./fileOpen` 那行附近，约 `:52`）加：

```ts
import { documentsDir, ensureDocumentsDir, listDocuments, resolveInVault, addDocuments, removeDocument } from './documents'
```

然后在 `ipcMain.handle('wraith:revealInFinder', ...)` 那一段（约 `:1429`）之后追加：

```ts
// ── 「文档」面板:~/.wraith/documents/ 资料库 ──────────────────────────
// 入参一律是库内文件名而非路径 —— renderer 不该有能力指定任意路径,尤其对 remove。
function docsDir(): string { return documentsDir(os.homedir()) }

ipcMain.handle('wraith:documents:list', async () => {
  const dir = docsDir()
  await ensureDocumentsDir(dir)
  return listDocuments(dir)
})

ipcMain.handle('wraith:documents:add', async (_e, paths?: string[]) => {
  const dir = docsDir()
  let sources = paths
  if (!sources || sources.length === 0) {
    // 无参 = 走系统文件选择器(与既有 pickAttachments 同款降级写法)
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] })
      : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
    if (result.canceled) return { added: [], failed: [] }
    sources = result.filePaths
  }
  return addDocuments(dir, sources)
})

ipcMain.handle('wraith:documents:remove', async (_e, name: string) => {
  await removeDocument(docsDir(), name)
})

ipcMain.handle('wraith:documents:open', async (_e, name: string) => {
  const r = resolveInVault(docsDir(), name)
  if (r.status === 'missing') throw new Error('文件已不存在')
  const err = await shell.openPath(r.path)
  if (err) throw new Error(err)   // openPath 失败时返回非空错误串
})

ipcMain.handle('wraith:documents:reveal', (_e, name: string) => {
  const r = resolveInVault(docsDir(), name)
  if (r.status === 'missing') throw new Error('文件已不存在')
  shell.showItemInFolder(r.path)
})
```

- [ ] **Step 2: 在 preload 暴露**

`desktop/src/preload/index.ts`：

① 顶部类型 import 追加 `DocEntry, DocAddResult`（加进既有那条长 import 的花括号里）。

② `WraithApi` 接口内，紧挨 `windowControls` 之前插入：

```ts
  /** 「文档」资料库:~/.wraith/documents/ 扁平存放。入参是库内文件名,不是路径。 */
  documents: {
    list(): Promise<DocEntry[]>
    /** 无参 → 弹系统文件选择器;传 paths → 拖拽入库。 */
    add(paths?: string[]): Promise<DocAddResult>
    remove(name: string): Promise<void>
    open(name: string): Promise<void>
    reveal(name: string): Promise<void>
  }
```

③ `const wraith: WraithApi = {` 对象内，紧挨 `windowControls` 之前插入：

```ts
  documents: {
    list() { return ipcRenderer.invoke('wraith:documents:list') as Promise<DocEntry[]> },
    add(paths) { return ipcRenderer.invoke('wraith:documents:add', paths) as Promise<DocAddResult> },
    remove(name) { return ipcRenderer.invoke('wraith:documents:remove', name) as Promise<void> },
    open(name) { return ipcRenderer.invoke('wraith:documents:open', name) as Promise<void> },
    reveal(name) { return ipcRenderer.invoke('wraith:documents:reveal', name) as Promise<void> },
  },
```

- [ ] **Step 3: 类型检查**

```bash
cd desktop && npx tsc --noEmit
```

Expected: 0 error。若报 `os` / `dialog` / `shell` / `mainWindow` 未定义，检查它们在 `main/index.ts` 顶部是否已 import（既有代码已使用这四者，正常情况无需新增）。

- [ ] **Step 4: 提交**

```bash
git add desktop/src/main/index.ts desktop/src/preload/index.ts
git commit -m "feat(desktop): 文档库 IPC 与 preload 桥接

五个 handler:list/add/remove/open/reveal。add 无参走系统选择器,有参走拖拽。

入参一律是库内文件名而非绝对路径 —— renderer 不该有能力指定任意路径,
remove 尤其如此。拼路径与越界校验全在主进程侧。

openPath 失败返回非空错误串而不是抛,这里转成 throw 让面板能 inline 显示。"
```

---

### Task 3: renderer/lib/documentsView.ts —— 纯展示逻辑

**Files:**
- Create: `desktop/src/renderer/lib/documentsView.ts`
- Test: `desktop/test/documentsView.test.ts`

**Interfaces:**
- Consumes: `DocEntry` from `src/shared/types`
- Produces:
  - `filterDocs(docs: DocEntry[], query: string): DocEntry[]`
  - `formatSize(bytes: number): string`
  - `docIconKind(name: string): 'pdf' | 'doc' | 'sheet' | 'image' | 'text' | 'file'`

- [ ] **Step 1: 写失败测试**

创建 `desktop/test/documentsView.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { filterDocs, formatSize, docIconKind } from '../src/renderer/lib/documentsView'
import type { DocEntry } from '../src/shared/types'

const doc = (name: string): DocEntry => ({ name, size: 1, addedAt: 1 })

describe('filterDocs', () => {
  const docs = [doc('需求文档.pdf'), doc('API 设计.md'), doc('Report.PDF')]

  it('空查询原样返回', () => {
    expect(filterDocs(docs, '')).toHaveLength(3)
  })

  it('只留名字含关键词的', () => {
    expect(filterDocs(docs, '设计').map(d => d.name)).toEqual(['API 设计.md'])
  })

  it('大小写不敏感', () => {
    expect(filterDocs(docs, 'report').map(d => d.name)).toEqual(['Report.PDF'])
    expect(filterDocs(docs, '.pdf').map(d => d.name)).toEqual(['需求文档.pdf', 'Report.PDF'])
  })

  it('查询两侧空白被忽略', () => {
    expect(filterDocs(docs, '  设计  ')).toHaveLength(1)
  })

  it('无命中返回空数组', () => {
    expect(filterDocs(docs, 'zzz')).toEqual([])
  })
})

describe('formatSize', () => {
  it('B 区间', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(999)).toBe('999 B')
  })
  it('KB 区间(1024 起)', () => {
    expect(formatSize(1024)).toBe('1.0 KB')
    expect(formatSize(1536)).toBe('1.5 KB')
  })
  it('MB 区间', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatSize(2.4 * 1024 * 1024)).toBe('2.4 MB')
  })
  it('GB 区间', () => {
    expect(formatSize(1024 ** 3)).toBe('1.0 GB')
  })
})

describe('docIconKind', () => {
  it('按扩展名分类,大小写不敏感', () => {
    expect(docIconKind('a.pdf')).toBe('pdf')
    expect(docIconKind('a.PDF')).toBe('pdf')
    expect(docIconKind('a.docx')).toBe('doc')
    expect(docIconKind('a.xlsx')).toBe('sheet')
    expect(docIconKind('a.png')).toBe('image')
    expect(docIconKind('a.md')).toBe('text')
  })
  it('未知扩展名与无扩展名兜底 file', () => {
    expect(docIconKind('a.zzz')).toBe('file')
    expect(docIconKind('README')).toBe('file')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd desktop && npx vitest run test/documentsView.test.ts
```

Expected: FAIL —— `Failed to resolve import "../src/renderer/lib/documentsView"`

- [ ] **Step 3: 实现**

创建 `desktop/src/renderer/lib/documentsView.ts`：

```ts
/**
 * documentsView —— 「文档」面板的纯展示逻辑,无 React/Electron 依赖。
 * 过滤、大小格式化、扩展名→图标类别。排序在主进程侧已做(addedAt 倒序)。
 */

import type { DocEntry } from '../../shared/types'

/** 按文件名过滤,大小写不敏感;空查询原样返回。 */
export function filterDocs(docs: DocEntry[], query: string): DocEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return docs
  return docs.filter(d => d.name.toLowerCase().includes(q))
}

/** 人类可读大小。1024 进制,KB 以上保留一位小数。 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

export type DocIconKind = 'pdf' | 'doc' | 'sheet' | 'image' | 'text' | 'file'

const EXT_KIND: Record<string, DocIconKind> = {
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', rtf: 'doc', pages: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', numbers: 'sheet',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  md: 'text', txt: 'text', json: 'text', yaml: 'text', yml: 'text', log: 'text',
}

/** 扩展名 → 图标类别;未知与无扩展名兜底 'file'。 */
export function docIconKind(name: string): DocIconKind {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'file'
  return EXT_KIND[name.slice(dot + 1).toLowerCase()] ?? 'file'
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd desktop && npx vitest run test/documentsView.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/lib/documentsView.ts desktop/test/documentsView.test.ts
git commit -m "feat(desktop): 文档面板纯展示逻辑(过滤/大小/图标类别)

抽成无 React 依赖的模块,单测直接盖住边界值:1024 进位、大小写不敏感过滤、
未知扩展名兜底。排序不在这里 —— 主进程列目录时已按 addedAt 倒序给出。"
```

---

### Task 4: DocumentsPanel 组件

**Files:**
- Create: `desktop/src/renderer/components/DocumentsPanel.tsx`
- Test: `desktop/test/documentsPanel.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `window.wraith.documents.*`；Task 3 的 `filterDocs` / `formatSize` / `docIconKind`
- Produces: `export default function DocumentsPanel({ onBack }: { onBack: () => void }): JSX.Element` —— 供 Task 5 在 App.tsx 挂载

data-testid 约定（Task 5 与后续维护依赖这些）：`documents-back`、`documents-add`、`documents-search`、`documents-empty`、`documents-error`、`documents-row-<name>`、`documents-open-<name>`、`documents-reveal-<name>`、`documents-delete-<name>`

- [ ] **Step 1: 写失败测试**

创建 `desktop/test/documentsPanel.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import DocumentsPanel from '../src/renderer/components/DocumentsPanel'
import type { DocEntry } from '../src/shared/types'

afterEach(cleanup)

const DOCS: DocEntry[] = [
  { name: '需求文档.pdf', size: 2_517_000, addedAt: Date.now() - 86_400_000 },
  { name: 'API 设计.md', size: 18_000, addedAt: Date.now() - 3_600_000 },
]

function mockWraith(over: Record<string, unknown> = {}) {
  const documents = {
    list: vi.fn(async () => DOCS),
    add: vi.fn(async () => ({ added: ['新文件.pdf'], failed: [] })),
    remove: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    reveal: vi.fn(async () => undefined),
    ...over,
  }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = { documents }
  return documents
}

describe('DocumentsPanel', () => {
  it('加载后渲染文件行,含大小', async () => {
    mockWraith()
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('documents-row-需求文档.pdf')).toBeTruthy())
    expect(screen.getByText('API 设计.md')).toBeTruthy()
    expect(screen.getByText('2.4 MB')).toBeTruthy()
  })

  it('库为空时显示空态,且不显示搜索框', async () => {
    mockWraith({ list: vi.fn(async () => []) })
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('documents-empty')).toBeTruthy())
    expect(screen.queryByTestId('documents-search')).toBeNull()
  })

  it('点添加按钮调 documents.add() 且不传参(走系统选择器)', async () => {
    const d = mockWraith()
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(d.list).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('documents-add'))
    await waitFor(() => expect(d.add).toHaveBeenCalledWith())
  })

  it('搜索过滤掉不匹配的行', async () => {
    mockWraith()
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('documents-search')).toBeTruthy())
    fireEvent.change(screen.getByTestId('documents-search'), { target: { value: '设计' } })
    expect(screen.queryByTestId('documents-row-需求文档.pdf')).toBeNull()
    expect(screen.getByTestId('documents-row-API 设计.md')).toBeTruthy()
  })

  it('删除要点两次:首次只进确认态,不调 remove', async () => {
    const d = mockWraith()
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('documents-delete-API 设计.md')).toBeTruthy())
    fireEvent.click(screen.getByTestId('documents-delete-API 设计.md'))
    expect(d.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('documents-delete-API 设计.md'))
    await waitFor(() => expect(d.remove).toHaveBeenCalledWith('API 设计.md'))
  })

  it('打开与定位分别调 open/reveal,入参是文件名', async () => {
    const d = mockWraith()
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('documents-open-API 设计.md')).toBeTruthy())
    fireEvent.click(screen.getByTestId('documents-open-API 设计.md'))
    await waitFor(() => expect(d.open).toHaveBeenCalledWith('API 设计.md'))
    fireEvent.click(screen.getByTestId('documents-reveal-API 设计.md'))
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith('API 设计.md'))
  })

  it('add 有 failed 时 inline 显示失败条目,不弹窗', async () => {
    const d = mockWraith({
      add: vi.fn(async () => ({ added: ['ok.md'], failed: [{ name: 'bad.md', reason: '无读取权限' }] })),
    })
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(d.list).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('documents-add'))
    await waitFor(() => expect(screen.getByTestId('documents-error')).toBeTruthy())
    expect(screen.getByTestId('documents-error').textContent).toContain('bad.md')
    expect(screen.getByTestId('documents-error').textContent).toContain('无读取权限')
  })

  it('list 抛错时 inline 显示错误', async () => {
    mockWraith({ list: vi.fn(async () => { throw new Error('磁盘不可读') }) })
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('documents-error').textContent).toContain('磁盘不可读'))
  })

  it('点返回调 onBack', async () => {
    mockWraith()
    const onBack = vi.fn()
    render(<DocumentsPanel onBack={onBack} />)
    await waitFor(() => expect(screen.getByTestId('documents-back')).toBeTruthy())
    fireEvent.click(screen.getByTestId('documents-back'))
    expect(onBack).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd desktop && npx vitest run test/documentsPanel.test.tsx
```

Expected: FAIL —— 找不到 `DocumentsPanel` 模块。

- [ ] **Step 3: 实现组件**

创建 `desktop/src/renderer/components/DocumentsPanel.tsx`：

```tsx
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, FolderOpen, Plus, Search, Trash2, Check, FolderSearch,
  FileText, FileSpreadsheet, FileImage, FileType, File as FileIcon,
} from 'lucide-react'
import type { DocEntry } from '../../shared/types'
import { filterDocs, formatSize, docIconKind } from '../lib/documentsView'
// relativeTime(ms, nowMs = Date.now()) —— snapshotView.ts:36,签名与此处用法一致,直接复用
import { relativeTime } from '../lib/snapshotView'

/** 图标类别 → lucide 组件。与 documentsView.docIconKind 的返回值一一对应。 */
const ICONS = {
  pdf: FileType,
  doc: FileText,
  sheet: FileSpreadsheet,
  image: FileImage,
  text: FileText,
  file: FileIcon,
} as const

export default function DocumentsPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  // 删除二次确认:记住当前待确认的文件名(同侧栏会话删除的就地确认,不弹 modal)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setDocs(await window.wraith.documents.list())
      setError(null)
    } catch (err) { setError((err as Error).message) }
  }, [])

  useEffect(() => { void load() }, [load])

  /** 入库并把失败项汇总成一条 inline 提示。paths 为空 → 走系统选择器。 */
  const doAdd = useCallback(async (paths?: string[]): Promise<void> => {
    setBusy(true)
    try {
      const r = paths ? await window.wraith.documents.add(paths) : await window.wraith.documents.add()
      setError(r.failed.length
        ? `${r.added.length} 个成功,${r.failed.length} 个失败:` +
          r.failed.map(f => `${f.name}(${f.reason})`).join('、')
        : null)
      await load()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [load])

  const doRemove = useCallback(async (name: string): Promise<void> => {
    if (confirmDel !== name) { setConfirmDel(name); return }
    setConfirmDel(null)
    try { await window.wraith.documents.remove(name); await load() }
    catch (err) { setError((err as Error).message) }
  }, [confirmDel, load])

  const doOpen = useCallback(async (name: string): Promise<void> => {
    try { await window.wraith.documents.open(name) }
    catch (err) { setError((err as Error).message) }
  }, [])

  const doReveal = useCallback(async (name: string): Promise<void> => {
    try { await window.wraith.documents.reveal(name) }
    catch (err) { setError((err as Error).message) }
  }, [])

  const onDrop = useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    // Electron 32 已移除 File.path,取磁盘路径必须走 webUtils(preload 的 pathForFile)
    const paths = Array.from(e.dataTransfer.files).map(f => window.wraith.pathForFile(f)).filter(Boolean)
    if (paths.length) void doAdd(paths)
  }, [doAdd])

  const shown = filterDocs(docs, query)

  return (
    <div
      className={'flex min-h-0 flex-1 flex-col ' + (dragOver ? 'bg-accent/5 ring-2 ring-inset ring-accent' : '')}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="documents-back" onClick={onBack} title="返回对话"
          className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface hover:text-fg">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <span className="flex items-center gap-2 text-sm font-bold text-fg">
          <FolderOpen className="h-4 w-4 shrink-0" strokeWidth={1.5} />文档
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* 只有一个文件时搜索框是多余 UI */}
          {docs.length > 1 && (
            <div className="flex items-center gap-1.5 rounded-lg bg-fg/5 px-2 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.5} />
              <input
                data-testid="documents-search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="搜索"
                className="w-32 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
              />
            </div>
          )}
          <button data-testid="documents-add" disabled={busy} onClick={() => void doAdd()}
            className="flex items-center gap-1.5 rounded-lg bg-fg/5 px-3 py-1.5 text-xs text-fg hover:bg-fg/10 hover:text-accent disabled:opacity-50">
            <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />添加
          </button>
        </div>
      </div>

      {error && (
        <div data-testid="documents-error"
          className="mx-4 mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-fg-muted">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {docs.length === 0 ? (
          <div data-testid="documents-empty"
            className="mt-8 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
            <FolderOpen className="h-8 w-8 text-fg-subtle" strokeWidth={1.5} />
            <div className="text-xs text-fg-muted">把文件拖进来,或点右上角添加</div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5" onMouseLeave={() => setConfirmDel(null)}>
            {shown.map(d => {
              const Icon = ICONS[docIconKind(d.name)]
              return (
                <div key={d.name} data-testid={`documents-row-${d.name}`}
                  className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-fg/5">
                  <Icon className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.5} />
                  <button onClick={() => void doOpen(d.name)} data-testid={`documents-open-${d.name}`}
                    className="flex-1 truncate text-left text-xs text-fg" title={`打开 ${d.name}`}>
                    {d.name}
                  </button>
                  <span className="shrink-0 text-3xs text-fg-subtle">{formatSize(d.size)}</span>
                  <span className="w-16 shrink-0 text-right text-3xs text-fg-subtle">{relativeTime(d.addedAt)}</span>
                  <button data-testid={`documents-reveal-${d.name}`} onClick={() => void doReveal(d.name)}
                    title="在文件管理器中显示"
                    className="shrink-0 px-1 text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100">
                    <FolderSearch className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                  <button data-testid={`documents-delete-${d.name}`} onClick={() => void doRemove(d.name)}
                    title={confirmDel === d.name ? '确认删除?' : '删除'}
                    className={'shrink-0 px-1 opacity-0 group-hover:opacity-100 ' +
                      (confirmDel === d.name ? 'text-danger opacity-100' : 'text-fg-subtle hover:text-fg')}>
                    {confirmDel === d.name
                      ? <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                      : <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />}
                  </button>
                </div>
              )
            })}
            {shown.length === 0 && (
              <div className="py-8 text-center text-xs text-fg-subtle">没有匹配「{query}」的文件</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

> `relativeTime` 已确认为 `snapshotView.ts:36` 的 `(ms: number, nowMs?: number) => string`，直接复用即可，不要为此改动 `snapshotView`。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd desktop && npx vitest run test/documentsPanel.test.tsx
```

Expected: PASS，9 条全绿。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/components/DocumentsPanel.tsx desktop/test/documentsPanel.test.tsx
git commit -m "feat(desktop): 文档面板组件

整块是 drop zone;拖拽取路径走 pathForFile(Electron 32 已移除 File.path,
直接读 File.path 会拿到 undefined)。

删除用就地二次确认而不是 window.confirm —— 与侧栏会话删除一致,
鼠标移出行即取消。add 的失败项汇总成一条 inline 提示,不弹窗、不打断整批。"
```

---

### Task 5: 接入左侧栏与 App 路由

**Files:**
- Modify: `desktop/src/renderer/lib/panelActions.ts`
- Modify: `desktop/src/renderer/components/Sidebar.tsx`（`:99` 类型、`:112` TOOL_GROUPS、`:162` activeNav、props、`:235` handlers）
- Modify: `desktop/src/renderer/App.tsx`（`:187` view 类型、`:1042` 起 props、`:1134` 起渲染分支、import）
- Test: `desktop/test/panelActions.test.ts`（改）、`desktop/test/sidebarToolGroups.test.tsx`（改）

**Interfaces:**
- Consumes: Task 4 的 `DocumentsPanel`
- Produces: 无（终端任务）

> **注意：本任务不是「往测试里追加几条」，而是既有测试会因新增而失败。**
> `test/sidebarToolGroups.test.tsx` 的 `toolHandlers()` 返回 11 个 mock 回调，`props()` 把它们展开成 `SidebarProps`。一旦 Sidebar 新增必填 prop `onOpenDocuments`，`props()` 的返回值就少一个必填字段 → **tsc 报错**。而把 `onOpenDocuments` 加进 `toolHandlers()` 之后，该文件 `:74` 那条交叉检查 `for (const cb of Object.values(h)) expect(cb).toHaveBeenCalledTimes(1)` 会因它从未被点击而 **失败**。两处必须同时改。

- [ ] **Step 1: 改 test/panelActions.test.ts**

在既有 `describe('panelActions', ...)` 块内追加一条：

```ts
  it('documents 有中文名且能归一', () => {
    expect(PANEL_LABELS.documents).toBe('文档')
    expect(normalizePanel('documents')).toBe('documents')
    expect(normalizePanel('  DOCUMENTS ')).toBe('documents')
  })
```

- [ ] **Step 2: 改 test/sidebarToolGroups.test.tsx（五处）**

① `:10-18` 的 `toolHandlers()` —— 注释与内容都要改（11 → 12）：

```tsx
/** 12 个工具项各自的回调,便于逐个验证「重构后线没接错」。 */
function toolHandlers() {
  return {
    onOpenPlugins: vi.fn(), onOpenAutomations: vi.fn(), onOpenImGateway: vi.fn(),
    onOpenProviders: vi.fn(), onOpenSkills: vi.fn(), onOpenMemory: vi.fn(),
    onOpenSnapshots: vi.fn(), onOpenTasks: vi.fn(), onOpenPolicy: vi.fn(),
    onOpenBrowser: vi.fn(), onOpenRag: vi.fn(), onOpenDocuments: vi.fn(),
  }
}
```

② `:48-51` 的 `'三个组标题都在'` → 改成四个：

```tsx
  it('四个组标题都在', () => {
    render(<Sidebar {...props()} />)
    for (const g of ['配置', '运行', '观察', '资料']) expect(screen.getByText(g)).toBeTruthy()
  })
```

③ `:53-58` 的 `'11 个工具项一个不少'` → 12 个：

```tsx
  it('12 个工具项一个不少(重构不能丢项)', () => {
    render(<Sidebar {...props()} />)
    const ids = ['nav-plugins', 'nav-providers', 'nav-skills', 'nav-automations', 'nav-im-gateway',
      'nav-tasks', 'nav-memory', 'nav-snapshots', 'nav-policy', 'nav-browser', 'nav-rag', 'nav-documents']
    for (const id of ids) expect(screen.getByTestId(id), id + ' 丢了').toBeTruthy()
  })
```

④ `:63-68` 的 `pairs` 数组末尾追加一项（**不加这行，`:74` 的交叉检查必挂**）：

```tsx
      ['nav-browser', 'onOpenBrowser'], ['nav-rag', 'onOpenRag'], ['nav-documents', 'onOpenDocuments'],
```

⑤ 在 `'分组顺序:配置 → 运行 → 观察'`（`:84`）之后追加一条，钉住「资料」在最后：

```tsx
  it('「资料」组排在「观察」之后(它是「我的东西」,不属于前三组的 agent 工作流)', () => {
    const { container } = render(<Sidebar {...props()} />)
    expect(orderOf(container, 'nav-rag')).toBeLessThan(orderOf(container, 'nav-documents'))
  })
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd desktop && npx vitest run test/panelActions.test.ts test/sidebarToolGroups.test.tsx
```

Expected: FAIL —— `PANEL_LABELS.documents` 为 undefined；`getByTestId('nav-documents')` 找不到元素。

- [ ] **Step 4: 改 panelActions.ts**

```ts
export type PanelId =
  | 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills'
  | 'memory' | 'snapshots' | 'tasks' | 'policy' | 'browser' | 'rag' | 'documents'

export const PANEL_LABELS: Record<PanelId, string> = {
  // ...既有条目保持不变
  documents: '文档',
}
```

- [ ] **Step 5: 改 Sidebar.tsx（五处）**

① `:9` lucide import 追加 `FolderOpen`。

② `:99` 的 `ToolNav` 联合类型末尾追加 `| 'documents'`。

③ `:140` 的 `TOOL_GROUPS` 末尾追加第四组：

```ts
  {
    // 前三组讲的是「agent 怎么工作」,这一组是「我的东西」——塞进任何一组
    // 都会让那组的分类依据失效,所以单开。目前一项,后续剪藏/归档也归这里。
    label: '资料',
    items: [
      { nav: 'documents', testId: 'nav-documents', label: '文档', Icon: FolderOpen },
    ],
  },
```

④ `SidebarProps`：`activeNav` 联合类型追加 `| 'documents'`，并在 `onOpenRag` 后加 `onOpenDocuments: () => void`；函数参数解构同步加 `onOpenDocuments,`。

⑤ `:235` 的 `handlers` 表追加 `documents: onOpenDocuments,`。

- [ ] **Step 6: 改 App.tsx（四处）**

① import 段追加：`import DocumentsPanel from './components/DocumentsPanel'`

② `:187` 的 `view` 联合类型追加 `| 'documents'`。

③ `:1052` 的 `onOpenRag` 之后追加：`onOpenDocuments={() => setView('documents')}`

④ `:1134` 的 rag 分支之后、`settings` 分支之前插入：

```tsx
        ) : view === 'documents' ? (
          <DocumentsPanel onBack={() => setView('chat')} />
```

- [ ] **Step 7: 跑测试与类型检查**

```bash
cd desktop && npx vitest run test/panelActions.test.ts test/sidebarToolGroups.test.tsx && npx tsc --noEmit
```

Expected: 测试 PASS，tsc 0 error。

- [ ] **Step 8: 跑全量回归**

```bash
cd desktop && npx vitest run
```

Expected: 全绿。基线约 1490 测试 / 11 失败（记录在案的既有抖动）；**若失败数超过基线，先停下来定位是不是本次改动引入的**——怀疑自己改出回归时，`git stash` 后连跑两次基线才有区分力。

- [ ] **Step 9: 提交**

```bash
git add desktop/src/renderer/lib/panelActions.ts desktop/src/renderer/components/Sidebar.tsx desktop/src/renderer/App.tsx desktop/test/panelActions.test.ts desktop/test/sidebarToolGroups.test.tsx
git commit -m "feat(desktop): 文档面板接入左侧栏「资料」组

侧栏新开第四组而不是塞进「观察」:现有三组的分类依据(Sidebar.tsx:103 注释)
是「什么时候会点它」,讲的都是 agent 怎么工作;文档是「我的东西」,
混进任何一组都会让那组依据失效。为一项开一组多一行小标题,可接受。"
```

---

## 手动验收（实现完成后跑一遍）

```bash
cd desktop && npm run dev
```

1. 左侧栏「工具」展开 → 应见第四组「资料 › 文档」。
2. 点进面板 → 空态显示虚线框提示。
3. 拖两个文件进面板 → 出现在列表，大小/时间正确。
4. 再拖一个同名文件 → 出现 `xxx (2).ext`，原文件内容未变。
5. 双击/点击文件名 → 系统默认程序打开。
6. 点文件夹图标 → 访达/资源管理器定位到 `~/.wraith/documents/`。
7. 点删除一次 → 变勾；移开鼠标 → 复原；再点两次 → 文件消失。
8. 手动往 `~/.wraith/documents/` 扔一个文件，返回对话再进面板 → 新文件出现（验证「目录即真相源」）。

注意：本功能是纯 renderer + main 改动，**不涉及 Java**，无需 `mvn package` 或同步 `~/.wraith/wraith.jar`；改 renderer 走 HMR，改 main 需重启 `npm run dev`。
