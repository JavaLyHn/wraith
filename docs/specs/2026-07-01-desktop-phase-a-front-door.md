# Wraith 桌面端 Phase A：前门 + 视觉身份 设计 spec

- 日期：2026-07-01
- 状态：设计已论证，三点已定（UI 库=shadcn/ui · 欢迎文案=Wraith 自己的 · setApprovalMode 后端改动=接受）；待用户复核 spec
- 关联：`desktop/`（P3b 已落地的 Electron 壳）、`src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`、`Main.java:1104-1160`（app-server 启动 + SessionRunner 工厂）
- 前置：P1 协议 / P2 沙箱 / P3a 协议补全+流式 / P3b Electron 壳 均已合并 main

## 0. 背景与路线定位

看过 Codex 桌面端真实截图后，把北极星定为**全面对齐 ChatGPT/Codex 桌面级 app**，分阶段做。新分解 **Phase A–E 取代并吸收了旧 spec §9 的 "P4 富 UI + P5 打包"**（不是冲突，是向上重定范围）：

- **Phase A（本 spec）**：前门 + 视觉身份 —— Wraith 自己的柔和浅色观感、欢迎空态、富 composer、静态侧栏骨架。单会话不变。
- Phase B：侧边栏 + 多会话 + 持久化（吸收 旧-P4 的 重启重连 / `session.resume` / `sandbox.unavailable`；需后端多会话）。
- Phase B.5 / 富对话视图：Monaco per-hunk diff + 富审批（改参 / 本次放行网络）+ token 状态展示（吸收 旧-P4 的 Monaco diff / 富审批 / 状态栏）。
- Phase C：项目工作区。
- Phase D：插件（MCP）/ 自动化。
- Phase E：打包（吸收 旧-P4/P5 的 CSP 加固 + jpackage/electron-builder/签名）。

**旧 "P4" 这个名字退休**；旧条目已在上面逐一归位，无孤儿。已完成的（工具卡片实时输出、最小审批弹窗）不重做，Phase A 只对其重皮。

### Codex 作为"质量标尺"而非"皮肤"

参照 Codex 的**做工水准**（留白、层次、克制的动效、圆角 composer、居中欢迎态），但**不抄它的配色**。Wraith 有自己的视觉身份：冷灰蓝底 + 幽灵青（ghost-cyan）点缀的**柔和浅色**主题。目标是"一看就知道是精心打磨的产品"，而不是"Codex 换了个 logo"。

## 1. 目标与非目标

### 1.1 目标（Phase A 交付）

1. **视觉身份**：把现在 `App.tsx` 满屏内联深色样式（`#0d0f12` 底、JetBrains Mono）换成 Wraith 自己的**柔和浅色**设计系统（token 化、可主题）。
2. **前门体验**：进 app 首屏是**居中欢迎空态**（大标题 + 富 composer），发出第一条消息后平滑过渡到对话流。
3. **富 composer**：圆角输入区，带附件（占位禁用）、模型/强度显示（只读）、**"替我审批"开关（功能可用）**、项目上下文（只读）、发送/中断（功能可用）。
4. **静态侧栏骨架**：左侧柔和渐变导航栏（品牌区 + 占位导航 + 设置），**纯视觉占位，无多会话逻辑**——为 Phase B 立骨架。
5. **组件重皮**：Transcript / ToolCard / ThinkingBlock / ApprovalModal / DisconnectedBanner 全部换到新调色板，保留既有功能与 `data-testid`。
6. **唯一后端改动**：新增 `session.setApprovalMode` RPC，把"替我审批"开关接到 `hitl.setEnabled(!auto)`。

### 1.2 非目标（明确推迟到后续 Phase）

- 多会话 / 会话侧边栏的**真实逻辑** / 会话持久化 → **Phase B**（Phase A 只放静态骨架）。
- 重启重连 / `session.resume` / `sandbox.unavailable` 事件 → **Phase B**。
- Monaco per-hunk diff / 富审批（改参·放行网络）/ token 状态栏 → **Phase B.5**。
- 项目工作区（切项目 / 多项目）→ **Phase C**（Phase A 只只读展示当前工作目录）。
- 插件 / 自动化 → **Phase D**。
- **真实**模型切换 / 强度调节（后端启动时固定 model，per-turn 切换需后端改动）→ 后续 Phase（A 只只读显示）。
- 附件上传（协议已预留 `attachments`，未实现）→ 后续 Phase（A 只放禁用占位）。
- CSP 加固 / 打包 → **Phase E**。
- 侧栏导航项（搜索/插件/自动化/项目）的**功能** → 各自归属阶段（A 只放禁用占位 + tooltip）。

