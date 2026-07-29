# wraith Windows 对等 —— 块 2:窗口视觉对等(设计)

- 日期:2026-07-28
- 范围:让 **Windows** 主窗与 macOS 一样是无边框(chrome-less)窗口——`frame:false` + 顶条右上角自绘最小化/最大化-还原/关闭。macOS 与 Linux 行为不变。
- Windows 功能对等总目标(5 块路线)的第 2 块。总路线见块 1 spec §6 与记忆 [[wraith-windows-parity]]。

## 1. 背景与既有结论(审计已完成)

- **主窗现状**(`desktop/src/main/index.ts:290`):`process.platform === 'darwin'` 分支给 `titleBarStyle:'hidden'` + `trafficLightPosition:{x:12,y:11}` + `vibrancy:'fullscreen-ui'` + `visualEffectState:'active'` + `backgroundColor:'#00000000'`;**非 mac 分支是空 `{}`** → Windows/Linux 得到系统标准窗框(原生标题栏 + 最小/最大/关闭)。
- **拖拽区已存在**:`TopBar.tsx:21` 整条顶栏已带 `[-webkit-app-region:drag]`,按钮带 `[-webkit-app-region:no-drag]`(`TopBar.tsx:18`)。mac 靠它拖窗。**块 2 复用,不改。**
- **无窗口控制 IPC**:全仓无 minimize/maximize/unmaximize/isMaximized 的 IPC(仅退出时 `win.close()`)。需新建。
- **TopBar 布局**:左簇(侧栏切换,`topBarLeftPad` mac 让 80px 交通灯)→ `flex-1` 撑开 → 右簇(终端/右栏切换,受 `showChat` 门控,`pr-2`)。
- **决策(用户 AskUserQuestion 拍板)**:窗控风格 = **混合**(位置/行为按 Windows,字形/间距轻度品牌化);适用范围 = **仅 Windows**(win32;Linux 保持系统窗框;mac 不变)。

## 2. 目标与非目标

**目标(块 2)**
1. Windows 主窗 `frame:false`,无原生标题栏,与 mac 一样是整窗自绘表面。
2. 顶条右上角自绘窗控(最小化 / 最大化-还原 / 关闭),**仅 win32 渲染**。混合风:右上角贴角、close 悬停红、双击标题栏最大化(走原生 drag 行为);字形用 wraith 单色墨、hover 圆润淡底(close 例外红)。
3. 最大化-还原图标随窗口真实最大化状态切换。
4. 平台分支逻辑抽纯函数,mac 上单测验证 Windows 分支。

**非目标(留后续)**
- macOS / Linux 的窗口 chrome 任何改动(mac 逐字段不变;Linux 保持系统窗框)。
- Win11 snap-layouts 悬停飞出(frameless 会丢原生 flyout,需额外原生工作)——v1 不做,记后续可选。
- 打包 / JRE / 编辑器探测 / 桌宠(分属块 4/3/5)。

## 3. 交付物与详细需求

### 3.1 主窗选项纯函数 `mainWindowChrome`
- Create `desktop/src/main/mainWindowChrome.ts`,**只 `import type` electron**(便于 vitest 直接 import)。
- `export function mainWindowChrome(platform: NodeJS.Platform): BrowserWindowConstructorOptions`:
  - `darwin` → `{ titleBarStyle:'hidden', trafficLightPosition:{x:12,y:11}, vibrancy:'fullscreen-ui', visualEffectState:'active', backgroundColor:'#00000000' }`(**与现有内联字面量逐字段等价**)。
  - `win32` → `{ frame: false }`(不设 transparent;窗本就 `show:false`+`ready-to-show`+splash 兜白闪,故不额外设 backgroundColor)。
  - 其它(linux 等) → `{}`。
- `desktop/src/main/index.ts:290` 处把现有 `...(process.platform === 'darwin' ? {…} : {})` 三元替换为 `...mainWindowChrome(process.platform)`。

### 3.2 窗口控制 IPC(preload + main)
- **main**(`index.ts`):注册
  - `ipcMain.handle('wraith:win:minimize', () => mainWindow?.minimize())`
  - `ipcMain.handle('wraith:win:toggleMaximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize())`
  - `ipcMain.handle('wraith:win:close', () => mainWindow?.close())`
  - `ipcMain.handle('wraith:win:isMaximized', () => !!mainWindow?.isMaximized())`
  - 建窗后监听:`mainWindow.on('maximize', () => mainWindow?.webContents.send('wraith:win:maximizeChanged', true))` 与 `.on('unmaximize', … false)`。
