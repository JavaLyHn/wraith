# Wraith 桌面端 Phase E-1：MCP 插件管理 设计 spec

> 日期:2026-07-02 · 前置:Phase D 已合并(94bb88a) · 决策人:LyHn
> 拆分决策:Phase E 拆两期——E-1 仅 MCP 插件管理(本 spec);E-2 自动化流程(净新领域,MCP 落地后单独头脑风暴)。
> 范围决策:基础盘 + 配置增删改表单(作用域可选,默认用户级) + 工具列表 + 资源/提示词浏览 + @-mention 接入 Composer;
> session.start 异步启动;UI 主区整页面板;manager 按工作区复用。

## 0. 背景与关键事实(已核实)

- **后端 MCP 栈完整**(`com.lyhn.wraith.mcp`,PaiCLI 血统):`McpServerManager` 已有
  `loadConfiguredServers/startAll(progressOut, maxWait)/restart/restartWithArgs/enable/disable/
  logs/server(name)/servers()/formatStatus/resources(name)/prompts(name)/readResourceForMention/close`;
  配置加载(`McpConfigLoader`)、stdio/http transport、`AtMentionExpander`(@-mention 展开)、
  通知处理都在。**引擎不用造,E-1 是挂载 + 协议 + UI。**
- **app-server 模式没挂载它**:TUI 主路径(`Main.java:254`)创建 `McpServerManager`,
  app-server 会话工厂(`Main.java` 1101 段)只建 HitlToolRegistry,无 MCP——桌面端现状完全用不到。
- 配置两级:`~/.wraith/mcp.json`(用户级)+ `<项目>/.wraith/mcp.json`(项目级);
  `McpConfigLoader.load()` 先 user 后 project `putAll` → **项目级同名覆盖用户级**;
  另自动追加内置 step-search server(若可用)。`${VAR}` 展开支持 `~/.env` 读取,
  单 server 配置错误不阻塞其他 server(prepare 单点失败 → 该 server ERROR)。
- 状态枚举 `McpServerStatus`:`STARTING / READY / DISABLED / ERROR`,wire 面 1:1 小写映射。
- MCP 工具注册进 ToolRegistry 后**按前缀动态纳入审计**(`ToolRegistry.java:87` 注释),
  HitlToolRegistry → `approval.requested` 弹窗链路对 MCP 工具应零改动生效(测试验证项)。
- 每次 `session.start` 新建 HitlToolRegistry(「本会话放行」`APPROVED_ALL` 语义依赖 registry
  不跨会话复用)——manager 复用与 registry 新建的矛盾由新增 `reattach` 解决(§3.1)。

## 1. 目标与非目标

### 1.1 目标(E-1 交付)

1. **app-server 挂载 MCP**:按工作区复用的 McpServerManager 生命周期 + 异步启动 + 状态通知。
2. **mcp.* 协议面**:list/enable/disable/restart/logs/resources/prompts/config.upsert/config.remove
   + `mcp.status` 通知(§4)。
3. **插件整页面板**:侧栏「插件」nav 兑现;左 server 列表(状态点),右详情
   (状态/操作钮 + 工具/资源/提示词/日志四 tab);添加/编辑表单(stdio 型:command/args/env,
   作用域选择,默认用户级),删除带二次确认(破坏性操作)。
4. **Composer @-mention**:输入 `@` 弹两级补全(server → resource,数据来自 mcp.resources 缓存),
   选中插入 `@server:uri` 原文发送,后端 runTurn 前经 AtMentionExpander 展开(TUI 同语义)。
5. **审批链验证**:MCP 工具触发的审批弹窗走既有链路(含改参/本次放行网络/本会话放行),零前端改动。

### 1.2 关键约束

- 「本会话放行」不得因 manager 复用而跨会话泄漏(reattach 只搬工具注册,不搬审批状态)。
- 单活跃会话模型不变;沙箱/审批协议不改(mcp.* 为纯新增)。
- 密钥红线:env 值在 UI 中脱敏显示(只显示 key 名 + `••••`),`mcp.logs` 原样透传
  (server 自己的输出,用户自担);mcp.json 本就仓外。