## 2. 设计语言 / 视觉身份

### 2.1 调色板（柔和浅色 · token 化）

以 CSS 变量表达，便于 shadcn 主题接入与未来暗色扩展。数值为设计意图，实现时可微调到视觉舒适：

| token | 值（浅色） | 用途 |
|---|---|---|
| `--bg` | `#f7f8fa` | app 主底（冷白微灰蓝） |
| `--bg-elevated` | `#ffffff` | 卡片 / composer / 弹窗面 |
| `--bg-sidebar` | 柔和渐变 `#eef1f6 → #e7ebf3` | 侧栏（对齐 Codex 的柔和渐变导航栏） |
| `--fg` | `#1c2430` | 正文主色 |
| `--fg-muted` | `#5b6675` | 次要文本 / 占位 |
| `--fg-subtle` | `#98a2b3` | 更弱（时间戳/禁用态） |
| `--border` | `#e2e6ec` | 发丝边框 |
| `--accent` | `#0ea5b7`（ghost-cyan） | 品牌点缀 / 主按钮 / 焦点环 |
| `--accent-fg` | `#ffffff` | accent 上的文字 |
| `--danger` | `#c0392b` | 高危审批 / 中断 |
| `--warn` | `#e67e22` | 中危 |
| `--ok` | `#1f9d63` | 连接就绪 / 成功 |

- **危险色对齐真后端**（沿用 P3b 修复）：审批弹窗按 `dangerLevel.includes('高危')→--danger` / `includes('中危')→--warn` / else `--accent`。
- **字体**：正文用系统 UI 无衬线栈（浅色 UI 更亲和）；**代码 / 工具输出 / diff 用等宽**（JetBrains Mono, ui-monospace, Consolas）。即"聊天像产品、代码像终端"。

### 2.2 观感原则

- 大留白、清晰层次、发丝边框、8px 网格间距。
- 动效克制：欢迎态→对话流的过渡、消息淡入、思考块展开——都是短促 ease，不炫技。
- 圆角：composer 与卡片用中等圆角（`12–14px`），按钮 `8px`。

## 3. UI 栈决策：shadcn/ui（已定）

**选用 shadcn/ui（Radix primitives + Tailwind CSS，组件源码拷进仓库）。** 理由：

- Phase A 真正需要的交互原语（Dialog=审批弹窗、Tooltip=禁用控件提示、Switch=替我审批、Select/Dropdown=模型显示占位）shadcn/Radix 现成且无障碍达标。
- 组件是**拷进仓库的源码**（非黑盒依赖），可逐一改成 Wraith 调色板；**CSS 变量主题**恰好是我们表达"Wraith 自己身份"的方式——一套 token 驱动全部组件。
- 运行时依赖只增加 Radix（按需）+ tailwind 是构建期，产物是本地 CSS/JS。

### 3.1 接入 electron-vite（renderer）

- 加 `tailwindcss` + `postcss` + `autoprefixer`，`tailwind.config` 扫 `src/renderer/**`，token 映射到 CSS 变量。
- shadcn 组件放 `src/renderer/components/ui/`（其 CLI 生成/手工拷贝，均为本仓源码）。
- **不影响 main/preload 构建**（Tailwind 只作用于 renderer）。
- **CSP 前向说明**：renderer 目前无 CSP（P3b 记录，Phase E 才加）。Radix 定位用**内联 style 属性**，Tailwind 产出本地 CSS——Phase A 无 CSP 冲突；Phase E 加 CSP 时 `style-src` 需含 `'unsafe-inline'`（或 nonce），届时处理，本 spec 记为前向风险。

### 3.2 边界

- 只在 renderer 引入；`shared/`（reducer / jsonRpcClient / types）保持**纯 TS 零 UI 依赖**不变。
- 不为了用库而重写已跑通的数据流；库只服务"画"。

