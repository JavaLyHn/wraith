# 桌面 Plan 模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让桌面 App 能逐条选择 Plan（Plan-and-Execute）模式执行任务，以结构化计划清单呈现进度，并把计划路由到 UI 复审。

**Architecture:** 加法式 + 注入——`PlanExecuteAgent` 保留全部现有 `out.println` 与 `TaskStreamRenderer`（CLI 行为一字节不变），追加两个可注入出口：(1) 可选 `PlanProgressListener`（生命周期事件，默认 no-op）；(2) 可注入的步骤 `StreamListener` 工厂（默认 = `TaskStreamRenderer` 写 `out`）。桌面 backend 构造时把 `out` 设为 discard、生命周期 listener 设为 `EventStreamPlanListener`（发 `plan.*` 通知）、步骤工厂设为把正文转 `message.delta` 的监听器；计划复审复用 `EventStreamRenderer` 的阻塞-future 管道（镜像 approval）。前端在 Composer 加逐条模式选择器、`transcriptReducer` 消费 `plan.*` 事件建计划清单、加 `PlanCard` 与复审卡。

**Tech Stack:** Java 17 / Maven（pkg `com.lyhn.wraith`）；Electron + React + TypeScript（vitest）；JSON-RPC over stdio。

## Global Constraints

- Java 17 / Maven；包 `com.lyhn.wraith`；注释用中文、匹配周围风格。
- **CLI/TUI 的 Plan 行为零回归**：`PlanExecuteAgent` 默认构造路径（不传 listener、不传步骤工厂、`out` 默认 `deferredSystemOut()`）行为必须与当前完全一致；现有 `PlanExecuteAgentTest` 全绿、不改断言。
- 桌面 backend 的 **stdout 是 JSON-RPC 协议管道**：Plan 相关代码绝不能往 `System.out` 写（`out` 用 discard 或事件适配流）。
- 桌面组件签名用 `): JSX.Element`；不引入 React Testing Library；纯逻辑抽到 lib + vitest，UI 靠 typecheck/build/eyeverify；`npm` 用 `--legacy-peer-deps`。
- 密钥红线：不新增密钥面；复审响应仅承载 UI 决策 + 反馈文本。
- 含 Java 改动 → 收尾 `mvn -DskipTests=false package` 重建 fat jar → 部署 `~/.wraith/wraith.jar` → 眼验。
- 每次提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`（只应命中字段名/自指）。
- Commit trailer：
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`
- 分支 `feat/desktop-plan-mode`（off main，已建）。

---

## 文件结构

**Phase A — 后端（Java）**
- Create `src/main/java/com/lyhn/wraith/agent/PlanProgressListener.java` — 生命周期监听器接口 + NOOP。
- Modify `src/main/java/com/lyhn/wraith/agent/PlanExecuteAgent.java` — 追加 listener 字段 + 构造重载；生命周期埋点；步骤 StreamListener 工厂化。
- Modify `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` — `SessionRunner` 加带 mode 的 `runTurn` 重载；`handleTurn` 读 mode；加 `case "plan.review.respond"`。
- Modify `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java` — `plan.*` 通知发射方法 + `requestPlanReview`/`resolvePlanReview`（镜像 approval）。
- Create `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamPlanListener.java` — 桌面生命周期 sink（PlanProgressListener → `plan.*` 通知）。
- Create `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamStepListener.java` — 桌面步骤 sink（LlmClient.StreamListener → `message.delta`/`thinking.*`）。
- Modify `src/main/java/com/lyhn/wraith/cli/Main.java` — 桌面匿名 SessionRunner 覆写带 mode 的 runTurn，mode=plan 装配 PlanExecuteAgent（桌面三出口 + 复审桥）。
- Tests: `src/test/java/com/lyhn/wraith/agent/PlanProgressWiringTest.java`、`.../appserver/PlanReviewChannelTest.java`、`.../appserver/EventStreamPlanListenerTest.java`、`.../appserver/AppServerTurnModeTest.java`。

**Phase B — 前端（TS/React）**
- Modify `desktop/src/shared/types.ts` — mode 类型 + plan 事件/复审 payload 类型。
- Modify `desktop/src/preload/index.ts` — `submitTurn` 加 mode；加 `respondPlanReview`。
- Modify `desktop/src/main/index.ts` — `turn.submit` 带 mode；加 `wraith:respondPlanReview` handler。
- Modify `desktop/src/shared/transcriptReducer.ts` — 消费 `plan.created`/`plan.step.started`/`plan.step.completed`/`plan.review.requested`。
- Create `desktop/src/renderer/lib/planStatus.ts` — 步骤状态→图标/文案纯函数（可测）。
- Create `desktop/src/renderer/components/PlanCard.tsx` — 计划清单 + 复审卡。
- Modify `desktop/src/renderer/components/Composer.tsx` — 模式分段选择器。
- Modify `desktop/src/renderer/App.tsx` — `pendingMode` 状态 + 提交后复位。
- Tests: `desktop/test/transcriptReducerPlan.test.ts`、`desktop/test/planStatus.test.ts`、`desktop/test/composerMode.test.ts`。

---

## Phase A — 后端

### Task A1: `PlanProgressListener` 接口 + `PlanExecuteAgent` 生命周期埋点（加法式，默认 NOOP）

**Files:**
- Create: `src/main/java/com/lyhn/wraith/agent/PlanProgressListener.java`
- Modify: `src/main/java/com/lyhn/wraith/agent/PlanExecuteAgent.java`
- Test: `src/test/java/com/lyhn/wraith/agent/PlanProgressWiringTest.java`

**Interfaces:**
- Produces:
  - `interface PlanProgressListener { void planCreated(ExecutionPlan plan); void stepStarted(String stepId); void stepCompleted(String stepId, boolean ok, String result); void planFinished(String finalResult); PlanProgressListener NOOP = ...; }`
  - `PlanExecuteAgent` 新构造重载末位加 `PlanProgressListener progressListener`（其余参数同现有 6 参构造）。默认 = `PlanProgressListener.NOOP`。

- [ ] **Step 1: 写接口**

Create `src/main/java/com/lyhn/wraith/agent/PlanProgressListener.java`:

```java
package com.lyhn.wraith.agent;

import com.lyhn.wraith.plan.ExecutionPlan;

/**
 * Plan 执行生命周期监听器（加法式旁路）。
 * PlanExecuteAgent 在关键节点回调；默认 NOOP 保持 CLI 行为不变。
 * CLI 用 NOOP（叙述仍走 out.println）；桌面注入 EventStreamPlanListener 发 plan.* 通知。
 */
public interface PlanProgressListener {
    /** 计划已生成、即将执行（复审通过后）。 */
    void planCreated(ExecutionPlan plan);
    /** 某步骤开始执行。 */
    void stepStarted(String stepId);
    /** 某步骤结束。ok=false 表示失败。 */
    void stepCompleted(String stepId, boolean ok, String result);
    /** 整个计划执行结束，finalResult 为汇总文本。 */
    void planFinished(String finalResult);

    PlanProgressListener NOOP = new PlanProgressListener() {
        @Override public void planCreated(ExecutionPlan plan) { }
        @Override public void stepStarted(String stepId) { }
        @Override public void stepCompleted(String stepId, boolean ok, String result) { }
        @Override public void planFinished(String finalResult) { }
    };
}
```

