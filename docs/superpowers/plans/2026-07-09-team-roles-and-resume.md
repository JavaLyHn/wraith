# Team 角色全可视 + plan/team 会话 resume 重建卡片 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让 Team 卡片三角色(planner/worker/reviewer)全部可视,并让 plan/team 会话在 resume 时用录制的事件流即时重建卡片。

**Architecture:** planner 已在流(`team.plan.output`),前端补常驻行;reviewer 经 `SubAgent.review` 每调用可选 StreamListener 流式 → 新事件 `team.review.output`。resume:`EventStreamRenderer` 录制 `^(plan|team)\.` 卡片事件(排除 `plan.review.requested`/`message.*`)、合流后写旁车 `<sessionId>.cards.jsonl`;resume 时 RPC 返回 `cards`,前端用现有 reducer 无延迟回放重建 `PlanItem`/`TeamItem`,按 `turnOrdinal` 拼回。

**Tech Stack:** Java 17(pkg `com.lyhn.wraith`,Maven)、Electron/React/TS、vitest、JUnit5。

## Global Constraints

- **CLI 一致性(最高)**:reviewer 流式注入、事件录制、旁车持久化**只在桌面 plan/team 分支**开启;CLI 路径 `extra=null`、不录制、不写旁车 → 终端行为**字节不变**。`AgentOrchestratorTest` 全绿锁定。
- 不改编排/规划/审查/重试逻辑本身;既有 `out.println`/`execute`/`review` 行为不动,只加重载与旁路。
- 组件签名 `): JSX.Element`;纯逻辑走 vitest,UI 靠 typecheck+build+眼验。
- Java 测试需 `-DskipTests=false`;`~4F/38E` 是 JDK/Mockito 既有噪声,非本改动。
- 提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。含 Java → 收尾重建部署 `~/.wraith/wraith.jar` + 眼验。
- commit trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。

## 已核实锚点

- `SubAgent`:`execute(task, out, StreamListener extra)`(:188)已在;`review(orig, result, out)`(:~305)→ 组 reviewTask → `execute(reviewTask, out)`;`SubAgentStreamRenderer implements LlmClient.StreamListener`;`CompositeStreamListener`(`llm` 包)已在。
- `AgentOrchestrator`:`streamFor(kind,id)`(:59)、`runStep`(:~519,内 `reviewer.review(...)`)、重试处(:~582)。`buildFinalResult(steps, labeled)` + `getLastCleanResult()`(本分支已加)。
- `EventStreamTeamStreamListener.onContentDelta`(:37):planner/else 两路由。
- `EventStreamRenderer`:emit 方法用 `writer.notify(method, params)`;plan 事件 `plan.created/plan.step.started/plan.step.completed/plan.step.output/plan.review.requested`;team 事件 `team.started/plan/batch/step.started/step.completed/finished/plan.output/step.output`;`writer.notify` 已 synchronized。
- `SessionStore`:JSONL/会话(`persist`/`resume`/`deleteById`/`rename`);`~/.wraith/sessions/<hash>/<id>.jsonl`。
- `AppServer.handleSessionResume`(:715):返回 `{sessionId, messages, provider, model}`。
- `Main.java`:team 分支(:1453)、plan 分支(:1499+)、`persistTurn`(:1244 `sessionStore.persist(agent.getConversationHistory()); return sessionStore.currentId();`)。
- 前端:`transcriptReducer`(`initialState`:129、`freshState()`:680、`reduce(state,evt)`:207、`Item` 联合:85、`PlanItem`:41/`TeamItem`:73、`team.*` cases、`updateTeamStep`)、`TeamCard.tsx`、`messagesToItems.ts`、`App.tsx` resume(:~259 `resumeSession` → `messagesToItems` → `loadHistory`)、`preload/index.ts`(:32/:160 `resumeSession` 返回类型)、`main/index.ts`(`wraith:resumeSession` handler)。

---

## Part 2 — reviewer 流式（Java + TS）

### Task 1: SubAgent.review 每调用可选 StreamListener（Java, TDD）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/agent/SubAgent.java`
- Test: `src/test/java/com/lyhn/wraith/agent/SubAgentReviewStreamTest.java`（Create）

**Interfaces:**
- Consumes: `CompositeStreamListener(List<LlmClient.StreamListener>)`、`SubAgent.execute(task, out, extra)`（已存在）。
- Produces: `SubAgent.review(AgentMessage original, AgentMessage result, PrintStream out, LlmClient.StreamListener extra)`；旧 `review(original, result, out)` 委托 `extra=null`。

- [ ] **Step 1: 读现状**。`grep -n "public AgentMessage review" src/main/java/com/lyhn/wraith/agent/SubAgent.java` 确认现签名与 body(组 reviewTask → `execute(reviewTask, out)`)。

- [ ] **Step 2: 写失败测试** `SubAgentReviewStreamTest`：用一个 stub `LlmClient`（`chat` 回一段内容并对传入的 `StreamListener` 调 `onContentDelta("片段")`）构造 `SubAgent`；一个捕获型 `StreamListener extra`；调 `review(orig, result, discard, extra)`，断言 `extra` 收到了 `onContentDelta` 片段。再断言 `review(orig, result, discard)`（无 extra）不抛、返回非 null（CLI 路径）。

