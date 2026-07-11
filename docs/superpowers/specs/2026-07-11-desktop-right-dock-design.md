# 桌面右侧停靠列(A2:浏览器 + 终端)设计稿

日期:2026-07-11
状态:已与用户确认设计(4 点确认),待写实现计划
所属:子项目 A(停靠工具面板)之 A2;A1(底部终端抽屉)已完成并合入。

## 目标

主窗顶部工具条加**第二个按钮**,开/关一个**右侧停靠列**;列内用**分段切换**在「浏览器」和「终端」间选一个显示。浏览器是**用户可浏览网页的内嵌 webview**(地址栏 + 导航);终端**复用 A1**。列从右缘丝滑展开、可拖宽,与底部终端抽屉相互独立、可同时开。

## 确认的决策(用户 4 点)

1. 浏览器是**给用户浏览网页**用(不是给 agent 用;agent 的 CDP 浏览器仍是独立的 BrowserPanel,不混)。
2. 列内**一次显示一个**(浏览器 或 终端,分段切换)。
3. 右侧列与底部终端抽屉(A1)**可同时开**、相互独立。
4. 浏览器**先做单视图**(暂不做浏览器内多标签)。

## 范围

- **做**:右侧停靠列壳(宽度可拖、丝滑展开、第二个开关按钮)+ 分段切换 + 内嵌浏览器(webview + 地址栏 + 前进/后退/刷新)+ 终端(复用 A1,抽出 TerminalPane)。
- **不做**(YAGNI):agent 驱动该浏览器、书签/历史/下载管理、浏览器内多标签、把 A1 底部抽屉的行为改动(仅做非破坏性抽取)。

## 布局 / 交互

- 主内容外层由单列改为**横向 flex**:`[主内容(flex-1,chat/工具面板/transcript+composer)] [右侧列(固定宽,可拖)]`。当前包裹层 `<div className="relative flex min-w-0 flex-1 flex-col">`(App.tsx:837)整体作为"主内容",与右侧列并列包进一个横向 flex 容器。
- **右侧列**(`RightDock`):`open=false` → 宽度过渡到 0(`transition-[width] 300ms ease-out`,拖拽时关过渡)、常驻挂载(webview/PTY 不丢);`open=true` → 展开到 width。**拖左边缘**调宽(min ~320px / max ~70% 窗宽)。
- 顶部工具条(已有终端开关)右侧加**第二个按钮**(lucide `PanelRight`),切换右侧列 open。
- 列顶:**分段切换**(浏览器 | 终端)+ 右上 `×` 收起。切换只改显示,两者都常挂(webview 与 TerminalPane 都不卸载,切回保留状态)。

## 组件 / 架构

### `RightDock.tsx`(列壳)
- props:`open: boolean`、`cwd: string | null`、`onClose: () => void`。
- 状态:`pane: 'browser' | 'terminal'`(分段切换)、`width`(拖拽)、`dragging`。
- 根:`style={{ width: open ? width : 0 }}` + `overflow-hidden` + 非拖拽时 `transition-[width]`;左边缘拖拽手柄调宽(拖拽期关过渡)。
- 常挂 `<BrowserPane active={pane==='browser'} />` 与 `<TerminalPane active={open && pane==='terminal'} cwd={cwd} />`,用 CSS 显隐切换(都不卸载)。

### `BrowserPane.tsx`(新内嵌浏览器)
- 顶部:后退/前进/刷新按钮 + 地址栏(输入 URL、回车导航,经 `normalizeUrl` 补 `https://`)。
- 主体:`<webview>`(Electron),`partition="persist:wraith-browser"`(独立隔离会话)、`nodeintegration` 关、`allowpopups` 关;`did-start-loading`/`did-stop-loading`/`did-fail-load`/`did-navigate` 更新地址栏与加载态。
- 开启 webview:`webPreferences.webviewTag = true`(main 的 `createWindow` BrowserWindow 选项)。
- 默认空白起始页(`about:blank`);失败态显文案。

### `TerminalPane.tsx`(从 A1 `TerminalDrawer` 抽出)
- 抽出「标签栏 + 多标签 xterm + PTY 管理(addNew/close/state,复用 `terminalTabs` 纯函数 + `TerminalTab`)」为独立组件,**不含**底部 dock 的高度拖拽。
- props:`active: boolean`(active && 无标签时自动建首标签;active 时聚焦当前)、`cwd: string | null`。
- **A1 底部抽屉 `TerminalDrawer` 改为**:保留自身「高度 dock 壳 + 顶边拖拽 + open 高度动画」,内部渲染 `<TerminalPane active={open} cwd=… />`(把 tab/PTY 逻辑迁进 TerminalPane)。行为对用户不变(非破坏性重构;需回归 A1 眼验)。

### App 集成
- 新增 `rightDockOpen` 状态 + 工具条第二个按钮。
- 把「主内容包裹层」与 `<RightDock open={rightDockOpen} cwd={state.workspace} onClose={…}/>` 包进横向 flex。

## 纯函数与可测性
- `clampColumnWidth(px, winW): number`(min 320 / max 0.7*winW)→ vitest。
- `normalizeUrl(input): string`(空→about:blank;无协议补 https://;已带协议原样;搜索词可选,先只补协议)→ vitest。
- (可选)chooser/宽度状态若含逻辑分支也测。
- webview、拖拽调宽、动画、TerminalPane 重构后的终端行为:集成/眼验。

## 错误 / 边界
- webview 加载失败(`did-fail-load`)→ 地址栏保留 + 显"加载失败"文案,不崩。
- 右侧列与底部抽屉同时开:两套独立面板/PTY,互不干扰。
- 收起(width 0)常挂:webview 不销毁(保留页面)、TerminalPane 的 PTY 不杀。
- TerminalPane 重构:必须保持 A1 底部抽屉原有行为(多标签/切换保留/关标签杀/收起保留 PTY)。

## 测试
- 纯函数 `clampColumnWidth` / `normalizeUrl` vitest;A1 既有 `terminalTabs`/`ptyHelpers` 测试保持绿(重构不改其接口)。
- 眼验:第二个按钮开/关右侧列(丝滑)、拖宽、分段切浏览器/终端、浏览器导航(输网址/前进后退刷新)、右侧列与底部终端同时开、收起再开保留、A1 底部抽屉回归无变化。

## 交付后 / 风险
- **webviewTag 安全**:开启后所有窗口可用 `<webview>`;用独立 partition + 关 nodeintegration + 关 allowpopups 收敛面。
- **A1 重构回归**:TerminalPane 抽取后须眼验底部抽屉行为一致(最大回归风险)。
- webview 定位/尺寸随列宽变化重排;加载态与失败态覆盖。