- 测试金字塔沿用;Java 新测不用 Mockito(harness/@TempDir/匿名 fake)。

### 1.3 非目标(推迟)

- E-2 自动化流程;MCP 市场/发现;OAuth 授权流;HTTP transport 的表单编辑
  (手改 mcp.json 仍生效,UI 只读展示该类条目);TUI 侧行为改动(现有 TUI MCP 体验不动)。

## 2. 架构

```
Electron renderer PluginsPanel/Composer补全 ──IPC──▶ main 透传 ──JSON-RPC──▶ AppServer
                                                                    │ dispatch mcp.*
                                                        AppServerMcp(新,workspace-keyed)
                                                                    │ 持有/复用
                                                          McpServerManager(既有引擎)
                                                                    │ reattach(新增)
                                                          每会话新建的 HitlToolRegistry
```

所有权:MCP 生命周期归 **AppServer 进程层**(跨 session.start 存活),不归单个会话;
UI 状态归 renderer(mcp.status 通知驱动)。

## 3. 后端改动(Java)

### 3.1 `McpServerManager.reattach(ToolRegistry)`(新增,本期唯一动核心的点)

把已连接 server 的工具重新注册进新 registry(取代构造时绑定的旧引用),供 workspace 未变时
的 session.start 复用 MCP 进程。**不搬**审批层任何状态——`APPROVED_ALL` 等会话放行随旧
registry 一起废弃,新会话回到逐次审批。回归测试必须覆盖:旧会话放行 → 新 session.start
复用 manager → 同工具再触发仍要求审批。

### 3.2 app-server 挂载(`Main.java` app-server 工厂 + 新类 `AppServerMcp`)

- `AppServerMcp`(runtime/appserver 包):持 `{workspaceDir, manager}` 单槽;
  `ensureFor(workspaceDir, registry)`:目录未变 → `manager.reattach(registry)` 复用;
  变了(或首次)→ `close()` 旧 → 新建(`McpServerManager(registry, workspaceDir)`)+
  `loadConfiguredServers()` + 后台线程 `startAll`。异常不冒泡到 session.start(fail-open:
  MCP 全挂会话照常可用,状态面板显示 error)。
- 状态推送:startAll 过程中每个 server 状态迁移调 renderer 发 `mcp.status` 通知
  (EventStreamRenderer 新增语义方法 `emitMcpStatus(name, state, error)`)。
  注意 renderer 是每会话新建的——AppServerMcp 经回调拿**当前会话** renderer,复用期换绑。
- workspaceDir 为 null(未传)时按进程 cwd 处理(与现有 runner 语义一致)。

### 3.3 @-mention 展开

app-server 的 runTurn 输入在进 Agent 前经 `AtMentionExpander` 展开(TUI 已有同款前置);
无 MCP/无匹配时原文透传,展开失败(资源读错误)不失败整轮——注入一行错误说明替代内容
(沿用 TUI 现行为;计划期核对 TUI 实际语义后逐字对齐)。

### 3.4 config 写入

`mcp.config.upsert/remove` 直接读改写对应层级 mcp.json(Jackson,保留未知字段),
然后只重载受影响的 server(upsert → restart 该 server;remove → 停进程+从 registry 摘工具)。
作用域 `user` → `~/.wraith/mcp.json`,`project` → `<workspaceDir>/.wraith/mcp.json`。
被项目级遮蔽的用户级同名条目:upsert user 层后生效配置仍是 project 层(合并语义如实反映,
UI 以徽标提示「被本项目覆盖」)。

## 4. 协议(全部新增,现有协议零改动)