```java
package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import java.io.PrintStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class SubAgentReviewStreamTest {
    private static PrintStream discard() {
        return new PrintStream(OutputStream.nullOutputStream());
    }

    @Test
    void reviewForwardsDeltasToExtraListener() {
        StubStreamingClient client = new StubStreamingClient("审查中…", "{\"approved\":true,\"summary\":\"ok\",\"issues\":[]}");
        SubAgent reviewer = new SubAgent("reviewer", "reviewer", client, new com.lyhn.wraith.tool.ToolRegistry());
        List<String> captured = new ArrayList<>();
        LlmClient.StreamListener extra = new LlmClient.StreamListener() {
            @Override public void onContentDelta(String d) { captured.add(d); }
        };
        AgentMessage orig = AgentMessage.task("orchestrator", "原始任务");
        AgentMessage result = AgentMessage.result("worker-1", "worker", "执行结果");
        reviewer.review(orig, result, discard(), extra);
        assertTrue(captured.stream().anyMatch(s -> s.contains("审查中")),
                "extra listener should receive reviewer content deltas");
    }

    @Test
    void reviewWithoutExtraStillWorks() {
        StubStreamingClient client = new StubStreamingClient("", "{\"approved\":true,\"summary\":\"ok\",\"issues\":[]}");
        SubAgent reviewer = new SubAgent("reviewer", "reviewer", client, new com.lyhn.wraith.tool.ToolRegistry());
        AgentMessage orig = AgentMessage.task("orchestrator", "原始任务");
        AgentMessage result = AgentMessage.result("worker-1", "worker", "执行结果");
        AgentMessage out = reviewer.review(orig, result, discard());
        assertNotNull(out);
    }
}
```

> **注**：`StubStreamingClient` 若仓库无现成 stub，则在测试内写一个最小 `implements LlmClient`：`chat(messages, tools, listener)` 先对 `listener.onContentDelta(firstArg)`、再返回 `ChatResponse`（content=第二 arg）。参考 `AgentOrchestratorTest` 里的 `StubGLMClient` 写法就近实现。确认 `SubAgent` 构造签名（`grep -n "public SubAgent(" SubAgent.java`）与 `AgentMessage.result(...)` 工厂名后再定稿。

- [ ] **Step 3: 运行，确认失败**。`mvn -q -DskipTests=false -Dtest=SubAgentReviewStreamTest test` → 编译失败（`review(.., extra)` 不存在）。

- [ ] **Step 4: 实现重载**。在 `SubAgent.java`：

```java
/** CLI 兼容入口 — extra 隐式为 null（终端行为字节不变）。 */
public AgentMessage review(AgentMessage original, AgentMessage result, PrintStream out) {
    return review(original, result, out, null);
}

/** 允许注入额外 StreamListener（桌面事件转发）；extra=null 时与旧签名一致。 */
public AgentMessage review(AgentMessage original, AgentMessage result, PrintStream out,
                           LlmClient.StreamListener extra) {
    AgentMessage reviewTask = /* 原 review 里组 reviewTask 的那几行，原样搬来 */ ...;
    return execute(reviewTask, out, extra);
}
```

把原 `review(original, result, out)` 里「组 reviewTask」的代码移入新四参重载，旧三参委托 `extra=null`。`execute(reviewTask, out, extra)` 已存在（extra 走 CompositeStreamListener 扇出）。

- [ ] **Step 5: 运行，确认通过**。`mvn -q -DskipTests=false -Dtest=SubAgentReviewStreamTest test` → PASS。

- [ ] **Step 6: 编译门**。`mvn -q clean test-compile`。

- [ ] **Step 7: 提交**。
```bash
git add src/main/java/com/lyhn/wraith/agent/SubAgent.java src/test/java/com/lyhn/wraith/agent/SubAgentReviewStreamTest.java
git commit -m "feat(agent): SubAgent.review 每调用可选 StreamListener（CLI extra=null 字节不变）"
```

---

