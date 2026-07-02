# Phase E-1 MCP 插件管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面端 MCP 插件管理:app-server 挂载既有 McpServerManager(按工作区复用 + reattach)、mcp.* 协议面、整页插件面板、Composer @-mention 补全。

**Architecture:** 引擎(`com.lyhn.wraith.mcp`)不重写,只加三个小口:`reattach`(工具随新会话 registry)、状态监听器(5 个迁移点)、`reloadFromConfig`(单 server 重载)。新类 `AppServerMcp`(进程级单槽)持 manager 生命周期并实现 `McpOps`;AppServer 加 9 个 `mcp.*` handler + `mcp.status` 通知;前端整页 `PluginsPanel` + Composer 补全。config 写入走新的树式 `McpConfigWriter`(Jackson 类会丢未知字段,必须操作 JsonNode 树)。

**Tech Stack:** Java 17(Jackson 树 API、ConcurrentHashMap、daemon 线程)/ Electron+React18+TS / vitest / Playwright。

**Spec:** `docs/specs/2026-07-02-desktop-phase-e1-mcp.md`(需求真源;冲突以 spec 为准)

## Global Constraints

- 执行分支 `feat/desktop-phase-e1`(从 main 切出)。
- **现有协议消息零改动**(session.*/turn.*/approval.*/status/diff);transcriptReducer 对话链路零改动;**TUI 行为零改动**(状态监听器可空,reattach 不被 TUI 调用)。
- **reattach 不搬审批状态**:只重注册 MCP 工具,HitlToolRegistry 的任何放行/审计状态不复制——这是审批语义红线,测试与评审一级要求。
- **env 值不回传**:协议面只出 `envKeys:string[]`;表单回填值留空占位,`config.upsert` env 值空串 = 保留现值(原无此 key 则忽略)。
- Java 新测不用 Mockito(harness/@TempDir/匿名 fake/既有 McpServerManagerTest 的假 HTTP MCP fixture);全量回归维持 3F/38E 环境噪音基线(总数随新增测试增长)。
- desktop 基线:vitest 102、Playwright 25/25,不得回归;命令在 `/Users/aa00945/Desktop/wraith/desktop` 下执行(每次 Bash 先 cd)。
- Java 命令在仓根执行:`cd /Users/aa00945/Desktop/wraith && mvn test -DskipTests=false -Dtest=<Class> -q`。
- 密钥红线:提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`;commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 状态 wire 枚举:`starting|ready|disabled|error`(`McpServerStatus` 1:1 小写)。MCP 工具命名 `mcp__<server>__<tool>`(`McpToolDescriptor.namespaced`)。

---

### Task 1: 引擎三小口(reattach / 状态监听 / reloadFromConfig)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/mcp/McpServerManager.java`
- Test: `src/test/java/com/lyhn/wraith/mcp/McpServerManagerTest.java`(追加用例,复用其假 HTTP MCP fixture:`enqueueInitialize/enqueueToolsList` 等私有 helper 已在该文件)

**Interfaces:**
- Consumes: 既有 `replaceMcpToolOutputsForServer/unregisterTools/start(McpServer)/servers/配置加载`。
- Produces(Task 4 依赖,签名逐字):
  - `public synchronized void reattach(ToolRegistry newRegistry)`
  - `public void setStatusListener(java.util.function.Consumer<McpServer> listener)`
  - `public synchronized String reloadFromConfig(String name)`

- [ ] **Step 1: 写失败测试**(追加进 `McpServerManagerTest`,沿用文件内 fixture 手法;`registry` 字段与 `loadServersFromMap` 已存在)

```java
@Test
void reattachRegistersToolsIntoNewRegistryOnly() throws Exception {
    enqueueInitialize();
    enqueueToolsList("{\"name\":\"echo\",\"description\":\"回声\",\"inputSchema\":{\"type\":\"object\"}}");
    loadServersFromMap(Map.of("srv", httpConfig()));
    manager.startAll();
    String namespaced = McpToolDescriptor.namespaced("srv", "echo");
    assertTrue(registryHasTool(registry, namespaced), "前置:工具注册进原 registry");

    ToolRegistry fresh = newRegistryLikeSetUp(); // 与 setUp 同参新建一个 ToolRegistry
    manager.reattach(fresh);
    assertTrue(registryHasTool(fresh, namespaced), "reattach 后新 registry 有该工具");
}

@Test
void statusListenerFiresOnEachTransition() throws Exception {
    List<String> events = new ArrayList<>();
    manager.setStatusListener(s -> events.add(s.name() + ":" + s.status()));
    enqueueInitialize();
    enqueueToolsList("{\"name\":\"echo\",\"description\":\"d\",\"inputSchema\":{\"type\":\"object\"}}");
    loadServersFromMap(Map.of("srv", httpConfig()));
    manager.startAll();
    assertTrue(events.contains("srv:STARTING"));
    assertTrue(events.contains("srv:READY"));
    manager.disable("srv");
    assertTrue(events.contains("srv:DISABLED"));
}

@Test
void reloadFromConfigRemovesServerWhenConfigGone() throws Exception {
    enqueueInitialize();
    enqueueToolsList("{\"name\":\"echo\",\"description\":\"d\",\"inputSchema\":{\"type\":\"object\"}}");
    loadServersFromMap(Map.of("srv", httpConfig()));
    manager.startAll();
    // 空配置下 reload:server 应被移除且工具注销
    String msg = manager.reloadFromConfig("srv");
    assertTrue(manager.servers().stream().noneMatch(s -> s.name().equals("srv")), msg);
    assertFalse(registryHasTool(registry, McpToolDescriptor.namespaced("srv", "echo")));
}
```

辅助断言 `registryHasTool(ToolRegistry, String)` 与 `newRegistryLikeSetUp()`/`httpConfig()`:参照本文件既有用例
(`disableRemovesToolsFromRegistry` 行 135 用什么 API 断言工具存在,就用同一 API;`setUp` 怎么建 registry 就怎么建第二个;
既有用例的 http config 构造照抄)。reload 测试的"配置为空"依赖 setUp 注入的 configLoader 指向 @TempDir(本就无文件)。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith && mvn test -DskipTests=false -Dtest=McpServerManagerTest -q 2>&1 | tail -5`
Expected: 编译失败(`reattach`/`setStatusListener`/`reloadFromConfig` 不存在)。

- [ ] **Step 3: 实现**(`McpServerManager.java`)

1. 字段 `private final ToolRegistry toolRegistry;` 改 `private volatile ToolRegistry toolRegistry;`
   (类内所有读点自动走新引用;确认无缓存局部引用跨越 reattach 生命期)。
2. 新增字段与 setter:

```java
/** 状态迁移监听(app-server 推 mcp.status 用;TUI 不设,保持 null 零行为变化)。 */
private volatile java.util.function.Consumer<McpServer> statusListener;

public void setStatusListener(java.util.function.Consumer<McpServer> listener) {
    this.statusListener = listener;
}

private void setStatus(McpServer server, McpServerStatus status) {
    server.status(status);
    java.util.function.Consumer<McpServer> l = statusListener;
    if (l != null) {
        try { l.accept(server); } catch (Exception e) { /* 监听器异常不影响启动流程 */ }
    }
}
```

3. 把 5 处裸 `server.status(...)` 调用(行 405/408/423/427 的 start() 内与行 213 disable() 内)全部替换为 `setStatus(server, ...)`。
4. 把 `replaceTools(server, client, tools)` 中传给 `replaceMcpToolOutputsForServer` 的第三参 invoker 工厂 lambda
   提取为私有方法 `private Function<McpToolDescriptor, Function<String, ToolOutput>> invokerFactory(McpServer server, McpClient client)`,
   原调用点改用它(纯提取,行为不变)。
5. 新增 reattach(**只搬工具注册,不碰任何审批/hitl 状态——方法 javadoc 必须写明这条红线**):

```java
/**
 * 把已就绪 server 的工具重注册进新会话的 registry(工作区未变时复用 MCP 进程)。
 * 红线:只搬工具注册;审批放行(APPROVED_ALL 等)属于旧 registry,随旧会话废弃,绝不复制。
 */
public synchronized void reattach(ToolRegistry newRegistry) {
    this.toolRegistry = newRegistry;
    for (McpServer server : servers.values()) {
        if (server.status() == McpServerStatus.READY && !server.tools().isEmpty()) {
            newRegistry.replaceMcpToolOutputsForServer(server.name(), server.tools(),
                    invokerFactory(server, server.client()));
        }
    }
}
```

6. 新增 reloadFromConfig:

```java
/** 单 server 按当前配置重载:配置无此名→移除;有→关旧建新并启动;全新→建并启动。返回人话结果。 */
public synchronized String reloadFromConfig(String name) {
    Map<String, McpServerConfig> configs;
    try {
        configs = configLoader.load();
    } catch (IOException e) {
        return "配置读取失败: " + e.getMessage();
    }
    McpServer existing = servers.get(name);
    McpServerConfig cfg = configs.get(name);
    if (cfg == null) {
        if (existing != null) {
            unregisterTools(existing);
            existing.close();
            servers.remove(name);
        }
        return "已移除: " + name;
    }
    if (existing != null) {
        unregisterTools(existing);
        existing.close();
    }
    McpServer fresh = newServer(name, cfg); // 与 loadConfiguredServers 建 McpServer 的方式一致:同构造/同初始化,提公共私有方法复用
    servers.put(name, fresh);
    start(fresh);
    return fresh.status() == McpServerStatus.READY ? "已就绪: " + name
            : name + " 状态: " + fresh.status() + (fresh.errorMessage() == null ? "" : " — " + fresh.errorMessage());
}
```

`newServer(name, cfg)`:查看 `loadConfiguredServers()` 现有建 server 代码,若为内联构造则提取为私有方法双处复用(纯提取)。

- [ ] **Step 4: 跑测试确认通过 + MCP 包回归**

Run: `cd /Users/aa00945/Desktop/wraith && mvn test -DskipTests=false -Dtest='com.lyhn.wraith.mcp.**' -q 2>&1 | tail -5`
Expected: 全过(新增 3 例 + 既有全绿)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/mcp/McpServerManager.java src/test/java/com/lyhn/wraith/mcp/McpServerManagerTest.java
git commit -m "feat(mcp): reattach/状态监听/reloadFromConfig 三小口(app-server 挂载前置)"
```

---

### Task 2: McpConfigWriter(树式读改写)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/mcp/config/McpConfigWriter.java`
- Test: `src/test/java/com/lyhn/wraith/mcp/config/McpConfigWriterTest.java`(新)