## 4. 布局架构：AppShell = Sidebar + MainPane

```
┌───────────────────────────────────────────────────────────┐
│ AppShell (flex row, height:100vh)                           │
│ ┌───────────────┐ ┌───────────────────────────────────────┐│
│ │ Sidebar        │ │ MainPane (flex col)                    ││
│ │ (静态骨架)      │ │  ┌───────────────────────────────────┐ ││
│ │  品牌区         │ │  │ [DisconnectedBanner? 顶置]         │ ││
│ │  新对话(占位)    │ │  │ 内容区:                            │ ││
│ │  搜索/插件/自动化│ │  │   hasStarted? Transcript          │ ││
│ │  /项目 (占位)    │ │  │            : WelcomeEmptyState     │ ││
│ │  ── 对话 ──      │ │  └───────────────────────────────────┘ ││
│ │  当前会话(静态)  │ │  ┌───────────────────────────────────┐ ││
│ │  ── 底部 ──      │ │  │ Composer (欢迎态居中 / 对话态底部)  │ ││
│ │  设置(占位)      │ │  └───────────────────────────────────┘ ││
│ └───────────────┘ └───────────────────────────────────────┘│
└───────────────────────────────────────────────────────────┘
```

### 4.1 Sidebar（`components/Sidebar.tsx`，新增，静态）

- 柔和渐变背景（`--bg-sidebar`），固定宽（~240px）。
- **品牌区**：Wraith 字标 + 幽灵青点缀。
- **"新对话"**：占位按钮，禁用 + tooltip「多会话在 Phase B」（单会话下不可新建）。
- **导航项**：搜索 / 插件 / 自动化 / 项目 —— 占位、禁用、各带 tooltip 指向后续 Phase。
- **对话列表**：静态展示单条"当前会话"（无切换逻辑）。
- **底部**：设置（占位禁用 + tooltip）+ 当前工作目录（只读，`--fg-subtle`）。
- 全部占位控件必须有 tooltip，读起来是"即将推出"而非"坏了"。

### 4.2 MainPane（`components/MainPane.tsx` 或 App 内组织）

- 顶：断连横幅（沿用 `DisconnectedBanner`，重皮）。
- 中：`hasStarted ? <Transcript/> : <WelcomeEmptyState/>`。
- 底/中：`<Composer/>`（欢迎态时随空态居中；对话态贴底）。

## 5. 欢迎空态（WelcomeEmptyState）

- `components/WelcomeEmptyState.tsx`，新增。
- 垂直居中：大标题 + 富 composer（composer 同一个组件，位置随 `hasStarted` 变）。
- **大标题文案（Wraith 自己的，已定）**：`今天做点什么？`（Wraith 语气，非沿用 Codex 的"我们该做什么？"）。副标题可选一行 `--fg-muted` 轻描述（如「Wraith 会读代码、跑命令、改文件——先说个目标」）。文案是易调项，实现时可微调。
- **过渡**：`hasStarted` 由 false→true 时，欢迎态淡出、Transcript 淡入、composer 从居中滑到贴底（短促 ease，`prefers-reduced-motion` 时不做位移）。

## 6. 富 Composer（`components/Composer.tsx`，新增）

一个组件，两种位置（居中/贴底）。控件功能划分：

| 控件 | Phase A 状态 | 行为 |
|---|---|---|
| 文本输入 | **功能** | 多行 textarea；Enter 发送 / Shift+Enter 换行（沿用现逻辑）；`data-testid="input"` |
| 发送 | **功能** | 触发 `submitTurn`；`turn==='running'` 或空输入时禁用（沿用） |
| 中断 | **功能** | `turn==='running'` 时出现；`data-testid="interrupt"`（沿用） |
| **替我审批开关** | **功能（新）** | Switch；开=auto(不弹审批)、关=ask(逐个弹)；切换调 `window.wraith.setApprovalMode(auto)`；`data-testid="approval-toggle"` |
| 附件 (+) | **占位禁用** | 禁用图标按钮 + tooltip「附件在后续阶段」 |
| 模型/强度 | **只读展示** | chip 显示 `state.model`（来自 initialize）；强度为禁用下拉占位 + tooltip「模型/强度切换在后续阶段」 |
| 项目上下文 | **只读展示** | chip 显示当前工作目录名（不可切换；切项目在 Phase C）；`data-testid="workspace-chip"` |

