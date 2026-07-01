# Wraith 桌面端 P3a(后端协议补齐 + Task 8 命令输出流)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `wraith app-server` 后端补齐到 spec §5 协议契约,并实现 P1 推迟的 Task 8(命令实时输出流):`initialize` 返回 `{serverInfo, protocol, model, capabilities}`;`turn.submit` 加单轮进行中守卫;`session.start` 尊重 `workspaceDir`;命令执行逐行流出 `tool.output.delta` + 收尾 `tool.result`。

**Architecture:** 纯 Java 后端加法。`AppServer` 的 dispatch 已是单线程顺序处理(serve 循环),协议补齐是小改。Task 8 关键洞察:`callId`(=`LlmClient.ToolCall.id`)在 `executeTools` 层可得但在 `executeCommand` 层丢失;用一个 **ThreadLocal** 在 `executeTools` 设置 callId(对 `HitlToolRegistry.executeToolOutput` 的 override 透明、不绕过 HITL、并行安全),`executeCommand` 读取后**显式**传给独立线程的 `readProcessOutput`;新增 `CommandOutputObserver`(仿既有 `writeFileObserver`)逐行回调 → `EventStreamRenderer.appendToolOutputDelta/appendToolResult`(P1 已实现、零调用者的两个通知方法)。

**Tech Stack:** Java 17 / Maven / JUnit 5。无新增依赖。前端(P3b)不在本计划。

## Global Constraints

- 包根 `com.lyhn.wraith`;Java 17;Maven。
- **测试默认被 pom 跳过**。跑测试必须 `mvn test -DskipTests=false -Dtest=<Class>`,并确认输出里的 `Tests run: N, Failures: F, Errors: E` 行,不能只看 BUILD SUCCESS。
- **环境性基线**(项目记忆 `testing_quirks`):JDK26+Mockito 下约 3F/38E 既有失败(InlineRenderer/BottomStatusBar/TerminalCapabilities/TuiBootstrap/CodeIndex/TerminalMarkdownRenderer 等),**与本改动无关**。新测试禁用 Mockito,用手写 fake / 真实子进程;跑完对照失败集,新代码 0 新增失败。
- **协议契约以 spec §5 为准**(`docs/specs/2026-06-30-desktop-shell-v1.md`):`initialize` result = `{serverInfo, model, capabilities}`(本计划保留 `protocol` 字段兼容);通知事件表含 `tool.output.delta {callId, stream, chunk}`、`tool.result {callId, ok, exitCode}`。
- **不破坏既有行为**:交互式 CLI 的 ToolRegistry 不设 `commandOutputObserver`(默认 no-op)→ 无流出、无回归;命令返回给 LLM 的文本(缓冲全量 + 截断)保持不变,流出是**叠加**副作用。
- **HITL 不可绕过**:Task 8 的 callId 传递用 ThreadLocal 设在 `executeTools`,对 `HitlToolRegistry.executeToolOutput` 的审批 override 完全透明,不得改 `executeToolOutput`/`doExecuteTool` 的签名去绕过 HITL。
- **单会话**:v1 仍是单会话;`workspaceDir` 用于把该会话的项目根设到用户选定目录(否则沿用进程 CWD)。
- 观察者/回调抛异常**不得**影响命令主执行路径(沿用 `writeFileObserver` 的容错约定)。

## P3b 决策(已锁定,留档,不在本计划实现)
- 壳含**最小审批**(允许/拒绝内联);富审批弹窗(改参/本次放行网络)留 P4。
- 前端栈:**Electron + React + TypeScript + Vite**。
- 布局:同仓 **`desktop/` 子目录**(monorepo,独立 npm 构建,不进 Maven)。
- P2 遗留 **I1**(fail-open→`sandbox.unavailable` 客户端事件)与 **P4**(Monaco per-hunk diff、富审批、状态栏)一并在后续阶段;本计划不含。

---

## 文件结构

**修改:**
- `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` —— `initialize` 返回可配置的 result;`turn.submit` 单轮守卫;`session.start` 读 `workspaceDir` 并校验;`SessionRunnerFactory.create` 加 `workspaceDir` 参数。
- `src/main/java/com/lyhn/wraith/cli/Main.java` —— `startAppServer` 传入 initialize result(含 model+capabilities)、factory 按 workspaceDir 设项目根、注册 `commandOutputObserver`;新增包级静态 `buildInitializeResult(String model)`。
- `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java` —— 新增 `CommandOutputObserver` 接口 + 字段 + setter;`executeTools` 设 ThreadLocal callId;`executeCommand` 读 callId 并流出;`readProcessOutput` 逐行回调。

