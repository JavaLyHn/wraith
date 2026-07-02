# Phase C 富对话视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面端富对话视图——Monaco per-hunk diff（事后卡片 + 审批前预览）、富审批弹窗（命令编辑 / 本次放行网络 / JSON 改参兜底 / 本会话放行）、Composer token 状态 chip。

**Architecture:** 方案 1「后端最小增量」：Java 侧只加 `ApprovalRequest.beforeContent`、`ApprovalResult.allowNetworkOnce` 与网络单次覆盖链；`diff`/`status` 事件已在 wire 上，前端开始消费。Monaco 只进 renderer。

**Tech Stack:** Java 17/Maven（JUnit5 headless harness，避 Mockito）；Electron + React18 + TS（electron-vite）；monaco-editor；vitest；Playwright `_electron`。

**Spec:** `docs/specs/2026-07-02-desktop-phase-c-rich-transcript.md`（各任务遇歧义以 spec 为准）。

## Global Constraints

- 单活跃会话架构不变；AppServer 单槽不变；不动 session 持久化链路。
- preload 保持 CJS（`electron.vite.config.ts` 的 preload output 不许动）；`desktop/src/shared/` 纯 TS，**不得 import monaco/React/Electron**。
- Monaco 只进 renderer 包；只配 `editor.worker` 一个 worker，不引语言 worker。
- Java 测试必须带 `-DskipTests=false`，并确认输出 `Tests run:` 行；~3F/38E 是 JDK26+Mockito 环境噪音基线，新测试避免 Mockito。
- 不做 per-hunk 单独批准、不做会话级网络开关 UI、不消费 `todos` 事件。
- 密钥永不入库；`.superpowers/sdd/` 不入库（已 gitignore，报告不 commit）。
- 每任务一提交，commit 尾行：`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- E2E 无 sleep / 无像素断言；等待一律走 `data-testid`。
- Java 侧关键既有事实（探索已核实，直接依赖）：
  - `ToolRegistry` 有 `private static final ObjectMapper mapper`（:65）、`private PathGuard pathGuard`（:97，`setProjectPath` 会重建）、`private String projectPath`（:96）、`MAX_WRITE_FILE_BYTES = 5MB`（:84）。
  - `ApprovalPolicy.requiresApproval("write_file") == true`（write_file 在审批清单，🟡 中危）。
  - `HitlToolRegistry extends ToolRegistry`；审批（阻塞）与执行同线程同对象。
  - `EventStreamRenderer.promptApproval` 的 approvalId 序列确定为 `appr_1, appr_2, …`（AtomicLong）。
  - `CommandSandbox(boolean networkAllowed)` 无其他状态；`SeatbeltProfile.workspaceWrite(false)` 含 `(deny network*)`，`true` 不含。

---

### Task 1: Java — `ApprovalRequest.beforeContent` + `ToolRegistry.readWriteFileBefore()`

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/hitl/ApprovalRequest.java`（record 头 + 新构造器/新方法；`toDisplayText` 等其余不动）
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`（加一个常量 + 一个 protected 方法）
- Modify: `src/main/java/com/lyhn/wraith/hitl/HitlToolRegistry.java:58`（填充 beforeContent）
- Test: `src/test/java/com/lyhn/wraith/hitl/HitlToolRegistryBeforeContentTest.java`（新建）

**Interfaces:**
- Consumes: 既有 `ApprovalRequest.of(name, args, suggestion, callerContext, sensitiveNotice)` 5 参工厂；`pathGuard.resolveSafe(String)`。
- Produces: `ApprovalRequest` 第 8 字段 `String beforeContent()`（可空）+ `withBeforeContent(String)`；`ToolRegistry` 的 `protected String readWriteFileBefore(String argumentsJson)`。Task 2 依赖 `beforeContent()`。

- [ ] **Step 1: 写失败测试**

```java
// src/test/java/com/lyhn/wraith/hitl/HitlToolRegistryBeforeContentTest.java
package com.lyhn.wraith.hitl;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;

class HitlToolRegistryBeforeContentTest {

    /** 捕获 ApprovalRequest 后一律拒绝(不真正写文件)。 */
    static class CapturingHandler implements HitlHandler {
        ApprovalRequest captured;
        @Override public boolean isEnabled() { return true; }
        @Override public void setEnabled(boolean enabled) {}
        @Override public ApprovalResult requestApproval(ApprovalRequest request) {
            captured = request;
            return ApprovalResult.reject("test");
        }
        @Override public boolean isApprovedAllByTool(String toolName) { return false; }
        @Override public boolean isApprovedAllByServer(String serverName) { return false; }
        @Override public void clearApprovedAll() {}
        @Override public void clearApprovedAllForServer(String serverName) {}
    }
    // 注意:以 HitlHandler 实际接口为准(方法集与 RendererHitlHandler 的 @Override 一致);
    // 若有 default 方法可不覆写。

    private static HitlToolRegistry registry(CapturingHandler h, Path dir) {
        HitlToolRegistry reg = new HitlToolRegistry(h);
        reg.setProjectPath(dir.toString()); // 会重建 PathGuard
        return reg;
    }

    @Test
    void existingFileFillsBeforeContent(@TempDir Path dir) throws Exception {
        Files.writeString(dir.resolve("a.txt"), "old body");
        CapturingHandler h = new CapturingHandler();
        registry(h, dir).executeToolOutput("write_file", "{\"path\":\"a.txt\",\"content\":\"new\"}");
        assertNotNull(h.captured);
        assertEquals("old body", h.captured.beforeContent());
    }

    @Test
    void missingFileYieldsNullBeforeContent(@TempDir Path dir) {
        CapturingHandler h = new CapturingHandler();
        registry(h, dir).executeToolOutput("write_file", "{\"path\":\"nope.txt\",\"content\":\"new\"}");
        assertNotNull(h.captured);
        assertNull(h.captured.beforeContent());
    }

    @Test
    void oversizedFileYieldsNullBeforeContent(@TempDir Path dir) throws Exception {
        byte[] big = new byte[513 * 1024]; // > 512KB
        Files.write(dir.resolve("big.txt"), big);
        CapturingHandler h = new CapturingHandler();
        registry(h, dir).executeToolOutput("write_file", "{\"path\":\"big.txt\",\"content\":\"new\"}");
        assertNull(h.captured.beforeContent());
    }

