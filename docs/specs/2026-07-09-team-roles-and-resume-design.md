# 设计：Team 角色全可视（planner 行 + reviewer 流式）+ 会话 resume 重建卡片

日期：2026-07-09
范围：桌面渲染层（TeamCard + reducer + messagesToItems + resume 处理 + 类型）+ Java 后端（SubAgent review 流式 seam + orchestrator 注入 + team.review.output 事件 + **plan.\*/team.\* 卡片事件录制** + 旁车持久化 + resume 返回）。分支 `feat/desktop-multiagent-ui`。**含 Java → 眼验前重建部署 jar。**

> **范围更新（2026-07-09，用户拍板）**：resume 卡片重建**同时覆盖 plan 与 team**（不再只做 team）。录制/旁车/回放机制做成**模式无关**：录制 `^(plan|team)\.` 的卡片事件（**排除** `plan.review.requested` 这类交互式请求与 `message.*`），resume 时喂回同一个 reducer——reducer 已同时识别 plan.\* 与 team.\*，故回放天然产出 `PlanItem` 或 `TeamItem`。

## 问题

用户在 Team 模式下反馈两处（对应两张截图）：

1. **直播卡片角色不全**：拆解阶段只收敛成一行「🧭 拆解为 N 步」，看不到 planner 像 worker-1 那样有独立行/正文；reviewer 只有一个小小的行内「✅ 审查通过」标签，看起来「reviewer 没工作」。
2. **resume 卡片丢失**：team 会话结束后，从左侧列表重新点进该会话，界面显示的是原始 chrome'd 文本（`✅ 多 Agent 协作任务完成！📋 执行总结：[step_1] …`），而不是直播时那张团队卡片。

### 根因（已核实）

- **角色可视**：planner 的流式正文（`team.plan.output`）在 `TeamCard` 里只在 `steps.length===0` 时显示，steps 一到就被「拆解为 N 步」取代、丢弃；reviewer 的 LLM 审查正文**根本没流式**（v1 有意只流 planner + worker），只有 `approved`/`retries` 判定随 `team.step.completed` 一次性给出。
- **resume 丢卡片**：会话持久化只存 `LlmClient.Message` 列表（`SessionStore` 每会话一个 JSONL，meta 行 + 消息行），**该列表会在续接时回放给 LLM**，因此不能往消息里塞卡片数据。team 卡片是**纯直播事件产物**（`team.*` 通知），从不持久化；`messagesToItems` 只认 user/assistant/tool，故 resume 只能重建成一条纯文本消息。此外 team 记的是 chrome'd `result`（plan 记的是干净答案），呈现更糟。

## 目标

1. **planner 常驻行**：`TeamCard` 顶部有一个 🧭 planner 行（worker 同款：badge + 「规划 · 拆解为 N 步」+ 可折叠 `plannerOutput` 正文），规划中实时、拆完收敛为可折叠。
2. **reviewer 流式**：reviewer 的审查正文像 worker 一样边执行边流式，卡片每步下有独立的 🔎 reviewer 分区。
3. **resume 即时重建卡片（plan + team）**：从别处点回 plan/team 会话，卡片完整复现（team：角色、步骤、结果、判定、planner/worker/reviewer 正文；plan：清单步骤 + 各步正文），呈现顺序与直播一致（卡片在上、干净答案气泡在下）；**无延迟重建**（不重放逐字动画）。
4. **CLI 一致性（最高）**：以上后端改动只在桌面 team 分支生效；CLI 终端 team 路径字节不变。

## 非目标（YAGNI）

- 不改编排/规划/审查/重试逻辑本身（只加流式 seam 与事件录制）。
- 不做 resume 的**动画回放**（逐字打字）——即时重建即可。
- 不改动态脉冲动画、不改会话持久化的 JSONL 主格式（旁车是新增独立文件）。
- resume 不重建交互式的计划复审提示（`plan.review.requested`）——该轮复审早已应答，只重建最终清单卡片。

## 现有结构（锚点，已核实）

- `SubAgent`：`execute(task, out, StreamListener extra)`（:188）已存在；`review(orig, result, out)`（:~311）→ 组 reviewTask → `execute(reviewTask, out)`。**review 暂无 extra 重载**。
- `AgentOrchestrator.runStep`（:~519）：`worker.executeWithContext(taskMsg, context, out, streamFor("step", step.id()))` 已注入；reviewer 调用（`reviewer.review(...)`）**未注入**；重试处（:~582）同理。`streamFor(kind,id)`（:59）、`setStepStreamFactory`（:58）已在。
- `EventStreamTeamStreamListener.onContentDelta`（:37）：`kind=="planner"`→`emitTeamPlanOutput`，else→`emitTeamStepOutput`。**无 review 路由**。
- `EventStreamRenderer`：`emitTeamPlanOutput`/`emitTeamStepOutput`（:256/262）在；**无 `emitTeamReviewOutput`**；`writer.notify` 已 synchronized。
- `Main.java` team 分支（:1453-1498）：装配 orchestrator + `setProgressListener` + `setStepStreamFactory` + `getLastCleanResult()` 底部消息 + `recordExternalTurn(goal, result)`（**注意：目前存 chrome'd `result`**）。
- `SessionStore`：JSONL/会话；`persist(history)` 全量重写；`resume(id)` 返回 `List<Message>`。**无旁车概念**。
- `AppServer.handleSessionResume`（:715）：`session.resume(id)` → 序列化 `messages` → 返回 `{sessionId, messages, provider, model}`。**可加字段**。
- 前端：`transcriptReducer`（`TeamItem`/`TeamStep`，`team.*` cases）、`TeamCard.tsx`、`messagesToItems.ts`（user/assistant/tool → Item）、`App.tsx` resume（`resumeSession` → `messagesToItems` → `loadHistory`）、`main/index.ts`（`wraith:resumeSession` IPC）。

