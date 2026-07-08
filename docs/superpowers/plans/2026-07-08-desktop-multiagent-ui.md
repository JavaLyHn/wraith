# Multi-Agent(Team)桌面 UI 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已有的 Multi-Agent 协作后端(`AgentOrchestrator`)带上桌面,以分角色可视化(方案 B / 并行缩进分组 B1)呈现规划-并行执行-每步审查的协作过程。

**Architecture:** 复用现有 `AgentOrchestrator`(不改编排逻辑),加 `TeamProgressListener` 事件旁路(NOOP 默认 → CLI 字节不变);桌面注入 `EventStreamTeamListener` 发 `team.*` JSON-RPC 通知;app-server 加 team 分支(out=discard);渲染层 reducer + `TeamCard` + ModeSwitcher team 行呈现。

**Tech Stack:** Java 17(pkg `com.lyhn.wraith`)、Electron/React/TS、vitest。

## Global Constraints

- **CLI 一致性(最高约束)**:桌面 Team 必须与 CLI Team **行为完全一致**——同一个 `AgentOrchestrator`,同样的规划/执行/审查/重试/结果。差别**仅在呈现**:CLI 走 `out.println`(NOOP 监听器),桌面走 `team.*` 事件(注入监听器,out=discard)。**回调只能"新增"、绝不替换或改动任何既有 `out.println`/编排逻辑**。CLI 路径用 `TeamProgressListener.NOOP`,行为字节不变。
- **并行线程安全**:`stepStarted/stepCompleted` 会从 `runBatchParallel` 的多个 worker 线程并发触发。`EventStreamTeamListener`/`EventStreamRenderer.emitTeam*` 的 `writer.notify` 必须并发安全(确认底层 writer 是否 synchronized;若否,在 emit 处对 writer 加锁串行化)。并行 step 事件交织但各带 `stepId`,前端按 stepId 归位。
- **不发底部文字消息**:`buildFinalResult` 是终端摘要;桌面 team 分支**不**把 run() 返回值发成 message。TeamCard 即产出,页脚给总状态。
- **v1 不做 per-step token 流**:结果随 `stepCompleted` 一次给入。
- 组件返回 `): JSX.Element`;纯逻辑 vitest,UI 靠 typecheck+build+眼验(无 RTL)。
- 提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。
- 含 Java → 收尾重建部署 jar(`mvn -q clean package -DskipTests` → `~/.wraith/wraith.jar`)。

## 已核实事实(实现直接用)

- `AgentOrchestrator`:planner + workers(worker-1/worker-2)+ reviewer;`SubAgent.getName()` 返回名字。`AgentRole.{PLANNER,WORKER,REVIEWER}`。
- `ExecutionStep{ id(step_N), description, type, dependencies(List<String>), result, status }`;`StepStatus.{PENDING,COMPLETED,FAILED}`。
- `run()` 关键行:top(138)、`planResult` 解析后(165)、执行 while(179)、单步 `runStep`(195)、并行分支 `out.println("⚡ 批次...")`(199)+`runBatchParallel`(201)、PENDING 跳过循环(206-210)、`buildFinalResult`(213)、`return finalResult`(216)。
- `runStep(step, steps, retryCount, worker, reviewer, context, out)`:终端点——取消(487/495)、error(501)、空(506)、审查通过(526)、reviewer 出错保留(518)、重试后(572-577)。`worker.getName()` 可作 agent 名。
- `runBatchParallel`:线程池并行,每步 `runStep(..., stepOut)`;`updateStep` 已被并行线程调用(既有)。
- 参照:`PlanProgressListener`/`EventStreamPlanListener`/`PlanProgressWiringTest`/`EventStreamPlanListenerTest`、Main.java plan 分支(~1441-1513)、`PlanCard.tsx`、reducer plan 部分。
- **注**:ModeSwitcher 触发器箭头修复在并行分支 `fix/mode-chevron-align`;本计划 Task 7 只加 MODES team 行 + RunMode 类型,**不碰触发器箭头**,合并不冲突。

---

