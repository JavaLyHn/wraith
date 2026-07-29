# Windows 对等 块2:窗口视觉对等 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Windows 主窗无边框(`frame:false`)+ 顶条右上角自绘最小/最大-还原/关闭(混合风),mac/Linux 行为不变。

**Architecture:** 抽 `mainWindowChrome(platform)` 纯函数产平台相关 BrowserWindow 选项片段(darwin 逐字段锁定不变、win32 加 `frame:false`、linux 空),index.ts 消费。新增窗控 IPC(main `ipcMain.handle` + preload `windowControls` 桥 + `maximizeChanged` 事件)。新增 `WindowControls.tsx`(仅 win32 渲染,状态切图标,close 悬停红),TopBar 右侧接线。平台分支尽量抽纯函数,mac 上单测/组件测试验证 Windows 分支。

**Tech Stack:** Electron 32 主进程(TS)、React + Tailwind、vitest + @testing-library/react(jsdom)、electron-vite。

## Global Constraints

- 语言:注释/文档中文;代码/命令/路径原样。
- 分支 `feat/windows-parity-block1`(Windows 系列同分支,已 checkout,直接提交)。工作目录 /Users/aa00945/Desktop/wraith;桌面命令在 desktop/ 下跑。
- **不改 Java 后端**;**不改 mac/Linux 窗口 chrome 行为**——`mainWindowChrome('darwin')` 片段与现有内联字面量逐字段等价(测试锁定);WindowControls 在 mac/linux 渲染为 `null`。
- 纯函数/组件模块**禁止值导入 electron**(只 `import type`);`mainWindowChrome.ts` 走 type-only。
- 每个代码任务结束:`cd desktop && npm run typecheck`(tsc 0)+ `npm run test`(vitest 全绿、不回归)。
- `git add` 只加本任务涉及文件,禁止 `git add .`/`-A`;**绝不碰** WIP 文件(README.md、demo/pom.xml、.claude/settings.json、demo/src/Hello.java、progress.md、.superpowers/)。
- 提交信息中文,结尾逐字附:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ`
- 诚实边界:本环境 macOS,无法验证 Windows 实机 GUI;交付 = 纯函数/组件测试(mac 上绿)+ 实机验收清单条目,运行时冒烟归用户/CI。

## 文件结构

- `desktop/src/main/mainWindowChrome.ts`(新):纯函数,平台 → BrowserWindow 选项片段。
- `desktop/test/mainWindowChrome.test.ts`(新)。
- `desktop/src/main/index.ts`(改):消费 `mainWindowChrome`;注册 4 个窗控 `ipcMain.handle` + maximize/unmaximize 监听。
- `desktop/src/preload/index.ts`(改):`WindowControlsApi` 接口 + `WraithApi.windowControls` + 实现。
- `desktop/src/renderer/lib/topBar.ts`(改):加 `shouldShowWindowControls`。
- `desktop/test/topBar.test.ts`(改):加 `shouldShowWindowControls` 断言。
- `desktop/src/renderer/components/WindowControls.tsx`(新)。
- `desktop/test/windowControls.test.tsx`(新)。
- `desktop/src/renderer/components/TopBar.tsx`(改):右侧接线 WindowControls。
- `docs/windows-dev.md`(改):验收清单补窗控条目 + 更新"已知降级"。

---

### Task 1: mainWindowChrome 纯函数 + 接线 index.ts

**Files:**
- Create: `desktop/src/main/mainWindowChrome.ts`
- Test: `desktop/test/mainWindowChrome.test.ts`
- Modify: `desktop/src/main/index.ts`(约 290 行的 `...(process.platform === 'darwin' ? {…} : {})` 三元)

**Interfaces:**
- Produces: `export function mainWindowChrome(platform: NodeJS.Platform): import('electron').BrowserWindowConstructorOptions`
  - darwin → `{ titleBarStyle:'hidden', trafficLightPosition:{x:12,y:11}, vibrancy:'fullscreen-ui', visualEffectState:'active', backgroundColor:'#00000000' }`
  - win32 → `{ frame:false }`;其它 → `{}`

- [ ] **Step 1: 写失败测试**

Create `desktop/test/mainWindowChrome.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mainWindowChrome } from '../src/main/mainWindowChrome'