### Task 2: team.review.output 事件 + listener 第三路由（Java, TDD）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java`
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamTeamStreamListener.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamTeamReviewOutputTest.java`（Create）

**Interfaces:**
- Produces: `EventStreamRenderer.emitTeamReviewOutput(String teamId, String stepId, String text)` → 通知 `team.review.output {teamId, stepId, text}`;`EventStreamTeamStreamListener` 对 `kind=="review"` 调它。

- [ ] **Step 1: 写失败测试**。用一个捕获通知的 `JsonRpcWriter`（或现有测试里同款的 capture writer——`grep -rn "class.*Writer\|captureNotify\|notify" src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamTeamListenerTest.java` 找就近写法）构造 `EventStreamRenderer`，调 `emitTeamReviewOutput("t1","step_1","审查片段")`，断言发出的通知 method=`team.review.output`，params 含 `teamId=t1/stepId=step_1/text=审查片段`。再构造 `EventStreamTeamStreamListener(renderer,"t1","review","step_1")`，调 `onContentDelta("x")`，断言产生 `team.review.output`（stepId=step_1）。

```java
// 仿 EventStreamTeamListenerTest 的 capture writer 模式；断言 method 与 params 键值。
```

- [ ] **Step 2: 运行确认失败**（`emitTeamReviewOutput` 不存在）。`mvn -q -DskipTests=false -Dtest=EventStreamTeamReviewOutputTest test`。

- [ ] **Step 3: 加 emit**。`EventStreamRenderer`（仿 `emitTeamStepOutput`）：
```java
/** 协作步骤审查 LLM 流式正文片段。 */
public void emitTeamReviewOutput(String teamId, String stepId, String text) {
    Map<String, Object> p = base(); p.put("teamId", teamId); p.put("stepId", stepId); p.put("text", text);
    emit("team.review.output", p);   // ← Task 7 将把 writer.notify 收敛为 emit(...)；本任务先用 writer.notify(...)
}
```
> 本任务先写 `writer.notify("team.review.output", p);`；Task 7 再统一改 `emit(...)`。

- [ ] **Step 4: 加第三路由**。`EventStreamTeamStreamListener.onContentDelta`：
```java
@Override
public void onContentDelta(String delta) {
    if (delta == null || delta.isEmpty()) return;
    if ("planner".equals(kind)) {
        renderer.emitTeamPlanOutput(teamId, delta);
    } else if ("review".equals(kind)) {
        renderer.emitTeamReviewOutput(teamId, id, delta);
    } else {
        renderer.emitTeamStepOutput(teamId, id, delta);
    }
}
```
（`onReasoningDelta` 仍委托 `onContentDelta`，自然随 kind 走 review 路由。）

- [ ] **Step 5: 运行确认通过 + 编译门**。`mvn -q -DskipTests=false -Dtest=EventStreamTeamReviewOutputTest test` → PASS；`mvn -q clean test-compile`。

- [ ] **Step 6: 提交**。
```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamTeamStreamListener.java src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamTeamReviewOutputTest.java
git commit -m "feat(appserver): team.review.output 事件 + listener review 路由"
```

---

### Task 3: orchestrator 为 reviewer 注入流式（Java, TDD）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/agent/AgentOrchestrator.java`（`runStep` 首审 + 重试处）
- Test: `src/test/java/com/lyhn/wraith/agent/AgentOrchestratorTest.java`（扩）

**Interfaces:**
- Consumes: `SubAgent.review(orig, result, out, extra)`（Task 1）、`streamFor("review", stepId)`（已存在）。

- [ ] **Step 1: 定位**。`grep -n "reviewer.review(" src/main/java/com/lyhn/wraith/agent/AgentOrchestrator.java` → 首审 + 重试两处调用。

- [ ] **Step 2: 写失败测试**（扩 `AgentOrchestratorTest`）：捕获型工厂 `setStepStreamFactory((kind,id) -> { record(kind,id); return capturingListener; })`；跑一个「单步 + 首审通过」的 stub 计划；断言工厂被以 `kind="review"` 且正确 stepId 调用过。

```java
@Test
void shouldInjectReviewStreamListener(@TempDir java.nio.file.Path tempDir) {
    StubGLMClient llmClient = new StubGLMClient(List.of(
        response("{\"summary\":\"单步\",\"steps\":[{\"id\":\"s1\",\"description\":\"做事\",\"type\":\"COMMAND\",\"dependencies\":[]}]}"),
        response("执行结果"),
        response("{\"approved\":true,\"summary\":\"ok\",\"issues\":[]}")
    ));
    AgentOrchestrator orch = new AgentOrchestrator(llmClient, new ToolRegistry(), new NoOpMemoryManager(tempDir.toFile()));
    java.util.List<String> kinds = new java.util.ArrayList<>();
    orch.setStepStreamFactory((kind, id) -> { kinds.add(kind + ":" + id); return new LlmClient.StreamListener() {}; });
    orch.run("测试 review 注入");
    assertTrue(kinds.stream().anyMatch(s -> s.startsWith("review:step_1")),
            "reviewer 调用应拿到 kind=review + stepId 的 listener; got=" + kinds);
}
```

- [ ] **Step 3: 运行确认失败**（当前无 review 注入 → kinds 无 `review:*`）。`mvn -q -DskipTests=false -Dtest=AgentOrchestratorTest#shouldInjectReviewStreamListener test`。

- [ ] **Step 4: 注入**。两处 `reviewer.review(original, result, out)` → `reviewer.review(original, result, out, streamFor("review", step.id()))`。

- [ ] **Step 5: 运行确认通过 + 全 orchestrator 套件不回归**。
```
mvn -q -DskipTests=false -Dtest='AgentOrchestratorTest,TeamProgressWiringTest,TeamStreamWiringTest' test
```
Expected: 0F/0E（默认无工厂 → `streamFor` 返回 null → CLI 不回归）。

- [ ] **Step 6: 提交**。
```bash
git add src/main/java/com/lyhn/wraith/agent/AgentOrchestrator.java src/test/java/com/lyhn/wraith/agent/AgentOrchestratorTest.java
git commit -m "feat(agent): orchestrator 为 reviewer 注入 kind=review 流式监听器"
```

---

### Task 4: 前端类型 TeamReviewOutputEvent（TS, haiku）

**Files:** Modify `desktop/src/shared/types.ts`。

- [ ] **Step 1**：仿 `TeamStepOutputEvent` 加：
```ts
export interface TeamReviewOutputEvent { teamId: string; stepId: string; text: string }
```
- [ ] **Step 2**：`cd desktop && npm run typecheck` → 0。
- [ ] **Step 3**：提交 `feat(types): add TeamReviewOutputEvent`。

---

### Task 5: reducer reviewOutput + team.review.output（TS, TDD）

