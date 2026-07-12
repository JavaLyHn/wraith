# 侧边栏折叠 + 悬停划出浮层(Codex 式)设计稿

日期:2026-07-12
状态:已与用户确认设计(3 点确认),待写实现计划
所属:桌面独立交互增强(不属于既有 A/A2 子项目)。

## 目标

给 wraith 桌面加 Codex 式侧栏折叠:①折叠按钮 → 侧栏隐藏、主内容占满全宽;②折叠态下鼠标移到窗口最左缘,侧栏以**浮层**(悬浮在内容之上、圆角右+阴影、不挤压内容)丝滑划出;③鼠标移出浮层丝滑消失;④浮层内点选会话/导航项后自动收回。折叠状态持久化。

## 确认的决策(用户 3 点)

1. **折叠按钮走轻量方案**:不改系统标题栏(wraith 主窗是标准 macOS 标题栏,非 hiddenInset)。展开态折叠按钮在侧栏头部;折叠态用**左上角常驻浮动展开按钮**(绝对定位、跨所有视图可用)作为再展开入口,浮层里也有同一个切换按钮。
2. **浮层内点选后自动滑回**(保持折叠态)。
3. **折叠即全隐**(与 Codex 截图一致,不留 mini 图标条)。
4. 手感:左缘触发热区 **8px**、划入/划出动画 **200ms**。

## 范围

- **做**:`lib/sidebarDock.ts`(纯函数状态→样式映射 + 常量)、`components/SidebarDock.tsx`(受控浮层壳 + 热区 + 动画)、`Sidebar.tsx`(头部加折叠切换按钮)、`App.tsx`(折叠/浮层状态 + 持久化 + 用 SidebarDock 包 Sidebar + 左上角浮动展开按钮 + 点选后自动收 effect)。
- **不做**(YAGNI):自绘 hiddenInset 标题栏、back/forward 视图导航、折叠态 mini 图标条、侧栏宽度可拖拽。

## 布局 / 交互

现状:顶层 `<div className="flex h-screen overflow-hidden bg-bg text-fg">` → `<Sidebar/>`(`<aside className="sidebar-gradient flex h-full w-60 flex-col border-r border-border">`,240px)→ `<div className="flex min-w-0 flex-1 flex-row">`(主内容 + RightDock)。

改后:`<Sidebar/>` 由 `<SidebarDock>` 包裹(仍是顶层 flex 的第一个子)。**单个 `<Sidebar/>` 实例始终挂载**,SidebarDock 只切换外层 wrapper 的类(流内 ↔ 浮层),**不 remount**,保留侧栏内部状态(搜索词、展开的工具分组)。

三态:
- **展开**(`!collapsed`):侧栏在布局流内(占位宽 240),推挤主内容。侧栏头部有折叠切换按钮。
- **折叠**(`collapsed && !peek`):占位宽过渡到 0(`transition-[width] 200ms ease-out`),主内容占满全宽;侧栏变浮层但 `translateX(-100%)` 隐于左侧外、`pointer-events-none`。窗口左上角显示**浮动展开按钮**。
- **折叠+悬停划出**(`collapsed && peek`):侧栏浮层 `absolute left-0 top-0 z-50 w-60 rounded-r-xl shadow-2xl`,`translateX(0)`(`transition-transform 200ms ease-out`),悬于内容之上、不挤压。

触发:
- 折叠态左缘 **8px** 隐形热区(`fixed left-0 top-0 h-full w-2 z-40`),`mouseenter → peek=true`。
- 浮层 `onMouseLeave → peek=false`(丝滑滑回)。
- **点选浮层内会话/导航项 → 自动收**:不逐个包装 Sidebar 的十几个回调,而是 App 里一个 effect —— 折叠态下监听「导航目标变化」(`[activeSessionId, view]`)即 `setPeek(false)`;搜索打字、展开工具分组(不改 activeSessionId/view)不会误收。
- 折叠切换按钮(侧栏头部,展开态或浮层态都在)/ 左上角浮动展开按钮 → 翻转 `collapsed`。

## 组件 / 架构

### `lib/sidebarDock.ts`(新,纯函数,vitest)
```ts
export const HOTZONE_PX = 8            // 左缘触发热区宽度
export const SIDEBAR_WIDTH = 240       // 展开态占位宽(= aside w-60)
export const DOCK_ANIM_MS = 200        // 划入/划出与折叠动画时长

// 折叠占位宽:展开 240,折叠 0(配合 transition-[width] 做丝滑收展)
export function dockPlaceholderWidth(collapsed: boolean): number

// 承 <Sidebar/> 的内层 wrapper 的定位/动画类,编码三态:
//  展开 → 'h-full w-60'
//  折叠+peek → 'absolute left-0 top-0 z-50 h-full w-60 rounded-r-xl shadow-2xl transition-transform duration-200 ease-out translate-x-0'
//  折叠+!peek → 同上但 '-translate-x-full pointer-events-none'
export function dockInnerClass(collapsed: boolean, peek: boolean): string
```