describe('mainWindowChrome', () => {
  it('darwin 片段逐字段等价(锁定 mac 不变)', () => {
    expect(mainWindowChrome('darwin')).toEqual({
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 11 },
      vibrancy: 'fullscreen-ui',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
    })
  })
  it('win32 → frame:false', () => {
    expect(mainWindowChrome('win32')).toEqual({ frame: false })
  })
  it('linux/其它 → 空对象', () => {
    expect(mainWindowChrome('linux')).toEqual({})
    expect(mainWindowChrome('freebsd' as NodeJS.Platform)).toEqual({})
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/mainWindowChrome.test.ts`
Expected: FAIL —— 找不到 `../src/main/mainWindowChrome`。

- [ ] **Step 3: 写最小实现**

Create `desktop/src/main/mainWindowChrome.ts`(**只 type-only 导入 electron**):

```ts
import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * 主窗的平台相关 BrowserWindow 选项片段(纯函数,便于按平台单测)。
 * darwin:隐藏标题栏 + 交通灯 + vibrancy(与原内联字面量逐字段等价,勿改)。
 * win32:无边框(frame:false),窗控由渲染层 WindowControls 自绘。不设 transparent——
 *   Windows 无 vibrancy,且窗本就 show:false + ready-to-show + splash 兜白闪。
 * 其它平台(linux 等):空,保持系统标准窗框。
 */
export function mainWindowChrome(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 11 },
      vibrancy: 'fullscreen-ui',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
    }
  }
  if (platform === 'win32') return { frame: false }
  return {}
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/mainWindowChrome.test.ts`
Expected: PASS。

- [ ] **Step 5: 接线 index.ts**

在 `desktop/src/main/index.ts` 顶部 import 区加 `import { mainWindowChrome } from './mainWindowChrome'`。把主窗创建里这一段:

```ts
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 12, y: 11 },
          vibrancy: 'fullscreen-ui' as const,
          visualEffectState: 'active' as const,
          backgroundColor: '#00000000',
        }
      : {}),
```

替换为:

```ts
    ...mainWindowChrome(process.platform),
