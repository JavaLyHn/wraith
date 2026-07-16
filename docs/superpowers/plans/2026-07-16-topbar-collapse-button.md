# 全宽顶条 + 隐藏 macOS 原生标题栏(折叠键上移) 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把侧栏折叠按钮从侧栏头部移到窗口顶部一条全宽自定义顶条里、紧挨 macOS 交通灯右侧、所有视图常驻。

**Architecture:** macOS 主窗改 `titleBarStyle: 'hidden'` 让网页内容接管顶部;preload 暴露 `platform` 供 renderer 决定顶条左侧是否让开交通灯;新增全宽 `TopBar` 组件(拖拽区 + 折叠键),App 根由横向 flex 改为纵向包一层;删除侧栏头部折叠键与聊天视图浮动展开键(职责由顶条键统一)。

**Tech Stack:** Electron(main) + React/TS(renderer) + Tailwind + vitest。已批准 spec:`docs/superpowers/specs/2026-07-16-topbar-collapse-button-design.md`(commit 35a2113)。

## Global Constraints

- 纯前端 + 一行 main config;desktop typecheck 0;全量 vitest 基线不降(新增 `topBarLeftPad` 单测)。
- 折叠**行为语义不变**(仍翻转 `sidebarCollapsed`);`localStorage` 持久化逻辑照旧,不动。
- testid `sidebar-collapse` **保留**在新位置(顶条按钮);`sidebar-expand`(浮动展开键)移除——无测试引用(已核)。
- 仅 macOS 隐藏标题栏:`process.platform === 'darwin'` 守卫;非 darwin 保留默认边框(已知会与原生标题栏并存,可接受)。
- 拖拽区一律用 **Tailwind 任意属性类** `[-webkit-app-region:drag]` / 按钮 `[-webkit-app-region:no-drag]`,**不用** inline `style={{WebkitAppRegion}}`(新版 `@types/react` 会 typecheck 报错)。
- 顶条高度 38px;交通灯 `trafficLightPosition: {x:12, y:11}`(初值,眼验微调)。
- push 需用户单独点头(本计划不含 push)。

**工作目录**:所有命令在 `desktop/` 下执行。typecheck:`npm run typecheck`;测试:`npx vitest run`(单文件 `npx vitest run test/<name>.test.ts`)。

---

## File Structure

- Create `desktop/src/renderer/lib/topBar.ts` — 纯函数 `topBarLeftPad(platform)`,顶条左内边距。
- Create `desktop/src/renderer/components/TopBar.tsx` — 全宽顶条(拖拽区 + 折叠键)。
- Create `desktop/test/topBar.test.ts` — `topBarLeftPad` 单测。
- Modify `desktop/src/preload/index.ts` — `WraithApi` 加 `platform: string` + 暴露对象加 `platform: process.platform`。
- Modify `desktop/src/main/index.ts:245` — 主窗 options 加(仅 darwin)`titleBarStyle`/`trafficLightPosition`。
- Modify `desktop/src/renderer/App.tsx` — 根转 flex-col + 渲染 TopBar + 包裹层 + 删浮动展开键 + 去 Sidebar 的 `onToggleCollapsed` 传参 + 清理未用 `PanelLeft` import。
- Modify `desktop/src/renderer/components/Sidebar.tsx` — 删头部折叠键 + 去 `onToggleCollapsed` prop + 清理未用 `PanelLeft` import。

`desktop/src/renderer/global.d.ts` 无需改:`window.wraith: WraithApi` 自动继承新字段。

---

## Task 1: 平台标志暴露 + `topBarLeftPad` 纯函数

**Files:**
- Create: `desktop/src/renderer/lib/topBar.ts`
- Create: `desktop/test/topBar.test.ts`
- Modify: `desktop/src/preload/index.ts`(`WraithApi` 接口 + 暴露对象)

**Interfaces:**
- Produces: `topBarLeftPad(platform: string): string`(`'darwin'→'pl-[80px]'`,其它→`'pl-2'`);`window.wraith.platform: string`(经 `WraithApi`)。

- [ ] **Step 1: 写失败测试** `desktop/test/topBar.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { topBarLeftPad } from '../src/renderer/lib/topBar'

describe('topBarLeftPad', () => {
  it('darwin → 让开交通灯', () => {
    expect(topBarLeftPad('darwin')).toBe('pl-[80px]')
  })
  it('非 darwin → 贴左', () => {
    for (const p of ['win32', 'linux', 'freebsd', '']) {
      expect(topBarLeftPad(p)).toBe('pl-2')
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/topBar.test.ts`
Expected: FAIL —— 无法解析 `../src/renderer/lib/topBar`(模块不存在)。

- [ ] **Step 3: 建 `desktop/src/renderer/lib/topBar.ts`**

```ts
/** 顶条左内边距:macOS 需让开左上角交通灯(~80px),其它平台贴左。 */
export function topBarLeftPad(platform: string): string {
  return platform === 'darwin' ? 'pl-[80px]' : 'pl-2'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/topBar.test.ts`
Expected: PASS(2 个 it 全绿)。