**新建测试:**
- `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerInitializeAndGuardTest.java`
- `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerWorkspaceDirTest.java`
- `src/test/java/com/lyhn/wraith/cli/MainInitializeResultTest.java`
- `src/test/java/com/lyhn/wraith/tool/ToolRegistryCommandStreamingTest.java`

**注意既有测试需同步:** `AppServerTest`(P1)构造的 `SessionRunnerFactory` 用 2 参 `create(writer, sessionId)`;Task 2 改签名后需把这些 lambda 更新为 3 参 `(writer, sessionId, workspaceDir)`。实现者遇到编译错必须修既有测试(见 Task 2 Step 3)。

---

## Task 1: `initialize` 补 model+capabilities + `turn.submit` 单轮守卫

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(constructor ~35-39;dispatch initialize 57-58;handleTurn 82-102)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(startAppServer AppServer 构造 ~1117;新增 `buildInitializeResult`)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerInitializeAndGuardTest.java`
- Test: `src/test/java/com/lyhn/wraith/cli/MainInitializeResultTest.java`

**Interfaces:**
- Consumes: `JsonRpcWriter.result/error/notify`;`LlmClient.getModelName()`。
- Produces:
  - `AppServer(InputStream, OutputStream, SessionRunnerFactory, Map<String,Object> initializeResult)`(4 参,新增)
  - 3 参构造保留,委托 4 参并用默认 `{serverInfo, protocol}`。
  - `static Map<String,Object> Main.buildInitializeResult(String model)`(包级)。

- [ ] **Step 1: 写失败测试**

`AppServerInitializeAndGuardTest.java`:

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class AppServerInitializeAndGuardTest {

    private static final ObjectMapper M = new ObjectMapper();

    /** 把若干 JSON-RPC 行喂给 app-server,serve 在后台线程跑,返回 stdout 全部输出行(解析成 JsonNode)。 */
    private List<JsonNode> drive(AppServer.SessionRunnerFactory factory,
                                 Map<String, Object> initResult,
                                 List<String> requests,
                                 CountDownLatch releaseAfterWrite) throws Exception {
        PipedInputStream serverIn = new PipedInputStream();
        PipedOutputStream feeder = new PipedOutputStream(serverIn);
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        AppServer server = new AppServer(serverIn, out, factory, initResult);
        Thread t = new Thread(() -> { try { server.serve(); } catch (Exception ignored) {} }, "test-serve");
        t.setDaemon(true);
        t.start();

        for (String req : requests) {
            feeder.write((req + "\n").getBytes(StandardCharsets.UTF_8));
            feeder.flush();
            Thread.sleep(60); // 让 serve 顺序处理该行
        }
        if (releaseAfterWrite != null) releaseAfterWrite.countDown();
        Thread.sleep(150);
        feeder.write(("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}\n")
                .getBytes(StandardCharsets.UTF_8));
        feeder.flush();
        t.join(2000);

        List<JsonNode> lines = new java.util.ArrayList<>();
        for (String l : out.toString(StandardCharsets.UTF_8).split("\n")) {
            if (!l.isBlank()) lines.add(M.readTree(l));
        }
        return lines;
    }

    private JsonNode responseForId(List<JsonNode> lines, int id) {
        return lines.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst().orElse(null);
    }

    /** 只需一个能返回真实 EventStreamRenderer 的 fake runner;runTurn 阻塞在 latch 上模拟"进行中"。 */
    private AppServer.SessionRunnerFactory latchFactory(CountDownLatch latch) {
        return (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer renderer = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return renderer; }
                public String runTurn(String input) throws Exception { latch.await(5, TimeUnit.SECONDS); return ""; }
            };
        };
    }

    @Test
    void initializeReturnsConfiguredResult() throws Exception {
        Map<String, Object> init = new java.util.LinkedHashMap<>();
        init.put("serverInfo", "wraith-app-server");
        init.put("protocol", "1");
        init.put("model", "deepseek-chat");
        init.put("capabilities", Map.of("streaming", true, "toolOutputStreaming", true));

        List<JsonNode> lines = drive(latchFactory(new CountDownLatch(0)), init,
                List.of("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}"), null);

        JsonNode r = responseForId(lines, 1);
        assertNotNull(r, "应有 id=1 的响应");
        assertEquals("deepseek-chat", r.path("result").path("model").asText());
        assertTrue(r.path("result").path("capabilities").path("toolOutputStreaming").asBoolean());
        assertEquals("wraith-app-server", r.path("result").path("serverInfo").asText());
    }

    @Test
    void secondTurnWhileRunningIsRejected() throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        List<JsonNode> lines = drive(latchFactory(latch), Map.of("serverInfo", "x", "protocol", "1"),
                List.of(
                    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}",
                    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{}}",
                    "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"turn.submit\",\"params\":{\"input\":\"a\"}}",
                    "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"turn.submit\",\"params\":{\"input\":\"b\"}}"
                ), latch);

        JsonNode first = responseForId(lines, 3);
        JsonNode second = responseForId(lines, 4);
        assertEquals("running", first.path("result").path("status").asText(), "第一轮应 running");
        assertEquals(-32000, second.path("error").path("code").asInt(), "并发第二轮应被 -32000 拒绝");
    }
}
```