**Files:** Modify `desktop/src/shared/transcriptReducer.ts`;Test `desktop/test/transcriptReducerTeam.test.ts`（扩，确认文件名：`ls desktop/test | grep -i team`）。

**Interfaces:**
- Produces: `TeamStep.reviewOutput?: string`;`reduce` 处理 `team.review.output`（按 stepId 累积）。

- [ ] **Step 1: 写失败测试**：两条 `team.review.output`（同 teamId/stepId）delta 累积到该步 `reviewOutput`;两并行步骤（不同 stepId）乱序到达各归位不串台。
```ts
it('accumulates team.review.output per stepId', () => {
  let s = freshState()
  s = reduce(s, { kind:'notification', method:'team.started', params:{ teamId:'t1', goal:'g', agents:[] } } as any)
  s = reduce(s, { kind:'notification', method:'team.plan', params:{ teamId:'t1', steps:[{id:'s1',description:'a'},{id:'s2',description:'b'}] } } as any)
  s = reduce(s, { kind:'notification', method:'team.review.output', params:{ teamId:'t1', stepId:'s1', text:'审1' } } as any)
  s = reduce(s, { kind:'notification', method:'team.review.output', params:{ teamId:'t1', stepId:'s2', text:'审2' } } as any)
  s = reduce(s, { kind:'notification', method:'team.review.output', params:{ teamId:'t1', stepId:'s1', text:'审1b' } } as any)
  const team = s.items.find(i => i.type === 'team') as any
  expect(team.steps.find((x:any)=>x.id==='s1').reviewOutput).toBe('审1审1b')
  expect(team.steps.find((x:any)=>x.id==='s2').reviewOutput).toBe('审2')
})
```
> 确认 `team.started`/`team.plan` 的 params 键名与现有 cases 一致（读 `case 'team.started'`/`case 'team.plan'` 对齐 fixture）。

- [ ] **Step 2: 运行确认失败**。`cd desktop && npx vitest run transcriptReducerTeam`。

- [ ] **Step 3: 实现**。`TeamStep` 接口加 `reviewOutput?: string`;加 case（仿 `team.step.output`）：
```ts
case 'team.review.output': {
  const teamId = typeof p['teamId'] === 'string' ? p['teamId'] : ''
  const stepId = typeof p['stepId'] === 'string' ? p['stepId'] : ''
  const text = typeof p['text'] === 'string' ? p['text'] : ''
  return updateTeamStep(state, teamId, stepId, st => ({ ...st, reviewOutput: (st.reviewOutput ?? '') + text }))
}
```

- [ ] **Step 4: 运行确认通过 + 全套件 + typecheck**。`npx vitest run transcriptReducerTeam && npx vitest run && npm run typecheck`。

- [ ] **Step 5: 提交** `feat(reducer): TeamStep.reviewOutput + team.review.output 累积`。

---

### Task 6: TeamCard planner 常驻行 + reviewer 分区（TS/UI）

**Files:** Modify `desktop/src/renderer/components/TeamCard.tsx`。

- [ ] **Step 1: planner 常驻行**。把现有「`item.steps.length === 0 && item.plannerOutput` 才显示规划区」改成**常驻 planner 行**（放在步骤时间线最上方，worker 行同构）：
  - badge：🧭 planner（`roleColor('planner')`）；
  - 摘要文案：`item.steps.length > 0 ? \`规划 · 拆解为 ${item.steps.length} 步\` : '规划中…'`；
  - 正文：有 `item.plannerOutput` 时渲染可折叠区（`max-h-48 overflow-y-auto` + `<pre className="whitespace-pre-wrap break-words text-xs">`）；`useState` 默认展开（沿用 done 步骤 `useState(true)` 策略），拆完可折叠。
  - 删除原「仅 steps 为空显示」的条件块与「🧭 拆解为 N 步」单行（被 planner 行取代）。

- [ ] **Step 2: reviewer 分区**。在 `TeamStepRow` 内，worker 正文块下方，加一个独立 🔎 reviewer 块：`typeof step.reviewOutput === 'string' && step.reviewOutput.length > 0` 才渲染;结构同 worker 正文（`max-h-48 overflow-y-auto` + `<pre>`），标题行 `🔎 reviewer`。running-review 时随 `reviewOutput` 实时增长；与 worker 正文视觉分区（例如浅色分隔/缩进）。

- [ ] **Step 3: 门禁**。`cd desktop && npm run typecheck && npm run build`。

- [ ] **Step 4: 提交** `feat(TeamCard): planner 常驻行 + reviewer 流式分区`。

---

## Part 3 — plan/team resume 重建卡片（Java + TS）

### Task 7: EventStreamRenderer 卡片事件录制 + 合流（Java, TDD）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/CardRecordingTest.java`（Create）

**Interfaces:**
- Produces: `void startCardRecording()`;`List<Map<String,Object>> stopCardRecording()`（每项 `{"method":String, "params":Map}`，已合流）;私有 `emit(String method, Map<String,Object> p)`（录制点）+ `isCardMethod(String)`。

- [ ] **Step 1: 写失败测试** `CardRecordingTest`：
```java
// 1) 录制关闭时 emit 不缓存；
// 2) startCardRecording 后，发 team.step.started / 连续 3 条 team.step.output(同 stepId) / team.step.completed
//    → stopCardRecording 返回：started、合并后的单条 output(text 拼接)、completed（保序）；
// 3) plan.review.requested 与 message.delta 不被录（isCardMethod=false）。
```
断言 stop 后 list 大小与顺序、合并后的 text = 三段拼接。