## 设计

### Part 1 — planner 常驻行（纯前端）

- reducer：`team.plan` 分支保留 `plannerOutput`（现状即不清空，确认保留）。
- `TeamCard`：删除「仅 steps 为空显示规划区」的条件，改为**常驻 planner 行**，与 worker 行结构一致：
  - badge：🧭 planner（planner 配色）；
  - 摘要：steps 到达后显「规划 · 拆解为 N 步」，未到达显「规划中…」；
  - 正文：`plannerOutput` 可折叠区（`max-h-48 overflow-y-auto` + `<pre whitespace-pre-wrap break-words>`）；规划中默认展开（实时），拆完后可折叠（沿用 done 步骤默认展开策略）。
- 后端零改动。

### Part 2 — reviewer 流式（后端 + 前端）

**后端：**
- `SubAgent`：新增 `review(AgentMessage original, AgentMessage result, PrintStream out, LlmClient.StreamListener extra)`；旧 `review(orig, result, out)` 委托 `extra=null`（CLI 字节不变）。body 里 `execute(reviewTask, out, extra)`。
- `AgentOrchestrator.runStep`：reviewer 调用改为带 `streamFor("review", step.id())`（首审 + 重试各一次）。
- `EventStreamTeamStreamListener.onContentDelta`：加第三分支 `"review".equals(kind)` → `renderer.emitTeamReviewOutput(teamId, id, delta)`。
- `EventStreamRenderer`：加 `emitTeamReviewOutput(teamId, stepId, text)` → `writer.notify("team.review.output", {teamId, stepId, text})`。

**前端：**
- `types.ts`：`TeamReviewOutputEvent{teamId, stepId, text}`。
- `transcriptReducer`：`TeamStep` 加 `reviewOutput?: string`；`case 'team.review.output'` → `updateTeamStep` 累积 `reviewOutput`（不可变、typeof 守卫、stepId 归位）。
- `TeamCard`：`TeamStepRow` 每步下加一个 🔎 reviewer 分区（与 worker 正文分开的折叠块）；有 `reviewOutput` 才渲染；running-review 实时、done 可折叠。

**并发**：reviewer 按 stepId 归位（与 worker output 同款），`writer` 已 synchronized，帧安全。

### Part 3 — resume 即时重建卡片（plan + team；录制 + 旁车 + 回放）

机制**模式无关**：录制卡片事件、旁车持久化、resume 喂回同一个 reducer。plan 与 team 共用同一套。

**录制（后端）：**
- `EventStreamRenderer` 加可选录制：`startCardRecording()` / `List<RecordedEvent> stopCardRecording()`（`RecordedEvent{method, params}`）。录制开启时，`notify` 到的方法若匹配**卡片事件白名单**则把 `(method, params 副本)` 追加进缓冲。
- **白名单**：`method` 以 `plan.` 或 `team.` 开头，**排除** `plan.review.requested`（交互式复审请求，已应答，不重建）。`message.*`（干净答案气泡）**不录**——它已在 conversationHistory 里，由 `messagesToItems` 产出，避免重复。
- `stopCardRecording()` 时**合流**：把连续的 `*.output`（`plan.step.output` 按 stepId / `team.plan.output` / `team.step.output` 按 stepId / `team.review.output` 按 stepId）合并为每通道一条（拼接 `text`）。结构性事件（plan.created / plan.step.started/completed / team.started/plan/batch/step.started/step.completed/finished）原样保留、保持相对顺序。→ 存储有界，回放内容一致。

**持久化（后端）：**
- 旁车文件 `<sessionId>.cards.jsonl`（与会话同目录）；每行 `{v:1, turnOrdinal, events:[{method, params}]}`。`turnOrdinal` = 本轮在该会话里的**用户轮序号**（0-based，= `recordExternalTurn` 后 conversationHistory 里 user 消息计数 − 1）。
- `SessionStore` 加 `appendCard(sessionId, turnOrdinal, eventsJson)`（追加一行）与 `readCards(id)`（返回 `List<{turnOrdinal, events}>`；文件不存在→空）。删除/重命名会话时旁车随之删除/迁移（`deleteById`/`rename` 同步处理 `.cards.jsonl`）。
- `Main.java` **plan 与 team 两个分支**：`run()` 前 `renderer.startCardRecording()`；`run()` 后 `stopCardRecording()` 拿到事件（空则不写），连同 `turnOrdinal` 暂存；在本轮会话 persist 之后写旁车（复用已分配的 `sessionId`）。**仅桌面**（CLI plan/team 路径不录）。
- **一致性修正**：team 改为 `recordExternalTurn(goal, cleanTeamAnswer != null && !blank ? cleanTeamAnswer : result)`（与 plan 对齐；resume 的干净气泡文本与直播一致）。plan 已是干净答案，无需改。