- [ ] **Step 2: `PlanExecuteAgent` 加字段 + 构造重载**

在 `PlanExecuteAgent.java` 字段区（`private final PrintStream out;` 附近）加：

```java
    private final PlanProgressListener progressListener;
```

在最全参构造（`PlanExecuteAgent(llmClient, toolRegistry, planner, memoryManager, reviewHandler, out)`，约 139 行）体内末尾加 `this.progressListener = PlanProgressListener.NOOP;`，并新增一个末位带 listener 的构造重载：

```java
    // 桌面注入进度监听器；其余装配同 6 参构造。
    PlanExecuteAgent(LlmClient llmClient, ToolRegistry toolRegistry, Planner planner,
                     MemoryManager memoryManager, PlanReviewHandler reviewHandler, PrintStream out,
                     PlanProgressListener progressListener) {
        this(llmClient, toolRegistry, planner, memoryManager, reviewHandler, out);
        // 注意:上面的委托构造已把 this.progressListener 设成 NOOP,这里覆盖为传入值。
    }
```

**实现注意**：`this.progressListener` 是 `final`，不能在委托后重新赋值。改为：把 `progressListener` 提为非委托的正式参数——即在最全参构造里直接接收 `PlanProgressListener` 并赋值，其余旧构造用 `this(..., PlanProgressListener.NOOP)` 委托过来。落地时以「最全参构造持有 listener 形参、旧构造委托传 NOOP」为准，避免 final 重复赋值。

- [ ] **Step 3: 生命周期埋点（在现有 out.println 旁追加，不删 out.println）**

- `executePlan(...)` 开头（约 275 行 `out.println("🚀 开始执行计划...\n");` 之后）加：
  ```java
      progressListener.planCreated(plan);
  ```
- `executeTaskBatch(...)` 单任务分支（约 368 行 `task.markStarted();` 之后）加：
  ```java
      progressListener.stepStarted(task.getId());
  ```
  并行分支（约 393 行 `task.markStarted();` 之后）同样加 `progressListener.stepStarted(task.getId());`。
- `executePlan(...)` 完成分支（约 296 行 `task.markCompleted(batchResult.result());` 之后）加：
  ```java
      progressListener.stepCompleted(task.getId(), true, batchResult.result());
  ```
  失败分支（约 310 行 `task.markFailed(error.getMessage());` 之后）加：
  ```java
      progressListener.stepCompleted(task.getId(), false, error.getMessage());
  ```
- `run(...)`：在 `return outcome.result();`（约 236 行）之前捕获结果并回调；同样在异常分支（约 241 行 `return errorMessage;`）之前回调。用局部变量避免多返回点重复：
  ```java
      // 成功路径:
      String finalOut = outcome.result();
      progressListener.planFinished(finalOut == null ? "" : finalOut);
      if (streamState.hasStreamedOutput() && (finalOut == null || finalOut.isBlank())) {
          return "";
      }
      return finalOut;
  ```
  异常路径在 `memoryManager.addAssistantMessage(errorMessage);` 之后加 `progressListener.planFinished(errorMessage);`。

- [ ] **Step 4: 写失败测试**

Create `src/test/java/com/lyhn/wraith/agent/PlanProgressWiringTest.java`。复用现有 `PlanExecuteAgentTest` 的 stub 思路（`StubPlanner extends Planner` 返回单步计划；stub `LlmClient` 直接返回一个 `ChatResponse`）。断言事件序列：

```java
package com.lyhn.wraith.agent;

import com.lyhn.wraith.plan.ExecutionPlan;
import com.lyhn.wraith.plan.Task;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PlanProgressWiringTest {

    @Test
    void 单步计划触发_planCreated_stepStarted_stepCompleted_planFinished() {
        List<String> events = new ArrayList<>();
        PlanProgressListener listener = new PlanProgressListener() {
            @Override public void planCreated(ExecutionPlan plan) { events.add("created:" + plan.getGoal()); }
            @Override public void stepStarted(String stepId) { events.add("started:" + stepId); }
            @Override public void stepCompleted(String stepId, boolean ok, String result) { events.add("completed:" + stepId + ":" + ok); }
            @Override public void planFinished(String finalResult) { events.add("finished"); }
        };

        // 用与 PlanExecuteAgentTest 相同的最小 stub:单步计划 + 直接返回内容的 LlmClient。
        FakeLlmClient llm = new FakeLlmClient("done");           // 见下方 Step 5 说明:测试内私有 stub
        PlanExecuteAgent agent = new PlanExecuteAgent(
                llm, new ToolRegistry(), new SingleStepPlanner(llm), null,
                (goal, plan) -> PlanExecuteAgent.PlanReviewDecision.execute(),
                new java.io.PrintStream(java.io.OutputStream.nullOutputStream()),
                listener
        );

        agent.run("做一件事");

        assertTrue(events.get(0).startsWith("created:"), events.toString());
        assertTrue(events.stream().anyMatch(e -> e.startsWith("started:")), events.toString());
        assertTrue(events.stream().anyMatch(e -> e.startsWith("completed:") && e.endsWith(":true")), events.toString());
        assertEquals("finished", events.get(events.size() - 1), events.toString());
    }
}
```

**测试 stub 说明**：`SingleStepPlanner extends Planner` 覆写 `createPlan` 返回含 1 个 `Task` 的 `ExecutionPlan`；`FakeLlmClient` 覆写 `chat(...)` 直接回一个非空 content 的 `ChatResponse`、`supportsTools()` 返回 false。直接照抄 `PlanExecuteAgentTest` 里 `StubPlanner`/stub 客户端的构造方式（同包，可参考其私有类实现）。

- [ ] **Step 5: 跑测试确认失败→实现→通过**

Run: `mvn -q -DskipTests=false -Dtest=PlanProgressWiringTest -DfailIfNoTests=false test`
先确认编译/断言失败，补齐 Step 1-3 后再跑，Expected: PASS。

- [ ] **Step 6: 跑现有 Plan 测试确认零回归**

Run: `mvn -q -DskipTests=false -Dtest='PlanExecuteAgentTest,ExecutionPlanTest,PlannerTest,MainPlanAgentFactoryTest' -DfailIfNoTests=false test`
Expected: 全 PASS（默认构造走 NOOP，行为不变）。

- [ ] **Step 7: 提交**

