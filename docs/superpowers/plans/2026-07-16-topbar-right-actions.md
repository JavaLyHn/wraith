# 终端键+右侧面板键上移顶条右上角 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把聊天工具条里的终端键 + 右侧面板键搬到 TopBar 右上角(仅聊天视图),并消除搬走后 welcome 页残留的空工具条。

**Architecture:** TopBar 加一个可选 `right?: ReactNode` 插槽(`ml-auto` 推右 + 整簇 no-drag);App 把两个 toggle 按钮原样移进插槽、仅 `view === 'chat'` 传入;聊天工具条整体加 `!pv.showWelcome` 守卫并去掉内层重复条件。纯视觉/位置改造,状态与行为零改。

**Tech Stack:** React/TS + Tailwind + vitest(desktop)。已批准 spec:`docs/superpowers/specs/2026-07-16-topbar-right-actions-design.md`(commit c785d05)。

## Global Constraints

- 纯前端;desktop typecheck 0;全量 vitest 基线不降(675;本特性无可测纯函数,不新增/删测,验证靠 typecheck + 眼验)。
- 行为/状态零改:`terminalOpen`/`rightDockOpen` 状态、`TerminalDrawer`/`RightDock` 渲染位置、peek、折叠、`localStorage` 全不动;两键 onClick/选中态 `text-accent`/title/testid 逐字不变。
- 两键仅 `view === 'chat'` 显示(含 welcome);其它视图不传(插槽 `undefined`)。
- testid 全保留:`terminal-toggle`/`rightdock-toggle`/`chat-compact`/`chat-export`/`compact-notice`(无测试引用,已核,但保留)。
- 拖拽区:插槽 `[-webkit-app-region:no-drag]`,按钮可点。
- push 需用户单独点头(不在本计划内)。

**工作目录**:命令在 `desktop/` 下执行。typecheck:`npm run typecheck`;测试:`npx vitest run`。git add/commit 用 `desktop/` 前缀路径、在仓库根跑。

---

## File Structure

- Modify `desktop/src/renderer/components/TopBar.tsx` — 加 `right?: ReactNode` 插槽 + 渲染右簇。
- Modify `desktop/src/renderer/App.tsx` — TopBar 调用处传 `right`;聊天工具条删两 toggle + 加 `!showWelcome` 守卫 + 去内层重复条件 + 更新过时注释。

无新文件、无新测试(纯 JSX 位置调整,验证靠 typecheck 0 + vitest 基线 + 眼验)。

---

## Task 1: TopBar 右插槽 + 两键搬迁 + 消除 welcome 空工具条

**Files:**
- Modify: `desktop/src/renderer/components/TopBar.tsx`
- Modify: `desktop/src/renderer/App.tsx`(TopBar 调用处 ~:841;聊天工具条 ~:975-1012)

**Interfaces:**
- Produces: `<TopBar collapsed={boolean} onToggleCollapsed={() => void} right?={ReactNode} />`(新增可选 `right`)。
- Consumes: 现有 `terminalOpen`/`rightDockOpen`/`setTerminalOpen`/`setRightDockOpen`/`view`/`pv.showWelcome`(App 内已存在)。

- [ ] **Step 1: TopBar 加 `right?` 插槽** — `desktop/src/renderer/components/TopBar.tsx`

把当前整文件(已提交版):

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

整体替换为(加 `ReactNode` import、`right?` prop、右簇渲染):

```tsx
import { type ReactNode } from 'react'
import { PanelLeft } from 'lucide-react'
import { topBarLeftPad } from '../lib/topBar'

interface TopBarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 右上角动作簇(如终端/右侧面板键);缺省则右侧留空。整簇自动 no-drag。 */
  right?: ReactNode
}

/** 全宽顶条:窗口拖拽区(macOS 隐藏原生标题栏后)+ 折叠键(左,紧挨交通灯)+ 可选右动作簇。 */
export default function TopBar({ collapsed, onToggleCollapsed, right }: TopBarProps): JSX.Element {
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
      {right && (
        <div className="ml-auto flex items-center gap-1 pr-2 [-webkit-app-region:no-drag]">
          {right}
        </div>
      )}
    </div>
  )
}
```

(`pr-2` 给右簇留一点右边距,不贴窗口边缘。)

- [ ] **Step 2: App 传 `right` 给 TopBar** — `desktop/src/renderer/App.tsx`

把(约 :841):

```tsx
      <TopBar collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed(v => !v)} />
```

替换为:

```tsx
      <TopBar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed(v => !v)}
        right={view === 'chat' ? (
          <>
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
          </>
        ) : undefined}
      />
```

