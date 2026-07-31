# 聊天 ↔ 左侧面板能力对等（Phase D 修 bug + Phase E 高频三件套）—— 设计 Spec

> 日期：2026-08-01 · 分支：`feat/windows-parity-block1`（承接 2026-07-31 自我认知 spec/plan，随 Windows 实机验后一起合回 main）

## 1. 缘起：一次对等审计

用户问：「会话页面里能实现的和左边一样吗？会不会左边实现了、聊天里 agent 做不到？」审计结论 —— **会**。两类问题：

**① 真 bug（Phase D）**：动作卡只在 ReAct 模式出现。
- `tool.call` 通知的唯一活体产出点是 `Agent.java:331`（ReAct 循环）。（另两处 `Main.java:1101` 是 CLI 历史回放、`WechatTerminalRenderer:128` 是委托包装，都不是运行中回合的产出。）
- Plan 模式：`PlanExecuteAgent.java:609` 只做 `printToolCalls(out, …)`，桌面把 `out` 设成 `Main.java:2091` 的 `nullOutputStream()`。
- Team 模式：`SubAgent.java:239` 同样 `printToolCalls(out, …)`，桌面 `out` = `Main.java:1996` 的丢弃流。
- 两模式**都拿到完整工具表**（worker 用同一 `ToolRegistry`，`SubAgent.java:365-367` 只对 planner/reviewer 关工具）→ LLM 会真调 `open_panel`/`im_connect`，工具返回「已在桌面对话中为用户呈现…可点动作卡」，模型照这句告诉用户「已呈现入口」，**而屏幕上什么都没有**。既丢功能，又诱导模型说谎（违反 base.md Safety Policy 的 grounding 要求）。

**② 定位落差（Phase E）**：面板背后约 90 个 RPC 动作，agent 只有 20 个工具。11 个面板里只有「浏览器」基本对等；MCP / 自动化 / 后台任务 / 安全 四个面板聊天里**一件事都做不了**，只能 `open_panel` 指路。这源自 2026-07-31 spec 的非目标（「不重复实现面板已有的配置逻辑」），是设计选择而非实现遗漏；用户现在要求更强，故本期补**高频三件套**：自动化 / 后台任务 / 记忆。

## 2. 目标 / 非目标

**目标**：(D) 动作卡在 ReAct / Plan / Team **三种模式都能显示**，杜绝「说了没做到」；(E) 自动化、后台任务、记忆三类面板动作，用户在聊天里说一句 agent 就能**真的执行**。

**非目标**：不做 MCP server 增删启停、Provider 密钥、IM 密钥（**守密钥红线**）；不做 `memory.clear` / `memory.pendingClear` 等**批量摧毁**类操作（agent 不该有一键清空记忆的能力）；不改 Plan/Team 既有的「只显示步骤产出、不显示工具细节」的 UX。

---

## 3. Phase D —— Plan/Team 的 UI 意图 tool.call 贯通

### 3.1 方案：观察者注入 + 只放行 UI 意图工具

给两个执行器加一个**默认 no-op 的工具调用观察者**，在它们现有 `printToolCalls` 处同步触发；桌面接线时把它接到 `EventStreamRenderer.appendToolCalls`，并**只放行 `open_panel` / `im_connect`**。

- `PlanExecuteAgent`：新增 `setToolCallObserver(Consumer<List<LlmClient.ToolCall>>)`（house style 同 `setStepStreamFactory`，`PlanExecuteAgent.java:179`）；在 `:609` 现有 `printToolCalls(out, …)` 旁调用观察者。
- `AgentOrchestrator`：同名 setter（同 `setProgressListener`，`AgentOrchestrator.java:57`）；观察者需下传给 `SubAgent`（orchestrator 构造 worker 时传入），在 `SubAgent.java:239` 处触发。
- 桌面接线：Team `Main.java:~2017`、Plan `Main.java:~2107` 处各加一行
  `setToolCallObserver(calls -> renderer.appendToolCalls(UiIntentTools.filter(calls)))`。
- CLI 路径不设观察者 → 默认 no-op，**CLI 输出字节不变**（零回归）。

### 3.2 为什么只放行两个 UI 意图工具（关键取舍）

放行全部工具调用看似「顺带补上 Plan/Team 的工具可观测性」,但会引入真缺陷：`ToolCard.done` 只在 `tool.result` 到达时翻转，而 Plan/Team 路径**不产出 `tool.result`**，全量放行会让每张工具卡永久「运行中」转圈。且 Plan/Team 刻意只展示步骤产出（`plan.step.output` / `team.step.output`），突然插入一排工具卡会破坏刚做完的 TeamCard 折叠等 UX。