    @Test
    void nonWriteFileToolLeavesBeforeContentNull(@TempDir Path dir) {
        CapturingHandler h = new CapturingHandler();
        registry(h, dir).executeToolOutput("execute_command", "{\"command\":\"\"}");
        assertNotNull(h.captured);
        assertNull(h.captured.beforeContent());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=HitlToolRegistryBeforeContentTest 2>&1 | grep -E "Tests run:|ERROR|BUILD"`
Expected: 编译失败（`beforeContent()` 不存在）。

- [ ] **Step 3: 实现**

`ApprovalRequest.java` — record 头换成 8 字段，并保留 7 参兼容构造 + with 方法（**所有既有 `of(...)` 工厂和 `toDisplayText` 逻辑不动**，只在 7 参 `of` 的 `new ApprovalRequest(...)` 调用处保持 7 参形式即可，它会走兼容构造）：

```java
public record ApprovalRequest(
        String toolName,
        String arguments,
        String dangerLevel,
        String riskDescription,
        String suggestion,
        String callerContext,
        String sensitiveNotice,
        String beforeContent   // 仅 write_file 审批预览:旧文件全文;新文件/不可读/超 512KB → null
) {
    /** 兼容 7 参构造(既有工厂/测试全部走这里),beforeContent=null。 */
    public ApprovalRequest(String toolName, String arguments, String dangerLevel, String riskDescription,
                           String suggestion, String callerContext, String sensitiveNotice) {
        this(toolName, arguments, dangerLevel, riskDescription, suggestion, callerContext, sensitiveNotice, null);
    }

    /** 附加旧文件内容(write_file 审批预览用)。 */
    public ApprovalRequest withBeforeContent(String beforeContent) {
        return new ApprovalRequest(toolName, arguments, dangerLevel, riskDescription,
                suggestion, callerContext, sensitiveNotice, beforeContent);
    }
    // …… 其余原有内容(静态 MAPPER、of 工厂、toDisplayText、宽度工具方法)一字不动 ……
```

`ToolRegistry.java` — 在 `MAX_WRITE_FILE_BYTES` 附近加常量，在类尾部（`setCommandSandbox` 附近）加方法：

```java
    /** 审批前 diff 预览的旧文件上限:超过则不带 beforeContent(防事件爆炸)。 */
    private static final long MAX_APPROVAL_PREVIEW_BYTES = 512 * 1024;

    /**
     * 审批前 diff 预览:读取 write_file 目标的当前内容。
     * 新文件 / 路径越界 / 不可读 / 超 512KB → null,绝不抛异常(不阻断审批)。
     */
    protected String readWriteFileBefore(String argumentsJson) {
        try {
            JsonNode root = mapper.readTree(argumentsJson);
            String path = root.path("path").asText(null);
            if (path == null || path.isBlank()) return null;
            Path safe = pathGuard.resolveSafe(path);
            if (!Files.exists(safe) || !Files.isRegularFile(safe)) return null;
            if (Files.size(safe) > MAX_APPROVAL_PREVIEW_BYTES) return null;
            return Files.readString(safe);
        } catch (Exception e) {
            return null;
        }
    }
```

（`JsonNode`/`Files`/`Path` 在 ToolRegistry 已有 import；若编译器提示缺失再补。）

`HitlToolRegistry.java` `executeAfterExplicitApproval` 开头（原 :58 一行变三行）：

```java
        ApprovalRequest request = ApprovalRequest.of(name, argumentsJson, null, null, sensitiveNotice);
        if ("write_file".equals(name)) {
            request = request.withBeforeContent(readWriteFileBefore(argumentsJson));
        }
```

- [ ] **Step 4: 跑测试确认通过 + 全量 Java 回归**

Run: `mvn test -DskipTests=false -Dtest='HitlToolRegistryBeforeContentTest' 2>&1 | grep -E "Tests run:|BUILD"`
Expected: `Tests run: 4, Failures: 0, Errors: 0` + `BUILD SUCCESS`
Run: `mvn test -DskipTests=false 2>&1 | tail -25`
Expected: 与基线一致（新增失败为 0；~3F/38E 环境噪音基线不算新失败）。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/hitl/ApprovalRequest.java \
        src/main/java/com/lyhn/wraith/tool/ToolRegistry.java \
        src/main/java/com/lyhn/wraith/hitl/HitlToolRegistry.java \
        src/test/java/com/lyhn/wraith/hitl/HitlToolRegistryBeforeContentTest.java
git commit -m "feat(hitl): write_file 审批请求携带旧文件内容 beforeContent(新文件/超限/不可读为 null)"
```

---

### Task 2: Java — `ApprovalResult.allowNetworkOnce` + wire 解析 + `approval.requested` 带 beforeContent

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/hitl/ApprovalResult.java`（record 头 + 兼容构造）
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java:146-164`（`handleApprovalRespond` 读 `allowNetwork`）
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java:94-113`（payload 加 `beforeContent`）
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamApprovalTest.java`（扩展）
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerApprovalRespondTest.java`（新建）

**Interfaces:**
- Consumes: Task 1 的 `ApprovalRequest.withBeforeContent`/`beforeContent()`。
- Produces: `ApprovalResult` 第 4 字段 `boolean allowNetworkOnce()`（3 参兼容构造保留，既有工厂/调用零改动）；wire 上 `approval.respond` 可选参数 `allowNetwork`；`approval.requested` 新字段 `beforeContent`。Task 3 依赖 `allowNetworkOnce()`；Task 4/8/10 依赖两个 wire 字段。

- [ ] **Step 1: 写失败测试**

`EventStreamApprovalTest.java` 追加一个测试方法（文件其余不动）：

```java
    @Test
    void approvalRequestedCarriesBeforeContent() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        EventStreamRenderer r = new EventStreamRenderer(new JsonRpcWriter(out), "s1");
        r.setCurrentTurnId("t1");
        ApprovalRequest req = ApprovalRequest
                .of("write_file", "{\"path\":\"a.txt\",\"content\":\"new\"}", null, null, null)
                .withBeforeContent("old body");

        ExecutorService ex = Executors.newSingleThreadExecutor();
        Future<ApprovalResult> f = ex.submit(() -> r.promptApproval(req));
        String beforeContent = null;
        for (int i = 0; i < 50 && beforeContent == null; i++) {
            for (String ln : out.toString(StandardCharsets.UTF_8).split("\n")) {
                if (ln.isBlank()) continue;
                JsonNode n = JsonRpc.MAPPER.readTree(ln);
                if ("approval.requested".equals(n.path("method").asText())) {
                    beforeContent = n.get("params").path("beforeContent").asText(null);
                    r.resolveApproval(n.get("params").get("approvalId").asText(), ApprovalResult.approve());
                }
            }
            if (beforeContent == null) Thread.sleep(20);
        }
        f.get(2, TimeUnit.SECONDS);
        assertEquals("old body", beforeContent);
        ex.shutdownNow();
    }
```

新建 `AppServerApprovalRespondTest.java`（Piped 流哈ness：审批需要请求/响应交错）：

```java
package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.session.SessionMeta;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class AppServerApprovalRespondTest {

    @Test
    void respondParsesModifiedArgsAndAllowNetwork() throws Exception {
        AtomicReference<ApprovalResult> got = new AtomicReference<>();
        AppServer.SessionRunnerFactory factory = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) {
                    ApprovalRequest req = ApprovalRequest.of("execute_command", "{\"command\":\"curl x\"}", null, null, null);
                    got.set(r.promptApproval(req));
                    return "ok";
                }
                public List<SessionMeta> listSessions() { return List.of(); }
                public List<LlmClient.Message> resume(String id) { return List.of(); }
                public String persistTurn() { return null; }
            };
        };

        PipedOutputStream feed = new PipedOutputStream();
        PipedInputStream in = new PipedInputStream(feed, 1 << 16);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Thread server = new Thread(() -> new AppServer(in, out, factory).serve());
        server.setDaemon(true);
        server.start();

        feed.write(("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}\n"
                + "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"turn.submit\",\"params\":{\"input\":\"hi\"}}\n")
                .getBytes(StandardCharsets.UTF_8));
        feed.flush();

        // 等 approval.requested 出现(approvalId 确定为 appr_1,但仍从事件里取,防守)
        String approvalId = null;
        long deadline = System.currentTimeMillis() + 2000;
        while (System.currentTimeMillis() < deadline && approvalId == null) {
            String s = out.toString(StandardCharsets.UTF_8);
            if (s.contains("approval.requested")) {
                for (String ln : s.split("\n")) {
                    if (ln.contains("approval.requested")) {
                        approvalId = JsonRpc.MAPPER.readTree(ln).get("params").get("approvalId").asText();
                    }
                }
            }
            if (approvalId == null) Thread.sleep(20);
        }
        assertNotNull(approvalId, "应发出 approval.requested");

        feed.write(("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"approval.respond\",\"params\":{"
                + "\"approvalId\":\"" + approvalId + "\",\"decision\":\"MODIFIED\","
                + "\"modifiedArgs\":\"{\\\"command\\\":\\\"curl y\\\"}\",\"allowNetwork\":true}}\n")
                .getBytes(StandardCharsets.UTF_8));
        feed.flush();

        deadline = System.currentTimeMillis() + 2000;
        while (System.currentTimeMillis() < deadline && got.get() == null) Thread.sleep(20);
        ApprovalResult result = got.get();
        assertNotNull(result);
        assertEquals(ApprovalResult.Decision.MODIFIED, result.decision());
        assertEquals("{\"command\":\"curl y\"}", result.modifiedArguments());
        assertTrue(result.allowNetworkOnce());