- [ ] **Step 2: 运行确认失败**。`mvn -q -DskipTests=false -Dtest=CardRecordingTest test`。

- [ ] **Step 3: 实现**。`EventStreamRenderer`：
```java
private java.util.List<Map<String,Object>> cardRecording; // null=关闭

public void startCardRecording() { this.cardRecording = new java.util.ArrayList<>(); }

/** 返回本轮录制并合流后的事件列表；关闭录制。无录制→空列表。 */
public List<Map<String,Object>> stopCardRecording() {
    java.util.List<Map<String,Object>> raw = cardRecording == null ? java.util.List.of() : cardRecording;
    cardRecording = null;
    return coalesce(raw);
}

private static boolean isCardMethod(String m) {
    return (m.startsWith("plan.") || m.startsWith("team."))
            && !m.equals("plan.review.requested");
}

/** 统一出口：录制开启且是卡片事件则缓存，再照常 notify。 */
private void emit(String method, Map<String,Object> p) {
    if (cardRecording != null && isCardMethod(method)) {
        Map<String,Object> rec = new java.util.LinkedHashMap<>();
        rec.put("method", method);
        rec.put("params", new java.util.LinkedHashMap<>(p)); // 浅拷贝，防后续复用
        cardRecording.add(rec);
    }
    writer.notify(method, p);
}

/** 合并连续同通道 *.output（method 相同且除 text 外字段全等）→ text 拼接。 */
private static List<Map<String,Object>> coalesce(List<Map<String,Object>> in) {
    java.util.List<Map<String,Object>> out = new java.util.ArrayList<>();
    for (Map<String,Object> ev : in) {
        String method = (String) ev.get("method");
        boolean isOutput = method.endsWith(".output");
        if (isOutput && !out.isEmpty()) {
            Map<String,Object> prev = out.get(out.size()-1);
            if (sameChannel(prev, ev)) {
                @SuppressWarnings("unchecked") Map<String,Object> pp = (Map<String,Object>) prev.get("params");
                @SuppressWarnings("unchecked") Map<String,Object> cp = (Map<String,Object>) ev.get("params");
                pp.put("text", String.valueOf(pp.getOrDefault("text","")) + String.valueOf(cp.getOrDefault("text","")));
                continue;
            }
        }
        out.add(ev);
    }
    return out;
}

private static boolean sameChannel(Map<String,Object> a, Map<String,Object> b) {
    if (!java.util.Objects.equals(a.get("method"), b.get("method"))) return false;
    @SuppressWarnings("unchecked") Map<String,Object> pa = new java.util.HashMap<>((Map<String,Object>) a.get("params"));
    @SuppressWarnings("unchecked") Map<String,Object> pb = new java.util.HashMap<>((Map<String,Object>) b.get("params"));
    pa.remove("text"); pb.remove("text");
    return pa.equals(pb);
}
```
把 `EventStreamRenderer` 里 **plan.\*/team.\*** 那些 `writer.notify(method, p)` 调用改为 `emit(method, p)`（含 Task 2 新加的 `team.review.output`；`plan.review.requested` 也可走 emit，`isCardMethod` 会滤掉不录）。非卡片事件（thinking/message/tool/status/mcp/approval）保持 `writer.notify` 原样。

- [ ] **Step 4: 运行确认通过 + 编译门**。`mvn -q -DskipTests=false -Dtest=CardRecordingTest test`;`mvn -q clean test-compile`。

- [ ] **Step 5: 提交** `feat(appserver): EventStreamRenderer 卡片事件录制 + *.output 合流`。

---

### Task 8: SessionStore 旁车持久化（Java, TDD）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/session/SessionStore.java`
- Test: `src/test/java/com/lyhn/wraith/session/SessionStoreCardsTest.java`（Create）

**Interfaces:**
- Produces:
  - `void appendCard(String sessionId, int turnOrdinal, String eventsJson)` — 向 `<id>.cards.jsonl` 追加一行 `{"v":1,"turnOrdinal":N,"events":<eventsJson 原样嵌入>}`。
  - `List<JsonNode> readCards(String id)` — 读回每行为 `{turnOrdinal, events}` 的 JsonNode 列表;文件不存在→空。
  - `deleteById`/`rename` 同步处理 `<id>.cards.jsonl`。

- [ ] **Step 1: 写失败测试** `SessionStoreCardsTest`：`open` 到 `@TempDir`;`persist(history)` 建会话拿 `currentId()`;`appendCard(id, 0, "[{\"method\":\"team.started\",\"params\":{}}]")`;`readCards(id)` 返回 1 项且 `turnOrdinal==0`、`events` 是数组;`deleteById(id)` 后 `readCards(id)` 空 + `.cards.jsonl` 不存在。

- [ ] **Step 2: 运行确认失败**。`mvn -q -DskipTests=false -Dtest=SessionStoreCardsTest test`。