(两按钮 JSX 与原工具条里逐字一致,仅位置从工具条移到此处;`SquareTerminal`/`PanelRight` import 保持不变,仍被此处使用。)

- [ ] **Step 3: 聊天工具条删两键 + 加 `!showWelcome` 守卫 + 去内层重复** — `desktop/src/renderer/App.tsx`

把当前工具条整块(约 :975-1012):

```tsx
                {/* 顶部工具条:终端开关常驻(新对话页也在);压缩/导出仅活跃对话显示 */}
                <div className="flex shrink-0 items-center justify-end gap-2 px-4 py-1.5">
                  {!pv.showWelcome && compactNotice && (
                    <span data-testid="compact-notice" className="mr-auto truncate text-2xs text-fg-subtle">{compactNotice}</span>
                  )}
                  {!pv.showWelcome && (
                    <button
                      data-testid="chat-compact"
                      onClick={() => void handleCompact()}
                      disabled={compactBusy || state.turn === 'running' || !pv.items.length}
                      title="压缩上下文:把较早的对话压成摘要,释放上下文窗口(不改可见记录)"
                      className={'flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-40'}
                    >
                      <Wand2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />{compactBusy ? '压缩中…' : '压缩'}
                    </button>
                  )}
                  {!pv.showWelcome && (
                    <button
                      data-testid="chat-export"
                      onClick={() => void handleExport()}
                      disabled={!pv.items.length}
                      title="导出当前对话为 Markdown"
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />导出
                    </button>
                  )}
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
```

整体替换为(整条 `!pv.showWelcome` 守卫、删两 toggle、内层去掉重复的 `!pv.showWelcome`、注释更新):

```tsx
                {/* 顶部工具条:压缩/导出仅活跃对话显示;终端/右侧面板键已移至 TopBar 右簇 */}
                {!pv.showWelcome && (
                  <div className="flex shrink-0 items-center justify-end gap-2 px-4 py-1.5">
                    {compactNotice && (
                      <span data-testid="compact-notice" className="mr-auto truncate text-2xs text-fg-subtle">{compactNotice}</span>
                    )}
                    <button
                      data-testid="chat-compact"
                      onClick={() => void handleCompact()}
                      disabled={compactBusy || state.turn === 'running' || !pv.items.length}
                      title="压缩上下文:把较早的对话压成摘要,释放上下文窗口(不改可见记录)"
                      className={'flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-40'}
                    >
                      <Wand2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />{compactBusy ? '压缩中…' : '压缩'}
                    </button>
                    <button
                      data-testid="chat-export"
                      onClick={() => void handleExport()}
                      disabled={!pv.items.length}
                      title="导出当前对话为 Markdown"
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />导出
                    </button>
                  </div>
                )}
```

- [ ] **Step 4: typecheck 0**

Run: `cd desktop && npm run typecheck`
Expected: 0 errors(TopBar `right?` 类型正确、`ReactNode` import 已用、App JSX 平衡、无未用变量;`SquareTerminal`/`PanelRight` 仍被 Step 2 使用不报未用)。

- [ ] **Step 5: 全量 vitest 基线不降**

Run: `cd desktop && npx vitest run`
Expected: 81 files / 675 passing(与基线同;本任务无新增/删除测试)。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/components/TopBar.tsx desktop/src/renderer/App.tsx
git commit -m "feat(desktop): 终端键+右侧面板键上移 TopBar 右簇(仅聊天视图)+ 消除 welcome 空工具条"
```

- [ ] **Step 7: 眼验(定案点,不阻塞提交,报告注明)**

`npm run dev` 后核:
1. 活跃对话:TopBar 右上角出现终端键 + 右侧面板键;点击照旧开关终端抽屉 / 右侧面板;选中态 `text-accent` 正常。
2. 新对话页:TopBar 右上角仍有这两键;TopBar 与欢迎内容间**无空横带**(工具条不渲染)。
3. 工具面板屏(MCP/自动化/设置…):TopBar 右侧留空。
4. 活跃对话工具条:压缩/导出/压缩提示照旧。
5. 明/暗两主题按钮观感正常。

---

## 收尾:门禁 + opus 终审

- 全量 `npm run typecheck`(0)+ `npx vitest run`(675)。
- opus 读全 diff(base..HEAD 单提交)终审:插槽 no-drag 正确性、两键行为/选中态无回归、工具条守卫无误伤(welcome 隐、活跃显)、YAGNI、无悬挂引用。
- 眼验清单(Step 7)交用户定案。
- **push 需用户单独点头**(不在本计划内)。

---

## 执行说明

- 单任务(TopBar + App 同改,一体交付,无独立可测子单元)。
- 无并行;无 git 竞态。
