# 桌面底部终端抽屉(A1)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主窗右上角按钮开/关一个底部停靠终端抽屉,多标签、每标签一个 node-pty 真 PTY,用 xterm.js 渲染,可执行任意 shell 命令。

**Architecture:** 纯函数(resolveShell / 标签 reducer)先落地并单测;主进程 `PtyManager`(node-pty)+ IPC 把 PTY 流到渲染;渲染 `TerminalDrawer`(标签栏+拖拽调高,全标签常挂 CSS 显隐)托管每标签一个 `TerminalTab`(xterm)。node-pty 是原生模块,需 external + electron-rebuild + asarUnpack。

**Tech Stack:** Electron + electron-vite;主进程 TS(`desktop/src/main/`)、渲染 React/TS(`desktop/src/renderer/`);node-pty、@xterm/xterm、@xterm/addon-fit;vitest。

## Global Constraints

- 纯函数与 node-pty **隔离**:`resolveShell` 放 `ptyHelpers.ts`(不 import node-pty),标签逻辑放 `terminalTabs.ts`(渲染侧);`pty.ts`(import node-pty)只做集成、不进 vitest。测试绝不 import node-pty(其为 Electron ABI 原生模块,plain node 加载失败)。
- 默认:新终端 cwd=**当前项目工作区**(App 活跃 workspace;缺省 `os.homedir()`);shell=**`$SHELL`**(缺省 darwin `/bin/zsh`、win `COMSPEC||powershell.exe`、其它 `/bin/bash`);抽屉默认高 ≈ 内容区 38%,顶边拖拽(min 120px / max 80vh);抽屉收起**保留** PTY,关标签才 kill,退出 app `killAll`。
- node-pty 必须在 `dependencies`(非 dev)且在 `electron.vite.config` main 里 `external`;electron-builder `asarUnpack` 之;安装后 `electron-rebuild` 按 Electron ABI 重建。
- 测试:vitest `cd desktop && npx vitest run <file>`;typecheck `npx tsc --noEmit -p tsconfig.json`。改主进程/preload 需重启 dev 眼验。
- 失败不崩主窗:ptyCreate 失败→标签显错;PTY 退出→标签显"已退出"。

---

### Task 1: `resolveShell` 纯函数

**Files:**
- Create: `desktop/src/main/ptyHelpers.ts`
- Test: `desktop/test/ptyHelpers.test.ts`

**Interfaces:**
- Produces: `resolveShell(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string`

- [ ] **Step 1: 写失败测试**

```ts
// desktop/test/ptyHelpers.test.ts
import { describe, it, expect } from 'vitest'
import { resolveShell } from '../src/main/ptyHelpers'

describe('resolveShell', () => {
  it('非 win 且有 $SHELL → 用 $SHELL', () => {
    expect(resolveShell({ SHELL: '/usr/bin/fish' }, 'darwin')).toBe('/usr/bin/fish')
    expect(resolveShell({ SHELL: '/bin/bash' }, 'linux')).toBe('/bin/bash')
  })
  it('darwin 无 $SHELL → /bin/zsh', () => {
    expect(resolveShell({}, 'darwin')).toBe('/bin/zsh')
  })
  it('linux 无 $SHELL → /bin/bash', () => {
    expect(resolveShell({}, 'linux')).toBe('/bin/bash')
  })
  it('win32 → COMSPEC 或 powershell(忽略 $SHELL)', () => {
    expect(resolveShell({ COMSPEC: 'C:\\\\cmd.exe', SHELL: '/bin/zsh' }, 'win32')).toBe('C:\\\\cmd.exe')
    expect(resolveShell({}, 'win32')).toBe('powershell.exe')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/ptyHelpers.test.ts`
Expected: FAIL(`resolveShell` 未定义)

- [ ] **Step 3: 实现**

```ts
// desktop/src/main/ptyHelpers.ts
/** 选择要 spawn 的 shell:非 win 优先 $SHELL;win 用 COMSPEC;否则平台默认。 */
export function resolveShell(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform === 'win32') return env.COMSPEC || 'powershell.exe'
  if (env.SHELL && env.SHELL.trim()) return env.SHELL
  return platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/ptyHelpers.test.ts`
