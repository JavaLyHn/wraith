# 内嵌浏览器多标签重设计(BrowserPane)设计稿

日期:2026-07-12
状态:已与用户确认设计(2 点确认),待写实现计划
所属:子项目 A(停靠工具面板)之延续;A2 右侧停靠列(浏览器+终端)已完成合入,本稿只重做其中的「浏览器」面板 —— 从单视图升级为**真·多标签浏览** + 精致视觉(参考图:空态大地球 + go 按钮 + placeholder)。

## 目标

把右侧停靠列里的内嵌浏览器 `BrowserPane` 从**单视图**升级为**多标签浏览器**:顶部标签条可开/关/切多个页面(每标签一个独立 `<webview>`),地址栏跟随活动标签;空白标签显示精致空态(大地球轮廓 + 「开始浏览」+「输入 URL 以打开页面」);地址栏 placeholder「输入 URL」+ 前往箭头按钮。视觉与 `TerminalPane` 的标签栏统一。

## 确认的决策(用户 2 点)

1. **真·多标签**:每个标签一个独立 webview,可开多个页面(不是单视图套视觉)。
2. **不做** ⋮ 菜单、不做参考图窗口右上角的全屏/布局切换图标(那些是参考浏览器自带外壳,与内嵌面板无关)。

## 范围

- **做**:`browserTabs.ts` 纯函数标签簿 + `BrowserWebview.tsx` 单标签 webview + `BrowserPane.tsx` 重写为多标签容器(标签条 / 工具条 / 空态 / 失败态 / 前进后退禁用态 / go 按钮)。
- **不做**(YAGNI):⋮ 菜单、窗口/布局控件、书签/历史/下载管理、per-site favicon 抓取(统一用静态地球图标,避免 renderer 网络请求)、把 A2 `RightDock` 壳或底部终端抽屉 A1 的行为改动。

## 组件 / 架构(3 个单元)

### 1. `lib/browserTabs.ts`(新,纯函数,vitest)

镜像 `terminalTabs.ts` 的标签簿逻辑(加/关/切 + 关活动标签选邻居),但每标签带浏览器状态:

```ts
export interface BrowserTab {
  id: string
  title: string        // 页面标题;空白页为 '新标签页'
  url: string          // 地址栏用;about:blank 归一化为 ''(显示 placeholder)
  loading: boolean
  failed: boolean
  canBack: boolean
  canForward: boolean
}
export interface BrowserTabsState { tabs: BrowserTab[]; activeId: string | null }

export function newBrowserTab(id: string): BrowserTab
  // { id, title: '新标签页', url: '', loading:false, failed:false, canBack:false, canForward:false }

export function addBrowserTab(s: BrowserTabsState, tab: BrowserTab): BrowserTabsState
  // 追加并激活(activeId = tab.id)

export function closeBrowserTab(s: BrowserTabsState, id: string): BrowserTabsState
  // 移除;若关的是活动标签,选左邻居优先、否则右邻居;关到空 activeId=null。逻辑同 terminalTabs.closeTab

export function setActiveBrowserTab(s: BrowserTabsState, id: string): BrowserTabsState
  // id 存在才切;不存在原样返回

export function patchBrowserTab(s: BrowserTabsState, id: string, patch: Partial<BrowserTab>): BrowserTabsState
  // 仅更新匹配 id 的标签(浅合并);id 不存在原样返回(不新增)
```

### 2. `components/BrowserWebview.tsx`(新)

