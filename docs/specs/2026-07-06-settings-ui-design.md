# 聊天消息重设计 + 设置面板(我/界面/关于)— 设计

日期:2026-07-06
状态:待用户复核
分支:`feat/settings-ui`

## 1. 背景与目标

桌面端两处 UX 缺口,合并为一个特性交付:

1. **聊天消息区分不明显**:现状用户消息=右侧淡青气泡(`UserMessage.tsx`),Agent 消息=全宽纯 markdown 正文(`Transcript.tsx` 的 `item.type === 'message'` 分支),无头像/无名字/无对齐区分;中间还插着 tool/thinking/diff 卡片,分不清谁在说话。
2. **没有设置入口**:侧栏左下角只有沙箱徽标;主题(仅一套浅色)、字号、个人标识、关于/更新等无处配置。

**目标**:重设计聊天消息的说话人区分(方向 A 非对称);在左下角新增「⚙ 设置」面板,含**我 / 界面 / 关于**三分区(左分区导航 + 右内容,方向 A),并详细实现其内容,包括轻量更新检查。

**非目标(YAGNI)**:不做完整 electron-updater 自动下载/安装(仅轻量检查 + 手动下载);不做账号体系;Agent 侧头像/名字本期固定(👻 Wraith),不做可配;不改后端 config.json(纯前端偏好走 localStorage)。

## 2. 关键现状(已核实)

- **主题**:`desktop/src/renderer/styles/tokens.css` 仅一套 `:root` **浅色**调色板(`--bg/--fg/--accent/--font-sans` 等 token,Tailwind 映射为 `bg/fg/accent/...`);在 `main.tsx` 引入,全局生效。**无深色、无 `[data-theme]`**。
- **偏好持久化**:既有模式 = `localStorage`(如 `wraith.sidebar.sessionGroupMode`),纯前端,不碰后端。
- **Electron main**:已 `import { ... shell } from 'electron'`,已用 `shell.openExternal`;IPC 模式 `ipcMain.handle('wraith:X', ...)` + preload `contextBridge`。app 版本经 `app.getVersion()`(读 package.json `version` = 0.1.0)。
- **视图**:`App.tsx` 有 `view` union(`'chat' | ... | 'skills'`),面板从 `Sidebar` 回调打开,主区渲染,带「← 返回对话」。侧栏底部 footer 现为沙箱徽标(`Sidebar.tsx` 末段)。
- **仓库无 LICENSE 文件**;GitHub = `JavaLyHn/wraith`。

## 3. 架构:设置状态中枢(SettingsContext)

新增 `desktop/src/renderer/settings/`:

- **`prefs.ts`(纯逻辑,可测)**:定义偏好类型 + 默认值 + 读写。
  ```ts
  export interface Prefs {
    profile: { name: string; avatar: string }          // avatar = emoji 或 ''(空→首字母)
    ui: { theme: 'system'|'light'|'dark'; accent: AccentKey; fontSize: 'sm'|'md'|'lg'; fontFamily: 'system'|'sans'|'mono' }
    update: { autoCheck: boolean; beta: boolean }
  }
  export const DEFAULT_PREFS: Prefs = { profile:{name:'我',avatar:''},
    ui:{theme:'system',accent:'teal',fontSize:'md',fontFamily:'system'}, update:{autoCheck:true,beta:false} }
  export function loadPrefs(read=(k)=>localStorage.getItem(k)): Prefs   // 逐键读 + 容错回落默认
  export function savePref<K>(section, patch, write=...): void          // 分区合并写回
  ```
  键前缀 `wraith.prefs.*`(如 `wraith.prefs.ui.theme`)。解析容错:非法值→默认。**纯解析/默认部分可注入 read/write,单测覆盖。**

- **`theme.ts`(纯 + 命令式)**:
  ```ts
  export const ACCENTS: Record<AccentKey,{label:string;value:string}>  // teal/indigo/emerald/rose/amber → hex
  export function resolveThemeVars(ui: Prefs['ui'], systemDark: boolean): {
    dataTheme: 'light'|'dark'; vars: Record<string,string>            // --accent / --font-scale / --font-sans 覆盖
  }                                                                     // 纯函数,单测
  export function applyTheme(ui, systemDark): void                     // 写 document.documentElement.dataset.theme + style.setProperty
  ```
  `theme==='system'` → 由 `matchMedia('(prefers-color-scheme: dark)')` 决定 `systemDark`;监听其变化重新 apply。

- **`SettingsContext.tsx`**:`SettingsProvider` 包住 `App`;持 `prefs` state,`setProfile/setUi/setUpdate` = 合并 + `savePref` + 对 ui 变更调 `applyTheme`;暴露 `useSettings()`。挂载时 `applyTheme(prefs.ui, systemDark)` + 订阅 `matchMedia`。首屏在 `main.tsx` 早期先 `applyTheme(loadPrefs().ui, …)` 避免闪烁(FOUC)。