- [ ] **Step 5: preload 暴露 `platform`** — `desktop/src/preload/index.ts`

在 `export interface WraithApi {`(约 :11)内新增一行字段(放在接口体第一行即可):

```ts
  /** 运行平台('darwin' | 'win32' | 'linux' | ...);renderer 据此决定顶条交通灯留白 */
  platform: string
```

在暴露的实现对象里(`const wraith: WraithApi = { ... }`,`contextBridge.exposeInMainWorld('wraith', wraith)` 约 :594 之前的那个对象)加一行:

```ts
  platform: process.platform,
```

(preload 环境 `process` 可用;`platform` 是静态字符串字段,非函数。)

- [ ] **Step 6: typecheck 0**

Run: `npm run typecheck`
Expected: 0 errors —— 确认 `WraithApi.platform` 与暴露对象一致,且 `window.wraith.platform` 经 `global.d.ts` 正确带类型。

- [ ] **Step 7: 提交**

```bash
git add desktop/src/renderer/lib/topBar.ts desktop/test/topBar.test.ts desktop/src/preload/index.ts
git commit -m "feat(desktop): 暴露 window.wraith.platform + topBarLeftPad 纯函数(顶条基件)"
```

---

## Task 2: TopBar 组件 + 隐藏标题栏 + App 根改造 + 删旧折叠键

**Files:**
- Create: `desktop/src/renderer/components/TopBar.tsx`
- Modify: `desktop/src/main/index.ts:245`(主窗 options)
- Modify: `desktop/src/renderer/App.tsx`(根结构 + TopBar + 删浮动键 + Sidebar 传参 + import 清理)
- Modify: `desktop/src/renderer/components/Sidebar.tsx`(删头部折叠键 + prop + import 清理)

**Interfaces:**
- Consumes: `topBarLeftPad`、`window.wraith.platform`(Task 1)。
- Produces: `<TopBar collapsed={boolean} onToggleCollapsed={() => void} />`。

- [ ] **Step 1: 建 `desktop/src/renderer/components/TopBar.tsx`**

```tsx
import { PanelLeft } from 'lucide-react'
import { topBarLeftPad } from '../lib/topBar'

interface TopBarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
}

/** 全宽顶条:窗口拖拽区(macOS 隐藏原生标题栏后)+ 常驻折叠键(紧挨交通灯右侧)。 */
export default function TopBar({ collapsed, onToggleCollapsed }: TopBarProps): JSX.Element {
  const pad = topBarLeftPad(window.wraith.platform)
  return (
    <div className={'flex h-[38px] shrink-0 items-center border-b border-border bg-bg [-webkit-app-region:drag] ' + pad}>
      <button
        type="button"
        data-testid="sidebar-collapse"
        onClick={onToggleCollapsed}
        title={collapsed ? '展开侧栏' : '折叠侧栏'}
        className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface/60 hover:text-fg [-webkit-app-region:no-drag]"
      >
        <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: 主窗隐藏标题栏(仅 darwin)** — `desktop/src/main/index.ts`

找到主窗构造(约 :245-256):

```ts
  mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    // dev: show WR icon instead of Electron atom; packaged macOS: dock icon comes from .icns
    icon: app.isPackaged ? undefined : path.join(__dirname, '../../build/icon-512.png'),
    webPreferences: {
```

在 `icon:` 行与 `webPreferences:` 行之间插入:

```ts
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 11 } }
      : {}),
```

(`as const` 保证 `titleBarStyle` 是字面量类型而非 `string`,满足 Electron `BrowserWindowConstructorOptions`。)

- [ ] **Step 3: App 根转 flex-col + 渲染 TopBar + 包裹层** — `desktop/src/renderer/App.tsx`

**3a. import** — 在组件 import 区(如 `import AutomationsPanel from './components/AutomationsPanel'` 附近)加:

```ts
import TopBar from './components/TopBar'
```

**3b. 根 className** — 把(约 :839):

```tsx
    <div className="flex h-screen overflow-hidden bg-bg text-fg">
```

改为:

```tsx
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-fg">
```

**3c. 删浮动展开键、插 TopBar + 包裹层开** — 把这一整块(约 :840-852):

```tsx
      {/* 折叠态展开按钮:仅聊天视图（顶栏右对齐、左上角空）；工具视图有各自的「← 返回对话」头部，
          浮动按钮会与之碰撞，故不显示——那里靠左缘悬停划出（peek）或「返回对话」即可展开/离开。 */}
      {sidebarCollapsed && view === 'chat' && (
        <button
          type="button"
          data-testid="sidebar-expand"
          onClick={() => setSidebarCollapsed(false)}
          title="展开侧栏"
          className="fixed left-3 top-2 z-40 rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-fg transition-colors"
        >
          <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
        </button>
      )}
```

整体替换为:

```tsx
      <TopBar collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed(v => !v)} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
```

**3d. 关闭包裹层** — 找到内容行的收尾(约 :1049-1052):

```tsx
      <RightDock open={rightDockOpen} cwd={state.workspace ?? null} onClose={() => setRightDockOpen(false)} />
      </div>

      {/* Approval modal（Task 8 换 shadcn Dialog；此处结构不变） */}
