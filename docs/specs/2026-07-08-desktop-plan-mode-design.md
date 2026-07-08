# 设计：桌面 App 支持 Plan（Plan-and-Execute）模式

日期：2026-07-08
范围：Java 后端（`PlanExecuteAgent` 去 stdout 依赖 + 桌面事件出口 + 计划复审）+ 桌面渲染层（模式选择器 / 计划清单 / 复审 UI）。分支 `feat/desktop-plan-mode`（off main）。**含 Java → 眼验前重建部署 jar。**
本设计是「桌面多模式」的 Spec 1。**Team（Multi-Agent 协作）延后至 Spec 2**，届时复用本设计的 `PlanProgressListener` 抽象扩展为多 Agent。

## 问题（背景）

桌面 App 目前只跑单 Agent（ReAct）。核对结论（跨 4 层）：

- 前端 `submitTurn(input, attachments)` 无 mode 参数（`preload/index.ts`）→ `turn.submit`（`AppServer.handleTurn`）→ `SessionRunner.runTurn(input)` 接口无 mode（`AppServer.java:28`）→ 桌面 backend 匿名 runner 硬调 `agent.run()`（`Main.java:1209`）。
- CLI 的三模式分派（`Main.java:854-876`：`nextTaskUse*Mode` + `createPlanAgent`/`createTeamAgent`）**没有搬进桌面 SessionRunner**。所以桌面缺的是整条链路，不是少画一个按钮。
- 桌面唯一的「模式」是审批模式 `approvalMode: ask|auto`（Composer「替我审批」开关 → `session.setApprovalMode` → `hitl.setEnabled`）。

`PlanExecuteAgent` 现状：围绕终端 `PrintStream out`（默认 `System.out`）构建，编排叙述（计划、步骤头、复审提示）走 `out.println`；每步执行经 `llmClient.chat(..., TaskStreamRenderer)`，而 `TaskStreamRenderer` 也写 `out`（带 task-id 前缀 + ANSI/终端版 markdown）。它**不驱动**桌面的 `EventStreamRenderer`。

**硬约束**：桌面 backend 的 `stdout` 是 JSON-RPC 协议管道（`EventStreamRenderer` 注释：「stdout 纯净：正文走 message.delta」）。任何 `System.out` 写入都会污染协议流。因此桌面跑 Plan 时，`PlanExecuteAgent` 的进度出口**绝不能落到 System.out**。

## 目标

1. 桌面 Composer 可**逐条**选择 Plan 模式执行一条任务（发完自动回 ReAct）。
2. Plan 进度以**结构化计划清单**呈现（步骤带状态：待办/进行/完成/失败），步骤正文与工具活动复用现有事件渲染。
3. 计划生成后**路由到 UI 复审**（执行 / 补充重规划 / 取消）。
4. CLI/TUI 的 Plan 终端观感与行为**零回归**。

## 非目标（YAGNI）

- 不做 Team（Spec 2）；不重构 `AgentOrchestrator`。
- 不做常驻模式（只逐条）；不在桌面新建 slash 命令解析层。
- 不改 `PlanExecuteAgent` 的规划/执行算法本身（只把「进度出口」从 `PrintStream` 抽象为监听器）。
- 不改其它 SessionRunner（网关 `GatewaySession`、微信）——靠 `runTurn` 默认 mode=react 保持零改。

## 现有结构（锚点）

- 提交入口：`turn.submit { sessionId, input, attachments? }` → `AppServer.handleTurn`：建 `turnId` → `turn.started` → 线程内 `session.runTurn(input, imageParts, imageNames)`。
- `AppServer.SessionRunner`：`runTurn(input)` + 带图重载；`setApprovalMode(boolean)`；`renderer()`。桌面实现是 `Main.java:1200` 匿名类（`runTurn` → `agent.run()`）。
- 阻塞式请求-响应范式：`EventStreamRenderer.requestApproval()` 建 `appr_N` + `CompletableFuture` 存 `pending` map → 发 `approval.requested` → 前端 `approval.respond`（`AppServer` case）→ `resolveApproval(approvalId, result)` 完成 future。
- `PlanExecuteAgent`：`PlanReviewHandler.review(goal, plan) → PlanReviewDecision{EXECUTE|SUPPLEMENT(feedback)|CANCEL}`；`run()` → `runWithPlan` → `planner.createPlan` → `reviewAndExecutePlan` → `executePlan`/`executeTaskBatch`/`executeTask`。CLI 装配见 `Main.java:createPlanAgent`（1677/1688），交互式复审 handler 见 1947-1959 + `mapReviewDecision`（3395）。
- 前端事件消费：`desktop/src/shared/transcriptReducer.ts`（`turn.*`/`message.*`/`thinking.*`/`tool.*`/`approval.requested`/`diff`/`status`）。Composer 工具条：`desktop/src/renderer/components/Composer.tsx`（麦克风/替我审批/模型/中断/发送）。