UI 意图工具没有这个问题：渲染层把它们归约成 `action` / `im-bind` item，**不依赖 `tool.result`**。故只放行这两个 —— 最小、且是唯一不会产生僵尸卡的选择。全量工具可观测性若要做，是独立议题。

### 3.3 新增 `UiIntentTools`

`src/main/java/com/lyhn/wraith/tool/UiIntentTools.java`：
- `public static final Set<String> NAMES = Set.of("open_panel", "im_connect")`
- `public static List<LlmClient.ToolCall> filter(List<LlmClient.ToolCall> calls)` —— 纯函数，null/空安全，返回名字命中 `NAMES` 的子集（空表则 `appendToolCalls` 天然 no-op，见 `EventStreamRenderer.java:161-170` 的 `if (toolCalls == null) return` + 空循环）。

### 3.4 渲染层零改动

`transcriptReducer` 按**工具名**特判，与来源模式无关；Plan/Team 发出的 `tool.call` 走同一 `case 'tool.call'`，照样归约成 `action` / `im-bind` item。卡片作为**顶层 transcript 项**出现在计划/团队卡之后（按到达顺序），可读且无需嵌套改造。**桌面无需任何改动**。

### 3.5 测试

- `UiIntentTools.filter` 纯函数单测（命中/未命中/null/空/混合）。
- `PlanExecuteAgent` / `AgentOrchestrator` 各一个观察者被触发的测试（沿用既有 fake `LlmClient` 范式，参考 `PlanExecuteAgentContextForwardingTest` / `AgentOrchestratorContextInjectionTest`）：LLM 返回一个 `open_panel` 工具调用 → 断言观察者收到该调用。
- 回归门：`mvn -DskipTests=false test` 全绿；桌面无改动（仍跑 `npm test` 确认零影响）。

### 3.6 诚实边界

真机眼验仍需你：Plan/Team 模式下问「怎么接微信」，确认卡片出现且可点。

---

## 4. Phase E —— 高频三件套 agent 工具

### 4.1 统一原则

- **直调既有 Java 服务**，不走 JSON-RPC 回环（面板与 agent 同源同一份服务）。
- 注入范式沿用 `setScopedMemorySaver`（`ToolRegistry.java:204-206`）/ `setTodoSink`（`:209-211`）。
- **写操作分级**：高后果写入进 HITL（`ApprovalPolicy` DANGEROUS_TOOLS，`ApprovalPolicy.java:19-22`）+ 审计（`AUDIT_TOOLS`，`ToolRegistry.java:89`）；只读工具不设闸。
- 参数走扁平 `Map<String,String>`（`ToolExecutor` 签名所限），复杂 DTO 在 Java 侧组装。

### 4.2 后台任务（`DurableTaskManager`，全 `synchronized`、单实例，线程安全）

服务：`enqueue(String):DurableTask`（`DurableTaskManager.java:86`）、`list(int):List<DurableTask>`（`:108`）、`find(String):Optional<DurableTask>`（`:128`）、`cancel(String):boolean`（`:142`）。
注入：`ToolRegistry.setTaskManager(DurableTaskManager)`，在 `Main.java:1224` 建 `registry` 之后接上（`taskManager` 于 `Main.java:1198-1209` 已在同作用域）。

| 工具 | 参数 | HITL |
|---|---|---|
| `task_add` | `prompt` | **是**（后台自主跑一整个 agent 回合，高后果） |
| `task_list` | `limit?`（默认 20） | 否 |
| `task_get` | `id` | 否 |
| `task_cancel` | `id` | 否（可逆性低但危害小，且面板一键即可） |

### 4.3 记忆（`MemoryManager`，经 `agent.getMemoryManager()`）

服务：`listLongTerm()`（`MemoryManager.java:164`）、`searchLongTerm(String,int)`（`:168`）、`deleteLongTerm(String):boolean`（`:172`）、`listPending()`（`:232`）、`approvePending(String):boolean`（`:236`）、`rejectPending(String):boolean`（`:274`）。
注入：`ToolRegistry.setMemoryManager(MemoryManager)`，在 `Agent.java:93`（现已 `setScopedMemorySaver` 处）一并接上。

| 工具 | 参数 | HITL |
|---|---|---|
| `memory_list` | `limit?` | 否 |
| `memory_search` | `query`, `limit?` | 否 |
| `memory_delete` | `id` | **是**（销毁用户数据） |
| `memory_pending_list` | — | 否 |
| `memory_pending_approve` | `id` | 否（把已抽取候选升为正式记忆，等价既有 `save_memory` 风险面） |
| `memory_pending_reject` | `id` | 否 |

**不做**：`memory_clear` / `memory_pending_clear`（批量摧毁，非目标）。凭证硬拦沿用既有 `save_memory` 路径的拦截（本期不新增写事实的入口）。