### Task 1: `TeamProgressListener` + `AgentOrchestrator` 回调旁路(Java)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/agent/TeamProgressListener.java`
- Modify: `src/main/java/com/lyhn/wraith/agent/AgentOrchestrator.java`
- Test: `src/test/java/com/lyhn/wraith/agent/TeamProgressWiringTest.java`

**Interfaces (Produces):** `TeamProgressListener`(下方)、`AgentOrchestrator.setProgressListener(...)`。

- [ ] **Step 1: 写接口**(完整代码)

```java
package com.lyhn.wraith.agent;

import com.lyhn.wraith.plan.ExecutionStep; // 若 ExecutionStep 是 AgentOrchestrator 内部 record,则改用 orchestrator 暴露的只读视图；见 Step 3 说明
import java.util.List;

/**
 * Multi-Agent 协作生命周期监听器(加法式旁路)。
 * AgentOrchestrator 在关键节点回调;默认 NOOP 保持 CLI 行为不变(叙述仍走 out.println)。
 * 注意:stepStarted/stepCompleted 可能从并行 worker 线程并发触发,实现方需并发安全。
 */
public interface TeamProgressListener {
    record AgentInfo(String id, String role) {}
    /** 步骤只读视图(供事件序列化,避免泄露内部可变 record)。 */
    record StepInfo(String id, String description, String type, List<String> dependencies) {}

    void started(String goal, List<AgentInfo> agents);
    void planParsed(List<StepInfo> steps);
    void batchStarted(int batchIndex, List<String> stepIds);
    void stepStarted(String stepId, String agentName);
    /** status: "completed" | "failed" | "skipped"。approved/retries 为审查结果(skipped/failed 时 approved=false, retries=0)。 */
    void stepCompleted(String stepId, String status, String result, boolean approved, int retries);
    void finished(String status); // "completed" | "partial" | "failed"

    TeamProgressListener NOOP = new TeamProgressListener() {
        @Override public void started(String goal, List<AgentInfo> agents) {}
        @Override public void planParsed(List<StepInfo> steps) {}
        @Override public void batchStarted(int batchIndex, List<String> stepIds) {}
        @Override public void stepStarted(String stepId, String agentName) {}
        @Override public void stepCompleted(String stepId, String status, String result, boolean approved, int retries) {}
        @Override public void finished(String status) {}
    };
}
```
> `ExecutionStep` 是 `AgentOrchestrator` 内部 record;**不要**在接口里引用它。用上面的 `StepInfo` 只读投影。planParsed 时由 orchestrator 把 `ExecutionStep` 映射成 `StepInfo`。

- [ ] **Step 2: orchestrator 加字段 + setter**

在 `AgentOrchestrator` 字段区加:
```java
private TeamProgressListener progressListener = TeamProgressListener.NOOP;
public void setProgressListener(TeamProgressListener l) { this.progressListener = (l != null) ? l : TeamProgressListener.NOOP; }
```

- [ ] **Step 3: 在 run() 插回调(新增行,不动既有 out.println)**

- `run()` 顶部(userInput 记忆后、规划前)：
```java
progressListener.started(userInput, List.of(
    new TeamProgressListener.AgentInfo("planner", "planner"),
    new TeamProgressListener.AgentInfo("worker-1", "worker"),
    new TeamProgressListener.AgentInfo("worker-2", "worker"),
    new TeamProgressListener.AgentInfo("reviewer", "reviewer")));
```
- `parsePlan` 成功、`steps` 非空后(约 168 行后)：
```java
progressListener.planParsed(steps.stream()
    .map(s -> new TeamProgressListener.StepInfo(s.id(), s.description(), s.type(), s.dependencies()))
    .toList());
```
- 并行分支(`else`,`out.println("⚡ 批次...")` 之后、`runBatchParallel` 之前)：
```java
progressListener.batchStarted(batchIndex, executable.stream().map(ExecutionStep::id).toList());
```
- PENDING 跳过循环(206-210)里,`out.println("⏭️ ...")` 旁新增：
```java
progressListener.stepCompleted(step.id(), "skipped", "", false, 0);
```
- `return finalResult` 前(213-216)：
```java
boolean allCompleted = steps.stream().allMatch(s -> s.status() == StepStatus.COMPLETED);
boolean anyFailed = steps.stream().anyMatch(s -> s.status() == StepStatus.FAILED);
progressListener.finished(allCompleted ? "completed" : anyFailed ? "failed" : "partial");
```