        feed.write("{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}\n".getBytes(StandardCharsets.UTF_8));
        feed.flush();
        server.join(2000);
    }

    @Test
    void respondDefaultsAllowNetworkFalse() throws Exception {
        // 同上骨架,respond 为 {"approvalId":…,"decision":"APPROVED"}(无 allowNetwork/modifiedArgs);
        // 断言 decision==APPROVED、modifiedArguments()==null、allowNetworkOnce()==false。
        AtomicReference<ApprovalResult> got = new AtomicReference<>();
        AppServer.SessionRunnerFactory factory = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) {
                    got.set(r.promptApproval(ApprovalRequest.of("execute_command", "{\"command\":\"ls\"}", null, null, null)));
                    return "ok";
                }
                public List<SessionMeta> listSessions() { return List.of(); }
                public List<LlmClient.Message> resume(String id) { return List.of(); }
                public String persistTurn() { return null; }
            };
        };
        PipedOutputStream feed = new PipedOutputStream();
        PipedInputStream in = new PipedInputStream(feed, 1 << 16);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Thread server = new Thread(() -> new AppServer(in, out, factory).serve());
        server.setDaemon(true);
        server.start();
        feed.write(("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}\n"
                + "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"turn.submit\",\"params\":{\"input\":\"hi\"}}\n")
                .getBytes(StandardCharsets.UTF_8));
        feed.flush();
        String approvalId = null;
        long deadline = System.currentTimeMillis() + 2000;
        while (System.currentTimeMillis() < deadline && approvalId == null) {
            String s = out.toString(StandardCharsets.UTF_8);
            for (String ln : s.split("\n")) {
                if (ln.contains("approval.requested")) {
                    approvalId = JsonRpc.MAPPER.readTree(ln).get("params").get("approvalId").asText();
                }
            }
            if (approvalId == null) Thread.sleep(20);
        }
        assertNotNull(approvalId);
        feed.write(("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"approval.respond\",\"params\":{"
                + "\"approvalId\":\"" + approvalId + "\",\"decision\":\"APPROVED\"}}\n").getBytes(StandardCharsets.UTF_8));
        feed.flush();
        deadline = System.currentTimeMillis() + 2000;
        while (System.currentTimeMillis() < deadline && got.get() == null) Thread.sleep(20);
        assertNotNull(got.get());
        assertEquals(ApprovalResult.Decision.APPROVED, got.get().decision());
        assertNull(got.get().modifiedArguments());
        assertFalse(got.get().allowNetworkOnce());
        feed.write("{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}\n".getBytes(StandardCharsets.UTF_8));
        feed.flush();
        server.join(2000);
    }

    @Test
    void invalidDecisionRejectedAndApprovedAllParses() throws Exception {
        // 不需要 runner 交错:decision 校验发生在 resolveApproval 之前;
        // APPROVED_ALL 对不存在的 approvalId 是 no-op,但能证明枚举解析通过(返回 ok 而非 -32602)。
        AppServer.SessionRunnerFactory factory = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
                public List<SessionMeta> listSessions() { return List.of(); }
                public List<LlmClient.Message> resume(String id) { return List.of(); }
                public String persistTurn() { return null; }
            };
        };
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"approval.respond\",\"params\":{\"approvalId\":\"x\",\"decision\":\"BOGUS\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"approval.respond\",\"params\":{\"approvalId\":\"x\",\"decision\":\"APPROVED_ALL\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, factory).serve();
        String s = out.toString(StandardCharsets.UTF_8);
        boolean sawInvalid = false;
        boolean sawApprovedAllOk = false;
        for (String ln : s.split("\n")) {
            if (ln.isBlank()) continue;
            var n = JsonRpc.MAPPER.readTree(ln);
            if (n.path("id").asInt(-1) == 2 && n.has("error")) {
                assertEquals(-32602, n.get("error").get("code").asInt());
                sawInvalid = true;
            }
            if (n.path("id").asInt(-1) == 3 && n.has("result")) {
                sawApprovedAllOk = true;
            }
        }
        assertTrue(sawInvalid, "BOGUS decision 应回 -32602");
        assertTrue(sawApprovedAllOk, "APPROVED_ALL 应解析通过并回 ok");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest='EventStreamApprovalTest,AppServerApprovalRespondTest' 2>&1 | grep -E "Tests run:|ERROR|BUILD"`
Expected: 编译失败（`allowNetworkOnce()`/`withBeforeContent` 若 Task 1 已合入则前者失败）。

- [ ] **Step 3: 实现**

`ApprovalResult.java` — record 头换 4 字段 + 兼容构造（**枚举、全部静态工厂、isXxx、effectiveArguments 一字不动**——工厂内部 `new ApprovalResult(x, y, z)` 走兼容构造）：

```java
public record ApprovalResult(
        Decision decision,
        String modifiedArguments,
        String reason,
        boolean allowNetworkOnce   // 「本次放行网络」:仅对本次批准的 execute_command 生效
) {
    /** 兼容 3 参构造(既有工厂/调用全部走这里),allowNetworkOnce=false。 */
    public ApprovalResult(Decision decision, String modifiedArguments, String reason) {
        this(decision, modifiedArguments, reason, false);
    }
    // …… 其余原有内容不动 ……
```

`AppServer.handleApprovalRespond` — 在 `reason` 解析行后加一行、构造改 4 参：

```java
        String reason = p.hasNonNull("reason") ? p.get("reason").asText() : null;
        boolean allowNetwork = p.path("allowNetwork").asBoolean(false);
        // …… Decision 解析不变 ……
        ApprovalResult result = new ApprovalResult(d, modifiedArgs, reason, allowNetwork);
```

`EventStreamRenderer.promptApproval` — `p.put("suggestion", ...)` 之后加：

```java
        p.put("beforeContent", request.beforeContent()); // 可空;LinkedHashMap 允许 null → JSON null
```

- [ ] **Step 4: 跑测试确认通过 + 回归**

Run: `mvn test -DskipTests=false -Dtest='EventStreamApprovalTest,AppServerApprovalRespondTest,AppServerSessionTest' 2>&1 | grep -E "Tests run:|BUILD"`
Expected: 全部 `Failures: 0, Errors: 0` + `BUILD SUCCESS`。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/hitl/ApprovalResult.java \
        src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java \
        src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamApprovalTest.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerApprovalRespondTest.java
git commit -m "feat(appserver): approval wire 增量——requested 带 beforeContent,respond 解析 allowNetwork"
```

---

### Task 3: Java — 网络单次覆盖链（grantNetworkOnce → 沙箱 wrap）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`（字段 + 2 方法 + `resolveProcessCommand` 改写，:1382-1395 附近）
- Modify: `src/main/java/com/lyhn/wraith/hitl/HitlToolRegistry.java:76-78`（批准分支触发）
- Test: `src/test/java/com/lyhn/wraith/tool/ToolRegistryNetworkOnceTest.java`（新建）

**Interfaces:**
- Consumes: Task 2 的 `ApprovalResult.allowNetworkOnce()`；既有 `CommandSandbox.buildCommand(boolean, boolean, root, tmp, git, cmd)` 静态方法与 `Wrapped(command, sandboxed, warning)`。
- Produces: `ToolRegistry.grantNetworkOnce()`（public）、`consumeNetworkOnce()`（包私有）。E2E（Task 10）走 mock 不触此链；真机验证列入「待眼验」。

- [ ] **Step 1: 写失败测试**

```java
// src/test/java/com/lyhn/wraith/tool/ToolRegistryNetworkOnceTest.java
package com.lyhn.wraith.tool;

import com.lyhn.wraith.hitl.*;
import com.lyhn.wraith.policy.sandbox.CommandSandbox;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class ToolRegistryNetworkOnceTest {

    @Test
    void grantIsConsumedOnce() {
        ToolRegistry reg = new ToolRegistry();
        assertFalse(reg.consumeNetworkOnce());
        reg.grantNetworkOnce();
        assertTrue(reg.consumeNetworkOnce());
        assertFalse(reg.consumeNetworkOnce(), "消费即清,第二次必须为 false");
    }

    @Test
    void resolveProcessCommandConsumesGrantEvenWithoutSandbox() {
        ToolRegistry reg = new ToolRegistry(); // 未注入沙箱
        reg.grantNetworkOnce();
        List<String> cmd = reg.resolveProcessCommand("echo hi");
        assertEquals(List.of("bash", "-c", "echo hi"), cmd);
        assertFalse(reg.consumeNetworkOnce(), "无沙箱也要消费,防泄漏到后续命令");
    }

    @Test
    void networkOverrideOmitsDenyNetworkInProfile() {
        // 走 CommandSandbox 静态构建验证 profile 语义(不依赖本机 sandbox-exec)
        CommandSandbox.Wrapped withNet = CommandSandbox.buildCommand(
                true, true, "/proj", "/tmp", null, "curl example.com");
        CommandSandbox.Wrapped noNet = CommandSandbox.buildCommand(
                true, false, "/proj", "/tmp", null, "curl example.com");
        String withNetJoined = String.join("\n", withNet.command());
        String noNetJoined = String.join("\n", noNet.command());
        assertFalse(withNetJoined.contains("(deny network*)"));
        assertTrue(noNetJoined.contains("(deny network*)"));
    }

    @Test
    void hitlApprovalWithNetworkTriggersGrant(@TempDir Path dir) {
        // 空命令让 executeCommand 在 resolveProcessCommand 之前早退 → 标记不被消费,可断言
        HitlHandler h = new HitlHandler() {
            @Override public boolean isEnabled() { return true; }
            @Override public void setEnabled(boolean enabled) {}
            @Override public ApprovalResult requestApproval(ApprovalRequest request) {
                return new ApprovalResult(ApprovalResult.Decision.APPROVED, null, null, true);
            }
            @Override public boolean isApprovedAllByTool(String toolName) { return false; }
            @Override public boolean isApprovedAllByServer(String serverName) { return false; }
            @Override public void clearApprovedAll() {}
            @Override public void clearApprovedAllForServer(String serverName) {}
        };
        HitlToolRegistry reg = new HitlToolRegistry(h);
        reg.setProjectPath(dir.toString());
        reg.executeToolOutput("execute_command", "{\"command\":\"\"}");
        assertTrue(reg.consumeNetworkOnce(), "批准且 allowNetworkOnce=true 应触发 grantNetworkOnce");
    }

    @Test
    void hitlApprovalWithoutNetworkDoesNotGrant(@TempDir Path dir) {
        HitlHandler h = new HitlHandler() {
            @Override public boolean isEnabled() { return true; }
            @Override public void setEnabled(boolean enabled) {}
            @Override public ApprovalResult requestApproval(ApprovalRequest request) {
                return ApprovalResult.approve(); // allowNetworkOnce=false
            }
            @Override public boolean isApprovedAllByTool(String toolName) { return false; }
            @Override public boolean isApprovedAllByServer(String serverName) { return false; }
            @Override public void clearApprovedAll() {}
            @Override public void clearApprovedAllForServer(String serverName) {}
        };
        HitlToolRegistry reg = new HitlToolRegistry(h);
        reg.setProjectPath(dir.toString());
        reg.executeToolOutput("execute_command", "{\"command\":\"\"}");
        assertFalse(reg.consumeNetworkOnce());
    }
}
```

（注：`CommandSandbox.buildCommand` 的参数序按现有签名 `buildCommand(boolean sandboxAvailable, boolean networkAllowed, root, tmpDir, gitDir, command)` 核对，`gitDir` 允许 null 与否以现有 `CommandSandboxTest` 用法为准，照抄其调用形式。）

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=ToolRegistryNetworkOnceTest 2>&1 | grep -E "Tests run:|ERROR|BUILD"`
Expected: 编译失败（`grantNetworkOnce` 不存在）。

- [ ] **Step 3: 实现**

`ToolRegistry.java` — 字段区（`sandboxWarningLogged` 附近）加：

```java
    /** 「本次放行网络」一次性标记:HITL 批准后置位,下一条命令的沙箱 wrap 消费即清。 */
    private volatile boolean networkOnceGrant = false;

    /** HITL 批准「本次放行网络」后调用(仅影响下一条 execute_command)。 */
    public void grantNetworkOnce() { this.networkOnceGrant = true; }

    /** 取出并复位一次性网络放行标记。 */
    boolean consumeNetworkOnce() {
        boolean g = networkOnceGrant;
        networkOnceGrant = false;
        return g;
    }
```

`resolveProcessCommand` 改写为：

```java
    /** 决定 execute_command 子进程命令行:注入了 sandbox 则包裹,否则裸 bash -c。 */
    List<String> resolveProcessCommand(String normalized) {
        CommandSandbox sandbox = this.commandSandbox;
        boolean networkOnce = consumeNetworkOnce(); // 无沙箱也消费,避免标记泄漏到后续命令
        if (sandbox == null) {
            return List.of("bash", "-c", normalized);
        }
        if (networkOnce) {
            sandbox = new CommandSandbox(true); // 仅本条命令放行网络,读/写限制不变
        }
        CommandSandbox.Wrapped wrapped = sandbox.wrap(projectPath, normalized);
        if (!wrapped.sandboxed() && !sandboxWarningLogged) {
            log.warn("[sandbox] {}", wrapped.warning());
            sandboxWarningLogged = true;
        }
        return wrapped.command();
    }
```

`HitlToolRegistry.executeAfterExplicitApproval` 批准分支（:76-78）改为：

```java
        // 批准（含修改参数）- 使用 effectiveArguments 获取最终参数；父类执行路径会负责 allow audit
        String effectiveArgs = result.effectiveArguments(argumentsJson);
        if (result.allowNetworkOnce() && "execute_command".equals(name)) {
            grantNetworkOnce(); // 「本次放行网络」:仅对即将执行的这条命令生效
        }
        return super.doExecuteTool(name, effectiveArgs);
```

- [ ] **Step 4: 跑测试确认通过 + 回归**

Run: `mvn test -DskipTests=false -Dtest='ToolRegistryNetworkOnceTest' 2>&1 | grep -E "Tests run:|BUILD"`
Expected: `Tests run: 5, Failures: 0, Errors: 0`。
Run: `mvn test -DskipTests=false 2>&1 | tail -25`（全量回归,新增失败为 0）

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/tool/ToolRegistry.java \
        src/main/java/com/lyhn/wraith/hitl/HitlToolRegistry.java \
        src/test/java/com/lyhn/wraith/tool/ToolRegistryNetworkOnceTest.java
git commit -m "feat(sandbox): 本次放行网络——审批决策经 grantNetworkOnce 单次覆盖沙箱断网,消费即清"
```

---

### Task 4: 前端 shared — reducer 消费 diff/status + pendingApproval 扩展

**Files:**
- Modify: `desktop/src/shared/types.ts`（加 `StatusData`）
- Modify: `desktop/src/shared/transcriptReducer.ts`（Item/状态/3 个 case/resetSession）
- Test: `desktop/test/transcriptReducer.test.ts`（扩展）

**Interfaces:**
- Consumes: wire 事件 `diff{filePath,before,after}`、`status{status:{…}}`、`approval.requested{…,suggestion,beforeContent}`（Task 2 后端已发）。
- Produces: `Item` 新成员 `{type:'diff'; filePath; before; after}`；`TranscriptState.status: StatusData | null`；`TranscriptState.pendingApproval` 增 `suggestion: string` 与 `beforeContent: string | null`；`StatusData`（types.ts 导出）。Task 7/8/9 依赖。

- [ ] **Step 1: 写失败测试**（`transcriptReducer.test.ts` 追加 describe）

```ts
describe('phase-C: diff / status / approval 扩展', () => {
  it('diff event appends a diff item and seals _messageOpen', () => {
    const open: TranscriptState = { ...initialState, _messageOpen: true }
    const s = reduce(open, notif('diff', { filePath: 'src/a.ts', before: 'x', after: 'y' }))
    expect(s.items[s.items.length - 1]).toEqual({ type: 'diff', filePath: 'src/a.ts', before: 'x', after: 'y' })
    expect(s._messageOpen).toBe(false)
  })
  it('status event maps the payload subset', () => {
    const s = reduce(initialState, notif('status', { status: {
      model: 'm', totalTokens: 1200, contextWindow: 64000, inputTokens: 900, outputTokens: 300,
      cachedInputTokens: 500, estimatedCost: '¥0.01', hitlEnabled: true, elapsedMillis: 800, phase: 'running',
    } }))
    expect(s.status).toEqual({
      model: 'm', totalTokens: 1200, contextWindow: 64000, inputTokens: 900, outputTokens: 300,
      cachedInputTokens: 500, estimatedCost: '¥0.01', elapsedMillis: 800, phase: 'running',
    })
  })
  it('status event without payload leaves state unchanged', () => {
    expect(reduce(initialState, notif('status', {}))).toEqual(initialState)
  })
  it('resetSession clears status', () => {
    const withStatus: TranscriptState = { ...initialState, status: {
      model: 'm', totalTokens: 1, contextWindow: 2, inputTokens: 0, outputTokens: 0,
      cachedInputTokens: 0, estimatedCost: null, elapsedMillis: 0, phase: 'idle' } }
    expect(resetSession(withStatus, '/w').status).toBeNull()
  })
  it('approval.requested carries suggestion and beforeContent (with defaults)', () => {
    const s = reduce(initialState, notif('approval.requested', {
      approvalId: 'a1', toolName: 'write_file', argsJson: '{}',
      dangerLevel: '🟡 中危', riskDescription: 'r', suggestion: '要写文件', beforeContent: 'old',
    }))
    expect(s.pendingApproval?.suggestion).toBe('要写文件')
    expect(s.pendingApproval?.beforeContent).toBe('old')
    const s2 = reduce(initialState, notif('approval.requested', { approvalId: 'a2', toolName: 't', argsJson: '{}' }))
    expect(s2.pendingApproval?.suggestion).toBe('')
    expect(s2.pendingApproval?.beforeContent).toBeNull()
  })
})
```

（`notif` 是该测试文件既有 helper；`initialState`/`resetSession` 已在 import 列表。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/transcriptReducer.test.ts 2>&1 | tail -8`
Expected: FAIL（新 case 未实现;TS 类型错误也算失败）。

- [ ] **Step 3: 实现**

`types.ts` 末尾追加：

```ts
// ---------------------------------------------------------------------------
// Phase C: status 事件负载(Java StatusInfo 的前端子集)
// ---------------------------------------------------------------------------

export interface StatusData {
  model: string
  totalTokens: number
  contextWindow: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  estimatedCost: string | null
  elapsedMillis: number
  phase: string
}
```

`transcriptReducer.ts`：

1. import 行改 `import type { BackendEvent, StatusData } from './types'`。
2. `Item` 联合追加一行：`| { type: 'diff'; filePath: string; before: string; after: string }`。
3. `TranscriptState.pendingApproval` 对象类型追加 `suggestion: string` 与 `beforeContent: string | null`；`TranscriptState` 追加 `` /** token 状态(status 事件,resetSession 清空)。 */ status: StatusData | null ``；`initialState` 追加 `status: null,`。
4. `approval.requested` case 内追加解析并放入对象：

```ts
      const suggestion = typeof p['suggestion'] === 'string' ? p['suggestion'] : ''
      const beforeContent = typeof p['beforeContent'] === 'string' ? p['beforeContent'] : null
      return {
        ...state,
        pendingApproval: { approvalId, toolName, argsJson, dangerLevel, riskDescription, suggestion, beforeContent },
      }
```

5. `approval.requested` case 之后、`default` 之前追加两个 case：

```ts
    // ── diff (write_file 执行后的前后全文) ───────────────────────────────────
    case 'diff': {
      const filePath = typeof p['filePath'] === 'string' ? p['filePath'] : ''
      const before = typeof p['before'] === 'string' ? p['before'] : ''
      const after = typeof p['after'] === 'string' ? p['after'] : ''
      return {
        ...state,
        items: [...state.items, { type: 'diff', filePath, before, after }],
        _messageOpen: false,
      }
    }

    // ── status (token/阶段状态,高频;节流在 App 入口) ─────────────────────────
    case 'status': {
      const s = p['status'] as Record<string, unknown> | undefined
      if (!s || typeof s !== 'object') return state
      const num = (k: string): number => (typeof s[k] === 'number' ? (s[k] as number) : 0)
      return {
        ...state,
        status: {
          model: typeof s['model'] === 'string' ? (s['model'] as string) : '',
          totalTokens: num('totalTokens'),
          contextWindow: num('contextWindow'),
          inputTokens: num('inputTokens'),
          outputTokens: num('outputTokens'),
          cachedInputTokens: num('cachedInputTokens'),
          estimatedCost: typeof s['estimatedCost'] === 'string' ? (s['estimatedCost'] as string) : null,
          elapsedMillis: num('elapsedMillis'),
          phase: typeof s['phase'] === 'string' ? (s['phase'] as string) : '',
        },
      }
    }
```

6. `resetSession` 返回对象追加 `status: null,`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx tsc --noEmit && npx vitest run 2>&1 | tail -8`
Expected: 全绿（若既有 approval.requested 断言因新字段失败,把期望对象补上 `suggestion: ''`/`beforeContent: null` —— 行为语义未变）。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/types.ts desktop/src/shared/transcriptReducer.ts desktop/test/transcriptReducer.test.ts
git commit -m "feat(desktop): reducer 消费 diff/status 事件,审批态携带 suggestion/beforeContent"
```

---

### Task 5: 前端 shared — `buildApprovalResponse` + `createThrottleLatest`

**Files:**
- Create: `desktop/src/shared/buildApprovalResponse.ts`
- Create: `desktop/src/shared/throttleLatest.ts`
- Test: `desktop/test/buildApprovalResponse.test.ts`（新建）
- Test: `desktop/test/throttleLatest.test.ts`（新建）

**Interfaces:**
- Consumes: 无（纯函数）。
- Produces:
  - `buildApprovalResponse(edit: ApprovalEditState): ApprovalResponsePayload`、`validateArgsJson(s: string): string | null`、类型 `ApprovalEditState`/`ApprovalResponsePayload`（Task 8 弹窗用）。
  - `createThrottleLatest<T>(windowMs: number, emit: (v: T) => void): (v: T) => void`（Task 9 App 入口用）。

- [ ] **Step 1: 写失败测试**

```ts
// desktop/test/buildApprovalResponse.test.ts
import { describe, it, expect } from 'vitest'
import { buildApprovalResponse, validateArgsJson } from '../src/shared/buildApprovalResponse'

const base = {
  toolName: 'execute_command',
  originalArgsJson: '{"command":"echo hi"}',
  editedCommand: null as string | null,
  editedArgsJson: null as string | null,
  allowNetwork: false,
  sessionAllowTool: false,
}

describe('buildApprovalResponse', () => {
  it('未修改 → APPROVED,无 modifiedArgs/allowNetwork', () => {
    expect(buildApprovalResponse(base)).toEqual({ decision: 'APPROVED' })
  })
  it('命令被编辑 → MODIFIED,modifiedArgs 里 command 替换、其余字段保留', () => {
    const r = buildApprovalResponse({
      ...base,
      originalArgsJson: '{"command":"echo hi","cwd":"/p"}',
      editedCommand: 'echo bye',
    })
    expect(r.decision).toBe('MODIFIED')
    expect(JSON.parse(r.modifiedArgs!)).toEqual({ command: 'echo bye', cwd: '/p' })
  })
  it('命令编辑框值与原命令相同 → 视为未修改(APPROVED)', () => {
    expect(buildApprovalResponse({ ...base, editedCommand: 'echo hi' }).decision).toBe('APPROVED')
  })
  it('通用 JSON 编辑且与原文不同 → MODIFIED,原样透传', () => {
    const r = buildApprovalResponse({
      ...base, toolName: 'some_tool', editedArgsJson: '{"a":1}', originalArgsJson: '{"a":0}',
    })
    expect(r).toEqual({ decision: 'MODIFIED', modifiedArgs: '{"a":1}' })
  })
  it('通用 JSON 非法 → 视为未修改(上层 UI 已禁用提交,这里兜底)', () => {
    expect(buildApprovalResponse({
      ...base, toolName: 'some_tool', editedArgsJson: '{bad', originalArgsJson: '{}',
    }).decision).toBe('APPROVED')
  })
  it('sessionAllowTool 且未修改 → APPROVED_ALL', () => {
    expect(buildApprovalResponse({ ...base, sessionAllowTool: true }).decision).toBe('APPROVED_ALL')
  })
  it('修改优先于 sessionAllowTool(UI 会禁用,函数兜底为 MODIFIED)', () => {
    expect(buildApprovalResponse({ ...base, editedCommand: 'x', sessionAllowTool: true }).decision).toBe('MODIFIED')
  })
  it('allowNetwork=true 时附带 allowNetwork,且可与 MODIFIED 组合', () => {
    expect(buildApprovalResponse({ ...base, allowNetwork: true })).toEqual({ decision: 'APPROVED', allowNetwork: true })
    const r = buildApprovalResponse({ ...base, editedCommand: 'curl x', allowNetwork: true })
    expect(r.decision).toBe('MODIFIED')
    expect(r.allowNetwork).toBe(true)
  })
})

describe('validateArgsJson', () => {
  it('合法 JSON → null;非法 → 错误信息', () => {
    expect(validateArgsJson('{"a":1}')).toBeNull()
    expect(validateArgsJson('{oops')).toBeTypeOf('string')
  })
})
```

```ts
// desktop/test/throttleLatest.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createThrottleLatest } from '../src/shared/throttleLatest'

describe('createThrottleLatest', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('首个值立即 emit', () => {
    const got: number[] = []
    const push = createThrottleLatest<number>(100, v => got.push(v))
    push(1)
    expect(got).toEqual([1])
  })
  it('窗口内只保留最新值,窗口结束时 emit 一次', () => {
    const got: number[] = []
    const push = createThrottleLatest<number>(100, v => got.push(v))
    push(1); push(2); push(3)
    expect(got).toEqual([1])
    vi.advanceTimersByTime(100)
    expect(got).toEqual([1, 3])
  })
  it('连续窗口:flush 后的新值进入下一个窗口', () => {
    const got: number[] = []
    const push = createThrottleLatest<number>(100, v => got.push(v))
    push(1); push(2)
    vi.advanceTimersByTime(100) // flush 2,同时开新窗
    push(3)                     // 落在新窗内 → 挂起
    expect(got).toEqual([1, 2])
    vi.advanceTimersByTime(100)
    expect(got).toEqual([1, 2, 3])
  })
  it('窗口结束且无挂起值 → 不额外 emit,下个值又是立即 emit', () => {
    const got: number[] = []
    const push = createThrottleLatest<number>(100, v => got.push(v))
    push(1)
    vi.advanceTimersByTime(100)
    push(2)
    expect(got).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/buildApprovalResponse.test.ts test/throttleLatest.test.ts 2>&1 | tail -6`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// desktop/src/shared/buildApprovalResponse.ts
/**
 * 审批弹窗决策映射 — 纯 TS,无 React/Electron。
 * REJECTED 不经此函数(拒绝按钮直接发)。
 */

export interface ApprovalEditState {
  toolName: string
  originalArgsJson: string
  /** execute_command 命令编辑框当前值;null = 未动过。 */
  editedCommand: string | null
  /** 通用 JSON 编辑器当前文本;null = 未开启编辑。 */
  editedArgsJson: string | null
  allowNetwork: boolean
  sessionAllowTool: boolean
}

export interface ApprovalResponsePayload {
  decision: 'APPROVED' | 'MODIFIED' | 'APPROVED_ALL'
  modifiedArgs?: string
  allowNetwork?: boolean
}

/** JSON 合法性:合法 → null,非法 → 错误信息(供 UI 内联展示)。 */
export function validateArgsJson(s: string): string | null {
  try {
    JSON.parse(s)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'invalid JSON'
  }
}

export function buildApprovalResponse(edit: ApprovalEditState): ApprovalResponsePayload {
  const net = edit.allowNetwork ? { allowNetwork: true as const } : {}
  let modifiedArgs: string | null = null

  if (edit.toolName === 'execute_command' && edit.editedCommand !== null) {
    try {
      const orig = JSON.parse(edit.originalArgsJson) as Record<string, unknown>
      if (edit.editedCommand !== orig['command']) {
        modifiedArgs = JSON.stringify({ ...orig, command: edit.editedCommand })
      }
    } catch {
      // 原参不可解析 → 无法安全改写,视为未修改
    }
  } else if (
    edit.editedArgsJson !== null &&
    validateArgsJson(edit.editedArgsJson) === null &&
    edit.editedArgsJson !== edit.originalArgsJson
  ) {
    modifiedArgs = edit.editedArgsJson
  }

  if (modifiedArgs !== null) return { decision: 'MODIFIED', modifiedArgs, ...net }
  if (edit.sessionAllowTool) return { decision: 'APPROVED_ALL', ...net }
  return { decision: 'APPROVED', ...net }
}
```

```ts
// desktop/src/shared/throttleLatest.ts
/**
 * 时间窗合并节流 — 纯 TS。首个值立即 emit;窗口内后续值只保留最新,
 * 窗口结束时 emit 挂起值并开启下一窗;窗口结束无挂起则回到空闲。
 */
export function createThrottleLatest<T>(windowMs: number, emit: (v: T) => void): (v: T) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { v: T } | null = null

  const flush = (): void => {
    timer = null
    if (pending) {
      const v = pending.v
      pending = null
      emit(v)
      timer = setTimeout(flush, windowMs)
    }
  }

  return (v: T) => {
    if (timer === null) {
      emit(v)
      timer = setTimeout(flush, windowMs)
    } else {
      pending = { v }
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx tsc --noEmit && npx vitest run 2>&1 | tail -8`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/buildApprovalResponse.ts desktop/src/shared/throttleLatest.ts \
        desktop/test/buildApprovalResponse.test.ts desktop/test/throttleLatest.test.ts
git commit -m "feat(desktop): 审批决策映射 buildApprovalResponse + status 节流 createThrottleLatest(纯函数)"
```

---

### Task 6: Monaco 集成 — 依赖 + worker 配置 + `DiffView`（含降级）

**Files:**
- Modify: `desktop/package.json`（`npm install monaco-editor` 落依赖）
- Modify: `desktop/electron.vite.config.ts`（renderer 加 `worker: { format: 'es' }`）
- Modify: `desktop/src/renderer/global.d.ts`（顶部加 `/// <reference types="vite/client" />`，使 `?worker` 导入可类型检查）
- Create: `desktop/src/renderer/lib/monacoSetup.ts`
- Create: `desktop/src/renderer/components/DiffView.tsx`

**Interfaces:**
- Consumes: 无。
- Produces: `DiffView` 组件，props `{ filePath: string; before: string; after: string; onStats?: (added: number, removed: number) => void }`；testid：正常 `diff-view`、降级 `diff-fallback`。Task 7/8 依赖。

**本任务无 vitest**（jsdom 跑不了 Monaco）；验收 = tsc + `npm run build` 通过 + 既有 E2E 全绿（Monaco 尚未被任何页面 import，不影响现状）。E2E 断言在 Task 10。

- [ ] **Step 1: 安装依赖 + 配置**

Run: `cd desktop && npm install monaco-editor`
Expected: `package.json` dependencies 出现 `monaco-editor`。

`electron.vite.config.ts` renderer 节加 worker 配置（其余不动）：

```ts
  renderer: {
    root: 'src/renderer',
    css: {
      postcss: {
        plugins: [tailwindcss(), autoprefixer()]
      }
    },
    worker: {
      format: 'es'
    },
    build: {
      rollupOptions: {
        input: 'src/renderer/index.html'
      }
    },
    plugins: [react()]
  }
```

`global.d.ts` 首行加：

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 2: monacoSetup**

```ts
// desktop/src/renderer/lib/monacoSetup.ts
// Monaco worker 装配:diff 计算只需 editor.worker 一个;不引语言 worker(语法高亮
// 走内置 basic-languages tokenizer,主线程跑)。副作用模块,DiffView 动态 import。
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}
```

- [ ] **Step 3: DiffView 组件**

```tsx
// desktop/src/renderer/components/DiffView.tsx
import { useEffect, useRef, useState } from 'react'

type MonacoModule = typeof import('monaco-editor')

interface DiffViewProps {
  filePath: string
  before: string
  after: string
  /** diff 计算完成后回报 +added/-removed 行数(可选)。 */
  onStats?: (added: number, removed: number) => void
}

let uriSeq = 0 // 同一文件多张卡片时保证 model URI 唯一

/**
 * 只读 inline DiffEditor:hideUnchangedRegions 原生 per-hunk 折叠;
 * 高度按内容 clamp(80~400px);Monaco 动态加载失败降级为纯文本双块。
 */
export default function DiffView({ filePath, before, after, onStats }: DiffViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats
  const [failed, setFailed] = useState(false)
  const [height, setHeight] = useState(160)

  useEffect(() => {
    let disposed = false
    let editor: import('monaco-editor').editor.IStandaloneDiffEditor | null = null
    let original: import('monaco-editor').editor.ITextModel | null = null
    let modified: import('monaco-editor').editor.ITextModel | null = null

    void (async () => {
      let monaco: MonacoModule
      try {
        await import('../lib/monacoSetup')
        monaco = await import('monaco-editor')
      } catch (err) {
        console.error('[wraith] monaco load failed:', err)
        setFailed(true)
        return
      }
      if (disposed || !hostRef.current) return

      const uniq = `${++uriSeq}`
      // URI 末段保留文件名 → Monaco 按扩展名自动选择语言 tokenizer
      original = monaco.editor.createModel(before, undefined, monaco.Uri.parse(`wraith-diff://${uniq}/before/${filePath}`))
      modified = monaco.editor.createModel(after, undefined, monaco.Uri.parse(`wraith-diff://${uniq}/after/${filePath}`))
      editor = monaco.editor.createDiffEditor(hostRef.current, {
        readOnly: true,
        renderSideBySide: false,
        hideUnchangedRegions: { enabled: true },
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        automaticLayout: true,
      })
      editor.setModel({ original, modified })
      editor.onDidUpdateDiff(() => {
        if (!editor) return
        const changes = editor.getLineChanges() ?? []
        let added = 0
        let removed = 0
        for (const c of changes) {
          if (c.modifiedEndLineNumber > 0) added += c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1
          if (c.originalEndLineNumber > 0) removed += c.originalEndLineNumber - c.originalStartLineNumber + 1
        }
        onStatsRef.current?.(added, removed)
        const contentH = editor.getModifiedEditor().getContentHeight()
        setHeight(Math.min(Math.max(contentH, 80), 400))
      })
    })()

    return () => {
      disposed = true
      editor?.dispose()
      original?.dispose()
      modified?.dispose()
    }
  }, [filePath, before, after])

  if (failed) {
    return (
      <div data-testid="diff-fallback" className="grid grid-cols-2 gap-2 p-2 font-mono text-xs">
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-danger/5 p-2">{before}</pre>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-ok/5 p-2">{after}</pre>
      </div>
    )
  }
  return <div ref={hostRef} data-testid="diff-view" style={{ height }} />
}
```

- [ ] **Step 4: 验证构建与回归**

Run: `cd desktop && npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: 无 TS 错误、build 成功。
Run: `cd desktop && npx vitest run 2>&1 | tail -5 && npm run e2e 2>&1 | tail -5`
Expected: vitest 全绿；既有 E2E 10/10（DiffView 尚未接线，纯回归）。

