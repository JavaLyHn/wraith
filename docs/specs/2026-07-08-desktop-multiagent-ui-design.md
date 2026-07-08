# 设计：Multi-Agent(Team)桌面 UI

日期：2026-07-08
范围：桌面(渲染层新组件 + reducer + ModeSwitcher 加 team 行)+ Java 后端(`AgentOrchestrator` 加事件旁路 + app-server team 分支)。分支 `feat/desktop-multiagent-ui`(off main)。**含 Java → 眼验前重建部署 jar。**

## 问题

Multi-Agent 协作(Team)后端 `AgentOrchestrator` 早已存在并在 CLI 可用(`/team`),但**桌面完全没接**:app-server 只有 ReAct 与 Plan 分支;ModeSwitcher 也只有两行(注释写「Team 待 Spec 2 再加一行」)。本设计把 Team 带上桌面,并以**分角色可视化**呈现协作过程(用户已在 brainstorming 选定方案 B / 并行分组 B1)。

## 现有后端结构(锚点,已核实)

- `AgentOrchestrator`:1 planner + 2 workers(worker-1/worker-2)+ 1 reviewer,均为 `SubAgent`(有 `getName()`)。角色枚举 `AgentRole.{PLANNER,WORKER,REVIEWER}`。
- `run(userInput)` 流程:
  1. **规划**:`planner.execute(...)` → JSON 计划 → `parsePlan` → `List<ExecutionStep>`(`ExecutionStep{id(step_N), description, type, dependencies, result, status}`;`StepStatus.{PENDING,COMPLETED,FAILED}`)。
  2. **执行**:`while` 取 `getExecutableSteps`(按依赖就绪)分批:
     - 单步批次 → `runStep(...)` 串行流式;
     - 多步批次 → `runBatchParallel(...)` 真并行(每步独立 `ByteArrayOutputStream` 缓冲,批次末按 step_id flush)。
  3. **每步内**(`runStep`):worker 执行 → **reviewer 审查**(approve/reject + issues)→ 未过则**重试循环**(≤`MAX_RETRIES_PER_STEP`,带反馈重执行+再审)→ 存 `result`/状态。**审查是每步内嵌的,不是末尾单次。**
  4. `buildFinalResult(steps)` = 终端摘要(`✅ 多 Agent 协作任务完成！\n📋 执行总结：[step_N] ✅ desc\n 结果：<120字预览>`)。
- **自主运行**:构造器无 review handler,无中途 HITL 门(比 Plan 简单)。
- 现状仅接终端(`createTeamAgent` out=terminal),`out.println` 承载所有叙述。桌面未接。
- 参照实现:Plan 上桌面用的 `PlanProgressListener`(NOOP 默认)+ `EventStreamPlanListener` + `plan.*` 通知 + Main plan 分支(out=discard)。本设计同构。

## 目标

1. ModeSwitcher 增第三行 `team`,桌面可选 Multi-Agent 模式发送。
2. 以**分角色时间线**呈现协作:角色状态条(planner/worker-1/worker-2/reviewer)+ 步骤卡(执行角色 + 状态 + 每步审查判定 + 可折叠结果)+ 并行批次缩进分组(B1)+ 页脚总状态。
3. 复用现有 orchestrator,**不改编排逻辑**(仅加事件旁路回调)。
4. CLI 行为字节不变(NOOP 监听器,叙述仍走 out.println)。

## 非目标(YAGNI)

- 不改多 Agent 编排/规划/重试逻辑。
- **不做 per-step token 级流式**(并行路径本就缓冲非实时;v1 结果在步骤完成时填入)。
- **不发底部文字消息**(buildFinalResult 是截断终端摘要,非干净答案;TeamCard 本身即产出)。
- 不加中途 HITL 复审门(orchestrator 自主)。
- 不做真并排分栏(B2);并行用缩进分组(B1)。

## 设计

### §1 后端事件旁路(`TeamProgressListener`)

新增 `com.lyhn.wraith.agent.TeamProgressListener`(NOOP 默认,CLI 用 NOOP → 行为不变):