Expected: PASS(5 断言)

- [ ] **Step 5: 提交**

```bash
git add desktop/src/main/ptyHelpers.ts desktop/test/ptyHelpers.test.ts
git commit -m "feat(desktop/term): resolveShell 纯函数 + 单测"
```

---

### Task 2: 标签状态纯函数 `terminalTabs.ts`

**Files:**
- Create: `desktop/src/renderer/lib/terminalTabs.ts`
- Test: `desktop/test/terminalTabs.test.ts`

**Interfaces:**
- Produces:
  - `interface TermTab { id: string; label: string }`
  - `interface TabsState { tabs: TermTab[]; activeId: string | null }`
  - `addTab(state: TabsState, tab: TermTab): TabsState` — 追加并激活新标签
  - `closeTab(state: TabsState, id: string): TabsState` — 移除;若关的是活跃标签则激活相邻(优先前一个,否则后一个);空则 activeId=null
  - `setActive(state: TabsState, id: string): TabsState`
  - `shortTabLabel(cwd: string, index: number): string` — cwd 的 basename;空则 `终端 {index+1}`

- [ ] **Step 1: 写失败测试**

```ts
// desktop/test/terminalTabs.test.ts
import { describe, it, expect } from 'vitest'
import { addTab, closeTab, setActive, shortTabLabel, type TabsState } from '../src/renderer/lib/terminalTabs'

const empty: TabsState = { tabs: [], activeId: null }

describe('addTab', () => {
  it('追加并激活新标签', () => {
    const s = addTab(empty, { id: 'a', label: 'A' })
    expect(s.tabs.map(t => t.id)).toEqual(['a'])
    expect(s.activeId).toBe('a')
    const s2 = addTab(s, { id: 'b', label: 'B' })
    expect(s2.tabs.map(t => t.id)).toEqual(['a', 'b'])
    expect(s2.activeId).toBe('b')
  })
})

describe('closeTab', () => {
  const three: TabsState = { tabs: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], activeId: 'b' }
  it('关活跃标签 → 激活前一个', () => {
    const s = closeTab(three, 'b')
    expect(s.tabs.map(t => t.id)).toEqual(['a', 'c'])
    expect(s.activeId).toBe('a')
  })
  it('关第一个(活跃)→ 激活后一个', () => {
    const s = closeTab({ ...three, activeId: 'a' }, 'a')
    expect(s.activeId).toBe('b')
  })
  it('关非活跃标签 → 活跃不变', () => {
    const s = closeTab(three, 'c')
    expect(s.activeId).toBe('b')
  })
  it('关到空 → activeId null', () => {
    const s = closeTab({ tabs: [{ id: 'a', label: 'A' }], activeId: 'a' }, 'a')
    expect(s.tabs).toEqual([])
    expect(s.activeId).toBeNull()
  })
})

describe('setActive', () => {
  it('切换活跃', () => {
    const s = setActive({ tabs: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], activeId: 'a' }, 'b')
    expect(s.activeId).toBe('b')
  })
})

describe('shortTabLabel', () => {
  it('取 cwd basename', () => {
    expect(shortTabLabel('/Users/x/proj', 0)).toBe('proj')
    expect(shortTabLabel('/Users/x/proj/', 0)).toBe('proj')
  })
  it('空 cwd → 终端 N', () => {
    expect(shortTabLabel('', 0)).toBe('终端 1')
    expect(shortTabLabel('', 2)).toBe('终端 3')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/terminalTabs.test.ts`
Expected: FAIL(模块/导出不存在)

- [ ] **Step 3: 实现**

