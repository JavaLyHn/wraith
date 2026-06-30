# Wraith 桌面端 v1 设计 spec

- 日期：2026-06-30
- 状态：开放项已定（sessionId 预留 · 沙箱先于 UI 顺序执行）；待 commit
- 关联：现有 `serve --http`（`runtime/api/`）、`Renderer`（`render/Renderer.java`）、HITL（`hitl/`）

## 1. 目标与非目标

把 Wraith 从纯 CLI 扩成一个 Codex 桌面端形态的 GUI app：对话流、流式正文、可折叠思考、工具卡片（含实时命令输出）、**文件 diff 审查（per-hunk accept/reject）**、危险操作审批弹窗。

**核心判断（已论证）**：agent 核心已经是事件溯源式设计——Agent 主循环只调 `Renderer` 的语义方法（`appendDiff`/`appendToolCalls`/`appendThinking`/`appendAssistantContentDelta`/`updateStatus`/`promptApproval` 等），不直接碰 `System.out`。所以**继续用 Java，核心不重写**；桌面化是**加法**：新增一个事件流出口 + 一个壳，而非重构。

### v1 范围
- **本地单机**：Electron 壳 spawn 并守护一个本地 Java agent 子进程。
- **单会话**：一进程托管一段对话（后端已支持多会话，但 v1 只用一个）。
- **沙箱（硬要求）**：命令执行走 macOS Seatbelt 限制；in-process 文件写入走路径限定；HITL 审批叠在最上层。
- **传输**：stdio 上的 JSON-RPC 2.0。

### 非目标（明确推迟）
- v2 远程后端（VM / 跨网络）——暂定，架构不堵死（stdio 可套 SSH）。
- 并行多线程"指挥中心"——留 v1.x。
- Linux/Windows 沙箱（Landlock / Windows sandbox）——v1 仅 macOS Seatbelt。
- 嵌入式终端、会话侧边栏、palette——v1 不做（nice-to-have）。
- 分发/打包（jpackage + 签名）——后置到要给别人用时。

## 2. 架构总览

```
┌──────────────────────────────────────────────┐
│ Electron 壳                                    │
│  ┌────────────┐        ┌──────────────────┐   │
│  │ Renderer    │  IPC   │ Main process      │   │
│  │ React UI    │<──────>│ spawn+守护 java   │   │
│  │ transcript  │        │ JSON-RPC client   │   │
│  │ diff/审批   │        │ over child stdio  │   │
│  └────────────┘        └─────────┬────────┘   │
└──────────────────────────────────┼────────────┘
                                    │ stdin/stdout (JSONL · JSON-RPC 2.0)
                          ┌─────────┴──────────┐
                          │ java -jar wraith    │
                          │   app-server        │
                          │ ┌─────────────────┐ │
                          │ │ EventStreamRenderer (implements Renderer) │
                          │ └────────┬────────┘ │
                          │  现有 agent 核心(不动) │
                          │  ReAct · 工具 · MCP · RAG · 记忆 │
                          │  工具执行 → Seatbelt 沙箱 │
                          └─────────────────────┘
```

数据流：Agent 调 `Renderer` 语义方法 → `EventStreamRenderer` 序列化成 JSON-RPC notification → 写 stdout → 壳 main 读取 → IPC 转 renderer → React 画。反向：UI 操作（提交输入、审批回应、中断）→ main → JSON-RPC request → java stdin。

## 3. 后端改动（Java，工作量小）

### 3.1 新增 `app-server` 入口
- 新增 CLI 子命令 `wraith app-server`（参照现有 `serve` 的入口风格，`cli/` 下）。
- 启动时构建一个 Agent（单会话），renderer 注入为 `EventStreamRenderer`。
- 不复用 HTTP，独立走 stdin/stdout。
- 现有 `serve --http` 保留不动（不同用途：headless HTTP API）。

### 3.2 `EventStreamRenderer implements Renderer`
把每个语义方法映射成一条 JSON-RPC notification（见 §5 协议）。线程：Agent 在自己的 runner 线程同步调用，renderer 把 JSON 串行写到 stdout（加一把写锁，避免与响应交错）。

**已核实的接入点**（避免空谈）：`appendToolCalls`（`Agent.java:214`）、`appendThinking`/`appendAssistantContentDelta`（`Agent.java:907/928/963/1075`）、`updateStatus`（18 处）都由真实 agent 循环驱动。**diff 例外**：`appendDiff` 不由 Agent 直接调，而是经一个在入口注册的回调 `(path, ba) -> renderer.appendDiff(path, ba[0], ba[1])`（见 `Main.java:382`、`TuiBootstrap.java:148`）。所以 `app-server` 入口必须照样把这个 diff 回调注册到 `EventStreamRenderer`，diff 事件才会流出。

