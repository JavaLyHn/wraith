# Wraith 桌面端 — P1（后端协议骨架）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 给现有 Java agent 加一个 `wraith app-server` 模式：通过 stdio 上的 JSON-RPC 2.0 把 agent 的事件流暴露出去，并用 headless 测试端到端验证——全程零 UI。

**Architecture:** agent 核心不动。`Agent.run(input)` 在执行过程中本就调用一组 `Renderer` 语义方法（thinking/正文 delta/工具调用/diff/状态/审批）。新增一个 `EventStreamRenderer implements Renderer`，把每次语义调用序列化成一条 JSON-RPC 通知写到 stdout；新增 `AppServer` 主循环托管生命周期（initialize / session.start / turn.submit / turn.interrupt / approval.respond / shutdown），在 worker 线程上跑 `agent.run`。所以"事件流"几乎是免费的——agent 已经在发，只是没人序列化。

**Tech Stack:** Java 17 / Maven；Jackson（已有依赖）做 JSON；JUnit Jupiter 5.10.2；新代码包 `com.lyhn.wraith.runtime.appserver`。

## Global Constraints

- 包名前缀 `com.lyhn.wraith`；新后端代码放 `com.lyhn.wraith.runtime.appserver`。
- 构建：`mvn -q clean package -DskipTests`。**测试默认被跳过**（pom `<skipTests>true</skipTests>`），必须显式 `mvn test -DskipTests=false -Dtest=<Class>` 才会真跑；只看 `Tests run: N` 行确认，别只看 BUILD SUCCESS。
- 既有环境性基线：本机 JDK 26 + Mockito 无法 mock 接口，全量测试约 3–4F/38E 是噪声，与本计划无关。**本计划所有新测试一律用手写 fake，禁止 Mockito**。
- **stdout 纯净（最高优先级约束）**：app-server 模式下 stdout 只承载 JSON-RPC。任何 `System.out.println` / banner / 流式正文原样写 stdout 都会污染协议。正文走 `message.delta` 通知；`EventStreamRenderer.stream()` 必须返回丢弃流；入口处把 `System.out` 重定向到 `System.err`，只把捕获到的真 stdout 交给 JSON-RPC writer。
- 传输：JSON-RPC 2.0，每行一个 JSON（JSONL），UTF-8。
- 提交信息结尾加：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。在 main 上直接小步提交即可（本仓库文档/小改的既有做法）。

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/main/java/com/lyhn/wraith/runtime/appserver/JsonRpc.java` | JSON-RPC 解析（入站行 → `Incoming`）+ 共享 `ObjectMapper` |
| `src/main/java/com/lyhn/wraith/runtime/appserver/JsonRpcWriter.java` | 线程安全地写出通知/响应/错误（一行一个 JSON） |
| `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java` | `implements Renderer`：语义调用 → JSON-RPC 通知；异步审批；stdout 纯净 |
| `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` | stdio 主循环 + 生命周期分发 + `SessionRunner`/`SessionRunnerFactory` 接缝 |
| `src/main/java/com/lyhn/wraith/render/Renderer.java`（改） | 新增 `appendToolOutputDelta` / `appendToolResult` 默认 no-op |
| `src/main/java/com/lyhn/wraith/cli/Main.java`（改） | `isAppServerCommand` + `startAppServer` 入口，真实接线 |
| `src/main/java/com/lyhn/wraith/runtime/api/RuntimeApiServer.java`（改） | 修既存 bug：`X-Wraith CLI-API-Key` → `X-Wraith-API-Key` |
| `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`（改） | 命令输出流式回调（Task 8） |
| 对应 `src/test/java/.../appserver/*Test.java` | 各任务的 TDD 测试 |

---

### Task 1: JSON-RPC 编解码

**Files:**
- Create: `src/main/java/com/lyhn/wraith/runtime/appserver/JsonRpc.java`
- Create: `src/main/java/com/lyhn/wraith/runtime/appserver/JsonRpcWriter.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/JsonRpcTest.java`

**Interfaces:**
- Produces：`JsonRpc.parse(String) -> JsonRpc.Incoming`（`Incoming(Object id, String method, JsonNode params)`，`isNotification()`）；`JsonRpc.MAPPER`（共享 ObjectMapper）；`JsonRpcWriter(OutputStream)` 带 `notify(String,Object)` / `result(Object,Object)` / `error(Object,int,String)`。

- [ ] **Step 1: 写失败测试**

```java
// src/test/java/com/lyhn/wraith/runtime/appserver/JsonRpcTest.java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;

class JsonRpcTest {
    @Test
    void parsesRequestWithIdAndParams() {
        JsonRpc.Incoming m = JsonRpc.parse("{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"turn.submit\",\"params\":{\"input\":\"hi\"}}");
        assertNotNull(m);
        assertEquals("turn.submit", m.method());
        assertFalse(m.isNotification());
        assertEquals("hi", m.params().get("input").asText());
    }

    @Test
    void parsesNotificationWithoutId() {
        JsonRpc.Incoming m = JsonRpc.parse("{\"jsonrpc\":\"2.0\",\"method\":\"ping\"}");
        assertNotNull(m);
        assertTrue(m.isNotification());
    }

    @Test
    void malformedLineReturnsNull() {
        assertNull(JsonRpc.parse("not json"));
        assertNull(JsonRpc.parse("{\"jsonrpc\":\"2.0\"}")); // 无 method
    }

    @Test
    void writerEmitsSingleLineNotification() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new JsonRpcWriter(out).notify("turn.started", java.util.Map.of("turnId", "t1"));
        String s = out.toString(StandardCharsets.UTF_8);
        assertTrue(s.endsWith("\n"));
        assertEquals(1, s.chars().filter(c -> c == '\n').count());
        JsonNode n = JsonRpc.MAPPER.readTree(s);
        assertEquals("2.0", n.get("jsonrpc").asText());
        assertEquals("turn.started", n.get("method").asText());
        assertEquals("t1", n.get("params").get("turnId").asText());
        assertFalse(n.has("id"));
    }

    @Test
    void writerEmitsResultWithId() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new JsonRpcWriter(out).result(7, java.util.Map.of("sessionId", "s1"));
        JsonNode n = JsonRpc.MAPPER.readTree(out.toString(StandardCharsets.UTF_8));
        assertEquals(7, n.get("id").asInt());
        assertEquals("s1", n.get("result").get("sessionId").asText());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=JsonRpcTest`
Expected: FAIL/编译错误（`JsonRpc` / `JsonRpcWriter` 不存在）。

- [ ] **Step 3: 实现 `JsonRpc.java`**

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** JSON-RPC 2.0 over JSONL：入站解析 + 共享 ObjectMapper。 */
public final class JsonRpc {
    public static final ObjectMapper MAPPER = new ObjectMapper();

