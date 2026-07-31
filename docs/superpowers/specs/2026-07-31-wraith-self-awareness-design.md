# Wraith 自我认知 + 聊天内帮用户接入能力 —— 设计 Spec

> 日期:2026-07-31 · 分支:`feat/windows-parity-block1`(与本批 UI 工作同分支,随真机验后合回 main)

## 1. 问题与根因

用户在聊天问「现在有哪些 IM 已经集成了」,agent 去 grep 用户项目代码、答「本项目没有 IM 集成」——**完全没意识到 Wraith 自己就有 IM 网关、支持 QQ/飞书/企业微信/微信**。

根因(已测绘确认):
- 系统提示词(`src/main/resources/prompts/base.md`)只描述 agent 的 14 个**编码工具**(read_file/grep_code…),**从不描述 Wraith 这个产品的能力**(左侧 11 个工具/面板)。
- 无「问 Wraith 自身 vs 问用户项目」的判别 → 一切问题都按 Tool Policy 去 grep 项目。
- IM 二维码绑定流全在桌面主进程(`desktop/src/main/gatewayManager.ts` spawn `java -jar … gateway bind`,QR 经 IPC 到 `ImGatewayPanel`);聊天 agent 走 AppServer JSON-RPC,**够不到它**。
- 聊天无富内容通道:transcript 项固定(`user|message|error|thinking|tool|diff|Plan*|Team`),回复纯 markdown。

## 2. 目标 / 非目标

**目标**:让 agent(1)**认识 Wraith 自身能力**、正确回答元问题;(2)在聊天里**指路并一键帮用户用/接入**左侧每个工具;(3)IM 绑定(QQ/微信)能**在聊天内直出二维码**。

**非目标**:不改各工具后端功能本身;不重复实现面板已有的配置逻辑(复用既有 RPC/IPC);不追求 agent 替用户填密钥(密钥仍走面板表单,守密钥红线)。

## 3. 架构总览

**核心:给 agent 两个「UI 意图」工具,渲染层把这两类工具调用特判成可交互动作卡** —— 复用既有 `tool.call` 事件通道,不新造事件类型。

- agent 调 `open_panel(panel)` / `im_connect(platform)` → 后端工具执行返回一句确认串给 LLM,同时该 `tool.call`(含 name/args)照常经回合事件流到渲染层。
- 渲染层 transcript 对 `name ∈ {open_panel, im_connect}` 的工具项**特判**:渲染成动作卡(按钮 / 内联 QR),点击走既有的侧栏面板跳转 / 绑定 IPC。
- 后端(CLI/网关)无桌面 UI 时,这两个工具是安全 no-op(返回「请在桌面端…」),不崩。

三阶段:**A 自我认知(prompt)→ B open_panel 动作卡 → C im_connect 内联 QR**。

## 4. Stage A —— Wraith 自我认知(prompt 层)

### 4.1 新增 `src/main/resources/prompts/capabilities.md`
由 `PromptAssembler`(`prompt/PromptAssembler.java:20-48`)在 `base.md` 之后拼入系统提示词。内容 = Wraith 产品能力目录(下方 §7 全表)。开头点明:「以下是 **Wraith 自身**(本产品)的能力;用户问『Wraith 有没有 / 怎么用 X 功能』时依此回答,勿把它当成用户项目代码去搜。」

### 4.2 `base.md` 加元问题策略(Tool Policy 段)
新增一条:
> 当用户问的是 **Wraith 自身能力**(如「有哪些 IM 集成 / 支不支持定时任务 / 怎么接微信 / 怎么配 MCP」)时,依据「Wraith 产品能力」目录直接回答并指路(打开哪个面板、几步),**不要用 `grep_code`/`glob_files` 去搜用户项目**。只有用户明确问**当前项目**的代码/文件时才搜项目。

### 4.3 效果
问「有哪些 IM 集成」→「Wraith 支持 QQ / 飞书 / 企业微信 / 微信。要接微信:打开左侧 **IM 网关** → 微信 → 扫码绑定。」(Stage B/C 让「打开 IM 网关」「扫码」变成可点/内联。)

### 4.4 诚实边界
纯 prompt 行为,效果取决于 DeepSeek 遵循度(同既往 grounding 修复性质)。

## 5. Stage B —— `open_panel` 动作卡(聊天一键开面板)

### 5.1 后端工具 `open_panel`
- 位置:`ToolRegistry`(与既有 14 工具并列)。
- 参数:`{"panel": "<id>"}`,`id ∈ {plugins, automations, im-gateway, providers, skills, memory, snapshots, tasks, policy, browser, rag}`(与 `Sidebar.tsx:116` 的 `activeNav` / `App.tsx` 的 `setView` 对齐;MCP 面板内部 id 实为 `plugins`。渲染层再把 LLM 可能用的别名 `mcp` 归一到 `plugins`)。
- 执行:校验 panel 合法 → 返回确认串(如「已为用户呈现『打开 <中文名> 面板』入口」);非法 panel 返回错误串。**不做任何文件/命令副作用。**
- prompt 中登记该工具 + 用法(「当引导用户去某功能面板时调用」)。

