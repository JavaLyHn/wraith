# 全宽顶条 + 隐藏 macOS 原生标题栏(折叠键上移交通灯右侧)设计稿

日期:2026-07-16
状态:设计已与用户确认(隐藏标题栏 + 全宽统一顶条 + 折叠键搬家),待用户审阅
背景:用户想把侧栏折叠按钮从「WRAITH」logo 那一行,挪到窗口顶部、紧挨 macOS 交通灯绿点右边(截图示意)。核实现状:主窗用**默认原生标题栏**(`src/main/index.ts:245` 未设 `titleBarStyle`,顶部居中的「Wraith」即系统标题栏),交通灯是操作系统区域,网页内容从标题栏下方起。要把按钮放到交通灯行,唯一办法是让网页内容接管顶部——即隐藏原生标题栏。

## 目标

把折叠按钮移到窗口顶部一条**全宽自定义顶条**里,紧挨交通灯右侧、所有视图常驻可见;顶条本身作为窗口拖拽区。纯视觉/交互结构改造,不改折叠的行为语义(仍是翻转 `sidebarCollapsed`)。

## 确认的决策(用户)

- **隐藏原生标题栏**(`titleBarStyle: 'hidden'`),接受居中「Wraith」标题消失、网页内容顶到窗口最上沿、加自定义拖拽条。
- **全宽统一顶条**(否决「仅侧栏宽顶条」「并入侧栏头部」):一条贯穿全宽的细顶条,侧栏与内容都在其下方,顶部对齐。
- **折叠键搬家不复制**:只留顶条一处;移除侧栏头部那颗 + 聊天视图那颗浮动展开键。
- **仅 macOS 隐藏标题栏**:`process.platform === 'darwin'` 守卫;非 darwin 保留默认边框(已知会与原生标题栏并存,macOS-first 可接受,后续再精修)。

## 设计前提(已核)

- 主窗 `new BrowserWindow`(`src/main/index.ts:245`)当前无 `titleBarStyle`/`frame`/`trafficLightPosition` = 默认原生标题栏。
- renderer **拿不到 platform**:preload(`src/preload/index.ts`)的 `contextBridge.exposeInMainWorld('wraith', {...})` 未暴露平台标志 → 需新增。
- 折叠按钮现于 `Sidebar.tsx:201-211`(`data-testid="sidebar-collapse"`,`PanelLeft`,`onToggleCollapsed`);折叠态浮动展开键于 `App.tsx:842-851`(`data-testid="sidebar-expand"`,仅 `view==='chat'`)。
- **无任何测试**引用 `sidebar-collapse`/`sidebar-expand`/`onToggleCollapsed`/`sidebarCollapsed`(已 grep 确认)→ 挪/删安全。
- `SidebarDock`(`SidebarDock.tsx`)的 peek(折叠态左缘 8px 热区 mouseenter 划出)独立于折叠键,保留不动。
- App 根:`<div className="flex h-screen overflow-hidden bg-bg text-fg">`(`App.tsx:838`)= 侧栏 + 内容行(横向 flex)。

## 组件与改动

### A. 窗口外壳 — `src/main/index.ts:245`(主窗 options)

仅在 macOS 加两个字段:

```ts
mainWindow = new BrowserWindow({
  ...bounds,
  show: false,
  icon: ...,
  ...(process.platform === 'darwin'
    ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 11 } }
    : {}),
  webPreferences: { ... },
})
```

- `titleBarStyle: 'hidden'`:隐藏原生标题栏,交通灯保留悬于左上角。
- `trafficLightPosition: { x: 12, y: 11 }`:把交通灯垂直居中进 38px 顶条(灯高约 16px → y≈(38−16)/2≈11)。**数值为初值,眼验微调**。
- 非 darwin:不加,保留默认边框。

### B. 平台标志暴露 — `src/preload/index.ts`

在 `exposeInMainWorld('wraith', {...})` 对象里加一个静态同步字段:

```ts
platform: process.platform,   // 'darwin' | 'win32' | 'linux' | ...
```

- preload 里 `process` 可用;暴露为静态字符串(非函数),renderer 同步读 `window.wraith.platform`。
- 同步更新 preload 的 `WraithApi`(或等价)TS 接口 + renderer 侧 `window.wraith` 类型声明,新增 `platform: string`,保证 typecheck 通过。

### C. 顶条组件 — 新建 `src/renderer/components/TopBar.tsx`

```tsx
import { PanelLeft } from 'lucide-react'
import { topBarLeftPad } from '../lib/topBar'

interface TopBarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
}

export default function TopBar({ collapsed, onToggleCollapsed }: TopBarProps): JSX.Element {
  const pad = topBarLeftPad(window.wraith.platform)
  return (
    <div className={'flex h-[38px] shrink-0 items-center border-b border-border bg-bg [-webkit-app-region:drag] ' + pad}>
      <button
        type="button"
        data-testid="sidebar-collapse"
        onClick={onToggleCollapsed}
        title={collapsed ? '展开侧栏' : '折叠侧栏'}
        className="rounded-lg p-1.5 text-fg-muted hover:bg-surface/60 hover:text-fg transition-colors [-webkit-app-region:no-drag]"
      >
        <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  )
}
```

