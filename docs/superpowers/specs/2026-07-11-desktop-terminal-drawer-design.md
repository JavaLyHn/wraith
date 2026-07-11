# 桌面底部终端抽屉(A1)设计稿

日期:2026-07-11
状态:已与用户确认设计,待写实现计划
所属:子项目 A(停靠工具面板)之 A1;A2(右侧列 + 浏览器)另开 spec。

## 目标

在 wraith 桌面主窗加一个**底部终端抽屉**:右上角按钮开/关,抽屉内**多标签**,每个标签是一个
**真实 PTY**(node-pty),可执行任意 shell 命令(交互程序/颜色/resize 全支持)。这是子项目 A
的地基——终端基建落地 + 打包链跑通。

## 范围

- **做**:底部停靠终端抽屉(多标签,真 PTY,xterm 渲染)+ 右上角开关按钮 + node-pty 原生模块的
  dev 与打包接入。
- **不做**:右侧停靠列、浏览器面板(A2);终端跨重启持久化;终端搜索/分屏/主题定制(YAGNI)。

## 确认的默认

- 新终端 cwd = **当前项目工作区**(App 的活跃 workspace;缺省用户 home)。
- shell = **`$SHELL`**(缺省平台默认:macOS `/bin/zsh`,其它 `/bin/bash`)。
- 抽屉默认高 ≈ 内容区 38%,顶边可拖拽调高(min ~120px / max ~80%)。
- 抽屉收起(×)**保留** PTY;再开还在。关标签才杀 PTY;退出 app 全杀。

## 交互 / 布局

1. 主窗头部右上角一个**终端图标按钮**(仅 chat 视图显示;工具全屏页不显示),切换底部抽屉开/关。
2. 抽屉**停靠**在 chat 内容区(Composer+Transcript)下方:内容区上缩,抽屉占底部;两者间一条**可拖拽分隔条**调抽屉高度。
3. 抽屉顶部**标签栏**:每标签显示短标签(cwd basename 或 `终端 N`)+ `×` 关闭;`+` 新建标签;点击切换;标签栏右侧一个 `×` 收起整个抽屉。
4. 打开抽屉时若无标签,自动建一个。关掉最后一个标签→抽屉自动收起(PTY 已随标签关闭)。

## 架构 / 数据流

### 主进程:`desktop/src/main/pty.ts` — `PtyManager`
- 依赖 `node-pty`。维护 `Map<string, IPty>`(id→pty)。
- `create({ cwd, cols, rows }): { id }` — spawn `$SHELL`(login shell),cwd 落上面默认,env 继承 `process.env`;监听 `pty.onData` → 经回调转发;`pty.onExit` → 转发 + 从 map 删除。
- `write(id, data)` / `resize(id, cols, rows)` / `kill(id)` / `killAll()`(app quit 调)。
- 纯可测辅助抽到 `pty.ts` 外或同文件导出:`resolveShell(env, platform)`、`shortTabLabel(cwd, index)`。

### IPC(preload 暴露 `window.wraith.pty*`)
- 调用:`ptyCreate(opts) → {id}`、`ptyInput(id, data)`、`ptyResize(id, cols, rows)`、`ptyKill(id)`。
- 事件(主→渲染,经 webContents.send):`pty:data {id, data}`、`pty:exit {id, code}`;preload `onPtyData(cb)` / `onPtyExit(cb)` 订阅并返回退订函数。
- ⚠ 每条 data 事件带 `id`,渲染侧按 id 分发到对应 xterm(多标签共用一个事件通道)。

### 渲染:React/TS
- `TerminalTab.tsx`:挂一个 **xterm.js** Terminal(+ `@xterm/addon-fit`)。mount 时 `ptyCreate` 拿 id;`term.onData → ptyInput(id, …)`;订阅 `pty:data`(过滤本 id)→ `term.write`;容器 ResizeObserver + FitAddon → `ptyResize`;`pty:exit` → 显示"进程已退出"。unmount 不杀 PTY(切标签保留);关标签时显式 `ptyKill`。
- `TerminalDrawer.tsx`:抽屉壳 + 标签栏 + 分隔条拖拽调高;持有标签状态(见下)。**始终挂载全部标签的 TerminalTab、用 CSS 显隐**(切标签不销毁 xterm/PTY),仅"关标签"才卸载 + kill。
- 标签状态纯函数(`terminalTabs.ts`,vitest):`addTab`、`closeTab`(返回新列表 + 新活跃 id)、`setActive`;`shortTabLabel`。

### App 集成
- App 顶层新增 `terminalOpen` 状态 + 右上角按钮;`TerminalDrawer` 渲染在内容区底部(仅 chat 视图),用 flex 让 Transcript 区与抽屉分占高度。
- 传入当前 workspace 作为新终端默认 cwd。

## 原生模块打包(最大风险,须先验证)
- 加依赖:`node-pty`、`@xterm/xterm`、`@xterm/addon-fit`。
- node-pty 是原生模块,需按 **Electron ABI** 重建(electron-vite/electron-builder 生态:`@electron/rebuild` 或 electron-builder 的 `npmRebuild`/postinstall)。
- electron-builder 加 **`asarUnpack`**(如 `**/node_modules/node-pty/**`)使 `.node` 二进制在打包后可加载。
- **验证**:dev(electron-vite)下终端能跑;并做一次 `dist:mac` 打包 smoke 确认 node-pty 在 dmg 内可用(或至少确认 rebuild + asarUnpack 配置正确)。若打包链受阻,先保证 dev 可用 + 记录打包待办。

## 错误 / 边界
- `ptyCreate` 失败(node-pty 加载失败/spawn 失败)→ 标签显示错误文案,不崩主窗。
- PTY 退出(用户 `exit`)→ 标签显示"已退出",可关或新建。
- 抽屉/标签操作在无后端依赖(纯本地 PTY),不受 app-server 连接态影响。
- resize 抖动:FitAddon + ResizeObserver 去抖(rAF 或短 debounce)。

## 测试
- 纯函数:`resolveShell`、`shortTabLabel`、标签 reducer(add/close/active)→ vitest。
- PTY↔xterm、抽屉布局、拖拽调高:集成,靠眼验(启动 dev,开抽屉,跑 `ls`/`vim`/`top`、多标签、resize、关标签杀进程)。
- node-pty 打包:一次 dist smoke(或 rebuild 配置核对)。

## 交付后
- 眼验:开关按钮、抽屉停靠+拖拽调高、多标签新建/切换/关闭、真实命令(含交互式 vim/top)、颜色、resize 跟随、退出 app 无残留 PTY。