### 4.4 自动化（`AutomationStore`，无状态按需构造，零接线）

构造：`new AutomationStore(Path.of(System.getProperty("wraith.automation.dir", System.getProperty("user.home") + "/.wraith")))` —— 与 `AppServer.automationStore()`（`AppServer.java:1193-1199`）同款解析。
服务：`loadTasks()`（`AutomationStore.java:22`）、`saveTasks(List)`（`:31`）、`loadRuns()`（`:72`）；cron 校验 `NextRun.isValidCron(String)`（`NextRun.java:46`）；`run-now` 经 `RequestInbox.write(new Request("run-now", taskId, null))`（`RequestInbox.java:101`）。

| 工具 | 参数 | HITL |
|---|---|---|
| `automation_list` | — | 否 |
| `automation_upsert` | `name`, `prompt`, 二选一的 `cron` / `every_minutes` / `daily_time`, `id?`（缺则新建）, `enabled?`, `workspace?` | **是**（创建按 cron 自主跑的 agent，最高后果） |
| `automation_remove` | `id` | **是** |
| `automation_run_now` | `id` | **是** |
| `automation_runs` | `task_id?`, `limit?` | 否 |

**取舍**：`schedule` 只支持 CRON / INTERVAL / DAILY 三种；WEEKLY 与「投递目标 / 审批策略」仍只在面板配（结构嵌套深、扁平参数表达不清），`automation_upsert` 新建任务时 `deliverTo` 留空、`approval` 用默认，工具描述里明确写「投递目标与审批策略请在自动化面板设置」并可 `open_panel(automations)` 指路。

**两条诚实边界（必须写进工具描述，否则模型会误报成功）**：
1. `automation_run_now` 只是往 `~/.wraith/automation-requests/` 写一条请求，**真正执行靠独立的 `wraith gateway` 守护进程**（`GatewayDaemon.java:117-125` 的 `inbox.drain()`）。守护未启动时请求只会排队不执行 → 工具返回串须说明「已排入队列，需自动化/网关守护进程运行才会执行」。
2. `automations.json` 是 load-modify-save，**与桌面面板并发写存在 last-writer-wins 竞态**（既有风险，`AutomationStore` 的 `loadTasks/saveTasks` 未同步，仅靠原子 rename）。工具不新增锁，但在 spec 记录该已知限制。

### 4.5 prompt 更新

- `base.md ## Tools`：登记新增 14 个工具（#17 起）。
- `capabilities.md`：三件套行改写 —— 从「只能开面板」改为「聊天里可直接 `automation_upsert` / `task_add` / `memory_search` …」，并保留 `open_panel` 作为「想自己点就开面板」的补充。
- 顺手补审计发现的小洞：`browser_disconnect` / `browser_status` 已注册但**任何 prompt 里都没提**，模型不知道能用 → 在 Browser Policy 补一句。

### 4.6 测试

- 每个工具家族一组单测：参数校验（缺参 / 非法 id / 非法 cron）、成功路径（用临时目录 / fake 服务断言真实副作用，如 upsert 后 `loadTasks()` 能读回）、失败串前缀（`<tool> 失败: `）。
- `automation_upsert` 的 cron 校验走 `NextRun.isValidCron`，非法 cron 必须拒绝（与面板同规则）。
- HITL 名单测试：断言 `task_add` / `memory_delete` / `automation_upsert` / `automation_remove` / `automation_run_now` 落在 DANGEROUS_TOOLS，且写类工具落在 AUDIT_TOOLS。
- 回归门：`mvn -DskipTests=false test` + 桌面 `npm test` + `npm run typecheck` 全绿。

### 4.7 诚实边界

- 这些工具让 agent **能**执行，但模型是否在正确时机调用，取决于 DeepSeek 的遵循度（同既往 prompt 类修复）。
- `automation_run_now` 的真实执行需要守护进程运行 —— 真机验时请一并确认。
- 剩余 8 个面板（MCP / Provider / 安全 / 快照列表清理 / 技能写操作 / 代码检索建索引 / IM 密钥与守护启停 / RAG 配置）**仍只能指路开面板**，本期不覆盖。

---

## 5. 阶段顺序与独立性

**D 先做**（小、修 bug、纯后端 + 零桌面改动），**E 后做**（大、纯新增工具）。两者互不依赖，各自可独立 SDD、独立交付。

## 6. YAGNI / 取舍汇总

- Plan/Team 只放行 UI 意图工具，不做全量工具卡（避免僵尸卡 + 不动既有 UX）。
- 不碰密钥类面板动作；不给 agent 批量清空记忆的能力。
- 自动化只支持三种 schedule；投递/审批仍走面板。
- 不为 `automations.json` 并发竞态引入新锁（既有风险，记录而非顺手改）。