### 5.2 渲染层动作卡
- transcript `Item` 新增 `action` 变体(`desktop/src/shared/transcriptReducer.ts`),由「`tool.call` 且 name=open_panel」归约而来(在既有 tool 归约处分流)。
- 组件 `ActionCard.tsx`:一行「🧭 打开 <中文名> 面板」按钮。点击 → 调 App.tsx 既有 `onOpenXxx` 侧栏跳转(`Sidebar.tsx:117-128` 的那组 handler,现只被侧栏按钮用;新增从 transcript 传入的路径)。
- panel id → 中文名 + onOpen handler 的映射抽成一处纯函数(`lib/panelActions.ts`,可单测)。

### 5.3 桥
App.tsx 已持有各 `onOpenXxx`;把它们经 props 下传到 Transcript → ActionCard(或一个 `onOpenPanel(panelId)` 单入口,内部分发)。用单入口 `onOpenPanel(panelId: PanelId)` 最简。

## 6. Stage C —— `im_connect` 内联绑定(含二维码)

### 6.1 后端工具 `im_connect`
- 参数:`{"platform": "<p>"}`,`p ∈ {qq, weixin, feishu, wecom}`。
- 执行:校验 → 返回确认串(如「已为用户在聊天内开启 <平台> 接入」)。无副作用(真正的 bind 由渲染层触发既有 IPC)。
- prompt 登记:「用户想接入某 IM 时调用;weixin 在聊天内直出二维码,qq 一键在浏览器打开授权页并在聊天内看状态,feishu/wecom 引导到面板填密钥」。

### 6.2 渲染层内联绑定卡
- transcript `Item` 新增 `im-bind` 变体,由「`tool.call` 且 name=im_connect」归约。
- 组件 `ImConnectCard.tsx`(⚠ **点击触发,非挂载触发**:transcript 历史回放会重建 `im-bind` item → 若挂载即 spawn bind,每次 resume/切会话都会重启绑定进程。故卡内放一个「开始绑定」按钮,点击才调 bind IPC;订阅 `onGatewayEvent` 可在挂载时挂,只监听不启动):
  - `weixin`:按钮点击调**既有** bind IPC(`window.wraith.gatewayBindWeixinStart(workspace)`,`ImGatewayPanel.tsx:199-202`);把 QR(`bind.qr` data-URI,后端仅微信经 `WRAITH_QR_PNG` 标记发图片事件)+ 状态(`bindPhaseLabel`)+ 兜底链接(`bind.url`)**内联渲染**在卡里。**真·聊天内二维码**。
  - `qq`:按钮点击调 `window.wraith.gatewayBindStart()`(`ImGatewayPanel.tsx:140-143`)。⚠ QQ 后端(`gatewayManager.bindStart`)解析 connect URL 后 `openExternal` **打开系统浏览器**扫码、**不发 `qr`**,故卡内**无内联二维码**,只显示「已打开浏览器授权页」+ 实时状态(`bindPhaseLabel`)+ 取消。
  - 共享:bind 事件→state 归并(`ImGatewayPanel.tsx:118-123` 的逐条保留 qr/url 逻辑)抽成 `lib/imBind.ts` 的纯函数 `applyBindEvent`,面板与聊天卡共用,不复制。
  - `feishu` / `wecom`(填密钥、无 QR):卡内一句说明 + 「打开 IM 网关面板」按钮(退化到 Stage B 的 open-panel 到对应表单)。
  - 绑定中(`phase==='scanning'`)提供「取消」→ 既有 `gatewayBindCancel` IPC。
- 卡内提供「取消」→ 既有 `gatewayBindCancel` IPC。

### 6.3 复用与边界
- **不重写**绑定/QR 逻辑,只把 `ImGatewayPanel` 里的 bind 启动 + QR/状态渲染抽共享,聊天卡与面板同源。
- 真实扫码需真账号,归用户真机验;mac 能验管线(工具→tool.call→im-bind 卡→触发 IPC→QR 占位/状态流转,用假 IPC/事件驱动组件测)。
- 守密钥红线:feishu/wecom 的密钥仍只在面板表单填、落 `~/.wraith/config.json`,聊天卡不碰密钥。

## 7. Wraith 产品能力目录(Stage A 全表,写进 capabilities.md;标注 B/C 动作)