- **决策提请复核**：截图里 Codex 有"进入项目工作"按钮。Phase A 采**只读工作目录 chip**（不做重新选目录/切项目——那是 Phase C），避免假按钮。若你希望 A 就能重选目录（复用现有 `pickWorkspace`+重启会话），是个小增量，spec 复核时说一声即可加。

## 7. 组件重皮（保留功能与 testid）

对以下已存在组件仅换样式到新 token，**不改数据契约、不改 `data-testid`、不改事件处理**：

- `App.tsx`：拆出 AppShell 布局；移除满屏内联深色样式，改用 token / Tailwind 类。
- `Transcript.tsx`：浅色消息气泡；代码块保持等宽 + 浅色代码底。
- `ToolCard.tsx`：浅色卡片；实时 stdout 区等宽；成功/失败/退出码用 `--ok`/`--danger`。
- `ThinkingBlock.tsx`：浅色可折叠块；toggle 保留 `data-testid="thinking-toggle"`。
- `ApprovalModal.tsx`：改用 shadcn Dialog；危险色按 §2.1 的中/高危规则（沿用 P3b 修复）；保留 `data-testid="approve"/"reject"`。
- `DisconnectedBanner.tsx`：浅色警示条；保留 `data-testid="restart"`。

## 8. 唯一后端改动：`session.setApprovalMode`（Java）

### 8.1 协议新增（client → server, request）

| method | params | result |
|---|---|---|
| `session.setApprovalMode` | `{sessionId, auto: boolean}` | `{ok: true}` |

- `auto=true` → 替我审批（不弹窗，自动放行）；`auto=false` → 逐个弹审批。

### 8.2 接入点（精确）

现状：`Main.java:1104-1160` 的 app-server 启动里，`SessionRunnerFactory` lambda 构建：
- `SwitchableHitlHandler hitl`（`Main.java:1124`），`hitl.setEnabled(true)`（`:1126`，默认开审批）。
- `SwitchableHitlHandler.setEnabled(b)` 会 `delegate.setEnabled(b)` 传导到 `RendererHitlHandler`（已由 `hitl.setDelegate(rendererHitl)` 挂上，`:1149`）。
- 返回的 `SessionRunner`（`:1151`）当前只有 `renderer()` 与 `runTurn(String)`。

改动：
1. `AppServer.SessionRunner` 接口**新增**方法 `void setApprovalMode(boolean auto)`。
2. `Main.java` 的 lambda 里实现：`setApprovalMode(auto) { hitl.setEnabled(!auto); }`（`hitl` 是 lambda 内已有的局部引用，闭包捕获即可）。
3. `AppServer.dispatch()`（`AppServer.java:62-80` 的 switch）**新增** `case "session.setApprovalMode" -> handleSetApprovalMode(msg);`，读 `params.auto`（bool，缺省 false），调 `runner.setApprovalMode(auto)`，回 `{ok:true}`；无 runner/会话未启时按现有错误风格回 `-32000`。

### 8.3 并发说明

切换来自 dispatch 线程，读取（`isEnabled`）在 agent runner 线程。`setEnabled` 只写一个 boolean 字段——为避免可见性问题，若该字段非 `volatile`/非原子，实现任务里改成 `volatile boolean`（一行）。切换语义上应在**轮次之间**生效；轮次进行中切换按"下次审批点生效"，不追求中途插队。

## 9. 数据流与状态

### 9.1 reducer 新增（`shared/transcriptReducer.ts`，纯 TS，vitest 覆盖）

- `TranscriptState` 加两个字段：
  - `hasStarted: boolean`（initial `false`）——控制欢迎态/对话态。
  - `approvalMode: 'ask' | 'auto'`（initial `'ask'`）——驱动开关 UI。
- 新增 LocalAction（沿用现有 `clearApproval`/`setModel` 的 helper 风格）：
  - `markStarted(state)` → `{...state, hasStarted:true}`。
  - `setApprovalMode(state, mode)` → `{...state, approvalMode:mode}`。