    private JsonRpc() {}

    /** 一条入站消息；id 为 null 表示通知。 */
    public record Incoming(Object id, String method, JsonNode params) {
        public boolean isNotification() { return id == null; }
    }

    /** 解析一行 JSONL；非法或缺 method 返回 null。 */
    public static Incoming parse(String line) {
        try {
            JsonNode root = MAPPER.readTree(line);
            if (root == null || !root.hasNonNull("method")) return null;
            JsonNode idNode = root.get("id");
            Object id = (idNode == null || idNode.isNull()) ? null
                    : (idNode.isNumber() ? idNode.numberValue() : idNode.asText());
            return new Incoming(id, root.get("method").asText(), root.get("params"));
        } catch (Exception e) {
            return null;
        }
    }
}
```

- [ ] **Step 4: 实现 `JsonRpcWriter.java`**

```java
package com.lyhn.wraith.runtime.appserver;

import java.io.IOException;
import java.io.OutputStream;
import java.util.LinkedHashMap;
import java.util.Map;

/** 串行写出 JSON-RPC 通知/响应/错误（一行一个 JSON）。线程安全。 */
public final class JsonRpcWriter {
    private final OutputStream out;
    private final Object lock = new Object();

    public JsonRpcWriter(OutputStream out) { this.out = out; }

    public void notify(String method, Object params) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("jsonrpc", "2.0");
        m.put("method", method);
        m.put("params", params);
        writeLine(m);
    }

    public void result(Object id, Object result) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("jsonrpc", "2.0");
        m.put("id", id);
        m.put("result", result);
        writeLine(m);
    }

    public void error(Object id, int code, String message) {
        Map<String, Object> err = new LinkedHashMap<>();
        err.put("code", code);
        err.put("message", message == null ? "" : message);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("jsonrpc", "2.0");
        m.put("id", id);
        m.put("error", err);
        writeLine(m);
    }

    private void writeLine(Object msg) {
        try {
            byte[] bytes = JsonRpc.MAPPER.writeValueAsBytes(msg);
            synchronized (lock) {
                out.write(bytes);
                out.write('\n');
                out.flush();
            }
        } catch (IOException ignored) {
            // 连接断开：吞掉，主循环会因 stdin EOF 退出
        }
    }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=JsonRpcTest`
Expected: `Tests run: 5, Failures: 0, Errors: 0`。

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/JsonRpc.java \
        src/main/java/com/lyhn/wraith/runtime/appserver/JsonRpcWriter.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/JsonRpcTest.java
git commit -m "feat(app-server): JSON-RPC 2.0 JSONL 编解码

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 给 `Renderer` 加两个工具输出方法（默认 no-op）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/render/Renderer.java`
- Test: `src/test/java/com/lyhn/wraith/render/RendererDefaultMethodsTest.java`

**Interfaces:**
- Produces：`default void appendToolOutputDelta(String callId, String stream, String chunk)`；`default void appendToolResult(String callId, boolean ok, int exitCode)`。默认 no-op，故 Plain/Inline/Lanterna/Wechat 等现有实现零改动仍可编译。

- [ ] **Step 1: 写失败测试**

```java
// src/test/java/com/lyhn/wraith/render/RendererDefaultMethodsTest.java
package com.lyhn.wraith.render;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

class RendererDefaultMethodsTest {
    @Test
    void defaultToolOutputMethodsAreNoOp() {
        Renderer r = new PlainRenderer();
        assertDoesNotThrow(() -> {
            r.appendToolOutputDelta("c1", "stdout", "hello\n");
            r.appendToolResult("c1", true, 0);
        });
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=RendererDefaultMethodsTest`
Expected: 编译错误（方法不存在）。

- [ ] **Step 3: 在 `Renderer.java` 接口里加默认方法**（紧接 `appendToolCalls(...)` 声明之后）

```java
    /** 实时工具输出增量（如 bash 命令的实时 stdout/stderr）。默认 no-op；事件流渲染器覆盖。
     * @param stream "stdout" 或 "stderr" */
    default void appendToolOutputDelta(String callId, String stream, String chunk) {
    }

    /** 工具执行收尾（成功/失败/退出码）。默认 no-op；事件流渲染器覆盖。 */
    default void appendToolResult(String callId, boolean ok, int exitCode) {
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=RendererDefaultMethodsTest`
Expected: `Tests run: 1, Failures: 0, Errors: 0`。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/render/Renderer.java \
        src/test/java/com/lyhn/wraith/render/RendererDefaultMethodsTest.java
