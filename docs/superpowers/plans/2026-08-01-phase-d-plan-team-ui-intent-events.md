# Phase D：Plan/Team 的 UI 意图 tool.call 贯通 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `open_panel` / `im_connect` 的动作卡在 **ReAct / Plan / Team 三种模式**都能显示,消除「模型说已呈现入口、屏幕上什么都没有」的说谎缺口。

**Architecture:** 给 `PlanExecuteAgent` 与 `SubAgent` 各加一个**默认 no-op 的工具调用观察者**(`Consumer<List<LlmClient.ToolCall>>`),在它们现有 `printToolCalls(out, …)` 处同步触发;`AgentOrchestrator` 把观察者扇出给 planner/workers/reviewer。桌面接线时把观察者接到 `EventStreamRenderer.appendToolCalls`,并用新的纯函数 `UiIntentTools.filter` **只放行 `open_panel` / `im_connect`**。CLI 不注入观察者 → 默认 no-op,终端输出字节不变。**桌面渲染层零改动**(reducer 按工具名特判,与来源模式无关)。

**Tech Stack:** Java 17 / Maven(`com.lyhn.wraith`)。桌面(Electron/React)本期**不改代码**,仅跑回归。

## Global Constraints

- 中文回复用户;代码 / 命令 / 文件名 / 路径保留原文。
- 所有 git 提交信息**必须**以这两行结尾(逐字):
  - `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  - `Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ`
- `git add` **只**加本任务列出的文件;**绝不** `git add .` / `git add -A`;**绝不**触碰 WIP 文件:`README.md`、`demo/pom.xml`、`.claude/settings.json`、`demo/src/Hello.java`、`progress.md`。
- push 需用户显式同意;只 push 当前分支 `feat/windows-parity-block1`。
- **测试跳过坑**:本仓库测试默认跳过,所有 `mvn` 命令**必须**带 `-DskipTests=false`。
- **只放行 UI 意图工具**(`open_panel`/`im_connect`)。**绝不**放行全部工具调用 —— Plan/Team 路径不产出 `tool.result`,全量放行会让每张 ToolCard 永久停在「运行中」(僵尸卡),并破坏 Plan/Team「只展示步骤产出」的既有 UX。
- **CLI 零回归**:观察者默认 no-op,`printToolCalls(out, …)` 现有调用**一行都不删**,终端输出字节不变。
- **桌面渲染层零改动**:不改 `transcriptReducer.ts` / 任何组件。
- 观察者触发**不得影响主路径**:观察者抛异常必须被吞掉(仿 `ToolRegistry` 的 `writeFileObserver` / `todoSink` 范式:`catch (Exception ignored)`)。

---

## 文件结构

- Create: `src/main/java/com/lyhn/wraith/tool/UiIntentTools.java` —— UI 意图工具名集合 + `filter` 纯函数。
- Create: `src/test/java/com/lyhn/wraith/tool/UiIntentToolsTest.java`
- Modify: `src/main/java/com/lyhn/wraith/agent/SubAgent.java` —— 加 `setToolCallObserver` + 在 `:239` 触发。
- Modify: `src/main/java/com/lyhn/wraith/agent/AgentOrchestrator.java` —— 加 `setToolCallObserver`(扇出给 planner/workers/reviewer)+ 测试用 package-private 访问器。
- Modify: `src/main/java/com/lyhn/wraith/agent/PlanExecuteAgent.java` —— 加 `setToolCallObserver` + 在 `:609` 触发。
- Create: `src/test/java/com/lyhn/wraith/agent/ToolCallObserverTest.java` —— SubAgent / PlanExecuteAgent / 扇出 三组断言。
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java` —— Team(~`:2017`)与 Plan(~`:2107`)两处接线各一行。

---

### Task 1: `UiIntentTools` 纯函数

**Files:**
- Create: `src/main/java/com/lyhn/wraith/tool/UiIntentTools.java`
- Create: `src/test/java/com/lyhn/wraith/tool/UiIntentToolsTest.java`

