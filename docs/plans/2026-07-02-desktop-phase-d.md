# Phase D 项目工作区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面端项目列表 + 单活跃切换:切换器(Popover)、切换自动恢复最近会话、移出/重命名/最近使用排序、Composer 重选目录汇流。

**Architecture:** Electron main 持有项目列表(`settings.json` 扩展 `projects` 数组,纯函数可单测),renderer 新增 ProjectSwitcher(Radix Popover)。切换 = `activateProject` 落盘 → 既有 `session.start {workspaceDir}` → `session.list` 非空则 `session.resume` 第一条(已核实按 updatedAt 倒序)。**Java 后端与协议零改动。**

**Tech Stack:** Electron 32 / React 18 / TS / Tailwind / Radix(新依赖 `@radix-ui/react-popover`)/ vitest / Playwright-electron。

**Spec:** `docs/specs/2026-07-02-desktop-phase-d-projects.md`(需求真源;冲突以 spec 为准)

## Global Constraints

- **Java/协议零改动**:`src/main/java` 与 wire 协议一行不动;合并前跑全量回归(`cd /Users/aa00945/Desktop/wraith && mvn test -DskipTests=false`)确认 3F/38E 基线(JDK26+Mockito 环境噪音)不动。
- 执行分支:`feat/desktop-phase-d`(从 main 切出;不在 main 上直接实现)。
- 单活跃守卫:turn running 时项目激活/添加被忽略(与现有 `state.turn === 'running'` 守卫惯例一致)。
- 失踪目录条目**保留置灰**(`exists:false`),不静默过滤。
- 移出/重命名是纯 settings 操作,**不删磁盘、不动 `~/.wraith` 会话历史**。
- E2E 新用例必须传 `WRAITH_E2E_USERDATA`(临时目录),避免写开发机真实 userData;E2E 模式(WRAITH_E2E=1)下 main **不跑迁移播种**,只认 `WRAITH_E2E_PROJECTS` 注入。
- 不动 `transcriptReducer.ts`(`resetSession`/`loadHistory`/`setSessionId`/`markStarted` 既有 action 够用)、不动 Composer.tsx(其 `onSwitchWorkspace` prop 由 App 换绑)。
- desktop 命令都在 `/Users/aa00945/Desktop/wraith/desktop` 下执行;vitest 全量当前 93 通过,Playwright 当前 21 通过,不得回归。
- 密钥永不入库;提交前对暂存文件 grep `api[_-]?key|secret|token|sk-|Bearer`;commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: 项目类型 + settings 纯函数(TDD)

**Files:**
- Modify: `desktop/src/shared/types.ts`(追加 ProjectView)
- Modify: `desktop/src/main/settings.ts`
- Test: `desktop/test/settings.test.ts`(追加 describe)

**Interfaces:**
- Consumes: 既有 `readSettings/writeSettings/resolvePersistedWorkspace`(settings.ts)。
- Produces(后续任务依赖,签名逐字):
  - `shared/types.ts`: `export interface ProjectView { path: string; name?: string; lastUsedAt: number; exists: boolean }`
  - `settings.ts`: `export interface ProjectEntry { path: string; name?: string; lastUsedAt: number }`;`Settings` 增 `projects?: ProjectEntry[]`
  - `upsertProject(userDataDir: string, projectPath: string, now: number): void`
  - `removeProject(userDataDir: string, projectPath: string): void`
  - `renameProject(userDataDir: string, projectPath: string, name: string): void`
  - `projectViews(userDataDir: string): ProjectView[]`(lastUsedAt 倒序 + exists)
  - `seedProjectsIfEmpty(userDataDir: string, now: number): void`(迁移播种)
  - `seedProjectsFromJson(userDataDir: string, json: string, now: number): void`(E2E 注入)

- [ ] **Step 1: 写失败测试**(`desktop/test/settings.test.ts` 追加;import 行并入文件顶部既有 import)