**Interfaces:**
- Produces(Task 4 依赖,逐字):
  - `public static synchronized void upsert(Path file, String name, String command, List<String> args, Map<String, String> env) throws IOException`
  - `public static synchronized boolean remove(Path file, String name) throws IOException`

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.mcp.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class McpConfigWriterTest {

    @Test
    void upsertCreatesFileAndParentDirs(@TempDir Path dir) throws Exception {
        Path f = dir.resolve(".wraith").resolve("mcp.json");
        McpConfigWriter.upsert(f, "srv", "npx", List.of("-y", "pkg"), Map.of("KEY", "v1"));
        String json = Files.readString(f);
        assertTrue(json.contains("\"srv\""));
        assertTrue(json.contains("\"npx\""));
        assertTrue(json.contains("\"v1\""));
    }

    @Test
    void upsertPreservesUnknownFieldsAndDisabled(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("mcp.json");
        Files.writeString(f, """
                {"customTop":1,"mcpServers":{"srv":{"command":"old","disabled":true,"customField":"keep"}}}""");
        McpConfigWriter.upsert(f, "srv", "new-cmd", List.of(), Map.of());
        String json = Files.readString(f);
        assertTrue(json.contains("\"customTop\""), "顶层未知字段保留");
        assertTrue(json.contains("\"customField\""), "server 级未知字段保留");
        assertTrue(json.contains("\"disabled\""), "disabled 保留");
        assertTrue(json.contains("\"new-cmd\""));
        assertFalse(json.contains("\"old\""));
    }

    @Test
    void upsertClearsHttpFieldsWhenWritingStdio(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("mcp.json");
        Files.writeString(f, """
                {"mcpServers":{"srv":{"url":"https://x","headers":{"A":"B"}}}}""");
        McpConfigWriter.upsert(f, "srv", "cmd", List.of(), Map.of());
        String json = Files.readString(f);
        assertFalse(json.contains("\"url\""), "stdio 覆盖时清 url(transport 二选一校验)");
        assertFalse(json.contains("\"headers\""));
    }

    @Test
    void emptyEnvValueKeepsExistingAndIgnoresNew(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("mcp.json");
        Files.writeString(f, """
                {"mcpServers":{"srv":{"command":"c","env":{"TOKEN":"secret-old"}}}}""");
        McpConfigWriter.upsert(f, "srv", "c", List.of(), Map.of("TOKEN", "", "NEW_EMPTY", "", "NEW", "nv"));
        String json = Files.readString(f);
        assertTrue(json.contains("secret-old"), "空串=保留现值");
        assertFalse(json.contains("NEW_EMPTY"), "原无此 key 的空串被忽略");
        assertTrue(json.contains("\"nv\""));
    }

    @Test
    void removeReturnsFalseWhenAbsentTrueWhenRemoved(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("mcp.json");
        assertFalse(McpConfigWriter.remove(f, "srv"), "文件不存在");
        Files.writeString(f, """
                {"mcpServers":{"srv":{"command":"c"},"other":{"command":"o"}}}""");
        assertFalse(McpConfigWriter.remove(f, "ghost"));
        assertTrue(McpConfigWriter.remove(f, "srv"));
        String json = Files.readString(f);
        assertFalse(json.contains("\"srv\""));
        assertTrue(json.contains("\"other\""));
    }

    @Test
    void corruptJsonThrowsInsteadOfClobbering(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("mcp.json");
        Files.writeString(f, "not json{{");
        assertThrows(IOException.class, () -> McpConfigWriter.upsert(f, "s", "c", List.of(), Map.of()));
        assertThrows(IOException.class, () -> McpConfigWriter.remove(f, "s"));
        assertEquals("not json{{", Files.readString(f), "坏文件原样保留,绝不覆盖");
    }
}
```

- [ ] **Step 2: 确认失败**

Run: `cd /Users/aa00945/Desktop/wraith && mvn test -DskipTests=false -Dtest=McpConfigWriterTest -q 2>&1 | tail -5`
Expected: 编译失败(类不存在)。

- [ ] **Step 3: 实现**

```java
package com.lyhn.wraith.mcp.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * mcp.json 树式读改写:只动目标 server 的 command/args/env,顶层与 server 级未知字段原样保留
 * (McpConfigFile 是 ignoreUnknown 的读侧类,经它回写会丢字段——所以必须走 JsonNode 树)。
 * 坏 JSON 一律抛 IOException,绝不覆盖用户手写内容。
 */
public final class McpConfigWriter {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private McpConfigWriter() { }

    public static synchronized void upsert(Path file, String name, String command,
                                           List<String> args, Map<String, String> env) throws IOException {
        ObjectNode root = readTree(file);
        ObjectNode servers = objectChild(root, "mcpServers", true);
        ObjectNode entry = objectChild(servers, name, true);

        entry.put("command", command);
        ArrayNode argsNode = entry.putArray("args");
        args.forEach(argsNode::add);
        // stdio 覆盖:清 http 字段,否则 transport 二选一校验会拒启
        entry.remove("url");
        entry.remove("headers");

        ObjectNode oldEnv = entry.has("env") && entry.get("env").isObject() ? (ObjectNode) entry.get("env") : null;
        ObjectNode envNode = MAPPER.createObjectNode();
        for (Map.Entry<String, String> e : env.entrySet()) {
            if (e.getValue() != null && e.getValue().isEmpty()) {
                // 空串 = 保留现值(密钥编辑语义);原无此 key 则忽略
                if (oldEnv != null && oldEnv.hasNonNull(e.getKey())) envNode.set(e.getKey(), oldEnv.get(e.getKey()));
            } else {
                envNode.put(e.getKey(), e.getValue());
            }
        }
        if (envNode.size() > 0) entry.set("env", envNode); else entry.remove("env");

        if (file.getParent() != null) Files.createDirectories(file.getParent());
        Files.writeString(file, MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(root));
    }

    public static synchronized boolean remove(Path file, String name) throws IOException {
        if (!Files.exists(file)) return false;
        ObjectNode root = readTree(file);
        JsonNode servers = root.get("mcpServers");
        if (!(servers instanceof ObjectNode s) || !s.has(name)) return false;
        s.remove(name);
        Files.writeString(file, MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(root));
        return true;
    }

    private static ObjectNode readTree(Path file) throws IOException {
        if (!Files.exists(file)) return MAPPER.createObjectNode();
        JsonNode n;
        try {
            n = MAPPER.readTree(file.toFile());
        } catch (IOException e) {
            throw new IOException("mcp.json 解析失败,拒绝覆盖: " + file, e);
        }
        if (n instanceof ObjectNode o) return o;
        throw new IOException("mcp.json 顶层不是对象,拒绝覆盖: " + file);
    }

    private static ObjectNode objectChild(ObjectNode parent, String field, boolean create) {
        JsonNode child = parent.get(field);
        if (child instanceof ObjectNode o) return o;
        if (!create) return null;
        return parent.putObject(field);
    }
}
```

- [ ] **Step 4: 确认通过**

Run: `cd /Users/aa00945/Desktop/wraith && mvn test -DskipTests=false -Dtest=McpConfigWriterTest -q 2>&1 | tail -3`
Expected: 6/6 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/mcp/config/McpConfigWriter.java src/test/java/com/lyhn/wraith/mcp/config/McpConfigWriterTest.java
git commit -m "feat(mcp): McpConfigWriter 树式配置写入(保留未知字段/空串保留密钥/坏JSON拒写)"
```

---

### Task 3: EventStreamRenderer.emitMcpStatus

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamRendererTest.java`(追加 2 例)

**Interfaces:**
- Produces(Task 4 依赖):`public void emitMcpStatus(String name, String state, String error)` → 通知 `mcp.status` params `{sessionId, turnId, name, state, error?}`。

- [ ] **Step 1: 写失败测试**(仿本文件既有断言方式:捕获 writer 输出解析 JSON)

```java
@Test
void emitMcpStatusWithError() throws Exception {
    // 沿用本文件既有 renderer/writer 构造 helper
    renderer.emitMcpStatus("github", "error", "连接失败");
    JsonNode n = lastNotification("mcp.status");
    assertEquals("github", n.get("params").get("name").asText());
    assertEquals("error", n.get("params").get("state").asText());
    assertEquals("连接失败", n.get("params").get("error").asText());
}

@Test
void emitMcpStatusOmitsBlankError() throws Exception {
    renderer.emitMcpStatus("fs", "ready", null);
    JsonNode n = lastNotification("mcp.status");
    assertEquals("ready", n.get("params").get("state").asText());
    assertFalse(n.get("params").has("error"));
}
```

`lastNotification(method)`:若文件无同名 helper,按既有测试解析输出流的方式取最后一条该 method 通知。

- [ ] **Step 2: 确认失败** — Run: `mvn test -DskipTests=false -Dtest=EventStreamRendererTest -q`(仓根)。Expected: 编译失败。

- [ ] **Step 3: 实现**(仿 `appendDiff` 的 `base()`+`writer.notify` 模式,加在 `updateStatus` 附近)

```java
/** MCP server 状态通知(Phase E-1):starting/ready/disabled/error;error 空白则省略字段。 */
public void emitMcpStatus(String name, String state, String error) {
    Map<String, Object> p = base();
    p.put("name", name);
    p.put("state", state);
    if (error != null && !error.isBlank()) p.put("error", error);
    writer.notify("mcp.status", p);
}
```

- [ ] **Step 4: 确认通过** — Run: `mvn test -DskipTests=false -Dtest=EventStreamRendererTest -q 2>&1 | tail -3`。Expected: 全过(6+2)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamRendererTest.java
git commit -m "feat(appserver): emitMcpStatus 通知(mcp.status)"
```

---

### Task 4: McpOps 接口 + AppServerMcp(生命周期 + 操作面)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/runtime/appserver/McpOps.java`
- Create: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServerMcp.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerMcpTest.java`(新)

**Interfaces:**
- Consumes: Task 1 `reattach/setStatusListener/reloadFromConfig`、Task 2 `McpConfigWriter`、Task 3 `emitMcpStatus`;引擎既有 `servers()/server(name)/enable/disable/restart/logs/resourceCandidates/prompts/close/loadConfiguredServers/startAll()`,`McpServer.{name,status,config,tools,errorMessage,transportName,client}`,`McpToolDescriptor.{name,description}`,`McpServerConfig.getEnv()`(若 getter 名不同以实际为准,下同一处 javadoc 注明)。
- Produces(Task 5/6 依赖,逐字):
  - `McpOps` 接口全部方法(见 Step 3 代码)
  - `AppServerMcp implements McpOps`;`public synchronized void ensureFor(String workspaceRoot, ToolRegistry registry, EventStreamRenderer renderer)`;`public McpServerManager manager()`
  - 错误约定:未知 server → `NoSuchElementException`;manager 未初始化 → `IllegalStateException`;scope 非法/project-无工作区 → `IllegalArgumentException`;文件错误 → `IOException` 透传

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.mcp.McpServerManager;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class AppServerMcpTest {

    /** 记录型假 manager:不起任何真进程。 */
    static class FakeManager extends McpServerManager {
        final List<String> calls = new ArrayList<>();
        FakeManager(ToolRegistry r, Path p) { super(r, p); }
        @Override public void loadConfiguredServers() { calls.add("load"); }
        @Override public void startAll() { calls.add("startAll"); }
        @Override public synchronized void reattach(ToolRegistry newRegistry) { calls.add("reattach:" + System.identityHashCode(newRegistry)); }
        @Override public void close() { calls.add("close"); }
    }

    private static ToolRegistry registry(Path dir) {
        ToolRegistry r = new ToolRegistry();
        r.setProjectPath(dir.toString());
        return r;
    }
    // ↑ 若 ToolRegistry 无零参构造/该 setter,按仓内其他测试(如 HitlToolRegistryTest)的最小构造方式改写,语义不变。

    @Test
    void sameWorkspaceReusesManagerViaReattach(@TempDir Path ws) throws Exception {
        List<FakeManager> created = new ArrayList<>();
        AppServerMcp mcp = new AppServerMcp((reg, dir) -> { FakeManager f = new FakeManager(reg, dir); created.add(f); return f; });
        ToolRegistry r1 = registry(ws); ToolRegistry r2 = registry(ws);
        mcp.ensureFor(ws.toString(), r1, null);
        mcp.ensureFor(ws.toString(), r2, null);
        assertEquals(1, created.size(), "同工作区不重建");
        FakeManager m = created.get(0);
        assertTrue(m.calls.contains("reattach:" + System.identityHashCode(r2)),
                "复用路径必须 reattach 到【新】registry——审批状态随旧 registry 废弃的结构保证");
        assertFalse(m.calls.contains("close"));
    }

    @Test
    void workspaceChangeClosesOldAndRebuilds(@TempDir Path wsA, @TempDir Path wsB) throws Exception {
        List<FakeManager> created = new ArrayList<>();
        AppServerMcp mcp = new AppServerMcp((reg, dir) -> { FakeManager f = new FakeManager(reg, dir); created.add(f); return f; });
        mcp.ensureFor(wsA.toString(), registry(wsA), null);
        mcp.ensureFor(wsB.toString(), registry(wsB), null);
        assertEquals(2, created.size());
        assertTrue(created.get(0).calls.contains("close"), "旧 manager 被关闭");
        assertTrue(created.get(1).calls.contains("load"));
        // startAll 在后台线程,轮询等待(≤2s,无 sleep 断言)
        long deadline = System.currentTimeMillis() + 2000;
        while (System.currentTimeMillis() < deadline && !created.get(1).calls.contains("startAll")) Thread.sleep(10);
        assertTrue(created.get(1).calls.contains("startAll"));
    }

    @Test
    void factoryThrowIsFailOpen(@TempDir Path ws) {
        AppServerMcp mcp = new AppServerMcp((reg, dir) -> { throw new RuntimeException("boom"); });
        assertDoesNotThrow(() -> mcp.ensureFor(ws.toString(), registry(ws), null));
        assertNull(mcp.manager());
        assertThrows(IllegalStateException.class, mcp::list);
    }

    @Test
    void opsThrowOnUnknownServerAndBadScope(@TempDir Path ws) throws Exception {
        AppServerMcp mcp = new AppServerMcp((reg, dir) -> new FakeManager(reg, dir));
        mcp.ensureFor(ws.toString(), registry(ws), null);
        assertThrows(java.util.NoSuchElementException.class, () -> mcp.enable("ghost"));
        assertThrows(IllegalArgumentException.class,
                () -> mcp.configUpsert("bogus-scope", "s", "c", List.of(), java.util.Map.of()));
    }

    @Test
    void configUpsertProjectScopeWritesUnderWorkspace(@TempDir Path ws) throws Exception {
        AtomicInteger reloads = new AtomicInteger();
        AppServerMcp mcp = new AppServerMcp((reg, dir) -> new FakeManager(reg, dir) {
            @Override public synchronized String reloadFromConfig(String name) { reloads.incrementAndGet(); return "ok"; }
        });
        mcp.ensureFor(ws.toString(), registry(ws), null);
        mcp.configUpsert("project", "srv", "cmd", List.of("a"), java.util.Map.of("K", "v"));
        assertTrue(java.nio.file.Files.exists(ws.resolve(".wraith").resolve("mcp.json")));
        assertEquals(1, reloads.get(), "upsert 后重载该 server");
    }
}
```