- [ ] **Step 4: 在 runStep() 插回调**

- 方法体最上方(`out.println("🛠️ ...")` 旁)：`progressListener.stepStarted(step.id(), worker.getName());`
- 每个**终端点**发一次 `stepCompleted`(状态/审查随该分支)。为避免遗漏多返回点,推荐:在方法末尾用一个 helper 统一发,或在每个 `return` 前补。各终端点取值:
  - 取消(487/495):`stepCompleted(id, "failed", "用户取消", false, 0)`
  - error(501):`stepCompleted(id, "failed", result.content(), false, 0)`
  - 空(506):`stepCompleted(id, "failed", "执行结果为空", false, 0)`
  - reviewer 出错保留(518):`stepCompleted(id, "completed", result.content(), false, retryCount.getOrDefault(step.id(),0))`
  - 首审通过(526):`stepCompleted(id, "completed", acceptedResult, true, 0)`
  - 重试后(572-577):`stepCompleted(id, approved ? "completed":"completed", acceptedResult, approved, retries)`(注:超限也保留结果,status 仍 completed 但 approved=false)
> **CLI 一致性铁律**:上述均为**新增**;所有既有 `out.println`、`updateStep`、审查/重试逻辑**一字不动**。

- [ ] **Step 5: 写 wiring 测试**(`TeamProgressWiringTest`,仿 `PlanProgressWiringTest`)

用一个捕获型 `TeamProgressListener`(把回调记进 List),stub 一个最小可跑的 orchestrator 路径(参考 `PlanProgressWiringTest` / `PlanExecuteAgentTest` 的 stub 手法:StubGLMClient 预设 planner JSON 计划 + worker/ reviewer 响应),断言回调序列:`started` → `planParsed(非空)` → `stepStarted` → `stepCompleted(completed, approved=true)` → `finished("completed")`。若并行 stub 复杂,单步串行场景即可覆盖回调契约。

- [ ] **Step 6: 运行 + 提交**

Run: `mvn -DskipTests=false -Dtest='TeamProgressWiringTest' test`,预期 0F/0E;并跑一条既有 orchestrator 测试确认 CLI 未回归(如有 `AgentOrchestratorTest` 则一并跑)。
```bash
git add src/main/java/com/lyhn/wraith/agent/TeamProgressListener.java src/main/java/com/lyhn/wraith/agent/AgentOrchestrator.java src/test/java/com/lyhn/wraith/agent/TeamProgressWiringTest.java
git commit -m "feat(agent): AgentOrchestrator 加 TeamProgressListener 事件旁路(NOOP 默认,CLI 不变)"
```

---

### Task 2: `EventStreamTeamListener` + `EventStreamRenderer.emitTeam*`(Java)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamTeamListener.java`
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamTeamListenerTest.java`

**Interfaces (Consumes):** Task 1 `TeamProgressListener`。**Produces:** `team.*` 通知。

- [ ] **Step 1: EventStreamRenderer 加 emitTeam\*(参照现有 emitPlan\*)**

方法(用现有 `base()` 构造 params、`writer.notify(method, p)`):
```java
public void emitTeamStarted(String teamId, String goal, List<Map<String,Object>> agents)
public void emitTeamPlan(String teamId, List<Map<String,Object>> steps)
public void emitTeamBatch(String teamId, int batchIndex, List<String> stepIds)
public void emitTeamStepStarted(String teamId, String stepId, String agent)
public void emitTeamStepCompleted(String teamId, String stepId, String status, String result, boolean approved, int retries)
public void emitTeamFinished(String teamId, String status)
```
方法名 → 通知 method:`team.started`/`team.plan`/`team.batch`/`team.step.started`/`team.step.completed`/`team.finished`。
> **并发**:确认 `writer.notify` 线程安全。若 `JsonRpcWriter`(或等价)未 synchronized,则在 `EventStreamRenderer` 的 emitTeam* 方法上 `synchronized`(同一 writer 锁)——因为并行 step 事件会并发进来。实现时先查 writer,必要时加锁,并在报告中写明结论。

- [ ] **Step 2: EventStreamTeamListener(完整,实现 TeamProgressListener)**

```java
package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.agent.TeamProgressListener;
import java.util.List;
import java.util.Map;