```ts
import {
  upsertProject,
  removeProject,
  renameProject,
  projectViews,
  seedProjectsIfEmpty,
  seedProjectsFromJson,
} from '../src/main/settings'

describe('projects', () => {
  it('upsertProject appends new entry with lastUsedAt', () => {
    upsertProject(dir, '/proj/a', 1000)
    expect(readSettings(dir).projects).toEqual([{ path: '/proj/a', lastUsedAt: 1000 }])
  })

  it('upsertProject dedupes by path, refreshes lastUsedAt, keeps name', () => {
    upsertProject(dir, '/proj/a', 1000)
    renameProject(dir, '/proj/a', '别名')
    upsertProject(dir, '/proj/a', 2000)
    expect(readSettings(dir).projects).toEqual([{ path: '/proj/a', name: '别名', lastUsedAt: 2000 }])
  })

  it('upsertProject preserves other settings keys', () => {
    persistWorkspace(dir, '/ws')
    upsertProject(dir, '/proj/a', 1000)
    expect(readSettings(dir).workspace).toBe('/ws')
  })

  it('removeProject removes only the matching path', () => {
    upsertProject(dir, '/proj/a', 1000)
    upsertProject(dir, '/proj/b', 2000)
    removeProject(dir, '/proj/a')
    expect(readSettings(dir).projects).toEqual([{ path: '/proj/b', lastUsedAt: 2000 }])
  })

  it('renameProject trims; empty string clears the alias', () => {
    upsertProject(dir, '/proj/a', 1000)
    renameProject(dir, '/proj/a', '  博客  ')
    expect(readSettings(dir).projects![0]!.name).toBe('博客')
    renameProject(dir, '/proj/a', '   ')
    expect(readSettings(dir).projects![0]!.name).toBeUndefined()
  })

  it('projectViews sorts by lastUsedAt desc and marks exists', () => {
    upsertProject(dir, path.join(dir, 'gone'), 1000) // 不存在
    upsertProject(dir, dir, 500) // 存在(临时目录本身)
    const views = projectViews(dir)
    expect(views.map(v => v.path)).toEqual([path.join(dir, 'gone'), dir])
    expect(views[0]!.exists).toBe(false)
    expect(views[1]!.exists).toBe(true)
  })

  it('seedProjectsIfEmpty seeds from valid persisted workspace once', () => {
    persistWorkspace(dir, dir)
    seedProjectsIfEmpty(dir, 1000)
    expect(readSettings(dir).projects).toEqual([{ path: dir, lastUsedAt: 1000 }])
    seedProjectsIfEmpty(dir, 2000) // 已非空 → 不重播
    expect(readSettings(dir).projects![0]!.lastUsedAt).toBe(1000)
  })

  it('seedProjectsIfEmpty does nothing when workspace invalid or absent', () => {
    seedProjectsIfEmpty(dir, 1000)
    expect(readSettings(dir).projects ?? []).toEqual([])
    persistWorkspace(dir, path.join(dir, 'gone'))
    seedProjectsIfEmpty(dir, 1000)
    expect(readSettings(dir).projects ?? []).toEqual([])
  })

  it('seedProjectsFromJson overwrites projects; bad JSON / non-array is a no-op', () => {
    upsertProject(dir, '/old', 1)
    seedProjectsFromJson(dir, JSON.stringify([{ path: '/a', lastUsedAt: 9 }, { path: '/b', name: 'B' }]), 100)
    const ps = readSettings(dir).projects!
    expect(ps[0]).toEqual({ path: '/a', lastUsedAt: 9 })
    expect(ps[1]!.path).toBe('/b')
    expect(ps[1]!.name).toBe('B')
    expect(typeof ps[1]!.lastUsedAt).toBe('number')
    seedProjectsFromJson(dir, 'not json', 200)
    expect(readSettings(dir).projects!.length).toBe(2) // 未被清掉
    seedProjectsFromJson(dir, '{"x":1}', 300)
    expect(readSettings(dir).projects!.length).toBe(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/settings.test.ts`
Expected: FAIL — `upsertProject` 等无导出。

- [ ] **Step 3: 实现**

`desktop/src/shared/types.ts` 追加(文件末尾):

```ts
/** 项目条目视图(main → renderer):settings.ProjectEntry + 目录存在性。 */
export interface ProjectView {
  path: string
  name?: string
  lastUsedAt: number
  exists: boolean
}
```

`desktop/src/main/settings.ts`:`Settings` 接口增字段、文件末尾追加(顶部补 `import type { ProjectView } from '../shared/types'`):

```ts
export interface ProjectEntry {
  path: string        // 绝对路径,唯一键(去重依据)
  name?: string       // 显示别名;缺省 UI 用目录名
  lastUsedAt: number  // epoch ms,最近使用排序
}

export interface Settings {
  /** Last workspace directory the user explicitly picked. */
  workspace?: string
  /** 打开过的项目列表(Phase D)。 */
  projects?: ProjectEntry[]
}

/** 按 path 去重插入/刷新 lastUsedAt;保留既有别名;其余 settings 键不动。 */
export function upsertProject(userDataDir: string, projectPath: string, now: number): void {
  const s = readSettings(userDataDir)
  const rest = (s.projects ?? []).filter(p => p.path !== projectPath)
  const existing = (s.projects ?? []).find(p => p.path === projectPath)
  writeSettings(userDataDir, {
    ...s,
    projects: [...rest, { ...existing, path: projectPath, lastUsedAt: now }],
  })
}

/** 仅移出列表;磁盘目录与 ~/.wraith 会话历史不动。 */
export function removeProject(userDataDir: string, projectPath: string): void {
  const s = readSettings(userDataDir)
  writeSettings(userDataDir, { ...s, projects: (s.projects ?? []).filter(p => p.path !== projectPath) })
}

/** 设别名(trim);空串清除别名(回退目录名)。 */
export function renameProject(userDataDir: string, projectPath: string, name: string): void {
  const s = readSettings(userDataDir)
  const trimmed = name.trim()
  const projects = (s.projects ?? []).map(p => {
    if (p.path !== projectPath) return p
    if (!trimmed) {
      const { name: _drop, ...restEntry } = p
      return restEntry
    }
    return { ...p, name: trimmed }
  })
  writeSettings(userDataDir, { ...s, projects })
}

/** lastUsedAt 倒序 + exists(失踪条目保留置灰,不静默过滤)。 */
export function projectViews(userDataDir: string): ProjectView[] {
  return (readSettings(userDataDir).projects ?? [])
    .slice()
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .map(p => {
      let exists = false
      try {
        exists = fs.statSync(p.path).isDirectory()
      } catch {
        // 不存在/不可达 → false
      }
      return { ...p, exists }
    })
}

/** 迁移播种:projects 为空且现有 workspace 有效 → 用它播一条(老用户无感升级)。 */
export function seedProjectsIfEmpty(userDataDir: string, now: number): void {
  if ((readSettings(userDataDir).projects ?? []).length > 0) return
  const ws = resolvePersistedWorkspace(userDataDir)
  if (ws) upsertProject(userDataDir, ws, now)
}

/** E2E 播种式注入:整体覆盖 projects;坏 JSON/非数组 no-op。 */
export function seedProjectsFromJson(userDataDir: string, json: string, now: number): void {
  let arr: unknown
  try {
    arr = JSON.parse(json)
  } catch {
    return
  }
  if (!Array.isArray(arr)) return
  const projects: ProjectEntry[] = arr
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as { path?: unknown }).path === 'string')
    .map((p, i) => ({
      path: p['path'] as string,
      ...(typeof p['name'] === 'string' && p['name'] ? { name: p['name'] as string } : {}),
      lastUsedAt: typeof p['lastUsedAt'] === 'number' ? (p['lastUsedAt'] as number) : now - i,
    }))
  const s = readSettings(userDataDir)
  writeSettings(userDataDir, { ...s, projects })
}
```