`MainInitializeResultTest.java`:

```java
package com.lyhn.wraith.cli;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class MainInitializeResultTest {

    @Test
    void carriesModelAndCapabilities() {
        Map<String, Object> r = Main.buildInitializeResult("deepseek-chat");
        assertEquals("wraith-app-server", r.get("serverInfo"));
        assertEquals("deepseek-chat", r.get("model"));
        assertTrue(r.get("capabilities") instanceof Map);
        @SuppressWarnings("unchecked")
        Map<String, Object> caps = (Map<String, Object>) r.get("capabilities");
        assertEquals(Boolean.TRUE, caps.get("toolOutputStreaming"));
        assertEquals(Boolean.TRUE, caps.get("approvals"));
    }

    @Test
    void nullModelBecomesEmptyString() {
        assertEquals("", Main.buildInitializeResult(null).get("model"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=AppServerInitializeAndGuardTest,MainInitializeResultTest`
Expected: FAIL —— 4 参 `AppServer` 构造不存在 / `SessionRunnerFactory` 仍是 2 参 / `Main.buildInitializeResult` 不存在(编译错)。

- [ ] **Step 3: 实现**

**(a) `AppServer.java` —— 加 4 参构造 + 可配置 initialize + 单轮守卫。**

字段区(`private final SessionRunnerFactory factory;` 之后)新增:
```java
    private final Map<String, Object> initializeResult;
```
构造(替换现有 3 参构造):
```java
    public AppServer(InputStream in, OutputStream out, SessionRunnerFactory factory) {
        this(in, out, factory, Map.of("serverInfo", "wraith-app-server", "protocol", "1"));
    }

    public AppServer(InputStream in, OutputStream out, SessionRunnerFactory factory,
                     Map<String, Object> initializeResult) {
        this.in = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        this.writer = new JsonRpcWriter(out);
        this.factory = factory;
        this.initializeResult = initializeResult;
    }
```
dispatch 的 initialize 分支(替换 57-58):
```java
            case "initialize" -> writer.result(msg.id(), initializeResult);
```
`handleTurn` 开头(在 `if (session == null)` 之后)加守卫:
```java
        Thread running = turnThread;
        if (running != null && running.isAlive()) {
            writer.error(msg.id(), -32000, "turn in progress");
            return;
        }
```

> 注:`SessionRunnerFactory.create` 在本任务里保持 2 参不变。Task 2 才改成 3 参。**但上面 `latchFactory` 测试已按 3 参写。** 为让 Task 1 独立编译通过,本任务先把 `SessionRunnerFactory` 直接改成 3 参签名(`create(JsonRpcWriter, String, String)`),并在 `session.start` 调用处传 `null` 作为 workspaceDir 占位(Task 2 再填校验逻辑)。同时把 `Main.startAppServer` 的 factory lambda 与既有 `AppServerTest` 的 factory 改为 3 参(第三参忽略)。这样 Task 1、Task 2 都对 3 参签名编译,避免来回改。

