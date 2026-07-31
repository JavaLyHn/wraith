# 跨模式对话上下文注入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让切入 Plan / Team 模式的「决策入口」(计划生成 / planner)能看到 ReAct 主线近期对话,正确解析「继续/它/上面」等指代;并补齐 CLI 的 `recordExternalTurn` 使其与桌面对称。

**Architecture:** 新增纯函数 `ConversationDigest`,从 `Agent.getConversationHistory()` 生成有界的近期对话摘录,并提供 `prepend(ctx, base)` 统一注入(空 ctx → base 逐字节不变)。`AgentOrchestrator` 与 `Planner` 各加一个上下文 setter,在组装 planner / 计划生成的出站消息处调用 `prepend`。`cli/Main.java` 每轮进入 Plan/Team 前 `setConversationContext(ConversationDigest.of(agent.getConversationHistory()))`,并在 CLI 主循环补 `recordExternalTurn`。worker / reviewer 每步隔离一律不动。

**Tech Stack:** Java 17 / Maven;JUnit Jupiter;pkg `com.lyhn.wraith`;LLM 层 `com.lyhn.wraith.llm.LlmClient`。

## Global Constraints

- 包名 `com.lyhn.wraith`;Java 17;Maven;产物名固定 `wraith-1.0-SNAPSHOT.jar`(勿改 pom 版本)。
- 测试默认被跳过,须 `mvn -q test -DskipTests=false` 才真跑;单测用 JUnit Jupiter(`org.junit.jupiter.api.Test` / `Assertions`)。
- **零回归红线**:`conversationContext` 为空/空白时,`Planner` 与 `AgentOrchestrator` 的出站 user/task 消息与现状**逐字节一致**——每个注入任务必须有一条断言这一点的测试。
- 注入基串两处相同,逐字节为 `"请为以下任务制定执行计划：\n"`(全角冒号 `：`)。
- 共享注入前缀常量(唯一真源,勿在别处重写措辞):
  `INJECT_PREFIX = "对话上下文(来自主线会话,供理解『继续/它/上面』等指代):\n"`。