- [ ] **Step 4: 跑测试确认通过 + 全量 vitest**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run`
Expected: 全通过(93 + 新 9)。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/types.ts desktop/src/main/settings.ts desktop/test/settings.test.ts
git commit -m "feat(desktop): settings 项目列表纯函数(upsert/移出/重命名/排序/播种)"
```

---

### Task 2: main IPC + preload API(pickWorkspace 退役)

**Files:**
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/index.ts`

**Interfaces:**
- Consumes(Task 1): `upsertProject/removeProject/renameProject/projectViews/seedProjectsIfEmpty/seedProjectsFromJson`、`ProjectView`。
- Produces(Task 4/5 依赖):
  - `window.wraith.listProjects(): Promise<{ projects: ProjectView[] }>`
  - `window.wraith.activateProject(path: string): Promise<{ ok: boolean }>`
  - `window.wraith.addProject(): Promise<string | null>`(E2E 复用 `WRAITH_E2E_PICK`)
  - `window.wraith.removeProject(path: string): Promise<void>`
  - `window.wraith.renameProject(path: string, name: string): Promise<void>`
  - `window.wraith.pickWorkspace` **删除**(无调用方后退役)
  - env:`WRAITH_E2E_USERDATA`(userData 重定向)、`WRAITH_E2E_PROJECTS`(播种注入)

- [ ] **Step 1: main/index.ts 改动**

顶部 import 增两行(fs 与 settings 函数):

```ts
import fs from 'fs'
import {
  resolvePersistedWorkspace,
  persistWorkspace,
  upsertProject,
  removeProject,
  renameProject,
  projectViews,
  seedProjectsIfEmpty,
  seedProjectsFromJson,
} from './settings'
```

(替换原 `import { resolvePersistedWorkspace, persistWorkspace } from './settings'`。)

import 块之后、State 区之前加 userData 重定向(必须在任何 `app.getPath` 之前):

```ts
// E2E:userData 重定向到临时目录,settings 读写不污染真实应用数据
if (process.env['WRAITH_E2E_USERDATA']) {
  app.setPath('userData', process.env['WRAITH_E2E_USERDATA'])
}
```

删除整个 `ipcMain.handle('wraith:pickWorkspace', …)` 块(index.ts:201-217),原位换成:

```ts
ipcMain.handle('wraith:listProjects', async () => {
  return { projects: projectViews(app.getPath('userData')) }
})

/** 激活项目:目录校验 → upsert 刷 lastUsedAt → 持久化为当前 workspace。 */
ipcMain.handle('wraith:activateProject', async (_e, projectPath: string) => {
  try {
    if (!fs.statSync(projectPath).isDirectory()) return { ok: false }
  } catch {
    return { ok: false } // 不存在/不可达 → 前端刷新列表置灰
  }
  const ud = app.getPath('userData')
  upsertProject(ud, projectPath, Date.now())
  persistWorkspace(ud, projectPath)
  return { ok: true }
})

/** 添加项目:弹目录选择框,选中即入列表并激活(取消返回 null)。 */
ipcMain.handle('wraith:addProject', async () => {
  const ud = app.getPath('userData')
  let picked: string | null
  if (process.env['WRAITH_E2E'] === '1') {
    picked = process.env['WRAITH_E2E_PICK'] ?? null // unset → null → 取消/no-op
  } else {
    const current = resolvePersistedWorkspace(ud) ?? os.homedir()
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: current
    })
    picked = result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!
  }
  if (!picked) return null
  upsertProject(ud, picked, Date.now())
  persistWorkspace(ud, picked)
  return picked
})

ipcMain.handle('wraith:removeProject', async (_e, projectPath: string) => {
  removeProject(app.getPath('userData'), projectPath)
})