```bash
git add src/main/java/com/lyhn/wraith/agent/PlanProgressListener.java \
        src/main/java/com/lyhn/wraith/agent/PlanExecuteAgent.java \
        src/test/java/com/lyhn/wraith/agent/PlanProgressWiringTest.java
git commit -m "feat(plan): PlanProgressListener 生命周期旁路(默认 NOOP,CLI 零回归)"
```

---

### Task A2: 步骤 `StreamListener` 工厂化（默认 = `TaskStreamRenderer`）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/agent/PlanExecuteAgent.java`
- Test: `src/test/java/com/lyhn/wraith/agent/PlanProgressWiringTest.java`（追加用例）

**Interfaces:**
- Produces: `PlanExecuteAgent` 新增可注入字段 `BiFunction<String, StreamState, LlmClient.StreamListener> stepStreamFactory`（`StreamState` 为 PlanExecuteAgent 内部类，工厂签名对外用 `java.util.function.BiFunction`）。默认工厂 = `(id, ss) -> new TaskStreamRenderer(id, ss, out)`。通过带 `progressListener` 的构造再加一个可选 setter `setStepStreamFactory(BiFunction<...>)`（避免构造爆参）。

- [ ] **Step 1: 加字段 + setter + 默认工厂**

在字段区加：
```java
    private java.util.function.BiFunction<String, StreamState, LlmClient.StreamListener> stepStreamFactory;
```
在最全参构造体内初始化默认：
```java
    this.stepStreamFactory = (taskId, ss) -> new TaskStreamRenderer(taskId, ss, this.out);
```
加 setter（供桌面注入）：
```java
    /** 桌面注入:把步骤流式正文导向 message.delta 而非终端 out。 */
    public void setStepStreamFactory(java.util.function.BiFunction<String, StreamState, LlmClient.StreamListener> factory) {
        if (factory != null) this.stepStreamFactory = factory;
    }
```

- [ ] **Step 2: `executeTask` 用工厂替换硬构造**

`executeTask(...)` 约 472 行：
```java
    // 旧:
    // TaskStreamRenderer streamRenderer = new TaskStreamRenderer(task.getId(), streamState, out);
    // 新:
    LlmClient.StreamListener streamRenderer = stepStreamFactory.apply(task.getId(), streamState);
```
下方对 `streamRenderer.finish()` / `hasStreamedOutput()` 的调用改为通过接口能力获取：`TaskStreamRenderer` 已实现 `LlmClient.StreamListener`；若 `finish()`/`hasStreamedOutput()` 不在 `StreamListener` 接口上，则给桌面监听器（Task A5）也实现同名方法，并在此处保留对具体能力的调用方式不变（若原来直接调 `TaskStreamRenderer` 的方法，则改为在 `StreamListener` 上补默认方法 `default void finish() {}` / `default boolean hasStreamedOutput() { return false; }`，两实现各自覆写）。

**实现注意**：先查 `LlmClient.StreamListener` 是否已有 `finish()`/`hasStreamedOutput()`。若无，在该接口加 `default` 方法（不破坏其它实现），`TaskStreamRenderer` 保持现有覆写。这是本任务唯一可能的接口改动，需一并跑 `LlmClient` 相关测试。

- [ ] **Step 3: 追加测试——自定义工厂被调用**

在 `PlanProgressWiringTest` 加：
```java
    @Test
    void 注入的步骤工厂接收正文流() {
        StringBuilder body = new StringBuilder();
        FakeLlmClient llm = new FakeLlmClient("hello-body");  // 该 stub 会向 StreamListener 推 content delta
        PlanExecuteAgent agent = new PlanExecuteAgent(
                llm, new ToolRegistry(), new SingleStepPlanner(llm), null,
                (g, p) -> PlanExecuteAgent.PlanReviewDecision.execute(),
                new java.io.PrintStream(java.io.OutputStream.nullOutputStream()),
                PlanProgressListener.NOOP);
        agent.setStepStreamFactory((id, ss) -> new LlmClient.StreamListener() {
            @Override public void onContentDelta(String delta) { body.append(delta); }
        });
        agent.run("做一件事");
        assertTrue(body.length() > 0, "自定义工厂应收到正文 delta");
    }
```
（`FakeLlmClient` 的 `chat` 需在返回前向传入的 `StreamListener` 推送若干 `onContentDelta`，以触达工厂产物。）

- [ ] **Step 4: 跑测试 + 零回归**

Run: `mvn -q -DskipTests=false -Dtest='PlanProgressWiringTest,PlanExecuteAgentTest' -DfailIfNoTests=false test`
Expected: 全 PASS（默认工厂 = 原 TaskStreamRenderer，现有断言不变）。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/agent/PlanExecuteAgent.java \
        src/test/java/com/lyhn/wraith/agent/PlanProgressWiringTest.java \
        src/main/java/com/lyhn/wraith/llm/LlmClient.java
git commit -m "feat(plan): 步骤 StreamListener 工厂化(默认 TaskStreamRenderer,可注入)"
```

---

### Task A3: `SessionRunner.runTurn` 带 mode 重载 + `handleTurn` 透传 mode

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerTurnModeTest.java`

**Interfaces:**
- Produces: `SessionRunner` 新 `default String runTurn(String input, List<ContentPart> imageParts, List<String> imageNames, String mode)`，默认体忽略 mode 调用旧 3 参重载。`handleTurn` 从 `params.mode`（缺省 `"react"`）读取并调 4 参重载。

- [ ] **Step 1: 接口加默认重载**

`AppServer.SessionRunner`（约 26-34 行）在现有带图 `runTurn` 之后加：
```java
        /** 带执行模式的重载(react|plan);默认忽略 mode,退化到带图重载。桌面覆写以支持 plan。 */
        default String runTurn(String input,
                               java.util.List<com.lyhn.wraith.llm.LlmClient.ContentPart> imageParts,
                               java.util.List<String> imageNames,
                               String mode) throws Exception {
            return runTurn(input, imageParts, imageNames);
        }
```

- [ ] **Step 2: `handleTurn` 读 mode 并透传**

`handleTurn`：读 `input` 后加：
```java
        String mode = (params != null && params.hasNonNull("mode")) ? params.get("mode").asText("react") : "react";
```
把线程内 `session.runTurn(effectiveInput, attFinal.imageParts(), attFinal.imageNames());` 改为：
```java
        session.runTurn(effectiveInput, attFinal.imageParts(), attFinal.imageNames(), mode);
```

- [ ] **Step 3: 写测试——mode 透传到 runner**

Create `AppServerTurnModeTest.java`，参考 `AppServerAutomationsControlPlaneTest` 的 stdin/stdout JSON-RPC 驱动方式。构造一个捕获 mode 的 stub `SessionRunner`（覆写 4 参 `runTurn` 记录 mode），喂一条 `{"method":"turn.submit","params":{"input":"x","mode":"plan"}}`，断言 stub 收到 `"plan"`；再喂一条不带 mode 的，断言收到 `"react"`。