单个标签的 `<webview>`:
- props:`{ tab: BrowserTab; active: boolean; onState: (id: string, patch: Partial<BrowserTab>) => void; registerRef: (id: string, el: WebviewEl | null) => void }`。
- 用 `createElement('webview', …)` 渲染(避免 JSX 内建类型),`src: 'about:blank'`、`partition: 'persist:wraith-browser'`(与所有标签共享 cookies/登录)、`allowpopups: undefined`(关弹窗,保留「勿改 false」注释)、`style` 填满。
- `useEffect`(挂载一次)绑定 DOM 事件,经 `onState(tab.id, patch)` 上抛:
  - `did-start-loading` → `{ loading:true, failed:false }`
  - `did-stop-loading` → `{ loading:false, url: displayUrl(el.getURL()), title: el.getTitle() || '新标签页', canBack: el.canGoBack(), canForward: el.canGoForward() }`
  - `did-navigate` / `did-navigate-in-page` → `{ url: displayUrl(el.getURL()), canBack: el.canGoBack(), canForward: el.canGoForward() }`
  - `page-title-updated`(`e.title`)→ `{ title: e.title || '新标签页' }`
  - `did-fail-load`(仅 `isMainFrame !== false && errorCode !== -3`)→ `{ loading:false, failed:true }`
  - 其中 `displayUrl(u) = u === 'about:blank' ? '' : u`。
- 挂载 `registerRef(tab.id, el)`;卸载 `registerRef(tab.id, null)`,供父层工具条驱动导航(back/forward/reload/loadURL)。
- `!active` 时容器加 `hidden`;**常挂不销毁**(切回保留页面)。

`WebviewEl` 接口(最小,含用到的方法):`src`、`canGoBack()`、`canGoForward()`、`goBack()`、`goForward()`、`reload()`、`loadURL(url): Promise<void>`、`getURL()`、`getTitle()`。

### 3. `components/BrowserPane.tsx`(重写)

多标签容器,props 仍为 `{ active: boolean }`(RightDock 接口零改动):
- 状态:`BrowserTabsState`;`refs = useRef<Map<string, WebviewEl>>`(各标签 webview DOM);`addr`(地址栏输入,本地受控)。
- **标签条**(顶行):`state.tabs.map` → 每标签 `[🌐 Globe] 标题(截断) [×]`,活动 `bg-surface text-fg`、非活动 `text-fg-muted hover:bg-surface/60`;末尾 `+`(lucide `Plus`)新建标签。与 `TerminalPane` 标签栏同款间距/圆角/字号(`text-2xs`、`gap-1`、`px-2 py-1` 等)。
- **工具条**(次行):`←`(`ArrowLeft`)`→`(`ArrowRight`)`⟳`(`RotateCw`,loading 时 `animate-spin`)+ 地址栏 `<input placeholder="输入 URL">` + go 按钮(`ArrowUpRight`,↗)。`←/→` 按活动标签 `canBack/canForward` 设 `disabled`(复用现有 `disabled:opacity-40`);无活动标签时导航/刷新禁用。回车或点 go 都触发导航。
- **地址栏同步**:显示活动标签的 `url`;用「受控 + 仅在真实导航/切标签时回灌」——`useEffect` 依赖 `[activeId, activeTab?.url]` 把 `addr` 同步为 `activeTab.url`;用户打字只改本地 `addr`(不触发导航,不被回灌覆盖,因为 `activeTab.url` 只在真实导航事件时变)。
- **导航** `navigate(raw)`:`const url = normalizeUrl(raw)`(已有,空→about:blank);`patchBrowserTab(failed:false)`;`refs.get(activeId)?.loadURL(url).catch(() => onState failed:true)`。
- **空态**(活动标签 `url === '' && !loading && !failed`):webview 区居中覆盖层——大地球轮廓(`Globe`,`h-16 w-16`,`text-fg-subtle`)+「开始浏览」(粗、`text-sm`、`text-fg`)+「输入 URL 以打开页面」(`text-xs`、`text-fg-subtle`);点覆盖层聚焦地址栏。仅活动标签空白时显示。
- **失败态**(活动标签 `failed`):沿用「页面加载失败」居中遮罩(`text-fg-subtle`)。
- **webview 栈**:`state.tabs.map` → `<BrowserWebview key=id tab active={id===activeId} onState registerRef />`,只活动可见、全常挂。
- **生命周期**:
  - `active && state.tabs.length === 0` 时自动建一个空白标签(`useEffect` deps `[active]`,镜像 TerminalPane;关到空不因该 effect 重建)。
  - 新建:`addBrowserTab(s, newBrowserTab(genId()))`;`genId` 用递增序号(如 `btab-<n>`),不依赖随机数。
  - 关标签:`closeBrowserTab`;**若关后 `tabs.length === 0` 立即补一个新空白标签**(浏览器手感,永不空;不关闭 RightDock)。
  - `onState(id, patch)`:`setState(s => patchBrowserTab(s, id, patch))`。