ipcMain.handle('wraith:renameProject', async (_e, projectPath: string, name: string) => {
  renameProject(app.getPath('userData'), projectPath, name)
})
```

`app.whenReady()` 回调开头(createWindow 之前)加播种/迁移:

```ts
app.whenReady().then(() => {
  const ud = app.getPath('userData')
  const injected = process.env['WRAITH_E2E_PROJECTS']
  if (process.env['WRAITH_E2E'] === '1') {
    // E2E 只认注入,不跑迁移(未注入 USERDATA 的旧用例不该写真实 userData)
    if (injected) seedProjectsFromJson(ud, injected, Date.now())
  } else {
    seedProjectsIfEmpty(ud, Date.now())
  }
  createWindow()
  spawnBackend()
  // …(activate 监听不动)
```

- [ ] **Step 2: preload/index.ts 改动**

`WraithApi` 接口:删 `pickWorkspace(): Promise<string | null>`,原位换成:

```ts
  listProjects(): Promise<{ projects: ProjectView[] }>
  activateProject(path: string): Promise<{ ok: boolean }>
  addProject(): Promise<string | null>
  removeProject(path: string): Promise<void>
  renameProject(path: string, name: string): Promise<void>
```

实现对象:删 `pickWorkspace` 方法,原位换成:

```ts
  listProjects() {
    return ipcRenderer.invoke('wraith:listProjects') as Promise<{ projects: ProjectView[] }>
  },

  activateProject(path) {
    return ipcRenderer.invoke('wraith:activateProject', path) as Promise<{ ok: boolean }>
  },

  addProject() {
    return ipcRenderer.invoke('wraith:addProject') as Promise<string | null>
  },

  removeProject(path) {
    return ipcRenderer.invoke('wraith:removeProject', path) as Promise<void>
  },

  renameProject(path, name) {
    return ipcRenderer.invoke('wraith:renameProject', path, name) as Promise<void>
  },
```

顶部 import type 行加 `ProjectView`:

```ts
import type { BackendEvent, SessionMeta, ResumedMessage, ProjectView } from '../shared/types'
```

- [ ] **Step 3: 门禁**(App.tsx 仍引用旧 API 会在此暴露——本任务后 renderer 暂时编译不过是**预期外**;实际上 App.tsx 此时还在调 `pickWorkspace`,typecheck 必红。处理:本任务只跑 vitest 回归,typecheck 门挪到 Task 4 完成后)

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run`
Expected: 全通过(vitest 不含 App.tsx 编译)。

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx tsc --noEmit -p tsconfig.json; echo "exit=$?"`
Expected: **仅** App.tsx 上 `pickWorkspace` 不存在的报错(记录条数,Task 4 清零);settings/preload/main 自身无错。

- [ ] **Step 4: Commit**

```bash
git add desktop/src/main/index.ts desktop/src/preload/index.ts
git commit -m "feat(desktop): 项目列表 IPC(list/activate/add/remove/rename),pickWorkspace 退役"
```

---

### Task 3: Popover UI + ProjectSwitcher 组件 + Sidebar 集成

**Files:**
- Create: `desktop/src/renderer/components/ui/popover.tsx`
- Create: `desktop/src/renderer/components/ProjectSwitcher.tsx`
- Modify: `desktop/src/renderer/components/Sidebar.tsx`
- Modify: `desktop/package.json`(新依赖)

**Interfaces:**
- Consumes: `ProjectView`(Task 1)、`baseName`(`../lib/paths`)、`cn`(`../../lib/utils`)。
- Produces(Task 4 依赖):
  - `ProjectSwitcher` props: `{ projects: ProjectView[]; activePath: string; busy: boolean; onActivate: (path: string) => void; onAdd: () => void; onRemove: (path: string) => void; onRename: (path: string, name: string) => void }`
  - `Sidebar` props 扩展(完整见 Step 3):增 `projects/busy/onActivateProject/onAddProject/onRemoveProject/onRenameProject`
  - testid:`project-switcher`(触发钮)、`project-item`、`project-rename`、`project-rename-input`、`project-remove`、`project-add`

- [ ] **Step 1: 装依赖**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm install @radix-ui/react-popover@^1.1.1`
Expected: package.json dependencies 出现该项,与既有 @radix-ui/* 同 1.1 版本线。

- [ ] **Step 2: `ui/popover.tsx`**(照 `ui/tooltip.tsx` 的 shadcn 包装风格)

```tsx
import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '../../lib/utils'

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-64 rounded-lg border border-border bg-surface p-1 shadow-md',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = 'PopoverContent'

export { Popover, PopoverTrigger, PopoverContent }
```

- [ ] **Step 3: `ProjectSwitcher.tsx`**

```tsx
import { useState } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { baseName } from '../lib/paths'
import type { ProjectView } from '../../shared/types'

interface ProjectSwitcherProps {
  projects: ProjectView[]
  /** 当前活跃项目路径(= state.workspace)。 */
  activePath: string
  /** turn 运行中:禁激活/添加;重命名与移出不受限(纯 settings 操作)。 */
  busy: boolean
  onActivate: (path: string) => void
  onAdd: () => void
  onRemove: (path: string) => void
  onRename: (path: string, name: string) => void
}

export default function ProjectSwitcher({
  projects,
  activePath,
  busy,
  onActivate,
  onAdd,
  onRemove,
  onRename,
}: ProjectSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const displayName = (p: ProjectView): string => p.name || baseName(p.path)
  const active = projects.find(p => p.path === activePath)

  return (
    <Popover
      open={open}
      onOpenChange={o => {
        setOpen(o)
        if (!o) setRenaming(null)
      }}
    >
      <PopoverTrigger asChild>
        <button
          data-testid="project-switcher"
          title={activePath || '默认工作目录'}
          className="mx-3 mb-1 flex w-[calc(100%-1.5rem)] items-center gap-1 rounded-lg border border-border bg-surface/60 px-3 py-2 text-left text-xs text-fg hover:border-accent"
        >
          <span className="truncate">📁 {active ? displayName(active) : baseName(activePath)}</span>
          <span className="ml-auto shrink-0 text-fg-subtle">▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent>
        {projects.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-fg-subtle">还没有项目</div>
        )}
        {projects.map(p =>
          renaming === p.path ? (
            <input
              key={p.path}
              data-testid="project-rename-input"
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  setRenaming(null)
                  onRename(p.path, draft)
                }
                if (e.key === 'Escape') setRenaming(null)
              }}
              className="mb-0.5 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
            />
          ) : (
            <div key={p.path} className="group mb-0.5 flex items-center gap-1">
              <button
                data-testid="project-item"
                disabled={busy || !p.exists}
                title={p.exists ? p.path : '目录不存在'}
                onClick={() => {
                  setOpen(false)
                  if (p.path !== activePath) onActivate(p.path) // 点当前项目=只收面板
                }}
                className={
                  'flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs disabled:opacity-60 ' +
                  (p.path === activePath
                    ? 'bg-surface text-fg'
                    : 'text-fg-muted enabled:hover:bg-surface/60')
                }
              >
                {displayName(p)}
                {p.path === activePath ? ' ✓' : ''}
              </button>
              <button
                data-testid="project-rename"
                title="重命名"
                onClick={() => {
                  setRenaming(p.path)
                  setDraft(p.name ?? '')
                }}
                className="hidden shrink-0 rounded p-1 text-xs text-fg-subtle hover:text-accent group-hover:block"
              >
                ✎
              </button>
              <button
                data-testid="project-remove"
                title={p.path === activePath ? '当前项目不可移出' : '移出列表(不删磁盘)'}
                disabled={p.path === activePath}
                onClick={() => onRemove(p.path)}
                className="hidden shrink-0 rounded p-1 text-xs text-fg-subtle hover:text-danger disabled:opacity-40 group-hover:block"
              >
                ✕
              </button>
            </div>
          ),
        )}
        <div className="my-1 border-t border-border" />
        <button
          data-testid="project-add"
          disabled={busy}
          onClick={() => {
            setOpen(false)
            onAdd()
          }}
          className="w-full rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60 disabled:opacity-60"
        >
          ＋ 添加项目…
        </button>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 4: Sidebar.tsx 集成**

