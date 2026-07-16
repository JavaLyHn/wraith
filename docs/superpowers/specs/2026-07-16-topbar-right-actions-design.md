# 终端键 + 右侧面板键上移顶条右上角(仅聊天视图)设计稿

日期:2026-07-16
状态:设计已与用户确认(搬家不复制 + 仅聊天视图 + 一并消除 welcome 空工具条),待用户审阅
背景:上一特性(全宽顶条,commit 52810b2)把折叠键放到顶条左上角。用户想把**终端键**(`SquareTerminal`)和**右侧面板键**(`PanelRight`,browser/terminal 的 RightDock 开关)也放到顶条**右上角**,与左上角折叠键对称。

## 目标

把聊天顶部工具条里的 `terminal-toggle` + `rightdock-toggle` 两键搬到 `TopBar` 右上角(仅聊天视图显示);顺带消除搬走后 welcome 页残留的空工具条。行为/状态零改。

## 确认的决策(用户)

- **搬家不复制**:从聊天工具条移除,只留 TopBar 右上角一处。
- **仅聊天视图显示**(否决"所有视图常驻"):两键只在 `view === 'chat'` 出现——因终端抽屉/右侧面板本就服务聊天工作区;工具面板屏顶条右侧留空。不把 TerminalDrawer 提到 app 层(超范围)。
- **一并消除 welcome 空工具条**:搬走两键后聊天工具条剩下的「压缩提示/压缩/导出」全是 `!showWelcome` 才显示,故整条加 `!showWelcome` 守卫,welcome 页不再渲染空横带。

## 设计前提(已核)

- 现状:`terminal-toggle`(App.tsx:1002-1006)+ `rightdock-toggle`(:1007-1011)在聊天顶部工具条 `<div className="flex shrink-0 items-center justify-end gap-2 px-4 py-1.5">`(:976)内,与 `compact-notice`(:977)/`chat-compact`(:980)/`chat-export`(:991)并列。
- 该工具条在聊天视图 return 内(welcome + 活跃对话都渲染);`compact-notice`/`compact`/`export` 三者均 `!pv.showWelcome` 门控 → welcome 时它们全隐藏。
- 状态 `terminalOpen`/`rightDockOpen`(App.tsx:172-173);`TerminalDrawer`(:1032,聊天视图内)+ `RightDock`(:1038,内容行内)渲染位置本设计**不动**。
- `TopBar`(components/TopBar.tsx,上一特性建)当前 props `{ collapsed, onToggleCollapsed }`;容器 `[-webkit-app-region:drag]`。
- **无测试引用** `terminal-toggle`/`rightdock-toggle`/`chat-compact`/`chat-export`(已 grep 确认)→ 搬迁安全。
- `SquareTerminal`/`PanelRight` 在 App.tsx:36 已 import;搬迁后仍由 App 组装按钮 JSX,import 保留。

## 组件与改动

### A. `TopBar.tsx` — 加右侧插槽

props 增一个可选 `right?: ReactNode`。渲染:折叠键之后,若 `right` 存在则

```tsx
{right && (
  <div className="ml-auto flex items-center gap-1 [-webkit-app-region:no-drag]">
    {right}
  </div>
)}
```

- `ml-auto` 把该簇推到顶条最右;
- 整簇 `[-webkit-app-region:no-drag]` 保证插槽内按钮可点(不被拖拽区吞),App 侧按钮无需各自再加 no-drag;
- `right` 缺省(工具面板屏)时不渲染该 div;
- TopBar 仍只管布局/chrome,不关心放什么——签名 `{ collapsed: boolean; onToggleCollapsed: () => void; right?: ReactNode }`(需 `import { type ReactNode } from 'react'`)。

### B. `App.tsx` — 搬两键进插槽

- 从聊天工具条(:1002-1011)**删除** `terminal-toggle` + `rightdock-toggle` 两个 `<button>`。
- 渲染 TopBar 处(上一特性在 :841 左右)传 `right`:

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

- 两按钮**原样搬**:testid / onClick(翻转 `setTerminalOpen`/`setRightDockOpen`)/ 选中态 `text-accent` / title 全不变。
- 只在 `view === 'chat'` 传按钮(含 welcome,属聊天视图);其它视图传 `undefined`。

### C. `App.tsx` — 消除 welcome 空工具条(D)

搬走两键后,聊天工具条(:976)剩 `compact-notice`/`compact`/`export`,全 `!pv.showWelcome` 门控。把整条包一层守卫:

```tsx
{!pv.showWelcome && (
  <div className="flex shrink-0 items-center justify-end gap-2 px-4 py-1.5">
    {compactNotice && (<span data-testid="compact-notice" ...>{compactNotice}</span>)}
    <button data-testid="chat-compact" ...>…</button>
    <button data-testid="chat-export" ...>…</button>
  </div>
)}
```

- 外层 `!pv.showWelcome` 后,内部各项原来的 `!pv.showWelcome &&` 冗余,**去掉内层重复条件**(`compact-notice` 保留 `compactNotice &&`;compact/export 去掉 `!pv.showWelcome &&` 直接渲染)。
- welcome(`showWelcome=true`)→ 整条不渲染,空横带消失;活跃对话 → 工具条照旧(压缩/导出/提示)。

## 行为不变

- `terminalOpen`/`rightDockOpen` 状态、`TerminalDrawer`/`RightDock` 渲染位置、peek、折叠、`localStorage` 全不动。
- 两键功能与选中态与搬迁前逐字一致;只是渲染位置从聊天工具条移到 TopBar 右簇。

## 门禁与约束

- 纯前端;desktop typecheck 0;全量 vitest 基线不降(675;本特性不新增/删测——无纯函数可测,验证靠 typecheck + 眼验)。
- testid `terminal-toggle`/`rightdock-toggle`/`chat-compact`/`chat-export`/`compact-notice` 全保留(无测试引用,但保留以防 e2e/未来)。
- 拖拽区语义:插槽 no-drag,按钮可点。
- push 需用户单独点头。

## 眼验(定案点)

1. 聊天屏(活跃对话):TopBar 右上角出现终端键 + 右侧面板键;点击照旧开关终端抽屉 / 右侧面板;选中态 `text-accent` 正常。
2. 新对话页(welcome):TopBar 右上角**仍有**这两键(属聊天视图);TopBar 与欢迎内容之间**无空横带**(工具条已不渲染)。
3. 工具面板屏(MCP/自动化/设置…):TopBar 右侧**留空**(无这两键)。
4. 活跃对话工具条:压缩/导出/压缩提示照旧显示。
5. 明/暗两主题按钮观感正常。

## 风险

- App.tsx 又一处 JSX 结构微调(删两按钮 + 工具条包守卫):靠 typecheck 0 兜结构平衡。
- 插槽按钮的 `text-accent` 选中态依赖 `terminalOpen`/`rightDockOpen`——这两状态在 App 层,传入 TopBar 的是已算好的 JSX,状态变化会正常触发 App 重渲染 → TopBar 重渲染,选中态跟手。

## 不做(YAGNI)

- 不让终端在工具面板屏可用(不提升 TerminalDrawer 到 app 层);
- 不往插槽加其它按钮;
- 不改压缩/导出的逻辑(仅去掉与外层重复的 `!showWelcome` 内层条件);
- 不动 TopBar 左侧折叠键 / 交通灯 / 拖拽逻辑。