具体:`SessionRunnerFactory` 接口改为:
```java
    public interface SessionRunnerFactory {
        SessionRunner create(JsonRpcWriter writer, String sessionId, String workspaceDir);
    }
```
`session.start` 分支改为(本任务先传 null,Task 2 填校验):
```java
            case "session.start" -> {
                sessionId = "sess_" + Long.toHexString(System.nanoTime());
                session = factory.create(writer, sessionId, null);
                writer.result(msg.id(), Map.of("sessionId", sessionId));
            }
```

**(b) `Main.java` —— buildInitializeResult + 传入 AppServer + factory 改 3 参。**

新增包级静态方法(放 `startAppServer` 附近、`buildAppServerSandbox` 旁):
```java
    /** app-server initialize 响应:serverInfo/protocol/model/capabilities(spec §5.1)。 */
    static java.util.Map<String, Object> buildInitializeResult(String model) {
        java.util.Map<String, Object> caps = new java.util.LinkedHashMap<>();
        caps.put("streaming", true);
        caps.put("approvals", true);
        caps.put("toolOutputStreaming", true);
        caps.put("diff", true);
        caps.put("sandbox", "macos-seatbelt");
        java.util.Map<String, Object> res = new java.util.LinkedHashMap<>();
        res.put("serverInfo", "wraith-app-server");
        res.put("protocol", "1");
        res.put("model", model == null ? "" : model);
        res.put("capabilities", caps);
        return res;
    }
```
`startAppServer` 里,`AppServer` 构造(现 ~1117-1118)改为 4 参并传 initialize result;factory lambda 参数改 3 参:
```java
        com.lyhn.wraith.runtime.appserver.AppServer server =
            new com.lyhn.wraith.runtime.appserver.AppServer(System.in, realOut,
                (writer, sessionId, workspaceDir) -> {   // ← 加 workspaceDir 参数(Task 2 使用;本任务忽略)
                    // ... 原有 renderer/hitl/registry/agent 构造不变 ...
                },
                buildInitializeResult(client.getModelName()));   // ← 新增第 4 参
```
(工厂 lambda 体内原有代码原样保留;仅参数列表从 2 参变 3 参。`workspaceDir` 本任务不用。)

- [ ] **Step 4: 修既有 `AppServerTest` 的 factory 为 3 参**

`AppServerTest.java`(P1)里所有 `SessionRunnerFactory` lambda `(writer, sessionId) -> ...` 改为 `(writer, sessionId, workspaceDir) -> ...`(忽略第三参)。跑 `mvn test -DskipTests=false -Dtest=AppServerTest` 确认仍绿(P1 用例不受影响)。

- [ ] **Step 5: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=AppServerInitializeAndGuardTest,MainInitializeResultTest,AppServerTest`
Expected: 全绿(AppServerInitializeAndGuardTest 2、MainInitializeResultTest 2、AppServerTest 原有数),输出无 warning。

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerInitializeAndGuardTest.java \
        src/test/java/com/lyhn/wraith/cli/MainInitializeResultTest.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerTest.java
git commit -m "feat(app-server): initialize 补 model+capabilities + turn.submit 单轮守卫"
```

---

