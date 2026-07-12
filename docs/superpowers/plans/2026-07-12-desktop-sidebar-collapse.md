# 侧边栏折叠 + 悬停划出浮层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 wraith 桌面加 Codex 式侧栏折叠——点按钮折叠(主内容占满)、折叠态鼠标移到最左缘丝滑划出浮层侧栏、移出/点选后丝滑收回,状态持久化。

**Architecture:** 单个 `<Sidebar/>` 实例由新 `SidebarDock` 受控壳包裹,只切换外层 wrapper 的类(流内推挤 ↔ 绝对浮层)而**不 remount**(保留侧栏内部状态)。折叠/浮层状态与持久化在 `App` 持有;纯粹的「状态→样式类」映射抽到 `lib/sidebarDock.ts` 便于单测。

**Tech Stack:** Electron + electron-vite;渲染层 React 18 + TypeScript;Tailwind(主题 token 见 `src/renderer/styles/tokens.css`);lucide-react 图标;vitest(测试在 `desktop/test/*.test.ts`,`import from '../src/renderer/lib/...'`)。

## Global Constraints

- 所有命令在 `desktop/` 目录下执行。
- 类型检查:`npm run typecheck`(`tsc --noEmit -p tsconfig.json`),须 **exit 0 无输出**。
- 测试:`npx vitest run test/<file>` 跑单文件;`npm test` 跑全量,基线 **641 passed** 须保持不降。
- 纯前端 UI,不得读写 `~/.wraith/config.json`/密钥/日志。
- **不改系统标题栏**(主窗保持标准 macOS 标题栏,不改 hiddenInset);**不碰** `RightDock`(右缘)、终端抽屉(底部)、主进程。
- 折叠即**全隐**(不留 mini 图标条);持久化 key **`wraith.sidebar.collapsed`**(`'1'`/`'0'`),默认展开(false)。
- 手感常量:左缘热区 **8px**、动画 **200ms**、展开宽 **240px**(= 现有 `aside` 的 `w-60`)。
- 单个 `<Sidebar/>` 实例**不 remount**:折叠/展开/peek 只改外层 wrapper 类。
- push 需用户单独点头(实现阶段只本地提交,不 push)。

---

### Task 1: `lib/sidebarDock.ts` 纯函数状态→样式映射 + 单测

**Files:**
- Create: `desktop/src/renderer/lib/sidebarDock.ts`
- Test: `desktop/test/sidebarDock.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces(Task 2 依赖这些确切签名):
  - `HOTZONE_PX: number`(= 8)、`SIDEBAR_WIDTH: number`(= 240)、`DOCK_ANIM_MS: number`(= 200)
  - `dockPlaceholderWidth(collapsed: boolean): number`
  - `dockInnerClass(collapsed: boolean, peek: boolean): string`

- [ ] **Step 1: 写失败测试**

创建 `desktop/test/sidebarDock.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  HOTZONE_PX, SIDEBAR_WIDTH, DOCK_ANIM_MS, dockPlaceholderWidth, dockInnerClass,
} from '../src/renderer/lib/sidebarDock'

describe('常量', () => {
  it('热区 8 / 宽 240 / 动画 200', () => {
    expect(HOTZONE_PX).toBe(8)
    expect(SIDEBAR_WIDTH).toBe(240)
    expect(DOCK_ANIM_MS).toBe(200)
  })
})

describe('dockPlaceholderWidth', () => {
  it('展开 240 / 折叠 0', () => {
    expect(dockPlaceholderWidth(false)).toBe(240)
    expect(dockPlaceholderWidth(true)).toBe(0)
  })
})