**Interfaces:**
- Consumes: `com.lyhn.wraith.llm.LlmClient.ToolCall`(`record ToolCall(String id, Function function)`,`record Function(String name, String arguments)`,见 `LlmClient.java:180-182`)。
- Produces: `UiIntentTools.NAMES`(`Set<String>`)、`UiIntentTools.filter(List<ToolCall>) : List<ToolCall>`。Task 4 的 Main 接线消费之。

- [ ] **Step 1: 写失败测试**

创建 `src/test/java/com/lyhn/wraith/tool/UiIntentToolsTest.java`:

```java
package com.lyhn.wraith.tool;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class UiIntentToolsTest {

    private static LlmClient.ToolCall call(String id, String name) {
        return new LlmClient.ToolCall(id, new LlmClient.ToolCall.Function(name, "{}"));
    }

    @Test
    void filterKeepsOnlyUiIntentTools() {
        List<LlmClient.ToolCall> in = List.of(
                call("a", "read_file"),
                call("b", "open_panel"),
                call("c", "execute_command"),
                call("d", "im_connect"));
        List<LlmClient.ToolCall> out = UiIntentTools.filter(in);
        assertEquals(2, out.size());
        assertEquals("open_panel", out.get(0).function().name());
        assertEquals("im_connect", out.get(1).function().name());
    }

    @Test
    void filterReturnsEmptyWhenNoUiIntentTool() {
        assertTrue(UiIntentTools.filter(List.of(call("a", "read_file"))).isEmpty());
    }

    @Test
    void filterIsNullAndEmptySafe() {
        assertTrue(UiIntentTools.filter(null).isEmpty());
        assertTrue(UiIntentTools.filter(List.of()).isEmpty());
    }

    @Test
    void filterToleratesNullFunctionOrName() {
        // 极端防御:function 为 null 的畸形 ToolCall 不能让过滤炸掉
        List<LlmClient.ToolCall> in = List.of(new LlmClient.ToolCall("x", null), call("b", "open_panel"));
        List<LlmClient.ToolCall> out = UiIntentTools.filter(in);
        assertEquals(1, out.size());
        assertEquals("open_panel", out.get(0).function().name());
    }

    @Test
    void namesContainsExactlyTheTwoUiIntentTools() {
        assertEquals(java.util.Set.of("open_panel", "im_connect"), UiIntentTools.NAMES);
    }
}
```

- [ ] **Step 2: 运行,确认失败**

Run: `mvn -q -DskipTests=false -Dtest=UiIntentToolsTest test`
Expected: FAIL —— 编译错误 `cannot find symbol: UiIntentTools`。

- [ ] **Step 3: 实现**

创建 `src/main/java/com/lyhn/wraith/tool/UiIntentTools.java`:

```java
package com.lyhn.wraith.tool;

import com.lyhn.wraith.llm.LlmClient;

import java.util.List;
import java.util.Set;

/**
 * UI 意图工具(open_panel / im_connect)—— 它们没有文件/命令副作用,只是让桌面渲染层
 * 把这次 tool.call 特判成可交互动作卡。
 *
 * Plan/Team 模式的执行器只放行这两个工具的 tool.call 事件:这两者被归约成 action / im-bind
 * transcript 项,不依赖 tool.result;而放行普通工具会让 ToolCard 永久停在「运行中」
 * (Plan/Team 路径不产出 tool.result)。
 */
public final class UiIntentTools {
    private UiIntentTools() {}

    /** 需要在所有模式下贯通到渲染层的工具名。 */
    public static final Set<String> NAMES = Set.of("open_panel", "im_connect");

    /** 只保留 UI 意图工具的调用;null/空/畸形(function 为 null)安全。 */
    public static List<LlmClient.ToolCall> filter(List<LlmClient.ToolCall> calls) {
        if (calls == null || calls.isEmpty()) {
            return List.of();
        }
        return calls.stream()
                .filter(c -> c != null && c.function() != null && NAMES.contains(c.function().name()))
                .toList();
    }
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `mvn -q -DskipTests=false -Dtest=UiIntentToolsTest test`
Expected: PASS(5/5)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/tool/UiIntentTools.java src/test/java/com/lyhn/wraith/tool/UiIntentToolsTest.java
git commit -m "feat(tool): UiIntentTools——UI 意图工具名集合 + 只放行它们的 filter 纯函数(Phase D1)"
```