## Task 2: `session.start` 尊重 `workspaceDir`

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(session.start 分支 → 抽成 `handleSessionStart`)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(factory lambda 按 workspaceDir 设项目根)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerWorkspaceDirTest.java`

**Interfaces:**
- Consumes: `SessionRunnerFactory.create(writer, sessionId, workspaceDir)`(Task 1 已改 3 参)。
- Produces:`session.start` 读 `params.workspaceDir`;非空且非有效目录 → JSON-RPC error `-32602`;有效或缺省 → 创建会话并把 workspaceDir(可为 null)传给 factory。

- [ ] **Step 1: 写失败测试**

`AppServerWorkspaceDirTest.java`:

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class AppServerWorkspaceDirTest {

    private static final ObjectMapper M = new ObjectMapper();

    private List<JsonNode> drive(AppServer.SessionRunnerFactory factory, List<String> requests) throws Exception {
        PipedInputStream serverIn = new PipedInputStream();
        PipedOutputStream feeder = new PipedOutputStream(serverIn);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        AppServer server = new AppServer(serverIn, out, factory);
        Thread t = new Thread(() -> { try { server.serve(); } catch (Exception ignored) {} }, "test-serve");
        t.setDaemon(true); t.start();
        for (String req : requests) {
            feeder.write((req + "\n").getBytes(StandardCharsets.UTF_8)); feeder.flush(); Thread.sleep(50);
        }
        feeder.write("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}\n"
                .getBytes(StandardCharsets.UTF_8));
        feeder.flush(); t.join(2000);
        List<JsonNode> lines = new java.util.ArrayList<>();
        for (String l : out.toString(StandardCharsets.UTF_8).split("\n")) if (!l.isBlank()) lines.add(M.readTree(l));
        return lines;
    }

    private JsonNode forId(List<JsonNode> lines, int id) {
        return lines.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst().orElse(null);
    }

    private AppServer.SessionRunnerFactory capturingFactory(AtomicReference<String> captured) {
        return (writer, sessionId, workspaceDir) -> {
            captured.set(workspaceDir);
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return ""; }
            };
        };
    }

    @Test
    void validWorkspaceDirPassedToFactory() throws Exception {
        Path dir = Files.createTempDirectory("wraith-ws-");
        AtomicReference<String> captured = new AtomicReference<>("UNSET");
        List<JsonNode> lines = drive(capturingFactory(captured), List.of(
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{\"workspaceDir\":\"" + dir + "\"}}"));
        assertEquals(dir.toString(), captured.get(), "有效 workspaceDir 应透传给 factory");
        assertTrue(forId(lines, 2).path("result").hasNonNull("sessionId"));
    }

    @Test
    void missingWorkspaceDirPassesNull() throws Exception {
        AtomicReference<String> captured = new AtomicReference<>("UNSET");
        drive(capturingFactory(captured), List.of(
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{}}"));
        assertNull(captured.get(), "缺省 workspaceDir 应传 null");
    }

    @Test
    void invalidWorkspaceDirRejectedWith32602() throws Exception {
        AtomicReference<String> captured = new AtomicReference<>("UNSET");
        List<JsonNode> lines = drive(capturingFactory(captured), List.of(
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{\"workspaceDir\":\"/no/such/dir/xyz123\"}}"));
        assertEquals(-32602, forId(lines, 2).path("error").path("code").asInt(), "无效目录应 -32602");
        assertEquals("UNSET", captured.get(), "无效目录不应创建会话/调用 factory");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=AppServerWorkspaceDirTest`
Expected: FAIL —— 当前 session.start 忽略 workspaceDir(传 null),`validWorkspaceDirPassedToFactory` 与 `invalidWorkspaceDirRejectedWith32602` 红。

- [ ] **Step 3: 实现**

`AppServer.java`:dispatch 的 `case "session.start"` 改为委托 `handleSessionStart(msg)`:
```java
            case "session.start" -> handleSessionStart(msg);
```
新增方法(放 `handleTurn` 附近):
```java
    private void handleSessionStart(JsonRpc.Incoming msg) {
        String workspaceDir = null;
        JsonNode p = msg.params();
        if (p != null && p.hasNonNull("workspaceDir")) {
            String wd = p.get("workspaceDir").asText();
            if (wd != null && !wd.isBlank()) {
                if (!java.nio.file.Files.isDirectory(java.nio.file.Path.of(wd))) {
                    writer.error(msg.id(), -32602, "workspaceDir 不是有效目录: " + wd);
                    return;
                }
                workspaceDir = wd;
            }
        }
        sessionId = "sess_" + Long.toHexString(System.nanoTime());
        session = factory.create(writer, sessionId, workspaceDir);
        writer.result(msg.id(), Map.of("sessionId", sessionId));
    }
```
(需要 `import com.fasterxml.jackson.databind.JsonNode;` —— 已存在。)

`Main.java`:factory lambda 里,把固定的 `registry.setProjectPath(Path.of(".")...)` 改为按 workspaceDir 选择:
```java
                String root = (workspaceDir != null && !workspaceDir.isBlank())
                        ? workspaceDir
                        : java.nio.file.Path.of(".").toAbsolutePath().normalize().toString();
                registry.setProjectPath(root);
```
(即:提供了 workspaceDir 就用它当项目根——这会同时重建 PathGuard 与沙箱读取的 projectPath;否则沿用进程 CWD。)

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=AppServerWorkspaceDirTest,AppServerTest`
Expected: `AppServerWorkspaceDirTest` 3/3;`AppServerTest` 仍绿。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerWorkspaceDirTest.java
git commit -m "feat(app-server): session.start 尊重 workspaceDir(校验+透传设项目根)"
```