- [ ] **Step 2: 确认失败** — Run: `mvn test -DskipTests=false -Dtest=AppServerMcpTest -q`(仓根)。Expected: 编译失败。

- [ ] **Step 3: 实现**

`McpOps.java`:

```java
package com.lyhn.wraith.runtime.appserver;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/** mcp.* RPC 的操作面(spec §4)。AppServer handler 只见此接口,便于 dispatch 测试用匿名 fake。 */
public interface McpOps {
    /** {servers:[{name,state,scope,enabled,shadowed,transport,tools,envKeys,error?}], configError?} */
    Map<String, Object> list();
    void enable(String name);
    void disable(String name);
    void restart(String name);
    String logs(String name);
    /** name 为 null = 全部 server 汇总(@ 补全数据源);元素 {server,uri,name,description?} */
    List<Map<String, Object>> resources(String nameOrNull);
    /** 引擎格式化文本(spec:{text}) */
    String prompts(String name);
    void configUpsert(String scope, String name, String command, List<String> args, Map<String, String> env) throws IOException;
    boolean configRemove(String scope, String name) throws IOException;
}
```

`AppServerMcp.java`(进程级单槽;要点全部落码——scope 判定读两级文件名集合、shadowed=project 且 user 同名、
envKeys 排序、未知 server 抛 NoSuchElementException、manager 未初始化抛 IllegalStateException):

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.mcp.McpServer;
import com.lyhn.wraith.mcp.McpServerManager;
import com.lyhn.wraith.mcp.McpServerStatus;
import com.lyhn.wraith.mcp.config.McpConfigWriter;
import com.lyhn.wraith.tool.ToolRegistry;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

/**
 * app-server 的 MCP 生命周期(按工作区复用)+ mcp.* 操作面。
 * fail-open:MCP 初始化失败不影响会话;通知打到【当前】会话 renderer(ensureFor 换绑)。
 */
public final class AppServerMcp implements McpOps {

    public interface ManagerFactory { McpServerManager create(ToolRegistry registry, Path projectDir); }

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final ManagerFactory factory;
    private volatile McpServerManager manager;
    private volatile String currentWorkspace;
    private volatile EventStreamRenderer renderer;

    public AppServerMcp() { this(McpServerManager::new); }

    AppServerMcp(ManagerFactory factory) { this.factory = factory; }

    public synchronized void ensureFor(String workspaceRoot, ToolRegistry registry, EventStreamRenderer renderer) {
        this.renderer = renderer; // 状态通知换绑到当前会话
        try {
            String normalized = Path.of(workspaceRoot).toAbsolutePath().normalize().toString();
            if (manager != null && normalized.equals(currentWorkspace)) {
                manager.reattach(registry);
                return;
            }
            McpServerManager old = manager;
            manager = null;
            if (old != null) {
                try { old.close(); } catch (Exception e) { /* fail-open */ }
            }
            currentWorkspace = normalized;
            McpServerManager fresh = factory.create(registry, Path.of(normalized));
            fresh.setStatusListener(this::pushStatus);
            fresh.loadConfiguredServers();
            manager = fresh;
            Thread starter = new Thread(() -> {
                try { fresh.startAll(); } catch (Exception e) {
                    System.err.println("[app-server] MCP startAll 失败(fail-open): " + e.getMessage());
                }
            }, "wraith-appserver-mcp-startall");
            starter.setDaemon(true);
            starter.start();
        } catch (Exception e) {
            System.err.println("[app-server] MCP 初始化失败(fail-open): " + e.getMessage());
        }
    }

    public McpServerManager manager() { return manager; }

    private void pushStatus(McpServer s) {
        EventStreamRenderer r = renderer;
        if (r == null) return;
        r.emitMcpStatus(s.name(), s.status().name().toLowerCase(Locale.ROOT),
                s.status() == McpServerStatus.ERROR ? s.errorMessage() : null);
    }

    private McpServerManager requireManager() {
        McpServerManager m = manager;
        if (m == null) throw new IllegalStateException("mcp 未初始化");
        return m;
    }

    private McpServer requireServer(String name) {
        McpServer s = requireManager().server(name);
        if (s == null) throw new NoSuchElementException("未知 MCP server: " + name);
        return s;
    }

    // ── McpOps ──────────────────────────────────────────────────────────────