| RPC | params | result / 错误 |
|---|---|---|
| `mcp.list` | `{}` | `{servers:[{name, state, scope:"user"\|"project"\|"builtin", enabled, shadowed:boolean, transport:"stdio"\|"http", tools:[{name, description}], envKeys:string[], command?, args?(仅 stdio 回传,非密钥,编辑表单回填), error?}], configError?:string}`;无会话 -32000 |
| `mcp.enable` / `mcp.disable` / `mcp.restart` | `{name}` | `{ok:true}`;未知 name -32000;缺 name -32602 |
| `mcp.logs` | `{name}` | `{lines:string}`(manager.logs 原文);同上错误 |
| `mcp.resources` | `{name?}` | `{resources:[{server, uri, name, description?}]}`(缺 name = 全部 server 汇总,供 @ 补全;引擎 `resourceCandidates()` 本就结构化) |
| `mcp.prompts` | `{name}` | `{text:string}`(引擎 `prompts(name)` 现产格式化文本,v1 提示词 tab 只读展示,不为此扩引擎) |
| `mcp.config.upsert` | `{scope, name, command, args:string[], env:{k:v}}` | `{ok:true}` + 触发该 server 重载;scope 非法/缺字段 -32602;**env 值为空串 = 保留该 key 现值**(仅当原已存在,否则忽略该 key);`scope:"project"` 而当前无有效 workspaceDir → -32602 |
| `mcp.config.remove` | `{scope, name}` | `{ok:true}`;对应层级无此名 -32000 |
| 通知 `mcp.status` | — | `{name, state:"starting"\|"ready"\|"disabled"\|"error", error?}` |

state 由 `McpServerStatus` 1:1 小写映射(STARTING/READY/DISABLED/ERROR)。
`mcp.list` 的 env **不回传值**(只回 key 名列表字段 `envKeys:string[]`)——编辑表单回填时
值留空占位,留空提交 = 保留原值;这是密钥红线在协议面的落点。

## 5. 前端(desktop/)

### 5.1 视图态与 Sidebar

- App 顶层 `const [view, setView] = useState<'chat' | 'plugins'>('chat')`;
  插件页与对话页互斥渲染,对话状态(reducer)不销毁——切回即恢复。
- Sidebar:`nav-plugins` 启用,点击 `setView('plugins')` 且高亮;「自动化」占位 hint 改
  「自动化在 Phase E-2」;其余占位不动。turn 运行中允许进插件页(只读监控合理),
  但启停/重启/删除/表单提交按钮 busy 时禁用(工具集变更冲击运行中轮次)。

### 5.2 PluginsPanel.tsx(整页,新)

- 顶栏:「← 返回对话」(`plugins-back`)+ 标题。
- 左列(`mcp-server-item`):状态点(starting 转圈/ready 绿/error 红/disabled 灰)+ 名称 +
  scope 徽标(用户/本项目/内置 + shadowed「被覆盖」);底部「＋ 添加」(`mcp-add`)。
- 右详情:状态行 + `enabled` 开关(`mcp-toggle`)+ 重启(`mcp-restart`)+ 编辑(`mcp-edit`,
  builtin 隐藏)+ 删除(`mcp-remove`,二次确认,builtin 隐藏);
  tab(`mcp-tab-tools/resources/prompts/logs`):工具(名称+描述列表)、资源、提示词、
  日志(等宽只读,手动刷新钮)。
- 表单(`McpServerForm`,面板内嵌不弹窗):name(编辑态只读)/command/args(逐行)/
  env(k-v 行,值 password 型输入,回填占位 `••••`,留空=保留)/作用域 radio(默认用户级)。
  提交 → `mcp.config.upsert` → 乐观回列表,状态由 mcp.status 通知接管。
- 数据流:进入面板 `mcp.list` 拉全量;`mcp.status` 通知增量更新状态点;操作后重拉 list。

### 5.3 Composer @-mention 补全

- 触发:光标处输入 `@` 且前一字符为空白/行首;浮层列 server(有资源的),选中进二级列资源
  (uri+name,支持前缀过滤);Enter/点击插入 `@server:uri` + 空格,Esc 关浮层。
  **IME 约束沿用 `shouldSendOnEnter` 同款防误触**(isComposing/keyCode 229 不当作确认)。
- 数据:会话建立后(session.start 成功)预拉 `mcp.resources`(全量)缓存于 App state,
  `mcp.status` 转 ready 时重拉;无 MCP/空资源时 `@` 不弹浮层(零打扰)。
