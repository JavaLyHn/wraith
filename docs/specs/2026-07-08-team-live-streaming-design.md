# 设计：Multi-Agent(Team)实时流式(planner 过程 + worker 正文)

日期：2026-07-08
范围：桌面(渲染层 reducer + TeamCard + 类型)+ Java 后端(SubAgent 流式注入 seam + orchestrator 接线 + 事件)。分支 `feat/desktop-multiagent-ui`(续 team 特性)。**含 Java → 眼验前重建部署 jar。**

## 问题

Team v1(已实现)刻意**不做 per-step token 流**:每步只在完成时经 `team.step.completed` 一次性给 `result`,planner 阶段也只在拆解完成后出「拆解为 N 步」。用户反馈整个过程「十分静态」「worker 执行看不到思考内容,只在结束才显示」「看不到 planner 的过程,直接跳到 worker」。

根因:worker/planner 的 LLM 正文经 `SubAgent` 内部 `SubAgentStreamRenderer`(implements `LlmClient.StreamListener`)**写死到终端 `PrintStream out`**(带 🧠/🤖/ANSI chrome),**无注入口子**;桌面 out=discard,故过程被丢弃,只剩完成态的 `result`。

本设计给 Team 补上**实时流式**:planner 拆解过程 + 每个 worker 步骤正文边执行边出字。(动态脉冲动画已单独在 commit `1735416` 完成,非本设计范围。)

## 目标

1. **planner 阶段可视**:拆解时实时流出 planner 的正文/思考,拆完收敛为「拆解为 N 步」。
2. **worker 步骤实时**:running 时正文边执行边流入并自动展开,不再等完成才显示。
3. **CLI 一致性**:SubAgent 默认仍用终端渲染器,CLI 行为字节不变;仅桌面注入事件转发监听器。
4. 并行安全:并行步骤各自流式,带 stepId 归位,writer 已同步。

## 非目标(YAGNI)

- 不改编排/规划/审查/重试逻辑。
- 不流式 reviewer 的审查正文(v1 只流 planner + worker;审查判定仍随 completed 给)。
- 不改动态动画(已完成)、不改会话持久化(已修)。

## 现有结构(锚点,已核实)

- `SubAgent.execute(AgentMessage, PrintStream out)`(:173):`SubAgentStreamRenderer streamRenderer = new SubAgentStreamRenderer(name, role, out)`(:184)→ `llmClient.chat(conversationHistory, tools, streamRenderer)`(:207-211)。`SubAgentStreamRenderer`(:444)`onContentDelta`/`onReasoningDelta` 写 out(带 chrome)。
- `executeWithContext(task, context, out)`(:262)→ `execute(enriched, out)`;`review(orig, result, out)`(:279)→ `execute(...)`。
- `AgentOrchestrator`:`planner.execute(planMessage, out)`(规划);`runStep(step, steps, retryCount, worker, reviewer, context, out)` 内 `worker.executeWithContext(taskMsg, context, out)`;`runBatchParallel` 每步 `stepOut`(缓冲)。
- Team 事件旁路:`TeamProgressListener`(NOOP 默认)+ `EventStreamTeamListener` + `emitTeam*` + `team.*` 通知。桌面 reducer `TeamItem{steps:[{...result?}]}` + `TeamCard`(角色条/步骤时间线/B1 并行组/审查判定/页脚)。
- 参照:plan-mode 的 `EventStreamStepListener`(onContentDelta→plan.step.output、onReasoningDelta→thinking)是同类做法。

## 设计

### §1 SubAgent 流式注入 seam(每调用可选 StreamListener)

给 `SubAgent` 的执行入口加**每调用**的可选额外监听器(不加实例状态,适配 worker 池复用):

- 新重载:
  - `execute(AgentMessage task, PrintStream out, LlmClient.StreamListener extra)`
  - `executeWithContext(AgentMessage task, String context, PrintStream out, LlmClient.StreamListener extra)`
  - (planner 用 execute;worker 用 executeWithContext。review 不流,保持原 `review(...,out)`。)
- 现有签名保留,委托为 `extra=null`(**CLI 路径不变**)。
- 内部:`chat(..., listener)` 的 `listener`——当 `extra != null` 时用**fan-out** `CompositeStreamListener`([内部 `SubAgentStreamRenderer(out)`, `extra`]),两者都收到 delta;`extra=null` 时就用原 `SubAgentStreamRenderer`。终端渲染器照常写 out(桌面 out=discard 无害),`extra` 拿到干净 delta 转事件。
- `CompositeStreamListener`(新,小工具类 implements `LlmClient.StreamListener`):把 `onContentDelta`/`onReasoningDelta`/`finish` 等**逐一转发**给成员列表。

### §2 orchestrator 注入(planner + 每步),仅桌面

`AgentOrchestrator` 加可选流式监听器工厂(默认 null → 不注入 → SubAgent extra=null → CLI 不变):

```
setStepStreamFactory(BiFunction<String /*kind*/, String /*id*/, LlmClient.StreamListener>)
// kind ∈ {"planner","step"}; id = "planner" 或 stepId
```