```java
// 关键断言:
assertEquals("plan", captured.get(0));
assertEquals("react", captured.get(1));
```

- [ ] **Step 4: 跑测试**

Run: `mvn -q -DskipTests=false -Dtest=AppServerTurnModeTest -DfailIfNoTests=false test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerTurnModeTest.java
git commit -m "feat(appserver): turn.submit 带 mode → runTurn 4 参重载(默认 react,其它 runner 零改)"
```

---

### Task A4: 计划复审通道（`EventStreamRenderer` 镜像 approval）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java`
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/PlanReviewChannelTest.java`

**Interfaces:**
- Produces（`EventStreamRenderer` 公有方法）：
  - `record PlanReviewOutcome(String decision, String feedback) {}` — decision ∈ {"execute","supplement","cancel"}。
  - `PlanReviewOutcome requestPlanReview(String planId, String goal, java.util.List<java.util.Map<String,Object>> steps)` — 阻塞直到前端响应；发 `plan.review.requested`。
  - `void resolvePlanReview(String reviewId, String decision, String feedback)` — 完成 future。
  - `void emitPlanCreated(String planId, String goal, List<Map<String,Object>> steps)` / `emitPlanStepStarted(String planId, String stepId)` / `emitPlanStepCompleted(String planId, String stepId, boolean ok, String result)` — 供 Task A5 的 sink 调用（集中管理 base()/turnId）。

- [ ] **Step 1: `EventStreamRenderer` 加 plan 通知 + 复审管道**

在字段区加（仿 `pending`/`approvalSeq`）：
```java
    private final java.util.concurrent.atomic.AtomicLong reviewSeq = new java.util.concurrent.atomic.AtomicLong();
    private final Map<String, java.util.concurrent.CompletableFuture<PlanReviewOutcome>> pendingReviews =
            new java.util.concurrent.ConcurrentHashMap<>();

    public record PlanReviewOutcome(String decision, String feedback) {}
```
加通知发射方法：
```java
    public void emitPlanCreated(String planId, String goal, java.util.List<java.util.Map<String, Object>> steps) {
        Map<String, Object> p = base(); p.put("planId", planId); p.put("goal", goal); p.put("steps", steps);
        writer.notify("plan.created", p);
    }
    public void emitPlanStepStarted(String planId, String stepId) {
        Map<String, Object> p = base(); p.put("planId", planId); p.put("stepId", stepId);
        writer.notify("plan.step.started", p);
    }
    public void emitPlanStepCompleted(String planId, String stepId, boolean ok, String result) {
        Map<String, Object> p = base(); p.put("planId", planId); p.put("stepId", stepId);
        p.put("ok", ok); p.put("result", result);
        writer.notify("plan.step.completed", p);
    }
```
加复审阻塞管道（镜像 `promptApproval`）：
```java
    public PlanReviewOutcome requestPlanReview(String planId, String goal,
                                               java.util.List<java.util.Map<String, Object>> steps) {
        String reviewId = "review_" + reviewSeq.incrementAndGet();
        java.util.concurrent.CompletableFuture<PlanReviewOutcome> fut = new java.util.concurrent.CompletableFuture<>();
        pendingReviews.put(reviewId, fut);
        Map<String, Object> p = base();
        p.put("reviewId", reviewId); p.put("planId", planId); p.put("goal", goal); p.put("steps", steps);
        writer.notify("plan.review.requested", p);
        try {
            return fut.get();
        } catch (Exception e) {
            return new PlanReviewOutcome("cancel", null);   // 中断/异常 → 取消,避免线程悬挂
        } finally {
            pendingReviews.remove(reviewId);
        }
    }
    public void resolvePlanReview(String reviewId, String decision, String feedback) {
        java.util.concurrent.CompletableFuture<PlanReviewOutcome> fut = pendingReviews.get(reviewId);
        if (fut != null) fut.complete(new PlanReviewOutcome(decision == null ? "cancel" : decision, feedback));
    }
```

- [ ] **Step 2: `AppServer` 加 `case "plan.review.respond"`**

在 dispatch（`case "approval.respond"` 附近，约 182 行）加：
```java
            case "plan.review.respond" -> handlePlanReviewRespond(msg);
```
加处理器（仿 `handleApprovalRespond`）：
```java
    private void handlePlanReviewRespond(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String reviewId = (p != null && p.hasNonNull("reviewId")) ? p.get("reviewId").asText() : null;
        if (reviewId == null) { writer.error(msg.id(), -32602, "缺 reviewId"); return; }
        String decision = (p.hasNonNull("decision")) ? p.get("decision").asText("cancel") : "cancel";
        String feedback = p.hasNonNull("feedback") ? p.get("feedback").asText(null) : null;
        session.renderer().resolvePlanReview(reviewId, decision, feedback);
        writer.result(msg.id(), java.util.Map.of("ok", true));
    }
```
（`session.renderer()` 返回 `EventStreamRenderer`；若返回类型是 `Renderer` 接口，需在此 `instanceof EventStreamRenderer` 或给 SessionRunner 暴露 `resolvePlanReview` 转发。**实现注意**：先查 `SessionRunner.renderer()` 的返回类型——是 `EventStreamRenderer` 则直接调；是 `Renderer` 接口则加窄化。）

- [ ] **Step 3: 写测试——复审阻塞/响应**

Create `PlanReviewChannelTest.java`：新建 `EventStreamRenderer`（传一个捕获通知的 stub `JsonRpcWriter`）。另起线程调 `requestPlanReview("plan_1","g",steps)`；主线程从 stub 抓到 `plan.review.requested` 的 `reviewId` → 调 `resolvePlanReview(reviewId,"supplement","再加一步")` → 断言 `requestPlanReview` 返回 `PlanReviewOutcome("supplement","再加一步")`。再测 `emitPlanCreated/StepStarted/StepCompleted` 通知 method 名与 payload 键。

- [ ] **Step 4: 跑测试**

Run: `mvn -q -DskipTests=false -Dtest=PlanReviewChannelTest -DfailIfNoTests=false test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java \
        src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/PlanReviewChannelTest.java
git commit -m "feat(appserver): 计划复审通道 requestPlanReview/resolvePlanReview + plan.* 通知(镜像 approval)"
```

---

### Task A5: 桌面 sink——`EventStreamPlanListener` + `EventStreamStepListener`

**Files:**
- Create: `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamPlanListener.java`
- Create: `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamStepListener.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamPlanListenerTest.java`

**Interfaces:**
- Consumes: `EventStreamRenderer.emitPlanCreated/emitPlanStepStarted/emitPlanStepCompleted`（Task A4）；`LlmClient.StreamListener`（Task A2）；`EventStreamRenderer.appendAssistantContentDelta/appendThinking/beginThinking`（现有）。
- Produces:
  - `EventStreamPlanListener implements PlanProgressListener`，构造 `(EventStreamRenderer renderer, String planId)`。
  - `EventStreamStepListener implements LlmClient.StreamListener`，构造 `(EventStreamRenderer renderer)`；`onContentDelta` → `renderer.appendAssistantContentDelta`；`onReasoningDelta` → 首个非空触发 `beginThinking("计划步骤")` 再 `appendThinking`；`finish()` → `renderer.finishAssistantContent()`（默认方法覆写）。

- [ ] **Step 1: 写 `EventStreamPlanListener`**

```java
package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.agent.PlanProgressListener;
import com.lyhn.wraith.plan.ExecutionPlan;
import com.lyhn.wraith.plan.Task;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 把 Plan 生命周期翻译成 plan.* JSON-RPC 通知(桌面 sink)。 */
public final class EventStreamPlanListener implements PlanProgressListener {
    private final EventStreamRenderer renderer;
    private final String planId;