---

## Task 3: Task 8 —— 命令实时输出流(callId 穿透 + 逐行流出）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`(新增 `CommandOutputObserver` + 字段/setter;`executeTools` 设 ThreadLocal;`executeCommand`/`readProcessOutput` 流出)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(startAppServer 注册 observer → renderer)
- Test: `src/test/java/com/lyhn/wraith/tool/ToolRegistryCommandStreamingTest.java`

**Interfaces:**
- Consumes: `EventStreamRenderer.appendToolOutputDelta(callId, stream, chunk)` / `appendToolResult(callId, ok, exitCode)`(P1 已实现)。
- Produces:
  - `interface ToolRegistry.CommandOutputObserver { void onChunk(String callId, String stream, String chunk); void onResult(String callId, boolean ok, int exitCode); }`
  - `void ToolRegistry.setCommandOutputObserver(CommandOutputObserver)`(null → no-op)。

- [ ] **Step 1: 写失败测试**

`ToolRegistryCommandStreamingTest.java`:

```java
package com.lyhn.wraith.tool;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class ToolRegistryCommandStreamingTest {

    record Chunk(String callId, String stream, String text) {}

    @Test
    void executeCommandStreamsPerLineChunksAndResultTaggedWithCallId() {
        ToolRegistry reg = new ToolRegistry();
        List<Chunk> chunks = new CopyOnWriteArrayList<>();
        AtomicReference<String> resultCallId = new AtomicReference<>();
        AtomicReference<Boolean> resultOk = new AtomicReference<>();
        AtomicReference<Integer> resultExit = new AtomicReference<>();

        reg.setCommandOutputObserver(new ToolRegistry.CommandOutputObserver() {
            public void onChunk(String callId, String stream, String text) { chunks.add(new Chunk(callId, stream, text)); }
            public void onResult(String callId, boolean ok, int exitCode) {
                resultCallId.set(callId); resultOk.set(ok); resultExit.set(exitCode);
            }
        });

        // 经 executeTools(带 callId) 走完整生产路径
        ToolRegistry.ToolInvocation inv = new ToolRegistry.ToolInvocation(
                "call-42", "execute_command",
                "{\"command\":\"printf 'line1\\\\nline2\\\\n'\"}");
        List<ToolRegistry.ToolExecutionResult> results = reg.executeTools(List.of(inv));

        assertEquals(1, results.size());
        assertTrue(results.get(0).toString().length() >= 0); // 结果照常返回给 LLM(内容不在此断言)

        // 逐行流出:两行,均打 callId=call-42
        assertTrue(chunks.stream().anyMatch(c -> c.text().contains("line1")), "应流出 line1: " + chunks);
        assertTrue(chunks.stream().anyMatch(c -> c.text().contains("line2")), "应流出 line2: " + chunks);
        assertTrue(chunks.stream().allMatch(c -> "call-42".equals(c.callId())), "所有 chunk 打 callId=call-42");

        // 收尾:tool.result
        assertEquals("call-42", resultCallId.get());
        assertEquals(Boolean.TRUE, resultOk.get(), "printf 退出码 0");
        assertEquals(Integer.valueOf(0), resultExit.get());
    }

    @Test
    void noObserverByDefaultDoesNotStreamOrThrow() {
        ToolRegistry reg = new ToolRegistry();  // 默认无 observer
        ToolRegistry.ToolInvocation inv = new ToolRegistry.ToolInvocation(
                "c1", "execute_command", "{\"command\":\"printf 'x\\\\n'\"}");
        List<ToolRegistry.ToolExecutionResult> r = reg.executeTools(List.of(inv));
        assertEquals(1, r.size(), "无 observer 时命令照常执行,不抛异常");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=ToolRegistryCommandStreamingTest`
Expected: FAIL —— `CommandOutputObserver`/`setCommandOutputObserver` 不存在(编译错)。

- [ ] **Step 3: 实现 ToolRegistry 流式路径**