### 3.3 两个新增 Renderer 方法（接口扩展，非重写）
- `appendToolOutputDelta(String callId, String chunk, Stream stream)` —— Codex 那种实时 bash stdout 卡片需要；现有接口只有"工具调用"没有"工具输出增量"。
- `appendToolResult(String callId, int exitCode, boolean ok)` —— 工具卡片收尾（成功/失败/退出码）。
- 三种渲染器（Plain/Inline/Lanterna）给默认 no-op 实现，零回归。
- 命令工具（`tool/` 下 bash/run_command 执行路径）改为流式回调，而非现在的缓冲（`PlanExecuteAgent` 里的 `ByteArrayOutputStream`）。

### 3.4 异步审批
- `promptApproval(ApprovalRequest)` 现在同步阻塞。`EventStreamRenderer` 的实现：发 `approval.requested` notification（带 `approvalId`），阻塞在一个 `CompletableFuture<ApprovalResult>` 上；UI 回 `approval.respond` request → main 转发 → 后端 complete future → 方法返回。
- 无自动超时（本地 UI 常驻）；`turn.interrupt` 可取消整轮。

### 3.5 顺手修既存 bug
- `RuntimeApiServer.java:132` 的 `X-Wraith CLI-API-Key`（带空格的非法头名）——serve 模式仍在用，修成 `X-Wraith-API-Key`。

## 4. 沙箱（方案 A：macOS Seatbelt）

**保护对象是"工具执行"，不是 agent 进程本身**（agent 要联网调 LLM / web 工具，不能整体入笼）。

### 4.1 命令执行（shell / run_command 工具）
- 用 `sandbox-exec -p <profile>` 包裹被 agent 触发的命令子进程。
- 默认 profile（workspace-write）：
  - 写：仅允许 workspace 目录 + `$TMPDIR`。
  - 读：宽松允许（或按需收紧）。
  - **网络：默认 deny**（已与用户确认）。`curl`/`npm install` 这类会被拦，除非该命令被显式放行。
  - `.git`、`~/.wraith` 标记只读。
- 这正是 OpenAI Codex 在 macOS 上的做法（Seatbelt `sandbox-exec`）。`sandbox-exec` 被 Apple 标 deprecated 但仍可用，Codex/Chrome 均在用。

### 4.2 in-process 文件工具（edit / write，在 JVM 内，非子进程）
- Seatbelt 包不住 JVM 内动作 → 靠**路径限定**：edit/write 工具拒绝 workspace 外路径。
- HITL 审批叠在最上层（关键/越界动作仍弹窗）。

### 4.3 网络放行
- UI 审批弹窗对"需要联网的命令"提供"本次放行网络"选项 → 该命令换用放网络的 profile 重跑。

### 4.4 平台
- v1 仅 macOS。Linux（Landlock + seccomp）/ Windows 留待 v2 或 Linux 用户出现时。

## 5. 协议（stdio JSON-RPC 2.0）—— 真正的契约

Framing：每行一个 JSON（JSONL），UTF-8。

### 5.1 客户端 → 服务端（request，有响应）
| method | params | result |
|---|---|---|
| `initialize` | `{clientInfo, workspaceDir}` | `{serverInfo, model, capabilities}` |
| `session.start` | `{workspaceDir}` | `{sessionId}` |
| `turn.submit` | `{sessionId, input, attachments?}` | `{turnId, status:"running"}` |
| `turn.interrupt` | `{sessionId, turnId}` | `{ok}` |
| `approval.respond` | `{approvalId, decision, modifiedArgs?, reason?}` | `{ok}` |
| `shutdown` | `{}` | `{ok}` |

### 5.2 服务端 → 客户端（notification，事件流）
| method | params | 来源 Renderer 方法 |
|---|---|---|
| `turn.started` | `{turnId}` | beginTurn |
| `thinking.begin` / `thinking.delta` / `thinking.end` | `{turnId, label?/text?}` | beginThinking/appendThinking/endThinking |
| `message.delta` / `message.end` | `{turnId, text?}` | appendAssistantContentDelta/finishAssistantContent |
| `tool.call` | `{turnId, callId, name, argsJson}` | appendToolCalls |
| `tool.output.delta` | `{callId, stream, chunk}` | appendToolOutputDelta（新） |
| `tool.result` | `{callId, ok, exitCode}` | appendToolResult（新） |
| `diff` | `{turnId, file, before, after}` | appendDiff |
| `todos` | `{items}` | renderTodos |
| `status` | `{...StatusInfo}` | updateStatus |
| `approval.requested` | `{approvalId, toolName, argsJson, dangerLevel, riskDescription, suggestion}` | promptApproval（异步化） |
| `turn.completed` / `turn.failed` | `{turnId, status/error}` | （loop 收尾） |