- 发送:原文入 turn.submit,展开在后端(§3.3);transcript 用户气泡显示原文。

### 5.4 preload/main IPC

main 纯透传(与 session.* 同款):`wraith:mcpList/mcpEnable/mcpDisable/mcpRestart/mcpLogs/
mcpResources/mcpPrompts/mcpConfigUpsert/mcpConfigRemove`;通知走既有 onEvent 分发。

## 6. 数据流(端到端)

1. 启动/切项目 → session.start → AppServerMcp.ensureFor → (复用 reattach | 重建+异步 startAll)
   → 逐 server `mcp.status` 通知 → 插件页状态点实时变化。
2. 用户添加 server → config.upsert 写 mcp.json → 该 server 启动 → ready 通知 →
   工具进 ToolRegistry → 模型下一轮可调 → 触发审批弹窗(既有链路)。
3. Composer 输入 `@github:issue://123` → 原文提交 → 后端展开注入 → 模型见资源内容。

## 7. 错误处理

- startAll 全程 fail-open:单 server ERROR 不影响他者与会话;MCP 整体初始化异常只记 stderr +
  全部 error 态,session.start 照常返回。
- mcp.* 在无会话时 -32000 `no session`(与 session.* 一致);未知 server -32000;缺参 -32602。
- config.upsert 写文件失败(权限/磁盘)→ -32000 带原因;mcp.json 坏 JSON → 配置加载失败但 manager 照常挂载(空载降级),UI 顶部横幅提示「配置文件解析失败」(list 返回附 configError 字段);写侧 McpConfigWriter 遇坏 JSON 拒写。
- 前端所有 mcp IPC 失败:console.error + 面板内联错误行,不弹全局窗。
- 日志拉取对已删除 server:-32000,前端把日志 tab 置灰。

## 8. 测试策略

- **Java**:`AppServerMcpTest`(workspace 复用/切换重建/fail-open,fake manager);
  `McpServerManagerReattachTest`(工具随新 registry、**放行不泄漏回归**);
  mcp.* dispatch 正/负路径(AppServer 管道 harness,fake SessionRunner);
  @-mention app-server 路径展开(fake expander);EventStreamRenderer emitMcpStatus 序列化。
  全量回归维持 3F/38E 基线。
- **vitest**:@补全触发/过滤/插入纯函数;PluginsPanel 数据变换(list→视图模型、status 合并);
  env 脱敏回填逻辑。
- **Playwright E2E(mock)**:mock-appserver 假造 mcp.* 响应 + 按脚本推 mcp.status
  (`MOCK_MCP` env 注入 fixture);用例:面板打开列表/状态点变迁、添加表单→upsert 请求断言、
  启停/重启请求断言、删除二次确认、日志 tab、@ 补全插入原文提交断言、busy 禁用。
- **待眼验(真后端)**:真 MCP server(如 `@modelcontextprotocol/server-filesystem`)全链路:
  添加→ready→模型调用→审批弹窗→@-mention 展开;项目级配置随切项目重载。

## 9. 范围边界(红线)

- 现有协议消息(session.*/turn.*/approval.*/status/diff)零改动;transcriptReducer 对话链路零改动
  (@补全是 Composer 局部);TUI 行为零改动(reattach 不被 TUI 路径调用)。
- 不做 HTTP transport 表单、OAuth、市场、自动化。

## 10. 风险与开放问题

- **reattach 是审批语义边界上的新 API**:实现与评审都要把「不搬审批状态」当一级要求;
  终审重点。
- AtMentionExpander 在 TUI 的确切失败语义(§3.3)计划期核实后逐字对齐,防止桌面/TUI 行为分叉。
- startAll 后台线程与 session.start 换 renderer 的竞态:通知必须打到**当前**会话 renderer,
  AppServerMcp 用可换绑的 renderer 引用(计划期定线程安全细节)。
- mock 不起真 MCP 子进程,E2E 对 transport 层零覆盖——由 Java 单测 + 眼验补位(与沙箱先例一致)。