```ts
// desktop/src/renderer/lib/terminalTabs.ts
export interface TermTab { id: string; label: string }
export interface TabsState { tabs: TermTab[]; activeId: string | null }

export function addTab(state: TabsState, tab: TermTab): TabsState {
  return { tabs: [...state.tabs, tab], activeId: tab.id }
}

export function closeTab(state: TabsState, id: string): TabsState {
  const idx = state.tabs.findIndex(t => t.id === id)
  if (idx < 0) return state
  const tabs = state.tabs.filter(t => t.id !== id)
  let activeId = state.activeId
  if (state.activeId === id) {
    if (tabs.length === 0) activeId = null
    else activeId = (state.tabs[idx - 1] ?? state.tabs[idx + 1])?.id ?? tabs[0]!.id
  }
  return { tabs, activeId }
}

export function setActive(state: TabsState, id: string): TabsState {
  return state.tabs.some(t => t.id === id) ? { ...state, activeId: id } : state
}

export function shortTabLabel(cwd: string, index: number): string {
  const trimmed = (cwd || '').replace(/\/+$/, '')
  const base = trimmed.split('/').pop()
  return base && base.length > 0 ? base : `终端 ${index + 1}`
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/terminalTabs.test.ts`
Expected: PASS(全部)

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/lib/terminalTabs.ts desktop/test/terminalTabs.test.ts
git commit -m "feat(desktop/term): 终端标签状态纯函数(add/close/setActive/label)+ 单测"
```

---

### Task 3: 终端后端 —— 依赖 + 原生重建 + PtyManager + IPC + preload

**Files:**
- Modify: `desktop/package.json`(deps)
- Modify: `desktop/electron.vite.config.ts`(main external node-pty)
- Modify: `desktop/electron-builder.yml`(asarUnpack)
- Create: `desktop/src/main/pty.ts`(PtyManager)
- Modify: `desktop/src/main/index.ts`(实例化 + IPC + will-quit killAll)
- Modify: `desktop/src/preload/index.ts`(pty* 方法 + 事件订阅 + 接口签名)

**Interfaces:**
- Consumes: `resolveShell`(Task 1)
- Produces:
  - `pty.ts`:`class PtyManager` — `constructor(onData:(id,data)=>void, onExit:(id,code)=>void, env, homeDir)`;`create(opts:{cwd?:string;cols?:number;rows?:number}):{id:string}`、`write(id,data)`、`resize(id,cols,rows)`、`kill(id)`、`killAll()`
  - preload `window.wraith`:`ptyCreate(opts?):Promise<{id:string}>`、`ptyInput(id,data):Promise<void>`、`ptyResize(id,cols,rows):Promise<void>`、`ptyKill(id):Promise<void>`、`onPtyData(cb:(p:{id:string;data:string})=>void):()=>void`、`onPtyExit(cb:(p:{id:string;code:number})=>void):()=>void`

- [ ] **Step 1: 装依赖**

Run(从 `desktop/`):
```bash
cd desktop && npm install node-pty @xterm/xterm @xterm/addon-fit && npm install -D @electron/rebuild
```
Expected: 装入 dependencies(node-pty/@xterm/*)+ devDependency(@electron/rebuild),无 error。

- [ ] **Step 2: 按 Electron ABI 重建 node-pty**

Run(从 `desktop/`):
```bash
cd desktop && npx electron-rebuild --force --only node-pty
```
Expected: 输出 `Rebuild Complete`(node-pty 的 .node 针对当前 Electron ABI 重建)。若报错(找不到 electron-rebuild / 编译失败)→ 报 BLOCKED,附完整输出。

- [ ] **Step 3: main 外部化 node-pty(避免被打进 bundle)**

修改 `desktop/electron.vite.config.ts` 的 `main.build.rollupOptions`,加 `external`:
```ts
  main: {
    build: {
      rollupOptions: {
        input: 'src/main/index.ts',
        external: ['node-pty']
      }
    }
  },
```

- [ ] **Step 4: 打包解包 node-pty 原生二进制**

在 `desktop/electron-builder.yml` 末尾加:
```yaml
asarUnpack:
  - "**/node_modules/node-pty/**"
```

- [ ] **Step 5: 实现 PtyManager**

```ts
// desktop/src/main/pty.ts
import { spawn as spawnPty, type IPty } from 'node-pty'
import { resolveShell } from './ptyHelpers'

export interface PtyCreateOpts { cwd?: string; cols?: number; rows?: number }

/** 主进程 PTY 管理:开/写/resize/杀,数据与退出经构造回调转发给渲染。 */
export class PtyManager {
  private readonly ptys = new Map<string, IPty>()
  private seq = 0

