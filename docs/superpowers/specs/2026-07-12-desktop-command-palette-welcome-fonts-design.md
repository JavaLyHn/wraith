# 命令面板 + 首页样式 + 移除字体选择 设计稿

日期:2026-07-12
状态:已与用户确认设计(多点确认),待写实现计划
所属:桌面 UI 改造(参考 Codex)。三个**相互独立**的子特性,合一份 spec,实现时可并行(见「独立性」)。

## 目标

①把内嵌在左侧栏的搜索升级为**屏幕中央的命令面板**(搜索 + 命令 + 导航,真快捷键);②给首页(WelcomeEmptyState)加 logo + 闪光 + 悬停动效,并把示例提示卡设计为**每次启动随机**、点卡**直接发送**;③设置里**移除「字体」选择**(保留字号)。

## 确认的决策(用户)

- A:**完整命令面板**(搜索 + 命令 + 导航三合一);快捷键做成**真快捷键**。
- B:悬停动效**只作用于 logo**;示例提示卡**每次开 app 随机化**;点卡**直接发送**(不是填入)。
- C:**移除「字体」项**(系统/无衬线/等宽),**字号保留**。

---

## Part A — 命令面板(CommandPalette)

### 组件 / 文件
- **`lib/commandPalette.ts`(新,纯函数,vitest)**
  - 类型:`PaletteItem { id: string; group: 'session'|'project'|'command'|'nav'; label: string; hint?: string; action: string }`(`action` 是一个稳定 key,由 UI 映射到回调;`hint` 是快捷键提示文案如 `⌘N`)。
  - `buildStaticItems(): PaletteItem[]` —— 固定的命令 + 导航项:命令(`new`「新对话」`⌘N`、`settings`「设置」`⌘,`);导航(`plugins`「插件」…共 11 个:plugins/automations/im-gateway/providers/skills/memory/snapshots/tasks/policy/browser/rag,label 用侧栏同款中文名)。
  - `filterPalette(query, sessions, projects, staticItems): { groups: {title,items}[]; flat: PaletteItem[] }` —— 会话/项目用 `filterSidebar` 过滤为 PaletteItem;命令/导航按 `label` 不区分大小写 contains 过滤;空 query 显示全部。返回分组(会话/项目/命令/导航,非空组才出)+ 扁平有序列表 `flat`(供 ↑↓ 与 ⌘1–9,顺序 = 分组拼接顺序)。
- **`components/CommandPalette.tsx`(新)**
  - 居中弹层:复用 `ui/dialog.tsx`(遮罩 + 焦点陷阱 + Esc 关);内容自绘。
  - 顶部搜索 `<input autofocus placeholder="搜索任务或运行命令">`;下方分组结果(组标题 + 行:`[icon] label ……… hint`),当前项高亮。
  - props:`{ open, onClose, sessions, projects, actions }`,`actions` = `{ selectSession(id), activateProject(path), newConversation(), openSettings(), openView(view) }`。
  - 键盘:`↑/↓` 移动选中(在 `flat` 上)、`Enter` 执行选中项、`⌘1–9` 直接执行第 N 个可见项、`Esc`/点遮罩关。执行 = 按 item.action 调对应 action 回调,然后 `onClose()`。
- **`App.tsx`**
  - `paletteOpen` 状态;渲染 `<CommandPalette open={paletteOpen} … />`。
  - **全局真快捷键**(window keydown,`e.metaKey`):`⌘K` → 开面板;`⌘N` → 新对话;`⌘,` → 设置。(在一个 effect 里统一绑定/解绑;`preventDefault`。)面板内的 `⌘1–9`/`Enter`/`↑↓` 由面板自身处理。
  - 透传 actions:`selectSession=handleSelectSession`、`activateProject=switchToProject`、`newConversation=handleNewConversation`、`openSettings=()=>setView('settings')`、`openView=(v)=>setView(v)`。
- **`Sidebar.tsx`**
  - 搜索图标(`nav-search`)改为调用新 prop `onOpenSearch()`(App 传 `()=>setPaletteOpen(true)`)。
  - **移除**内嵌搜索:`searchActive`/`searchQuery` 状态、输入框、就地过滤结果渲染;`filterSidebar` 不再由 Sidebar 用(改由面板用)。保留其余侧栏结构与会话/项目正常列表。

### 边界
- 无会话/项目时:会话/项目组为空、不渲染该组;命令/导航恒在。
- 面板打开时输入自动聚焦;关闭后焦点回落正常。
- `⌘,` 是 metaKey + comma。

---

## Part B — 首页样式(WelcomeEmptyState)