## App / RightDock 集成

- **零改动**:`RightDock` 仍 `<BrowserPane active={open && pane==='browser'} />`;顶部「浏览器|终端」分段切换、拖宽、`onClose` 不动。
- **零改动**:主进程 `webviewTag:true`(A2 T3 已开)、`persist:wraith-browser` partition 的 deny-all 权限处理器、`web-contents-created` 对 webview 客体 `setWindowOpenHandler(deny)`(A2 终审已加)——多个同 partition/同 type 的 webview 自动继承,安全面不变。

## 纯函数与可测性

- `browserTabs.ts` 全部纯函数 → vitest:
  - `newBrowserTab`:字段默认值正确。
  - `addBrowserTab`:追加且 activeId=新标签。
  - `closeBrowserTab`:关非活动只移除、activeId 不变;关活动选左邻居;左无则右邻居;关到空 activeId=null;关不存在 id 原样。
  - `setActiveBrowserTab`:存在才切;不存在原样。
  - `patchBrowserTab`:只改目标标签的指定字段(浅合并);不存在 id 原样、不新增。
- `rightDock.ts` 既有 `normalizeUrl`/`clampColumnWidth` 测试保持绿(不改其接口;`normalizeUrl('')==='about:blank'` 被 navigate 复用)。
- webview 事件绑定、地址栏同步、空态/失败态渲染、多 webview 常挂显隐、拖宽:集成 / 眼验。

## 错误 / 边界

- webview 加载失败(`did-fail-load` 主框架、非 -3 取消)→ 该标签 `failed=true`,活动时显「页面加载失败」,不崩;再次导航 `failed=false`。
- 关掉最后一个标签 → 自动补一个新空白标签(不留空、不关列)。
- 多标签共享 `persist:wraith-browser`:cookies/登录跨标签一致(正常浏览器行为)。
- 收起右侧列(width 0)→ webview 常挂不销毁(页面保留);切「终端」再切回「浏览器」→ 标签与页面保留。
- 地址栏:活动标签为空白页时显示空(placeholder);打字期间不被导航事件回灌覆盖(activeTab.url 仅真实导航时变)。
- 背景标签(隐藏)的加载/标题事件仍按 id 更新各自状态(`onState` 按 tab.id 定位)。

## 测试

- 纯函数 `browserTabs`(上列全部)vitest;既有 `rightDock`/`terminalTabs`/`ptyHelpers` 测试保绿。
- 眼验:开多个标签 / 切标签(保留各自页面)/ 关标签选邻居 / 关到空自动补;地址栏跟随活动标签、打字不被覆盖;`←/→` 禁用态随导航变;`⟳`、go 按钮、回车导航;空态(大地球+文案,点击聚焦地址栏)、失败态;切「终端」再回「浏览器」保留;右侧列与底部终端同时开互不干扰;深浅色主题下视觉正常。

## 交付后 / 风险

- **多 webview 内存**:每标签一个常挂 webview;几个标签内存可接受,换取切回保留页面(与终端多标签、A2「收起不销毁」一致)。若将来标签很多可考虑 LRU 冻结,当前 YAGNI。
- **地址栏同步**:受控 + 仅真实导航/切标签回灌,避免打字被覆盖(是本稿最易出错点,眼验重点)。
- **A2 回归**:BrowserPane 重写后须眼验 RightDock 分段切换、拖宽、与底部终端并存、收起保留均无变化(BrowserPane props 接口不变,回归面小)。
- **安全**:沿用 A2 已建的 partition deny-all + 弹窗 deny;新增 webview 同 partition/type 自动纳入,无新增放权。