Props 接口整体替换为:

```ts
interface SidebarProps {
  workspace: string
  projects: ProjectView[]
  busy: boolean
  sessions: SessionMeta[]
  activeSessionId: string
  onNewConversation: () => void
  onSelectSession: (id: string) => void
  onActivateProject: (path: string) => void
  onAddProject: () => void
  onRemoveProject: (path: string) => void
  onRenameProject: (path: string, name: string) => void
  sandbox: 'macos-seatbelt' | 'none' | 'unknown'
}
```

import 增:

```ts
import ProjectSwitcher from './ProjectSwitcher'
import type { SessionMeta, ProjectView } from '../../shared/types'
```

(替换原 `import type { SessionMeta } from '../../shared/types'`;`baseName` import 删除——footer 不再用。)

三处 JSX 改动:

1. logo `<div>` 之后、「新对话」`<div className="px-3">` 之前插:

```tsx
        <ProjectSwitcher
          projects={projects}
          activePath={workspace}
          busy={busy}
          onActivate={onActivateProject}
          onAdd={onAddProject}
          onRemove={onRemoveProject}
          onRename={onRenameProject}
        />
```

2. `NAV` 数组删 `{ key: 'projects', label: '项目', hint: '多项目在 Phase D' }` 一行(Phase D 兑现)。

3. footer 删 `📁 {baseName(workspace)}` 那个 `<div>`(连同 truncate 容器),sandbox 徽标 `<div>` 保留;函数签名解构参数同步加新 props。

- [ ] **Step 5: 门禁**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx tsc --noEmit -p tsconfig.json; echo "exit=$?"`
Expected: 新增文件无错;报错仍只剩 App.tsx(旧 `pickWorkspace`/`handleSwitchWorkspace` + Sidebar 新必填 props 未传——Task 4 清零)。

- [ ] **Step 6: Commit**

```bash
git add desktop/package.json desktop/package-lock.json desktop/src/renderer/components/ui/popover.tsx desktop/src/renderer/components/ProjectSwitcher.tsx desktop/src/renderer/components/Sidebar.tsx
git commit -m "feat(desktop): ProjectSwitcher 切换器组件 + Sidebar 集成(Popover)"
```

---

### Task 4: App.tsx 切换流 + 入口汇流

**Files:**
- Modify: `desktop/src/renderer/App.tsx`

**Interfaces:**
- Consumes: Task 2 的 `window.wraith.*` 新 API;Task 3 的 Sidebar props;既有 `messagesToItems`、`resetSession`/`loadHistory`/`setSessionId`/`markStarted` action、`statusThrottleRef.cancel()` 惯例。
- Produces: 无(顶层装配)。

- [ ] **Step 1: 状态与 fetchProjects**

import type 行加 `ProjectView`(`../shared/types`)。`const [sessions, setSessions] = useState<SessionMeta[]>([])` 下一行加:

```ts
  const [projects, setProjects] = useState<ProjectView[]>([])