/** 把 Team 生命周期回调导向 team.* 通知(桌面 sink)。 */
public final class EventStreamTeamListener implements TeamProgressListener {
    private final EventStreamRenderer renderer;
    private final String teamId;
    public EventStreamTeamListener(EventStreamRenderer renderer, String teamId) {
        this.renderer = renderer; this.teamId = teamId;
    }
    @Override public void started(String goal, List<AgentInfo> agents) {
        renderer.emitTeamStarted(teamId, goal,
            agents.stream().map(a -> Map.<String,Object>of("id", a.id(), "role", a.role())).toList());
    }
    @Override public void planParsed(List<StepInfo> steps) {
        renderer.emitTeamPlan(teamId, steps.stream().map(s -> Map.<String,Object>of(
            "id", s.id(), "description", s.description(), "type", s.type(),
            "dependencies", s.dependencies() == null ? List.of() : s.dependencies())).toList());
    }
    @Override public void batchStarted(int batchIndex, List<String> stepIds) {
        renderer.emitTeamBatch(teamId, batchIndex, stepIds);
    }
    @Override public void stepStarted(String stepId, String agentName) {
        renderer.emitTeamStepStarted(teamId, stepId, agentName);
    }
    @Override public void stepCompleted(String stepId, String status, String result, boolean approved, int retries) {
        renderer.emitTeamStepCompleted(teamId, stepId, status, result == null ? "" : result, approved, retries);
    }
    @Override public void finished(String status) { renderer.emitTeamFinished(teamId, status); }
}
```

- [ ] **Step 3: 测试 + 提交**(仿 `EventStreamPlanListenerTest`:驱动各回调,`findNotification("team.*")` 断言 method + params 关键字段)

Run: `mvn -DskipTests=false -Dtest='EventStreamTeamListenerTest' test`(0F/0E)。
```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamTeamListener.java src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamTeamListenerTest.java
git commit -m "feat(appserver): EventStreamTeamListener + emitTeam* → team.* 通知(并发安全)"
```

---

### Task 3: app-server team 分支(Java, Main.java)

**Files:** Modify `src/main/java/com/lyhn/wraith/cli/Main.java`(handleTurn mode 分派)。

- [ ] **Step 1: 加 team 分支**(仿 plan 分支 ~1441-1513,置于 plan 分支旁)

要点(**与 CLI createTeamAgent 一致的装配**,只换 out + 加 listener):
```java
// mode == "team"
com.lyhn.wraith.io.NullPrintStream discard = /* 复用 plan 分支同款 discard */;
String teamId = "team_" + System.identityHashCode(goal);
var renderer = /* 复用该 runner 的 EventStreamRenderer 实例 */;
com.lyhn.wraith.agent.AgentOrchestrator orchestrator =
    new com.lyhn.wraith.agent.AgentOrchestrator(currentClient[0], agent.getToolRegistry(), agent.getMemoryManager(), discard);