  constructor(
    private readonly onData: (id: string, data: string) => void,
    private readonly onExit: (id: string, code: number) => void,
    private readonly env: NodeJS.ProcessEnv,
    private readonly homeDir: string,
  ) {}

  create(opts: PtyCreateOpts): { id: string } {
    const id = 'pty-' + (++this.seq)
    const shell = resolveShell(this.env, process.platform)
    const cwd = opts.cwd && opts.cwd.trim() ? opts.cwd : this.homeDir
    const p = spawnPty(shell, [], {
      name: 'xterm-color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd,
      env: this.env as { [key: string]: string },
    })
    this.ptys.set(id, p)
    p.onData(d => this.onData(id, d))
    p.onExit(e => { this.ptys.delete(id); this.onExit(id, e.exitCode) })
    return { id }
  }

  write(id: string, data: string): void { this.ptys.get(id)?.write(data) }

  resize(id: string, cols: number, rows: number): void {
    const p = this.ptys.get(id)
    if (p) { try { p.resize(Math.max(1, cols), Math.max(1, rows)) } catch { /* pty 已退出 */ } }
  }

  kill(id: string): void {
    const p = this.ptys.get(id)
    if (p) { this.ptys.delete(id); try { p.kill() } catch { /* 已退出 */ } }
  }

  killAll(): void {
    for (const p of this.ptys.values()) { try { p.kill() } catch { /* 已退出 */ } }
    this.ptys.clear()
  }
}
```

- [ ] **Step 6: index.ts 实例化 + IPC + killAll**

在 `index.ts` 顶部 import 区加 `import { PtyManager } from './pty'`(`os` 已 import)。模块级加 `let ptyManager: PtyManager | null = null`。
在 `app.whenReady()` 内、`createWindow()` 之后(mainWindow 已存在的位置)加:
```ts
  ptyManager = new PtyManager(
    (id, data) => { mainWindow?.webContents.send('wraith:pty-data', { id, data }) },
    (id, code) => { mainWindow?.webContents.send('wraith:pty-exit', { id, code }) },
    process.env,
    os.homedir(),
  )
```
IPC handlers(放在其它 `ipcMain.handle` 附近):
```ts
ipcMain.handle('wraith:ptyCreate', (_e, opts?: { cwd?: string; cols?: number; rows?: number }) => ptyManager?.create(opts ?? {}) ?? { id: '' })
ipcMain.handle('wraith:ptyInput', (_e, id: string, data: string) => { ptyManager?.write(id, data) })
ipcMain.handle('wraith:ptyResize', (_e, id: string, cols: number, rows: number) => { ptyManager?.resize(id, cols, rows) })
ipcMain.handle('wraith:ptyKill', (_e, id: string) => { ptyManager?.kill(id) })
```
在现有 `app.on('will-quit', ...)`(约 index.ts:1182,内含 `gatewayManager?.dispose()`)里加一行 `ptyManager?.killAll()`。

- [ ] **Step 7: preload 暴露**

在 `desktop/src/preload/index.ts` 的 `window.wraith` 接口声明(与 `onGatewayEvent` 等同处)加签名:
```ts
  ptyCreate(opts?: { cwd?: string; cols?: number; rows?: number }): Promise<{ id: string }>
  ptyInput(id: string, data: string): Promise<void>
  ptyResize(id: string, cols: number, rows: number): Promise<void>
  ptyKill(id: string): Promise<void>
  onPtyData(cb: (p: { id: string; data: string }) => void): () => void
  onPtyExit(cb: (p: { id: string; code: number }) => void): () => void
