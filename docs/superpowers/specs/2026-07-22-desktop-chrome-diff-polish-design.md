# 桌面 chrome / diff 视图打磨设计(5 项)

**日期**:2026-07-22
**状态**:设计待用户审阅
**范围**:桌面端 renderer(+少量 shared 纯函数),**不改 Java / 不重打 jar**。含一处根布局重构(顶栏)+ 一套动效规范。

## 背景

一次性提出 5 项(2 修复 + 1 功能 + 1 布局重构 + 1 动效):
1. 首轮前上下文 chip 显示 0%(现显 3% 基线,用户觉得反直觉)。
2. 右侧 diff 只占上半区(#67):内容盒被钳在 ≤400px,下方大片空白。
3. diff 加「分两列(类 git)」切换按钮(#67)。
4. 顶栏三按钮(侧栏切换 / 终端 / 右栏)**恒显 + 锚定窗口边缘**、不随右栏开合或侧栏折叠飘移(#68)。
5. 右栏 / 终端抽屉 / 侧栏统一一套**克制丝滑(200–300ms)**动效。

已敲定决策:④=恒显+锚定窗口两端;⑤=克制丝滑快(ease-out/轻弹 + 内容淡入上滑,类 macOS 原生);③默认沿用 inline、按钮切两列。

## 逐项设计

### ① 首轮 chip 显示 0%(`StatusChip.tsx` `chipView` 纯函数)

`chipView(status, watermark)`:当**无实时 status**(未跑过真实回合)**且 watermark 为估算基线**(`estimated===true`)时 → 返回 `{ pct: 0, tw: TIER_TW[0], suffix: '' }`。首轮真实用量回来后(status 存在,或 watermark `estimated===false`)照常显实数。

- 新会话即 0%、无 `~`;右侧上下文面板仍显基线明细(不改面板)。
- 已知取舍:**resumed 会话在本会话首个新回合前也显 0%**(其"本会话尚未消耗"语义可接受);真实占用在首轮后立刻显现。spec 明确,非疏漏。
- 测试:`chipView(null, {estimated:true,...})` → pct 0;`chipView(status, ...)` / `estimated:false` → 实数(原有断言保留)。

### ② 右侧 diff 填满 pane(`DiffView.tsx` + `PreviewPane.tsx`)

`DiffView` 现在只用于右侧 pane(内联 DiffCard 已删),其自钳高度(`Math.min(Math.max(contentH,80),400)`)导致只占上半区。

- `DiffView` 新增 `fill?: boolean`:`fill` 时容器 `style={{ height: '100%' }}`(充满父级),跳过 80–400 钳制;仍照算 +/- 统计。非 fill 保留原钳制(向后兼容)。
- `PreviewPane` diff 分支:外层 `min-h-0 flex-1`,`<DiffView fill .../>` 充满;去掉外层 `overflow-auto`(Monaco 自带内部滚动 + `automaticLayout`)。
- 测试:`PreviewPane` diff 分支渲染 `diff-preview` 容器(现有);DiffView `fill` 时 host `style.height==='100%'`(新单测,或在 previewPane 测试断言)。

### ③ diff 分两列切换(`DiffView.tsx` + `PreviewPane.tsx`)

- `DiffView` 新增 `sideBySide?: boolean` → 传入 Monaco `renderSideBySide`。加入 effect 依赖(切换时重建 DiffEditor,一次点击成本可接受)。
- `PreviewPane` diff 头部右侧加切换按钮(`data-testid="diff-split-toggle"`,lucide `Columns2` 图标,`aria-pressed`),本地 `useState(false)` 存 sideBySide,传给 DiffView。默认 inline;点按钮 → 两列;再点回 inline。
- 状态存 `PreviewPane` 本地:切换文件(preview 变)时复位为 inline —— 可接受(每个文件独立)。
- 测试:diff 分支出现 `diff-split-toggle`;点击翻转 `aria-pressed`(Monaco 内部渲染不在单测断言范围)。

### ④ 贯通整窗顶栏(根布局重构,`App.tsx` + 新 `TopBar.tsx`)

**目标**:三按钮恒显、锚定窗口两端,右栏开合 / 侧栏折叠都不使其位移(#68)。

**现状**:结构 `[Sidebar | [内容列 | RightDock]]`,顶行 `h-[38px]` 只在内容列内 → 右栏开→内容列收窄→右侧按钮左移;左侧展开键仅折叠态显示;右侧键仅 chat 视图。

**新结构**(整窗竖分两层):
```
<div class="flex h-full flex-col">
  <TopBar />                                   // 贯通整窗,h-[38px],[-webkit-app-region:drag]
  <div class="flex min-h-0 flex-1 overflow-hidden">   // body 行(原布局)
    <SidebarDock>…</SidebarDock>
    <div class="flex min-w-0 flex-1 flex-row">
      <内容列>(去掉原顶行)
      <RightDock/>
    </div>
  </div>
</div>
```

**`TopBar`**(新组件,纯展示 + 回调):
- 左簇(锚窗口左):macOS 交通灯内衬(复用 `topBarLeftPad(platform)`)+ **侧栏切换键**(`PanelLeft`/`PanelLeftClose`,恒显;点击 `onToggleSidebar`,反映 collapsed 态)。
- 中段:弹性 drag 空白。
- 右簇(锚窗口右):**终端键**(`SquareTerminal`)+ **右栏键**(`PanelRight`),恒显(所有视图);active 态 `text-accent`;`[-webkit-app-region:no-drag]`。
- props:`{ platform, sidebarCollapsed, onToggleSidebar, terminalOpen, onToggleTerminal, rightDockOpen, onToggleRightDock }`。
- 因顶栏贯通,右簇锚在整窗右缘 → 右栏(在下层 body 内)开合不再影响其位置。✓

**连带调整**(需谨慎、逐一核对):
- Sidebar 顶部**移除交通灯内衬**(交通灯移到 TopBar 左簇);WRAITH logo 行改为从 TopBar 下方开始。SidebarDock 的 peek/折叠/热区**逻辑不变**(仍在 body 行内),仅其纵向起点下移到 TopBar 之下。
- 内容列删除原 `h-[38px]` 顶行及其中按钮(移入 TopBar);`sidebarCollapsed` 时的 `sidebar-expand` 键由 TopBar 的侧栏切换键取代。
- 保留全部 `data-testid`:`terminal-toggle` / `rightdock-toggle` 迁到 TopBar;侧栏切换键用 `sidebar-toggle`(展开态也在;`sidebar-expand` 语义并入)。**e2e 依赖这些 testid**,迁移后须回归 shell.e2e(尤其侧栏折叠/展开、右栏、终端相关用例)。
- 顶栏贯通后,浏览器/终端/上下文/预览的右栏**自身头部(段切换 + 关闭 X)保持不变**(在 RightDock 内,TopBar 之下)。

**风险**:这是唯一动根布局的一项,牵涉交通灯、drag 区、侧栏顶、e2e testid。实现时**单独成任务 + 完整 shell.e2e 回归**。

### ⑤ 克制丝滑动效(`RightDock` / `TerminalDrawer` / `SidebarDock` / `PreviewPane`)

统一动效令牌 + 内容进入动画。风格:200–300ms、ease-out(收展)/内容淡入上滑,尊重 `prefers-reduced-motion`。

- **动效令牌**(`index.css` 或 tailwind):`--ease-smooth: cubic-bezier(0.22, 1, 0.36, 1)`;时长 `panel 220ms`。
- **RightDock**:壳 `transition-[width]` 300→**220ms** + `--ease-smooth`;新增**内容进入**:pane 内容(PreviewPane/各面板)首次显示时 `opacity 0→1 + translateY 6px→0`(~200ms,keyframe `panelContentIn`)。
- **TerminalDrawer**:壳 `transition-[height]` 300→**220ms** + `--ease-smooth`;内容(TerminalPane 区)同款淡入上滑。
- **SidebarDock**:占位 `transition-[width]` 200→统一 `--ease-smooth`;peek 划入沿用,easing 对齐。
- **PreviewPane**:内容淡入上滑(同 keyframe),diff/内容切换时轻微 crossfade(可选,先做进入即可)。
- `motion-reduce:` 分支:一律去动画(直接终态)。
- 不改任何开合的触发逻辑与拖拽调宽/高;仅调 easing/时长 + 内容进入 keyframe。
- 测试:动画属 CSS,难单测;以 tsc + 现有交互测试不回归为准,真机眼验流畅度(本项验收靠眼验)。

## 任务切分(供 plan)

- Task A ①:chip 0%(纯函数 + 测试)。
- Task B ②:DiffView `fill` + PreviewPane 充满。
- Task C ③:DiffView `sideBySide` + PreviewPane 切换按钮。
- Task D ④:TopBar 贯通重构(**高风险,含 shell.e2e 全回归**)。
- Task E ⑤:动效令牌 + 各面板内容进入动画。

顺序:A→B→C(diff/chip 低风险先行)→ E(动效)→ D(布局重构最后,回归面最大)。或 D 独立最后做。

## 明确不做(YAGNI)

- 不改上下文面板的基线明细展示(只改 chip 口径)。
- 不做 diff 的行级 stage/comment 等 git 高级功能(仅两列视图切换)。
- 不引入动画库(framer-motion 等);纯 CSS transition/keyframe。
- 不改窗口 frameless / titleBarStyle 配置(交通灯内衬沿用现有 `topBarLeftPad`)。
- side-by-side 状态不跨文件/跨会话持久化。