- [ ] **Step 5: Commit**

```bash
git add desktop/package.json desktop/package-lock.json desktop/electron.vite.config.ts \
        desktop/src/renderer/global.d.ts desktop/src/renderer/lib/monacoSetup.ts \
        desktop/src/renderer/components/DiffView.tsx
git commit -m "feat(desktop): 引入 monaco-editor + editor.worker 配置,DiffView 只读 inline diff(降级纯文本)"
```

---

### Task 7: `DiffCard` + Transcript 接线

**Files:**
- Create: `desktop/src/renderer/components/DiffCard.tsx`
- Modify: `desktop/src/renderer/components/Transcript.tsx`（加一个分支 + import）

**Interfaces:**
- Consumes: Task 4 的 `Item` diff 成员；Task 6 的 `DiffView`；既有 `renderer/lib/paths` 的 `baseName`。
- Produces: transcript 中 `data-testid="diff-card"`（头部含文件名、`+N`/`-M` 统计、折叠按钮 `data-testid="diff-card-toggle"`）。Task 10 E2E 依赖这些 testid。

- [ ] **Step 1: DiffCard 组件**

```tsx
// desktop/src/renderer/components/DiffCard.tsx
import { useState } from 'react'
import DiffView from './DiffView'
import { baseName } from '../lib/paths'

interface DiffCardProps {
  filePath: string
  before: string
  after: string
}

/** write_file 事后 diff 卡片:折叠时卸载 DiffView(控内存),只留头部。 */
export default function DiffCard({ filePath, before, after }: DiffCardProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [stats, setStats] = useState<{ added: number; removed: number } | null>(null)

  return (
    <div data-testid="diff-card" className="my-1 overflow-hidden rounded-xl border border-border bg-surface">
      <button
        data-testid="diff-card-toggle"
        onClick={() => setCollapsed(c => !c)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-black/[0.02]"
      >
        <span className="font-mono font-semibold text-fg" title={filePath}>📝 {baseName(filePath)}</span>
        {stats && <span className="text-ok">+{stats.added}</span>}
        {stats && <span className="text-danger">-{stats.removed}</span>}
        <span className="ml-auto text-fg-subtle">{collapsed ? '展开' : '收起'}</span>
      </button>
      {!collapsed && (
        <DiffView
          filePath={filePath}
          before={before}
          after={after}
          onStats={(added, removed) => setStats({ added, removed })}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Transcript 分支**（`tool` 分支之后、`return null` 之前）

```tsx
        if (item.type === 'diff') {
          return <DiffCard key={idx} filePath={item.filePath} before={item.before} after={item.after} />
        }