- 全宽(父 flex-col 下自然铺满)、高 38px、`shrink-0`、底部发丝线、`bg-bg` 与壳融合。
- 拖拽区用 **Tailwind 任意属性类**(避免 inline `style` 的 `WebkitAppRegion` 在新版 `@types/react` 下 typecheck 报错):整条 `[-webkit-app-region:drag]` = 拖拽移窗;折叠按钮单独 `[-webkit-app-region:no-drag]` = 可点击。
- 左侧留位由 `topBarLeftPad(platform)` 决定(见 D):darwin 让开交通灯,其它贴左。
- 按钮沿用 `data-testid="sidebar-collapse"` 与图标;`title` 随折叠态切「展开/折叠侧栏」;所有视图常驻。
- 其余为可拖空白(将来可放标题/面包屑;本次留空)。

### D. 纯函数 — 新建 `src/renderer/lib/topBar.ts`

```ts
/** 顶条左内边距:macOS 需让开左上角交通灯(~80px),其它平台贴左。 */
export function topBarLeftPad(platform: string): string {
  return platform === 'darwin' ? 'pl-[80px]' : 'pl-2'
}
```

- 唯一含分支的逻辑,抽出可单测(darwin → `pl-[80px]`;win32/linux/其它 → `pl-2`)。

### E. App.tsx 根结构 — `src/renderer/App.tsx`

- 根 `<div className="flex h-screen overflow-hidden bg-bg text-fg">` 改为 `flex h-screen flex-col overflow-hidden bg-bg text-fg`。
- 首个子元素渲染 `<TopBar collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed(v => !v)} />`。
- 原「侧栏 + 内容行」用一层 `<div className="flex min-h-0 flex-1 overflow-hidden">` 包住,置于 TopBar 之下。
- **删除浮动展开键**(842-851 的 `{sidebarCollapsed && view === 'chat' && (<button data-testid="sidebar-expand" .../>)}`)——顶条键已在所有视图常驻覆盖其职责。
- `PanelLeft` import 若仅剩顶条用则保留(App 内其它 `PanelLeft` 用途照旧,按实际保留/清理)。

### F. Sidebar.tsx — `src/renderer/components/Sidebar.tsx`

- **删除头部折叠按钮块**(201-211);WRAITH logo 头部保留(现下移至顶条之下)。
- 从 `SidebarProps` 移除 `onToggleCollapsed`(改由 TopBar 消费);App 不再向 Sidebar 传该 prop。
- 若 `PanelLeft` import 在 Sidebar 内无其它用途则一并移除,避免未用 import。

## 测试

- **新增** `test/topBar.test.ts`:`topBarLeftPad('darwin')==='pl-[80px]'`;`topBarLeftPad('win32')==='pl-2'`;`topBarLeftPad('linux')==='pl-2'`。
- typecheck 0(含 preload/renderer 的 `platform` 类型补齐)。
- 全量 vitest 基线不降。
- 主进程 `titleBarStyle`/`trafficLightPosition` 不做单测(Electron 窗口),靠眼验。

## 眼验(定案点)

1. macOS:原生「Wraith」标题栏消失,交通灯仍在左上角、垂直居中于顶条(不被压住/不错位;必要时微调 `trafficLightPosition.y`)。
2. 折叠按钮在交通灯**绿点右边**,点击能折叠/展开侧栏(图标状态、title 随之变)。
3. 顶条空白处**能拖动窗口**;按钮区不触发拖拽。
4. 折叠后:所有视图(聊天 + 工具面板)都能靠顶条键展开;左缘 peek 仍可划出。
5. 明/暗两主题下顶条与发丝线观感正常。

## 风险

- `trafficLightPosition` 垂直居中需眼验微调(38px 顶条 vs 默认标题栏高度差异)。
- 顶条 drag 区若漏加 `no-drag` 会吞按钮点击(按钮已单独 `no-drag`)。
- 非 darwin 与原生标题栏并存 = 冗余双栏(已知取舍,标注,后续精修)。
- App 根从横向 flex 改为纵向包一层:须确保 `min-h-0`/`flex-1`/`overflow-hidden` 传递正确,不破坏既有滚动/高度(内容行包裹层补 `min-h-0 flex-1 overflow-hidden`)。

## 不做(YAGNI)

- 顶条不放窗口标题/面包屑/标签页(留空可拖);
- 不改 peek 机制;
- 不做 Win/Linux 自定义窗口控件(`titleBarOverlay`);
- 不动内容区各面板头部;不改折叠的持久化(`localStorage` 逻辑照旧)。