- 规划:`planner.execute(planMessage, out, factory==null?null:factory.apply("planner","planner"))`。
- runStep:`worker.executeWithContext(taskMsg, context, out, factory==null?null:factory.apply("step", step.id()))`(串行与并行共享 runStep,故每步拿到带 stepId 的 listener)。重试的重执行同样注入(同 stepId)。
- 桌面工厂产出转发监听器:`onContentDelta` → planner 发 `team.plan.output(teamId, delta)`;step 发 `team.step.output(teamId, stepId, delta)`。`onReasoningDelta` 可一并当作正文流(v1 简化:reasoning 也走同一 output 流,或忽略;实现时二选一并在报告说明)。

### §3 事件 + 汇

- `EventStreamRenderer` 加 `emitTeamPlanOutput(teamId, text)` → `team.plan.output`;`emitTeamStepOutput(teamId, stepId, text)` → `team.step.output`。
- 桌面工厂返回的监听器持 `EventStreamRenderer` + teamId(+ stepId),`onContentDelta` 调对应 emit。`emitTeam*` 单次 notify,writer 已 synchronized(并行安全,沿用 T2 结论)。
- `Main.java` team 分支:`orchestrator.setStepStreamFactory((kind,id) -> new EventStreamTeamStreamListener(renderer, teamId, kind, id))`。CLI team 路径**不设**工厂(保持 out 终端流)。

### §4 前端

- `types.ts`:`TeamPlanOutputEvent{teamId,text}`、`TeamStepOutputEvent{teamId,stepId,text}`。
- `transcriptReducer`:
  - `TeamItem` 加 `plannerOutput?: string`;`TeamStep` 加 `output?: string`(流式正文,区别于完成态 `result`)。
  - `team.plan.output` → 累加 `plannerOutput`。
  - `team.step.output` → 按 stepId 累加该步 `output`(不可变、typeof 守卫,乱序/并行归位,沿用 T5 模式)。
- `TeamCard`:
  - **planner 阶段**:steps 为空且有 `plannerOutput` 时,显示一个 🧭 planner 流式区(`plannerOutput` 实时);steps 到达后收敛为「拆解为 N 步」(plannerOutput 可折叠留存或隐藏)。
  - **worker 步骤**:`status==='running'` 且有 `output` 时,自动展开显示 `output`(实时);`done` 后显示 `result`(可折叠,沿用现状)。即 running 看过程、done 看结果。
  - 折叠区沿用 `max-h-48 overflow-y-auto` + `<pre>`。

## 测试 / 门禁

- **Java**:`CompositeStreamListener` 单测(转发给多成员);`EventStreamTeamListener`/renderer 新 emit 的通知形状(仿现有);orchestrator 注入 wiring(工厂被调、planner/step 各拿到 listener)——扩 `TeamProgressWiringTest` 或新 `TeamStreamWiringTest`;**CLI 不回归**:`AgentOrchestratorTest` 全绿(默认无工厂 → SubAgent extra=null)。
- **桌面 vitest**:reducer `team.plan.output`/`team.step.output` 累加 + stepId 归位 + 乱序不串台。
- **UI**:TeamCard planner 区 + running 步骤流式区靠 typecheck + build + 眼验。
- **门禁**:桌面 typecheck 0 + vitest 全绿 + build;Java 针对性 0F/0E + `mvn clean test-compile`。含 Java → 重建部署 jar + 眼验(planner 拆解边出字、worker running 边出字、完成收敛)。

## 风险

- **CompositeStreamListener 完整性**:必须转发 `LlmClient.StreamListener` 的**所有**方法(onContentDelta/onReasoningDelta/finish/其余),漏转会让终端或事件缺片。实现时对接口逐方法覆盖。
- **CLI 一致性**:默认无工厂 → SubAgent extra=null → chat 仍只用 SubAgentStreamRenderer,字节不变。靠 `AgentOrchestratorTest` 锁定。
- **并行流交织**:并行步骤 delta 交织,但各带 stepId,前端归位;writer synchronized 保证帧不坏(T2 已证)。
- **reasoning vs content**:planner/worker 可能同时有 reasoning + content;v1 决定二者是否都进 output 流(实现时定,报告说明),避免重复或丢失。
- **output vs result 重复**:running 显 output、done 显 result,内容可能近似;TeamCard 分状态取用,避免同时重复展示。

## 交付链路

`feat/desktop-multiagent-ui` → 实现(TDD:CompositeStreamListener/reducer 纯逻辑先行;SubAgent seam;orchestrator 注入;事件+汇;TeamCard)→ 桌面三门 + Java 针对性全绿 → 重建部署 jar → 眼验 → 整支终审 → FF/merge(推送前点头)。

## 安全

无新增密钥面(复用现有 provider/key,key 仍只在 `~/.wraith/config.json`)。事件仅承载 planner/worker 正文(与 plan.step.output 同类),不含凭证。提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。