---

### Task 2: `SubAgent` / `AgentOrchestrator` 工具调用观察者

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/agent/SubAgent.java`(字段区 `:46-55`;调用点 `:239`)
- Modify: `src/main/java/com/lyhn/wraith/agent/AgentOrchestrator.java`(字段/setter 区 `:56-60`;扇出仿 `setSkillSystem` `:145-158`)
- Create: `src/test/java/com/lyhn/wraith/agent/ToolCallObserverTest.java`

**Interfaces:**
- Consumes: `LlmClient.ToolCall`;既有 `printToolCalls(out, response.toolCalls())`(SubAgent `:239`)。
- Produces:
  - `SubAgent.setToolCallObserver(java.util.function.Consumer<java.util.List<LlmClient.ToolCall>>)`
  - `AgentOrchestrator.setToolCallObserver(java.util.function.Consumer<java.util.List<LlmClient.ToolCall>>)`(扇出给 planner/workers/reviewer)
  - `AgentOrchestrator.workersForTest() : List<SubAgent>`(package-private,仅测试扇出用)
  Task 4 的 Main 接线消费 orchestrator 的 setter。

- [ ] **Step 1: 写失败测试**

创建 `src/test/java/com/lyhn/wraith/agent/ToolCallObserverTest.java`:

```java
package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Plan/Team 执行器把工具调用同步交给观察者(桌面据此发 tool.call,让动作卡在这两个模式也显示)。 */
class ToolCallObserverTest {

    /** 第一次 chat 返回一个 open_panel 工具调用,之后返回纯文本收尾(避免无限循环)。 */
    private static final class ToolThenTextClient implements LlmClient {
        private int calls = 0;
        @Override public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            return chat(messages, tools, StreamListener.NO_OP);
        }
        @Override public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) {
            calls++;
            listener.finish();
            if (calls == 1) {
                LlmClient.ToolCall tc = new LlmClient.ToolCall(
                        "call-1", new LlmClient.ToolCall.Function("open_panel", "{\"panel\":\"im-gateway\"}"));
                return new ChatResponse("assistant", null, null, List.of(tc), 1, 1);
            }
            return new ChatResponse("assistant", "完成", null, 1, 1);
        }
        @Override public boolean supportsTools() { return true; }
        @Override public String getModelName() { return "stub"; }
        @Override public String getProviderName() { return "stub"; }
    }

    private static PrintStream discard() {
        return new PrintStream(new ByteArrayOutputStream());
    }

    @Test
    void subAgentWorkerNotifiesObserverOnToolCalls() {
        List<String> seen = new ArrayList<>();
        SubAgent worker = new SubAgent("worker-1", AgentRole.WORKER, new ToolThenTextClient(), new ToolRegistry());
        worker.setToolCallObserver(calls -> calls.forEach(c -> seen.add(c.function().name())));
        try {
            worker.execute("打开 IM 网关面板", discard());
        } catch (Exception ignored) {
            // 执行细节不是本测试关心的,只要观察者被触发过
        }
        assertTrue(seen.contains("open_panel"), "worker 应把工具调用交给观察者,实际: " + seen);
    }

    @Test
    void subAgentWithoutObserverDoesNotThrow() {
        SubAgent worker = new SubAgent("worker-1", AgentRole.WORKER, new ToolThenTextClient(), new ToolRegistry());
        assertDoesNotThrow(() -> {
            try { worker.execute("打开面板", discard()); } catch (Exception ignored) { }
        });
    }

    @Test
    void observerExceptionDoesNotBreakSubAgent() {
        SubAgent worker = new SubAgent("worker-1", AgentRole.WORKER, new ToolThenTextClient(), new ToolRegistry());
        worker.setToolCallObserver(calls -> { throw new RuntimeException("boom"); });
        assertDoesNotThrow(() -> {
            try { worker.execute("打开面板", discard()); } catch (Exception ignored) { }
        });
    }

    @Test
    void orchestratorFansObserverOutToWorkers() {
        AgentOrchestrator orch = new AgentOrchestrator(new ToolThenTextClient());
        List<String> seen = new ArrayList<>();
        orch.setToolCallObserver(calls -> calls.forEach(c -> seen.add(c.function().name())));
        // 直接驱动其中一个 worker:证明扇出真的把观察者装到了 worker 上
        SubAgent worker = orch.workersForTest().get(0);
        try { worker.execute("打开 IM 网关面板", discard()); } catch (Exception ignored) { }
        assertTrue(seen.contains("open_panel"), "orchestrator 应把观察者扇出给 worker,实际: " + seen);
    }
}
```

⚠ 实现前先确认 `SubAgent.execute(...)` 的**真实签名**(`grep -n "public .* execute" src/main/java/com/lyhn/wraith/agent/SubAgent.java`)。若与 `execute(String, PrintStream)` 不同,按真实签名调整测试里这两处调用(其余断言不变),并在报告里说明实际签名。

- [ ] **Step 2: 运行,确认失败**

Run: `mvn -q -DskipTests=false -Dtest=ToolCallObserverTest test`
Expected: FAIL —— 编译错误:`setToolCallObserver` / `workersForTest` 不存在。

- [ ] **Step 3: SubAgent 加观察者**

在 `SubAgent.java` 字段区(`:46-55` 那组 `private final` 之后)加:

```java
    /** 工具调用观察者(桌面注入 → 发 tool.call 事件);默认 no-op,CLI 行为不变。 */
    private java.util.function.Consumer<java.util.List<LlmClient.ToolCall>> toolCallObserver = calls -> {};

    /** 桌面注入:把本 SubAgent 的工具调用同步交给观察者(Plan/Team 模式的动作卡靠它)。 */
    public void setToolCallObserver(java.util.function.Consumer<java.util.List<LlmClient.ToolCall>> observer) {
        this.toolCallObserver = observer == null ? calls -> {} : observer;
    }