- worker / reviewer 的任务拼装、每步 `clearHistory()`、`buildStepContext`、ReAct 路径:一律不改。
- 不引入每轮额外 LLM 调用(digest 纯确定性,无网络)。
- 提交信息结尾两行(逐字):
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ`
- `git add` 只加本任务涉及文件,禁止 `git add .`/`-A`;禁止碰 WIP:`README.md`、`demo/pom.xml`、`.claude/settings.json`、`demo/src/Hello.java`、`progress.md`。

---

### Task 1: `ConversationDigest` 纯函数 + 单测

**Files:**
- Create: `src/main/java/com/lyhn/wraith/agent/ConversationDigest.java`
- Test: `src/test/java/com/lyhn/wraith/agent/ConversationDigestTest.java`

**Interfaces:**
- Consumes: `com.lyhn.wraith.llm.LlmClient.Message`(record:`role()`,`content()`,`toolCalls()`;`ToolCall(String id, Function function)`,`Function(String name, String arguments)`);工厂 `Message.system/user/assistant/tool`。
- Produces(后续任务依赖这些精确签名):
  - `public static final String ConversationDigest.INJECT_PREFIX`
  - `public static final int DEFAULT_MAX_ROUNDS = 4`,`DEFAULT_MAX_CHARS = 2500`,`TOOL_RESULT_PREVIEW_CHARS = 200`,`TOOL_ARGS_PREVIEW_CHARS = 120`
  - `public static String of(List<LlmClient.Message> history)`
  - `public static String of(List<LlmClient.Message> history, int maxRounds, int maxChars)`
  - `public static String prepend(String conversationContext, String baseBody)`

- [ ] **Step 1: 写失败测试**

`src/test/java/com/lyhn/wraith/agent/ConversationDigestTest.java`:

```java
package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.llm.LlmClient.ToolCall;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ConversationDigestTest {

    @Test
    void nullOrEmptyOrSystemOnly_returnsEmpty() {
        assertEquals("", ConversationDigest.of(null));
        assertEquals("", ConversationDigest.of(List.of()));
        assertEquals("", ConversationDigest.of(List.of(Message.system("sys"))));
    }

    @Test
    void singleRound_rendersUserAndAssistant_noPrefixInBody() {
        List<Message> h = List.of(
                Message.system("sys"),
                Message.user("克隆这个仓库"),
                Message.assistant("已克隆完成"));
        String d = ConversationDigest.of(h);
        assertTrue(d.contains("用户: 克隆这个仓库"), d);
        assertTrue(d.contains("助手: 已克隆完成"), d);
        assertFalse(d.startsWith(ConversationDigest.INJECT_PREFIX), "digest 主体不含注入前缀");
    }

    @Test
    void keepsOnlyLastMaxRounds_andMarksTruncated() {
        List<Message> h = new ArrayList<>();
        h.add(Message.system("sys"));
        for (int i = 1; i <= 6; i++) {
            h.add(Message.user("U" + i));
            h.add(Message.assistant("A" + i));
        }
        String d = ConversationDigest.of(h, 4, 100000);
        assertFalse(d.contains("U1"));
        assertFalse(d.contains("U2"));
        assertTrue(d.contains("U3"));
        assertTrue(d.contains("U6"));
        assertTrue(d.contains("(仅显示最近若干轮)"), d);
    }

    @Test
    void chronologicalOrder_oldestFirst() {
        List<Message> h = List.of(
                Message.user("先做A"), Message.assistant("A完成"),
                Message.user("再做B"), Message.assistant("B完成"));
        String d = ConversationDigest.of(h);
        assertTrue(d.indexOf("先做A") < d.indexOf("再做B"), d);
    }

    @Test
    void toolCallsAndResults_renderedAndTruncated() {
        String bigArgs = "x".repeat(500);
        String bigResult = "y".repeat(500);
        Message asst = Message.assistant("",
                List.of(new ToolCall("t1", new ToolCall.Function("execute_command", bigArgs))));
        List<Message> h = List.of(
                Message.user("跑命令"),
                asst,
                Message.tool("t1", bigResult));
        String d = ConversationDigest.of(h);
        assertTrue(d.contains("[工具 execute_command:"), d);
        assertTrue(d.contains("↳ 结果:"), d);
        assertTrue(d.contains("…"), "超长应截断加省略号");
        // 参数/结果预览不得超过各自上限(+ 省略号)
        assertFalse(d.contains("x".repeat(ConversationDigest.TOOL_ARGS_PREVIEW_CHARS + 1)));
        assertFalse(d.contains("y".repeat(ConversationDigest.TOOL_RESULT_PREVIEW_CHARS + 1)));
    }

    @Test
    void charCap_dropsOldestKeptRounds() {
        List<Message> h = new ArrayList<>();
        for (int i = 1; i <= 4; i++) {
            h.add(Message.user("U" + i + "-" + "a".repeat(300)));
            h.add(Message.assistant("A" + i));
        }
        String d = ConversationDigest.of(h, 4, 400);
        assertTrue(d.length() <= 400, "总长封顶: " + d.length());
        assertTrue(d.contains("U4"), "最新一轮必须保留");
    }

    @Test
    void prepend_blankContext_returnsBaseByteIdentical() {
        String base = "请为以下任务制定执行计划：\n继续";
        assertSame(base, ConversationDigest.prepend(null, base));
        assertEquals(base, ConversationDigest.prepend("", base));
        assertEquals(base, ConversationDigest.prepend("   ", base));
    }

    @Test
    void prepend_nonBlank_wrapsWithPrefix() {
        String base = "请为以下任务制定执行计划：\n继续";
        String out = ConversationDigest.prepend("用户: 克隆仓库", base);
        assertEquals(ConversationDigest.INJECT_PREFIX + "用户: 克隆仓库" + "\n\n" + base, out);
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q test -DskipTests=false -Dtest=ConversationDigestTest`
Expected: 编译失败(`ConversationDigest` 不存在)。

- [ ] **Step 3: 实现 `ConversationDigest`**

`src/main/java/com/lyhn/wraith/agent/ConversationDigest.java`:

```java
package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;

import java.util.ArrayList;
import java.util.List;

/**
 * 从 ReAct 主线 conversationHistory 生成有界的「近期对话」摘录,供 Plan/Team 的
 * 决策入口(计划生成 / planner)理解「继续/它/上面」等指代。纯函数、确定性、无 LLM 调用。
 */
public final class ConversationDigest {

    public static final int DEFAULT_MAX_ROUNDS = 4;
    public static final int DEFAULT_MAX_CHARS = 2500;
    public static final int TOOL_RESULT_PREVIEW_CHARS = 200;
    public static final int TOOL_ARGS_PREVIEW_CHARS = 120;

    public static final String INJECT_PREFIX =
            "对话上下文(来自主线会话,供理解『继续/它/上面』等指代):\n";

    private static final String TRUNCATED_NOTE = "(仅显示最近若干轮)";

    private ConversationDigest() {}

    public static String of(List<LlmClient.Message> history) {
        return of(history, DEFAULT_MAX_ROUNDS, DEFAULT_MAX_CHARS);
    }

    public static String of(List<LlmClient.Message> history, int maxRounds, int maxChars) {
        if (history == null || history.isEmpty()) {
            return "";
        }
        // 1. 分轮:一轮从 user 消息开始,含其后到下一条 user 前的 assistant/tool。跳过 system。
        List<List<LlmClient.Message>> rounds = new ArrayList<>();
        List<LlmClient.Message> current = null;
        for (LlmClient.Message m : history) {
            String role = m.role();
            if ("system".equals(role)) {
                continue;
            }
            if ("user".equals(role)) {
                current = new ArrayList<>();
                current.add(m);
                rounds.add(current);
            } else if (current != null) {
                current.add(m);
            }
        }
        if (rounds.isEmpty()) {
            return "";
        }
        // 2. 只保留最近 maxRounds 轮
        boolean truncated = rounds.size() > maxRounds;
        List<List<LlmClient.Message>> kept =
                new ArrayList<>(rounds.subList(Math.max(0, rounds.size() - maxRounds), rounds.size()));
        List<String> rendered = new ArrayList<>();
        for (List<LlmClient.Message> r : kept) {
            rendered.add(renderRound(r));
        }
        // 3. 字符封顶:从最旧保留轮起整轮丢弃,直到不超(至少留 1 轮)
        while (rendered.size() > 1
                && totalLen(rendered) + (truncated ? TRUNCATED_NOTE.length() + 1 : 0) > maxChars) {
            rendered.remove(0);
            truncated = true;
        }
        StringBuilder sb = new StringBuilder();
        if (truncated) {
            sb.append(TRUNCATED_NOTE).append("\n");
        }
        for (int i = 0; i < rendered.size(); i++) {
            if (i > 0) {
                sb.append("\n");
            }
            sb.append(rendered.get(i));
        }
        String out = sb.toString();
        if (out.length() > maxChars) {
            out = out.substring(0, maxChars); // 单轮就超时的硬兜底
        }
        return out.strip();
    }

    /** 注入辅助:空/空白 ctx 返回 base(引用不变,保证零回归);否则前缀 + ctx + 空行 + base。 */
    public static String prepend(String conversationContext, String baseBody) {
        if (conversationContext == null || conversationContext.isBlank()) {
            return baseBody;
        }
        return INJECT_PREFIX + conversationContext + "\n\n" + baseBody;
    }

    private static int totalLen(List<String> parts) {
        int n = 0;
        for (String p : parts) {
            n += p.length() + 1;
        }
        return n;
    }

    private static String renderRound(List<LlmClient.Message> round) {
        StringBuilder sb = new StringBuilder();
        for (LlmClient.Message m : round) {
            switch (m.role()) {
                case "user" -> sb.append("用户: ").append(safeTrim(m.content())).append("\n");
                case "assistant" -> {
                    if (m.content() != null && !m.content().isBlank()) {
                        sb.append("助手: ").append(safeTrim(m.content())).append("\n");
                    }
                    if (m.toolCalls() != null) {
                        for (LlmClient.ToolCall tc : m.toolCalls()) {
                            sb.append("[工具 ").append(tc.function().name()).append(": ")
                              .append(preview(tc.function().arguments(), TOOL_ARGS_PREVIEW_CHARS))
                              .append("]\n");
                        }
                    }
                }
                case "tool" -> sb.append("  ↳ 结果: ")
                        .append(preview(m.content(), TOOL_RESULT_PREVIEW_CHARS)).append("\n");
                default -> { /* 其它角色忽略 */ }
            }
        }
        return sb.toString().stripTrailing();
    }

    private static String safeTrim(String s) {
        return s == null ? "" : s.strip();
    }

    private static String preview(String s, int max) {
        if (s == null) {
            return "";
        }
        String t = s.strip().replaceAll("\\s+", " ");
        return t.length() <= max ? t : t.substring(0, max) + "…";
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q test -DskipTests=false -Dtest=ConversationDigestTest`
Expected: PASS(8 个测试全绿)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/agent/ConversationDigest.java \
        src/test/java/com/lyhn/wraith/agent/ConversationDigestTest.java
git commit -m "feat(agent): ConversationDigest 纯函数摘录主线近期对话 + prepend 注入辅助

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 2: `AgentOrchestrator` 注入(Team planner 入口)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/agent/AgentOrchestrator.java`(字段 + setter;planner 任务拼装处,现 `:169-170`)
- Test: `src/test/java/com/lyhn/wraith/agent/AgentOrchestratorContextInjectionTest.java`

**Interfaces:**
- Consumes: `ConversationDigest.prepend(String, String)`(Task 1)。
- Produces: `public void AgentOrchestrator.setConversationContext(String context)`(null → `""`)。

**背景(实现者须知):** `AgentOrchestrator` 现在组装 planner 任务是(`:169-170`):
```java
AgentMessage planMessage = AgentMessage.task("orchestrator",
        "请为以下任务制定执行计划：\n" + userInput);
```
它构造内部 planner/worker/reviewer 均为 `SubAgent`。`run(String)` 是公开入口;第一次 LLM 调用就是 planner 生成计划。worker/reviewer(`:537` 等)不动。

- [ ] **Step 1: 写失败测试**

`src/test/java/com/lyhn/wraith/agent/AgentOrchestratorContextInjectionTest.java`。用一个记录型假 `LlmClient` 捕获**第一次** `chat()` 的出站 messages(即 planner 的),`run()` 后续解析计划可能抛异常——用 try/catch 吞掉,只断言已捕获的 planner 消息。假 client 仿 `src/test/java/com/lyhn/wraith/agent/SubAgentReviewStreamTest.java` 的 `StubStreamingClient`(覆盖两个 `chat` 重载 + 其余必需方法)。

```java
package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class AgentOrchestratorContextInjectionTest {

    /** 捕获第一次 chat() 的出站 messages,返回空计划(让 run 尽快收尾/或抛错由调用方吞)。 */
    private static final class RecordingClient implements LlmClient {
        List<Message> firstMessages = null;
        @Override public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            return chat(messages, tools, StreamListener.NO_OP);
        }
        @Override public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) {
            if (firstMessages == null) firstMessages = new ArrayList<>(messages);
            listener.finish();
            return new ChatResponse("assistant", "{}", null, 1, 1);
        }
    }

    private static String plannerTaskText(RecordingClient c) {
        // planner 任务在最后一条 user 消息(system 是角色提示词)
        Message last = c.firstMessages.get(c.firstMessages.size() - 1);
        return last.content();
    }

    @Test
    void whenContextSet_plannerTaskContainsInjectedBlock() {
        RecordingClient c = new RecordingClient();
        AgentOrchestrator orch = new AgentOrchestrator(c);
        orch.setConversationContext("用户: 克隆仓库\n助手: 已完成");
        try { orch.run("继续"); } catch (Exception ignored) { }
        String task = plannerTaskText(c);
        assertTrue(task.startsWith(ConversationDigest.INJECT_PREFIX), task);
        assertTrue(task.contains("用户: 克隆仓库"), task);
        assertTrue(task.endsWith("请为以下任务制定执行计划：\n继续"), task);
    }

    @Test
    void whenContextEmpty_plannerTaskByteIdenticalToBaseline() {
        RecordingClient c = new RecordingClient();
        AgentOrchestrator orch = new AgentOrchestrator(c);
        // 不调 setConversationContext,或设空
        orch.setConversationContext("");
        try { orch.run("继续"); } catch (Exception ignored) { }
        assertEquals("请为以下任务制定执行计划：\n继续", plannerTaskText(c));
    }
}
```

> 若 `RecordingClient` 编译报还有未实现的抽象方法,照 `SubAgentReviewStreamTest.StubStreamingClient` 补齐(它是同包同类需求的现成范本)。

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q test -DskipTests=false -Dtest=AgentOrchestratorContextInjectionTest`
Expected: 编译失败(`setConversationContext` 不存在)。

- [ ] **Step 3: 实现注入**

在 `AgentOrchestrator` 加字段与 setter(放在 `externalContextSupplier` 字段/`setExternalContextSupplier` 附近,保持风格一致):
```java
private String conversationContext = "";

public void setConversationContext(String context) {
    this.conversationContext = context == null ? "" : context;
}
```
把 `:169-170` 的 planner 任务拼装改为:
```java
String planTaskBody = ConversationDigest.prepend(conversationContext,
        "请为以下任务制定执行计划：\n" + userInput);
AgentMessage planMessage = AgentMessage.task("orchestrator", planTaskBody);
```
(worker 的 `AgentMessage.task("orchestrator", step.description())` 等其它拼装**不动**。)

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q test -DskipTests=false -Dtest=AgentOrchestratorContextInjectionTest`
Expected: PASS(2 个测试)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/agent/AgentOrchestrator.java \
        src/test/java/com/lyhn/wraith/agent/AgentOrchestratorContextInjectionTest.java
git commit -m "feat(agent): AgentOrchestrator 注入主线对话上下文到 planner 任务(worker 隔离不变)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 3: `Planner` + `PlanExecuteAgent` 注入(计划生成入口)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/plan/Planner.java`(supplier 字段 + setter;`createPlan` 拼 user 消息处,现 `:72-73`)
- Modify: `src/main/java/com/lyhn/wraith/agent/PlanExecuteAgent.java`(字段 + setter;构造里转发给 planner,现 `:170` 附近)
- Test: `src/test/java/com/lyhn/wraith/plan/PlannerContextInjectionTest.java`
- Test: `src/test/java/com/lyhn/wraith/agent/PlanExecuteAgentContextForwardingTest.java`

**Interfaces:**
- Consumes: `ConversationDigest.prepend/INJECT_PREFIX`(Task 1)。
- Produces:
  - `public void Planner.setConversationContextSupplier(java.util.function.Supplier<String> supplier)`(null → `() -> ""`)。
  - `public void PlanExecuteAgent.setConversationContext(String context)`(null → `""`)。

**背景:** `Planner.createPlan(goal, extra)` 现拼 user 消息(`:72-73`):
```java
LlmClient.Message.user("请为以下任务制定执行计划：\n" + goal)
```
`isSimpleGoal(goal)` 早返回 `createMinimalPlan`(不走 LLM,不注入)。`Planner` 已有 `setProjectMemorySupplier` 可仿。`PlanExecuteAgent` 构造在 `:161` new 出 planner、`:170` 调 `planner.setProjectMemorySupplier(this::buildProjectMemoryContext)`;有 `externalContextSupplier` 字段(`:114`)可仿风格;并有包级构造 `PlanExecuteAgent(LlmClient, ToolRegistry, Planner, ...)`(`:144/149`)可注入自定义 Planner 供测试。

- [ ] **Step 1: 写 Planner 失败测试**

`src/test/java/com/lyhn/wraith/plan/PlannerContextInjectionTest.java`。记录型假 client 捕获出站 messages;`createPlan` 返回非法 JSON 会在 `parsePlan` 抛错——try/catch 吞掉,只断言捕获的 user 消息。用一个**不触发** `isSimpleGoal` 的较复杂 goal(如含多步描述),确保走 LLM 分支。

```java
package com.lyhn.wraith.plan;

import com.lyhn.wraith.agent.ConversationDigest;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PlannerContextInjectionTest {

    private static final class RecordingClient implements LlmClient {
        List<Message> firstMessages = null;
        @Override public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            return chat(messages, tools, StreamListener.NO_OP);
        }
        @Override public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) {
            if (firstMessages == null) firstMessages = new ArrayList<>(messages);
            listener.finish();
            return new ChatResponse("assistant", "not-json", null, 1, 1);
        }
    }

    // 足够复杂以绕开 isSimpleGoal 的 goal
    private static final String GOAL = "克隆仓库然后读取 pom.xml 最后验证项目结构并生成报告";

    private static String userText(RecordingClient c) {
        Message last = c.firstMessages.get(c.firstMessages.size() - 1);
        return last.content();
    }

    @Test
    void contextInjected_whenSupplierNonBlank() {
        RecordingClient c = new RecordingClient();
        Planner p = new Planner(c);
        p.setConversationContextSupplier(() -> "用户: 克隆仓库\n助手: 已完成");
        try { p.createPlan(GOAL); } catch (Exception ignored) { }
        String user = userText(c);
        assertTrue(user.startsWith(ConversationDigest.INJECT_PREFIX), user);
        assertTrue(user.endsWith("请为以下任务制定执行计划：\n" + GOAL), user);
    }

    @Test
    void byteIdentical_whenNoSupplier() {
        RecordingClient c = new RecordingClient();
        Planner p = new Planner(c);
        try { p.createPlan(GOAL); } catch (Exception ignored) { }
        assertEquals("请为以下任务制定执行计划：\n" + GOAL, userText(c));
    }
}
```

> 若 `new Planner(c)` 无此单参构造,用现有可用构造(如 `new Planner(c, System.out)`);以 `Planner.java` 实际构造为准。若 `RecordingClient` 缺抽象方法,仿 `SubAgentReviewStreamTest.StubStreamingClient` 补齐。若 `GOAL` 仍被判为 simple 而走 `createMinimalPlan`(不发 LLM,`firstMessages` 为 null),换一个更复杂、明显多步的 goal 直到走 LLM 分支。

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q test -DskipTests=false -Dtest=PlannerContextInjectionTest`
Expected: 编译失败(`setConversationContextSupplier` 不存在)。

- [ ] **Step 3: 实现 Planner 注入**

在 `Planner` 仿 `projectMemorySupplier` 加:
```java
private java.util.function.Supplier<String> conversationContextSupplier = () -> "";

public void setConversationContextSupplier(java.util.function.Supplier<String> supplier) {
    this.conversationContextSupplier = supplier == null ? () -> "" : supplier;
}
```
把 `:72-73` 的 user 消息改为(先安全取 ctx,异常吞掉返回 ""):
```java
String convo;
try {
    String v = conversationContextSupplier.get();
    convo = v == null ? "" : v;
} catch (Exception e) {
    convo = "";
}
String userBody = ConversationDigest.prepend(convo, "请为以下任务制定执行计划：\n" + goal);
// ... LlmClient.Message.user(userBody) ...
```
(`createMinimalPlan` 分支不动。)

- [ ] **Step 4: 跑 Planner 测试确认通过**

Run: `mvn -q test -DskipTests=false -Dtest=PlannerContextInjectionTest`
Expected: PASS(2 个)。

- [ ] **Step 5: 写 PlanExecuteAgent 转发失败测试**

`src/test/java/com/lyhn/wraith/agent/PlanExecuteAgentContextForwardingTest.java`。用包级构造注入一个记录型 `Planner` 子类,断言 `setConversationContext("X")` 后 planner 的 supplier 产出 `"X"`。

```java
package com.lyhn.wraith.agent;

import com.lyhn.wraith.plan.Planner;
import org.junit.jupiter.api.Test;

import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;

class PlanExecuteAgentContextForwardingTest {

    private static final class RecordingPlanner extends Planner {
        Supplier<String> captured;
        RecordingPlanner() { super(null); }               // 以 Planner 实际可用构造为准
        @Override public void setConversationContextSupplier(Supplier<String> s) { this.captured = s; }
    }

    @Test
    void setConversationContext_forwardsToPlannerSupplier() {
        RecordingPlanner planner = new RecordingPlanner();
        // 用 PlanExecuteAgent 的包级构造注入该 planner(参数以实际签名为准)
        PlanExecuteAgent agent = PlanExecuteAgentTestFactory.withPlanner(planner);
        agent.setConversationContext("CTX-1");
        assertNotNull(planner.captured, "构造应把 supplier 转发给 planner");
        assertEquals("CTX-1", planner.captured.get());
    }
}
```

> 实现者:`PlanExecuteAgentTestFactory.withPlanner(...)` 是让测试拿到「用自定义 planner 构造的 PlanExecuteAgent」的最简途径——**优先**直接调用 `PlanExecuteAgent` 现有包级构造(测试与被测同包 `com.lyhn.wraith.agent`,可直接 new,无需 factory;若参数多,按 `PlanExecuteAgent.java:144/149` 实际签名传 `null`/最小值)。若 `Planner` 无 `super(null)` 可用构造,改用其最小可用构造。此测试目的:锁定「`setConversationContext` → planner.supplier」这条转发线。

- [ ] **Step 6: 跑测试确认失败**

Run: `mvn -q test -DskipTests=false -Dtest=PlanExecuteAgentContextForwardingTest`
Expected: 编译失败(`setConversationContext` 不存在 / 转发未接)。

- [ ] **Step 7: 实现 PlanExecuteAgent 转发**

加字段 + setter(仿 `externalContextSupplier`):
```java
private String conversationContext = "";

public void setConversationContext(String context) {
    this.conversationContext = context == null ? "" : context;
}
```
在构造里 `:170`(已 `planner.setProjectMemorySupplier(...)`)后追加:
```java
this.planner.setConversationContextSupplier(() -> this.conversationContext);
```

- [ ] **Step 8: 跑测试确认通过**

Run: `mvn -q test -DskipTests=false -Dtest=PlannerContextInjectionTest,PlanExecuteAgentContextForwardingTest`
Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add src/main/java/com/lyhn/wraith/plan/Planner.java \
        src/main/java/com/lyhn/wraith/agent/PlanExecuteAgent.java \
        src/test/java/com/lyhn/wraith/plan/PlannerContextInjectionTest.java \
        src/test/java/com/lyhn/wraith/agent/PlanExecuteAgentContextForwardingTest.java
git commit -m "feat(plan): Planner/PlanExecuteAgent 注入主线对话上下文到计划生成入口

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 4: `cli/Main.java` 接线(桌面/CLI 四处注入 + CLI `recordExternalTurn` 对称)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(桌面 team `:2015` 前、桌面 plan `:2111` 前、CLI team `:915-918`、CLI plan `:905-909`;CLI 主循环 persist 前 `:930-938`)

**Interfaces:**
- Consumes: `ConversationDigest.of(List<LlmClient.Message>)`(Task 1);`AgentOrchestrator.setConversationContext(String)`(Task 2);`PlanExecuteAgent.setConversationContext(String)`(Task 3);既有 `Agent.getConversationHistory()`(`Agent.java:652`)、`Agent.recordExternalTurn(String,String)`(`:662`)。

**背景:** 桌面 team 每轮在 `:1987` 构造 `orchestrator`、`:2015` `orchestrator.run(goal)`、`:2030` `agent.recordExternalTurn(...)`;桌面 plan 在 `:2080` 构造、`:2111` `planAgent.run(goal)`、`:2125` recordExternalTurn。CLI 主循环在 `:905-909`(plan lambda,持 `reactAgent`)、`:915-918`(team lambda,持 `reactAgent`)构造并 run,但**未调** recordExternalTurn,`:938` 仅 `sessionStore.persist(reactAgent.getConversationHistory())`。

- [ ] **Step 1: 桌面 team 注入**

在 `Main.java:2015` 的 `orchestrator.run(goal)` **之前**加一行:
```java
orchestrator.setConversationContext(
        com.lyhn.wraith.agent.ConversationDigest.of(agent.getConversationHistory()));
```
(`agent` 即该 runner 的 ReAct 单例;此处作用域内可见。)

- [ ] **Step 2: 桌面 plan 注入**

在 `Main.java:2111` 的 `planAgent.run(goal)` **之前**加:
```java
planAgent.setConversationContext(
        com.lyhn.wraith.agent.ConversationDigest.of(agent.getConversationHistory()));
```

- [ ] **Step 3: CLI team 注入**

在 `Main.java:915-918` 的 team lambda 内,`orchestrator.run(taskInput)` **之前**(已有 `orchestrator.setExternalContextSupplier(...)` / `setSkillSystem(...)`)加:
```java
orchestrator.setConversationContext(
        com.lyhn.wraith.agent.ConversationDigest.of(reactAgent.getConversationHistory()));
```

- [ ] **Step 4: CLI plan 注入**

在 `Main.java:905-909` 的 plan lambda 内,`planAgent.run(taskInput)` **之前**加:
```java
planAgent.setConversationContext(
        com.lyhn.wraith.agent.ConversationDigest.of(reactAgent.getConversationHistory()));
```

- [ ] **Step 5: CLI `recordExternalTurn` 对称**

在 `Main.java:930-938`,拿到 `response` 后、`sessionStore.persist(...)`(`:938`)**之前**加:
```java
if (!"react".equals(snapshotMode) && response != null && !response.isBlank()) {
    reactAgent.recordExternalTurn(taskInput, response);
}
```
(镜像桌面 `:2030/2125`。放在现有 `if (response != null && !response.isBlank()) { ui.println(...) }` 之后、persist 之前均可,只要在 persist 前。)

- [ ] **Step 6: 编译 + 全量回归**

Run: `mvn -q clean test -DskipTests=false`
Expected: 编译通过;新测试(Task 1–3)全绿;既有测试无新增失败(尤其 `AgentClearHistoryTest`、`SubAgentReviewStreamTest`、`PlanProgressWiringTest`)。

> 说明(诚实边界):`Main.java` 主循环/桌面回合无既有单测框架可直接驱动,本任务验证 = ①`mvn compile` 通过 + ②人工核对 5 处改动都在、作用域变量(`agent`/`reactAgent`/`response`/`snapshotMode`/`taskInput`)可见 + ③回归全绿。CLI `recordExternalTurn` 的语义正确性由 `Agent.recordExternalTurn` 既有行为 + 桌面同款调用背书。

- [ ] **Step 7: 提交**

```bash
git add src/main/java/com/lyhn/wraith/cli/Main.java
git commit -m "feat(cli): Plan/Team 每轮注入主线对话上下文 + 补 CLI recordExternalTurn 与桌面对称

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

## Self-Review

**1. Spec coverage:**
- Spec §4.1 `ConversationDigest`(of + prepend + 常量)→ Task 1 ✅
- Spec §4.2 Team 注入 → Task 2 ✅
- Spec §4.3 Plan 注入(Planner + PlanExecuteAgent)→ Task 3 ✅
- Spec §4.4 共享常量 INJECT_PREFIX → Task 1(定义)+ Task 2/3(引用)✅
- Spec §4.5 四处接线 → Task 4 Step 1–4 ✅
- Spec §4.6 CLI recordExternalTurn 对称 → Task 4 Step 5 ✅
- Spec §5 零回归红线 → Task 1(prepend blank)、Task 2(byteIdentical)、Task 3(byteIdentical)测试 ✅
- Spec §6 测试 → Task 1–3 测试 + Task 4 回归 ✅
- 无遗漏。

**2. Placeholder scan:** 每个代码步骤含实际代码;测试含真实断言。Task 3/4 的"以实际签名为准"是对既有代码适配的明确指令(非占位),已给出 fallback 路径。无 TBD/TODO。

**3. Type consistency:** `setConversationContext(String)`(Orchestrator/PlanExecuteAgent)、`setConversationContextSupplier(Supplier<String>)`(Planner)、`ConversationDigest.of(...)`/`prepend(...)`/`INJECT_PREFIX` 全程一致;基串 `"请为以下任务制定执行计划：\n"`(全角冒号)两处统一。