```

`fetchSessions` callback 之后加:

```ts
  const fetchProjects = useCallback(async () => {
    try {
      const { projects } = await window.wraith.listProjects()
      setProjects(projects)
    } catch (err) {
      console.error('[wraith] listProjects error:', err)
    }
  }, [])
```

- [ ] **Step 2: 切换流(替换整个 handleSwitchWorkspace 块)**

删 `handleSwitchWorkspace`(App.tsx:345-357),原位换成:

```ts
  // ── project switch(激活 + 自动恢复最近会话)─────────────────────────────
  const switchToProject = useCallback(
    async (projectPath: string) => {
      if (state.turn === 'running') return
      try {
        const { ok } = await window.wraith.activateProject(projectPath)
        if (!ok) {
          void fetchProjects() // 目录失踪 → 条目置灰,状态不变
          return
        }
        statusThrottleRef.current?.cancel()
        await window.wraith.startSession(projectPath)
        dispatch({ type: 'resetSession', ws: projectPath })
        const { sessions } = await window.wraith.listSessions()
        setSessions(sessions)
        if (sessions.length > 0) {
          // session.list 按 updatedAt 倒序:第一条即最近会话
          const { sessionId, messages } = await window.wraith.resumeSession(sessions[0]!.id)
          dispatch({ type: 'loadHistory', items: messagesToItems(messages) })
          dispatch({ type: 'setSessionId', sessionId })
          dispatch({ type: 'markStarted' })
        }
        void fetchProjects() // lastUsedAt 刷新 → 浮顶
      } catch (err) {
        console.error('[wraith] switchToProject error:', err)
        void fetchProjects()
      }
    },
    [state.turn, fetchProjects],
  )

  // 添加项目(=Composer 重选目录汇流入口):选目录 → 入列表 → 切换
  const handleAddProject = useCallback(async () => {
    if (state.turn === 'running') return
    try {
      const picked = await window.wraith.addProject()
      if (!picked) return
      void fetchProjects() // addProject 已 upsert;先刷列表
      if (picked !== state.workspace) await switchToProject(picked)
    } catch (err) {
      console.error('[wraith] addProject error:', err)
    }
  }, [state.turn, state.workspace, fetchProjects, switchToProject])

  const handleRemoveProject = useCallback(
    async (projectPath: string) => {
      try {
        await window.wraith.removeProject(projectPath)
        void fetchProjects()
      } catch (err) {
        console.error('[wraith] removeProject error:', err)
      }
    },
    [fetchProjects],
  )

  const handleRenameProject = useCallback(
    async (projectPath: string, name: string) => {
      try {
        await window.wraith.renameProject(projectPath, name)
        void fetchProjects()
      } catch (err) {
        console.error('[wraith] renameProject error:', err)
      }
    },
    [fetchProjects],
  )
```

- [ ] **Step 3: 启动 effect 加项目拉取**

startup effect 里 `void fetchSessions()` 后加一行 `void fetchProjects()`;effect 依赖数组 `[fetchSessions]` 改 `[fetchSessions, fetchProjects]`。

- [ ] **Step 4: JSX 换绑**

Sidebar 传参(整体替换):

```tsx
      <Sidebar
        workspace={state.workspace}
        projects={projects}
        busy={state.turn === 'running'}
        sessions={sessions}
        activeSessionId={state.sessionId}
        onNewConversation={handleNewConversation}
        onSelectSession={handleSelectSession}
        onActivateProject={switchToProject}
        onAddProject={handleAddProject}
        onRemoveProject={handleRemoveProject}
        onRenameProject={handleRenameProject}
        sandbox={state.sandbox}
      />
```

Composer 的 `onSwitchWorkspace={handleSwitchWorkspace}` 改 `onSwitchWorkspace={handleAddProject}`(Composer.tsx 自身不动)。

- [ ] **Step 5: 门禁(全绿点)**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run build`
Expected: typecheck 0 错(Task 2/3 挂账清零)、vitest 全过、build 成功。

- [ ] **Step 6: Commit**

```bash
git add desktop/src/renderer/App.tsx
git commit -m "feat(desktop): 项目切换流(激活+自动恢复最近会话),重选目录汇流 addProject"
```

---

### Task 5: mock 多工作区 + E2E(T22–T25 + Test 4 适配)

**Files:**
- Modify: `desktop/test/fixtures/mock-appserver.mjs`
- Modify: `desktop/test/e2e/shell.e2e.ts`

**Interfaces:**
- Consumes: Task 2 env(`WRAITH_E2E_USERDATA`/`WRAITH_E2E_PROJECTS`/`WRAITH_E2E_PICK`)、Task 3 testid、mock 既有 record 机制(`WRAITH_E2E_RECORD` 落盘 JSONL,`session.resume` 返回 `之前问的问题/之前的**回答**`)。
- Produces: env `MOCK_SESSIONS_BY_WS`(JSON map `{ [workspaceDir]: SessionMeta[] }`;未命中返回 `[]`;未设维持现状静态两条)。