git commit -m "feat(render): Renderer 增 appendToolOutputDelta/appendToolResult 默认 no-op

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `EventStreamRenderer` — 事件序列化（不含审批）

**Files:**
- Create: `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamRendererTest.java`

**Interfaces:**
- Consumes：Task 1 `JsonRpcWriter`；`com.lyhn.wraith.render.Renderer`、`StatusInfo`；`LlmClient.ToolCall`（`tc.id()` / `tc.function().name()` / `tc.function().arguments()`）。
- Produces：`EventStreamRenderer(JsonRpcWriter writer, String sessionId)`；`setCurrentTurnId(String)`；`resolveApproval(String, ApprovalResult)`（Task 4 实现）。每条通知 params 含 `sessionId` + `turnId`。`stream()` 返回丢弃流（stdout 纯净）。

- [ ] **Step 1: 写失败测试**

```java
// src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamRendererTest.java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class EventStreamRendererTest {
    private record Captured(ByteArrayOutputStream out, EventStreamRenderer r) {}

    private Captured make() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        EventStreamRenderer r = new EventStreamRenderer(new JsonRpcWriter(out), "sess_1");
        r.setCurrentTurnId("turn_1");
        return new Captured(out, r);
    }

    private List<JsonNode> lines(ByteArrayOutputStream out) throws Exception {
        String s = out.toString(StandardCharsets.UTF_8);
        java.util.ArrayList<JsonNode> list = new java.util.ArrayList<>();
        for (String ln : s.split("\n")) if (!ln.isBlank()) list.add(JsonRpc.MAPPER.readTree(ln));
        return list;
    }

    @Test
    void thinkingAndContentDeltaEmitNotifications() throws Exception {
        Captured c = make();
        c.r().appendThinking("想…");
        c.r().appendAssistantContentDelta("答");
        List<JsonNode> ls = lines(c.out());
        assertEquals("thinking.delta", ls.get(0).get("method").asText());
        assertEquals("想…", ls.get(0).get("params").get("text").asText());
        assertEquals("turn_1", ls.get(0).get("params").get("turnId").asText());
        assertEquals("message.delta", ls.get(1).get("method").asText());
        assertEquals("答", ls.get(1).get("params").get("text").asText());
    }

    @Test
    void toolCallEmitsCallIdNameArgs() throws Exception {
        Captured c = make();
        LlmClient.ToolCall tc = new LlmClient.ToolCall("call_9",
                new LlmClient.ToolCall.Function("execute_command", "{\"command\":\"ls\"}"));
        c.r().appendToolCalls(List.of(tc));
        JsonNode p = lines(c.out()).get(0).get("params");
        assertEquals("tool.call", lines(c.out()).get(0).get("method").asText());
        assertEquals("call_9", p.get("callId").asText());
        assertEquals("execute_command", p.get("name").asText());
        assertEquals("{\"command\":\"ls\"}", p.get("argsJson").asText());
    }

    @Test
    void diffEmitsBeforeAfter() throws Exception {
        Captured c = make();
        c.r().appendDiff("a.txt", "old", "new");
        JsonNode p = lines(c.out()).get(0).get("params");
        assertEquals("diff", lines(c.out()).get(0).get("method").asText());
        assertEquals("a.txt", p.get("file").asText());
        assertEquals("old", p.get("before").asText());
        assertEquals("new", p.get("after").asText());
    }

    @Test
    void streamIsDiscardingNotStdout() {
        Captured c = make();
        c.r().stream().println("THIS MUST NOT POLLUTE STDOUT");
        assertEquals(0, c.out().size(), "stream() 输出不得进入 JSON-RPC 通道");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=EventStreamRendererTest`
Expected: 编译错误（`EventStreamRenderer` 不存在）。

- [ ] **Step 3: 实现 `EventStreamRenderer.java`**（审批方法先放占位的同步拒绝，Task 4 补完）

