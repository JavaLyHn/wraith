# Team 实时流式(planner 过程 + worker 正文)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让 Team 模式的 planner 拆解过程与每个 worker 步骤正文在桌面**边执行边流式**呈现。

**Architecture:** SubAgent 加每调用可选 StreamListener(fan-out,默认终端渲染器→CLI 不变);orchestrator 为 planner/每步注入转发监听器 → 新事件 `team.plan.output`/`team.step.output`;前端 reducer + TeamCard 渲染流式正文。

**Tech Stack:** Java 17(pkg `com.lyhn.wraith`)、Electron/React/TS、vitest。

## Global Constraints

- **CLI 一致性(最高)**:默认不注入(orchestrator 无工厂 → SubAgent extra=null → chat 仍只用内部 `SubAgentStreamRenderer`),CLI 行为**字节不变**。只桌面 team 分支设工厂。不改编排/规划/审查/重试逻辑;既有 `out.println`/`execute` 行为不动,只加重载与 fan-out。
- **CompositeStreamListener 必须转发 `LlmClient.StreamListener` 的所有方法**(逐方法覆盖,漏一个都会缺片)。
- **并行安全**:并行步骤各自 listener + stepId 归位;`emitTeam*` 单次 notify,`JsonRpcWriter` 已 synchronized(沿用既有结论)。
- 组件 `): JSX.Element`;纯逻辑 vitest,UI 靠 typecheck+build+眼验。
- 提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。含 Java → 收尾重建部署 jar。

## 已核实事实

- `SubAgent.execute(task, out)`(:173)→ `new SubAgentStreamRenderer(name, role, out)`(:184)→ `llmClient.chat(conversationHistory, tools, streamRenderer)`(:207-211)。`executeWithContext(task, ctx, out)`(:262)→ `execute(enriched, out)`。`review(...,out)`(:279)。
- `SubAgentStreamRenderer implements LlmClient.StreamListener`(:444)。**实现前先 `grep -nE "void on|void finish|default" LlmClient.java` 列全 StreamListener 的方法**,CompositeStreamListener 逐一转发。
- orchestrator:`planner.execute(planMessage, out)`;`runStep(...,out)` 内 `worker.executeWithContext(taskMsg, context, out)` + 重试处再执行;`runBatchParallel` 每步 stepOut。
- 事件旁路:`EventStreamRenderer.emitTeam*` + `EventStreamTeamListener` + `Main.java` team 分支(~1461-1492);reducer `TeamItem`/`TeamStep`(`transcriptReducer.ts`),`TeamCard.tsx`。

---

### Task 1: CompositeStreamListener + SubAgent 每调用注入(Java, TDD)

**Files:** Create `.../llm/CompositeStreamListener.java`(或 agent 包,与用处就近);Modify `SubAgent.java`;Test `CompositeStreamListenerTest.java`。

**Interfaces (Produces):** `CompositeStreamListener implements LlmClient.StreamListener`(ctor 收 `List<LlmClient.StreamListener>`);`SubAgent.execute(task, out, StreamListener extra)`、`executeWithContext(task, ctx, out, StreamListener extra)`。

- [ ] **Step 1:** `grep` LlmClient.StreamListener 全部方法。写 `CompositeStreamListenerTest`:构造带两个捕获型成员,调 `onContentDelta("a")`/`onReasoningDelta("b")`/`finish()` 等**每个**方法,断言两成员都收到。

- [ ] **Step 2:** 运行失败(类不存在)。

- [ ] **Step 3:** 实现 `CompositeStreamListener`:持 `List<StreamListener> members`,每个接口方法遍历转发(null 成员跳过)。

- [ ] **Step 4:** SubAgent 加重载:
```java
public AgentMessage execute(AgentMessage task, PrintStream out, LlmClient.StreamListener extra) { ... }
public AgentMessage executeWithContext(AgentMessage task, String context, PrintStream out, LlmClient.StreamListener extra) {
    return execute(enrich(task, context), out, extra);
}
```
把原 `execute(task, out)` 的 body 改为 `execute(task, out, null)` 委托;真正 body 里:
```java
LlmClient.StreamListener listener = (extra == null)
    ? streamRenderer
    : new CompositeStreamListener(List.of(streamRenderer, extra));
LlmClient.ChatResponse response = llmClient.chat(conversationHistory, tools, listener);
```
现有无 extra 的 `execute(task,out)`/`executeWithContext(task,ctx,out)`/`review(...,out)` 全部委托 `extra=null` → **CLI 字节不变**。

- [ ] **Step 5:** 运行 `CompositeStreamListenerTest` 全绿 + `mvn -q clean test-compile`。

- [ ] **Step 6:** 提交 `feat(agent): SubAgent 每调用可选 StreamListener + CompositeStreamListener fan-out`。

---

### Task 2: orchestrator 流式工厂 + planner/每步注入(Java)

**Files:** Modify `AgentOrchestrator.java`;Test 扩 `TeamProgressWiringTest`(或新 `TeamStreamWiringTest`)。

**Interfaces (Produces):** `AgentOrchestrator.setStepStreamFactory(BiFunction<String,String,LlmClient.StreamListener>)`(kind∈{planner,step}, id)。

- [ ] **Step 1:** 加字段 + setter(默认 null):
```java
private java.util.function.BiFunction<String,String,LlmClient.StreamListener> streamFactory;
public void setStepStreamFactory(BiFunction<String,String,LlmClient.StreamListener> f){ this.streamFactory=f; }
private LlmClient.StreamListener streamFor(String kind, String id){ return streamFactory==null?null:streamFactory.apply(kind,id); }
```