- [ ] **Step 3: 实现**。`SessionStore`：
```java
private Path cardsFile(String id) { return dir.resolve(safeId(id) + ".cards.jsonl"); }

/** 追加一条卡片记录（events 为已序列化的 JSON 数组字符串）。 */
public synchronized void appendCard(String sessionId, int turnOrdinal, String eventsJson) {
    if (sessionId == null || sessionId.isBlank() || eventsJson == null) return;
    try {
        Files.createDirectories(dir);
        ObjectNode line = mapper.createObjectNode();
        line.put("v", 1);
        line.put("turnOrdinal", turnOrdinal);
        line.set("events", mapper.readTree(eventsJson));
        Files.writeString(cardsFile(sessionId), mapper.writeValueAsString(line) + "\n",
                StandardCharsets.UTF_8, java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
    } catch (IOException e) { /* 非致命 */ }
}

/** 读回卡片记录（每项 {turnOrdinal, events}）。文件不存在或坏行 → 跳过。 */
public synchronized List<JsonNode> readCards(String id) {
    Path f = cardsFile(id);
    if (!Files.isRegularFile(f)) return List.of();
    List<JsonNode> out = new ArrayList<>();
    try (BufferedReader r = Files.newBufferedReader(f, StandardCharsets.UTF_8)) {
        String line;
        while ((line = r.readLine()) != null) {
            if (line.isBlank()) continue;
            try { out.add(mapper.readTree(line)); } catch (Exception ignore) {}
        }
    } catch (IOException e) { return out; }
    return out;
}
```
`deleteById(String id)`：删 `.jsonl` 后 `Files.deleteIfExists(cardsFile(id));`。`rename` 不改文件名（rename 只改 meta.name，文件名仍是 id）→ 无需迁移旁车。`deleteCurrent()` 同样删旁车。

- [ ] **Step 4: 运行确认通过 + 编译门**。`mvn -q -DskipTests=false -Dtest=SessionStoreCardsTest test`;`mvn -q clean test-compile`。

- [ ] **Step 5: 提交** `feat(session): SessionStore 卡片旁车 append/read + 删除同步`。

---

### Task 9: Main plan/team 分支接线录制 + 旁车写入（Java）

**Files:** Modify `src/main/java/com/lyhn/wraith/cli/Main.java`（team 分支 :1453、plan 分支 :1499+、`persistTurn` :1244）。

**Interfaces:**
- Consumes: `renderer.startCardRecording()/stopCardRecording()`（Task 7）、`sessionStore.appendCard(...)`（Task 8）、`orchestrator.getLastCleanResult()`（已在）。

- [ ] **Step 1: 加 pending 持有者**。在 `persistTurn`/`runTurn` 匿名实现的**外层**（与 `sessionStore` 同作用域）加一个 effectively-final 持有者：
```java
final java.util.concurrent.atomic.AtomicReference<int[]> pendingCardOrdinal = new java.util.concurrent.atomic.AtomicReference<>();
final java.util.concurrent.atomic.AtomicReference<String> pendingCardEventsJson = new java.util.concurrent.atomic.AtomicReference<>();
```
（放在 `new AppServer.Session() { ... }`/等价匿名类定义之前。）

- [ ] **Step 2: team 分支录制 + 暂存**。team 分支（:1453）：
  - `orchestrator` 装配完、`snap.runTurn(...)` **之前**：`renderer.startCardRecording();`
  - `run()` 返回后：
```java
java.util.List<java.util.Map<String,Object>> recorded = renderer.stopCardRecording();
String cleanTeamAnswer = orchestrator.getLastCleanResult();
if (cleanTeamAnswer != null && !cleanTeamAnswer.isBlank()) {
    renderer.appendAssistantContentDelta(cleanTeamAnswer);
    renderer.finishAssistantContent();
}
// 一致性修正：记干净答案（与 plan 对齐）
agent.recordExternalTurn(goal,
        (cleanTeamAnswer != null && !cleanTeamAnswer.isBlank()) ? cleanTeamAnswer : result);
if (!recorded.isEmpty()) {
    int turnOrdinal = countUserTurns(agent.getConversationHistory()) - 1;
    pendingCardOrdinal.set(new int[]{turnOrdinal});
    pendingCardEventsJson.set(JsonRpc.MAPPER.writeValueAsString(recorded));
}
return result;
```
  - 删除原 team 分支里旧的底部消息/`recordExternalTurn(goal, result)` 段（被上面取代）。

- [ ] **Step 3: plan 分支录制 + 暂存**。plan 分支（`snap.runTurn("plan",...)` 前后）同款：`startCardRecording()` 前置；`run()` 后 `stopCardRecording()`；plan 已发 cleanAnswer 底部消息、已 `recordExternalTurn(goal, cleanAnswer ?? result)`（保持）；在其后加：
```java
if (!recorded.isEmpty()) {
    int turnOrdinal = countUserTurns(agent.getConversationHistory()) - 1;
    pendingCardOrdinal.set(new int[]{turnOrdinal});
    pendingCardEventsJson.set(JsonRpc.MAPPER.writeValueAsString(recorded));
}
```

- [ ] **Step 4: persistTurn 写旁车**。`persistTurn`（:1244）：
```java
public String persistTurn() {
    sessionStore.persist(agent.getConversationHistory());
    String id = sessionStore.currentId();
    int[] ord = pendingCardOrdinal.getAndSet(null);
    String ev = pendingCardEventsJson.getAndSet(null);
    if (id != null && ord != null && ev != null) {
        sessionStore.appendCard(id, ord[0], ev);
    }
    return id;
}
```

