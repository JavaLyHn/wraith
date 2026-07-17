# 磨砂 v2:splash 同款透明 + 顶行按列拆分 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主窗磨砂材质换 splash 同款 `fullscreen-ui`(真透壁纸);删全宽 TopBar,顶行拆两段分属两列——左段(交通灯+折叠键)回磨砂侧栏顶部,右段(chat 终端/右侧面板键)入内容列自己的顶行,实现 Codex 式"左磨砂整列到顶 / 右白到顶"。

**Architecture:** T1 一行材质替换(main 进程);T2 renderer 结构迁移(App 删 TopBar + Sidebar 加顶段 + 内容列加顶行)。两任务互相独立,串行提交。已批准 spec:`docs/superpowers/specs/2026-07-17-frosted-v2-split-toprow-design.md`(commit ed9b02c)。

**Tech Stack:** Electron main(vibrancy)+ React/TS + Tailwind。

## Global Constraints

- 纯视觉+结构迁移:不改行为/数据;testid:`sidebar-collapse` 迁入 Sidebar 顶段,新增 `sidebar-expand`(内容列顶行,折叠时),`terminal-toggle`/`rightdock-toggle` 原样迁移。
- desktop typecheck 0;全量 vitest 基线 675 不降(`test/topBar.test.ts` 测的纯函数 `topBarLeftPad` 不动)。
- 防漏光不变式:透明只存在于侧栏列;内容列(含新顶行)永远实底(继承列的 bg-surface/bg-bg)。
- push 需用户单独点头(不在本计划内)。

**工作目录**:命令在 `desktop/` 下执行。typecheck:`npm run typecheck`;测试:`npx vitest run`。git add/commit 用 `desktop/` 前缀路径、在仓库根跑。**T1 改 main 进程,眼验须完整重启 dev**(HMR 不重建 BrowserWindow)。

---

## File Structure

- Modify `desktop/src/main/index.ts` — vibrancy 材质(T1)。
- Modify `desktop/src/renderer/App.tsx` — 删 TopBar、内容列加顶行(T2)。
- Modify `desktop/src/renderer/components/Sidebar.tsx` — 加顶段+折叠键(T2)。
- Delete `desktop/src/renderer/components/TopBar.tsx`(T2)。

无新文件、无新测试(纯视觉;验证靠 typecheck 0 + vitest 基线 + 眼验)。

---

## Task 1: 磨砂材质换 splash 同款 fullscreen-ui

**Files:**
- Modify: `desktop/src/main/index.ts`(主窗 darwin 分支,约 :254)

- [ ] **Step 1: 换材质** — 按内容匹配这一行:

```ts
          vibrancy: 'sidebar' as const,
```

改为:

```ts
          vibrancy: 'fullscreen-ui' as const,
```

(与 `createSplash` 的材质一致;`visualEffectState`/`backgroundColor` 不动。)

- [ ] **Step 2: typecheck 0** — Run: `cd desktop && npm run typecheck`
- [ ] **Step 3: vitest 基线** — Run: `cd desktop && npx vitest run`,Expected: 675 passing。
- [ ] **Step 4: 提交**

```bash
git add desktop/src/main/index.ts
git commit -m "fix(desktop): 磨砂材质换 splash 同款 fullscreen-ui(sidebar 材质近实心灰不透壁纸)"
```

---

## Task 2: 顶行拆分(删全宽 TopBar,左段入侧栏 / 右段入内容列)

**Files:**
- Modify: `desktop/src/renderer/components/Sidebar.tsx`
- Modify: `desktop/src/renderer/App.tsx`
- Delete: `desktop/src/renderer/components/TopBar.tsx`

**Interfaces:**
- Sidebar 新 props:`collapsed: boolean; onToggleCollapsed: () => void`。

- [ ] **Step 1: Sidebar 加顶段** — `desktop/src/renderer/components/Sidebar.tsx`

1. lucide import 加回 `PanelLeft`;新增 `import { topBarLeftPad } from '../lib/topBar'`。
2. `SidebarProps` 接口与解构加 `collapsed: boolean` 和 `onToggleCollapsed: () => void`。
3. aside(`className="sidebar-gradient flex h-full w-60 flex-col border-r border-border"`,约 :185)内部第一个子元素插入:

```tsx
      {/* 顶段:交通灯让位 + 折叠键;拖拽区。mac 下透明露磨砂 */}
      <div className={'flex h-[38px] shrink-0 items-center [-webkit-app-region:drag] ' + topBarLeftPad(window.wraith.platform)}>
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
```

(peek 态 collapsed=true,title 显"展开侧栏",点击即钉住展开——语义自洽。)

- [ ] **Step 2: App 删 TopBar、内容列加顶行** — `desktop/src/renderer/App.tsx`

1. 删 `import TopBar from './components/TopBar'`(:51);lucide import 加回 `PanelLeft`;新增 `import { topBarLeftPad } from './lib/topBar'`。
2. 删除根下整个 `<TopBar … />` 元素(:841-858,含 right 簇两按钮 JSX——它们迁到下面第 4 步)。
3. `<Sidebar` 调用处(:861)加 props:`collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed(v => !v)}`。
4. 内容列 div(`className={'relative flex min-w-0 flex-1 flex-col ' + (view === 'chat' ? 'bg-surface' : 'bg-bg')}`)内部第一个子元素(DisconnectedBanner 之前)插入:

```tsx
        {/* 内容列顶行:拖拽区,继承列实底(白/灰)。折叠时承展开键(交通灯右);chat 视图右簇终端/右侧面板键 */}
        <div className={'flex h-[38px] shrink-0 items-center [-webkit-app-region:drag] ' + (sidebarCollapsed ? topBarLeftPad(window.wraith.platform) : 'pl-2')}>
          {sidebarCollapsed && (
            <button
              type="button"
              data-testid="sidebar-expand"
              onClick={() => setSidebarCollapsed(false)}
              title="展开侧栏"
              className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface/60 hover:text-fg [-webkit-app-region:no-drag]"
            >
              <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
          {view === 'chat' && (
            <div className="ml-auto flex items-center gap-1 pr-2 [-webkit-app-region:no-drag]">
              <button data-testid="terminal-toggle" onClick={() => setTerminalOpen(v => !v)}
                className={'flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-surface hover:text-fg ' + (terminalOpen ? 'text-accent' : 'text-fg-muted')}
                title="终端">
                <SquareTerminal className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button data-testid="rightdock-toggle" onClick={() => setRightDockOpen(v => !v)}
                className={'flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-surface hover:text-fg ' + (rightDockOpen ? 'text-accent' : 'text-fg-muted')}
                title="右侧面板(浏览器/终端)">
                <PanelRight className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          )}
        </div>
```

5. :992 注释 `终端/右侧面板键已移至 TopBar 右簇` 改为 `终端/右侧面板键在内容列顶行右簇`。

- [ ] **Step 3: 删 TopBar 组件** — `rm desktop/src/renderer/components/TopBar.tsx`(`lib/topBar.ts` 与其测试保留)。

- [ ] **Step 4: typecheck 0** — Run: `cd desktop && npm run typecheck`(重点:无未用 import;Sidebar 新 props 全部调用点已传)。
- [ ] **Step 5: vitest 基线** — Run: `cd desktop && npx vitest run`,Expected: 675 passing。
- [ ] **Step 6: 提交**

```bash
git add -A desktop/src/renderer
git commit -m "feat(desktop): 顶行按列拆分——删全宽TopBar,折叠键回磨砂侧栏顶段,chat右簇入内容列顶行(Codex式左磨砂/右白到顶)"
```

---

## 收尾:门禁 + opus 终审 + 眼验

- 全量 `npm run typecheck`(0)+ `npx vitest run`(675)。
- opus 读全 diff(base..HEAD)终审:防漏光不变式(内容列顶行实底)、testid 迁移完整、折叠/peek/drag 行为不回归、无残留 TopBar 引用、YAGNI。
- 眼验清单(spec)交用户定案:磨砂=splash 底色、白到顶无灰带、折叠/展开/peek、拖拽、暗色、可读性(不够加 tint)。
- **push 需用户单独点头**。

## 执行说明

- T1 → T2 串行提交(互相独立,但保持单线避免冲突)。
- T1 模型 haiku(单文件机械);T2 模型 sonnet(多文件迁移);reviewer sonnet;终审 opus。