    @Override public Map<String, Object> list() {
        McpServerManager m = requireManager();
        StringBuilder configError = new StringBuilder();
        Set<String> userNames = namesIn(userConfigPath(), configError);
        Set<String> projectNames = namesIn(projectConfigPath(), configError);
        List<Map<String, Object>> out = new ArrayList<>();
        for (McpServer s : m.servers()) {
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("name", s.name());
            e.put("state", s.status().name().toLowerCase(Locale.ROOT));
            String scope = projectNames.contains(s.name()) ? "project"
                    : userNames.contains(s.name()) ? "user" : "builtin";
            e.put("scope", scope);
            e.put("enabled", s.status() != McpServerStatus.DISABLED);
            e.put("shadowed", "project".equals(scope) && userNames.contains(s.name()));
            e.put("transport", s.transportName());
            List<Map<String, Object>> tools = new ArrayList<>();
            s.tools().forEach(t -> tools.add(Map.of(
                    "name", t.name(), "description", t.description() == null ? "" : t.description())));
            e.put("tools", tools);
            List<String> envKeys = s.config() != null && s.config().getEnv() != null
                    ? new ArrayList<>(s.config().getEnv().keySet()) : new ArrayList<>();
            Collections.sort(envKeys);
            e.put("envKeys", envKeys);
            if (s.status() == McpServerStatus.ERROR && s.errorMessage() != null) e.put("error", s.errorMessage());
            out.add(e);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("servers", out);
        if (configError.length() > 0) result.put("configError", configError.toString());
        return result;
    }

    @Override public void enable(String name) { requireServer(name); requireManager().enable(name); }
    @Override public void disable(String name) { requireServer(name); requireManager().disable(name); }
    @Override public void restart(String name) { requireServer(name); requireManager().restart(name); }
    @Override public String logs(String name) { requireServer(name); return requireManager().logs(name); }

    @Override public List<Map<String, Object>> resources(String nameOrNull) {
        McpServerManager m = requireManager();
        List<Map<String, Object>> out = new ArrayList<>();
        m.resourceCandidates().forEach(d -> {
            if (nameOrNull != null && !nameOrNull.equals(d.serverName())) return;
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("server", d.serverName());
            e.put("uri", d.uri());
            e.put("name", d.displayName());
            if (d.description() != null && !d.description().isBlank()) e.put("description", d.description());
            out.add(e);
        });
        return out;
    }

    @Override public String prompts(String name) { requireServer(name); return requireManager().prompts(name); }

    @Override public void configUpsert(String scope, String name, String command,
                                       List<String> args, Map<String, String> env) throws IOException {
        McpConfigWriter.upsert(scopePath(scope), name, command, args, env);
        McpServerManager m = manager;
        if (m != null) m.reloadFromConfig(name);
    }

    @Override public boolean configRemove(String scope, String name) throws IOException {
        boolean removed = McpConfigWriter.remove(scopePath(scope), name);
        if (removed) {
            McpServerManager m = manager;
            if (m != null) m.reloadFromConfig(name);
        }
        return removed;
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private Path scopePath(String scope) {
        if ("user".equals(scope)) return userConfigPath();
        if ("project".equals(scope)) {
            String ws = currentWorkspace;
            if (ws == null) throw new IllegalArgumentException("当前无工作区,不能写项目级配置");
            return Path.of(ws, ".wraith", "mcp.json");
        }
        throw new IllegalArgumentException("scope 必须是 user 或 project: " + scope);
    }

    private Path userConfigPath() { return Path.of(System.getProperty("user.home"), ".wraith", "mcp.json"); }

    private Path projectConfigPath() {
        String ws = currentWorkspace;
        return ws == null ? Path.of(".wraith", "mcp.json") : Path.of(ws, ".wraith", "mcp.json");
    }

    private Set<String> namesIn(Path file, StringBuilder configError) {
        if (!Files.exists(file)) return Set.of();
        try {
            JsonNode n = MAPPER.readTree(file.toFile()).get("mcpServers");
            if (n == null || !n.isObject()) return Set.of();
            Set<String> names = new LinkedHashSet<>();
            n.fieldNames().forEachRemaining(names::add);
            return names;
        } catch (IOException e) {
            if (configError.length() > 0) configError.append("; ");
            configError.append(file).append(" 解析失败");
            return Set.of();
        }
    }
}
```

注意:`McpServerConfig` 的 env 取值 getter 若非 `getEnv()`,以实际类为准调整(该类在 `mcp/config/`),其余不变。

- [ ] **Step 4: 确认通过** — Run: `mvn test -DskipTests=false -Dtest=AppServerMcpTest -q 2>&1 | tail -3`。Expected: 6/6 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/McpOps.java src/main/java/com/lyhn/wraith/runtime/appserver/AppServerMcp.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerMcpTest.java
git commit -m "feat(appserver): AppServerMcp 工作区复用生命周期 + McpOps 操作面"
```

---

### Task 5: AppServer mcp.* dispatch(9 个 handler)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerMcpDispatchTest.java`(新,仿 `AppServerSessionTest` 管道 harness)

**Interfaces:**
- Consumes: Task 4 `McpOps`。
- Produces(Task 6/7 依赖):`SessionRunner` += `default McpOps mcp() { return null; }`;dispatch cases `mcp.list/enable/disable/restart/logs/resources/prompts/config.upsert/config.remove`;错误码:无会话/-32000、mcp unavailable/-32000、缺参/-32602、IllegalArgumentException/-32602、NoSuchElement|IllegalState/-32000、其余异常/-32000。

- [ ] **Step 1: 写失败测试**(harness 与 `AppServerSessionTest` 同款:字符串输入流 → serve → 解析输出;fake runner 的 `mcp()` 返回记录型匿名 McpOps)

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AppServerMcpDispatchTest {

    private List<JsonNode> run(String... requests) throws Exception {
        List<String> calls = new ArrayList<>();
        return run(calls, requests);
    }

    private List<JsonNode> run(List<String> calls, String... requests) throws Exception {
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            McpOps ops = new McpOps() {
                public Map<String, Object> list() { calls.add("list"); return Map.of("servers", List.of()); }
                public void enable(String n) { calls.add("enable:" + n); if ("ghost".equals(n)) throw new NoSuchElementException("未知"); }
                public void disable(String n) { calls.add("disable:" + n); }
                public void restart(String n) { calls.add("restart:" + n); }
                public String logs(String n) { calls.add("logs:" + n); return "L1\nL2"; }
                public List<Map<String, Object>> resources(String n) { calls.add("resources:" + n); return List.of(Map.of("server", "s", "uri", "u", "name", "r")); }
                public String prompts(String n) { calls.add("prompts:" + n); return "PTEXT"; }
                public void configUpsert(String sc, String n, String c, List<String> a, Map<String, String> e) { calls.add("upsert:" + sc + ":" + n); if ("bad".equals(sc)) throw new IllegalArgumentException("scope"); }
                public boolean configRemove(String sc, String n) { calls.add("remove:" + sc + ":" + n); return true; }
            };
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
                public McpOps mcp() { return ops; }
            };
        };
        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        int id = 2;
        for (String req : requests) lines.add(req.replace("__ID__", String.valueOf(id++)));
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)), out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n"))
            if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }

    private JsonNode byId(List<JsonNode> replies, int id) {
        return replies.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst().orElseThrow();
    }

    @Test
    void listAndLogsAndPromptsReturnResults() throws Exception {
        List<JsonNode> r = run(
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.list\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.logs\",\"params\":{\"name\":\"srv\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.prompts\",\"params\":{\"name\":\"srv\"}}");
        assertTrue(byId(r, 2).get("result").has("servers"));
        assertEquals("L1\nL2", byId(r, 3).get("result").get("lines").asText());
        assertEquals("PTEXT", byId(r, 4).get("result").get("text").asText());
    }

    @Test
    void mutatingOpsDispatchAndReturnOk() throws Exception {
        List<String> calls = new ArrayList<>();
        List<JsonNode> r = run(calls,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.enable\",\"params\":{\"name\":\"a\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.disable\",\"params\":{\"name\":\"a\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.restart\",\"params\":{\"name\":\"a\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.config.upsert\",\"params\":{\"scope\":\"user\",\"name\":\"a\",\"command\":\"c\",\"args\":[\"x\"],\"env\":{\"K\":\"v\"}}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.config.remove\",\"params\":{\"scope\":\"user\",\"name\":\"a\"}}");
        for (int id = 2; id <= 6; id++) assertTrue(byId(r, id).get("result").get("ok").asBoolean());
        assertEquals(List.of("enable:a", "disable:a", "restart:a", "upsert:user:a", "remove:user:a"), calls);
    }

    @Test
    void resourcesWithAndWithoutName() throws Exception {
        List<String> calls = new ArrayList<>();
        List<JsonNode> r = run(calls,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.resources\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.resources\",\"params\":{\"name\":\"srv\"}}");
        assertEquals(1, byId(r, 2).get("result").get("resources").size());
        assertEquals(List.of("resources:null", "resources:srv"), calls);
    }

    @Test
    void errorPaths() throws Exception {
        List<JsonNode> r = run(
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.enable\",\"params\":{}}",                    // 缺 name → -32602
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.enable\",\"params\":{\"name\":\"ghost\"}}",  // 未知 → -32000
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.config.upsert\",\"params\":{\"scope\":\"bad\",\"name\":\"a\",\"command\":\"c\"}}"); // IAE → -32602
        assertEquals(-32602, byId(r, 2).get("error").get("code").asInt());
        assertEquals(-32000, byId(r, 3).get("error").get("code").asInt());
        assertEquals(-32602, byId(r, 4).get("error").get("code").asInt());
    }

    @Test
    void noSessionAndNoOpsReturnErrors() throws Exception {
        // 无会话:直接发 mcp.list(不先 session.start)
        AppServer.SessionRunnerFactory f = (w, sid, ws) -> {
            EventStreamRenderer r = new EventStreamRenderer(w, sid);
            return new AppServer.SessionRunner() {  // mcp() 用默认 null
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
            };
        };
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"mcp.list\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"mcp.list\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n"))
            if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        assertEquals(-32000, byId(replies, 1).get("error").get("code").asInt()); // no session
        assertEquals(-32000, byId(replies, 3).get("error").get("code").asInt()); // mcp unavailable
    }
}
```

- [ ] **Step 2: 确认失败** — Run: `mvn test -DskipTests=false -Dtest=AppServerMcpDispatchTest -q`。Expected: 编译失败(`mcp()` 不存在)。

- [ ] **Step 3: 实现**(`AppServer.java`)

1. `SessionRunner` 接口追加:`default McpOps mcp() { return null; }`
2. dispatch switch 追加 9 case(紧跟 `session.rewind` 之后):

```java
case "mcp.list" -> handleMcp(msg, ops -> writer.result(msg.id(), ops.list()));
case "mcp.enable" -> handleMcpNamed(msg, (ops, name) -> { ops.enable(name); ok(msg); });
case "mcp.disable" -> handleMcpNamed(msg, (ops, name) -> { ops.disable(name); ok(msg); });
case "mcp.restart" -> handleMcpNamed(msg, (ops, name) -> { ops.restart(name); ok(msg); });
case "mcp.logs" -> handleMcpNamed(msg, (ops, name) -> writer.result(msg.id(), Map.of("lines", ops.logs(name))));
case "mcp.prompts" -> handleMcpNamed(msg, (ops, name) -> writer.result(msg.id(), Map.of("text", ops.prompts(name))));
case "mcp.resources" -> handleMcp(msg, ops -> {
    JsonNode p = msg.params();
    String name = p != null && p.hasNonNull("name") ? p.get("name").asText() : null;
    writer.result(msg.id(), Map.of("resources", ops.resources(name)));
});
case "mcp.config.upsert" -> handleMcp(msg, ops -> {
    JsonNode p = msg.params();
    String scope = textParam(p, "scope"); String name = textParam(p, "name"); String command = textParam(p, "command");
    if (scope == null || name == null || command == null) { writer.error(msg.id(), -32602, "缺 scope/name/command"); return; }
    java.util.List<String> args = new java.util.ArrayList<>();
    if (p.has("args") && p.get("args").isArray()) p.get("args").forEach(a -> args.add(a.asText()));
    java.util.Map<String, String> env = new java.util.LinkedHashMap<>();
    if (p.has("env") && p.get("env").isObject())
        p.get("env").fields().forEachRemaining(e -> env.put(e.getKey(), e.getValue().asText()));
    try { ops.configUpsert(scope, name, command, args, env); ok(msg); }
    catch (java.io.IOException e) { writer.error(msg.id(), -32000, "配置写入失败: " + e.getMessage()); }
});
case "mcp.config.remove" -> handleMcp(msg, ops -> {
    JsonNode p = msg.params();
    String scope = textParam(p, "scope"); String name = textParam(p, "name");
    if (scope == null || name == null) { writer.error(msg.id(), -32602, "缺 scope/name"); return; }
    try {
        if (!ops.configRemove(scope, name)) { writer.error(msg.id(), -32000, "该层级无此配置: " + name); return; }
        ok(msg);
    } catch (java.io.IOException e) { writer.error(msg.id(), -32000, "配置写入失败: " + e.getMessage()); }
});
```

3. 私有 helper(放 `handleSessionRewind` 附近,错误码模式与其一致):

```java
private void ok(JsonRpc.Incoming msg) { writer.result(msg.id(), Map.of("ok", true)); }

private static String textParam(JsonNode p, String field) {
    return p != null && p.hasNonNull(field) && !p.get(field).asText().isBlank() ? p.get(field).asText() : null;
}

private void handleMcp(JsonRpc.Incoming msg, java.util.function.Consumer<McpOps> action) {
    if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
    McpOps ops = session.mcp();
    if (ops == null) { writer.error(msg.id(), -32000, "mcp unavailable"); return; }
    try { action.accept(ops); }
    catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
    catch (java.util.NoSuchElementException | IllegalStateException e) { writer.error(msg.id(), -32000, e.getMessage()); }
    catch (Exception e) { writer.error(msg.id(), -32000, "mcp 操作失败: " + e.getMessage()); }
}

private void handleMcpNamed(JsonRpc.Incoming msg, java.util.function.BiConsumer<McpOps, String> action) {
    handleMcp(msg, ops -> {
        String name = textParam(msg.params(), "name");
        if (name == null) { writer.error(msg.id(), -32602, "missing name"); return; }
        action.accept(ops, name);
    });
}
```

- [ ] **Step 4: 确认通过 + appserver 包回归**

Run: `mvn test -DskipTests=false -Dtest='com.lyhn.wraith.runtime.appserver.**' -q 2>&1 | tail -3`
Expected: 全过(新 5 例 + 既有)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerMcpDispatchTest.java
git commit -m "feat(appserver): mcp.* 九路 dispatch(SessionRunner.mcp 默认空,负路径全覆盖)"
```

---

### Task 6: Main.java 挂载(AppServerMcp + @-mention)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(app-server 段,~1104-1194)

**Interfaces:**
- Consumes: Task 4 `AppServerMcp.ensureFor/manager()`、Task 5 `SessionRunner.mcp()`;既有 `AtMentionExpander(McpServerManager)` + `expand(String)`(失败语义:原 token + `<resource_error>` 标签,永不抛)。
- Produces: app-server 全链路可用;TUI 路径零改动。

- [ ] **Step 1: 实现**(无独立新测——行为由 Task 1-5 单测 + Task 11 E2E + 全量回归覆盖;本任务是纯装配)

1. `startAppServer`(工厂 lambda 外、`new AppServer(...)` 之前,与 `client` 捕获同层):

```java
com.lyhn.wraith.runtime.appserver.AppServerMcp appServerMcp =
        new com.lyhn.wraith.runtime.appserver.AppServerMcp();
```

2. 工厂 lambda 内,`root` 解析之后、`registry.setProjectPath(root)` 之前插:

```java
appServerMcp.ensureFor(root, registry, renderer);
```

3. 匿名 `SessionRunner` 内:
   - `runTurn` 由 `return agent.run(input);` 改为:

```java
public String runTurn(String input) throws Exception {
    String expanded = input;
    com.lyhn.wraith.mcp.McpServerManager m = appServerMcp.manager();
    if (m != null) {
        // @server:uri 展开(TUI 同语义:失败注入 <resource_error>,永不失败整轮)
        expanded = new com.lyhn.wraith.mcp.mention.AtMentionExpander(m).expand(input);
    }
    return agent.run(expanded);
}
```

   - 追加 override:

```java
public com.lyhn.wraith.runtime.appserver.McpOps mcp() { return appServerMcp; }
```

- [ ] **Step 2: 全量回归 + 打包**

Run: `cd /Users/aa00945/Desktop/wraith && mvn test -DskipTests=false 2>&1 | grep -E "Tests run: [0-9]{3,}" | tail -1`
Expected: `Failures: 3, Errors: 38`(基线),总数 = 910 + 本期新增(记录实数)。
Run: `mvn package -DskipTests -q && ls -la target/*.jar | head -3`
Expected: jar 构建成功。

- [ ] **Step 3: Commit**

```bash
git add src/main/java/com/lyhn/wraith/cli/Main.java
git commit -m "feat(appserver): 挂载 AppServerMcp(工作区复用)+ runTurn @-mention 展开"
```

---

### Task 7: preload + main IPC 透传 + 共享类型

**Files:**
- Modify: `desktop/src/shared/types.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/main/index.ts`

**Interfaces:**
- Produces(Task 8/9/10 依赖,逐字):

```ts
// shared/types.ts 追加:
export interface McpToolView { name: string; description: string }
export interface McpServerView {
  name: string
  state: 'starting' | 'ready' | 'disabled' | 'error'
  scope: 'user' | 'project' | 'builtin'
  enabled: boolean
  shadowed: boolean
  transport: 'stdio' | 'http' | string
  tools: McpToolView[]
  envKeys: string[]
  error?: string
}
export interface McpListResult { servers: McpServerView[]; configError?: string }
export interface McpResourceView { server: string; uri: string; name: string; description?: string }
export interface McpUpsertPayload {
  scope: 'user' | 'project'
  name: string
  command: string
  args: string[]
  env: Record<string, string>
}
```

- `WraithApi` +=(实现按 preload 现有 `ipcRenderer.invoke('wraith:<名>')` 模式逐一对应):