```

并在文件头部加 `import DiffCard from './DiffCard'`。

- [ ] **Step 3: 验证**

Run: `cd desktop && npx tsc --noEmit && npm run build 2>&1 | tail -3 && npx vitest run 2>&1 | tail -4`
Expected: 全部通过。

- [ ] **Step 4: Commit**

```bash
git add desktop/src/renderer/components/DiffCard.tsx desktop/src/renderer/components/Transcript.tsx
git commit -m "feat(desktop): transcript 渲染 diff 卡片(文件名+增删统计+折叠即卸载)"
```

---

### Task 8: 富审批弹窗 v2 + `respondApproval` IPC 扩展

**Files:**
- Modify: `desktop/src/preload/index.ts`（`respondApproval` 签名）
- Modify: `desktop/src/main/index.ts`（`wraith:respondApproval` handler）
- Modify: `desktop/src/renderer/components/ApprovalModal.tsx`（整体重写为 v2）
- Modify: `desktop/src/renderer/App.tsx`（审批 handler 换 payload 形式）

**Interfaces:**
- Consumes: Task 4 的 `pendingApproval.suggestion`/`beforeContent`；Task 5 的 `buildApprovalResponse`/`validateArgsJson`/`ApprovalResponsePayload`；Task 6 的 `DiffView`。
- Produces:
  - preload：`respondApproval(approvalId: string, decision: 'APPROVED' | 'REJECTED' | 'MODIFIED' | 'APPROVED_ALL', opts?: { modifiedArgs?: string; allowNetwork?: boolean }): Promise<void>`。
  - 弹窗 testid：`command-edit`（execute_command 命令输入框）、`allow-network`（Switch）、`approve-all`、既有 `approve`/`reject` 保留。Task 10 E2E 依赖。

- [ ] **Step 1: preload + main**

preload `WraithApi` 接口与实现改为：

```ts
  respondApproval(
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED' | 'MODIFIED' | 'APPROVED_ALL',
    opts?: { modifiedArgs?: string; allowNetwork?: boolean }
  ): Promise<void>