    public EventStreamPlanListener(EventStreamRenderer renderer, String planId) {
        this.renderer = renderer;
        this.planId = planId;
    }

    static List<Map<String, Object>> stepsOf(ExecutionPlan plan) {
        List<Map<String, Object>> steps = new ArrayList<>();
        for (String id : plan.getExecutionOrder()) {
            Task t = plan.getTask(id);
            if (t == null) continue;
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("id", t.getId());
            s.put("description", t.getDescription());
            s.put("deps", t.getDependencies());
            steps.add(s);
        }
        return steps;
    }

    @Override public void planCreated(ExecutionPlan plan) {
        renderer.emitPlanCreated(planId, plan.getGoal(), stepsOf(plan));
    }
    @Override public void stepStarted(String stepId) { renderer.emitPlanStepStarted(planId, stepId); }
    @Override public void stepCompleted(String stepId, boolean ok, String result) {
        renderer.emitPlanStepCompleted(planId, stepId, ok, result);
    }
    @Override public void planFinished(String finalResult) { renderer.finishAssistantContent(); }
}
```

- [ ] **Step 2: 写 `EventStreamStepListener`**

```java
package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.llm.LlmClient;

/** 把 Plan 步骤的流式正文导向 message.delta / thinking.*(桌面 sink)。 */
public final class EventStreamStepListener implements LlmClient.StreamListener {
    private final EventStreamRenderer renderer;
    private boolean thinkingBegun;

    public EventStreamStepListener(EventStreamRenderer renderer) { this.renderer = renderer; }

    @Override public void onContentDelta(String delta) {
        if (delta == null || delta.isEmpty()) return;
        renderer.appendAssistantContentDelta(delta);
    }
    @Override public void onReasoningDelta(String delta) {
        if (delta == null || delta.isBlank()) return;
        if (!thinkingBegun) { renderer.beginThinking("计划步骤"); thinkingBegun = true; }
        renderer.appendThinking(delta);
    }
    // finish()/hasStreamedOutput() 若在 StreamListener 上有 default,则按需覆写;正文 message.end 由 planFinished 统一收口。
}
```

- [ ] **Step 3: 写测试**

Create `EventStreamPlanListenerTest.java`：用 stub `JsonRpcWriter` 捕获通知。构造 `EventStreamRenderer` + `EventStreamPlanListener(renderer,"plan_1")`；喂一个含 2 步的 `ExecutionPlan`（用 `plan` 包的真实 `ExecutionPlan`/`Task` 构造）；调 `planCreated`→断言发 `plan.created`、steps 长度 2、键含 id/description/deps；调 `stepStarted("t1")`/`stepCompleted("t1",true,"ok")`→断言对应通知与 payload。

- [ ] **Step 4: 跑测试**

Run: `mvn -q -DskipTests=false -Dtest=EventStreamPlanListenerTest -DfailIfNoTests=false test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamPlanListener.java \
        src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamStepListener.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamPlanListenerTest.java
git commit -m "feat(appserver): 桌面 Plan sink(EventStreamPlanListener + EventStreamStepListener)"
```

---

### Task A6: `Main.java` 桌面 runner 装配 mode=plan

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`（匿名 `SessionRunner`，约 1200 行）

**Interfaces:**
- Consumes: 全部 A1-A5 产物。
- Produces: 桌面 `runTurn(input, imageParts, imageNames, mode)` 覆写。

- [ ] **Step 1: 覆写带 mode 的 runTurn**

在匿名 `SessionRunner`（约 1200 行）加：
```java
    public String runTurn(String input, java.util.List<com.lyhn.wraith.llm.LlmClient.ContentPart> imageParts,
                          java.util.List<String> imageNames, String mode) throws Exception {
        if (!"plan".equals(mode)) {
            return runTurn(input, imageParts, imageNames);   // ReAct 原路径不变
        }
        String expanded = input;
        com.lyhn.wraith.mcp.McpServerManager m = appServerMcp.manager();
        if (m != null) expanded = new com.lyhn.wraith.mcp.mention.AtMentionExpander(m).expand(input);
        final String goal = expanded;

        com.lyhn.wraith.runtime.appserver.EventStreamRenderer esr =
                (com.lyhn.wraith.runtime.appserver.EventStreamRenderer) renderer;   // 桌面 renderer 即 EventStreamRenderer
        String planId = "plan_" + java.lang.System.identityHashCode(goal);          // 本轮合成 id(禁用 Date/random,用 identityHashCode)

        // 复审桥:计划生成 → 路由到 UI → 映射回 PlanReviewDecision
        com.lyhn.wraith.agent.PlanExecuteAgent.PlanReviewHandler reviewHandler = (g, plan) -> {
            java.util.List<java.util.Map<String, Object>> steps =
                    com.lyhn.wraith.runtime.appserver.EventStreamPlanListener.stepsOf(plan);
            var outcome = esr.requestPlanReview(planId, g, steps);
            return switch (outcome.decision()) {
                case "supplement" -> com.lyhn.wraith.agent.PlanExecuteAgent.PlanReviewDecision.supplement(outcome.feedback());
                case "cancel" -> com.lyhn.wraith.agent.PlanExecuteAgent.PlanReviewDecision.cancel();
                default -> com.lyhn.wraith.agent.PlanExecuteAgent.PlanReviewDecision.execute();
            };
        };

        // out=discard(绝不写协议 stdout);生命周期 → 桌面 sink;步骤流 → message.delta。
        java.io.PrintStream discard = new java.io.PrintStream(java.io.OutputStream.nullOutputStream());
        com.lyhn.wraith.agent.PlanExecuteAgent planAgent = new com.lyhn.wraith.agent.PlanExecuteAgent(
                currentClient[0], agent.getToolRegistry(), null, agent.getMemoryManager(),
                reviewHandler, discard,
                new com.lyhn.wraith.runtime.appserver.EventStreamPlanListener(esr, planId));
        planAgent.setStepStreamFactory((id, ss) -> new com.lyhn.wraith.runtime.appserver.EventStreamStepListener(esr));
        planAgent.setExternalContextSupplier(appServerMcp::resourceIndexForPrompt);
        // skill 装配若桌面 runner 已持有 skillRegistry/buffer,则一并 set(参考 CLI createPlanAgent 的 set 序列)。

        com.lyhn.wraith.snapshot.SnapshotService snap = agent.getToolRegistry().getSnapshotService();
        return snap.runTurn("plan", goal, () -> planAgent.run(goal));
    }
```
**实现注意**：
- `renderer`/`agent`/`currentClient`/`appServerMcp`/`sessionStore` 等是匿名类闭包捕获的外层变量——按该匿名类现有可见变量名对齐（`agent` = reactAgent；`currentClient[0]` = 当前 client；见 1200-1240 区）。
- `PlanExecuteAgent` 6+listener 参构造须存在（Task A1）；构造入参 `planner` 传 `null`（内部会 `new Planner(llmClient)`，与 CLI createPlanAgent 一致）。
- `PlanExecuteAgent.getToolRegistry()`/`getMemoryManager()` 若不存在，则改用桌面 runner 已持有的 toolRegistry/memoryManager 引用（对齐 3 参 runTurn 里 `agent.run` 用的同一套）。