```ts
  mcpList(): Promise<McpListResult>
  mcpEnable(name: string): Promise<{ ok: boolean }>
  mcpDisable(name: string): Promise<{ ok: boolean }>
  mcpRestart(name: string): Promise<{ ok: boolean }>
  mcpLogs(name: string): Promise<{ lines: string }>
  mcpResources(name?: string): Promise<{ resources: McpResourceView[] }>
  mcpPrompts(name: string): Promise<{ text: string }>
  mcpConfigUpsert(payload: McpUpsertPayload): Promise<{ ok: boolean }>
  mcpConfigRemove(scope: 'user' | 'project', name: string): Promise<{ ok: boolean }>
```

- [ ] **Step 1: 实现**

`desktop/src/main/index.ts` 追加 9 个透传 handler(放 `wraith:renameProject` 之后,模式与 `wraith:initialize` 一致):

```ts
ipcMain.handle('wraith:mcpList', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.list', {})
})
ipcMain.handle('wraith:mcpEnable', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.enable', { name })
})
ipcMain.handle('wraith:mcpDisable', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.disable', { name })
})
ipcMain.handle('wraith:mcpRestart', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.restart', { name })
})
ipcMain.handle('wraith:mcpLogs', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.logs', { name })
})
ipcMain.handle('wraith:mcpResources', async (_e, name: string | undefined) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.resources', name ? { name } : {})
})
ipcMain.handle('wraith:mcpPrompts', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.prompts', { name })
})
ipcMain.handle('wraith:mcpConfigUpsert', async (_e, payload: unknown) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.config.upsert', payload as Record<string, unknown>)
})
ipcMain.handle('wraith:mcpConfigRemove', async (_e, scope: string, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.config.remove', { scope, name })
})
```

preload:接口 + 实现按 Produces 逐字加(import type 行加 `McpListResult, McpResourceView, McpUpsertPayload`)。

- [ ] **Step 2: 门禁** — Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx tsc --noEmit -p tsconfig.json && npx vitest run 2>&1 | tail -2`。Expected: tsc 0 错、vitest 102。

- [ ] **Step 3: Commit**

```bash
git add desktop/src/shared/types.ts desktop/src/preload/index.ts desktop/src/main/index.ts
git commit -m "feat(desktop): mcp.* IPC 透传九路 + 共享类型"
```

---

### Task 8: 视图切换 + PluginsPanel(只读骨架)

**Files:**
- Create: `desktop/src/renderer/components/PluginsPanel.tsx`
- Modify: `desktop/src/renderer/components/Sidebar.tsx`(nav-plugins 启用)
- Modify: `desktop/src/renderer/App.tsx`(view 态 + mcp 状态 + mcp.status 通知分流)

**Interfaces:**
- Consumes: Task 7 `window.wraith.mcp*`、`McpServerView/McpListResult`。
- Produces(Task 9/10/11 依赖):
  - App:`view: 'chat' | 'plugins'`;`mcpServers: McpServerView[]`;`fetchMcp()`;onEvent 中 `evt.method === 'mcp.status'` 分流(不进 reducer)
  - Sidebar props += `activeNav: 'plugins' | null` 与 `onOpenPlugins: () => void`
  - `PluginsPanel` props(本任务先接只读部分,操作回调 Task 9 实装):
    `{ servers, configError, busy, onBack, onRefresh, onToggle, onRestart, onRemove, onSubmitForm }`(签名见代码)
  - testid:`plugins-back`、`mcp-server-item`、`mcp-toggle`、`mcp-restart`、`mcp-edit`、`mcp-remove`、`mcp-add`、`mcp-tab-tools`、`mcp-tab-resources`、`mcp-tab-prompts`、`mcp-tab-logs`、`mcp-detail`

- [ ] **Step 1: PluginsPanel.tsx**(完整组件;Task 9 只填充表单与操作,不改本结构)

```tsx
import { useEffect, useState } from 'react'
import type { McpServerView, McpResourceView } from '../../shared/types'
import McpServerForm, { type McpFormValue } from './McpServerForm'

interface PluginsPanelProps {
  servers: McpServerView[]
  configError: string | null
  /** turn 运行中:工具集变更操作禁用(启停/重启/删除/表单提交),只读浏览不受限 */
  busy: boolean
  onBack: () => void
  onRefresh: () => void
  onToggle: (name: string, enable: boolean) => void
  onRestart: (name: string) => void
  onRemove: (scope: 'user' | 'project', name: string) => void
  onSubmitForm: (v: McpFormValue) => Promise<boolean>
}

const STATE_DOT: Record<string, string> = {
  starting: 'bg-warning animate-pulse',
  ready: 'bg-success',
  disabled: 'bg-fg-subtle',
  error: 'bg-danger',
}
const STATE_LABEL: Record<string, string> = {
  starting: '启动中…', ready: '就绪', disabled: '已停用', error: '错误',
}
const SCOPE_LABEL: Record<string, string> = { user: '用户', project: '本项目', builtin: '内置' }

type Tab = 'tools' | 'resources' | 'prompts' | 'logs'