```
在暴露对象实现里(与 `openExternal` 等同处)加:
```ts
  ptyCreate(opts) { return ipcRenderer.invoke('wraith:ptyCreate', opts) as Promise<{ id: string }> },
  ptyInput(id, data) { return ipcRenderer.invoke('wraith:ptyInput', id, data) as Promise<void> },
  ptyResize(id, cols, rows) { return ipcRenderer.invoke('wraith:ptyResize', id, cols, rows) as Promise<void> },
  ptyKill(id) { return ipcRenderer.invoke('wraith:ptyKill', id) as Promise<void> },
  onPtyData(cb) {
    const l = (_e: Electron.IpcRendererEvent, p: { id: string; data: string }) => cb(p)
    ipcRenderer.on('wraith:pty-data', l)
    return () => { ipcRenderer.removeListener('wraith:pty-data', l) }
  },
  onPtyExit(cb) {
    const l = (_e: Electron.IpcRendererEvent, p: { id: string; code: number }) => cb(p)
    ipcRenderer.on('wraith:pty-exit', l)
    return () => { ipcRenderer.removeListener('wraith:pty-exit', l) }
  },
```

- [ ] **Step 8: 构建 + 回归校验**

Run(从 `desktop/`):
```bash
cd desktop && npx tsc --noEmit -p tsconfig.json && npx vitest run && npx electron-vite build
```
Expected: tsc exit 0;vitest 全绿(纯函数不受影响);electron-vite build 成功(node-pty 被 external、未打进 bundle)。
注:PTY **运行时**能否加载/spawn 在 Task 4 dev 眼验(需 Electron 运行);本任务只保证类型/构建/重建就绪。若 build 因 node-pty 失败 → 报 BLOCKED 附输出。

- [ ] **Step 9: 提交**

```bash
git add desktop/package.json desktop/package-lock.json desktop/electron.vite.config.ts desktop/electron-builder.yml desktop/src/main/pty.ts desktop/src/main/index.ts desktop/src/preload/index.ts
git commit -m "feat(desktop/term): 终端后端——node-pty PtyManager + IPC + preload + 原生打包(external/rebuild/asarUnpack)"
```

---

### Task 4: 渲染 —— TerminalTab + TerminalDrawer + App 集成

**Files:**
- Create: `desktop/src/renderer/components/TerminalTab.tsx`
- Create: `desktop/src/renderer/components/TerminalDrawer.tsx`
- Modify: `desktop/src/renderer/App.tsx`(terminalOpen 状态 + 右上角按钮 + 渲染抽屉)

**Interfaces:**
- Consumes: Task 2 的 `addTab/closeTab/setActive/shortTabLabel/TabsState`;Task 3 的 `window.wraith.pty*`
- Produces: 无(集成层)

- [ ] **Step 1: TerminalTab.tsx(xterm 挂载 + 绑定 PTY)**

```tsx
// desktop/src/renderer/components/TerminalTab.tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/** 单个终端标签:挂 xterm,绑定到已存在的 pty id(由 Drawer 创建)。切标签用 active 控制显隐 + 重算尺寸。 */
export default function TerminalTab({ id, active }: { id: string; active: boolean }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      fontSize: 13, fontFamily: 'Menlo, Monaco, monospace', cursorBlink: true,
      allowTransparency: true, theme: { background: '#00000000' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try { fit.fit() } catch { /* 隐藏态 0 尺寸 */ }
    termRef.current = term; fitRef.current = fit
    void window.wraith.ptyResize(id, term.cols, term.rows)

    const offData = window.wraith.onPtyData(({ id: pid, data }) => { if (pid === id) term.write(data) })
    const offExit = window.wraith.onPtyExit(({ id: pid }) => { if (pid === id) term.write('\r\n\x1b[90m[进程已退出]\x1b[0m\r\n') })
    const dataSub = term.onData(d => { void window.wraith.ptyInput(id, d) })
    const ro = new ResizeObserver(() => {
      try { fit.fit(); void window.wraith.ptyResize(id, term.cols, term.rows) } catch { /* ignore */ }
    })
    ro.observe(host)

    return () => { offData(); offExit(); dataSub.dispose(); ro.disconnect(); term.dispose() }
  }, [id])

  // 从隐藏切回可见:容器恢复尺寸后重算 fit
  useEffect(() => {
    if (!active) return
    const raf = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        const t = termRef.current
        if (t) { void window.wraith.ptyResize(id, t.cols, t.rows); t.focus() }
      } catch { /* ignore */ }
    })
    return () => cancelAnimationFrame(raf)
  }, [active, id])

  return <div ref={hostRef} className={'h-full w-full ' + (active ? '' : 'hidden')} />
}
```

- [ ] **Step 2: TerminalDrawer.tsx(标签栏 + 拖拽调高 + 全标签常挂)**

```tsx
// desktop/src/renderer/components/TerminalDrawer.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import TerminalTab from './TerminalTab'
import { addTab, closeTab, setActive, shortTabLabel, type TabsState } from '../lib/terminalTabs'