- [ ] **Step 5: 加 countUserTurns 私有helper**（Main.java 静态）：
```java
private static int countUserTurns(java.util.List<com.lyhn.wraith.llm.LlmClient.Message> h) {
    int n = 0; for (var m : h) if ("user".equals(m.role())) n++; return n;
}
```

- [ ] **Step 6: 编译 + 全量 test-compile**。`mvn -q clean test-compile`。（此任务为接线，无独立单测;行为由 Task 12 前端回放 + Task 13 眼验覆盖。）

- [ ] **Step 7: 提交** `feat(cli): plan/team 桌面分支录制卡片事件 + persistTurn 写旁车 + team 记干净答案`。

---

### Task 10: AppServer resume 返回 cards（Java, TDD）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`（`handleSessionResume` :715;`Session` 接口加默认方法）
- Test: 就近扩 `AppServer` 现有 resume 测试（`grep -rln "handleSessionResume\|resumeSession" src/test`）;无则在 `SessionStoreCardsTest` 里覆盖 `readCards` 已足够，AppServer 层做手测标注。

**Interfaces:**
- Produces: resume result 增加 `cards`（`List<JsonNode>`，来自 `session.readCards(id)`）。`AppServer.Session` 接口加 `default List<com.fasterxml.jackson.databind.JsonNode> readCards(String id) { return java.util.List.of(); }`;Main 的 session 实现覆写为 `return sessionStore.readCards(id);`。

- [ ] **Step 1**：`AppServer.Session` 接口加默认方法 `readCards`（默认空）。
- [ ] **Step 2**：`handleSessionResume`（:743 前）：`result.put("cards", session.readCards(id));`。
- [ ] **Step 3**：Main 的 `AppServer.Session` 匿名实现覆写 `readCards` → `sessionStore.readCards(id)`。
- [ ] **Step 4**：`mvn -q clean test-compile` + 现有 appserver 测试不回归（`mvn -q -DskipTests=false -Dtest='*AppServer*,*Session*' test`）。
- [ ] **Step 5: 提交** `feat(appserver): resume 返回 cards（旁车卡片事件）`。

---

### Task 11: preload/main 透传 cards + ResumeResult 类型（TS）

**Files:** Modify `desktop/src/main/index.ts`（`wraith:resumeSession` handler）、`desktop/src/preload/index.ts`（:32/:160 返回类型）。

- [ ] **Step 1**：`main/index.ts` 的 `wraith:resumeSession` handler 把后端 `cards` 一并返回（透传，不加工）。`grep -n "resumeSession" desktop/src/main/index.ts` 定位。
- [ ] **Step 2**：`preload/index.ts` 两处 `resumeSession` 返回类型加 `cards?: Array<{ turnOrdinal: number; events: Array<{ method: string; params: unknown }> }>`。
- [ ] **Step 3**：`cd desktop && npm run typecheck` → 0。
- [ ] **Step 4: 提交** `feat(desktop/ipc): resume 透传 cards + 类型`。

---

### Task 12: App.tsx resume 拼接卡片（TS, TDD）

**Files:**
- Create: `desktop/src/shared/spliceCards.ts`（纯逻辑，可测）
- Modify: `desktop/src/renderer/App.tsx`（resume handler 用 `spliceCards`）
- Test: `desktop/test/spliceCards.test.ts`（Create）

**Interfaces:**
- Consumes: `reduce`、`freshState`、`Item`（`transcriptReducer`）。
- Produces: `spliceCards(baseItems: Item[], cards?: Array<{turnOrdinal:number; events:Array<{method:string;params:unknown}>}>): Item[]`。

- [ ] **Step 1: 写失败测试** `spliceCards.test.ts`：
  - **team**：给定 `baseItems=[user('你好'), message('答')]` 与一组 team.* 事件（started→plan(1步)→step.started→step.output→step.completed→review.output→finished），`turnOrdinal:0` → 结果 = `[user, teamItem, message]`（卡片在 message 之前，team.steps[0] 有 result/reviewOutput）。
  - **plan**：给定一组 plan.* 事件（plan.created(steps)→plan.step.started→plan.step.output→plan.step.completed），`turnOrdinal:0` → `[user, planItem, message]`。
  - **无 cards / turnOrdinal 越界** → 原样返回。
  - **多卡片（ordinal 1 与 0）** → 各自插到对应 user 之后，顺序正确。

```ts
import { describe, it, expect } from 'vitest'
import { spliceCards } from '../src/shared/spliceCards'
import type { Item } from '../src/shared/transcriptReducer'

const base: Item[] = [{ type:'user', text:'你好' }, { type:'message', text:'答' }]
const teamEvents = [
  { method:'team.started', params:{ teamId:'t1', goal:'你好', agents:[] } },
  { method:'team.plan', params:{ teamId:'t1', steps:[{id:'s1',description:'回复问候'}] } },
  { method:'team.step.started', params:{ teamId:'t1', stepId:'s1', agent:'worker-1' } },
  { method:'team.step.output', params:{ teamId:'t1', stepId:'s1', text:'你好！' } },
  { method:'team.step.completed', params:{ teamId:'t1', stepId:'s1', status:'done', result:'你好！我是 Wraith', approved:true, retries:0 } },
  { method:'team.review.output', params:{ teamId:'t1', stepId:'s1', text:'审查通过理由…' } },
  { method:'team.finished', params:{ teamId:'t1', status:'completed' } },
]
it('splices team card before the clean-answer message', () => {
  const out = spliceCards(base, [{ turnOrdinal:0, events: teamEvents }])
  expect(out.map(i=>i.type)).toEqual(['user','team','message'])
  const team = out[1] as any
  expect(team.steps[0].result).toContain('Wraith')
  expect(team.steps[0].reviewOutput).toContain('审查通过')
})
```
> 事件 params 键名必须与 reducer 现有 cases 完全对齐（实现前读 `case 'team.plan'`/`'team.step.completed'` 等核对 fixture）。