| 工具(panel id) | 是什么 | agent 回答/指路要点 | 动作 |
|---|---|---|---|
| **IM 网关**(im-gateway) | 让 Wraith 经 QQ/飞书/企业微信/微信 收发消息、跑回合、HITL 审批 | 「支持 QQ/飞书/企业微信/微信。微信:扫码绑定(聊天内直出二维码);QQ:一键打开浏览器授权页;飞书/企业微信:填密钥→启动守护」 | C:`im_connect`;B:`open_panel(im-gateway)` |
| **MCP**(panel id=plugins) | 接外部 MCP server(stdio/HTTP),给 agent 加动态工具 | 「MCP 面板加 server(命令或 URL)→启用/重启;或编辑 `~/.wraith/mcp.json`」 | B(`open_panel(plugins)`,别名 `mcp`) |
| **自动化**(automations) | 定时/cron agent 任务 + 投递目标(可投 IM)+ HITL 审批 | 「自动化面板新建任务:cron 表达式 + 投递目标 + 审批策略」 | B |
| **Provider 配置**(providers) | 选/配 LLM 供应商(DeepSeek/GLM/Kimi/Anthropic/StepFun/兼容 OpenAI) | 「Provider 面板填 API key→设默认供应商/模型」 | B |
| **技能**(skills) | 用户级/项目级 Skill 文件,agent 按需 load | 「技能面板新建/编辑/启用;或放 `~/.wraith/skills`、`<项目>/.wraith/skills`」 | B |
| **记忆**(memory) | 长期记忆 + 候选待批自动提取 | 「记忆面板搜索/保存/在『待确认区』批准候选;CLI `/memory pending·approve·reject`」 | B |
| **快照**(snapshots) | 每轮工作区快照 + 恢复/回滚 | 「快照面板列表/恢复某快照;聊天里可用 `revert_turn` 回滚最近若干轮」 | B |
| **后台任务**(tasks) | 持久异步 agent 任务(发后即走) | 「后台任务面板新建/查看/取消;或 `/task add …`」 | B |
| **安全**(policy) | 沙箱 + 命令/路径围栏 + 审计日志 | 「安全面板看策略状态/审计;可切沙箱(macOS Seatbelt)。这是 HITL+围栏+审计,非容器沙箱」 | B |
| **浏览器**(browser) | 连本机 Chrome(CDP)驱动浏览/登录态任务 | 「浏览器面板连接本机 Chrome;聊天里可 `browser_connect`。SPA/需登录态用它」 | B |
| **代码检索**(rag) | 语义索引/搜索(RAG)+ 代码关系图 | 「代码检索面板建索引/搜索/graph;聊天里 `search_code` 语义检索」 | B |

## 8. 影响文件(按阶段)

- **A**:新增 `src/main/resources/prompts/capabilities.md`;改 `prompt/PromptAssembler.java`(拼入)、`base.md`(元问题策略)。
- **B**:改 `ToolRegistry`(加 `open_panel` + prompt 登记);新增 `desktop/src/renderer/lib/panelActions.ts` + `components/ActionCard.tsx`;改 `shared/transcriptReducer.ts`(`action` 变体 + 归约)、`components/Transcript.tsx`(渲染)、`App.tsx`(`onOpenPanel` 下传)。
- **C**:改 `ToolRegistry`(加 `im_connect`);新增 `desktop/src/renderer/lib/imBind.ts`(从 ImGatewayPanel 抽共享 bind/QR 逻辑)+ `components/ImConnectCard.tsx`;改 `transcriptReducer.ts`(`im-bind` 变体)、`Transcript.tsx`、`ImGatewayPanel.tsx`(改用共享 imBind,不复制)。

## 9. 测试(按阶段)

- **A**:prompt 资产存在 + 被 `PromptAssembler` 拼入(可加一个 assembler 单测断言系统提示词含「Wraith 产品能力」标题 + 「IM 网关」等关键词);元问题行为真机眼验(诚实边界)。
- **B**:`panelActions.ts` 纯函数单测(panel id→中文名/校验);`ActionCard` RTL 测(渲染按钮、点击调 `onOpenPanel(id)`);`transcriptReducer` 对 open_panel tool.call 归约成 action 项的单测;`ToolRegistry` open_panel 参数校验单测。
- **C**:`imBind.ts` 纯逻辑单测(bind 事件→state 归并/`bindPhaseLabel` 状态解析,复用既有逻辑);`ImConnectCard` RTL 测(用假 IPC/事件驱动:weixin 渲染 QR `<img>`+状态、qq 渲染「已打开浏览器授权页」+状态、feishu/wecom 渲染开面板按钮);`im_connect` 参数校验单测。真实扫码归用户真机。
- 全阶段回归:`mvn test` + 桌面 `npm test` + `npm run typecheck` 全绿。

## 10. YAGNI / 取舍

- 不新造 AppServer 事件类型——复用 `tool.call`,渲染层特判 name。
- 不让 agent 碰密钥;不替用户填表单。
- feishu/wecom 无 QR → 退化到「开面板」,不硬造二维码。
- CLI/网关端两个 UI 工具是 no-op(返回提示串),不影响非桌面形态。