### `components/SidebarDock.tsx`(新)
受控壳,props `{ collapsed: boolean; peek: boolean; onPeekChange: (v: boolean) => void; children: React.ReactNode }`:
- 渲染流内占位 `<div>`(`relative h-full shrink-0`,`style={{ width: dockPlaceholderWidth(collapsed) }}`,展开↔折叠时 `transition-[width] 200ms`;折叠拖动无关,恒过渡)。
- 占位内渲染内层 `<div className={dockInnerClass(collapsed, peek)} onMouseLeave={() => collapsed && onPeekChange(false)}>{children}</div>`。
- 折叠态额外渲染左缘热区 `<div className="fixed left-0 top-0 z-40 h-full" style={{ width: HOTZONE_PX }} onMouseEnter={() => onPeekChange(true)} />`。

### `components/Sidebar.tsx`(改)
头部(品牌/搜索区)加折叠切换按钮,新增 prop `onToggleCollapsed?: () => void`(lucide `PanelLeft`);其余不动。

### `App.tsx`(改)
- 状态:`sidebarCollapsed`(`useState` 初值从 `localStorage['wraith.sidebar.collapsed'] === '1'`,默认 false)、`sidebarPeek`。
- 持久化 effect:`sidebarCollapsed` 变化 → `localStorage.setItem('wraith.sidebar.collapsed', collapsed ? '1' : '0')`。
- 用 `<SidebarDock collapsed={sidebarCollapsed} peek={sidebarPeek} onPeekChange={setSidebarPeek}>` 包 `<Sidebar … onToggleCollapsed={() => setSidebarCollapsed(v => !v)} />`。
- 折叠态左上角浮动展开按钮:`{sidebarCollapsed && <button className="absolute left-2 top-2 z-40 …" onClick={() => setSidebarCollapsed(false)} title="展开侧栏"><PanelLeft/></button>}`(在顶层容器内,跨所有视图可见;z-40 低于浮层 z-50)。
- 自动收 effect:`useEffect(() => { if (sidebarCollapsed) setSidebarPeek(false) }, [pv.activeSessionId, view])`。

## 纯函数与可测性
- `sidebarDock.ts`:`dockPlaceholderWidth`(true→0 / false→240)、`dockInnerClass`(三态类串)→ vitest。
- 既有 641 测试保绿。
- 动画、悬停热区、浮层显隐、持久化、点选后自动收、不 remount 保状态:集成 / 眼验。

## 错误 / 边界
- 顶层 `overflow-hidden` 与浮层:`translateX(0)` 在界内(可见);隐藏态 `-translate-x-full` 滑到界外被裁(正是想要的);阴影向右在界内。
- 浮层不透明:用侧栏自带 `sidebar-gradient` 背景,内容不透出(眼验点)。
- 热区(z-40)与浮层(z-50):peek 时浮层在上接管指针;隐藏态浮层 `pointer-events-none`,热区可正常接管 mouseenter。
- 浮动展开按钮(left-2≈8px 起、z-40)与热区(x0–8、z-40)不重叠触发:按钮在 x≥8,热区 x<8;点按钮=展开,移最左缘=peek。
- 点选已激活的会话不改 activeSessionId → 浮层不自动收(可接受);点「新对话」置空 activeSessionId 视为变化 → 收。
- 不 remount:折叠/展开/peek 只改 wrapper 类,`<Sidebar/>` 元素不卸载,内部状态保留。

## 测试
- 纯函数 `sidebarDock`(dockPlaceholderWidth / dockInnerClass 三态)vitest;既有 `rightDock`/`terminalTabs`/`browserTabs` 等保绿。
- 眼验:点折叠→侧栏隐、内容占满(丝滑);左上角浮动展开按钮出现、点它展开;折叠态移到最左缘→浮层丝滑划出、移出→划回;浮层内点会话/导航→自动收且切换生效;搜索打字/展开分组不误收;折叠态重启后保持折叠(持久化);深浅主题浮层视觉正常;不影响 RightDock/终端。

## 交付后 / 风险
- 最易错点:浮层「不 remount 保状态」——须确认折叠/展开/peek 切换不导致 `<Sidebar/>` 卸载重建(眼验搜索词/展开分组保留)。
- 浮层背景不透明度、`sidebar-gradient` 作浮层的视觉。
- 顶层 `overflow-hidden` 对浮层与阴影的裁剪。
- 持久化 key `wraith.sidebar.collapsed`;默认展开。
- 不碰 RightDock(右缘)/终端抽屉(底部),互不干扰。