```

在 `:239` 的 `printToolCalls(out, response.toolCalls());` **之后**紧接一行(保留原行不动):

```java
                    printToolCalls(out, response.toolCalls());
                    notifyToolCallObserver(response.toolCalls());
```

并在类内(靠近 `printToolCalls` 私有方法处)加:

```java
    /** 观察者失败绝不影响工具执行主路径(仿 ToolRegistry.writeFileObserver 范式)。 */
    private void notifyToolCallObserver(java.util.List<LlmClient.ToolCall> calls) {
        try {
            toolCallObserver.accept(calls);
        } catch (Exception ignored) {
            // 事件外发失败不能打断子 agent
        }
    }
```

- [ ] **Step 4: AgentOrchestrator 加 setter + 扇出 + 测试访问器**

在 `AgentOrchestrator.java` 的 `setStepStreamFactory` 一行(`:59`)附近加:

```java
    /** 桌面注入:把工具调用观察者扇出给 planner/workers/reviewer(仿 setSkillSystem 的扇出范式)。 */
    public void setToolCallObserver(java.util.function.Consumer<java.util.List<LlmClient.ToolCall>> observer) {
        planner.setToolCallObserver(observer);
        for (SubAgent worker : workers) {
            worker.setToolCallObserver(observer);
        }
        reviewer.setToolCallObserver(observer);
    }

    /** 仅供测试断言扇出结果(planner/reviewer 默认不开工具,真正调工具的是 workers)。 */
    java.util.List<SubAgent> workersForTest() {
        return workers;
    }
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `mvn -q -DskipTests=false -Dtest=ToolCallObserverTest test`
Expected: PASS(4/4)。

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/agent/SubAgent.java src/main/java/com/lyhn/wraith/agent/AgentOrchestrator.java src/test/java/com/lyhn/wraith/agent/ToolCallObserverTest.java
git commit -m "feat(agent): SubAgent/AgentOrchestrator 加默认 no-op 工具调用观察者(Phase D2)"
```

---

### Task 3: `PlanExecuteAgent` 工具调用观察者

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/agent/PlanExecuteAgent.java`(setter 区 `:179-195`;调用点 `:609`)
- Modify: `src/test/java/com/lyhn/wraith/agent/ToolCallObserverTest.java`(追加一组测试)

**Interfaces:**
- Produces: `PlanExecuteAgent.setToolCallObserver(java.util.function.Consumer<java.util.List<LlmClient.ToolCall>>)`。Task 4 的 Main 接线消费之。