orchestrator.setProgressListener(new com.lyhn.wraith.runtime.appserver.EventStreamTeamListener(renderer, teamId));
orchestrator.setExternalContextSupplier(() -> { var mgr = appServerMcp.manager(); return mgr != null ? mgr.resourceIndexForPrompt() : ""; });
orchestrator.setSkillSystem(skillRegistry, skillContextBuffer); // 与 CLI 一致的 skill 装配
var snap = agent.getToolRegistry().getSnapshotService();
String result = snap.runTurn("team", goal, () -> orchestrator.run(goal));
// 不发底部消息(TeamCard 即产出);handleTurn 忽略返回值
return result;
```
> 确认 `AgentOrchestrator.setSkillSystem` 签名与 CLI 用法一致;discard/renderer 变量名对齐该 runner 内 plan 分支已有的。

- [ ] **Step 2: 验证 + 提交**

Run: `mvn -q clean test-compile`(编译通过)。
```bash
git add src/main/java/com/lyhn/wraith/cli/Main.java
git commit -m "feat(appserver): handleTurn 加 team 分支(orchestrator + 事件流,out=discard)"
```

---

### Task 4: 前端类型 + RunMode 'team'(TS)

**Files:** Modify `desktop/src/shared/types.ts`。

- [ ] **Step 1: 加类型 + RunMode**

```ts
export type RunMode = 'react' | 'plan' | 'team'   // 现有基础上加 'team'

export interface TeamStartedEvent { teamId: string; goal: string; agents: { id: string; role: string }[] }
export interface TeamStepView { id: string; description: string; type: string; dependencies: string[] }
export interface TeamPlanEvent { teamId: string; steps: TeamStepView[] }
export interface TeamBatchEvent { teamId: string; batchIndex: number; stepIds: string[] }
export interface TeamStepStartedEvent { teamId: string; stepId: string; agent: string }
export interface TeamStepCompletedEvent { teamId: string; stepId: string; status: string; result: string; approved: boolean; retries: number }
export interface TeamFinishedEvent { teamId: string; status: string }
```

- [ ] **Step 2: 验证 + 提交** — `cd desktop && npm run typecheck`(0);`git commit -m "feat(desktop): team 事件类型 + RunMode 'team'"`。

---

### Task 5: reducer team item + 归约(TS, TDD)

**Files:** Modify `desktop/src/shared/transcriptReducer.ts`;Test `desktop/test/transcriptReducerTeam.test.ts`。

**Interfaces (Produces):** `TeamItem`(下)。

- [ ] **Step 1: 写失败测试**(覆盖:全序列后形态;并行 stepId 标记;两个并行 step 的 completed 乱序到达各自归位不串台;审查字段落位)

```ts
import { describe, it, expect } from 'vitest'
import { transcriptReducer, initialState } from '../src/shared/transcriptReducer'

const ev = (method: string, params: any) => ({ kind: 'notification' as const, method, params })
function run(events: {method:string;params:any}[]) {
  return events.reduce((s, e) => transcriptReducer(s, e), initialState())
}

describe('team 归约', () => {
  it('started→plan→batch→step 全序列形态正确', () => {
    const s = run([
      ev('team.started', { teamId:'t1', goal:'G', agents:[{id:'planner',role:'planner'},{id:'worker-1',role:'worker'}] }),
      ev('team.plan', { teamId:'t1', steps:[{id:'step_1',description:'A',type:'COMMAND',dependencies:[]},{id:'step_2',description:'B',type:'COMMAND',dependencies:[]}] }),
      ev('team.batch', { teamId:'t1', batchIndex:1, stepIds:['step_1','step_2'] }),
      ev('team.step.started', { teamId:'t1', stepId:'step_1', agent:'worker-1' }),
      ev('team.step.completed', { teamId:'t1', stepId:'step_1', status:'completed', result:'RA', approved:true, retries:0 }),
      ev('team.finished', { teamId:'t1', status:'partial' }),
    ])
    const item: any = s.items.find(i => i.type === 'team')
    expect(item.goal).toBe('G')
    expect(item.steps.map((x:any)=>x.id)).toEqual(['step_1','step_2'])
    expect(item.steps[0]).toMatchObject({ agent:'worker-1', status:'done', result:'RA', approved:true })
    expect(item.steps[1].status).toBe('pending')
    expect(item.parallelStepIds).toEqual(expect.arrayContaining(['step_1','step_2']))
    expect(item.status).toBe('partial')
  })

  it('两并行 step 的 completed 乱序到达各自归位', () => {
    const s = run([
      ev('team.started', { teamId:'t1', goal:'G', agents:[] }),
      ev('team.plan', { teamId:'t1', steps:[{id:'step_1',description:'A',type:'X',dependencies:[]},{id:'step_2',description:'B',type:'X',dependencies:[]}] }),
      ev('team.step.completed', { teamId:'t1', stepId:'step_2', status:'completed', result:'R2', approved:true, retries:1 }),
      ev('team.step.completed', { teamId:'t1', stepId:'step_1', status:'failed', result:'E1', approved:false, retries:0 }),
    ])
    const item: any = s.items.find(i => i.type === 'team')
    expect(item.steps.find((x:any)=>x.id==='step_2')).toMatchObject({ status:'done', result:'R2', retries:1 })
    expect(item.steps.find((x:any)=>x.id==='step_1')).toMatchObject({ status:'failed', result:'E1' })
  })
})
```

- [ ] **Step 2: 运行验证失败** — `npx vitest run transcriptReducerTeam`(FAIL:team 未处理)。

- [ ] **Step 3: 实现**(在 reducer 加 TeamItem 类型 + team.* case)

`TeamItem`:
```ts
export interface TeamStep { id: string; description: string; type: string; agent?: string
  status: 'pending'|'running'|'done'|'failed'|'skipped'; result?: string; approved?: boolean; retries?: number }