## 设计

### §1 分派链路（跨层）

- 前端：Composer 加模式分段控件 `ReAct | Plan`；App reducer 存 `pendingMode: 'react'|'plan'`（默认 react）。
- `submitTurn(input, attachments, mode)`（preload 加 mode）→ `client.request('turn.submit', { …, mode })`。
- `AppServer.handleTurn`：读 `params.mode`（缺省 `"react"`）；透传给 `session.runTurn`。
- `SessionRunner` 加带 mode 的重载：`default String runTurn(String input, List<ContentPart> imageParts, List<String> imageNames, String mode)`，默认体忽略 mode 调旧重载 → **其它 runner 零改**。
- 桌面匿名 runner 覆写该重载：`"plan".equals(mode)` → 用 `PlanExecuteAgent`（复用 reactAgent 的 toolRegistry/memory/skill/MCP，进度出口换成桌面 sink，见 §2；复审 handler 换成桌面复审，见 §4）；否则走原 `agent.run()`。
  - **装配注意**：不复用 CLI `Main.createPlanAgent`（它耦合 `terminal/lineReader/ui`，桌面无这些）。桌面按 TUI 式构造：`new PlanExecuteAgent(llmClient, toolRegistry, memoryManager, reviewHandler)` + `setExternalContextSupplier(mcp::resourceIndexForPrompt)` + `setSkillRegistry`/`setSkillContextBuffer`，再注入 `PlanProgressListener`（§2）。构造需新增能同时传 `PlanProgressListener` 的重载（或 setter），默认不传 = CLI 旧行为。
  - `planId` = 本轮合成 id（如 `plan_<turnId>`），供前端把 `plan.*` 事件归属到同一计划 item。
- 发送后前端把 `pendingMode` 复位为 react（逐条语义）。

### §2 后端核心：`PlanProgressListener` 抽象（拆 stdout 依赖）

引入语义监听器接口（新文件 `agent/PlanProgressListener.java`）：

```java
interface PlanProgressListener {
    void planCreated(ExecutionPlan plan);
    void stepStarted(String stepId);
    void stepDelta(String stepId, String text);
    void stepCompleted(String stepId, boolean ok, String result);
    void planFinished(String finalResult);
}
```

- `PlanExecuteAgent` 改为把进度发给 `listener`，不再直接 `out.println`（内部 `TaskStreamRenderer` 的正文经 `stepDelta` 出）。构造增加可选 `PlanProgressListener`（默认 = CLI sink 保持旧行为）。
- **CLI sink**（`TerminalPlanListener`）：把事件按现有格式写回 `out`（终端观感 100% 不变）。
- **桌面 sink**（`EventStreamPlanListener`，位于 appserver 包）：翻译成 JSON-RPC 通知（§3）；`stepDelta` 复用现有 `message.delta`；步骤内工具调用天然经共享 `toolRegistry` → 桌面 `EventStreamRenderer` 的 `tool.*`（无需额外接线）。
- 备选（不选）：(a) 往通用 `Renderer` 接口加 plan 方法 → 污染接口；(b) stdout 文本桥接 → 保真度不足（已否）。

### §3 线协议：新通知 + 新方法

通知（均带 `sessionId/turnId`）：

| 通知 | payload |
|---|---|
| `plan.created` | `{ planId, goal, steps:[{ id, description, deps:[stepId] }] }` |
| `plan.step.started` | `{ planId, stepId }` |
| `plan.step.completed` | `{ planId, stepId, ok:boolean, result?:string }` |
| `plan.review.requested` | `{ reviewId, planId, goal, steps:[…] }` |

方法：`plan.review.respond { reviewId, decision:"execute"|"supplement"|"cancel", feedback?:string }`。
步骤正文/思考/工具**复用** `message.delta`/`thinking.*`/`tool.*`，不新造。

### §4 计划复审（镜像 approval 的阻塞-future 管道）