- [ ] **Step 2: 编译 + 现有 appserver/agent 测试**

Run: `mvn -q -DskipTests=false -Dtest='PlanProgressWiringTest,PlanReviewChannelTest,EventStreamPlanListenerTest,AppServerTurnModeTest,PlanExecuteAgentTest' -DfailIfNoTests=false test`
Expected: 全 PASS + 编译通过。

- [ ] **Step 3: 提交**

```bash
git add src/main/java/com/lyhn/wraith/cli/Main.java
git commit -m "feat(desktop-backend): mode=plan 装配 PlanExecuteAgent(out=discard + 桌面 sink + 复审桥 + 快照)"
```

---

## Phase B — 前端

### Task B1: 类型 + IPC 接线（submitTurn mode + respondPlanReview）

**Files:**
- Modify: `desktop/src/shared/types.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/main/index.ts`

**Interfaces:**
- Produces:
  - `type RunMode = 'react' | 'plan'`
  - `window.wraith.submitTurn(input, attachments?, mode?: RunMode)`
  - `window.wraith.respondPlanReview(reviewId: string, decision: 'execute'|'supplement'|'cancel', feedback?: string)`
  - 事件 payload 类型：`PlanCreatedEvent`/`PlanStepStartedEvent`/`PlanStepCompletedEvent`/`PlanReviewRequestedEvent`。

- [ ] **Step 1: types.ts 加类型**

```typescript
export type RunMode = 'react' | 'plan'
export interface PlanStepView { id: string; description: string; deps: string[] }
export interface PlanCreatedEvent { planId: string; goal: string; steps: PlanStepView[] }
export interface PlanStepStartedEvent { planId: string; stepId: string }
export interface PlanStepCompletedEvent { planId: string; stepId: string; ok: boolean; result?: string }
export interface PlanReviewRequestedEvent { reviewId: string; planId: string; goal: string; steps: PlanStepView[] }
```

- [ ] **Step 2: preload 加 mode + respondPlanReview**

`submitTurn`（约 104 行）：
```typescript
  submitTurn(input: string, attachments?: { path: string; kind: string }[], mode?: import('../shared/types').RunMode) {
    return ipcRenderer.invoke('wraith:submitTurn', input, attachments, mode ?? 'react')
  },
```
新增：
```typescript
  respondPlanReview(reviewId: string, decision: 'execute'|'supplement'|'cancel', feedback?: string) {
    return ipcRenderer.invoke('wraith:respondPlanReview', reviewId, decision, feedback ?? null) as Promise<{ ok: boolean }>
  },
```
（同步更新 preload 的 `window.wraith` 类型声明块 / `src/shared/types.ts` 里的 `WraithApi` 接口，补这两个签名。）

- [ ] **Step 3: main/index.ts 透传 mode + 加 respondPlanReview handler**

`wraith:submitTurn`（约 262 行）签名加 `mode`，请求体加 mode：
```typescript
ipcMain.handle('wraith:submitTurn', async (_e, input: string, attachments?: {...}[], mode?: 'react'|'plan') => {
  if (!client) throw new Error('Backend not connected')
  currentTurnId = null
  const result = await client.request('turn.submit', {
    sessionId: currentSessionId, input,
    ...(attachments?.length ? { attachments: attachments.map(a => ({ path: a.path, kind: a.kind })) } : {}),
    mode: mode ?? 'react',
  })
  // ...余下不变
})
```
新增 handler（放在 `wraith:respondApproval` 附近）：
```typescript
ipcMain.handle('wraith:respondPlanReview', async (_e, reviewId: string, decision: string, feedback: string | null) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('plan.review.respond', { reviewId, decision, ...(feedback ? { feedback } : {}) })
})
```

- [ ] **Step 4: 门禁（IPC 无单测,靠类型 + 构建）**

Run: `cd desktop && npm run typecheck && npm run build`
Expected: typecheck 0、build ✓。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/shared/types.ts desktop/src/preload/index.ts desktop/src/main/index.ts
git commit -m "feat(desktop): IPC——submitTurn 带 mode + respondPlanReview + plan 事件类型"
```

---

### Task B2: `transcriptReducer` 消费 plan.* 事件 → 计划清单 item

**Files:**
- Modify: `desktop/src/shared/transcriptReducer.ts`
- Test: `desktop/test/transcriptReducerPlan.test.ts`

**Interfaces:**
- Consumes: B1 的事件类型。
- Produces: transcript item `{ type: 'plan'; planId; goal; steps: Array<{ id; description; status: 'pending'|'running'|'done'|'failed'; result?: string }> }`；复审 item `{ type: 'planReview'; reviewId; planId; goal; steps }`（`plan.review.requested` 生成，响应后由前端标记 resolved）。

- [ ] **Step 1: 写失败测试**

Create `desktop/test/transcriptReducerPlan.test.ts`：
```typescript
import { describe, it, expect } from 'vitest'
import { transcriptReducer, initialTranscriptState } from '../src/shared/transcriptReducer'

describe('transcriptReducer plan events', () => {
  it('plan.created 建计划 item,步骤初始 pending', () => {
    const s = transcriptReducer(initialTranscriptState(), {
      type: 'plan.created',
      planId: 'p1', goal: '目标', steps: [{ id: 't1', description: '步骤一', deps: [] }],
    } as never)
    const item = s.items.find(i => i.type === 'plan') as never
    expect(item).toBeTruthy()
    expect((item as { steps: unknown[] }).steps[0]).toMatchObject({ id: 't1', status: 'pending' })
  })

  it('step.started → running,step.completed(ok) → done,(fail) → failed', () => {
    let s = transcriptReducer(initialTranscriptState(), { type: 'plan.created', planId: 'p1', goal: 'g', steps: [{ id: 't1', description: 'a', deps: [] }] } as never)
    s = transcriptReducer(s, { type: 'plan.step.started', planId: 'p1', stepId: 't1' } as never)
    expect(planStep(s, 't1').status).toBe('running')
    s = transcriptReducer(s, { type: 'plan.step.completed', planId: 'p1', stepId: 't1', ok: true, result: 'r' } as never)
    expect(planStep(s, 't1').status).toBe('done')
  })
})