- [ ] **Step 2:** 注入点(只加 extra 参数,不改其余):
  - planner:`planner.execute(planMessage, out, streamFor("planner","planner"))`。
  - `runStep` 内 `worker.executeWithContext(taskMsg, context, out)` → `+ streamFor("step", step.id())`;重试处的再执行同样加 `streamFor("step", step.id())`。
  - (review 不注入。)
- runStep 串/并共享,故并行步骤天然各拿到带自身 stepId 的 listener。

- [ ] **Step 3:** 测试:捕获型工厂,断言 planner + 各 step 都拿到 listener 且 kind/id 正确;**CLI 不回归**:不设工厂时 `streamFor` 返回 null,`AgentOrchestratorTest` 全绿。

- [ ] **Step 4:** `mvn -DskipTests=false -Dtest='TeamProgressWiringTest,AgentOrchestratorTest,...' test` 0F/0E + test-compile。提交 `feat(agent): orchestrator setStepStreamFactory 为 planner/每步注入流式监听器`。

---

### Task 3: 事件 emit + 桌面转发监听器 + Main 工厂接线(Java)

**Files:** Modify `EventStreamRenderer.java`;Create `EventStreamTeamStreamListener.java`;Modify `Main.java`(team 分支);Test 扩 `EventStreamTeamListenerTest`。

- [ ] **Step 1:** `EventStreamRenderer` 加 `emitTeamPlanOutput(teamId, text)`→`team.plan.output`、`emitTeamStepOutput(teamId, stepId, text)`→`team.step.output`(仿 emitTeam*,base()+notify)。

- [ ] **Step 2:** `EventStreamTeamStreamListener implements LlmClient.StreamListener`(ctor `(renderer, teamId, kind, id)`):`onContentDelta(d)` → kind=="planner"?`emitTeamPlanOutput(teamId,d)`:`emitTeamStepOutput(teamId,id,d)`;`onReasoningDelta` 决策:**v1 也当正文流走同一 output**(实现时若发现 reasoning 噪声大可改忽略,报告说明);其余接口方法空实现。空/blank delta 跳过。

- [ ] **Step 3:** `Main.java` team 分支:`orchestrator.setStepStreamFactory((kind,id) -> new EventStreamTeamStreamListener(renderer, teamId, kind, id))`。**CLI team 路径不设**(保持终端流)。

- [ ] **Step 4:** 测试新 emit 的通知形状。`mvn` 针对性 0F/0E + test-compile。提交 `feat(appserver): team.plan.output/step.output 事件 + 桌面流式转发接线`。

---

### Task 4: 前端类型(TS, haiku)

**Files:** Modify `desktop/src/shared/types.ts`。

- [ ] 加 `TeamPlanOutputEvent{teamId:string;text:string}`、`TeamStepOutputEvent{teamId:string;stepId:string;text:string}`。`npm run typecheck` 0。提交。

---

### Task 5: reducer plannerOutput + step.output(TS, TDD)

**Files:** Modify `transcriptReducer.ts`;Test `transcriptReducerTeam.test.ts`(扩)。

- [ ] **Step 1:** 失败测试:`team.plan.output` 两 delta 累加到 `item.plannerOutput`;`team.step.output` 按 stepId 累加到该步 `output`,两并行步骤乱序到达各归位不串台。

- [ ] **Step 2:** 失败 → 实现:`TeamItem` 加 `plannerOutput?:string`;`TeamStep` 加 `output?:string`。`team.plan.output`→累加 plannerOutput(定位 teamId);`team.step.output`→`updateTeamStep` 累加 `output`(不可变、typeof 守卫)。

- [ ] **Step 3:** `npx vitest run transcriptReducerTeam` + `npm run typecheck` + 全套件绿。提交。

---

### Task 6: TeamCard planner 阶段 + running 步骤实时正文(TS/UI)

**Files:** Modify `TeamCard.tsx`。

- [ ] **Step 1:** 
  - **planner 阶段**:`item.steps.length===0 && item.plannerOutput` → 显示 🧭 planner 流式区(`<pre>` 实时 plannerOutput);steps 到达后此区收敛(隐藏或折叠),显「拆解为 N 步」。
  - **running 步骤**:`TeamStepRow` 中 `step.status==='running' && step.output` → **自动展开**显示 `step.output`(实时,不需点▶);`done` 后按现状显示 `result`(可折叠)。即 running 用 output、done 用 result。
  - 折叠区沿用 `max-h-48 overflow-y-auto` + `<pre whitespace-pre-wrap break-words>`。
- [ ] **Step 2:** `npm run typecheck` 0 + `npm run build` ✓。提交。

---

### Task 7: 端到端 — 重建 jar + 眼验(本人)

- [ ] 仓库根 `mvn -q clean package -DskipTests` → 部署 `~/.wraith/wraith.jar` → 重启 dev App。
- [ ] 眼验:切 Team 发多步任务 → **planner 拆解阶段边出字**、拆完收敛为「拆解为 N 步」→ 每个 worker running 时**正文实时流入并自动展开** → done 后显结果 → 并行步骤各自流不串台。**CLI 抽验**:`/team` 终端跑同任务,行为/结果一致(呈现不同)。
- [ ] 整支终审(opus)→ FF/merge(推送前点头)。

## Self-Review
- Spec 覆盖:CompositeStreamListener+SubAgent seam(T1)、orchestrator 注入(T2)、事件+汇+Main(T3)、类型(T4)、reducer(T5)、TeamCard(T6)、e2e(T7)。
- CLI 一致性:默认无工厂/extra=null 全程贯穿;每 Java reviewer 首要 lens;T2/T7 抽验。
- 类型一致:`TeamPlanOutputEvent`/`TeamStepOutputEvent`(T4)→reducer(T5,plannerOutput/step.output)→TeamCard(T6)。
- 顺序:T1→T2→T3(Java)→T4→T5→T6(TS)→T7。