```java
package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.render.Renderer;
import com.lyhn.wraith.render.StatusInfo;
import com.lyhn.wraith.tool.todo.TodoItem;

import java.io.OutputStream;
import java.io.PrintStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 把 Renderer 语义调用序列化成 JSON-RPC 通知。stdout 纯净：正文走 message.delta，stream() 丢弃。 */
public final class EventStreamRenderer implements Renderer {
    private final JsonRpcWriter writer;
    private final String sessionId;
    private final PrintStream discard = new PrintStream(OutputStream.nullOutputStream());
    private volatile String currentTurnId = "";

    public EventStreamRenderer(JsonRpcWriter writer, String sessionId) {
        this.writer = writer;
        this.sessionId = sessionId;
    }

    public void setCurrentTurnId(String turnId) { this.currentTurnId = turnId; }

    private Map<String, Object> base() {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("sessionId", sessionId);
        p.put("turnId", currentTurnId);
        return p;
    }

    @Override public void start() {}
    @Override public void close() {}
    @Override public PrintStream stream() { return discard; }

    @Override public boolean supportsThinkingPanel() { return true; } // 让 reasoning 走 appendThinking

    @Override public void beginThinking(String label) {
        Map<String, Object> p = base(); p.put("label", label); writer.notify("thinking.begin", p);
    }
    @Override public void appendThinking(String delta) {
        Map<String, Object> p = base(); p.put("text", delta); writer.notify("thinking.delta", p);
    }
    @Override public void endThinking() { writer.notify("thinking.end", base()); }

    @Override public void appendAssistantContentDelta(String delta) {
        Map<String, Object> p = base(); p.put("text", delta); writer.notify("message.delta", p);
    }
    @Override public void finishAssistantContent() { writer.notify("message.end", base()); }

    @Override public void appendToolCalls(List<LlmClient.ToolCall> toolCalls) {
        if (toolCalls == null) return;
        for (LlmClient.ToolCall tc : toolCalls) {
            Map<String, Object> p = base();
            p.put("callId", tc.id());
            p.put("name", tc.function() == null ? "" : tc.function().name());
            p.put("argsJson", tc.function() == null ? "" : tc.function().arguments());
            writer.notify("tool.call", p);
        }
    }

    @Override public void appendToolOutputDelta(String callId, String stream, String chunk) {
        Map<String, Object> p = base(); p.put("callId", callId); p.put("stream", stream); p.put("chunk", chunk);
        writer.notify("tool.output.delta", p);
    }
    @Override public void appendToolResult(String callId, boolean ok, int exitCode) {
        Map<String, Object> p = base(); p.put("callId", callId); p.put("ok", ok); p.put("exitCode", exitCode);
        writer.notify("tool.result", p);
    }

    @Override public void appendDiff(String filePath, String before, String after) {
        Map<String, Object> p = base(); p.put("file", filePath); p.put("before", before); p.put("after", after);
        writer.notify("diff", p);
    }

    @Override public void renderTodos(List<TodoItem> todos) {
        Map<String, Object> p = base(); p.put("items", todos); writer.notify("todos", p);
    }

    @Override public void updateStatus(StatusInfo status) {
        Map<String, Object> p = base(); p.put("status", status); writer.notify("status", p);
    }

    @Override public int openPalette(String title, List<String> items) { return -1; } // v1 不暴露

    // 审批：Task 4 补完为异步往返；此处先同步拒绝，保证可编译/可测核心事件。
    @Override public ApprovalResult promptApproval(ApprovalRequest request) {
        return new ApprovalResult(ApprovalResult.Decision.REJECTED, null, "approval not wired yet");
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=EventStreamRendererTest`
Expected: `Tests run: 4, Failures: 0, Errors: 0`。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamRendererTest.java
git commit -m "feat(app-server): EventStreamRenderer 事件序列化(不含审批)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `EventStreamRenderer` — 异步审批往返

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamApprovalTest.java`

**Interfaces:**
- Consumes：`ApprovalRequest`（`toolName()` / `arguments()` / `dangerLevel()` / `riskDescription()` / `suggestion()`）；`ApprovalResult(Decision, String modifiedArguments, String reason)`。
- Produces：`promptApproval` 发 `approval.requested`（带 `approvalId`）并阻塞；`resolveApproval(String approvalId, ApprovalResult)` 解除阻塞。

- [ ] **Step 1: 写失败测试**

```java
// src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamApprovalTest.java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class EventStreamApprovalTest {
    @Test
    void promptApprovalBlocksThenResolves() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        EventStreamRenderer r = new EventStreamRenderer(new JsonRpcWriter(out), "s1");
        r.setCurrentTurnId("t1");
        ApprovalRequest req = ApprovalRequest.of("execute_command", "{\"command\":\"rm x\"}", null, null, null);

        ExecutorService ex = Executors.newSingleThreadExecutor();
        Future<ApprovalResult> f = ex.submit(() -> r.promptApproval(req));

        // 等通知出现，取出 approvalId
        String approvalId = null;
        for (int i = 0; i < 50 && approvalId == null; i++) {
            for (String ln : out.toString(StandardCharsets.UTF_8).split("\n")) {
                if (ln.isBlank()) continue;
                JsonNode n = JsonRpc.MAPPER.readTree(ln);
                if ("approval.requested".equals(n.path("method").asText())) {
                    approvalId = n.get("params").get("approvalId").asText();
                }
            }
            if (approvalId == null) Thread.sleep(20);
        }
        assertNotNull(approvalId, "应发出 approval.requested 并带 approvalId");
        assertFalse(f.isDone(), "未回应前应阻塞");

        r.resolveApproval(approvalId, new ApprovalResult(ApprovalResult.Decision.APPROVED, null, null));
        ApprovalResult result = f.get(2, TimeUnit.SECONDS);
        assertEquals(ApprovalResult.Decision.APPROVED, result.decision());
        ex.shutdownNow();
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=EventStreamApprovalTest`
Expected: FAIL —— 当前 `promptApproval` 直接返回 REJECTED，不会阻塞，`resolveApproval` 不存在（编译错误）。

- [ ] **Step 3: 给 `EventStreamRenderer` 加字段 + 替换 `promptApproval` + 加 `resolveApproval`**

加字段（类顶部）：

```java
    private final java.util.concurrent.atomic.AtomicLong approvalSeq = new java.util.concurrent.atomic.AtomicLong();
    private final Map<String, java.util.concurrent.CompletableFuture<ApprovalResult>> pending =
            new java.util.concurrent.ConcurrentHashMap<>();