**resume（后端 → 前端）：**
- `AppServer.handleSessionResume`：`result.put("cards", session.readCards(id))`（每项 `{turnOrdinal, events:[{method, params}]}`）。
- `main/index.ts` `wraith:resumeSession`：透传 `cards`。
- `types.ts`：`ResumeResult` 加 `cards?: Array<{turnOrdinal:number; events:Array<{method:string; params:unknown}>}>`。
- `App.tsx` resume 处理：`messagesToItems(messages)` 得基础 items；对每个 `cards` 项，用一个**独立干净 reducer**（`items:[]` 起步）无延迟依次 `reduce` 其 `events` → 取出回放产出的卡片 item（`PlanItem` 或 `TeamItem`，取决于事件）；按 `turnOrdinal` 定位到第 N 个 user item，把卡片 item 插入到该轮助手输出（干净答案 message）**之前**。回放用现有 `reduce`（`{kind:'notification', method, params}`），零新重建逻辑。

**向后兼容**：老会话无旁车 → `cards` 空 → 纯文本回落（现状）。
**边缘（标注）**：
- 对历史做 rewind / 删中间轮会使 `turnOrdinal` 错位；v1 按「末轮追加」语义处理，不为 rewind 重排旁车。
- 规划失败的轮次（如 parse 失败）也会录到「structural-only」事件（team：started + finished(failed)；plan：可能仅 created 或空）→ resume 重建一张基本为空的失败卡 + chrome'd 报错气泡。**可接受**（用户确认），不特殊处理。

## 测试 / 门禁

- **Java**：
  - `SubAgent` review 重载：`extra=null` 时行为等同旧签名（CLI 不变）；`extra!=null` 时 delta 扇出到 extra。
  - orchestrator：捕获型工厂断言 reviewer 拿到 `kind="review"` + 正确 stepId 的 listener；`AgentOrchestratorTest` 全绿（默认无工厂 → CLI 不回归）。
  - `EventStreamRenderer.emitTeamReviewOutput` 通知形状；录制 start/stop + 白名单过滤（`plan.review.requested`/`message.*` 不录）+ 合流（连续 output 合并、结构事件保序）。
  - `SessionStore` 旁车读写 + 删除/重命名同步。
- **桌面 vitest**：`team.review.output` 累积 + stepId 归位；**resume 回放**：给定录制事件列表，干净 reducer 跑完得到期望卡片 item——**team**（角色/步骤/结果/判定/planner+worker+reviewer 正文齐全）与 **plan**（清单步骤 + 各步正文）各一例；且按 `turnOrdinal` 拼接位置正确（卡片在干净答案 message 之前）。
- **UI**：planner 行 / reviewer 分区 / resume 卡片靠 typecheck + build + 眼验。
- **门禁**：桌面 typecheck 0 + vitest 全绿 + build；Java 针对性 0F/0E + `mvn clean test-compile`；含 Java → 重建部署 jar。

## 风险

- **录制内存**：合流前缓冲全部 team.* 事件；单轮量可控（步骤数 × 常数 + 合流后每通道一条）。长任务下 output delta 多，但 `stopTeamRecording` 即合流，落盘有界。
- **CLI 一致性**：review 重载 `extra=null` 委托、录制仅桌面开、工厂默认 null —— 三重保证；靠 `AgentOrchestratorTest` + review 单测锁定。
- **turnOrdinal 相关性**：见上「边缘」；正常线性会话稳定，rewind 是已知边缘。
- **顺序保真**：合流必须保持结构性事件与 output 事件的相对顺序（step.started 在其 output 前、step.completed 在后），否则 reducer 重建错位。合流只合并**连续同通道 output**，不跨结构事件重排。
- **旁车与主文件一致性**：`persist` 全量重写主文件、旁车追加；删除/重命名需双写。v1 覆盖 delete/rename；rewind 不覆盖（标注）。

## 交付链路

`feat/desktop-multiagent-ui` → 实现（TDD：reducer/合流/resume 回放纯逻辑先行；SubAgent seam；orchestrator 注入；事件+录制+旁车；AppServer/Main 接线；TeamCard/planner 行/reviewer 分区；resume 拼接）→ 桌面三门 + Java 针对性全绿 → 重建部署 jar → 眼验（直播三角色可见 + plan/team resume 卡片回来）→ 整支终审 → FF/merge（推送前点头）。

## 安全

无新增密钥面（复用现有 provider/key，key 仍只在 `~/.wraith/config.json`）。事件仅承载 planner/worker/reviewer 正文（与 `team.step.output` 同类），不含凭证。旁车文件在 `~/.wraith/sessions/<project_hash>/`，仓库外。提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`（只应命中字段名/自指）。