- [ ] **Step 1: 追加失败测试**

在 `ToolCallObserverTest` 类内追加(复用同文件的 `ToolThenTextClient` / `discard()`):

```java
    @Test
    void planExecuteAgentNotifiesObserverOnToolCalls() {
        List<String> seen = new ArrayList<>();
        PlanExecuteAgent planAgent = new PlanExecuteAgent(new ToolThenTextClient(), new ToolRegistry());
        planAgent.setToolCallObserver(calls -> calls.forEach(c -> seen.add(c.function().name())));
        try { planAgent.run("打开 IM 网关面板"); } catch (Exception ignored) { }
        assertTrue(seen.contains("open_panel"), "Plan 执行器应把工具调用交给观察者,实际: " + seen);
    }

    @Test
    void planExecuteAgentObserverExceptionDoesNotBreakRun() {
        PlanExecuteAgent planAgent = new PlanExecuteAgent(new ToolThenTextClient(), new ToolRegistry());
        planAgent.setToolCallObserver(calls -> { throw new RuntimeException("boom"); });
        assertDoesNotThrow(() -> {
            try { planAgent.run("打开面板"); } catch (Exception ignored) { }
        });
    }
```

⚠ 先确认 `PlanExecuteAgent` 有哪个**可用的轻量构造/入口**:`grep -n "public PlanExecuteAgent\|public String run" src/main/java/com/lyhn/wraith/agent/PlanExecuteAgent.java`。若没有 `(LlmClient, ToolRegistry)` 两参构造,改用现有最短的公开构造(参考 `PlanExecuteAgentContextForwardingTest` 里已用的那个),`out` 传 `discard()`,并在报告里写明用了哪个签名。若 `ToolThenTextClient` 返回的 `"{}"` 让 planner 生成不出计划、导致 worker 阶段根本不跑,则**改成让 fake client 先返回一个合法的单步计划 JSON、第二次再返回 open_panel 工具调用**(照 `Planner` 期望的 JSON 结构;先读 `Planner` 的解析代码确认字段名),使执行阶段真的进到 `:609`。这一步允许你调整 fake 的返回序列 —— 目标是**真实触发**观察者,不是硬凑断言。

- [ ] **Step 2: 运行,确认失败**

Run: `mvn -q -DskipTests=false -Dtest=ToolCallObserverTest test`
Expected: FAIL —— `setToolCallObserver` 不存在(编译错误)。

- [ ] **Step 3: 实现**

在 `PlanExecuteAgent.java` 的 `setPlanStreamFactory`(`:189-191`)附近加:

```java
    /** 工具调用观察者(桌面注入 → 发 tool.call 事件);默认 no-op,CLI 行为不变。 */
    private java.util.function.Consumer<java.util.List<LlmClient.ToolCall>> toolCallObserver = calls -> {};

    /** 桌面注入:把计划步骤里的工具调用同步交给观察者(Plan 模式的动作卡靠它)。 */
    public void setToolCallObserver(java.util.function.Consumer<java.util.List<LlmClient.ToolCall>> observer) {
        this.toolCallObserver = observer == null ? calls -> {} : observer;
    }

    /** 观察者失败绝不影响工具执行主路径。 */
    private void notifyToolCallObserver(java.util.List<LlmClient.ToolCall> calls) {
        try {
            toolCallObserver.accept(calls);
        } catch (Exception ignored) {
            // 事件外发失败不能打断计划执行
        }
    }
```

在 `:609` 的 `printToolCalls(out, response.toolCalls());` **之后**紧接一行(保留原行不动):

```java
            printToolCalls(out, response.toolCalls());
            notifyToolCallObserver(response.toolCalls());
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `mvn -q -DskipTests=false -Dtest=ToolCallObserverTest test`
Expected: PASS(全部,含 Task 2 的 4 条)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/agent/PlanExecuteAgent.java src/test/java/com/lyhn/wraith/agent/ToolCallObserverTest.java
git commit -m "feat(agent): PlanExecuteAgent 加默认 no-op 工具调用观察者(Phase D3)"
```

---

### Task 4: 桌面接线(Main)—— 只放行 UI 意图工具

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(Team 接线 ~`:2017`;Plan 接线 ~`:2107`)