- **preload**(`src/preload/index.ts`):在 `window.wraith` 下加 `windowControls`:
  - `minimize(): void`、`toggleMaximize(): void`、`close(): void`、`isMaximized(): Promise<boolean>`
  - `onMaximizeChange(cb: (max: boolean) => void): () => void`(`ipcRenderer.on` 订阅 `wraith:win:maximizeChanged`,返回退订函数;回调只收 boolean,不透传 event)。
- **types**(`src/shared/types.ts`):`WindowControlsApi` 接口,并入 `window.wraith` 的类型声明。

### 3.3 渲染层组件 `WindowControls.tsx`
- Create `desktop/src/renderer/components/WindowControls.tsx`。
- Props:`{ platform: string }`(或无 props,内部读 `window.wraith.platform`——与 TopBar 现有 `platform` 传参一致,采传参)。
- **仅 `platform === 'win32'` 渲染**(否则返回 `null`)。
- 三个按钮,各 `[-webkit-app-region:no-drag]`,贴右上角(容器无右 padding,延伸到窗口右边缘):
  - 最小化 `data-testid="win-minimize"` → `windowControls.minimize()`
  - 最大化-还原 `data-testid="win-maximize"` → `windowControls.toggleMaximize()`;图标按状态切(未最大化=最大化图标,已最大化=还原图标)
  - 关闭 `data-testid="win-close"` → `windowControls.close()`;**悬停红底**(如 `hover:bg-red-600 hover:text-white`)
- 状态:`useState(isMax)`,`useEffect` 挂载时 `isMaximized()` 取初值 + `onMaximizeChange` 订阅,卸载退订。
- 风格:wraith 单色墨字形(自绘 SVG 或字符),非 close 键 hover 圆润淡底(呼应 `TopBar` 的 `hover:bg-fg/[0.06]`)。

### 3.4 TopBar 接线 + 平台工具
- `desktop/src/renderer/components/TopBar.tsx`:在现有右簇之后追加 `{platform === 'win32' && <WindowControls platform={platform} />}`——**不受 `showChat` 门控**(窗控恒显)。现有 drag/no-drag 复用,不改。
- `desktop/src/renderer/lib/topBar.ts`:加 `export function shouldShowWindowControls(platform: string): boolean { return platform === 'win32' }`(供组件/测试共用,单一真源)。`topBarLeftPad` 不变。

## 4. 测试策略

- **mac 上可跑(块 2 CI 门槛)**:
  - `mainWindowChrome`:darwin 片段逐字段等价(锁 mac 不变)、win32 含 `frame:false`、linux `{}`。
  - `shouldShowWindowControls`:win32=true、darwin/linux=false。
  - `WindowControls`(vitest + RTL,mock `window.wraith.windowControls`):win32 渲三键、点击各调对应 bridge、`maximizeChanged` 回调切图标、darwin/linux 渲染为 `null`。
  - `npm run typecheck` 净;既有 vitest 不回归。
- **须 Windows 实机(用户 / 块 4 CI)**:frameless 观感、双击标题栏最大化、close 悬停红、拖窗、最小/最大/还原/关闭实际行为。
- **诚实边界**:本环境 macOS,无法验证 Windows 实机 GUI。交付 = 纯函数 + 组件测试(mac 上绿)+ 实机验收清单条目(并入 `docs/windows-dev.md` 的清单)。

## 5. 成功标准

- `mainWindowChrome` 的 darwin 片段与现有内联字面量**逐字段等价**(测试锁定),win32 得 `frame:false`。
- win32 顶条右上角出现三键、行为经组件测试验证;mac/linux 不渲染窗控。
- `tsc` 净、既有 vitest 不回归、mac 窗口 chrome 行为字节级不变。
- `docs/windows-dev.md` 验收清单补充窗控相关条目。

## 6. 后续块(总路线,非本 spec 范围)

3. Windows 外部编辑器探测 + 打开。
4. 打包(`win:` NSIS + `icon.ico` + Windows JRE + node-pty Win 二进制)+ 启动脚本对等 + 可选 CI 冒烟。
5. 桌宠原生 Win32 插件(`WS_EX_NOACTIVATE` + 跨虚拟桌面)。