- [ ] **Step 1: mock-appserver.mjs**

`case 'session.start'` 改为(记录 workspaceDir;顶部状态区加 `let lastWorkspaceDir = null`,与 `sessionCounter` 同区):

```js
    case 'session.start': {
      sessionId = `sess_mock_${++sessionCounter}`
      lastWorkspaceDir = (params && params.workspaceDir) || null
      reply(id, { sessionId })
      break
    }
```

`case 'session.list'` 改为:

```js
    case 'session.list': {
      const byWs = process.env['MOCK_SESSIONS_BY_WS']
      if (byWs) {
        let map = {}
        try { map = JSON.parse(byWs) } catch { /* 坏 JSON → 空 map */ }
        reply(id, { sessions: (lastWorkspaceDir && map[lastWorkspaceDir]) || [] })
        break
      }
      reply(id, {
        sessions: [
          { id: 'sess_a', cwd: '/p', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T01:00:00Z', provider: 'mock', model: 'mock-model', title: '第一段对话', turns: 2 },
          { id: 'sess_b', cwd: '/p', createdAt: '2026-06-30T00:00:00Z', updatedAt: '2026-06-30T01:00:00Z', provider: 'mock', model: 'mock-model', title: '早先的对话', turns: 5 }
        ]
      })
      break
    }
```

- [ ] **Step 2: Test 4 适配**(重选目录 → addProject 汇流后,切换会 auto-resume;旧断言「回欢迎态」只在新目录无会话时成立)

Test 4(`workspace switch re-picks dir …`)env 增两行:

```ts
      WRAITH_E2E_USERDATA: fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-')),
      MOCK_SESSIONS_BY_WS: '{}', // repickDir 无历史 → 切换后仍是欢迎态(原断言保持)
```

(temp userData 目录在 `app.close()` 后一并 `fs.rmSync`;断言不变——`session.start` 第二发带 repickDir + `今天做点什么？` 可见。)

- [ ] **Step 3: 新用例 T22–T25**(追加到文件尾;沿用文件既有 helper/常量:`mainPath`/`mockPath`/`electron`/`expect`)