function planStep(s: { items: Array<{ type: string }> }, id: string): { status: string } {
  const p = s.items.find(i => i.type === 'plan') as { steps: Array<{ id: string; status: string }> }
  return p.steps.find(st => st.id === id)!
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/transcriptReducerPlan.test.ts`
Expected: FAIL（reducer 尚未处理 plan.* / 无 plan item 类型）。

- [ ] **Step 3: 实现 reducer 分支**

在 `transcriptReducer` 的 `switch` 里加（参考现有 `tool.call`/`tool.result` 分支的 item 更新写法）：
```typescript
    case 'plan.created':
      return { ...state, items: [...state.items, {
        type: 'plan', planId: ev.planId, goal: ev.goal,
        steps: ev.steps.map(s => ({ id: s.id, description: s.description, status: 'pending' as const })),
      }] }
    case 'plan.step.started':
      return updatePlanStep(state, ev.planId, ev.stepId, st => ({ ...st, status: 'running' }))
    case 'plan.step.completed':
      return updatePlanStep(state, ev.planId, ev.stepId, st => ({ ...st, status: ev.ok ? 'done' : 'failed', result: ev.result }))
    case 'plan.review.requested':
      return { ...state, items: [...state.items, {
        type: 'planReview', reviewId: ev.reviewId, planId: ev.planId, goal: ev.goal,
        steps: ev.steps, resolved: false,
      }] }
```
加 helper（文件内）：
```typescript
function updatePlanStep(state, planId, stepId, fn) {
  return { ...state, items: state.items.map(it =>
    it.type === 'plan' && it.planId === planId
      ? { ...it, steps: it.steps.map(st => st.id === stepId ? fn(st) : st) }
      : it) }
}
```
并在 item 联合类型 + 事件联合类型里补 `plan`/`planReview` 与四个事件（沿用现有类型定义位置与风格）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/transcriptReducerPlan.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/shared/transcriptReducer.ts desktop/test/transcriptReducerPlan.test.ts
git commit -m "feat(desktop): transcriptReducer 消费 plan.* 事件建计划清单 + 复审 item"
```

---

### Task B3: `planStatus` 纯函数 + `PlanCard` 组件 + 复审卡

**Files:**
- Create: `desktop/src/renderer/lib/planStatus.ts`
- Create: `desktop/src/renderer/components/PlanCard.tsx`
- Test: `desktop/test/planStatus.test.ts`

**Interfaces:**
- Produces: `planStatusIcon(status): string`、`planStatusClass(status): string`；`PlanCard` 组件消费 B2 的 plan/planReview item + `onReview(reviewId, decision, feedback?)` 回调。

- [ ] **Step 1: 写 planStatus 测试**

```typescript
import { describe, it, expect } from 'vitest'
import { planStatusIcon } from '../src/renderer/lib/planStatus'

describe('planStatusIcon', () => {
  it('映射四态', () => {
    expect(planStatusIcon('pending')).toBe('○')
    expect(planStatusIcon('running')).toBe('◐')
    expect(planStatusIcon('done')).toBe('✓')
    expect(planStatusIcon('failed')).toBe('✗')
  })
})
```

- [ ] **Step 2: 实现 planStatus.ts**

```typescript
export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed'

export function planStatusIcon(s: PlanStepStatus): string {
  switch (s) { case 'pending': return '○'; case 'running': return '◐'; case 'done': return '✓'; case 'failed': return '✗' }
}
export function planStatusClass(s: PlanStepStatus): string {
  switch (s) {
    case 'running': return 'text-accent'
    case 'done': return 'text-green-500'
    case 'failed': return 'text-danger'
    default: return 'text-fg-subtle'
  }
}
```

- [ ] **Step 3: 跑 planStatus 测试**

Run: `cd desktop && npx vitest run test/planStatus.test.ts`
Expected: PASS。

- [ ] **Step 4: 写 `PlanCard.tsx`（UI，靠 typecheck/build/eyeverify）**

```tsx
import { useState } from 'react'
import { planStatusIcon, planStatusClass, type PlanStepStatus } from '../lib/planStatus'

interface PlanStep { id: string; description: string; status: PlanStepStatus; result?: string }
interface PlanItem { type: 'plan'; planId: string; goal: string; steps: PlanStep[] }
interface PlanReviewItem { type: 'planReview'; reviewId: string; planId: string; goal: string; steps: { id: string; description: string }[]; resolved: boolean }

export function PlanChecklist({ item }: { item: PlanItem }): JSX.Element {
  return (
    <div className="rounded-lg border border-border p-3 text-xs">
      <div className="mb-2 font-medium text-fg">计划 · {item.goal}</div>
      <ul className="flex flex-col gap-1">
        {item.steps.map(s => (
          <li key={s.id} className="flex items-start gap-2">
            <span className={planStatusClass(s.status)}>{planStatusIcon(s.status)}</span>
            <span className="text-fg-muted">{s.description}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function PlanReviewCard(
  { item, onReview }: { item: PlanReviewItem; onReview: (reviewId: string, decision: 'execute'|'supplement'|'cancel', feedback?: string) => void },
): JSX.Element {
  const [supplementing, setSupplementing] = useState(false)
  const [feedback, setFeedback] = useState('')
  if (item.resolved) return <></>
  return (
    <div className="rounded-lg border border-accent p-3 text-xs">
      <div className="mb-2 font-medium text-fg">复审计划 · {item.goal}</div>
      <ul className="mb-3 flex flex-col gap-1">
        {item.steps.map(s => <li key={s.id} className="text-fg-muted">• {s.description}</li>)}
      </ul>
      {supplementing ? (
        <div className="flex flex-col gap-2">
          <textarea data-testid="plan-supplement" value={feedback} onChange={e => setFeedback(e.target.value)}
            className="rounded border border-border bg-surface p-2" placeholder="补充要求…" />
          <div className="flex gap-2">
            <button className="rounded border border-accent px-2 py-1 text-accent"
              onClick={() => onReview(item.reviewId, 'supplement', feedback)}>提交补充</button>
            <button className="rounded border border-border px-2 py-1" onClick={() => setSupplementing(false)}>返回</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button data-testid="plan-execute" className="rounded border border-accent px-2 py-1 text-accent"
            onClick={() => onReview(item.reviewId, 'execute')}>执行</button>
          <button className="rounded border border-border px-2 py-1" onClick={() => setSupplementing(true)}>补充</button>
          <button data-testid="plan-cancel" className="rounded border border-danger px-2 py-1 text-danger"
            onClick={() => onReview(item.reviewId, 'cancel')}>取消</button>
        </div>
      )}
    </div>
  )
}
```
在渲染 transcript items 的组件（transcript 列表处，参考现有 `tool`/`message` item 的分支渲染）接上：`item.type==='plan'` → `<PlanChecklist>`；`item.type==='planReview'` → `<PlanReviewCard onReview={handlePlanReview}>`，其中 `handlePlanReview = (id,d,fb)=>{ void window.wraith.respondPlanReview(id,d,fb); dispatch(markPlanReviewResolved(id)) }`（`markPlanReviewResolved` 在 reducer 加一个 action 把该 planReview item 置 `resolved:true`）。

- [ ] **Step 5: 门禁**

Run: `cd desktop && npm run typecheck && npx vitest run test/planStatus.test.ts && npm run build`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/lib/planStatus.ts desktop/src/renderer/components/PlanCard.tsx \
        desktop/src/shared/transcriptReducer.ts desktop/test/planStatus.test.ts
git commit -m "feat(desktop): PlanCard 计划清单 + 复审卡 + planStatus 纯函数"
```

---

### Task B4: Composer 模式选择器 + App `pendingMode`（逐条复位）

**Files:**
- Modify: `desktop/src/renderer/App.tsx`
- Modify: `desktop/src/renderer/components/Composer.tsx`
- Test: `desktop/test/composerMode.test.ts`

**Interfaces:**
- Consumes: `submitTurn(..., mode)`（B1）。
- Produces: App `pendingMode: RunMode` 状态；提交后复位 `'react'`；Composer props `mode`/`onModeChange`。

- [ ] **Step 1: 写复位逻辑纯函数 + 测试**

抽一个纯函数 `desktop/src/renderer/lib/nextPendingMode.ts`：
```typescript
import type { RunMode } from '../../shared/types'
/** 提交后模式复位:逐条语义——发完永远回 react。 */
export function pendingModeAfterSubmit(_current: RunMode): RunMode { return 'react' }
```
测试 `desktop/test/composerMode.test.ts`：
```typescript
import { describe, it, expect } from 'vitest'
import { pendingModeAfterSubmit } from '../src/renderer/lib/nextPendingMode'
describe('pendingModeAfterSubmit', () => {
  it('提交后永远复位 react', () => {
    expect(pendingModeAfterSubmit('plan')).toBe('react')
    expect(pendingModeAfterSubmit('react')).toBe('react')
  })
})
```

- [ ] **Step 2: 跑测试**

Run: `cd desktop && npx vitest run test/composerMode.test.ts`
Expected: PASS。

- [ ] **Step 3: App.tsx 接 pendingMode**

- 加 state：`const [pendingMode, setPendingMode] = useState<RunMode>('react')`。
- `handleSubmit` 里把 mode 传进去并复位：
  ```typescript
  await window.wraith.submitTurn(input, atts, pendingMode)
  setPendingMode(pendingModeAfterSubmit(pendingMode))
  ```
- 给 `<Composer>` 传 `mode={pendingMode} onModeChange={setPendingMode}`。

- [ ] **Step 4: Composer 加分段控件**

在工具条（`替我审批` label 附近，约 300 行）加：
```tsx
        {/* 模式分段:逐条 */}
        <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5 text-xs" role="radiogroup" aria-label="执行模式">
          {(['react', 'plan'] as const).map(m => (
            <button key={m} data-testid={`mode-${m}`} role="radio" aria-checked={mode === m}
              onClick={() => onModeChange(m)}
              className={'rounded px-2 py-0.5 ' + (mode === m ? 'bg-accent text-accent-fg' : 'text-fg-muted')}>
              {m === 'react' ? 'ReAct' : 'Plan'}
            </button>
          ))}
        </div>
```
Composer props 接口加 `mode: RunMode; onModeChange: (m: RunMode) => void`。

- [ ] **Step 5: 门禁**

Run: `cd desktop && npm run typecheck && npx vitest run && npm run build`
Expected: typecheck 0、vitest 全绿、build ✓。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/App.tsx desktop/src/renderer/components/Composer.tsx \
        desktop/src/renderer/lib/nextPendingMode.ts desktop/test/composerMode.test.ts
git commit -m "feat(desktop): Composer 模式分段选择器(逐条,发完复位 react)"
```

---

## 收尾：重建部署 jar + 眼验

- [ ] **Step 1: 全量门禁**

```bash
cd desktop && npm run typecheck && npx vitest run && npm run build
cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest='PlanProgressWiringTest,PlanReviewChannelTest,EventStreamPlanListenerTest,AppServerTurnModeTest,PlanExecuteAgentTest,ExecutionPlanTest,PlannerTest' -DfailIfNoTests=false test
```

- [ ] **Step 2: 重建 + 部署 fat jar**

```bash
cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests package && cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar
```

- [ ] **Step 3: 眼验清单**（重启桌面 App）
  - Composer 出现 `ReAct | Plan` 分段；选 Plan 发一条 → 弹计划复审卡（步骤列表 + 执行/补充/取消）。
  - 点「执行」→ 计划清单逐步点亮（○→◐→✓），失败步骤显 ✗（红）；步骤正文干净流式（无 ANSI/task-id 前缀残留）。
  - 点「补充」输入反馈 → 重新弹复审（计划已按反馈调整）。
  - 点「取消」→ 该轮结束、不执行。
  - 发送后模式分段自动回到 ReAct。
  - CLI 侧 `wraith` 跑 `/plan <任务>` 观感与之前一致（零回归）。

---

## Self-Review（写完对照 spec）

**Spec coverage**：§1 分派链路→A3+A6+B1+B4；§2 PlanProgressListener 双 sink→A1+A5+A6；§3 线协议→A4(通知)+A5+B1(类型)+B2(消费)；§4 复审→A4+A6+B3；§5 前端→B2+B3+B4；§6 横切(取消/审批/快照/持久化)→A6(快照 wrap + 复审中断→cancel)+现有 HITL 不动；§7 测试→各任务 TDD + 收尾;§8 YAGNI/Team→本计划不含 Team。覆盖完整。

**Placeholder scan**：无 TBD/TODO；「实现注意」处均给出判定方法与回退方案（如 `finish()` 是否在接口上、`renderer()` 返回类型窄化、闭包变量名对齐），非占位。

**Type consistency**：`PlanReviewOutcome(decision, feedback)`、`requestPlanReview(planId, goal, steps)`、`emitPlanCreated/StepStarted/StepCompleted`、`EventStreamPlanListener.stepsOf`、reducer `plan`/`planReview` item、`RunMode`、`respondPlanReview(reviewId, decision, feedback?)` 在前后任务间一致。复审决策枚举：后端 `execute|supplement|cancel`（A4/A6），前端 `execute|supplement|cancel`（B1/B3）一致。