**(a) 接口 + 字段 + setter**(放 `writeFileObserver` 字段/ setter 附近):
```java
    /** 命令实时输出观察者:逐行 chunk + 收尾 result。app-server 接到 EventStreamRenderer。 */
    public interface CommandOutputObserver {
        void onChunk(String callId, String stream, String chunk);
        void onResult(String callId, boolean ok, int exitCode);
    }
    private static final CommandOutputObserver NOOP_OUTPUT_OBSERVER = new CommandOutputObserver() {
        public void onChunk(String callId, String stream, String chunk) {}
        public void onResult(String callId, boolean ok, int exitCode) {}
    };
    private volatile CommandOutputObserver commandOutputObserver = NOOP_OUTPUT_OBSERVER;
    // 命令流出用的 callId(在 executeTools 设置,对 HitlToolRegistry override 透明、并行安全)
    private final ThreadLocal<String> currentCallId = new ThreadLocal<>();

    public void setCommandOutputObserver(CommandOutputObserver observer) {
        this.commandOutputObserver = observer == null ? NOOP_OUTPUT_OBSERVER : observer;
    }
```

**(b) `executeTools` 两处调用点包 ThreadLocal**(单工具 ~1271、并行任务 ~1289)。单工具路径:
```java
        if (invocations.size() == 1) {
            ToolInvocation invocation = invocations.get(0);
            long startedAt = System.nanoTime();
            currentCallId.set(invocation.id());
            ToolOutput output;
            try {
                output = executeToolOutput(invocation.name(), invocation.argumentsJson());
            } finally {
                currentCallId.remove();
            }
            return List.of(ToolExecutionResult.completed(invocation, output, elapsedMillis(startedAt)));
        }
```
并行任务 lambda(替换 1284-1291 的任务体):
```java
                    .<Callable<ToolExecutionResult>>map(invocation -> () -> {
                        if (CancellationContext.isCancelled()) {
                            return ToolExecutionResult.failed(invocation, "用户取消了此次工具调用");
                        }
                        long startedAt = System.nanoTime();
                        currentCallId.set(invocation.id());
                        ToolOutput output;
                        try {
                            output = executeToolOutput(invocation.name(), invocation.argumentsJson());
                        } finally {
                            currentCallId.remove();
                        }
                        return ToolExecutionResult.completed(invocation, output, elapsedMillis(startedAt));
                    })
```

**(c) `executeCommand` 读 callId + 显式传给 reader + 收尾 onResult。** 在 `executeCommand` 开头(`normalized` 判空、CommandGuard 之后、创建 executor 之前)取 callId:
```java
        String callId = currentCallId.get();
```
把 reader 提交改为传 callId:
```java
            Process runningProcess = process;
            Future<String> outputFuture = outputReaderExecutor.submit(() -> readProcessOutput(runningProcess, callId));
```
正常完成分支(算出 exitCode 后、return 前):
```java
            String output = getCommandOutput(outputFuture);
            int exitCode = process.exitValue();
            safeOnResult(callId, exitCode == 0, exitCode);
            return String.format("命令执行完成 (exit code: %d)\n%s", exitCode, output);
```
超时分支(`outputFuture.cancel(true);` 之后、return 前)与两个 catch 分支(`process.destroyForcibly();` 之后、return 前)各加:
```java
            safeOnResult(callId, false, -1);
```
(即:超时 return 前、`catch (InterruptedException)` return 前、`catch (Exception)` return 前 各一行。空命令 / CommandGuard 拒绝在 spawn 前 return/throw,不发 onResult。)

**(d) `readProcessOutput` 加 callId 参数 + 逐行 onChunk。** 改签名并在读到每行时流出:
```java
    private String readProcessOutput(Process process, String callId) throws Exception {
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (callId != null) {
                    safeOnChunk(callId, "stdout", line);   // 逐行流给 UI(不受 8000 字符缓冲上限约束)
                }
                if (output.length() < MAX_COMMAND_OUTPUT_CHARS) {
                    int remaining = MAX_COMMAND_OUTPUT_CHARS - output.length();
                    if (line.length() > remaining) {
                        output.append(line, 0, remaining);
                    } else {
                        output.append(line);
                    }
                    output.append("\n");
                }
            }
        }
        if (output.length() >= MAX_COMMAND_OUTPUT_CHARS) {
            return output.substring(0, MAX_COMMAND_OUTPUT_CHARS) + "\n...(输出已截断)";
        }
        return output.toString();
    }
```