### logo + 闪光 + 悬停(仅 logo)
- 标题「今天做点什么?」上方加 `<Logo className="welcome-logo …">`(主题感知)。
- CSS(`tokens.css`):`.welcome-logo` 环境柔光(drop-shadow);一次性入场闪光扫(mask + 渐变,复用 splash 技术,收尾 opacity 0 不留残);**`.welcome-logo:hover`** → 辉光增强 + 触发一次闪光扫 + `scale(1.04)`,`transition` 平滑。悬停动效**仅 logo**。

### 随机示例提示卡(每次启动随机 + 点卡直发)
- **`lib/welcomePrompts.ts`(新,纯函数,vitest)**:`EXAMPLE_PROMPTS: string[]`(~10 条 wraith 相关中文提示,如「梳理这个项目的架构」「给这段代码补测试」「解释这个报错并修复」「审查我最近的改动」「把这个函数重构得更清晰」等);`pickExamplePrompts(pool: string[], count: number, rng: () => number = Math.random): string[]` —— 无重复随机取 `count` 条(count ≥ pool.length 时返回打乱的全量)。
- **`App.tsx`**:`const [examplePrompts] = useState(() => pickExamplePrompts(EXAMPLE_PROMPTS, 4))` —— **每次启动(App 挂载一次)随机取 4 条、会话内稳定**;传给 `<WelcomeEmptyState examples={examplePrompts} onPickExample={…}>`。
- **点卡直接发送**:把现有 `handleSubmit` 改为可接受覆盖文本 —— `handleSubmit = useCallback(async (override?: string) => { const text = (override ?? inputValue).trim(); … }, [inputValue, …])`(其余逻辑不变;Composer 仍调 `handleSubmit()` 无参)。`onPickExample = (t) => void handleSubmit(t)` —— 点卡即以该提示发起对话(避免读 `setInputValue` 异步旧值)。
- **`WelcomeEmptyState.tsx`**:props 增加 `examples: string[]`、`onPickExample: (text: string) => void`。渲染 logo + 标题 +(保留简短副标题)+ 示例卡网格(每卡显示提示文案,点击 `onPickExample(text)`);仍渲染 `{children}`(composer)。卡片有 hover 态(轻浮起),但「动态特效」重点在 logo。

### 边界
- `handleSubmit(override)`:override 为空白则等同无参(读 inputValue);运行中(turn running)照旧早退。
- 示例卡在 welcome 显示(无活跃会话);点卡发送后 welcome 消失、进入 transcript。

---

## Part C — 移除字体选择(SettingsInterface)

- 删除「字体 系统/无衬线/等宽」整块(`FAMILY_OPTS` 常量、`family-*` 按钮组、该 section)。**字号(小/中/大)保留不动**。
- 清理:若 `FontFamily` 类型 import 变为未用则移除;`ui.fontFamily` 偏好与其应用逻辑(别处)**不动**(默认 system),仅去掉本 UI。
- 既有设置相关测试保持绿。

---

## 独立性 / 并行执行

- **文件归属**:A → `App.tsx` + `Sidebar.tsx` + 新 `commandPalette.ts`/`CommandPalette.tsx`;B → `App.tsx` + `WelcomeEmptyState.tsx` + `tokens.css` + 新 `welcomePrompts.ts`;C → `SettingsInterface.tsx`。
- **可并行**:C 完全独立 → 可与 A/B 并行。**A 与 B 都改 `App.tsx`** → 不宜同时在独立 worktree 改(会撞 App),二者相继做。执行建议:C 与(A→B 顺序)并行;或全部相继。
- 纯函数(`commandPalette.ts`/`welcomePrompts.ts`)先行,组件后接。

## 测试
- **单测(vitest)**:`commandPalette.ts`(buildStaticItems 项数/键、filterPalette 分组与 flat 顺序、空 query、会话/项目复用 filterSidebar);`welcomePrompts.ts`(pickExamplePrompts 无重复、count 截断、注入 rng 决定性)。
- 既有 646 保绿(移除 Sidebar 内嵌搜索若涉及既有 `sidebarSearch` 测试——`filterSidebar` 本身不删、测试仍绿)。
- **眼验**:⌘K 开面板/↑↓/回车/⌘1–9/⌘N/⌘,/Esc/点遮罩;搜索会话跳转、命令与导航执行;首页 logo 闪光 + 悬停动效;示例卡每次启动不同、点卡直接发送;设置无「字体」项、字号仍可用;深浅主题正常。

## 风险
- A:从 Sidebar 抽离搜索后,确认侧栏其余(会话列表/项目/工具导航)不受影响;⌘K 等全局快捷键与既有输入(Composer 里打字)不冲突(仅在 metaKey 组合触发,且面板未开时 ⌘N/⌘, 生效)。
- B:`handleSubmit(override)` 改签名后 Composer 调用点(无参)仍正确;示例卡随机在 App 挂载期一次(不因导航来回重洗——若希望更稳可后续调整,当前会话内稳定即可)。
- C:确保移除后无未用 import / 无残留引用报错。