**Interfaces:**
- Consumes: `UiIntentTools.filter`(Task 1)、`orchestrator.setToolCallObserver`(Task 2)、`planAgent.setToolCallObserver`(Task 3)、既有 `renderer`(`EventStreamRenderer`,其 `appendToolCalls` 对空表天然 no-op,见 `EventStreamRenderer.java:161-163`)。
- Produces: 无新符号 —— 行为:Plan/Team 模式下 `open_panel`/`im_connect` 产出 `tool.call` 通知。

- [ ] **Step 1: Team 模式接线**

在 `Main.java` Team 装配段(`orchestrator.setStepStreamFactory(...)` 那一组注入之后)加:

```java
                            // UI 意图工具(open_panel/im_connect)贯通到渲染层:Team 模式也能出动作卡。
                            // 只放行这两个——普通工具在本路径没有 tool.result,放行会让工具卡永久转圈。
                            orchestrator.setToolCallObserver(calls ->
                                    renderer.appendToolCalls(com.lyhn.wraith.tool.UiIntentTools.filter(calls)));
```

- [ ] **Step 2: Plan 模式接线**

在 `Main.java` Plan 装配段(`planAgent.setPlanStreamFactory(...)` 之后)加:

```java
                        // UI 意图工具(open_panel/im_connect)贯通到渲染层:Plan 模式也能出动作卡。
                        // 只放行这两个——普通工具在本路径没有 tool.result,放行会让工具卡永久转圈。
                        planAgent.setToolCallObserver(calls ->
                                renderer.appendToolCalls(com.lyhn.wraith.tool.UiIntentTools.filter(calls)));
```

⚠ 两处都要确认 `renderer` 变量在该作用域可见(Team 段已有 `new EventStreamTeamListener(renderer, teamId)`、Plan 段已有 `new EventStreamPlanListener(renderer, planId)`,故 `renderer` 必在作用域内)。若变量名不同,按实际名字接线并在报告中说明。

- [ ] **Step 3: 编译 + 全量回归**

Run: `mvn -q -DskipTests=false test`
Expected: 全绿(基线 1605 用例上下,0F/0E);**新增 Task1-3 的用例应一并通过**。

- [ ] **Step 4: 桌面零改动确认**

Run: `cd desktop && npm test && npm run typecheck`
Expected: 全绿(桌面本期无代码改动,此步仅确认零影响;基线 desktop 1022 / tsc 0)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/cli/Main.java
git commit -m "feat(desktop-backend): Plan/Team 接线 UI 意图工具观察者→tool.call(动作卡三模式贯通,Phase D4)"
```

---

## Self-Review(写完计划的自查)

**1. Spec 覆盖** —— spec §3 各节 → 任务映射:
- §3.1 观察者注入 + 只放行 → Task 2(SubAgent/Orchestrator)、Task 3(PlanExecuteAgent)、Task 4(接线 + filter)✓
- §3.2 只放行两个工具的理由 → 写进 Global Constraints + Task 4 代码注释 ✓
- §3.3 `UiIntentTools` → Task 1 ✓
- §3.4 渲染层零改动 → Task 4 Step 4 仅跑回归,不改桌面代码 ✓
- §3.5 测试(filter 纯函数 + 两个执行器观察者被触发)→ Task 1 / Task 2 / Task 3 ✓;回归门 → Task 4 Step 3-4 ✓

**2. 无占位** —— 每个代码步骤给了可直接粘贴的完整代码;两处「⚠ 先确认真实签名」是**明确的核验指令 + 偏离时的处置办法**(不是让实现者猜),因为 `SubAgent.execute` / `PlanExecuteAgent` 构造签名未在本计划撰写时逐字确认。

**3. 类型一致** —— 观察者类型三处统一为 `java.util.function.Consumer<java.util.List<LlmClient.ToolCall>>`;`UiIntentTools.filter` 入出参与之匹配;`workersForTest()` 仅测试用。

**4. 零回归保障** —— 默认 no-op + 保留原 `printToolCalls` 行 + 观察者异常吞掉 + CLI 不注入 → 终端字节不变;桌面不改代码。