```

- [ ] **Step 6: typecheck + 全量 vitest**

Run: `cd desktop && npm run typecheck && npm run test`
Expected: tsc 0;vitest 全绿(不回归)。

- [ ] **Step 7: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/main/mainWindowChrome.ts desktop/test/mainWindowChrome.test.ts desktop/src/main/index.ts
git commit -m "feat(windows): mainWindowChrome 纯函数化主窗选项,win32 无边框(mac 片段字节级不变)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 2: 窗控 IPC(main + preload)+ shouldShowWindowControls

**Files:**
- Modify: `desktop/src/renderer/lib/topBar.ts`(加 `shouldShowWindowControls`)
- Test: `desktop/test/topBar.test.ts`(加断言)
- Modify: `desktop/src/main/index.ts`(4 个 `ipcMain.handle` + 2 个 mainWindow 监听)
- Modify: `desktop/src/preload/index.ts`(`WindowControlsApi` + `WraithApi.windowControls` + 实现)

**Interfaces:**
- Consumes: Task 1 的主窗(win32 已 frame:false)。
- Produces:
  - `export function shouldShowWindowControls(platform: string): boolean`(win32=true)
  - preload `WindowControlsApi { minimize(): void; toggleMaximize(): void; close(): void; isMaximized(): Promise<boolean>; onMaximizeChange(cb: (max: boolean) => void): () => void }`,挂在 `window.wraith.windowControls`
  - IPC 频道:`wraith:win:minimize` / `:toggleMaximize` / `:close` / `:isMaximized`(invoke),`wraith:win:maximizeChanged`(main→renderer,payload boolean)

- [ ] **Step 1: 写失败测试(shouldShowWindowControls)**

改 `desktop/test/topBar.test.ts`:把首行 import 改为 `import { topBarLeftPad, shouldShowWindowControls } from '../src/renderer/lib/topBar'`,并追加:

```ts
describe('shouldShowWindowControls', () => {
  it('仅 win32 显示自绘窗控', () => {
    expect(shouldShowWindowControls('win32')).toBe(true)
    for (const p of ['darwin', 'linux', 'freebsd', '']) {
      expect(shouldShowWindowControls(p)).toBe(false)
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/topBar.test.ts`
Expected: FAIL —— `shouldShowWindowControls` 未导出。

- [ ] **Step 3: 实现 shouldShowWindowControls**

追加到 `desktop/src/renderer/lib/topBar.ts`:

```ts
/** 是否显示自绘窗口控制键(最小/最大/关闭):仅 Windows。mac 用交通灯,Linux 用系统窗框。 */
export function shouldShowWindowControls(platform: string): boolean {
  return platform === 'win32'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/topBar.test.ts`
Expected: PASS。

- [ ] **Step 5: main 注册窗控 IPC + maximize 监听**

在 `desktop/src/main/index.ts`:

(a) 在**与现有 `ipcMain.handle(` 同一作用域**(启动时执行一次的地方)追加 4 个 handler:

```ts
// 窗口控制(Windows 无边框自绘窗控用;mac/Linux 调用无害)
ipcMain.handle('wraith:win:minimize', () => { mainWindow?.minimize() })
ipcMain.handle('wraith:win:toggleMaximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.handle('wraith:win:close', () => { mainWindow?.close() })
ipcMain.handle('wraith:win:isMaximized', () => !!mainWindow?.isMaximized())
```

(b) 在主窗创建后(紧接现有 `mainWindow.once('ready-to-show', …)` 那行之后)加两个监听:

```ts
mainWindow.on('maximize', () => mainWindow?.webContents.send('wraith:win:maximizeChanged', true))
mainWindow.on('unmaximize', () => mainWindow?.webContents.send('wraith:win:maximizeChanged', false))
```

注:`ipcMain.handle` 同频道重复注册会抛错;务必放在只执行一次的启动作用域(与其它 `ipcMain.handle` 并列),不要放进可能多次调用的函数体内。

- [ ] **Step 6: preload 暴露 windowControls**

在 `desktop/src/preload/index.ts`:

(a) 在 `WraithApi` 接口附近加类型:

```ts
export interface WindowControlsApi {
  minimize(): void
  toggleMaximize(): void
  close(): void
  isMaximized(): Promise<boolean>
  onMaximizeChange(cb: (max: boolean) => void): () => void
}
```

(b) 在 `WraithApi` 接口里加成员:`windowControls: WindowControlsApi`。

(c) 在 `const wraith: WraithApi = { … }` 里加实现(订阅/退订**照现有 `onEvent`/`onPetConfig` 的 listener 签名与 `removeListener` 写法**):

```ts
  windowControls: {
    minimize() { void ipcRenderer.invoke('wraith:win:minimize') },
    toggleMaximize() { void ipcRenderer.invoke('wraith:win:toggleMaximize') },
    close() { void ipcRenderer.invoke('wraith:win:close') },
    isMaximized() { return ipcRenderer.invoke('wraith:win:isMaximized') as Promise<boolean> },
    onMaximizeChange(cb) {
      const listener = (_e: Electron.IpcRendererEvent, max: boolean) => cb(max)
      ipcRenderer.on('wraith:win:maximizeChanged', listener)
      return () => { ipcRenderer.removeListener('wraith:win:maximizeChanged', listener) }
    },
  },
```

(若 `Electron.IpcRendererEvent` 在本文件无法直接引用,照本文件既有事件订阅方法的 listener 参数写法对齐即可。)

- [ ] **Step 7: typecheck + 全量 vitest**

Run: `cd desktop && npm run typecheck && npm run test`
Expected: tsc 0(preload 类型贯通到 `window.wraith.windowControls`);vitest 全绿(含新 topBar 断言)。

- [ ] **Step 8: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/lib/topBar.ts desktop/test/topBar.test.ts desktop/src/main/index.ts desktop/src/preload/index.ts
git commit -m "feat(windows): 窗控 IPC(min/max/close/isMax + maximizeChanged)+ shouldShowWindowControls

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 3: WindowControls.tsx + TopBar 接线

**Files:**
- Create: `desktop/src/renderer/components/WindowControls.tsx`
- Test: `desktop/test/windowControls.test.tsx`
- Modify: `desktop/src/renderer/components/TopBar.tsx`

**Interfaces:**
- Consumes: Task 2 的 `window.wraith.windowControls` 与 `shouldShowWindowControls`。
- Produces: `export default function WindowControls({ platform }: { platform: string }): JSX.Element | null`(win32 渲三键,否则 null)。testid:`window-controls` / `win-minimize` / `win-maximize` / `win-close`;`win-maximize` 带 `data-max-state="maximized"|"normal"`。

- [ ] **Step 1: 写失败测试**

Create `desktop/test/windowControls.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import WindowControls from '../src/renderer/components/WindowControls'

afterEach(cleanup)

function mockWc(): { minimize: ReturnType<typeof vi.fn>; toggleMaximize: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; emit: (m: boolean) => void } {
  const listeners: Array<(m: boolean) => void> = []
  const wc = {
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(async () => false),
    onMaximizeChange: vi.fn((cb: (m: boolean) => void) => { listeners.push(cb); return () => {} }),
  }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = { platform: 'win32', windowControls: wc }
  return { minimize: wc.minimize, toggleMaximize: wc.toggleMaximize, close: wc.close, emit: (m) => listeners.forEach(l => l(m)) }
}

describe('WindowControls', () => {
  it('darwin 不渲染', () => {
    mockWc()
    const { container } = render(<WindowControls platform="darwin" />)
    expect(container.firstChild).toBeNull()
  })
  it('linux 不渲染', () => {
    mockWc()
    const { container } = render(<WindowControls platform="linux" />)
    expect(container.firstChild).toBeNull()
  })
  it('win32 渲三键,点击各调 bridge', () => {
    const m = mockWc()
    render(<WindowControls platform="win32" />)
    fireEvent.click(screen.getByTestId('win-minimize'))
    fireEvent.click(screen.getByTestId('win-maximize'))
    fireEvent.click(screen.getByTestId('win-close'))
    expect(m.minimize).toHaveBeenCalledTimes(1)
    expect(m.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(m.close).toHaveBeenCalledTimes(1)
  })
  it('maximizeChanged 切换 data-max-state', async () => {
    const m = mockWc()
    render(<WindowControls platform="win32" />)
    expect(screen.getByTestId('win-maximize').getAttribute('data-max-state')).toBe('normal')
    m.emit(true)
    await waitFor(() =>
      expect(screen.getByTestId('win-maximize').getAttribute('data-max-state')).toBe('maximized'))
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/windowControls.test.tsx`
Expected: FAIL —— 找不到 `WindowControls`。

- [ ] **Step 3: 写实现**

Create `desktop/src/renderer/components/WindowControls.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { shouldShowWindowControls } from '../lib/topBar'

const wc = (): Window['wraith']['windowControls'] => window.wraith.windowControls

function MinIcon(): JSX.Element {
  return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" /></svg>
}
function MaxIcon(): JSX.Element {
  return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1.4" y="1.4" width="7.2" height="7.2" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
}
function RestoreIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1" y="2.8" width="6.2" height="6.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M3.1 2.8 V1 H9 V6.9" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}
function CloseIcon(): JSX.Element {
  return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.6 1.6 L8.4 8.4 M8.4 1.6 L1.6 8.4" stroke="currentColor" strokeWidth="1.2" /></svg>
}

/** Windows 自绘窗口控制键(最小/最大-还原/关闭)。仅 win32 渲染;mac(交通灯)/Linux(系统窗框)返回 null。
 *  混合风:位置/行为按 Windows(右上、贴角、close 悬停红),字形用 wraith 单色墨、非 close 键 hover 圆润淡底。 */
export default function WindowControls({ platform }: { platform: string }): JSX.Element | null {
  const show = shouldShowWindowControls(platform)
  const [isMax, setIsMax] = useState(false)

  useEffect(() => {
    if (!show) return
    let alive = true
    void wc().isMaximized().then(m => { if (alive) setIsMax(m) })
    const off = wc().onMaximizeChange(m => setIsMax(m))
    return () => { alive = false; off() }
  }, [show])

  if (!show) return null

  const base = 'flex h-[38px] w-[46px] items-center justify-center [-webkit-app-region:no-drag] text-fg-muted transition-colors duration-100'
  const soft = ' hover:bg-fg/[0.08] hover:text-fg'
  return (
    <div data-testid="window-controls" className="flex items-stretch">
      <button data-testid="win-minimize" aria-label="最小化" title="最小化" onClick={() => wc().minimize()} className={base + soft}><MinIcon /></button>
      <button data-testid="win-maximize" aria-label={isMax ? '还原' : '最大化'} title={isMax ? '还原' : '最大化'} data-max-state={isMax ? 'maximized' : 'normal'} onClick={() => wc().toggleMaximize()} className={base + soft}>{isMax ? <RestoreIcon /> : <MaxIcon />}</button>
      <button data-testid="win-close" aria-label="关闭" title="关闭" onClick={() => wc().close()} className={base + ' hover:bg-red-600 hover:text-white'}><CloseIcon /></button>
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/windowControls.test.tsx`
Expected: PASS(4 用例)。

- [ ] **Step 5: TopBar 接线**

改 `desktop/src/renderer/components/TopBar.tsx`:顶部加 `import WindowControls from './WindowControls'`。在最外层 `<div data-testid="topbar" …>` 的**最后一个子节点位置**(现有 `{showChat && (…)}` 块之后、`</div>` 之前)加:

```tsx
      {platform === 'win32' && <WindowControls platform={platform} />}
```

(窗控恒显,不受 `showChat` 门控;它自带 `no-drag` 与贴角样式,`showChat` 右簇的 `pr-2` 提供分隔。)

- [ ] **Step 6: typecheck + 全量 vitest**

Run: `cd desktop && npm run typecheck && npm run test`
Expected: tsc 0;vitest 全绿(含 windowControls 4 用例;既有 TopBar/panelToggleIcon 等不回归)。

- [ ] **Step 7: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/components/WindowControls.tsx desktop/test/windowControls.test.tsx desktop/src/renderer/components/TopBar.tsx
git commit -m "feat(windows): WindowControls 自绘窗控(仅 win32,状态切图标,close 悬停红)+ TopBar 接线

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 4: docs/windows-dev.md 验收清单补窗控 + 更新降级

**Files:**
- Modify: `docs/windows-dev.md`

**Interfaces:**
- Consumes: 块 2 的无边框窗 + 窗控。

- [ ] **Step 1: 补验收清单条目**

先读 `docs/windows-dev.md`。在"验收清单"小节的现有条目后追加(保持 `- [ ]` 复选框风格):

```markdown
- [ ] 主窗无系统标题栏(无边框),整窗为自绘表面
- [ ] 顶条右上角有 最小化 / 最大化 / 关闭 三键,点击各生效
- [ ] 最大化后按钮图标变"还原",还原后变回"最大化"
- [ ] 双击顶条空白处 最大化 / 还原
- [ ] 关闭键悬停变红
- [ ] 拖顶条空白处可移动窗口
```

- [ ] **Step 2: 更新"已知降级"**

在"已知降级"小节,把关于"窗口是系统标准边框(…→块2)"的那一条**删除或改写**为已完成表述,例如:

```markdown
- (块 2 已完成)Windows 现为无边框自绘窗 + 右上角自绘窗控,视觉与 mac 对齐。
```

其余降级条目(编辑器→块3、桌宠→块5、无安装包→块4)保持不变。

- [ ] **Step 3: 校对**

肉眼确认:清单条目可逐条打勾、与块 2 实际交付一致;"已知降级"不再声称 Windows 是系统标准边框;无占位符。

- [ ] **Step 4: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add docs/windows-dev.md
git commit -m "docs(windows): 验收清单补窗口 chrome 条目 + 更新已知降级(块2 完成)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

## 完成判据(块 2)

- `mainWindowChrome`(darwin 片段字节级等价、win32 frame:false、linux 空)、`shouldShowWindowControls`、`WindowControls`(4 组件用例)全绿;`npm run typecheck` 0。
- mac/Linux 窗口 chrome 行为不变(darwin 片段测试锁定;WindowControls 在 mac/linux 渲染 null)。
- 既有 vitest 不回归。
- `docs/windows-dev.md` 验收清单含窗控条目、降级已更新。
- **Windows 实机 GUI 冒烟**(无边框观感 / 三键行为 / 双击最大化 / close 红 / 拖窗)= 用户/CI 负责,本环境不冒领。