## 4. 深色调色板(tokens.css)

在 `tokens.css` `:root`(浅色)后新增 `[data-theme="dark"]` 覆盖同名 token(深色):`--bg`≈`#0f1419`、`--bg-elevated`≈`#161b22`、`--fg`≈`#e6edf3`、`--fg-muted/-subtle`、`--border`≈`#2b3138`、侧栏渐变深色版;`--accent` 保持由 `applyTheme` 按强调色注入(不写死在主题里)。字号:新增 `--font-scale`(sm=.925/md=1/lg=1.075),`body`/根 `font-size: calc(14px * var(--font-scale))`。字体:`--font-sans` 由 `applyTheme` 覆盖(system=既有栈,sans=Inter/系统无衬线,mono=用 `--font-mono` 栈)。

## 5. 聊天消息重设计(方向 A · 非对称)

- **`AgentMessage.tsx`(新)**:Agent 的 `message` 项 = 左侧「👻」头像(固定)+「Wraith」名字行 + 全宽 markdown 正文(**复用现有渲染 className**:`text-sm leading-7 ... [&_pre]:...`,渲染逻辑不变)。
- **`UserMessage.tsx`(改)**:保留右侧青气泡 + 编辑/删除;在气泡右侧加一个小头像块(来自 `useSettings().prefs.profile`:有 emoji 用 emoji,否则名字首字符)。
- **`Transcript.tsx`(改)**:`item.type === 'message'` 分支改用 `<AgentMessage>`;`user` 分支不变(UserMessage 内部取 profile)。thinking/tool/diff 卡片**维持原样**(已是高区分度卡)。
- 头像/名字标识抽到 `chatIdentity.ts` 纯函数:`userAvatarLabel(profile) → { glyph: string }`(emoji 或首字母),单测。

## 6. 设置面板(方向 A · 左分区导航 + 右内容)

- **视图**:`App.tsx` view union 加 `'settings'`;`Sidebar` **左下角 footer** 在沙箱徽标上方加「⚙ 设置」按钮 → `onOpenSettings()` → `setView('settings')`;主区渲染 `<SettingsPanel onBack={()=>setView('chat')} />`。
- **`SettingsPanel.tsx`(新)**:头部「← 返回对话 / 设置」;body = 左分区导航(`👤 我 / 🎨 界面 / ℹ️ 关于`,本地 `active` state)+ 右内容 pane;分区组件 `SettingsMe` / `SettingsInterface` / `SettingsAbout`。
- **`SettingsMe.tsx`**:昵称输入(改 `setProfile`)+ 头像(emoji 输入/清空,预览首字母回落)+ **配置速览**(只读:默认 Provider/模型——从既有 `window.wraith` 模型/Provider 接口取;数据目录 `~/.wraith` 文本 + 「打开目录」按钮 → IPC `openPath`;「管理 Provider」按钮 → 触发切到 providers 面板)。
- **`SettingsInterface.tsx`**:主题三卡(系统/浅/深,带迷你预览)· 强调色色板(`ACCENTS`)· 字号段选(小/中/大)· 字体段选(系统/无衬线/等宽);每项改 `setUi`,即时 `applyTheme`。
- **`SettingsAbout.tsx`**:App 名 + 版本(IPC `appInfo`)· 许可证「MIT License」· 版权「© 2026 LyHn」· 「GitHub」按钮(IPC `openExternal` 开仓库)· 自动检查更新开关 · 接受测试版更新开关 · 「检查更新」按钮 + 结果行。

## 7. 更新检查(轻量 · GitHub Releases)

- **主进程纯逻辑 `desktop/src/main/updateCheck.ts`**:
  ```ts
  export function computeUpdate(current: string, releases: GhRelease[], includeBeta: boolean): {
    current: string; latest: string|null; hasUpdate: boolean; url: string|null; isPrerelease: boolean
  }
  ```
  过滤 `draft`;`includeBeta=false` 时剔除 `prerelease`;按 semver 取最大 `tag_name`(去 `v` 前缀);`hasUpdate = semverGt(latest, current)`。含极简 `semverCompare`(`x.y.z`,忽略 build/预发标记的排序细节——够用)。**纯函数,单测**(给定 releases 列表 + beta 开关断言结果)。