**(e) 容错包装**(放 `executeCommand` 附近;观察者异常不影响命令主路径):
```java
    private void safeOnChunk(String callId, String stream, String chunk) {
        try { commandOutputObserver.onChunk(callId, stream, chunk); } catch (Exception ignored) {}
    }
    private void safeOnResult(String callId, boolean ok, int exitCode) {
        if (callId == null) return;
        try { commandOutputObserver.onResult(callId, ok, exitCode); } catch (Exception ignored) {}
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=ToolRegistryCommandStreamingTest`
Expected: `Tests run: 2, Failures: 0, Errors: 0`。若 `printf` 行为异常,确认测试机有 bash;断言基于 `printf 'line1\nline2\n'` 的两行输出。

- [ ] **Step 5: 在 `Main.startAppServer` 注册 observer → renderer**

factory lambda 里(`registry.setCommandSandbox(...)` 之后、`new Agent` 之前)加:
```java
                registry.setCommandOutputObserver(new com.lyhn.wraith.tool.ToolRegistry.CommandOutputObserver() {
                    public void onChunk(String callId, String stream, String chunk) {
                        renderer.appendToolOutputDelta(callId, stream, chunk);
                    }
                    public void onResult(String callId, boolean ok, int exitCode) {
                        renderer.appendToolResult(callId, ok, exitCode);
                    }
                });
```
跑 `mvn test -DskipTests=false -Dtest=MainAppServerCommandTest,MainAppServerSandboxTest` 确认 Main 相关既有测试仍绿。

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/tool/ToolRegistry.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/tool/ToolRegistryCommandStreamingTest.java
git commit -m "feat(app-server): Task8 命令实时输出流(callId 穿透 + tool.output.delta/result)"
```

---

## Controller 实机验收(非子代理,合并前由控制者做)

在 macOS 上,重建并装 jar,启 `wraith app-server`,驱动真 LLM 一轮让模型跑一条多行输出命令(如 `printf 'a\nb\nc\n'` 或 `ls`),用 JSON-RPC 驱动脚本(参照 P2 的 `p2_accept.py`,含审批自动放行)断言:
1. 收到多条 `tool.output.delta`(带 `callId`、`stream`、`chunk`),chunk 覆盖命令的各行;
2. 收到 `tool.result`(带同一 `callId`、`ok`、`exitCode`);
3. `initialize` 响应含 `model` 与 `capabilities`;
4. stdout 仍是纯 JSON-RPC(0 非 JSON 行);
5. (可选)session.start 传一个临时 `workspaceDir`,让模型写该目录内文件成功、写目录外被沙箱拒(顺带验证 workspaceDir 生效)。

## 分期收尾说明
- P3a 完成 = 后端协议对齐 spec §5(initialize/单轮守卫/workspaceDir)+ Task 8 命令流落地。**P3b(Electron 壳)**据此对着稳定协议开建。
- P3b 决策已锁(见上 Global Constraints 下的"P3b 决策");P2 遗留 I1(`sandbox.unavailable` 事件)与富 UI(Monaco/富审批/状态栏)归 P3b/P4。

## Self-Review(计划自查)
- **spec 覆盖**:§5.1 initialize result→Task 1;§5.1 turn.submit(补 -32000 错误态)→Task 1;§5.1 session.start workspaceDir→Task 2;§5.2 tool.output.delta / tool.result→Task 3(EventStreamRenderer 已实现,本计划补调用者)。
- **占位扫描**:无 TODO/TBD;每步含完整代码与期望输出。
- **HITL 安全**:Task 3 用 ThreadLocal 设在 executeTools,不改 executeToolOutput/doExecuteTool 签名,不绕过 HitlToolRegistry 审批 override(Global Constraints 明列;评审须核实)。
- **无回归**:commandOutputObserver 默认 no-op → CLI 路径无流出、命令返回 LLM 的文本不变;新测试禁用 Mockito。
- **类型一致性**:`CommandOutputObserver.onChunk/onResult` 签名在 ToolRegistry 定义、Test 与 Main 消费一致;`SessionRunnerFactory.create` 3 参签名在 Task 1 改、Task 2 用、既有 AppServerTest 同步;`buildInitializeResult` 签名一致。