export interface TeamItem { type: 'team'; teamId: string; goal: string
  agents: { id: string; role: string }[]; steps: TeamStep[]; parallelStepIds: string[]
  status?: 'completed'|'partial'|'failed' }
```
- `team.started` → push team item(steps=[], parallelStepIds=[])。
- `team.plan` → 定位 teamId item,steps = 映射(status:'pending')。
- `team.batch` → 把 stepIds 并入 parallelStepIds(去重)。
- `team.step.started` → 该 step status='running', agent=agent。
- `team.step.completed` → 该 step status = (status==='failed'?'failed':status==='skipped'?'skipped':'done'), result/approved/retries 落位。
- `team.finished` → item.status。
- 全部按 teamId + stepId 精确定位;不可变更新(map 返回新对象);未知 step 忽略;`p['x']` 用 `typeof` 守卫取值(仿现有 plan case)。

- [ ] **Step 4: 运行验证通过** — `npx vitest run transcriptReducerTeam && npm run typecheck`(全绿)。

- [ ] **Step 5: 提交** — `git commit -m "feat(desktop): reducer 处理 team.* → TeamItem"`。

---

### Task 6: `TeamCard.tsx`(TS/UI)

**Files:** Create `desktop/src/renderer/components/TeamCard.tsx`。

**Interfaces (Consumes):** Task 5 `TeamItem`/`TeamStep`;`planStatus` 风格可参考。

- [ ] **Step 1: 组件**(要点,完整实现;结构仿 PlanCard,配色区分角色)

- 顶层 `<div className="my-1.5 rounded-lg border border-border bg-surface p-3 text-xs font-mono">`。
- 头部:`团队协作 · {goal}` + 角色状态条:遍历 `item.agents`,每个 chip = 图标(planner 🧭 / worker 🔧 / reviewer 🔎)+ 名字 + 状态点。状态点颜色:reviewer 在"有任一 step running"时黄;planner 恒绿(规划已完成);worker-N 在"它执行的 step running"时黄、否则灰/绿。
- 规划行:`🧭 拆解为 {steps.length} 步`。
- 步骤时间线:遍历 steps,**B1 并行分组**——连续且都在 `parallelStepIds` 的 step 用一个「⚡ 并行执行」缩进容器(`ml-3 border-l pl-2`)括起;非并行 step 独立渲染。抽 `TeamStepRow`(各自 `useState(false)` 控展开):
  - 行:角色徽标(agent 名,配色)+ 状态图标(pending ○ / running ◐ / done ✓ / failed ✗ / skipped ⏭)+ 描述 + 审查小标(approved 且 retries=0 → `✅审查通过`;approved 且 retries>0 → `🔁重试{retries}次后通过`;!approved 且 status=done → `⚠️保留`;failed → 无)+ 若有 result 的「▶ 输出」按钮。
  - 展开区:`ml-5 mt-0.5 max-h-48 overflow-y-auto rounded border ...` + `<pre className="whitespace-pre-wrap break-words text-xs">{step.result}</pre>`。
- 页脚:据 `item.status` — `✅ 协作完成` / `⚠️ 部分完成` / `❌ 有失败`,配边框色(绿/琥珀/红)。
> 复用/参考 `planStatusIcon`/`planStatusClass` 思路,但 team 有 5 态,可在组件内定义映射。

- [ ] **Step 2: 验证 + 提交** — `npm run typecheck && npm run build`(0/✓);`git commit -m "feat(desktop): TeamCard 分角色协作可视化(B1 并行分组)"`。

---

### Task 7: ModeSwitcher team 行 + Transcript 分发(TS/UI)

**Files:** Modify `desktop/src/renderer/components/ModeSwitcher.tsx`、`desktop/src/renderer/components/Transcript.tsx`。

- [ ] **Step 1: ModeSwitcher** — MODES 数组加第三行:
```ts
{ id: 'team', icon: '🤝', label: 'Team', desc: '多 Agent 协作 · 规划-并行执行-复查' },
```
> 只加这一行(RunMode 'team' 已在 Task 4)。**不要**改触发器箭头那段(chevron 修复在别的分支)。

- [ ] **Step 2: Transcript** — import `TeamCard`;在 item 分发里加:
```tsx
if (item.type === 'team') {
  return <TeamCard key={item.teamId} item={item} />
}
```

- [ ] **Step 3: 验证 + 提交** — `npm run typecheck && npx vitest run && npm run build`(全绿);`git commit -m "feat(desktop): ModeSwitcher 加 Team 行 + Transcript 分发 TeamCard"`。

---

### Task 8: 端到端 — 重建 jar + 眼验(验证任务)

- [ ] **Step 1:** 仓库根 `mvn -q clean package -DskipTests` → `cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar`。
- [ ] **Step 2:** 重启桌面 App(java sidecar 重载新 jar)。
- [ ] **Step 3 眼验:** 切 **Team** 模式,发一个能拆多步/含并行的任务:
  - 角色状态条出现(planner/worker-1/worker-2/reviewer),运行时对应点亮。
  - 「拆解为 N 步」+ 步骤按批次点亮(running→done),结果填入(可展开)。
  - **并行批次**以「⚡ 并行执行」缩进组呈现。
  - 每步审查小标正确(通过/重试后通过/保留);失败步骤 ✗。
  - 页脚总状态徽标正确。
  - **CLI 一致性抽验**:同一任务在 CLI `/team` 跑,步骤拆解/结果与桌面一致(呈现不同、内容一致)。
- [ ] **Step 4:** 眼验 OK → 交付(FF/merge 前点头)。

---

## Self-Review

- **Spec 覆盖**:TeamProgressListener+回调(T1)、事件汇+通知(T2)、team 分支(T3)、类型/RunMode(T4)、reducer(T5)、TeamCard(T6)、ModeSwitcher/Transcript(T7)、重建 jar+眼验(T8)——spec 各节均有任务。
- **CLI 一致性**:T1 铁律(回调只增不改 out.println/编排)+ NOOP 默认 + T8 抽验;每个 Java 任务的 reviewer 都以此为首要 lens。
- **并行安全**:T2 Step1 明确 writer 并发确认/加锁。
- **类型一致**:`TeamItem`/`TeamStep`(T5)被 TeamCard(T6)消费;team 事件类型(T4)被 reducer(T5)消费;`RunMode 'team'`(T4)被 ModeSwitcher(T7)用。
- **占位符**:无 TBD;Java 改既有大方法用"锚点+新增行"而非重写(避免误伤 CLI 逻辑)。
- **顺序**:Java 后端(T1→T2→T3)先行,前端(T4→T5→T6→T7)其后,T8 e2e。