const MIN_H = 120

/** 底部终端抽屉:多标签,顶边拖拽调高,全标签常挂 CSS 显隐(切标签保留 PTY)。 */
export default function TerminalDrawer({ cwd, onClose }: { cwd: string | null; onClose: () => void }): JSX.Element {
  const [state, setState] = useState<TabsState>({ tabs: [], activeId: null })
  const [height, setHeight] = useState(() => Math.round(window.innerHeight * 0.38))
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  const addNew = useCallback(async () => {
    try {
      const { id } = await window.wraith.ptyCreate({ cwd: cwd ?? undefined })
      if (!id) return
      setState(s => addTab(s, { id, label: shortTabLabel(cwd ?? '', s.tabs.length) }))
    } catch { /* 创建失败:忽略,用户可重试 */ }
  }, [cwd])

  // 打开时若无标签,自动建一个
  useEffect(() => { if (state.tabs.length === 0) void addNew() /* eslint-disable-next-line */ }, [])

  const close = (id: string): void => {
    void window.wraith.ptyKill(id)
    setState(s => {
      const ns = closeTab(s, id)
      if (ns.tabs.length === 0) onClose()
      return ns
    })
  }

  // 顶边拖拽调高
  const onDragStart = (e: React.PointerEvent): void => {
    dragRef.current = { startY: e.clientY, startH: height }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    const next = Math.min(window.innerHeight * 0.8, Math.max(MIN_H, d.startH + (d.startY - e.clientY)))
    setHeight(next)
  }
  const onDragEnd = (e: React.PointerEvent): void => {
    dragRef.current = null
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }

  return (
    <div data-testid="terminal-drawer" className="flex flex-col border-t border-border bg-bg" style={{ height }}>
      {/* 拖拽手柄 */}
      <div onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}
        className="h-1.5 shrink-0 cursor-ns-resize hover:bg-accent/30" />
      {/* 标签栏 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        {state.tabs.map(t => (
          <div key={t.id}
            className={'flex items-center gap-1 rounded px-2 py-1 text-2xs ' +
              (t.id === state.activeId ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>
            <button data-testid="terminal-tab" onClick={() => setState(s => setActive(s, t.id))} className="max-w-[120px] truncate">{t.label}</button>
            <button data-testid="terminal-tab-close" onClick={() => close(t.id)} className="text-fg-subtle hover:text-danger">×</button>
          </div>
        ))}
        <button data-testid="terminal-add" onClick={() => void addNew()} className="rounded p-1 text-fg-muted hover:bg-surface/60" title="新建终端"><Plus className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        <button data-testid="terminal-drawer-close" onClick={onClose} className="ml-auto rounded p-1 text-fg-muted hover:bg-surface/60" title="收起"><X className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
      </div>
      {/* 全标签常挂,CSS 显隐 */}
      <div className="relative min-h-0 flex-1 px-2 py-1">
        {state.tabs.map(t => (
          <div key={t.id} className={'absolute inset-0 px-2 py-1 ' + (t.id === state.activeId ? '' : 'hidden')}>
            <TerminalTab id={t.id} active={t.id === state.activeId} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: App 集成 —— 状态 + 右上角按钮 + 渲染抽屉**

在 `App.tsx` 顶部 import 区加 `import TerminalDrawer from './components/TerminalDrawer'` 和 lucide 图标 `SquareTerminal`(`import { SquareTerminal } from 'lucide-react'`,若已 import 其它 lucide 图标则并入)。
在 App 组件状态区加:`const [terminalOpen, setTerminalOpen] = useState(false)`。
在 chat 视图头部那行(约 App.tsx:930 的 `flex shrink-0 items-center justify-end gap-2 border-b`)里、其它按钮旁加一个切换按钮:
```tsx
<button data-testid="terminal-toggle" onClick={() => setTerminalOpen(v => !v)}
  className={'flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-surface hover:text-fg ' + (terminalOpen ? 'text-accent' : 'text-fg-muted')}
  title="终端">
  <SquareTerminal className="h-4 w-4" strokeWidth={1.5} />
</button>
```
在 chat 视图内容区(Composer + Transcript 所在的 flex 容器)最底部、Transcript 之后,渲染抽屉(用当前 workspace 作 cwd;workspace 变量在 App 中即活跃项目路径):
```tsx
{terminalOpen && (
  <TerminalDrawer cwd={workspace ?? null} onClose={() => setTerminalOpen(false)} />
)}
```
确保 chat 内容容器是 `flex flex-col` 且 Transcript 区 `min-h-0 flex-1`,使抽屉在其下方按自身 height 占位、Transcript 收缩(定位现有布局,按需把内容包进 flex-col)。

- [ ] **Step 4: 构建校验**

Run(从 `desktop/`):
```bash
cd desktop && npx tsc --noEmit -p tsconfig.json && npx vitest run
```
Expected: tsc exit 0;vitest 全绿(含 Task 1/2 新测)。

- [ ] **Step 5: 眼验(重启 dev)**

重启 `npm run dev`。核对:
- 右上角终端按钮开/关底部抽屉;抽屉停靠 Transcript 下方,顶边可拖拽调高(min 120 / max 80vh)。
- 抽屉自动建一个终端,提示符出现在**当前项目工作区**;跑 `ls`、`git status` 有输出。
- 交互程序:`vim`(能进能 `:q`)、`top`(全屏刷新)正常;颜色正确;窗口 resize 时终端跟随重排。
- `+` 新建多标签、点击切换(内容保留)、`×` 关标签杀该进程;关到空自动收起。
- 收起再开:PTY 保留(标签还在)。退出 app 无残留 shell 进程(`ps` 核对可选)。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/components/TerminalTab.tsx desktop/src/renderer/components/TerminalDrawer.tsx desktop/src/renderer/App.tsx
git commit -m "feat(desktop/term): 底部终端抽屉 UI(xterm 多标签 + 拖拽调高 + 右上角开关)"
```

---

## Self-Review

**Spec coverage:**
- 底部停靠抽屉 + 右上角开关 → Task 4 Step 3 ✓
- 多标签、切换保留、关标签杀 → Task 2(reducer)+ Task 4(常挂 CSS 显隐 + close→ptyKill)✓
- 真 PTY(node-pty)+ shell/cwd 默认 → Task 3 PtyManager + Task 1 resolveShell ✓
- IPC(ptyCreate/Input/Resize/Kill + pty:data/exit)→ Task 3 Step 6/7 ✓
- xterm 渲染 + FitAddon resize → Task 4 Step 1 ✓
- 拖拽调高(默认 38%/min 120/max 80%)→ Task 4 Step 2 ✓
- 收起保留 PTY、退出 app killAll → Task 4 close 逻辑(收起仅 setTerminalOpen(false),不 kill)+ Task 3 will-quit killAll ✓
- 原生打包(external + rebuild + asarUnpack)→ Task 3 Step 1-4 ✓
- 失败不崩(create 失败/退出显文案)→ Task 4 addNew catch + TerminalTab onExit ✓
- 纯函数隔离可测 → Task 1 ptyHelpers、Task 2 terminalTabs(均不 import node-pty)✓

**Placeholder scan:** 无 TBD/TODO;所有步骤含完整代码或确切命令。

**Type consistency:** `PtyManager` 构造签名(onData/onExit/env/homeDir)、`create` opts/返回、preload `pty*`/`onPtyData/onPtyExit` 签名在 Task 3 定义、Task 4 消费一致;`TabsState/TermTab/addTab/closeTab/setActive/shortTabLabel` 在 Task 2 定义、Task 4 消费一致。

**已知风险:** node-pty 原生重建/打包是最脆弱环节(Task 3 Step 2/8);dev 运行时加载在 Task 4 眼验才最终证实。实现者遇 rebuild/build 失败应报 BLOCKED 而非硬扛。