- **IPC**:`wraith:checkUpdate {beta}` → main `fetch('https://api.github.com/repos/JavaLyHn/wraith/releases')`(未认证,60/hr 够用)→ `computeUpdate(app.getVersion(), releases, beta)` → 返回上述对象;网络/解析失败 → `{error}`。`wraith:appInfo` → `{version, repoUrl}`;`wraith:openExternal {url}`(复用/加)、`wraith:openPath {path}`。
- **自动检查**:`SettingsProvider` 挂载后若 `prefs.update.autoCheck` → 调一次 `checkUpdate(beta)`;`hasUpdate` 则在 App 顶部显示淡色提示条(可关)「有新版 vX.Y.Z · 打开下载」→ openExternal 到 release `url`。手动「检查更新」按钮同一通道,结果就地显示(最新/有新版/失败)。

## 8. 桥 + 类型

- `desktop/src/shared/types.ts`:`Prefs`/`AccentKey`(或置于 settings 模块并复用)、`AppInfo {version:string; repoUrl:string}`、`UpdateResult {current;latest;hasUpdate;url;isPrerelease;error?}`。
- preload `WraithApi` + IPC:`appInfo(): Promise<AppInfo>`、`checkUpdate(beta:boolean): Promise<UpdateResult>`、`openExternal(url:string): Promise<void>`、`openPath(path:string): Promise<void>`;main 4 个 `ipcMain.handle`(`!client` 无关,这些是本地 shell/网络,不经 app-server;失败抛 Error 由 renderer 兜)。

## 9. LICENSE

仓库根新增 `LICENSE`(MIT,版权行 `Copyright (c) 2026 LyHn`)。关于页「许可证」展示「MIT License」文本(可点开 GitHub 上的 LICENSE,或就地短说明)。

## 10. 测试策略

**纯逻辑(vitest)**
- `prefs`:`loadPrefs` 容错(缺键/非法值→默认)、`savePref` 合并写回(注入 read/write 桩)。
- `theme.resolveThemeVars`:各 theme/accent/fontSize/fontFamily 组合 → 正确 `dataTheme` 与 `vars`;`system` 跟随 `systemDark`。
- `chatIdentity.userAvatarLabel`:emoji 优先、空则首字符、纯空白回落。
- `updateCheck.computeUpdate`:有新版/已最新/仅 prerelease 且 beta 关(→无更新)/beta 开(→取预发)/空列表/含 draft 过滤;semver 比较边界。

**组件/桥**:typecheck + `npm run build` + 眼验(项目无 RTL)。眼验含:三方向落地、主题切换(浅/深/系统)即时生效无闪烁、字号/强调色/字体生效、我的昵称/头像进聊天、检查更新（真连 GitHub）。

## 11. 触点清单

| 层 | 文件 | 改动 |
|---|---|---|
| 偏好中枢 | `renderer/settings/prefs.ts`(新) | Prefs 类型/默认/读写(+测试) |
| 主题 | `renderer/settings/theme.ts`(新) | ACCENTS/resolveThemeVars/applyTheme(+测试) |
| Context | `renderer/settings/SettingsContext.tsx`(新) | Provider + useSettings |
| 深色 | `renderer/styles/tokens.css` | `[data-theme=dark]` 调色板 + `--font-scale` |
| 首屏 | `renderer/main.tsx` | 早期 applyTheme 防闪 + 包 SettingsProvider |
| 聊天 | `renderer/components/AgentMessage.tsx`(新)、`UserMessage.tsx`、`Transcript.tsx`、`renderer/lib/chatIdentity.ts`(新) | 非对称说话人区分 + profile 头像 |
| 设置面板 | `renderer/components/SettingsPanel.tsx`(新)+ `SettingsMe/SettingsInterface/SettingsAbout.tsx`(新) | 左导航+右内容三分区 |
| nav | `renderer/App.tsx`、`renderer/components/Sidebar.tsx` | view 'settings' + ⚙ 入口 + 顶部更新提示条 |
| 更新纯逻辑 | `main/updateCheck.ts`(新) | computeUpdate/semver(+测试) |
| 桥 | `preload/index.ts`、`main/index.ts` | appInfo/checkUpdate/openExternal/openPath |
| 类型 | `shared/types.ts` | AppInfo/UpdateResult(+ Prefs 若共享) |
| 许可证 | `LICENSE`(新,根) | MIT |

## 12. 门禁

- 桌面 `npm run typecheck` + `npx vitest run` + `npm run build` 全绿;Java 不涉改动(本特性纯桌面)。
- 提交前红线扫描 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(本特性不涉密钥,应只命中字段名/自指)。
- commit trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: …`。
- 分支:`feat/settings-ui`(基于合入 skills-crud 后的 main `f265010`)。
- 落地后眼验(重启桌面 app,preload 有改动不热更):三方向 UI、主题/字号/强调色/字体即时生效、我的标识进聊天、检查更新真连 GitHub、GitHub/打开目录按钮生效。