describe('dockInnerClass', () => {
  it('展开态:流内 h-full w-60(忽略 peek)', () => {
    expect(dockInnerClass(false, false)).toBe('h-full w-60')
    expect(dockInnerClass(false, true)).toBe('h-full w-60')
  })
  it('折叠+peek:绝对浮层且 translate-x-0、无隐藏类', () => {
    const c = dockInnerClass(true, true)
    expect(c).toContain('absolute left-0 top-0 z-50')
    expect(c).toContain('rounded-r-xl shadow-2xl')
    expect(c).toContain('transition-transform duration-200 ease-out')
    expect(c).toContain('translate-x-0')
    expect(c).not.toContain('-translate-x-full')
    expect(c).not.toContain('pointer-events-none')
  })
  it('折叠+!peek:隐于左侧外 + pointer-events-none', () => {
    const c = dockInnerClass(true, false)
    expect(c).toContain('absolute left-0 top-0 z-50')
    expect(c).toContain('-translate-x-full')
    expect(c).toContain('pointer-events-none')
    expect(c).not.toContain('translate-x-0')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/sidebarDock.test.ts`
Expected: FAIL —— 无法解析 `../src/renderer/lib/sidebarDock`(模块/导出不存在)。

- [ ] **Step 3: 写实现**

创建 `desktop/src/renderer/lib/sidebarDock.ts`:

```ts
export const HOTZONE_PX = 8        // 折叠态左缘触发热区宽度(px)
export const SIDEBAR_WIDTH = 240   // 展开态占位宽(= aside 的 w-60)
export const DOCK_ANIM_MS = 200    // 划入/划出与折叠动画时长(ms)

/** 折叠占位宽:展开 240,折叠 0(配合 transition-[width] 做丝滑收展)。 */
export function dockPlaceholderWidth(collapsed: boolean): number {
  return collapsed ? 0 : SIDEBAR_WIDTH
}

/** 承 <Sidebar/> 的内层 wrapper 的定位/动画类,编码三态:
 *  展开 → 流内;折叠 → 绝对浮层,peek 控制丝滑滑入/滑出(始终 absolute 以保证 transform 过渡生效)。 */
export function dockInnerClass(collapsed: boolean, peek: boolean): string {
  if (!collapsed) return 'h-full w-60'
  const base = 'absolute left-0 top-0 z-50 h-full w-60 rounded-r-xl shadow-2xl transition-transform duration-200 ease-out'
  return peek ? base + ' translate-x-0' : base + ' -translate-x-full pointer-events-none'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/sidebarDock.test.ts`
Expected: PASS(全部用例通过)。

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: exit 0,无输出。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/lib/sidebarDock.ts desktop/test/sidebarDock.test.ts
git commit -m "feat(desktop/sidebar): sidebarDock 纯函数状态→样式映射 + 单测"
```

---

### Task 2: `components/SidebarDock.tsx` 受控折叠壳

**Files:**
- Create: `desktop/src/renderer/components/SidebarDock.tsx`

**Interfaces:**
- Consumes(Task 1):`import { dockInnerClass, dockPlaceholderWidth, HOTZONE_PX } from '../lib/sidebarDock'`。
- Produces(Task 3 依赖):default export `SidebarDock`,props `{ collapsed: boolean; peek: boolean; onPeekChange: (v: boolean) => void; children: React.ReactNode }`。

**说明:** 组件为纯展示 + 事件包装,无独立单元测试;验收 = `npm run typecheck` 通过 + 全量 `npm test` 保持绿(基线 641,无回归)。本任务只新增文件、尚未接入,对运行时零影响。真实动画/悬停在 Task 3 接入后眼验。

- [ ] **Step 1: 写组件**

创建 `desktop/src/renderer/components/SidebarDock.tsx`:

```tsx
import type { ReactNode } from 'react'
import { dockInnerClass, dockPlaceholderWidth, HOTZONE_PX } from '../lib/sidebarDock'

/** 侧栏折叠壳:承单个 <Sidebar/>(children)。展开态在布局流内推挤主内容;折叠态内层变绝对浮层,
 * peek 控制丝滑滑入/滑出;折叠态左缘 8px 热区 mouseenter → 划出。受控:collapsed/peek 由 App 持有,
 * 切换只改 wrapper 类,children(<Sidebar/>)不 remount,保留其内部状态。 */
export default function SidebarDock(
  { collapsed, peek, onPeekChange, children }:
  { collapsed: boolean; peek: boolean; onPeekChange: (v: boolean) => void; children: ReactNode },
): JSX.Element {
  return (
    <>
      {/* 流内占位:展开 240 推挤内容,折叠 0 让内容占满;宽度过渡做丝滑收展。不设 overflow-hidden,
          以便折叠态内层浮层(absolute)能溢出显示。 */}
      <div
        data-testid="sidebar-dock"
        className="relative h-full shrink-0 transition-[width] duration-200 ease-out"
        style={{ width: dockPlaceholderWidth(collapsed) }}
      >
        <div
          className={dockInnerClass(collapsed, peek)}
          onMouseLeave={() => { if (collapsed) onPeekChange(false) }}
        >
          {children}
        </div>
      </div>
      {/* 折叠态左缘热区:进入 → 划出浮层 */}
      {collapsed && (
        <div
          data-testid="sidebar-hotzone"
          className="fixed left-0 top-0 z-40 h-full"
          style={{ width: HOTZONE_PX }}
          onMouseEnter={() => onPeekChange(true)}
        />
      )}
    </>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: exit 0,无输出。

- [ ] **Step 3: 全量测试保持绿**

Run: `npm test`
Expected: 全部通过,不低于 641,无新增失败。

- [ ] **Step 4: 提交**

```bash
git add desktop/src/renderer/components/SidebarDock.tsx
git commit -m "feat(desktop/sidebar): SidebarDock 受控折叠壳(流内推挤↔浮层 + 左缘热区)"
```

---

### Task 3: `Sidebar.tsx` 折叠按钮 + `App.tsx` 集成

**Files:**
- Modify: `desktop/src/renderer/components/Sidebar.tsx`(props 类型 L98-131、lucide import、品牌头 L230-239)
- Modify: `desktop/src/renderer/App.tsx`(顶层容器 L806、Sidebar 挂载 L807-839、lucide import、新增状态/effect)

**Interfaces:**
- Consumes(Task 2):`import SidebarDock from './components/SidebarDock'`。
- Produces:侧栏折叠特性接入,面向用户可用。

**说明:** 涉及大文件 App 与 Sidebar 的接线,无独立单元测试;验收 = `npm run typecheck` 通过 + 全量 `npm test` 保持绿(641,无回归)+ 用户眼验(见末尾清单)。

- [ ] **Step 1: Sidebar.tsx —— props 类型加 `onToggleCollapsed`**

在 `desktop/src/renderer/components/Sidebar.tsx` 的 `interface SidebarProps`(末尾 `automationBadge: boolean` 那行之后、`}` 之前)加一行:

```ts
  automationBadge: boolean
  /** 展开态点击折叠、浮层态点击展开(翻转折叠)。传入才渲染折叠按钮。 */
  onToggleCollapsed?: () => void
```

- [ ] **Step 2: Sidebar.tsx —— 解构 + lucide 图标**

在函数签名的解构参数里(`automationBadge,` 之后、`}: SidebarProps` 之前)加 `onToggleCollapsed,`:

```ts
  automationBadge,
  onToggleCollapsed,
}: SidebarProps): JSX.Element {
```

在文件顶部的 `lucide-react` import 里加入 `PanelLeft`(与现有图标并列,例如加到 `ChevronDown,` 附近):

```ts
  Shield, ShieldAlert, ShieldCheck, ListTodo, PanelLeft,
```
(注:只需保证 `PanelLeft` 出现在从 `'lucide-react'` 解构的图标列表中;不要新增第二个 import 语句。)

- [ ] **Step 3: Sidebar.tsx —— 品牌头加折叠按钮**

把品牌按钮(L230-239)替换为「品牌按钮(flex-1)+ 折叠按钮」的一行:

原:
```tsx
        <button
          type="button"
          data-testid="brand-home"
          onClick={onNewConversation}
          title="回到新对话首页"
          className="flex w-full select-none items-center gap-2 px-4 py-4 text-left transition-opacity hover:opacity-80"
        >
          <Logo className="h-7 w-7 object-contain" />
          <span className="text-sm font-bold tracking-wide text-fg">WRAITH</span>
        </button>
```
改为:
```tsx
        <div className="flex items-center">
          <button
            type="button"
            data-testid="brand-home"
            onClick={onNewConversation}
            title="回到新对话首页"
            className="flex flex-1 select-none items-center gap-2 px-4 py-4 text-left transition-opacity hover:opacity-80"
          >
            <Logo className="h-7 w-7 object-contain" />
            <span className="text-sm font-bold tracking-wide text-fg">WRAITH</span>
          </button>
          {onToggleCollapsed && (
            <button
              type="button"
              data-testid="sidebar-collapse"
              onClick={onToggleCollapsed}
              title="折叠侧栏"
              className="mr-2 shrink-0 rounded-lg p-1.5 text-fg-muted hover:bg-surface/60 hover:text-fg"
            >
              <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
```

- [ ] **Step 4: App.tsx —— import**

在 `desktop/src/renderer/App.tsx` 顶部加入 `import SidebarDock from './components/SidebarDock'`(与其它 `./components/*` import 并列)。在 App 已有的 `lucide-react` import 里加入 `PanelLeft`(现有已导入 `PanelRight`/`SquareTerminal` 等,追加 `PanelLeft` 即可,不新增 import 语句)。

- [ ] **Step 5: App.tsx —— 新增状态 + 持久化 + 自动收 effect**

在 App 组件内(现有 `const [rightDockOpen, setRightDockOpen] = useState(false)` 附近)加:

```tsx
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => localStorage.getItem('wraith.sidebar.collapsed') === '1')
  const [sidebarPeek, setSidebarPeek] = useState(false)
```

在 App 组件内(与其它 `useEffect` 并列)加两个 effect:

```tsx
  // 折叠状态持久化
  useEffect(() => {
    localStorage.setItem('wraith.sidebar.collapsed', sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  // 折叠态下导航目标变化(切会话/切视图)→ 自动收浮层
  useEffect(() => {
    if (sidebarCollapsed) setSidebarPeek(false)
  }, [pv.activeSessionId, view, sidebarCollapsed])
```
(`pv`、`view`、`useState`、`useEffect` 均为 App 已有的作用域内符号。)

- [ ] **Step 6: App.tsx —— 用 SidebarDock 包裹 Sidebar + 折叠按钮回调**

把现有 `<Sidebar … />`(L807-839,整块)用 `<SidebarDock>` 包裹,并给 `<Sidebar>` 传 `onToggleCollapsed`:

```tsx
      <SidebarDock collapsed={sidebarCollapsed} peek={sidebarPeek} onPeekChange={setSidebarPeek}>
        <Sidebar
          workspace={state.workspace}
          projects={projects}
          busy={state.turn === 'running'}
          sessions={sessions}
          activeSessionId={pv.activeSessionId}
          runningSessionId={pv.runningSessionId}
          newDraftActive={!pv.activeSessionId}
          onNewConversation={handleNewConversation}
          onSelectSession={handleSelectSession}
          onToggleStar={handleToggleStar}
          onRenameSession={handleRenameSession}
          onDeleteSession={handleDeleteSession}
          onActivateProject={switchToProject}
          onAddProject={handleAddProject}
          onRemoveProject={handleRemoveProject}
          onRenameProject={handleRenameProject}
          sandbox={state.sandbox}
          activeNav={view === 'chat' ? null : view}
          onOpenPlugins={() => setView('plugins')}
          onOpenAutomations={() => setView('automations')}
          onOpenImGateway={() => setView('im-gateway')}
          onOpenProviders={() => setView('providers')}
          onOpenSkills={() => setView('skills')}
          onOpenMemory={() => setView('memory')}
          onOpenSnapshots={() => setView('snapshots')}
          onOpenTasks={() => setView('tasks')}
          onOpenPolicy={() => setView('policy')}
          onOpenBrowser={() => setView('browser')}
          onOpenRag={() => setView('rag')}
          onOpenSettings={() => setView('settings')}
          automationBadge={automationBadge}
          onToggleCollapsed={() => setSidebarCollapsed(v => !v)}
        />
      </SidebarDock>
```
(即:原 `<Sidebar … automationBadge={automationBadge} />` 保持所有既有 props 不变,仅在末尾加 `onToggleCollapsed`,外层用 `<SidebarDock …>…</SidebarDock>` 包住。)

- [ ] **Step 7: App.tsx —— 折叠态左上角浮动展开按钮**

在顶层容器 `<div className="flex h-screen overflow-hidden bg-bg text-fg">`(L806)**内部、`<SidebarDock>` 之前**插入:

```tsx
      {sidebarCollapsed && (
        <button
          type="button"
          data-testid="sidebar-expand"
          onClick={() => setSidebarCollapsed(false)}
          title="展开侧栏"
          className="fixed left-2 top-2 z-40 rounded-lg bg-surface/80 p-1.5 text-fg-muted shadow backdrop-blur hover:bg-surface hover:text-fg"
        >
          <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
        </button>
      )}
```
(`fixed left-2 top-2` = web 内容区左上角,标准标题栏在其上方 OS 层,不重叠红绿灯;`z-40` 低于浮层 `z-50`,peek 时被浮层遮住无妨。)

- [ ] **Step 8: 类型检查**

Run: `npm run typecheck`
Expected: exit 0,无输出。若报 `PanelLeft` 未定义 → 确认 Step 2/Step 4 的 lucide import;若报 `SidebarDock` 未找到 → 确认 Step 4 的 import 路径。

- [ ] **Step 9: 全量测试保持绿**

Run: `npm test`
Expected: 全部通过,不低于 641,无新增失败。

- [ ] **Step 10: 提交**

```bash
git add desktop/src/renderer/components/Sidebar.tsx desktop/src/renderer/App.tsx
git commit -m "feat(desktop/sidebar): 折叠切换按钮 + App 集成(SidebarDock 包裹 + 浮动展开 + 持久化 + 自动收)"
```

**眼验清单(实现者不执行,交回控制者/用户,须重启 `npm run dev`):**
- 侧栏头部折叠按钮 → 侧栏隐、主内容占满(丝滑);左上角出现浮动展开按钮。
- 折叠态鼠标移到窗口最左缘 → 浮层侧栏丝滑划出;移出浮层 → 丝滑滑回。
- 浮层内点会话/导航项 → 切换生效且浮层自动收回;搜索打字 / 展开工具分组不误收。
- 浮层里的折叠按钮 或 左上角浮动按钮 → 展开回流内推挤态。
- **不 remount 保状态**:展开态先激活搜索输入并打字 / 展开某工具分组,折叠再展开(或 peek)后仍保留。
- 折叠态重启 `npm run dev` 后保持折叠(持久化)。
- 浮层背景不透明(内容不透出);深浅主题视觉正常;不影响 RightDock/终端(可同时开)。

---

## Self-Review(计划对 spec 的自查)

**1. Spec coverage:**
- `sidebarDock.ts` 纯函数(HOTZONE_PX/SIDEBAR_WIDTH/DOCK_ANIM_MS + dockPlaceholderWidth + dockInnerClass 三态)→ Task 1(含全测)。✓
- `SidebarDock.tsx`(受控壳:流内占位 transition-[width] + 内层 dockInnerClass + onMouseLeave 收 + 折叠态左缘热区 onMouseEnter 开)→ Task 2。✓
- `Sidebar.tsx`(头部折叠按钮 + onToggleCollapsed prop,其余不动)→ Task 3 Step 1-3。✓
- `App.tsx`(sidebarCollapsed 持久化 + sidebarPeek + SidebarDock 包裹 + onToggleCollapsed 翻转 + 浮动展开按钮 + 自动收 effect)→ Task 3 Step 4-7。✓
- 折叠即全隐 / 持久化 key / 手感常量 / 不 remount / 不碰标题栏·RightDock·终端 → Global Constraints + 各 Step 明示。✓
- 测试:sidebarDock vitest + 既有保绿 → Task 1 Step 4 / Task 2·3 全量。✓

**2. Placeholder scan:** 无 TBD/TODO/"类似 Task N"/"处理边界";每个改代码步骤都有完整代码。✓

**3. Type consistency:**
- `dockPlaceholderWidth(boolean)→number`、`dockInnerClass(boolean,boolean)→string`、常量名在 T1 定义,T2 用法一致。✓
- `SidebarDock` props `{collapsed,peek,onPeekChange,children}` 在 T2 定义、T3 使用一致(`collapsed={sidebarCollapsed} peek={sidebarPeek} onPeekChange={setSidebarPeek}`)。✓
- `onToggleCollapsed?: () => void` 在 Sidebar props(T3-1)与 App 传参(T3-6)一致。✓
- 自动收 effect 依赖 `[pv.activeSessionId, view, sidebarCollapsed]` 均为 App 现有符号。✓