- [ ] **Step 2: 运行确认失败**。`cd desktop && npx vitest run spliceCards`。

- [ ] **Step 3: 实现** `spliceCards.ts`：
```ts
import { reduce, freshState, type Item } from './transcriptReducer'
import type { BackendEvent } from './types'

function replayCard(events: Array<{ method: string; params: unknown }>): Item | null {
  let s = freshState()
  for (const e of events) {
    s = reduce(s, { kind: 'notification', method: e.method, params: e.params } as BackendEvent)
  }
  return s.items.find(i => i.type === 'team' || i.type === 'plan') ?? null
}

export function spliceCards(
  baseItems: Item[],
  cards?: Array<{ turnOrdinal: number; events: Array<{ method: string; params: unknown }> }>,
): Item[] {
  if (!cards || cards.length === 0) return baseItems
  const userIdx: number[] = []
  baseItems.forEach((it, i) => { if (it.type === 'user') userIdx.push(i) })
  const result = [...baseItems]
  // 从大到小 ordinal 插入，保证小 ordinal 的原始下标不被已插入项影响
  for (const c of [...cards].sort((a, b) => b.turnOrdinal - a.turnOrdinal)) {
    const card = replayCard(c.events)
    if (!card) continue
    const uidx = userIdx[c.turnOrdinal]
    if (uidx == null) continue
    result.splice(uidx + 1, 0, card) // 用户项之后、干净答案 message 之前
  }
  return result
}
```

- [ ] **Step 4: 接线 App.tsx**。resume handler（:~259）：
```ts
const { sessionId, messages, model, modelFallback, cards } = await window.wraith.resumeSession(id)
...
dispatch({ type: 'loadHistory', items: spliceCards(messagesToItems(messages), cards) })
```
（import `spliceCards`。）

- [ ] **Step 5: 运行确认通过 + 全套件 + 三门**。`npx vitest run spliceCards && npx vitest run && npm run typecheck && npm run build`。

- [ ] **Step 6: 提交** `feat(desktop/resume): spliceCards 回放事件重建 plan/team 卡片`。

---

### Task 13: 端到端 — 重建 jar + 眼验 + 整支终审（本人）

- [ ] **Step 1**：仓库根 `mvn -q clean package -DskipTests` → `cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar` → 重启 dev App。
- [ ] **Step 2: 密钥扫描**。`git diff <base>..HEAD | grep -iE "api[_-]?key|secret|sk-|Bearer"`（只应命中字段名/自指）。
- [ ] **Step 3: 眼验**：
  - Team 发多步任务 → **planner 常驻行**出规划正文、拆完收敛「规划 · 拆解为 N 步」;每步 running 时 worker 正文 + **reviewer 正文**分区实时流入;并行步骤各自不串台。
  - Team 轮结束 → 从左侧**重新点进该会话** → **完整卡片回来**（三角色、步骤、结果、判定、正文）+ 底部干净答案气泡，顺序与直播一致。
  - Plan 同验:发计划任务 → 结束 → 点回 → **清单卡片回来** + 各步正文 + 底部答案。
  - **CLI 抽验**:`/team`、`/plan` 终端跑同任务,行为/结果一致(呈现不同、终端字节不变)。
- [ ] **Step 4: 整支终审**（opus，range `<merge-base>..HEAD`）→ FF/merge（推送前点头）。

## Self-Review

- **Spec 覆盖**：Part1 planner 行(T6)；Part2 reviewer 流式(T1 SubAgent seam→T2 事件+路由→T3 orchestrator 注入→T4 类型→T5 reducer→T6 UI)；Part3 resume(T7 录制+合流→T8 旁车→T9 Main 接线+一致性修正→T10 AppServer→T11 ipc/类型→T12 前端拼接→T13 e2e)。plan+team 双覆盖(录制白名单模式无关、T12 两例、T13 双眼验)。
- **占位扫描**：无 TBD;所有代码步给出实体代码;stub/构造签名处标注「实现前 grep 核对」(SubAgent 构造/AgentMessage 工厂/reducer params 键名/capture writer 就近写法)——这些是**核对指令**非占位。
- **类型一致**：`emitTeamReviewOutput`(T2)→`team.review.output`→`reviewOutput`(T5)→UI(T6);`startCardRecording/stopCardRecording`(T7)↔Main(T9);`appendCard/readCards`(T8)↔AppServer(T10)↔`cards`(T11)↔`spliceCards`(T12) 名字贯穿一致。`turnOrdinal` 定义(用户轮计数−1)在 T9 产出、T12 消费一致。
- **CLI 一致性**:T1 extra=null 委托、T3 默认无工厂、T7/T9 仅桌面分支录制——三处贯穿;`AgentOrchestratorTest`(T3)锁定。