export default function PluginsPanel(props: PluginsPanelProps): JSX.Element {
  const { servers, configError, busy, onBack } = props
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('tools')
  const [formMode, setFormMode] = useState<'hidden' | 'add' | 'edit'>('hidden')
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [tabContent, setTabContent] = useState<{ resources: McpResourceView[]; prompts: string; logs: string }>({
    resources: [], prompts: '', logs: '',
  })

  const current = servers.find(s => s.name === selected) ?? servers[0] ?? null

  // 选中/换 tab 时拉取动态内容(工具列表在 servers 里,静态)
  useEffect(() => {
    if (!current) return
    let stale = false
    void (async () => {
      try {
        if (tab === 'resources') {
          const { resources } = await window.wraith.mcpResources(current.name)
          if (!stale) setTabContent(c => ({ ...c, resources }))
        } else if (tab === 'prompts') {
          const { text } = await window.wraith.mcpPrompts(current.name)
          if (!stale) setTabContent(c => ({ ...c, prompts: text }))
        } else if (tab === 'logs') {
          const { lines } = await window.wraith.mcpLogs(current.name)
          if (!stale) setTabContent(c => ({ ...c, logs: lines }))
        }
      } catch (err) {
        console.error('[wraith] mcp tab fetch error:', err)
      }
    })()
    return () => { stale = true }
  }, [current?.name, current?.state, tab])

  useEffect(() => { setConfirmingRemove(false); setFormMode('hidden') }, [current?.name])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="plugins-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="text-sm font-bold text-fg">插件</span>
        <span className="text-xs text-fg-subtle">MCP servers</span>
      </div>

      {configError && (
        <div className="border-b border-border bg-danger/10 px-4 py-2 text-xs text-danger">
          配置文件解析失败:{configError}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 左列 */}
        <div className="flex w-56 shrink-0 flex-col border-r border-border">
          <div className="flex-1 overflow-y-auto p-2">
            {servers.length === 0 && (
              <div className="px-2 py-3 text-xs text-fg-subtle">还没有 MCP server</div>
            )}
            {servers.map(s => (
              <button key={s.name} data-testid="mcp-server-item"
                onClick={() => { setSelected(s.name); setTab('tools') }}
                className={'mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ' +
                  (current?.name === s.name ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>
                <span className={'h-2 w-2 shrink-0 rounded-full ' + (STATE_DOT[s.state] ?? 'bg-fg-subtle')} />
                <span className="truncate">{s.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-fg-subtle">
                  {SCOPE_LABEL[s.scope]}{s.shadowed ? '·覆盖' : ''}
                </span>
              </button>
            ))}
          </div>
          <div className="border-t border-border p-2">
            <button data-testid="mcp-add" disabled={busy}
              onClick={() => { setFormMode('add'); setConfirmingRemove(false) }}
              className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60 disabled:opacity-60">
              ＋ 添加 server…
            </button>
          </div>
        </div>

        {/* 右详情 */}
        <div data-testid="mcp-detail" className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
          {formMode !== 'hidden' ? (
            <McpServerForm
              mode={formMode}
              initial={formMode === 'edit' && current ? current : null}
              busy={busy}
              onCancel={() => setFormMode('hidden')}
              onSubmit={async v => { const ok = await props.onSubmitForm(v); if (ok) setFormMode('hidden'); return ok }}
            />
          ) : !current ? (
            <div className="text-xs text-fg-subtle">选择左侧 server 查看详情</div>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-3">
                <span className={'h-2.5 w-2.5 rounded-full ' + (STATE_DOT[current.state] ?? '')} />
                <span className="text-sm font-bold text-fg">{current.name}</span>
                <span className="text-xs text-fg-subtle">{STATE_LABEL[current.state]} · {current.transport} · {SCOPE_LABEL[current.scope]}</span>
              </div>
              {current.error && (
                <div className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{current.error}</div>
              )}
              <div className="mb-4 flex items-center gap-2">
                <button data-testid="mcp-toggle" disabled={busy}
                  onClick={() => props.onToggle(current.name, !current.enabled)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-60">
                  {current.enabled ? '停用' : '启用'}
                </button>
                <button data-testid="mcp-restart" disabled={busy || !current.enabled}
                  onClick={() => props.onRestart(current.name)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-60">
                  重启
                </button>
                {current.scope !== 'builtin' && (
                  <>
                    <button data-testid="mcp-edit" disabled={busy}
                      onClick={() => { setFormMode('edit'); setConfirmingRemove(false) }}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-60">
                      编辑
                    </button>
                    <button data-testid="mcp-remove" disabled={busy}
                      onClick={() => {
                        if (!confirmingRemove) { setConfirmingRemove(true); return }
                        setConfirmingRemove(false)
                        props.onRemove(current.scope as 'user' | 'project', current.name)
                      }}
                      onBlur={() => setConfirmingRemove(false)}
                      className={'rounded-lg border px-3 py-1.5 text-xs disabled:opacity-60 ' +
                        (confirmingRemove ? 'border-danger text-danger' : 'border-border text-fg-muted hover:text-danger')}>
                      {confirmingRemove ? '确认删除?' : '删除'}
                    </button>
                  </>
                )}
              </div>

              <div className="mb-2 flex gap-1 border-b border-border">
                {(['tools', 'resources', 'prompts', 'logs'] as Tab[]).map(t => (
                  <button key={t} data-testid={`mcp-tab-${t}`} onClick={() => setTab(t)}
                    className={'px-3 py-1.5 text-xs ' + (tab === t ? 'border-b-2 border-accent text-fg' : 'text-fg-muted')}>
                    {t === 'tools' ? `工具(${current.tools.length})` : t === 'resources' ? '资源' : t === 'prompts' ? '提示词' : '日志'}
                  </button>
                ))}
              </div>

              {tab === 'tools' && (
                <div className="flex flex-col gap-1">
                  {current.tools.length === 0 && <div className="text-xs text-fg-subtle">无工具(未就绪或空)</div>}
                  {current.tools.map(t => (
                    <div key={t.name} className="rounded-lg bg-surface/60 px-3 py-2">
                      <div className="font-mono text-xs text-fg">{t.name}</div>
                      {t.description && <div className="mt-0.5 text-xs text-fg-muted">{t.description}</div>}
                    </div>
                  ))}
                </div>
              )}
              {tab === 'resources' && (
                <div className="flex flex-col gap-1">
                  {tabContent.resources.length === 0 && <div className="text-xs text-fg-subtle">无资源</div>}
                  {tabContent.resources.map(r => (
                    <div key={r.uri} className="rounded-lg bg-surface/60 px-3 py-2">
                      <div className="font-mono text-xs text-fg">{r.uri}</div>
                      <div className="mt-0.5 text-xs text-fg-muted">{r.name}{r.description ? ` — ${r.description}` : ''}</div>
                    </div>
                  ))}
                </div>
              )}
              {tab === 'prompts' && (
                <pre className="whitespace-pre-wrap rounded-lg bg-surface/60 p-3 text-xs text-fg-muted">{tabContent.prompts || '无提示词'}</pre>
              )}
              {tab === 'logs' && (
                <>
                  <button onClick={() => setTab('logs')} className="mb-1 self-start rounded px-2 py-1 text-[11px] text-fg-subtle hover:text-accent"
                    data-testid="mcp-logs-refresh"
                    onMouseDown={async () => {
                      try { const { lines } = await window.wraith.mcpLogs(current.name); setTabContent(c => ({ ...c, logs: lines })) }
                      catch (err) { console.error('[wraith] mcp logs refresh error:', err) }
                    }}>
                    ⟳ 刷新
                  </button>
                  <pre className="whitespace-pre-wrap rounded-lg bg-black/[0.04] p-3 font-mono text-[11px] text-fg-muted">{tabContent.logs || '(空)'}</pre>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
```

本任务先建 `McpServerForm.tsx` 的**最小占位**(Task 9 实装,同文件同 props,避免编译断链):

```tsx
export interface McpFormValue {
  scope: 'user' | 'project'
  name: string
  command: string
  args: string[]
  env: Record<string, string>
}
interface McpServerFormProps {
  mode: 'add' | 'edit'
  initial: import('../../shared/types').McpServerView | null
  busy: boolean
  onCancel: () => void
  onSubmit: (v: McpFormValue) => Promise<boolean>
}
export default function McpServerForm(_props: McpServerFormProps): JSX.Element {
  return <div data-testid="mcp-form" className="text-xs text-fg-subtle">表单(Task 9 实装)</div>
}
```

- [ ] **Step 2: Sidebar.tsx**

Props += `activeNav: 'plugins' | null` 与 `onOpenPlugins: () => void`。NAV 渲染改:`plugins` 项去掉 `disabled`,
`onClick={onOpenPlugins}`,className 按 `activeNav === 'plugins'` 高亮(`bg-surface text-fg`);其余项保持禁用;
`automation` 的 hint 改 `'自动化在 Phase E-2'`。**启用的 `plugins` 项不再包 Tooltip**(直接渲染 button,占位 hint 已无意义);
禁用项保持 Tooltip 包裹不变。

- [ ] **Step 3: App.tsx**

1. 状态(projects 州附近):

```ts
const [view, setView] = useState<'chat' | 'plugins'>('chat')
const [mcpServers, setMcpServers] = useState<McpServerView[]>([])
const [mcpConfigError, setMcpConfigError] = useState<string | null>(null)
```

2. `fetchMcp` callback(fetchProjects 之后):

```ts
const fetchMcp = useCallback(async () => {
  try {
    const r = await window.wraith.mcpList()
    setMcpServers(r.servers)
    setMcpConfigError(r.configError ?? null)
  } catch (err) {
    console.error('[wraith] mcpList error:', err)
  }
}, [])
```

3. onEvent 订阅 effect 里,`status` 节流分支之前插 mcp.status 分流(不进 reducer):

```ts
if (evt.kind === 'notification' && evt.method === 'mcp.status') {
  const p = evt.params as { name: string; state: McpServerView['state']; error?: string }
  setMcpServers(prev => prev.map(s => (s.name === p.name ? { ...s, state: p.state, enabled: p.state !== 'disabled', error: p.error } : s)))
  return
}
```

4. 启动 effect `void fetchProjects()` 后加 `void fetchMcp()`(deps 数组加 `fetchMcp`);
   `switchToProject` 成功路径的 `void fetchProjects()` 旁也加 `void fetchMcp()`(切项目=MCP 重建)。
5. 操作回调(handleRenameProject 之后):

```ts
const handleMcpToggle = useCallback(async (name: string, enable: boolean) => {
  try { await (enable ? window.wraith.mcpEnable(name) : window.wraith.mcpDisable(name)); void fetchMcp() }
  catch (err) { console.error('[wraith] mcp toggle error:', err) }
}, [fetchMcp])

const handleMcpRestart = useCallback(async (name: string) => {
  try { await window.wraith.mcpRestart(name); void fetchMcp() }
  catch (err) { console.error('[wraith] mcp restart error:', err) }
}, [fetchMcp])

const handleMcpRemove = useCallback(async (scope: 'user' | 'project', name: string) => {
  try { await window.wraith.mcpConfigRemove(scope, name); void fetchMcp() }
  catch (err) { console.error('[wraith] mcp remove error:', err) }
}, [fetchMcp])

const handleMcpSubmitForm = useCallback(async (v: McpFormValue): Promise<boolean> => {
  try { await window.wraith.mcpConfigUpsert(v); void fetchMcp(); return true }
  catch (err) { console.error('[wraith] mcp upsert error:', err); return false }
}, [fetchMcp])
```

(import `McpFormValue` type 自 `./components/McpServerForm`,`McpServerView` 自 shared/types。)

6. JSX:Sidebar 传 `activeNav={view === 'plugins' ? 'plugins' : null}` 与 `onOpenPlugins={() => setView('plugins')}`;
   主列内容改为:

```tsx
{view === 'plugins' ? (
  <PluginsPanel
    servers={mcpServers}
    configError={mcpConfigError}
    busy={state.turn === 'running'}
    onBack={() => setView('chat')}
    onRefresh={fetchMcp}
    onToggle={handleMcpToggle}
    onRestart={handleMcpRestart}
    onRemove={handleMcpRemove}
    onSubmitForm={handleMcpSubmitForm}
  />
) : (
  /* 既有 welcome ↔ transcript+composer 条件块整体原样嵌此 else */
)}
```

- [ ] **Step 4: 门禁** — Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx tsc --noEmit -p tsconfig.json && npx vitest run 2>&1 | tail -2 && npm run build > /dev/null && echo BUILD_OK`。Expected: 三绿。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/components/PluginsPanel.tsx desktop/src/renderer/components/McpServerForm.tsx desktop/src/renderer/components/Sidebar.tsx desktop/src/renderer/App.tsx
git commit -m "feat(desktop): 插件整页面板(列表/详情/四tab只读)+ 视图切换 + mcp.status 分流"
```

---

### Task 9: McpServerForm 实装(env 脱敏)

**Files:**
- Modify: `desktop/src/renderer/components/McpServerForm.tsx`(替换占位)
- Test: `desktop/test/mcpFormValue.test.ts`(新,纯函数)

**Interfaces:**
- Consumes: Task 8 的 `McpFormValue`/props 契约(不变)。
- Produces: `desktop/src/shared/mcpFormValue.ts`:
  `export function buildFormValue(mode, initial, fields): McpFormValue`(见下)——env 空值语义的纯函数落点。

- [ ] **Step 1: 写失败测试**(`desktop/test/mcpFormValue.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { buildFormValue, envRowsFromKeys, type EnvRow } from '../src/shared/mcpFormValue'

describe('mcpFormValue', () => {
  it('envRowsFromKeys 用占位空值回填既有 key', () => {
    expect(envRowsFromKeys(['B', 'A'])).toEqual([
      { key: 'B', value: '' },
      { key: 'A', value: '' },
    ])
  })

  it('buildFormValue 组装 payload:空值 env 保留(交给后端语义),空 key 行丢弃', () => {
    const rows: EnvRow[] = [
      { key: 'TOKEN', value: '' },      // 编辑态未动 → 空串=后端保留现值
      { key: 'NEW', value: 'nv' },
      { key: '', value: 'ignored' },    // 空 key 丢弃
    ]
    const v = buildFormValue('project', 'srv', ' npx ', ' -y \n pkg \n\n', rows)
    expect(v).toEqual({
      scope: 'project', name: 'srv', command: 'npx',
      args: ['-y', 'pkg'], env: { TOKEN: '', NEW: 'nv' },
    })
  })

  it('args 按行拆分并去空白行', () => {
    expect(buildFormValue('user', 'n', 'c', '', []).args).toEqual([])
  })
})
```

- [ ] **Step 2: 确认失败** — Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/mcpFormValue.test.ts`。Expected: 模块不存在。

- [ ] **Step 3: 实现**

`desktop/src/shared/mcpFormValue.ts`:

```ts
import type { McpFormValue } from '../renderer/components/McpServerForm'

export interface EnvRow { key: string; value: string }

/** 编辑态回填:后端只回 envKeys,值以空串占位(空串=提交时保留现值)。 */
export function envRowsFromKeys(envKeys: string[]): EnvRow[] {
  return envKeys.map(key => ({ key, value: '' }))
}

/** args 文本域按行拆、trim、去空行;env 空 key 行丢弃、空 value 原样传(后端语义:保留现值)。 */
export function buildFormValue(
  scope: 'user' | 'project', name: string, command: string, argsText: string, envRows: EnvRow[],
): McpFormValue {
  const env: Record<string, string> = {}
  for (const r of envRows) {
    const k = r.key.trim()
    if (k) env[k] = r.value
  }
  return {
    scope, name: name.trim(), command: command.trim(),
    args: argsText.split('\n').map(s => s.trim()).filter(Boolean),
    env,
  }
}
```

(注意:type-only 跨层 import 是合法的既有先例——settings.ts import shared/types;若 tsconfig 路径不允许 renderer←shared 反向,
把 `McpFormValue` 类型定义移到 `shared/mcpFormValue.ts` 并让组件 re-export,契约不变。)

`McpServerForm.tsx` 完整实装(替换占位;`data-testid`:`mcp-form`、`mcp-form-name`、`mcp-form-command`、
`mcp-form-args`、`mcp-form-env-key`/`mcp-form-env-value`(每行)、`mcp-form-env-add`、`mcp-form-scope-user`/`mcp-form-scope-project`、
`mcp-form-submit`、`mcp-form-cancel`):

```tsx
import { useState } from 'react'
import type { McpServerView } from '../../shared/types'
import { buildFormValue, envRowsFromKeys, type EnvRow } from '../../shared/mcpFormValue'

export interface McpFormValue {
  scope: 'user' | 'project'
  name: string
  command: string
  args: string[]
  env: Record<string, string>
}

interface McpServerFormProps {
  mode: 'add' | 'edit'
  initial: McpServerView | null
  busy: boolean
  onCancel: () => void
  onSubmit: (v: McpFormValue) => Promise<boolean>
}

export default function McpServerForm({ mode, initial, busy, onCancel, onSubmit }: McpServerFormProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [scope, setScope] = useState<'user' | 'project'>(initial && initial.scope !== 'builtin' ? initial.scope : 'user')
  const [envRows, setEnvRows] = useState<EnvRow[]>(initial ? envRowsFromKeys(initial.envKeys) : [])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setRow = (i: number, patch: Partial<EnvRow>): void =>
    setEnvRows(rows => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const handleSubmit = async (): Promise<void> => {
    const v = buildFormValue(scope, name, command, argsText, envRows)
    if (!v.name || !v.command) { setError('name 与 command 必填'); return }
    setSubmitting(true); setError(null)
    const ok = await onSubmit(v)
    setSubmitting(false)
    if (!ok) setError('保存失败,查看控制台')
  }

  return (
    <div data-testid="mcp-form" className="flex max-w-xl flex-col gap-3">
      <div className="text-sm font-bold text-fg">{mode === 'add' ? '添加 MCP server' : `编辑 ${initial?.name}`}</div>

      <label className="text-xs text-fg-muted">名称
        <input data-testid="mcp-form-name" value={name} disabled={mode === 'edit'}
          onChange={e => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg outline-none focus:border-accent disabled:opacity-60" />
      </label>

      <label className="text-xs text-fg-muted">命令(stdio)
        <input data-testid="mcp-form-command" value={command} placeholder="npx"
          onChange={e => setCommand(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent" />
      </label>

      <label className="text-xs text-fg-muted">参数(每行一个)
        <textarea data-testid="mcp-form-args" value={argsText} rows={3}
          onChange={e => setArgsText(e.target.value)}
          className="mt-1 w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent" />
      </label>

      <div className="text-xs text-fg-muted">
        环境变量 <span className="text-fg-subtle">(值留空 = 保留原值,不回显密钥)</span>
        {envRows.map((r, i) => (
          <div key={i} className="mt-1 flex gap-2">
            <input data-testid="mcp-form-env-key" value={r.key} placeholder="KEY"
              onChange={e => setRow(i, { key: e.target.value })}
              className="w-40 rounded-lg border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent" />
            <input data-testid="mcp-form-env-value" type="password" value={r.value} placeholder="••••(留空保留)"
              onChange={e => setRow(i, { value: e.target.value })}
              className="flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent" />
          </div>
        ))}
        <button data-testid="mcp-form-env-add" onClick={() => setEnvRows(rows => [...rows, { key: '', value: '' }])}
          className="mt-1 rounded px-2 py-1 text-[11px] text-fg-subtle hover:text-accent">＋ 加一行</button>
      </div>

      <div className="flex items-center gap-4 text-xs text-fg-muted">
        作用域:
        <label className="flex items-center gap-1">
          <input data-testid="mcp-form-scope-user" type="radio" checked={scope === 'user'} onChange={() => setScope('user')} disabled={mode === 'edit'} />
          用户级(所有项目)
        </label>
        <label className="flex items-center gap-1">
          <input data-testid="mcp-form-scope-project" type="radio" checked={scope === 'project'} onChange={() => setScope('project')} disabled={mode === 'edit'} />
          本项目
        </label>
      </div>

      {error && <div className="text-xs text-danger">{error}</div>}

      <div className="flex gap-2">
        <button data-testid="mcp-form-submit" disabled={busy || submitting} onClick={() => void handleSubmit()}
          className="rounded-lg bg-accent px-4 py-2 text-xs text-white disabled:opacity-60">
          {submitting ? '保存中…' : '保存'}
        </button>
        <button data-testid="mcp-form-cancel" onClick={onCancel}
          className="rounded-lg border border-border px-4 py-2 text-xs text-fg-muted">取消</button>
      </div>
    </div>
  )
}
```

(编辑态 name/scope 只读:改名/迁移作用域 = 删旧加新,v1 不做,避免孤儿进程语义。)

- [ ] **Step 4: 门禁** — Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx tsc --noEmit -p tsconfig.json && npx vitest run 2>&1 | tail -2`。Expected: tsc 0 错、vitest 105(102+3)。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/components/McpServerForm.tsx desktop/src/shared/mcpFormValue.ts desktop/test/mcpFormValue.test.ts
git commit -m "feat(desktop): MCP server 配置表单(env 密钥不回显/留空保留,作用域选择)"
```

---

### Task 10: Composer @-mention 补全

**Files:**
- Create: `desktop/src/shared/mentionTrigger.ts`
- Test: `desktop/test/mentionTrigger.test.ts`(新)
- Modify: `desktop/src/renderer/components/Composer.tsx`
- Modify: `desktop/src/renderer/App.tsx`(resources 缓存 + Composer 传参)

**Interfaces:**
- Consumes: Task 7 `mcpResources`、`McpResourceView`;既有 `shouldSendOnEnter`(IME 语义参照)。
- Produces:

```ts
// shared/mentionTrigger.ts
export interface MentionState { active: boolean; start: number; query: string }
export function detectMention(value: string, caret: number): MentionState
export function filterMentionItems(resources: McpResourceView[], query: string): MentionItem[]
export interface MentionItem { label: string; insert: string; hint: string }
export function insertMention(value: string, state: MentionState, insert: string): { next: string; caret: number }
```

- [ ] **Step 1: 写失败测试**(`desktop/test/mentionTrigger.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { detectMention, filterMentionItems, insertMention } from '../src/shared/mentionTrigger'
import type { McpResourceView } from '../src/shared/types'

const RES: McpResourceView[] = [
  { server: 'github', uri: 'issue://1', name: 'Issue 1' },
  { server: 'github', uri: 'pr://2', name: 'PR 2', description: 'desc' },
  { server: 'fs', uri: 'file:///a.txt', name: 'a.txt' },
]

describe('detectMention', () => {
  it('行首/空白后的 @ 激活,取 @ 到光标为 query', () => {
    expect(detectMention('@gi', 3)).toEqual({ active: true, start: 0, query: 'gi' })
    expect(detectMention('查 @github:is 的', 13)).toEqual({ active: true, start: 2, query: 'github:is' })
  })
  it('非空白前缀的 @ 不激活(邮箱等)', () => {
    expect(detectMention('a@b', 3).active).toBe(false)
  })
  it('query 含空白即失活', () => {
    expect(detectMention('@gi hub', 7).active).toBe(false)
  })
  it('无 @ 不激活', () => {
    expect(detectMention('hello', 5).active).toBe(false)
  })
})

describe('filterMentionItems', () => {
  it('无冒号:按前缀滤 server,一级列表(去重)', () => {
    const items = filterMentionItems(RES, 'gi')
    expect(items).toHaveLength(1)
    expect(items[0]!.insert).toBe('@github:')
    expect(items[0]!.label).toBe('github')
  })
  it('有冒号:列该 server 的资源,按 uri/name 前缀滤', () => {
    const items = filterMentionItems(RES, 'github:is')
    expect(items).toHaveLength(1)
    expect(items[0]!.insert).toBe('@github:issue://1 ')
  })
  it('空 query 列全部 server', () => {
    expect(filterMentionItems(RES, '').map(i => i.label)).toEqual(['github', 'fs'])
  })
})

describe('insertMention', () => {
  it('替换 @..光标 段为 insert,光标落在其后', () => {
    const r = insertMention('查 @github:is 的', { active: true, start: 2, query: 'github:is' }, '@github:issue://1 ')
    expect(r.next).toBe('查 @github:issue://1  的')
    expect(r.caret).toBe(2 + '@github:issue://1 '.length)
  })
})
```

- [ ] **Step 2: 确认失败** — Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/mentionTrigger.test.ts`。Expected: 模块不存在。

- [ ] **Step 3: 实现 `shared/mentionTrigger.ts`**

```ts
import type { McpResourceView } from './types'

export interface MentionState { active: boolean; start: number; query: string }
export interface MentionItem { label: string; insert: string; hint: string }

/** 光标前最近 @:其前一字符须为行首/空白,@..光标 间不得含空白。 */
export function detectMention(value: string, caret: number): MentionState {
  const upto = value.slice(0, caret)
  const at = upto.lastIndexOf('@')
  if (at < 0) return { active: false, start: 0, query: '' }
  if (at > 0 && !/\s/.test(upto[at - 1]!)) return { active: false, start: 0, query: '' }
  const query = upto.slice(at + 1)
  if (/\s/.test(query)) return { active: false, start: 0, query: '' }
  return { active: true, start: at, query }
}

/** 两级:query 无冒号 → server 一级(前缀滤+去重);有冒号 → 该 server 资源(uri/name 前缀滤)。 */
export function filterMentionItems(resources: McpResourceView[], query: string): MentionItem[] {
  const colon = query.indexOf(':')
  if (colon < 0) {
    const seen = new Set<string>()
    const out: MentionItem[] = []
    for (const r of resources) {
      if (!r.server.startsWith(query) || seen.has(r.server)) continue
      seen.add(r.server)
      out.push({ label: r.server, insert: `@${r.server}:`, hint: 'server' })
    }
    return out
  }
  const server = query.slice(0, colon)
  const rest = query.slice(colon + 1)
  return resources
    .filter(r => r.server === server && (r.uri.startsWith(rest) || r.name.startsWith(rest)))
    .map(r => ({ label: r.uri, insert: `@${r.server}:${r.uri} `, hint: r.description ? `${r.name} — ${r.description}` : r.name }))
}

export function insertMention(value: string, state: MentionState, insert: string): { next: string; caret: number } {
  const before = value.slice(0, state.start)
  const after = value.slice(state.start + 1 + state.query.length)
  return { next: before + insert + after, caret: before.length + insert.length }
}
```

- [ ] **Step 4: Composer.tsx 集成**

Props += `resources: McpResourceView[]`。组件内:

```ts
const [mention, setMention] = useState<MentionState>({ active: false, start: 0, query: '' })
const [mentionIndex, setMentionIndex] = useState(0)
const textareaRef = useRef<HTMLTextAreaElement>(null)
const items = mention.active ? filterMentionItems(resources, mention.query) : []
const popoverOpen = mention.active && items.length > 0
```

`onChange` 里(setValue 后):`setMention(detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length)); setMentionIndex(0)`。

`handleKeyDown` 开头插补全拦截(**先于** shouldSendOnEnter 判断;IME 约束同款——`e.nativeEvent.isComposing || e.keyCode === 229` 时一律不拦截、不选中):

```ts
if (popoverOpen && !e.nativeEvent.isComposing && e.keyCode !== 229) {
  if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => (i + 1) % items.length); return }
  if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i - 1 + items.length) % items.length); return }
  if (e.key === 'Escape') { e.preventDefault(); setMention({ active: false, start: 0, query: '' }); return }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    const it = items[mentionIndex]
    if (it) {
      const r = insertMention(value, mention, it.insert)
      onChange(r.next)
      setMention(detectMention(r.next, r.caret))
      // 光标复位到插入点后
      requestAnimationFrame(() => textareaRef.current?.setSelectionRange(r.caret, r.caret))
    }
    return
  }
}
```

textarea 加 `ref={textareaRef}`。浮层(anchor 到既有 rounded-2xl 外壳 div,壳加 `relative`):

```tsx
{popoverOpen && (
  <div data-testid="mention-popover"
    className="absolute bottom-full left-3 z-40 mb-1 max-h-56 w-96 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-md">
    {items.map((it, i) => (
      <button key={it.insert} data-testid="mention-item"
        onMouseDown={e => {
          e.preventDefault() // 不丢 textarea 焦点
          const r = insertMention(value, mention, it.insert)
          onChange(r.next)
          setMention(detectMention(r.next, r.caret))
          requestAnimationFrame(() => textareaRef.current?.setSelectionRange(r.caret, r.caret))
        }}
        className={'flex w-full flex-col rounded-md px-2 py-1.5 text-left ' + (i === mentionIndex ? 'bg-bg' : 'hover:bg-bg/60')}>
        <span className="font-mono text-xs text-fg">{it.label}</span>
        <span className="text-[11px] text-fg-subtle">{it.hint}</span>
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 5: App.tsx 传数据**

```ts
const [mcpResources, setMcpResources] = useState<McpResourceView[]>([])
const fetchMcpResources = useCallback(async () => {
  try { const { resources } = await window.wraith.mcpResources(); setMcpResources(resources) }
  catch (err) { console.error('[wraith] mcpResources error:', err) }
}, [])
```

- 启动 effect `void fetchMcp()` 后加 `void fetchMcpResources()`(deps 同步);
- mcp.status 分流分支里,`p.state === 'ready'` 时追加 `void fetchMcpResources()`;
- `switchToProject` 成功路径同样追加;
- Composer JSX 加 `resources={mcpResources}`。

- [ ] **Step 6: 门禁** — Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx tsc --noEmit -p tsconfig.json && npx vitest run 2>&1 | tail -2 && npm run build > /dev/null && echo BUILD_OK`。Expected: 三绿,vitest 113(105+8)。

- [ ] **Step 7: Commit**

```bash
git add desktop/src/shared/mentionTrigger.ts desktop/test/mentionTrigger.test.ts desktop/src/renderer/components/Composer.tsx desktop/src/renderer/App.tsx
git commit -m "feat(desktop): Composer @-mention 两级补全(server→资源,IME 防误触,原文提交)"
```

---

### Task 11: mock MCP fixtures + E2E T26–T32

**Files:**
- Modify: `desktop/test/fixtures/mock-appserver.mjs`
- Modify: `desktop/test/e2e/shell.e2e.ts`

**Interfaces:**
- Consumes: Task 7-10 的 testid 与 IPC;mock 既有 `reply/notify/delay` helper、`WRAITH_E2E_RECORD` 全量请求记录、`MOCK_SLOW_TURN`。
- Produces: env `MOCK_MCP`(JSON:`{servers:[McpServerView…], resources:[McpResourceView…], statusScript:[{afterMs,name,state,error?}…]}`;未设时 `mcp.list` 返回 `{servers:[]}`,其余 mcp.* 返回 ok/空)。

- [ ] **Step 1: mock-appserver.mjs**

状态区加:

```js
const mockMcp = (() => {
  try { return process.env['MOCK_MCP'] ? JSON.parse(process.env['MOCK_MCP']) : null } catch { return null }
})()
let mcpServers = mockMcp && Array.isArray(mockMcp.servers) ? JSON.parse(JSON.stringify(mockMcp.servers)) : []
```

`case 'session.start'` 的 reply 后追加状态脚本调度:

```js
      if (mockMcp && Array.isArray(mockMcp.statusScript)) {
        for (const step of mockMcp.statusScript) {
          setTimeout(() => {
            const s = mcpServers.find(x => x.name === step.name)
            if (s) { s.state = step.state; s.enabled = step.state !== 'disabled'; if (step.error) s.error = step.error }
            notify('mcp.status', { sessionId, name: step.name, state: step.state, ...(step.error ? { error: step.error } : {}) })
          }, step.afterMs)
        }
      }
```

switch 追加(`session.rewind` case 之后):

```js
    case 'mcp.list': {
      reply(id, { servers: mcpServers })
      break
    }
    case 'mcp.enable':
    case 'mcp.disable': {
      const s = mcpServers.find(x => x.name === (params && params.name))
      if (s) { s.enabled = method === 'mcp.enable'; s.state = s.enabled ? 'ready' : 'disabled' }
      reply(id, { ok: true })
      break
    }
    case 'mcp.restart': {
      reply(id, { ok: true })
      break
    }
    case 'mcp.logs': {
      reply(id, { lines: '[mock] line1\n[mock] line2' })
      break
    }
    case 'mcp.resources': {
      const all = (mockMcp && mockMcp.resources) || []
      reply(id, { resources: params && params.name ? all.filter(r => r.server === params.name) : all })
      break
    }
    case 'mcp.prompts': {
      reply(id, { text: '[mock] prompt 列表文本' })
      break
    }
    case 'mcp.config.upsert': {
      const p = params || {}
      const existing = mcpServers.find(x => x.name === p.name)
      if (!existing) mcpServers.push({ name: p.name, state: 'starting', scope: p.scope, enabled: true, shadowed: false, transport: 'stdio', tools: [], envKeys: Object.keys(p.env || {}) })
      reply(id, { ok: true })
      break
    }
    case 'mcp.config.remove': {
      mcpServers = mcpServers.filter(x => x.name !== (params && params.name))
      reply(id, { ok: true })
      break
    }
```

- [ ] **Step 2: E2E 用例**(追加到 shell.e2e.ts 尾;`MCP_FIXTURE` 常量放新用例段顶部)

```ts
// ---------------------------------------------------------------------------
// Phase E-1: MCP 插件面板 + @-mention(T26–T32)
// ---------------------------------------------------------------------------

const MCP_FIXTURE = JSON.stringify({
  servers: [
    { name: 'github', state: 'starting', scope: 'user', enabled: true, shadowed: false, transport: 'stdio',
      tools: [{ name: 'get_issue', description: '读 issue' }], envKeys: ['GITHUB_TOKEN'] },
    { name: 'fs', state: 'ready', scope: 'project', enabled: true, shadowed: true, transport: 'stdio', tools: [], envKeys: [] },
  ],
  resources: [
    { server: 'github', uri: 'issue://1', name: 'Issue 1' },
    { server: 'fs', uri: 'file:///a.txt', name: 'a.txt' },
  ],
  statusScript: [{ afterMs: 500, name: 'github', state: 'ready' }],
})

async function launchMcpApp(extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; win: Page; recordFile: string; cleanup: () => void }> {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-mcp.jsonl`)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-mcp-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile,
      WRAITH_E2E_USERDATA: userData,
      MOCK_MCP: MCP_FIXTURE,
      ...extraEnv,
    },
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })
  return { app, win, recordFile, cleanup: () => { fs.rmSync(recordFile, { force: true }); fs.rmSync(userData, { recursive: true, force: true }) } }
}

function recordedMethods(recordFile: string): string[] {
  if (!fs.existsSync(recordFile)) return []
  return fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).method as string)
}

test('T26 插件面板:列表/状态点变迁(starting→ready 通知驱动)', async () => {
  const { app, win, cleanup } = await launchMcpApp()
  await win.locator('[data-testid="nav-plugins"]').click()
  const items = win.locator('[data-testid="mcp-server-item"]')
  await expect(items).toHaveCount(2)
  await expect(items.filter({ hasText: 'github' })).toBeVisible()
  // statusScript 500ms 后 github → ready:详情区状态文本变化
  await items.filter({ hasText: 'github' }).click()
  await expect(win.locator('[data-testid="mcp-detail"]')).toContainText('就绪', { timeout: 5000 })
  // 工具 tab 默认可见 get_issue
  await expect(win.locator('[data-testid="mcp-detail"]')).toContainText('get_issue')
  await app.close(); cleanup()
})

test('T27 添加表单 → mcp.config.upsert 请求', async () => {
  const { app, win, recordFile, cleanup } = await launchMcpApp()
  await win.locator('[data-testid="nav-plugins"]').click()
  await win.locator('[data-testid="mcp-add"]').click()
  await win.locator('[data-testid="mcp-form-name"]').fill('sqlite')
  await win.locator('[data-testid="mcp-form-command"]').fill('npx')
  await win.locator('[data-testid="mcp-form-args"]').fill('-y\nmcp-sqlite')
  await win.locator('[data-testid="mcp-form-scope-project"]').check()
  await win.locator('[data-testid="mcp-form-submit"]').click()
  await expect.poll(() => recordedMethods(recordFile).includes('mcp.config.upsert'), { timeout: 5000 }).toBe(true)
  await expect(win.locator('[data-testid="mcp-server-item"]')).toHaveCount(3, { timeout: 5000 })
  await app.close(); cleanup()
})

test('T28 启停与重启请求', async () => {
  const { app, win, recordFile, cleanup } = await launchMcpApp()
  await win.locator('[data-testid="nav-plugins"]').click()
  await win.locator('[data-testid="mcp-server-item"]').filter({ hasText: 'fs' }).click()
  await win.locator('[data-testid="mcp-toggle"]').click() // fs enabled → 停用
  await expect.poll(() => recordedMethods(recordFile).includes('mcp.disable'), { timeout: 5000 }).toBe(true)
  await expect(win.locator('[data-testid="mcp-toggle"]')).toHaveText('启用', { timeout: 5000 })
  await win.locator('[data-testid="mcp-toggle"]').click()
  await expect.poll(() => recordedMethods(recordFile).includes('mcp.enable'), { timeout: 5000 }).toBe(true)
  await win.locator('[data-testid="mcp-restart"]').click()
  await expect.poll(() => recordedMethods(recordFile).includes('mcp.restart'), { timeout: 5000 }).toBe(true)
  await app.close(); cleanup()
})

test('T29 删除二次确认', async () => {
  const { app, win, recordFile, cleanup } = await launchMcpApp()
  await win.locator('[data-testid="nav-plugins"]').click()
  await win.locator('[data-testid="mcp-server-item"]').filter({ hasText: 'github' }).click()
  await win.locator('[data-testid="mcp-remove"]').click() // 第一次:确认态
  expect(recordedMethods(recordFile).includes('mcp.config.remove')).toBe(false)
  await expect(win.locator('[data-testid="mcp-remove"]')).toHaveText('确认删除?')
  await win.locator('[data-testid="mcp-remove"]').click() // 第二次:生效
  await expect.poll(() => recordedMethods(recordFile).includes('mcp.config.remove'), { timeout: 5000 }).toBe(true)
  await expect(win.locator('[data-testid="mcp-server-item"]')).toHaveCount(1, { timeout: 5000 })
  await app.close(); cleanup()
})

test('T30 日志 tab 内容', async () => {
  const { app, win, cleanup } = await launchMcpApp()
  await win.locator('[data-testid="nav-plugins"]').click()
  await win.locator('[data-testid="mcp-server-item"]').filter({ hasText: 'github' }).click()
  await win.locator('[data-testid="mcp-tab-logs"]').click()
  await expect(win.locator('[data-testid="mcp-detail"]')).toContainText('[mock] line1', { timeout: 5000 })
  await app.close(); cleanup()
})

test('T31 @-mention 两级补全,原文提交', async () => {
  const { app, win, recordFile, cleanup } = await launchMcpApp()
  const input = win.locator('[data-testid="input"]')
  await input.click()
  await input.type('看下 @')
  await expect(win.locator('[data-testid="mention-popover"]')).toBeVisible({ timeout: 5000 })
  await win.locator('[data-testid="mention-item"]').filter({ hasText: 'github' }).click() // 一级:server
  await expect(win.locator('[data-testid="mention-item"]').filter({ hasText: 'issue://1' })).toBeVisible()
  await win.locator('[data-testid="mention-item"]').filter({ hasText: 'issue://1' }).click() // 二级:资源
  await expect(input).toHaveValue(/@github:issue:\/\/1 /)
  await input.press('Enter')
  await expect
    .poll(() => {
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      return lines.some(l => l.method === 'turn.submit' && typeof l.params?.input === 'string' && l.params.input.includes('@github:issue://1'))
    }, { timeout: 10000 })
    .toBe(true)
  await app.close(); cleanup()
})

test('T32 运行中工具集变更操作禁用', async () => {
  const { app, win, cleanup } = await launchMcpApp({ MOCK_SLOW_TURN: '1' })
  const input = win.locator('[data-testid="input"]')
  await input.fill('慢轮次')
  await input.press('Enter')
  await expect(win.locator('[data-testid="interrupt"]')).toBeVisible({ timeout: 10000 })
  await win.locator('[data-testid="nav-plugins"]').click()
  await win.locator('[data-testid="mcp-server-item"]').filter({ hasText: 'github' }).click()
  await expect(win.locator('[data-testid="mcp-toggle"]')).toBeDisabled()
  await expect(win.locator('[data-testid="mcp-remove"]')).toBeDisabled()
  await expect(win.locator('[data-testid="mcp-add"]')).toBeDisabled()
  await app.close(); cleanup()
})
```

注:文件顶部若无 `ElectronApplication/Page` 类型 import,helper 签名可退化为 `Promise<any>` 风格与既有用例一致——以文件现有写法为准,不引新依赖。`nav-plugins` 在旧用例中曾断言 disabled 的话同步适配(grep 确认)。

- [ ] **Step 3: 全量 E2E** — Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run e2e 2>&1 | tail -3`(timeout ≥ 420000ms)。Expected: 32 passed(25 旧 + 7 新)。

- [ ] **Step 4: Commit**

```bash
git add desktop/test/fixtures/mock-appserver.mjs desktop/test/e2e/shell.e2e.ts
git commit -m "test(desktop): E2E T26-T32 插件面板/@-mention + mock MCP fixtures(MOCK_MCP)"
```

---

### Task 12: ROADMAP 更新

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: 编辑**

1. 「已实现 ✅」表尾追加(数字以实测为准):

```markdown
| **Phase E-1** MCP 插件管理 | app-server 挂载 McpServerManager(按工作区复用+`reattach` 不搬审批状态);`mcp.*` 九路 RPC + `mcp.status` 通知(异步 startAll);整页插件面板(状态/启停/重启/日志/工具/资源/提示词 + 配置表单 env 不回显);Composer @-mention 两级补全(后端 AtMentionExpander 展开);树式 `McpConfigWriter`(保留未知字段) | Java 新测 ~20、vitest 113、Playwright 32/32;spec/plan `docs/*/2026-07-02-desktop-phase-e1-mcp*.md` |
```

2. 「进行中 🟡」改:`（无——Phase A、B、C、D、E-1 已合并 main。下一阶段 **Phase E-2**（自动化流程,需先头脑风暴)或 **Phase F**（打包)待启动。）`
3. 「未实现 ⬜」表:Phase E 行改为 `| **Phase E-2** 自动化流程 | 自动化流程(定义待头脑风暴) | 待定 | (新) |`。
4. 「待眼验」追加:`- **Phase E-1 新增**——真 MCP server(如 @modelcontextprotocol/server-filesystem)全链路:添加→ready→模型调用工具→审批弹窗→@-mention 展开;切项目后项目级 mcp.json 重载;「本会话放行」在新会话不残留(reattach 红线)。`
5. 「最后更新」日期核对为 `2026-07-02`。

- [ ] **Step 2: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): Phase E-1 MCP 插件管理标记已实现"
```

---

## 收尾(计划外置,执行技能接管)

全任务完成后:整支终审(最强模型;重点:reattach 审批红线、mcp.status 换绑竞态、真实引擎 API 名与计划假设的差异)
→ 一个修复 subagent → `mvn test -DskipTests=false` 全量(3F/38E 基线)+ vitest + E2E + tsc 全绿
→ merge --no-ff 回 main → push。真 MCP server 眼验按 ROADMAP 待眼验清单进行(重建 jar 需先征求同意——本期 Java 有实质改动)。