```

```ts
  respondApproval(approvalId, decision, opts) {
    return ipcRenderer.invoke('wraith:respondApproval', approvalId, decision, opts ?? null)
  },
```

main handler 改为：

```ts
ipcMain.handle(
  'wraith:respondApproval',
  async (
    _e,
    approvalId: string,
    decision: string,
    opts: { modifiedArgs?: string; allowNetwork?: boolean } | null
  ) => {
    if (!client) throw new Error('Backend not connected')
    await client.request('approval.respond', {
      approvalId,
      decision,
      ...(opts?.modifiedArgs ? { modifiedArgs: opts.modifiedArgs } : {}),
      ...(opts?.allowNetwork ? { allowNetwork: true } : {})
    })
  }
)
```

- [ ] **Step 2: ApprovalModal v2 整体重写**

```tsx
// desktop/src/renderer/components/ApprovalModal.tsx
import { useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { Switch } from './ui/switch'
import DiffView from './DiffView'
import {
  buildApprovalResponse,
  validateArgsJson,
  type ApprovalResponsePayload,
} from '../../shared/buildApprovalResponse'

interface ApprovalModalProps {
  approvalId: string
  toolName: string
  argsJson: string
  dangerLevel: string
  riskDescription: string
  suggestion: string
  beforeContent: string | null
  onRespond: (payload: ApprovalResponsePayload) => void
  onReject: () => void
}

export default function ApprovalModal({
  toolName,
  argsJson,
  dangerLevel,
  riskDescription,
  suggestion,
  beforeContent,
  onRespond,
  onReject,
}: ApprovalModalProps): JSX.Element {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(argsJson) as Record<string, unknown>
    } catch {
      return null
    }
  }, [argsJson])

  const isCommand = toolName === 'execute_command'
  const isWrite = toolName === 'write_file'
  const originalCommand = isCommand && typeof parsed?.['command'] === 'string' ? (parsed['command'] as string) : ''
  const writeContent = isWrite && typeof parsed?.['content'] === 'string' ? (parsed['content'] as string) : ''
  const writePath = isWrite && typeof parsed?.['path'] === 'string' ? (parsed['path'] as string) : ''

  const [editedCommand, setEditedCommand] = useState<string | null>(null)
  const [allowNetwork, setAllowNetwork] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [editedJson, setEditedJson] = useState<string | null>(null)

  const jsonError = editedJson !== null ? validateArgsJson(editedJson) : null
  const modified =
    (isCommand && editedCommand !== null && editedCommand !== originalCommand) ||
    (!isCommand && editedJson !== null && jsonError === null && editedJson !== argsJson)

  const dangerText =
    dangerLevel.includes('高危') ? 'text-danger'
    : dangerLevel.includes('中危') ? 'text-warn'
    : 'text-accent'
  const dangerBg =
    dangerLevel.includes('高危') ? 'bg-danger'
    : dangerLevel.includes('中危') ? 'bg-warn'
    : 'bg-accent'

  const respond = (sessionAllowTool: boolean): void => {
    onRespond(
      buildApprovalResponse({
        toolName,
        originalArgsJson: argsJson,
        editedCommand: isCommand ? editedCommand : null,
        editedArgsJson: !isCommand && !isWrite ? editedJson : null,
        allowNetwork: isCommand && allowNetwork,
        sessionAllowTool,
      }),
    )
  }

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>
        <div className="mb-3">
          <DialogTitle className={dangerText}>⚠ 审批请求</DialogTitle>
          <div className="mt-1 text-sm font-semibold text-fg">{toolName}</div>
        </div>

        {/* 主体:按工具分派 */}
        {isCommand ? (
          <div className="mb-3">
            <label className="mb-1 block text-[11px] text-fg-subtle">命令(可编辑)</label>
            <input
              data-testid="command-edit"
              value={editedCommand ?? originalCommand}
              onChange={e => setEditedCommand(e.target.value)}
              className="w-full rounded-lg border border-border bg-black/[0.03] px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent"
            />
            <label className="mt-2 flex select-none items-center gap-1.5 text-xs text-fg-muted">
              本次放行网络
              <Switch data-testid="allow-network" checked={allowNetwork} onCheckedChange={setAllowNetwork} />
              <span className="text-[11px] text-fg-subtle">(仅本条命令,其余沙箱限制不变)</span>
            </label>
          </div>
        ) : isWrite ? (
          <div className="mb-3">
            <div className="mb-1 font-mono text-[11px] text-fg-subtle" title={writePath}>
              {writePath}{beforeContent === null ? ' — 新文件(或无预览:文件过大/不可读)' : ''}
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              <DiffView filePath={writePath} before={beforeContent ?? ''} after={writeContent} />
            </div>
          </div>
        ) : (
          <div className="mb-3">
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-black/[0.03] px-3 py-2 font-mono text-xs text-fg-muted">
              {editedJson === null ? argsJson : undefined}
            </pre>
            {jsonOpen ? (
              <>
                <textarea
                  data-testid="json-edit"
                  value={editedJson ?? argsJson}
                  onChange={e => setEditedJson(e.target.value)}
                  rows={6}
                  className="mt-2 w-full rounded-lg border border-border bg-black/[0.03] px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent"
                />
                {jsonError && <div className="mt-1 text-[11px] text-danger">JSON 非法: {jsonError}</div>}
              </>
            ) : (
              <button
                data-testid="json-edit-open"
                onClick={() => setJsonOpen(true)}
                className="mt-2 text-[11px] text-accent hover:underline"
              >
                编辑参数
              </button>
            )}
          </div>
        )}

        <div className="mb-4">
          <span className={`mb-2 inline-block rounded px-2 py-0.5 text-[11px] font-bold text-white ${dangerBg}`}>
            {dangerLevel}
          </span>
          <DialogDescription className="leading-relaxed">{riskDescription}</DialogDescription>
          {suggestion && (
            <div className="mt-1.5 rounded-lg bg-black/[0.03] px-3 py-1.5 text-xs text-fg-muted">
              执行理由: {suggestion}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5">
          <button
            data-testid="reject"
            onClick={onReject}
            className="rounded-lg border border-border px-4 py-1.5 text-xs text-fg-muted hover:bg-black/[0.03]"
          >
            拒绝
          </button>
          <button
            data-testid="approve-all"
            onClick={() => respond(true)}
            disabled={modified || Boolean(jsonError)}
            title="本会话内不再询问此工具"
            className="rounded-lg border border-border px-4 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            本会话放行此工具
          </button>
          <button
            data-testid="approve"
            onClick={() => respond(false)}
            disabled={Boolean(jsonError)}
            className="rounded-lg bg-ok px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {modified ? '批准修改' : '允许'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: App.tsx 接线**

`handleApprove` 替换为（`handleReject` 不变；import 增加 `type ApprovalResponsePayload`）：

```tsx
  const handleApprovalRespond = useCallback(
    async (payload: ApprovalResponsePayload) => {
      if (!state.pendingApproval) return
      try {
        await window.wraith.respondApproval(state.pendingApproval.approvalId, payload.decision, {
          ...(payload.modifiedArgs ? { modifiedArgs: payload.modifiedArgs } : {}),
          ...(payload.allowNetwork ? { allowNetwork: true } : {}),
        })
      } finally {
        dispatch({ type: 'clearApproval' })
      }
    },
    [state.pendingApproval],
  )
```

JSX 处 `<ApprovalModal …>` 换新 props：

```tsx
        <ApprovalModal
          approvalId={state.pendingApproval.approvalId}
          toolName={state.pendingApproval.toolName}
          argsJson={state.pendingApproval.argsJson}
          dangerLevel={state.pendingApproval.dangerLevel}
          riskDescription={state.pendingApproval.riskDescription}
          suggestion={state.pendingApproval.suggestion}
          beforeContent={state.pendingApproval.beforeContent}
          onRespond={handleApprovalRespond}
          onReject={handleReject}
        />
```

import 行按需补：`import type { ApprovalResponsePayload } from '../shared/buildApprovalResponse'`。

- [ ] **Step 4: 验证（既有 E2E 是关键回归——happy-path 点 approve 仍应发 APPROVED）**

Run: `cd desktop && npx tsc --noEmit && npx vitest run 2>&1 | tail -4 && npm run e2e 2>&1 | tail -5`
Expected: vitest 全绿；E2E 10/10（approve 未修改时 decision 仍为 APPROVED,mock 兼容）。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/preload/index.ts desktop/src/main/index.ts \
        desktop/src/renderer/components/ApprovalModal.tsx desktop/src/renderer/App.tsx
git commit -m "feat(desktop): 富审批弹窗——命令编辑/本次放行网络/JSON 改参/本会话放行/diff 预览/执行理由"
```

---

### Task 9: `StatusChip` + Composer 接线 + App 状态节流

**Files:**
- Create: `desktop/src/renderer/components/StatusChip.tsx`
- Modify: `desktop/src/renderer/components/Composer.tsx`（props + 渲染）
- Modify: `desktop/src/renderer/App.tsx`（onEvent 入口节流 + 传参）

**Interfaces:**
- Consumes: Task 4 的 `state.status: StatusData | null`；Task 5 的 `createThrottleLatest`。
- Produces: `data-testid="status-chip"`（Task 10 E2E 依赖）；Composer 新 prop `status: StatusData | null`。

- [ ] **Step 1: StatusChip**

```tsx
// desktop/src/renderer/components/StatusChip.tsx
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip'
import type { StatusData } from '../../shared/types'

/** Composer 里的 token 状态 chip:常显 context 占用 %,hover 展开明细。 */
export default function StatusChip({ status }: { status: StatusData | null }): JSX.Element | null {
  if (!status || status.contextWindow <= 0) return null
  const pct = Math.min(100, Math.round((status.totalTokens / status.contextWindow) * 100))
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="status-chip"
          className="cursor-default rounded-lg border border-border px-2 py-1 text-xs text-fg-muted"
        >
          ◓ {pct}%
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5 text-xs">
          <div>上下文: {status.totalTokens.toLocaleString()} / {status.contextWindow.toLocaleString()}</div>
          <div>
            输入 {status.inputTokens.toLocaleString()} · 输出 {status.outputTokens.toLocaleString()} · 缓存命中{' '}
            {status.cachedInputTokens.toLocaleString()}
          </div>
          {status.estimatedCost && <div>估算成本: {status.estimatedCost}</div>}
          {status.phase === 'running' && <div>运行中 {Math.round(status.elapsedMillis / 1000)}s</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
```

（Composer 已有 `TooltipProvider` 包裹，chip 内只用 `Tooltip` 即可。）

- [ ] **Step 2: Composer 接线**

`ComposerProps` 加 `status: StatusData | null`（import type 自 `../../shared/types`；解构加 `status`）。model chip 的 `</Tooltip>` 之后、workspace 按钮之前插入：

```tsx
          {/* token 状态 — status 事件驱动 */}
          <StatusChip status={status} />
```

并 `import StatusChip from './StatusChip'`。

- [ ] **Step 3: App.tsx——status 节流 + 传参**

订阅 effect 改为（替换现有 onEvent effect）：

```tsx
  // ── subscribe to backend events on mount (status 高频 → 100ms 窗口合并) ────
  useEffect(() => {
    const throttledStatus = createThrottleLatest<BackendEvent>(100, evt => dispatch(evt))
    const unsubscribe = window.wraith.onEvent((evt: BackendEvent) => {
      if (evt.kind === 'notification' && evt.method === 'status') {
        throttledStatus(evt)
        return
      }
      dispatch(evt)
    })
    return unsubscribe
  }, [])
```

import 加 `import { createThrottleLatest } from '../shared/throttleLatest'`。两处 `<Composer …>` 调用点（同一个 `composer` 变量）加 `status={state.status}`。

- [ ] **Step 4: 验证**

Run: `cd desktop && npx tsc --noEmit && npx vitest run 2>&1 | tail -4 && npm run build 2>&1 | tail -3`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/components/StatusChip.tsx desktop/src/renderer/components/Composer.tsx desktop/src/renderer/App.tsx
git commit -m "feat(desktop): Composer token 状态 chip(context %/明细 tooltip),status 事件 100ms 节流"
```

---

### Task 10: mock-appserver 扩展 + Playwright E2E

**Files:**
- Modify: `desktop/test/fixtures/mock-appserver.mjs`
- Modify: `desktop/test/e2e/shell.e2e.ts`（追加 ~6 条测试）

**Interfaces:**
- Consumes: Task 7 的 `diff-card`；Task 8 的 `command-edit`/`allow-network`/`approve-all`/`approve`/`reject`；Task 9 的 `status-chip`；mock 的 `WRAITH_E2E_RECORD` 请求记录机制（既有）。
- Produces: 无（终验任务）。

- [ ] **Step 1: mock-appserver 扩展**

`emitTurnSequence` 中 `message.end` 之后、`tool.call` 之前插入 status 事件：

```js
  notify('status', {
    sessionId,
    turnId,
    status: {
      model: 'mock-model', totalTokens: 12000, contextWindow: 64000,
      inputTokens: 9000, outputTokens: 3000, cachedInputTokens: 4000,
      estimatedCost: '¥0.012', hitlEnabled: true, elapsedMillis: 800, phase: 'running'
    }
  })
  await delay(20)
```

`approval.requested` 改为按 `MOCK_APPROVAL_TOOL` 分派（默认 execute_command，保持既有测试兼容）：

```js
  if (process.env['MOCK_APPROVAL_TOOL'] === 'write_file') {
    notify('approval.requested', {
      sessionId, turnId, approvalId: 'a1',
      toolName: 'write_file',
      argsJson: '{"path":"src/hello.txt","content":"new line\\n"}',
      dangerLevel: '🟡 中危',
      riskDescription: 'writes a file',
      suggestion: '需要更新 hello.txt',
      beforeContent: 'old line\n'
    })
  } else {
    notify('approval.requested', {
      sessionId, turnId, approvalId: 'a1',
      toolName: 'execute_command',
      argsJson: '{"command":"echo hi"}',
      dangerLevel: '🔴 高危',
      riskDescription: 'runs a shell command',
      suggestion: '测试需要执行该命令',
      beforeContent: null
    })
  }
```

`approval.respond` 分支：`const approved = decision !== 'REJECTED'`（MODIFIED/APPROVED_ALL 都算通过）。

`emitPostApprovalSequence` approved 分支 `tool.result` 之后追加 diff 事件：

```js
    await delay(20)
    notify('diff', {
      sessionId, turnId,
      filePath: 'src/hello.txt',
      before: 'old line\n',
      after: 'new line\nplus\n'
    })
```

- [ ] **Step 2: 追加 E2E 测试**（`shell.e2e.ts` 末尾；launch/record 读取方式照抄文件内既有测试的写法——launch helper、`WRAITH_E2E_RECORD` 临时文件读取与 JSONL 解析均已有先例）

六条测试；断言要点：

```ts
test('approval 后 transcript 出现 diff 卡片(文件名可见)', async () => {
  // 常规 launch → submit → 等 approval modal → 点 approve
  // 断言: [data-testid=diff-card] 可见,其内文本含 "hello.txt"
})

test('status 事件驱动 composer 的 token chip', async () => {
  // submit 后等待 [data-testid=status-chip] 可见,文本匹配 /%/(12000/64000 → 19%)
  // await expect(page.getByTestId('status-chip')).toHaveText(/19%/)
})

test('审批弹窗改命令 → respond 记录 MODIFIED + 新命令', async () => {
  // WRAITH_E2E_RECORD=临时文件 launch
  // 弹窗出现后: fill [data-testid=command-edit] 为 "echo bye" → 点 approve(文案已变"批准修改")
  // 读记录: approval.respond 的 params.decision === 'MODIFIED'
  //         JSON.parse(params.modifiedArgs).command === 'echo bye'
})

test('勾选本次放行网络 → respond 记录 allowNetwork:true', async () => {
  // 弹窗出现后: click [data-testid=allow-network] → 点 approve
  // 读记录: params.decision === 'APPROVED' 且 params.allowNetwork === true
})

test('本会话放行此工具 → respond 记录 APPROVED_ALL', async () => {
  // 弹窗出现后: click [data-testid=approve-all]
  // 读记录: params.decision === 'APPROVED_ALL'
})

test('write_file 审批弹窗展示 diff 预览', async () => {
  // launch 时 env 加 MOCK_APPROVAL_TOOL='write_file'
  // 弹窗出现后: [data-testid=diff-view] 或 [data-testid=diff-fallback] 至少一个可见
  //   await expect(page.locator('[data-testid=diff-view], [data-testid=diff-fallback]').first()).toBeVisible()
  // 且弹窗内文本含 "src/hello.txt";点 approve 后 turn 正常完成(等 tool-card 或 turn 完成标志)
})
```

实现时照抄文件内既有测试的 launch 模板（`_electron.launch` 包装、`WRAITH_E2E=1`、mock 后端路径、workspace env），不重复发明。等待一律 `expect(locator).toBeVisible()`／`toHaveText`，无 sleep。

- [ ] **Step 3: 全量验证**

Run: `cd desktop && npx tsc --noEmit && npx vitest run 2>&1 | tail -4`
Run: `cd desktop && npm run e2e 2>&1 | tail -22`
Expected: 既有 10 条 + 新 6 条 = 16 passed。
Run: `mvn test -DskipTests=false 2>&1 | tail -25`
Expected: Java 全量与基线一致。

- [ ] **Step 4: Commit**

```bash
git add desktop/test/fixtures/mock-appserver.mjs desktop/test/e2e/shell.e2e.ts
git commit -m "test(desktop): E2E 覆盖 diff 卡片/token chip/改参/放行网络/本会话放行/write_file 预览"
```

---

## 收尾（由主控执行，不属于编号任务）

1. Opus 整支终审 → 修 Critical/Important。
2. 更新 `docs/ROADMAP.md`：Phase C 移入「已实现」，记录关键产出与测试数；「待眼验」追加两条——真实后端 write_file→diff 卡片全链路、真沙箱网络放行（勾选后命令内 `curl` 通、不勾不通；需 `mvn package` 重建 `~/.wraith/wraith.jar`，**须先征得用户同意**）。
3. `merge --no-ff` 回 main + push + 删分支；提交前安检 staged 文件无密钥、无 `.superpowers/` 泄漏。