`openPalette` v1 不暴露（CLI 专属交互），后端遇到时走默认/降级。

## 6. 前端（Electron + React）

### 6.1 Main process
- 启动即 spawn `java -jar wraith.jar app-server`（warm 常驻整个 app 生命周期，规避 JVM 冷启）。
- JSON-RPC client over 子进程 stdio；与 renderer 间用 Electron IPC。
- 守护：子进程退出/EOF → 标记 disconnected，UI 提示并提供"重启 agent"（重启后用 `SessionStore` 恢复会话）。

### 6.2 Renderer（React）v1 组件（仅 table-stakes）
- **transcript**：流式正文 + 可折叠思考块。
- **工具卡片**：命令 + 实时 stdout（订阅 `tool.output.delta`）+ 收尾状态。
- **diff 查看器**：Monaco diff editor，**per-hunk / per-file accept-reject**（全行业公认最该投入的 UX）。
- **审批弹窗**：`approval.requested` → 模态（同意/拒绝/修改参数/本次放行网络）。
- **状态栏**：model / token / 忙闲。
- 推迟：会话侧边栏、嵌入式终端。

### 6.3 UI 栈
- React + Monaco diff。视觉沿用现有"克制科技感"（冷灰、发丝边框、JetBrains Mono）。

## 7. 错误处理
- java 崩溃/EOF → 壳显示断连横幅 + 重启入口；重启后 `session.resume`。
- 畸形 JSON-RPC → 记录并跳过该行，不崩连接。
- 审批：无自动超时；中断走 `turn.interrupt`。
- 沙箱拦截 → 命令以错误返回，`tool.result {ok:false}`，UI 卡片标红 + 给"放行网络/重试"。

## 8. 测试策略
- **headless 协议 harness（关键）**：脚本用 JSON-RPC 喂 `wraith app-server`，跑一轮，断言事件序列——**整个后端不靠 UI 即可验证**（沿用项目 pty/pyte 那套"测契约不测像素"的哲学）。
- Java 单测：`EventStreamRenderer` 每个方法 → 期望 JSON；JSON-RPC framing；审批 future 往返；`appendToolOutputDelta` 流式。
- 沙箱集成测试：`sandbox-exec` 拦截 workspace 外写入（`assumeTrue(isMac)` 守护）。
- Electron：v1 只做冒烟（spawn → initialize → 一轮 turn → 收到 `turn.completed`）。
- 注意既有 JDK26+Mockito 环境性基线（见项目记忆 `testing_quirks`），勿与本改动混淆。

## 9. 分期里程碑

**执行顺序（已定）：严格依次 P1 → P2 → P3 → P4 → P5；沙箱（P2）先于 UI（P3），不并行。唯一硬前置是 P1（协议未验证则 UI 无从画起）。**

1. **P1 后端 app-server + EventStreamRenderer + 协议 + headless harness** —— 无 UI，先把事件流端到端跑通验证。
2. **P2 Seatbelt 沙箱** —— 命令执行限制 + 路径限定 + HITL 串联。
3. **P3 Electron 壳** —— spawn/守护 java、JSON-RPC client、最小流式 transcript。
4. **P4 富 UI** —— Monaco diff（per-hunk）、审批弹窗、工具卡片实时输出、状态栏。
5. **P5 打包**（后置）—— jpackage 裁剪 JRE + electron-builder + macOS 签名/notarize（需 `allow-jit` 等 entitlement；jpackage 不能跨平台编译，每 OS 一台构建机）。

## 10. 风险与开放问题
- **JVM 冷启 ~8s**（实测 banner ~8s，含 MCP 启动）→ 缓解：warm 常驻子进程，启动期一次性付出 + 壳显 splash；不要每轮重启。
- **Seatbelt deprecated** → 它是 Codex/Chrome 的现役做法，可接受；Linux 用 Landlock 是另一套，留 v2。
- **in-process 编辑不被 Seatbelt 覆盖** → 靠路径限定 + HITL；如需更强,后续把文件写入也走沙箱化 helper。
- **Monaco 在 Electron 的体积** → 可接受。
- **每 OS 打包**（jpackage 无跨编译）→ CI 多 runner，后置处理。
- 已定：协议从 v1 起即带 `sessionId`（见 §5）作为路由键，为 v1.x 并行多会话预留；v1 永远填唯一会话 id。后端多会话能力（`RuntimeThreadStore` / 每 `Agent` 实例隔离）已现成，v1.x 加并行无需破坏协议。