- **`hasStarted` 翻转时机**：在 `App.handleSubmit` 里发消息的同步时刻 dispatch `markStarted`（不是等 `turn.started`），保证发出即切走欢迎态、无闪烁。
- 不改任何既有 BackendEvent 分支；纯加法。

### 9.2 IPC / preload 新增

- `preload/index.ts`：`window.wraith` 增 `setApprovalMode(auto: boolean): Promise<{ok:boolean}>`。
- `main/index.ts`：新增 IPC handler，转成 JSON-RPC `session.setApprovalMode {sessionId, auto}` 发后端（`sessionId` 由 main 已追踪）。
- `renderer/global.d.ts`：补 `setApprovalMode` 类型。
- App：开关 `onChange` → `dispatch(setApprovalMode)` + `window.wraith.setApprovalMode(auto)`（失败则回滚 UI 态并 `console.error`，不崩）。

## 10. 测试策略

沿用 P3b 测试金字塔（纯模块 vitest → Playwright-electron GUI E2E 打 mock 后端 → 真 java 手动眼验），**测契约/行为不测像素**：

- **vitest（纯模块）**：
  - reducer 新增：`markStarted` 幂等且不可变；`setApprovalMode` 切换；初始 `hasStarted=false`/`approvalMode='ask'`；既有分支回归不变。
- **Playwright-electron E2E**（打确定性 mock 后端 `test/fixtures/mock-appserver.mjs`）：
  - 首屏出现欢迎大标题（`今天做点什么？`）+ composer；transcript 不在。
  - 提交一条 → 欢迎态消失、transcript 出现（`hasStarted` 过渡）。
  - **切"替我审批"开关** → 断言 `session.setApprovalMode` 请求发出且 `auto` 值正确（mock 记录收到的请求）；再切回断言 `auto=false`。
  - 断连横幅重皮后仍可见、`restart` testid 仍在（回归）。
  - 全程 auto-waiting，无 sleep，无像素断言。
- **mock 后端**：加 `session.setApprovalMode` 处理（回 `{ok:true}`、记录 auto 值供断言）。
- **控制器真后端眼验**（Phase A 收尾，非 CI）：真 `java -jar ~/.wraith/wraith.jar app-server`，`WRAITH_E2E=1` 跳目录对话框，眼看：浅色前门渲染、欢迎→对话过渡、切"替我审批"后一个本会触发审批的命令**不再弹窗**（验证 `hitl.setEnabled(false)` 真生效）。临时脚本用后删除、不提交。
- 注意既有 JDK26+Mockito 环境性基线（项目记忆 `testing_quirks`），新增 Java 测试避开 Mockito；`session.setApprovalMode` 的后端测试走 headless JSON-RPC harness 风格（喂请求、断言 `{ok}` + 审批行为），不引 Mockito。

## 11. 范围边界（一句话红线）

Phase A 只做"前门 + 视觉身份 + 替我审批开关"。**不做**多会话/持久化/重启重连（B）、Monaco diff/富审批/状态栏（B.5）、切项目（C）、插件/自动化（D）、真模型切换/附件、CSP/打包（E）。侧栏与部分 composer 控件是**诚实的禁用占位 + tooltip**，不是半成品功能。

## 12. 风险与开放问题

- **shadcn/Tailwind 接入 electron-vite**：需在 renderer 加 Tailwind/PostCSS 管线；风险低（社区常见组合），但要确保只作用于 renderer、不碰 main/preload 的 CJS 产物（P3b 的 preload CJS 约束不能破）。实现首任务先跑通"空 shadcn 组件 + build + 既有 E2E 绿"再铺开。
- **Radix 内联 style vs 未来 CSP**：见 §3.1，Phase E 处理，记为前向风险。
- **替我审批的可见性/线程**：见 §8.3，字段 `volatile` 化。
- **欢迎文案**：已定 `今天做点什么？`，属易调 copy。
- **"进入项目"按钮**：Phase A 采只读 chip（§6 决策提请复核），若要功能性重选目录需小增量。
- **浅色 UI 与深色偏好**：Phase A 只交付浅色；token 化已为暗色留门，暗色主题非本阶段目标。