```ts
// ---------------------------------------------------------------------------
// T22: 项目切换器 — 切换项目 → session.start 新目录 + 自动恢复最近会话
// ---------------------------------------------------------------------------

test('T22 项目切换:session.start 带新目录且自动恢复最近会话', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-t22.jsonl`)
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-a-'))
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-b-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t22-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile,
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_WORKSPACE: dirA,
      WRAITH_E2E_PROJECTS: JSON.stringify([
        { path: dirA, lastUsedAt: 2000 },
        { path: dirB, lastUsedAt: 1000 }
      ]),
      MOCK_SESSIONS_BY_WS: JSON.stringify({
        [dirB]: [
          { id: 'sess_b1', cwd: dirB, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T01:00:00Z', provider: 'mock', model: 'mock-model', title: 'B 项目的对话', turns: 1 }
        ]
      })
    }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="project-switcher"]')).toBeVisible({ timeout: 15000 })

  await win.locator('[data-testid="project-switcher"]').click()
  const items = win.locator('[data-testid="project-item"]')
  await expect(items).toHaveCount(2)
  await items.nth(1).click() // dirB(lastUsedAt 小,排第二)

  // session.start 带 dirB
  await expect
    .poll(() => {
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      return lines.some(l => l.method === 'session.start' && l.params?.workspaceDir === dirB)
    }, { timeout: 10000 })
    .toBe(true)

  // 自动恢复:mock session.resume 的回放内容出现在 transcript
  await expect(win.locator('text=之前问的问题')).toBeVisible({ timeout: 10000 })

  await app.close()
  for (const p of [recordFile]) fs.rmSync(p, { force: true })
  for (const p of [dirA, dirB, userData]) fs.rmSync(p, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// T23: 项目切换 — 目标项目无历史 → 回欢迎空态(往返)
// ---------------------------------------------------------------------------

test('T23 切到无历史项目回欢迎态', async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-a-'))
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-b-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t23-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_WORKSPACE: dirA,
      WRAITH_E2E_PROJECTS: JSON.stringify([
        { path: dirA, lastUsedAt: 2000 },
        { path: dirB, lastUsedAt: 1000 }
      ]),
      MOCK_SESSIONS_BY_WS: JSON.stringify({
        [dirB]: [
          { id: 'sess_b1', cwd: dirB, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T01:00:00Z', provider: 'mock', model: 'mock-model', title: 'B 项目的对话', turns: 1 }
        ]
      })
    }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="project-switcher"]')).toBeVisible({ timeout: 15000 })

  // 先切到 B(有历史 → transcript)
  await win.locator('[data-testid="project-switcher"]').click()
  await win.locator('[data-testid="project-item"]').nth(1).click()
  await expect(win.locator('[data-testid="transcript"]')).toBeVisible({ timeout: 10000 })

  // 再切回 A(无历史 → 欢迎态);B 刚被激活浮顶,A 现在排第二
  await win.locator('[data-testid="project-switcher"]').click()
  await win.locator('[data-testid="project-item"]').nth(1).click()
  await expect(win.locator('text=今天做点什么？')).toBeVisible({ timeout: 10000 })

  await app.close()
  for (const p of [dirA, dirB, userData]) fs.rmSync(p, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// T24: 项目管理 — 重命名别名 + 移出列表
// ---------------------------------------------------------------------------

test('T24 项目重命名与移出', async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-a-'))
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-b-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t24-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_WORKSPACE: dirA,
      WRAITH_E2E_PROJECTS: JSON.stringify([
        { path: dirA, lastUsedAt: 2000 },
        { path: dirB, lastUsedAt: 1000 }
      ]),
      MOCK_SESSIONS_BY_WS: '{}'
    }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="project-switcher"]')).toBeVisible({ timeout: 15000 })
  await win.locator('[data-testid="project-switcher"]').click()

  // 重命名 B(非活跃,第 2 行):hover 露钮 → 内联输入 → Enter
  const rowB = win.locator('[data-testid="project-item"]').nth(1)
  await rowB.hover()
  await win.locator('[data-testid="project-rename"]').nth(1).click()
  await win.locator('[data-testid="project-rename-input"]').fill('我的博客')
  await win.locator('[data-testid="project-rename-input"]').press('Enter')
  await expect(win.locator('[data-testid="project-item"]').nth(1)).toHaveText(/我的博客/, { timeout: 5000 })

  // 移出 B:hover 露钮 → 单击生效(无二次确认);活跃项 A 的移出钮 disabled
  await expect(win.locator('[data-testid="project-remove"]').nth(0)).toBeDisabled()
  await win.locator('[data-testid="project-item"]').nth(1).hover()
  await win.locator('[data-testid="project-remove"]').nth(1).click()
  await expect(win.locator('[data-testid="project-item"]')).toHaveCount(1, { timeout: 5000 })

  await app.close()
  for (const p of [dirA, dirB, userData]) fs.rmSync(p, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// T25: 单活跃守卫 — turn 运行中项目激活/添加禁用
// ---------------------------------------------------------------------------

test('T25 运行中项目切换被禁', async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-a-'))
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-b-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t25-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_WORKSPACE: dirA,
      WRAITH_E2E_PROJECTS: JSON.stringify([
        { path: dirA, lastUsedAt: 2000 },
        { path: dirB, lastUsedAt: 1000 }
      ]),
      MOCK_SESSIONS_BY_WS: '{}',
      MOCK_SLOW_TURN: '1'
    }
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  await input.fill('慢轮次')
  await input.press('Enter')
  await expect(win.locator('[data-testid="interrupt"]')).toBeVisible({ timeout: 10000 }) // running 确立

  await win.locator('[data-testid="project-switcher"]').click()
  await expect(win.locator('[data-testid="project-item"]').nth(1)).toBeDisabled()
  await expect(win.locator('[data-testid="project-add"]')).toBeDisabled()

  await app.close()
  for (const p of [dirA, dirB, userData]) fs.rmSync(p, { recursive: true, force: true })
})
```

- [ ] **Step 4: 跑 E2E 全量**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run e2e`
Expected: 25/25 通过(21 旧含适配后的 Test 4 + 新 4)。

- [ ] **Step 5: Commit**

```bash
git add desktop/test/fixtures/mock-appserver.mjs desktop/test/e2e/shell.e2e.ts
git commit -m "test(desktop): E2E 项目切换 T22-T25 + mock 多工作区会话(MOCK_SESSIONS_BY_WS)"
```

---

### Task 6: ROADMAP 更新

**Files:**
- Modify: `docs/ROADMAP.md`

**Interfaces:** 无(纯文档)。

- [ ] **Step 1: 编辑**

1. 「已实现 ✅」表尾追加一行:

```markdown
| **Phase D** 项目工作区 | 项目列表 + 单活跃切换(settings `projects` 持久化/迁移播种);侧栏 ProjectSwitcher(Popover):切换自动恢复最近会话、移出/重命名/最近使用排序、失踪目录置灰;Composer 重选目录汇流 addProject(`pickWorkspace` 退役);E2E userData 隔离(`WRAITH_E2E_USERDATA`) | Java 后端零改动;vitest 102、Playwright 25/25;spec/plan `docs/*/2026-07-02-desktop-phase-d*.md` |
```

(vitest/Playwright 数字以实测为准填写。)

2. 「进行中 🟡」段落改为:

```markdown
（无——Phase A、B、C、D 已合并 main。下一阶段 **Phase E**（插件/自动化:MCP 插件管理 UI、自动化流程)待启动。）
```

3. 「未实现 ⬜」表删 Phase D 行。

4. 「待眼验」清单追加:

```markdown
- **Phase D 新增**——两真实目录来回切:会话隔离(`~/.wraith/sessions/<hash>` 不串)+ 切换自动恢复最近会话 + 移出/重命名落盘 `settings.json`。
```

5. 顶部「最后更新」日期改 `2026-07-02`。

- [ ] **Step 2: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): Phase D 项目工作区标记已实现"
```

---

## 收尾(计划外置,执行技能接管)

全任务完成后:整支终审(最强模型)→ 修复波 → `cd /Users/aa00945/Desktop/wraith && mvn test -DskipTests=false` 全量回归(3F/38E 基线)→ merge --no-ff 回 main → push。