```

在 `</div>`(闭合内容行 `flex min-w-0 flex-1 flex-row`)之后、`{/* Approval modal ... */}` 之前,补一个 `</div>` 关闭 3c 新开的包裹层:

```tsx
      <RightDock open={rightDockOpen} cwd={state.workspace ?? null} onClose={() => setRightDockOpen(false)} />
      </div>
      </div>

      {/* Approval modal（Task 8 换 shadcn Dialog；此处结构不变） */}
```

(结果:根 flex-col 的直接子 = `TopBar` → 包裹层(含 SidebarDock + 内容行) → 三个浮层 ApprovalModal×2/CommandPalette。浮层是 fixed/portal,留在包裹层外不影响。)

**3e. 去掉传给 Sidebar 的 onToggleCollapsed** — 删除 `<Sidebar ...>` 里这一行(约 :886):

```tsx
          onToggleCollapsed={() => setSidebarCollapsed(v => !v)}
```

**3f. 清理未用 import** — App.tsx 顶部 import(约 :36):

```ts
import { Download, PanelLeft, PanelRight, SquareTerminal, Wand2 } from 'lucide-react'
```

删除其中的 `PanelLeft`(浮动键移除后 App 内不再使用;TopBar 有自己的 import):

```ts
import { Download, PanelRight, SquareTerminal, Wand2 } from 'lucide-react'
```

- [ ] **Step 4: Sidebar 删头部折叠键 + prop + import** — `desktop/src/renderer/components/Sidebar.tsx`

**4a. 删按钮块** — 删除(约 :201-211):

```tsx
          {onToggleCollapsed && (
            <button
              type="button"
              data-testid="sidebar-collapse"
              onClick={onToggleCollapsed}
              title="折叠侧栏"
              className="mr-2 shrink-0 rounded-lg p-1.5 text-fg-muted hover:bg-surface/60 hover:text-fg transition-colors"
            >
              <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
```

**4b. 去 prop 声明** — 删除 `SidebarProps` 接口里(约 :131):

```ts
  onToggleCollapsed?: () => void
```

**4c. 去解构** — 删除组件参数解构里(约 :168)的 `onToggleCollapsed,` 一行。

**4d. 清理 import** — 若 `PanelLeft` 在 Sidebar 内已无其它用途(移除 4a 后应无),从 icon import(约 :11)删除 `PanelLeft`:

```ts
  Shield, ShieldAlert, ShieldCheck, ListTodo, PanelLeft,
```

删成:

```ts
  Shield, ShieldAlert, ShieldCheck, ListTodo,
```

(实现者:先全文搜 `PanelLeft` 确认 Sidebar 内仅 4a 一处用过再删 import;若别处仍用则保留。)

- [ ] **Step 5: typecheck 0**

Run: `npm run typecheck`
Expected: 0 errors(无未用 import、无缺 prop、JSX 闭合平衡、`titleBarStyle` 字面量类型 OK)。

- [ ] **Step 6: 全量 vitest 基线不降**

Run: `npx vitest run`
Expected: 与基线同(Task 1 已 +2 个 `topBar` 用例;无行为断言受本任务影响)。

- [ ] **Step 7: 提交**

```bash
git add desktop/src/renderer/components/TopBar.tsx desktop/src/main/index.ts desktop/src/renderer/App.tsx desktop/src/renderer/components/Sidebar.tsx
git commit -m "feat(desktop): 折叠键上移全宽顶条 + macOS 隐藏原生标题栏(交通灯右侧常驻)"
```

- [ ] **Step 8: 眼验(定案点,不阻塞提交,报告注明)**

`npm run dev` 后核:
1. macOS 原生「Wraith」标题栏消失;交通灯仍在左上角、垂直居中于 38px 顶条(不被压/不错位;必要时微调 `trafficLightPosition.y`)。
2. 折叠键在交通灯**绿点右边**,点击折叠/展开侧栏(图标 + title 随态变)。
3. 顶条空白处**能拖动窗口**;按钮区不触发拖拽。
4. 折叠后:聊天 + 各工具面板都能靠顶条键展开;左缘 peek 仍可划出。
5. 明/暗两主题顶条与发丝线观感正常。

---

## 收尾:全量门禁 + opus 终审

- 全量 `npm run typecheck`(0)+ `npx vitest run`(基线 +2)。
- opus 读全 diff(main-base..HEAD 两个提交)终审:窗口 chrome 改动正确性、JSX 闭合、drag/no-drag、未用 import、testid 迁移、YAGNI。
- 眼验清单(上 Step 8)由用户过目定案;`trafficLightPosition` 微调值回填。
- **push 需用户单独点头**(不在本计划内)。

---

## 执行说明(并行性)

- Task 1 → Task 2 **串行**(Task 2 消费 Task 1 的 `platform` 与 `topBarLeftPad`)。
- 无可并行任务(两任务文件有依赖关系)。
- controller 串行提交,避免 git 竞态。