```

替换 `promptApproval`，并新增 `resolveApproval`：

```java
    @Override public ApprovalResult promptApproval(ApprovalRequest request) {
        String approvalId = "appr_" + approvalSeq.incrementAndGet();
        java.util.concurrent.CompletableFuture<ApprovalResult> fut = new java.util.concurrent.CompletableFuture<>();
        pending.put(approvalId, fut);
        Map<String, Object> p = base();
        p.put("approvalId", approvalId);
        p.put("toolName", request.toolName());
        p.put("argsJson", request.arguments());
        p.put("dangerLevel", request.dangerLevel());
        p.put("riskDescription", request.riskDescription());
        p.put("suggestion", request.suggestion());
        writer.notify("approval.requested", p);
        try {
            return fut.get();
        } catch (Exception e) {
            return new ApprovalResult(ApprovalResult.Decision.REJECTED, null, "interrupted");
        } finally {
            pending.remove(approvalId);
        }
    }

    /** AppServer 收到 approval.respond 时调用。 */
    public void resolveApproval(String approvalId, ApprovalResult result) {
        java.util.concurrent.CompletableFuture<ApprovalResult> fut = pending.get(approvalId);
        if (fut != null) fut.complete(result);
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=EventStreamApprovalTest`
Expected: `Tests run: 1, Failures: 0, Errors: 0`。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamApprovalTest.java
git commit -m "feat(app-server): EventStreamRenderer 异步审批往返(correlation-id)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `AppServer` 主循环（headless harness 在此成形）

**Files:**
- Create: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerTest.java`

**Interfaces:**
- Consumes：Task 1 `JsonRpc`/`JsonRpcWriter`；Task 3/4 `EventStreamRenderer`；`ApprovalResult`。
- Produces：`AppServer(InputStream in, OutputStream out, SessionRunnerFactory factory)` + `serve()`；`interface SessionRunnerFactory { SessionRunner create(JsonRpcWriter w, String sessionId); }`；`interface SessionRunner { EventStreamRenderer renderer(); String runTurn(String input) throws Exception; }`。

- [ ] **Step 1: 写失败测试**（用假 runner 驱动 renderer，跑出完整事件序列 —— 这就是 headless harness）

```java
// src/test/java/com/lyhn/wraith/runtime/appserver/AppServerTest.java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AppServerTest {
    /** 假会话：runTurn 用脚本化序列驱动真实 EventStreamRenderer。 */
    private AppServer.SessionRunnerFactory fakeFactory() {
        return (writer, sessionId) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) {
                    r.appendThinking("thinking about " + input);
                    r.appendAssistantContentDelta("hello");
                    r.finishAssistantContent();
                    return "hello";
                }
            };
        };
    }

    private List<JsonNode> parseAll(String s) throws Exception {
        List<JsonNode> out = new ArrayList<>();
        for (String ln : s.split("\n")) if (!ln.isBlank()) out.add(JsonRpc.MAPPER.readTree(ln));
        return out;
    }

    @Test
    void fullTurnEmitsExpectedEventSequence() throws Exception {
        String input = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"turn.submit\",\"params\":{\"input\":\"hi\"}}",
                "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayInputStream in = new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        AppServer server = new AppServer(in, out, fakeFactory());
        server.serve(); // 读到 EOF / shutdown 返回

        // turn 在 worker 线程上跑；等 turn.completed 出现（serve 已退出但线程可能仍在收尾）
        long deadline = System.currentTimeMillis() + 2000;
        while (System.currentTimeMillis() < deadline
                && !out.toString(StandardCharsets.UTF_8).contains("turn.completed")) {
            Thread.sleep(20);
        }

        List<JsonNode> msgs = parseAll(out.toString(StandardCharsets.UTF_8));
        List<String> methods = new ArrayList<>();
        for (JsonNode n : msgs) methods.add(n.has("method") ? n.get("method").asText() : "result:" + n.get("id"));

        assertTrue(methods.contains("turn.started"));
        assertTrue(methods.contains("thinking.delta"));
        assertTrue(methods.contains("message.delta"));
        assertTrue(methods.contains("turn.completed"));
        // session.start 必须先于 turn.started
        assertTrue(indexOfResult(msgs, 2) >= 0, "session.start 应有 result");
    }

    private int indexOfResult(List<JsonNode> msgs, int id) {
        for (int i = 0; i < msgs.size(); i++) if (msgs.get(i).path("id").asInt(-1) == id && msgs.get(i).has("result")) return i;
        return -1;
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=AppServerTest`
Expected: 编译错误（`AppServer` 不存在）。

- [ ] **Step 3: 实现 `AppServer.java`**

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.hitl.ApprovalResult;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/** stdio JSON-RPC app-server 主循环。v1 单会话。 */
public final class AppServer {

    public interface SessionRunnerFactory {
        SessionRunner create(JsonRpcWriter writer, String sessionId);
    }

    public interface SessionRunner {
        EventStreamRenderer renderer();
        String runTurn(String input) throws Exception;
    }

    private final BufferedReader in;
    private final JsonRpcWriter writer;
    private final SessionRunnerFactory factory;
    private final AtomicLong turnSeq = new AtomicLong();

    private SessionRunner session;
    private String sessionId;
    private volatile Thread turnThread;

    public AppServer(InputStream in, OutputStream out, SessionRunnerFactory factory) {
        this.in = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        this.writer = new JsonRpcWriter(out);
        this.factory = factory;
    }

    public void serve() throws Exception {
        String line;
        while ((line = in.readLine()) != null) {
            JsonRpc.Incoming msg = JsonRpc.parse(line);
            if (msg == null) continue;          // 畸形行跳过
            if (!dispatch(msg)) break;           // shutdown
        }
    }

    private boolean dispatch(JsonRpc.Incoming msg) {
        switch (msg.method()) {
            case "initialize" ->
                    writer.result(msg.id(), Map.of("serverInfo", "wraith-app-server", "protocol", "1"));
            case "session.start" -> {
                sessionId = "sess_" + Long.toHexString(System.nanoTime());
                session = factory.create(writer, sessionId);
                writer.result(msg.id(), Map.of("sessionId", sessionId));
            }
            case "turn.submit" -> handleTurn(msg);
            case "turn.interrupt" -> {
                Thread t = turnThread;
                if (t != null) t.interrupt();
                writer.result(msg.id(), Map.of("ok", true));
            }
            case "approval.respond" -> {
                handleApprovalRespond(msg);
                writer.result(msg.id(), Map.of("ok", true));
            }
            case "shutdown" -> {
                writer.result(msg.id(), Map.of("ok", true));
                return false;
            }
            default -> {
                if (!msg.isNotification()) writer.error(msg.id(), -32601, "method not found: " + msg.method());
            }
        }
        return true;
    }

    private void handleTurn(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode params = msg.params();
        String input = (params != null && params.hasNonNull("input")) ? params.get("input").asText() : "";
        String turnId = "turn_" + turnSeq.incrementAndGet();
        session.renderer().setCurrentTurnId(turnId);
        writer.result(msg.id(), Map.of("turnId", turnId, "status", "running"));
        writer.notify("turn.started", Map.of("sessionId", sessionId, "turnId", turnId));
        Thread t = new Thread(() -> {
            try {
                session.runTurn(input);
                writer.notify("turn.completed", Map.of("sessionId", sessionId, "turnId", turnId, "status", "completed"));
            } catch (Exception e) {
                writer.notify("turn.failed", Map.of("sessionId", sessionId, "turnId", turnId,
                        "error", String.valueOf(e.getMessage())));
            }
        }, "wraith-appserver-turn");
        t.setDaemon(true);
        turnThread = t;
        t.start();
    }

    private void handleApprovalRespond(JsonRpc.Incoming msg) {
        if (session == null || msg.params() == null) return;
        JsonNode p = msg.params();
        String approvalId = p.path("approvalId").asText("");
        String decision = p.path("decision").asText("REJECTED");
        String modifiedArgs = p.hasNonNull("modifiedArgs") ? p.get("modifiedArgs").asText() : null;
        String reason = p.hasNonNull("reason") ? p.get("reason").asText() : null;
        ApprovalResult result = new ApprovalResult(
                ApprovalResult.Decision.valueOf(decision), modifiedArgs, reason);
        session.renderer().resolveApproval(approvalId, result);
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=AppServerTest`
Expected: `Tests run: 1, Failures: 0, Errors: 0`（事件序列含 turn.started / thinking.delta / message.delta / turn.completed）。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerTest.java
git commit -m "feat(app-server): AppServer 主循环 + SessionRunner 接缝 + headless harness 测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `wraith app-server` CLI 入口（真实接线 + stdout 纯净）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`
- Test: `src/test/java/com/lyhn/wraith/cli/MainAppServerCommandTest.java`

**Interfaces:**
- Consumes：`AppServer`、`EventStreamRenderer`；`WraithConfig.load()`、`LlmClientFactory.createFromConfig(config)`、`Agent(LlmClient, ToolRegistry)`、`agent.setRenderer(Renderer)`、`agent.run(String)`、`agent.getToolRegistry()`、`ToolRegistry.setWriteFileObserver(BiConsumer<String,String[]>)`、`HitlToolRegistry(HitlHandler)`、`TerminalHitlHandler(boolean)`、`SwitchableHitlHandler(HitlHandler)`、`RendererHitlHandler(Renderer, boolean)`、`HitlHandler.setEnabled(boolean)`、`SwitchableHitlHandler.setDelegate(HitlHandler)`。
- Produces：`static boolean isAppServerCommand(String[] args)`。

- [ ] **Step 1: 写失败测试**（只测命令识别，纯逻辑、无副作用）

```java
// src/test/java/com/lyhn/wraith/cli/MainAppServerCommandTest.java
package com.lyhn.wraith.cli;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class MainAppServerCommandTest {
    @Test
    void recognizesAppServerSubcommand() {
        assertTrue(Main.isAppServerCommand(new String[]{"app-server"}));
        assertTrue(Main.isAppServerCommand(new String[]{"app-server", "--anything"}));
    }
    @Test
    void rejectsOthers() {
        assertFalse(Main.isAppServerCommand(new String[]{"serve", "--http"}));
        assertFalse(Main.isAppServerCommand(new String[]{}));
        assertFalse(Main.isAppServerCommand(null));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=MainAppServerCommandTest`
Expected: 编译错误（`isAppServerCommand` 不存在）。

- [ ] **Step 3: 在 `Main.java` 加 `isAppServerCommand` + `startAppServer`，并在 `main` 里挂上**

`main(String[] args)` 里、`isRuntimeServeCommand` 分支之后、标准 CLI 流程之前加：

```java
        if (isAppServerCommand(args)) {
            startAppServer();
            return;
        }
```

新增两个方法（与 `isRuntimeServeCommand` / `startRuntimeApiAndBlock` 同区域）：

```java
    static boolean isAppServerCommand(String[] args) {
        return args != null && args.length >= 1 && "app-server".equalsIgnoreCase(args[0]);
    }

    private static void startAppServer() {
        // stdout 纯净：真 stdout 留给 JSON-RPC，其它一切打到 stderr
        java.io.PrintStream realOut = System.out;
        System.setOut(System.err);
        configureLogging(); // logback 写文件，不污染 stdout

        com.lyhn.wraith.config.WraithConfig config = com.lyhn.wraith.config.WraithConfig.load();
        com.lyhn.wraith.llm.LlmClient client = com.lyhn.wraith.llm.LlmClientFactory.createFromConfig(config);
        if (client == null) {
            System.err.println("app-server: 未找到可用 API Key");
            System.exit(1);
        }

        com.lyhn.wraith.runtime.appserver.AppServer server =
            new com.lyhn.wraith.runtime.appserver.AppServer(System.in, realOut, (writer, sessionId) -> {
                com.lyhn.wraith.runtime.appserver.EventStreamRenderer renderer =
                        new com.lyhn.wraith.runtime.appserver.EventStreamRenderer(writer, sessionId);

                com.lyhn.wraith.hitl.TerminalHitlHandler terminal =
                        new com.lyhn.wraith.hitl.TerminalHitlHandler(false);
                com.lyhn.wraith.hitl.SwitchableHitlHandler hitl =
                        new com.lyhn.wraith.hitl.SwitchableHitlHandler(terminal);
                hitl.setEnabled(true); // 开 HITL，审批走 EventStreamRenderer
                com.lyhn.wraith.hitl.HitlToolRegistry registry =
                        new com.lyhn.wraith.hitl.HitlToolRegistry(hitl);
                registry.setProjectPath(java.nio.file.Path.of(".").toAbsolutePath().normalize().toString());
                registry.setWriteFileObserver((path, ba) -> renderer.appendDiff(path, ba[0], ba[1]));

                com.lyhn.wraith.agent.Agent agent = new com.lyhn.wraith.agent.Agent(client, registry);
                agent.setRenderer(renderer);

                com.lyhn.wraith.hitl.RendererHitlHandler rendererHitl =
                        new com.lyhn.wraith.hitl.RendererHitlHandler(renderer, hitl.isEnabled());
                hitl.setDelegate(rendererHitl);

                return new com.lyhn.wraith.runtime.appserver.AppServer.SessionRunner() {
                    public com.lyhn.wraith.runtime.appserver.EventStreamRenderer renderer() { return renderer; }
                    public String runTurn(String input) { return agent.run(input); }
                };
            });

        try {
            server.serve();
        } catch (Exception e) {
            System.err.println("app-server error: " + e.getMessage());
        }
    }
```

> 注意：`HitlToolRegistry` 是 `ToolRegistry` 子类，可直接传给 `Agent(client, registry)`。若 `configureLogging()` 是 `private static`，本方法在同类内可直接调用——确认其可见性即可。

- [ ] **Step 4: 跑测试 + 整体构建确认通过**

Run: `mvn test -DskipTests=false -Dtest=MainAppServerCommandTest`
Expected: `Tests run: 2, Failures: 0, Errors: 0`。
Run: `mvn -q clean package -DskipTests`
Expected: 构建成功，产出 `target/wraith-1.0-SNAPSHOT.jar`。

- [ ] **Step 5: 手工冒烟验证（生命周期，无需 LLM）**

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
 '{"jsonrpc":"2.0","id":2,"method":"session.start","params":{}}' \
 '{"jsonrpc":"2.0","id":3,"method":"shutdown","params":{}}' \
 | java -jar target/wraith-1.0-SNAPSHOT.jar app-server
```
Expected stdout（**只能有 JSON-RPC 行，不能混任何 banner/日志**）：三行 result，分别含 `serverInfo` / `sessionId` / `ok`。若看到 banner 或日志混入 → stdout 纯净没做对，回查 `System.setOut` 与 logback。

- [ ] **Step 6: 手工验收（真实一轮，需 API Key）**

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
 '{"jsonrpc":"2.0","id":2,"method":"session.start","params":{}}' \
 '{"jsonrpc":"2.0","id":3,"method":"turn.submit","params":{"input":"列出当前目录的文件"}}' \
 | java -jar target/wraith-1.0-SNAPSHOT.jar app-server
```
Expected：看到 `turn.started` → 若干 `thinking.delta`/`message.delta` →（可能）`tool.call` → `turn.completed`，全为合法 JSON-RPC 行。

- [ ] **Step 7: 提交**

```bash
git add src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/cli/MainAppServerCommandTest.java
git commit -m "feat(app-server): wraith app-server CLI 入口 + stdout 纯净接线

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 修既存 bug —— `X-Wraith CLI-API-Key` 非法头名

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/api/RuntimeApiServer.java:132`
- Test: `src/test/java/com/lyhn/wraith/runtime/api/RuntimeApiServerHeaderTest.java`

**Interfaces:** 无新增。仅把头名从带空格的 `X-Wraith CLI-API-Key` 改为合法的 `X-Wraith-API-Key`。

- [ ] **Step 1: 写失败测试**（提取头名常量后断言其合法）

先把 `authorized()` 里硬编码的头名提为常量 `API_KEY_HEADER`，测试断言它不含空格：

```java
// src/test/java/com/lyhn/wraith/runtime/api/RuntimeApiServerHeaderTest.java
package com.lyhn.wraith.runtime.api;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class RuntimeApiServerHeaderTest {
    @Test
    void apiKeyHeaderHasNoSpace() {
        assertEquals("X-Wraith-API-Key", RuntimeApiServer.API_KEY_HEADER);
        assertFalse(RuntimeApiServer.API_KEY_HEADER.contains(" "), "HTTP 头名不能含空格");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=RuntimeApiServerHeaderTest`
Expected: 编译错误（常量不存在）。

- [ ] **Step 3: 在 `RuntimeApiServer` 加常量并替换 `authorized()` 用法**

类内加：
```java
    static final String API_KEY_HEADER = "X-Wraith-API-Key";
```
把 `authorized()` 第 132 行
```java
        String direct = exchange.getRequestHeaders().getFirst("X-Wraith CLI-API-Key");
```
改为：
```java
        String direct = exchange.getRequestHeaders().getFirst(API_KEY_HEADER);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=RuntimeApiServerHeaderTest`
Expected: `Tests run: 1, Failures: 0, Errors: 0`。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/api/RuntimeApiServer.java \
        src/test/java/com/lyhn/wraith/runtime/api/RuntimeApiServerHeaderTest.java
git commit -m "fix(runtime-api): 修非法头名 X-Wraith CLI-API-Key → X-Wraith-API-Key

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: 命令实时输出流（`appendToolOutputDelta`）

> **右尺寸说明 / 可滑动**：Tasks 1–7 已构成可独立验证的完整 P1 协议（headless harness 通过）。本任务是增强，**不阻塞 P1 核心**。它需要把工具 callId 串到 `ToolRegistry` 的命令执行处——这个接缝需先确认（见 Step 0）。若 callId 串接比预期复杂，本任务可滑到 P3/P4（UI 真正消费实时输出时）再做。

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`（`executeCommand` / `readProcessOutput` 附近，1342–1417）
- Test: `src/test/java/com/lyhn/wraith/tool/CommandStreamingTest.java`

**Interfaces:**
- Produces：`ToolRegistry.setCommandOutputObserver(BiConsumer<String,String> observer)`（参数：`(stream, lineChunk)`，`stream` 为 `"stdout"`）。
- Consumes（Step 0 确认后）：当前工具 callId 的来源。

- [ ] **Step 0（spike，先确认再写码）：定位 callId 接缝**

读 `Agent.run` 的工具执行循环（`appendToolCalls` 在 `Agent.java:214`，其后对每个 `ToolCall` 调用 `toolRegistry.executeTool(name, argsJson)`）。确认：执行某个具体工具调用时，callId 是否能传到 `ToolRegistry`。
- 若能（例如 `executeTool` 已知 callId，或可加一个 `currentCallId` 字段在调用前后 set/clear）→ 按下面实现。
- 若串接复杂 → 在计划里把本任务标记为滑动到 P3，并停止；P1 以 Tasks 1–7 收尾。

记录确认结论（callId 来源 + set 时机）后再继续。

- [ ] **Step 1: 写失败测试**（observer 按行触发）

```java
// src/test/java/com/lyhn/wraith/tool/CommandStreamingTest.java
package com.lyhn.wraith.tool;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class CommandStreamingTest {
    @Test
    void streamsCommandOutputLines(@TempDir Path tempDir) {
        ToolRegistry registry = new ToolRegistry();
        registry.setProjectPath(tempDir.toString());
        List<String> chunks = new ArrayList<>();
        registry.setCommandOutputObserver((stream, chunk) -> chunks.add(chunk));

        registry.executeTool("execute_command", "{\"command\":\"printf 'a\\\\nb\\\\nc\\\\n'\"}");

        String joined = String.join("", chunks);
        assertTrue(joined.contains("a"));
        assertTrue(joined.contains("b"));
        assertTrue(joined.contains("c"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=CommandStreamingTest`
Expected: 编译错误（`setCommandOutputObserver` 不存在）。

- [ ] **Step 3: 给 `ToolRegistry` 加 observer + 在 `readProcessOutput` 的 `readLine` 循环里推送**

加字段 + setter：
```java
    private java.util.function.BiConsumer<String, String> commandOutputObserver = (s, c) -> {};
    public void setCommandOutputObserver(java.util.function.BiConsumer<String, String> observer) {
        this.commandOutputObserver = observer == null ? (s, c) -> {} : observer;
    }
```
在 `readProcessOutput` 的 `while ((line = reader.readLine()) != null)` 循环体内、append 到 StringBuilder 的同时，加：
```java
            try { commandOutputObserver.accept("stdout", line + "\n"); } catch (Exception ignored) {}
```
（保留原缓冲返回逻辑不变——返回值仍给 agent 作为工具结果；observer 只是额外的流式旁路。）

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=CommandStreamingTest`
Expected: `Tests run: 1, Failures: 0, Errors: 0`。

- [ ] **Step 5: 在 app-server 入口接线（按 Step 0 结论填 callId）**

在 Task 6 的工厂 lambda 里，`registry` 建好后加（callId 来源按 Step 0 结论；若用 `currentCallId` 字段则读它）：
```java
                registry.setCommandOutputObserver((stream, chunk) ->
                        renderer.appendToolOutputDelta(registry.currentCallId(), stream, chunk));
```
> 若 Step 0 结论是"callId 串接复杂"，本 Step 跳过、observer 用占位 callId，并把"精确 callId 关联"记入 P3 待办。

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/tool/ToolRegistry.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/tool/CommandStreamingTest.java
git commit -m "feat(app-server): 命令执行实时输出流 appendToolOutputDelta

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## P1 完成判据（DoD）

- `mvn test -DskipTests=false -Dtest=JsonRpcTest,EventStreamRendererTest,EventStreamApprovalTest,AppServerTest,MainAppServerCommandTest,RuntimeApiServerHeaderTest` 全绿。
- `mvn -q clean package -DskipTests` 通过，产出 `target/wraith-1.0-SNAPSHOT.jar`。
- Task 6 Step 5 冒烟：纯 JSON-RPC 三行 result，stdout 无污染。
- Task 6 Step 6 手工验收：真实一轮的事件序列正确（手工，需 API Key）。
- 全量回归 `mvn test -DskipTests=false` 失败数不超过既有基线（约 3–4F/38E 环境性），无本计划引入的新失败。

## 给 P2 的衔接

P1 完成后，agent 在 app-server 模式下跑命令仍是**无沙箱**的。P2 在此之上：把 `ToolRegistry.executeCommand` 的 `ProcessBuilder("bash","-c",cmd)`（`ToolRegistry.java:1362`）包进 `sandbox-exec`，落实 workspace-write + 默认断网；并接现有 HITL 审批的"放行网络"。P2 的计划在 P1 落地后另写。