```
interface TeamProgressListener {
  void started(String goal, List<AgentInfo> agents);        // agents: [{id:"planner",role},{id:"worker-1",role}...]
  void planParsed(List<ExecutionStep> steps);               // planner 拆解完成
  void batchStarted(int batchIndex, List<String> stepIds);  // 仅并行批次(size>1)时发
  void stepStarted(String stepId, String agentName);        // agentName = 执行该步的 worker 名
  void stepCompleted(String stepId, String status, String result, boolean approved, int retries); // status: completed|failed|skipped
  void finished(String status);                             // completed|partial|failed
  TeamProgressListener NOOP = /* 全空实现 */;
}
```

- 注入:`AgentOrchestrator` 加 `setProgressListener(...)`(默认 NOOP)。在 `run`/`runStep`/`runBatchParallel` 的对应节点调用回调(与现有 `out.println` 并存,不替换——CLI 靠 out,桌面靠 listener)。
- 审查判定随 `stepCompleted` 的 `approved`/`retries` 一起给(不单发 review 事件;reviewer 的"活动"由前端在步骤 running 期间点亮即可)。
- `skipped`:因前置失败被跳过的 PENDING 步骤(run() 尾部已识别)。

### §2 桌面事件汇(`EventStreamTeamListener`)+ `team.*` 通知

仿 `EventStreamPlanListener`。`EventStreamRenderer` 加 `emitTeam*` 方法,把上述回调序列化为 JSON-RPC 通知:

- `team.started` `{teamId, goal, agents:[{id,role}]}`
- `team.plan` `{teamId, steps:[{id,description,type,dependencies}]}`
- `team.batch` `{teamId, batchIndex, stepIds:[...]}`
- `team.step.started` `{teamId, stepId, agent}`
- `team.step.completed` `{teamId, stepId, status, result, approved, retries}`
- `team.finished` `{teamId, status}`

`teamId` = 每次 run 一个稳定 id(`team_` + identityHashCode(goal),与 plan 一致)。**并行安全**:所有 step 事件带 `stepId`,前端按 stepId 归位(吸取 plan thinking 未 scope 的教训)。

### §3 Main.java team 分支

`AppServer` handleTurn 的 mode 分派加 `team`(现有仅 react/plan)。仿 plan 匿名 runner:
- `out = discard`;
- `new AgentOrchestrator(client, toolRegistry, memoryManager, discard)` + `setProgressListener(new EventStreamTeamListener(renderer, teamId))` + `setExternalContextSupplier` + skill 装配(与 plan 对齐);
- `snap.runTurn("team", goal, () -> orchestrator.run(goal))`;
- **不发底部消息**(TeamCard 即产出);runTurn 返回值 handleTurn 照常忽略。

### §4 前端

**`shared/types.ts`**:上述 6 个 team 事件 payload 接口。

**`shared/transcriptReducer.ts`**:新增 `team` item:
```
{ type:'team', teamId, goal,
  agents: {id,role}[],
  steps: { id, description, type, agent?, status:'pending'|'running'|'done'|'failed'|'skipped', result?, approved?, retries? }[],
  parallelStepIds: Set<string>|string[],   // 属于并行批次的 step(用于 B1 分组)
  status?: 'completed'|'partial'|'failed' }
```
- `team.started` → 新 item;`team.plan` → 填 steps(status=pending);`team.batch` → 标记这些 stepId 为并行;`team.step.started` → 该步 running + agent;`team.step.completed` → status/result/approved/retries;`team.finished` → item.status。
- 归约纯函数,按 teamId + stepId 精确定位(不污染其他步骤)。