- `EventStreamRenderer` 加 `requestPlanReview(plan) → PlanReviewDecision`：仿 `requestApproval` 建 `review_N` + `CompletableFuture` 存独立 `pendingReviews` map → 发 `plan.review.requested` → worker 线程阻塞等。
- `AppServer` 加 `case "plan.review.respond"` → `session.renderer().resolvePlanReview(reviewId, decision, feedback)` 完成 future。
- 桌面复审 handler 把结果映射回 `PlanReviewDecision`：`execute→EXECUTE`、`supplement→SUPPLEMENT(feedback)`（→ 重规划 → 再次弹复审）、`cancel→CANCEL`（结束该轮）。
- 取消/中断：`turn.interrupt` 若在复审等待期到达，complete future 为 CANCEL（避免线程悬挂）。

### §5 前端

- **模式选择器**：Composer 工具条分段控件 `ReAct | Plan`；`pendingMode` 存 App reducer；提交后复位 react。
- **计划清单 `PlanCard`**：`transcriptReducer` 加 `plan.created`/`plan.step.started`/`plan.step.completed` 分支，维护一个 plan transcript item（步骤列表 + 每步状态 ○待办/◐进行/✓完成/✗失败）。步骤正文/工具卡照旧内联渲染在计划下方。
- **复审 UI**：仿现有 approval 卡，三按钮（执行/补充/取消）；「补充」展开一个反馈输入框 → `plan.review.respond`。
- preload 加 `respondPlanReview(reviewId, decision, feedback?)` → `wraith:respondPlanReview` → `client.request('plan.review.respond', …)`。

### §6 横切

- **取消**：复用 `turn.interrupt` → `CancellationContext`；`PlanExecuteAgent` 循环已检 `isCancelled()`，天然响应；复审等待期见 §4。
- **替我审批**：步骤内工具调用照常走 HITL（共享 `toolRegistry`+`hitl`）——与「计划复审」是两件独立事。
- **快照**：Plan run 包进 `snapshotService.runTurn("plan", input, …)`，与 CLI 对齐（可 /restore 回溯）。
- **持久化**：计划结果按现有 `[计划结果]` 前缀落 session store，与 ReAct 同路径。

## 测试 / 门禁

- **Java**：
  - `PlanProgressListener` 事件序列单测（给定 `ExecutionPlan` → 断言 planCreated→stepStarted*→stepCompleted*→planFinished 顺序）。
  - 桌面 sink（`EventStreamPlanListener`）序列化断言（事件 → JSON-RPC 通知形状）。
  - 计划复审：`requestPlanReview` 阻塞 + `resolvePlanReview(execute/supplement/cancel)` 映射正确。
  - **回归**：现有 Plan 相关测试（`PlanExecuteAgent`/`Planner`）全绿——改造只换出口、不变算法。
- **桌面**（vitest 纯逻辑）：`transcriptReducer` 三个 plan 事件 → 计划 item 状态；模式选择器 per-turn 复位；PlanCard 状态映射；复审响应 payload 构造。typecheck 0 + build ✓。
- **门禁**：桌面 typecheck + vitest 全绿 + build；Java 针对性 `-Dtest='PlanExecuteAgentTest,PlanProgressListenerTest,EventStreamPlanListenerTest'`（实际类名以实现为准）0F/0E。**含 Java → 重建部署 jar + 眼验**（Plan 计划清单逐步点亮、失败步骤红、复审弹窗三选、补充能重规划、取消能停、CLI Plan 无回归）。

## 风险

- 动核心 `PlanExecuteAgent`（去 stdout）——靠现有 Plan 测试 + 新 listener 测试双守；改造限定为「出口抽象」，不碰规划/执行逻辑。
- 计划复审阻塞在 worker 线程——与 approval 同模型（已在生产验证）；中断路径显式 complete future 防悬挂。
- 步骤正文经 `message.delta` 与 ReAct 正文同通道——计划清单靠独立 `plan.*` 事件锚定 planId/stepId 归属，不与普通消息混淆。

## 交付链路

`feat/desktop-plan-mode` → 实现（TDD，subagent-driven）→ 桌面三门 + Java 针对性全绿 → 重建部署 jar → 眼验 → FF-merge + 推送（推送前点头）。

## 安全

无密钥面。计划/步骤文本是诊断性内容（沿用现有截断）；不新增网络/存储；复审响应仅承载 UI 决策 + 反馈文本。