**`renderer/components/TeamCard.tsx`**(新):
- **头部**:`团队协作 · <goal>` + 角色状态条:🧭 Planner · 🔧 worker-1 · 🔧 worker-2 · 🔎 Reviewer;每个带状态点(灰待命/黄运行/绿完成),**角色配色**(planner/worker/reviewer 各一色)。reviewer 在任一步 running 时点亮。
- **规划行**:🧭「拆解为 N 步」。
- **步骤时间线**:按 steps 顺序渲染;连续的并行 step(在 `parallelStepIds` 且相邻同批)用「⚡ 并行执行」标头缩进括起(B1)。每步卡:执行角色徽标(配色)+ 状态图标 + 描述 + 审查判定小标(✅通过 / 🔁重试N次后通过 / ⚠️超限保留 / ❌失败)+ 可折叠「输出」(step.result)。
- **页脚**:总状态徽标(✅ 完成 / ⚠️ 部分完成 / ❌ 失败),据 item.status。
- 组件 `): JSX.Element`;折叠区 `max-h-48 overflow-y-auto`(仿 PlanCard,防撑高);每步 expanded 各自 state(提取 `TeamStepRow`)。

**`renderer/components/ModeSwitcher.tsx`**:MODES 加第三行 `{ id:'team', icon:'🤝', label:'Team', desc:'多 Agent 协作 · 规划-并行执行-复查' }`。`RunMode` 类型加 `'team'`。
> 注:chevron 对齐修复在并行分支 `fix/mode-chevron-align`(改触发器箭头);本任务**只加 MODES 行 + 类型**,不碰触发器箭头,两分支合并时不冲突。

**`renderer/components/Transcript.tsx`**:`item.type==='team'` → `<TeamCard>`(key=teamId)。

**`RunMode`**:`shared/types.ts` 的 `RunMode` 增 `'team'`;submitTurn 已透传 mode,无需改管道。

### §5 测试 / 门禁

- **vitest(纯逻辑)**:
  - transcriptReducer team 归约:started→plan→batch→step.started→step.completed→finished 全序列后 item 形态正确;并行 stepId 标记;乱序/并行 step 事件按 stepId 归位不串台;审查字段(approved/retries)落位。
  - 并行分组辅助(若抽纯函数):相邻同批 step 归为一组,非并行独立。
- **Java**:`TeamProgressListener` 回调序列被 orchestrator 正确触发(用 stub SubAgent/planner 或轻量 orchestrator 测试,仿 `PlanProgressWiringTest`);`EventStreamTeamListener`→通知 JSON 形状(仿 `EventStreamPlanListenerTest`)。CLI NOOP 路径行为不变(现有 orchestrator 测试保持绿)。
- **UI**:TeamCard / ModeSwitcher 靠 typecheck + build + 眼验(无 RTL)。
- **门禁**:桌面 typecheck 0 + vitest 全绿 + build;Java 针对性 0F/0E + `mvn clean test-compile`。**含 Java → 重建部署 jar + 眼验**(切 Team 发多步任务:角色条点亮、步骤按批次点亮/填结果、并行组缩进、每步审查判定、页脚状态)。

## 风险

- **orchestrator 回调注入面**:`run`/`runStep`/`runBatchParallel` 需在多处插回调,注意并行线程里调用 listener 的**线程安全**(`EventStreamRenderer`/writer 需能并发 notify;若非线程安全,在并行批次内对 listener 调用加同步,或让 writer 串行化)。这是本设计最需谨慎处——实现时确认 writer 并发安全,否则并行 step 事件交织可能坏帧。
- **CLI 不回归**:NOOP 监听器 + out 叙述保留;靠现有 orchestrator 测试 + 针对性 wiring 测试锁定。
- **无底部消息的可读性**:用户读结果靠展开步骤卡;若眼验觉得需要一个"总结",可后续加(YAGNI 先不做)。
- **ModeSwitcher 双分支**:与 chevron 修复分支并行改同文件不同区域;合并顺序无关,ort 三方合并应自动完成(本会话已多次验证)。

## 交付链路

`feat/desktop-multiagent-ui` → 实现(TDD:reducer/并行分组纯逻辑先行;TeamProgressListener + EventStreamTeamListener + orchestrator 回调;Main team 分支;TeamCard/ModeSwitcher/Transcript 接线)→ 桌面三门 + Java 针对性全绿 → 重建部署 jar → 眼验 → FF/merge(推送前点头)。

## 安全

无新增密钥面(复用现有 provider/key 路径,key 仍只在 `~/.wraith/config.json`)。不新增网络端点。事件仅承载 goal/步骤描述/结果文本(与 plan 同类),不含凭证。每次提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。
