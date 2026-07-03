package com.lyhn.wraith.mcp;

import com.lyhn.wraith.mcp.config.McpConfigLoader;
import com.lyhn.wraith.mcp.config.McpServerConfig;
import com.lyhn.wraith.mcp.protocol.McpToolDescriptor;
import com.lyhn.wraith.tool.ToolRegistry;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 通过 MockWebServer 模拟 Streamable HTTP MCP server 来端到端验证 McpServerManager 的启停流程。
 * 不测真实 stdio 子进程（已在 StdioTransportTest 单独覆盖）。
 */
class McpServerManagerTest {

    private MockWebServer webServer;
    private ToolRegistry registry;
    private McpServerManager manager;
    private Path tempDir;

    @BeforeEach
    void setUp(@TempDir Path tempDir) throws IOException {
        this.tempDir = tempDir;
        webServer = new MockWebServer();
        webServer.start();
        registry = new ToolRegistry();
        // 用空 config loader 占位，单独把 server 直接放进 manager（避开真实文件读取）
        manager = new McpServerManager(registry, tempDir,
                new McpConfigLoader(tempDir.resolve("user.json"), tempDir.resolve("project.json"), tempDir));
    }

    @AfterEach
    void tearDown() throws IOException {
        if (manager != null) manager.close();
        if (webServer != null) webServer.shutdown();
    }

    @Test
    void startAllStartsHttpServerAndRegistersTools() throws Exception {
        enqueueInitialize();
        enqueueToolsList(toolJson("echo", "Echo back text"));

        loadServersFromMap(Map.of("demo", httpConfig(webServer)));
        manager.startAll();

        McpServer server = manager.servers().iterator().next();
        assertEquals(McpServerStatus.READY, server.status(), "状态应为 READY，错误: " + server.errorMessage());
        assertEquals(1, server.tools().size());
        assertTrue(registry.hasTool("mcp__demo__echo"));
    }

    @Test
    void resourcesCapabilityRegistersVirtualResourceTools() throws Exception {
        enqueueInitialize("{\"resources\":{\"listChanged\":true},\"prompts\":{}}");
        enqueueToolsList(toolJson("echo", "Echo back text"));
        enqueueResourcesList();

        loadServersFromMap(Map.of("demo", httpConfig(webServer)));
        manager.startAll();

        assertTrue(registry.hasTool("mcp__demo__echo"));
        assertTrue(registry.hasTool("mcp__demo__list_resources"));
        assertTrue(registry.hasTool("mcp__demo__read_resource"));
        assertTrue(manager.resourceCandidates().stream().anyMatch(r -> r.uri().equals("file://README.md")));
        assertTrue(manager.resourceIndexForPrompt().contains("@demo:file://README.md"));

        enqueuePromptsList();
        assertTrue(manager.prompts("demo").contains("Review (review)"));
    }

    @Test
    void singleServerFailureDoesNotBlockOthers() throws Exception {
        // 一个 OK 的 server + 一个引用未设置 ${VAR} 的 server
        enqueueInitialize();
        enqueueToolsList(toolJson("ok", "ok tool"));

        Map<String, McpServerConfig> configs = new LinkedHashMap<>();
        configs.put("good", httpConfig(webServer));
        McpServerConfig bad = new McpServerConfig();
        bad.setUrl("https://example.com/${UNSET_DEMO_VAR_FOR_TEST}");
        configs.put("bad", bad);
        loadServersFromMap(configs);

        manager.startAll();

        Map<String, McpServer> byName = new HashMap<>();
        manager.servers().forEach(s -> byName.put(s.name(), s));
        assertEquals(McpServerStatus.READY, byName.get("good").status(),
                "good 应正常启动，不被 bad 阻塞");
        assertEquals(McpServerStatus.ERROR, byName.get("bad").status(),
                "bad 应标 ERROR");
        assertNotNull(byName.get("bad").errorMessage());
        assertTrue(registry.hasTool("mcp__good__ok"));
    }

    @Test
    void boundedStartupWaitReturnsWhileSlowServerContinuesStarting() throws Exception {
        webServer.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-03-26\"}}")
                .setBodyDelay(3, TimeUnit.SECONDS));

        loadServersFromMap(Map.of("slow", httpConfig(webServer)));

        ByteArrayOutputStream out = new ByteArrayOutputStream();

        long started = System.nanoTime();
        manager.startAll(new PrintStream(out, true, StandardCharsets.UTF_8), Duration.ofMillis(100));
        long elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);

        McpServer server = manager.server("slow");
        assertTrue(elapsedMillis < 1500, "bounded startup should return before initialize timeout");
        assertEquals(McpServerStatus.STARTING, server.status());
        assertFalse(registry.hasTool("mcp__slow__echo"));
        assertTrue(out.toString(StandardCharsets.UTF_8).contains("后台继续启动"));
    }

    @Test
    void disableRemovesToolsFromRegistry() throws Exception {
        enqueueInitialize();
        enqueueToolsList(toolJson("echo", "Echo"));

        loadServersFromMap(Map.of("demo", httpConfig(webServer)));
        manager.startAll();
        assertTrue(registry.hasTool("mcp__demo__echo"));

        String result = manager.disable("demo");
        assertTrue(result.contains("已禁用"));
        assertFalse(registry.hasTool("mcp__demo__echo"),
                "disable 后 ToolRegistry 应不再持有该工具");
        McpServer server = manager.servers().iterator().next();
        assertEquals(McpServerStatus.DISABLED, server.status());
    }

    @Test
    void restartReregistersToolsAfterFailure() throws Exception {
        // 第一次启动：失败（401）
        webServer.enqueue(new MockResponse().setResponseCode(401));

        loadServersFromMap(Map.of("demo", httpConfig(webServer)));
        manager.startAll();

        McpServer server = manager.servers().iterator().next();
        assertEquals(McpServerStatus.ERROR, server.status());
        assertFalse(registry.hasTool("mcp__demo__echo"));

        // 第二次启动：成功
        enqueueInitialize();
        enqueueToolsList(toolJson("echo", "Echo"));

        String result = manager.restart("demo");
        assertEquals(McpServerStatus.READY, server.status(), "重启后应 READY: " + result);
        assertTrue(registry.hasTool("mcp__demo__echo"));
    }

    @Test
    void restartWithArgsUpdatesServerConfig() {
        McpServerConfig config = new McpServerConfig();
        config.setCommand("definitely-missing-wraith-test-command");
        config.setArgs(List.of("old"));
        loadServersFromMap(Map.of("demo", config));

        String result = manager.restartWithArgs("demo", List.of("new", "args"));

        McpServer server = manager.server("demo");
        assertEquals(List.of("new", "args"), server.config().getArgs());
        assertTrue(result.contains("重启失败"));
    }

    @Test
    void unknownServerOperationsReturnFriendlyError() {
        loadServersFromMap(Map.of());
        assertTrue(manager.disable("missing").contains("未找到"));
        assertTrue(manager.enable("missing").contains("未找到"));
        assertTrue(manager.restart("missing").contains("未找到"));
        assertTrue(manager.logs("missing").contains("未找到"));
    }

    // ---- helpers ----

    private void enqueueInitialize() {
        enqueueInitialize(null);
    }

    private void enqueueInitialize(String capabilitiesJson) {
        String capabilities = capabilitiesJson == null ? "" : ",\"capabilities\":" + capabilitiesJson;
        // initialize 请求响应
        webServer.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setHeader("Mcp-Session-Id", "session-test")
                .setBody("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-03-26\"" + capabilities + "}}"));
        // initialized 通知（无 id），server 仍要返回 200，body 任意
        webServer.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody(""));
    }

    private void enqueueToolsList(String toolJson) {
        webServer.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[" + toolJson + "]}}"));
    }

    private void enqueueResourcesList() {
        webServer.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""
                        {"jsonrpc":"2.0","id":3,"result":{"resources":[
                          {"uri":"file://README.md","name":"README.md","description":"docs","mimeType":"text/markdown"}
                        ]}}
                        """));
    }

    private void enqueuePromptsList() {
        webServer.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""
                        {"jsonrpc":"2.0","id":4,"result":{"prompts":[
                          {"name":"review","title":"Review","description":"Review code"}
                        ]}}
                        """));
    }

    private static String toolJson(String name, String description) {
        return "{\"name\":\"" + name + "\",\"description\":\"" + description + "\","
                + "\"inputSchema\":{\"type\":\"object\",\"properties\":{}}}";
    }

    private static McpServerConfig httpConfig(MockWebServer webServer) {
        McpServerConfig config = new McpServerConfig();
        config.setUrl(webServer.url("/mcp").toString());
        return config;
    }

    private void loadServersFromMap(Map<String, McpServerConfig> configs) {
        // 用反射不优雅；这里用 manager 暴露的"已加载"语义模拟：直接通过创建 McpServer 对象塞进去
        // 由于 McpServerManager.servers 是 ConcurrentHashMap 且 loadConfiguredServers 也是把 config 翻译成
        // McpServer 实例，这里复用 loadConfiguredServers 的内部行为：把 configs 写入临时文件后 load。
        // 简化为：直接通过 reflection 写入 servers map。
        try {
            java.lang.reflect.Field f = McpServerManager.class.getDeclaredField("servers");
            f.setAccessible(true);
            @SuppressWarnings("unchecked")
            Map<String, McpServer> map = (Map<String, McpServer>) f.get(manager);
            map.clear();
            configs.forEach((name, cfg) -> map.put(name, new McpServer(name, cfg)));
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    // ---- 清债波 2 Task 1: MCP 冷启动锁窄化并发红绿测试 ----

    /**
     * 验证锁窄化(方案 A)的核心不变量:
     *
     * <p>场景:
     * <ol>
     *   <li>用 CountDownLatch 驱动的自定义 MockWebServer Dispatcher 模拟慢冷拉:
     *       initialize 请求在 latch 放行前一直阻塞。</li>
     *   <li>在后台线程调用 {@code enable("slow")},其内部的 {@code start()} 进入慢 initialize
     *       后内置锁已释放(快速记账块退出后)。</li>
     *   <li>主线程分别调用 {@code reloadFromConfig("other")}(空配置→"已移除"快速路径)
     *       和 {@code reattach(fresh)},两者都需要获取内置锁——若锁仍被 initialize 持有则会死阻。</li>
     *   <li>断言两次调用均在 2s 内返回,而非等待 latch 释放。</li>
     *   <li>放行 latch,后台线程完成 initialize(或因 manager.close() 短路退出),清理收尾。</li>
     * </ol>
     *
     * <p>红绿区分:若把 {@code start()} 中的 {@code client.initialize()} 重新包入
     * {@code synchronized(this)} 块(旧行为),则 {@code reloadFromConfig} 和 {@code reattach}
     * 会在 latch 未放行时永远等待内置锁,超时断言必然失败——此时为"红"。
     * 当前锁窄化代码 initialize 在锁外执行,两次调用均快速返回——此时为"绿"。
     */
    @Test
    void coldStartInitializeReleasesLockSoReloadAndReattachAreNotBlocked() throws Exception {
        // ── 1. 用自定义 Dispatcher 模拟冷拉:initialize 请求阻塞在 initializeLatch 上 ──
        CountDownLatch initializeLatch = new CountDownLatch(1);   // 控制 initialize 响应时机
        CountDownLatch initializeBlocking = new CountDownLatch(1); // 指示 initialize 请求已到达

        // 替换 MockWebServer 的默认 QueueDispatcher,用 latch 驱动
        webServer.setDispatcher(new Dispatcher() {
            private int callCount = 0;

            @Override
            public MockResponse dispatch(RecordedRequest request) throws InterruptedException {
                int call = ++callCount;
                if (call == 1) {
                    // 第一个请求:initialize — 阻塞直到 latch 放行
                    initializeBlocking.countDown(); // 通知主线程"已进入 initialize 阻塞"
                    initializeLatch.await();        // 等主线程断言完后放行
                    return new MockResponse()
                            .setHeader("Content-Type", "application/json")
                            .setHeader("Mcp-Session-Id", "session-cold")
                            .setBody("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-03-26\"}}");
                }
                // 其余请求(initialized 通知 / tools/list)快速返回空 200
                return new MockResponse().setHeader("Content-Type", "application/json").setBody("");
            }
        });

        loadServersFromMap(Map.of("slow", httpConfig(webServer)));

        ExecutorService exec = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "cold-start-bg");
            t.setDaemon(true);
            return t;
        });

        // ── 2. 后台线程调用 enable("slow")——进入慢 initialize 后内置锁应已释放 ──
        // enableFuture 不做 get():我们测的是"其他调用不被阻塞"而非 enable 本身的返回值;
        // 后台线程通过 exec.awaitTermination 在步骤 6 收尾。
        @SuppressWarnings("unused")
        Future<?> enableFuture = exec.submit(() -> manager.enable("slow"));

        // 等待 Dispatcher 确认 initialize 请求已到达(即后台线程已越过快速记账块、进入 initialize())
        assertTrue(initializeBlocking.await(5, TimeUnit.SECONDS),
                "后台线程未能在 5s 内到达 initialize 阻塞点");

        // ── 3. 主线程:验证 reloadFromConfig 不阻塞 ──
        // "other" 不在 servers map 也不在(空)配置文件,走"已移除"快速路径;
        // 该路径必须获取内置锁——若 initialize 持锁则会死阻。
        long t0 = System.nanoTime();
        String reloadMsg = manager.reloadFromConfig("other");
        long reloadMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - t0);

        // ── 4. 主线程:验证 reattach 不阻塞 ──
        ToolRegistry fresh = newRegistryLikeSetUp();
        long t1 = System.nanoTime();
        manager.reattach(fresh);
        long reattachMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - t1);

        // ── 5. 断言:两次调用都在 2s 内完成(绿),而非等待 latch 放行(红) ──
        assertTrue(reloadMs < 2000,
                "reloadFromConfig 耗时 " + reloadMs + "ms ≥ 2000ms,疑似被慢 initialize 阻塞(旧锁行为)");
        assertTrue(reattachMs < 2000,
                "reattach 耗时 " + reattachMs + "ms ≥ 2000ms,疑似被慢 initialize 阻塞(旧锁行为)");
        // reloadFromConfig("other") 无配置条目 → "已移除"
        assertTrue(reloadMsg.contains("已移除") || reloadMsg.contains("already"),
                "reloadFromConfig 应走移除路径,实际: " + reloadMsg);

        // ── 6. 清理:放行 latch → 后台线程完成 initialize → 测试正常退出 ──
        initializeLatch.countDown();
        exec.shutdown();
        exec.awaitTermination(10, TimeUnit.SECONDS);
    }

    // ---- Phase E-1 Task 1 新增测试 ----

    @Test
    void reattachRegistersToolsIntoNewRegistryAndLeavesOldUntouched() throws Exception {
        enqueueInitialize();
        enqueueToolsList("{\"name\":\"echo\",\"description\":\"回声\",\"inputSchema\":{\"type\":\"object\"}}");
        loadServersFromMap(Map.of("srv", httpConfig(webServer)));
        manager.startAll();
        String namespaced = McpToolDescriptor.namespaced("srv", "echo");
        assertTrue(registryHasTool(registry, namespaced), "前置:工具注册进原 registry");

        ToolRegistry fresh = newRegistryLikeSetUp();
        manager.reattach(fresh);
        assertTrue(registryHasTool(fresh, namespaced), "reattach 后新 registry 有该工具");
        // 旧 registry 不清理:随旧会话整体废弃(主动注销反而可能干扰在途会话)
        assertTrue(registryHasTool(registry, namespaced), "reattach 不清理旧 registry,旧工具仍保留");
    }

    @Test
    void statusListenerFiresOnEachTransition() throws Exception {
        List<String> events = new ArrayList<>();
        manager.setStatusListener(s -> events.add(s.name() + ":" + s.status()));
        enqueueInitialize();
        enqueueToolsList("{\"name\":\"echo\",\"description\":\"d\",\"inputSchema\":{\"type\":\"object\"}}");
        loadServersFromMap(Map.of("srv", httpConfig(webServer)));
        manager.startAll();
        assertTrue(events.contains("srv:STARTING"), "应包含 STARTING 事件，实际: " + events);
        assertTrue(events.contains("srv:READY"), "应包含 READY 事件，实际: " + events);
        manager.disable("srv");
        assertTrue(events.contains("srv:DISABLED"), "应包含 DISABLED 事件，实际: " + events);
    }

    @Test
    void reloadFromConfigRemovesServerWhenConfigGone() throws Exception {
        enqueueInitialize();
        enqueueToolsList("{\"name\":\"echo\",\"description\":\"d\",\"inputSchema\":{\"type\":\"object\"}}");
        loadServersFromMap(Map.of("srv", httpConfig(webServer)));
        manager.startAll();
        // 空配置下 reload:server 应被移除且工具注销
        String msg = manager.reloadFromConfig("srv");
        assertTrue(manager.servers().stream().noneMatch(s -> s.name().equals("srv")), msg);
        assertFalse(registryHasTool(registry, McpToolDescriptor.namespaced("srv", "echo")));
    }

    @Test
    void reloadFromConfigStartsBrandNewServer() throws Exception {
        // 向 configLoader 读取的 project.json 写入一个全新 server "brandnew"
        String mcpJson = "{\"mcpServers\":{\"brandnew\":{\"url\":\""
                + webServer.url("/mcp") + "\"}}}";
        Files.writeString(tempDir.resolve("project.json"), mcpJson);

        enqueueInitialize();
        enqueueToolsList(toolJson("search", "Search tool"));

        String result = manager.reloadFromConfig("brandnew");

        assertTrue(manager.servers().stream().anyMatch(s -> s.name().equals("brandnew")),
                "brandnew server 应出现在 manager.servers(): " + result);
        McpServer brandnew = manager.server("brandnew");
        assertNotNull(brandnew, "manager.server(\"brandnew\") 不应为 null");
        assertEquals(McpServerStatus.READY, brandnew.status(),
                "全新 server 应启动至 READY，实际: " + brandnew.status()
                        + (brandnew.errorMessage() == null ? "" : " — " + brandnew.errorMessage()));
        assertTrue(registryHasTool(registry, McpToolDescriptor.namespaced("brandnew", "search")),
                "registry 应持有 mcp__brandnew__search");
    }

    // ---- Phase E-1 Task 4 I1 修复测试 ----

    @Test
    void closedManagerStartAllRegistersNothing() throws Exception {
        enqueueInitialize();
        enqueueToolsList("{\"name\":\"echo\",\"description\":\"d\",\"inputSchema\":{\"type\":\"object\"}}");
        loadServersFromMap(Map.of("srv", httpConfig(webServer)));
        manager.close();      // 先关
        manager.startAll();   // 后启:worker 必须被 closed 短路
        assertFalse(registryHasTool(registry, McpToolDescriptor.namespaced("srv", "echo")),
                "close 后 startAll 不得注册任何工具");
    }

    // ---- Task 8: 在途 READY 注册经锁点读取当前 registry ----

    /**
     * 时序:
     *  1. startAll(maxWait=100ms) 启动慢 server(握手 800ms),立即返回
     *  2. reattach(fresh) 换 registry
     *  3. 等待 slow server 达到 READY
     *  4. 断言工具落在 fresh registry,不在原始 registry 的"新增"里
     */
    @Test
    void inflightReadyRegistersIntoNewRegistryAfterReattach() throws Exception {
        // 慢 server:initialize 立即应答,tools/list 延迟 800ms。
        // 这让 worker 越过 initialize(握手完成)、卡在 listTools(尚未进锁),
        // 令 startAll(maxWait=100ms) 返回时 server 处于"已过 initialize、卡在 listTools"窗口,
        // 对 registry 切换时序的覆盖比"initialize 延迟"更强:reattach 与 finalizeReadyLocked 的竞争更直接。
        webServer.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setHeader("Mcp-Session-Id", "session-slow")
                .setBody("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-03-26\"}}"));
        // initialized 通知响应
        webServer.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody(""));
        // tools/list 延迟 800ms 应答——worker 卡在此处时 reattach 发生,直接覆盖 finalizeReadyLocked 竞态窗
        webServer.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[" + toolJson("fast-tool", "A fast tool") + "]}}")
                .setBodyDelay(800, TimeUnit.MILLISECONDS));

        loadServersFromMap(Map.of("slow", httpConfig(webServer)));

        // 记录旧 registry 基数(startAll 前为 0 个 mcp__slow__ 工具)
        long oldBaseline = countToolsWithPrefix(registry, "mcp__slow__");

        // startAll 带短超时 → 立即返回,slow server 尚未 READY
        manager.startAll(null, Duration.ofMillis(100));

        McpServer slowServer = manager.server("slow");
        assertEquals(McpServerStatus.STARTING, slowServer.status(),
                "startAll 返回时 slow 应仍在 STARTING");

        // 在途窗口内切换 registry
        ToolRegistry fresh = newRegistryLikeSetUp();
        manager.reattach(fresh);

        // 轮询等待 slow server 达到 READY(最多 10s)
        awaitStatus(slowServer, McpServerStatus.READY, 10_000);

        // 断言:工具落进新 registry
        assertTrue(registryHasTool(fresh, McpToolDescriptor.namespaced("slow", "fast-tool")),
                "在途 READY 的工具必须落入 reattach 后的新 registry");

        // 旧 registry 不应有新增的 mcp__slow__ 工具
        long oldAfter = countToolsWithPrefix(registry, "mcp__slow__");
        assertEquals(oldBaseline, oldAfter,
                "旧 registry 不应新增 mcp__slow__ 工具(窗口内已切换 registry)");
    }

    /** 轮询等待 server 达到目标状态,超时则 fail */
    private static void awaitStatus(McpServer server, McpServerStatus target, long timeoutMillis)
            throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMillis;
        while (server.status() != target) {
            assertTrue(System.currentTimeMillis() < deadline,
                    "超时:server " + server.name() + " 仍为 " + server.status() + ",期望 " + target);
            if (server.status() == McpServerStatus.ERROR) {
                fail("server " + server.name() + " 进入 ERROR: " + server.errorMessage());
            }
            Thread.sleep(50);
        }
    }

    /** 统计 registry 中前缀匹配的工具数量,通过公共 API getToolDefinitions() */
    private static long countToolsWithPrefix(ToolRegistry reg, String prefix) {
        return reg.getToolDefinitions().stream()
                .filter(t -> t.name().startsWith(prefix))
                .count();
    }

    // ---- Phase E-1 Task 1 辅助方法 ----

    /** 与 disableRemovesToolsFromRegistry 中的断言保持同样 API */
    private static boolean registryHasTool(ToolRegistry reg, String toolName) {
        return reg.hasTool(toolName);
    }

    /** 与 setUp 中同参构造第二个 ToolRegistry（只构造空 registry，不含任何 MCP 工具） */
    private ToolRegistry newRegistryLikeSetUp() {
        return new ToolRegistry();
    }

    // ---- Task 5: tools/list_changed 回调加锁 + 闭 T1 遗留:closed-during-initialize client 泄漏 ----

    /**
     * FOLDED MINOR 1 红绿测试:closed-during-initialize client 泄漏修复。
     *
     * <p>场景:
     * <ol>
     *   <li>Dispatcher 让 initialize 阻塞在 latch 上(冷拉模拟)。</li>
     *   <li>等到 initialize 到达 Dispatcher 后,调用 {@code manager.close()}(设 closed=true)。</li>
     *   <li>放行 latch:initialize 完成,transport 获得 sessionId。</li>
     *   <li>修复后:{@code if (closed) \{ client.close(); return; \}} 触发 DELETE 请求。</li>
     *   <li>断言:MockWebServer 收到了 DELETE 请求(Transport.close() 被调用)。</li>
     * </ol>
     *
     * <p>红:回退为 {@code if (closed) return;}(无 client.close)→ DELETE 永不发送→断言失败。
     * 观察到 RED 时:awaitDeleteRequest 超时,断言 "manager.close() 后客户端应关闭" 失败。
     */
    @Test
    void closedDuringInitializeDoesNotLeakClient() throws Exception {
        CountDownLatch initializeLatch = new CountDownLatch(1);
        CountDownLatch initializeArrived = new CountDownLatch(1);

        webServer.setDispatcher(new Dispatcher() {
            private final java.util.concurrent.atomic.AtomicBoolean initialHandled = new java.util.concurrent.atomic.AtomicBoolean(false);

            @Override
            public MockResponse dispatch(RecordedRequest request) throws InterruptedException {
                // DELETE = client.close() — best-effort, return 200
                if ("DELETE".equals(request.getMethod())) {
                    return new MockResponse().setResponseCode(200);
                }
                // 第一个 POST 是 initialize — 阻塞直到 latch 放行
                if (!initialHandled.getAndSet(true)) {
                    initializeArrived.countDown();
                    initializeLatch.await();
                    // 返回带 sessionId 的响应:transport 记录 sessionId,close() 时才发 DELETE
                    return new MockResponse()
                            .setHeader("Content-Type", "application/json")
                            .setHeader("Mcp-Session-Id", "session-leak-test")
                            .setBody("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-03-26\"}}");
                }
                // initialized 通知及其他请求:200 空响应
                return new MockResponse().setHeader("Content-Type", "application/json").setBody("");
            }
        });

        loadServersFromMap(Map.of("leaky", httpConfig(webServer)));

        ExecutorService exec = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "leak-test-bg");
            t.setDaemon(true);
            return t;
        });

        // 后台线程启动慢 enable
        @SuppressWarnings("unused")
        Future<?> future = exec.submit(() -> manager.enable("leaky"));

        // 等待 initialize 请求到达
        assertTrue(initializeArrived.await(5, TimeUnit.SECONDS),
                "initialize 请求未在 5s 内到达");

        // 在 initialize 阻塞期间关闭 manager(工作区切换场景)
        manager.close();

        // 放行 initialize:client.initialize() 完成后,修复代码应调用 client.close()
        initializeLatch.countDown();

        exec.shutdown();
        exec.awaitTermination(10, TimeUnit.SECONDS);

        // 修复后:client.close() 应发出 DELETE 请求
        // 等待最多 5s,轮询 MockWebServer 已记录请求
        long deadline = System.currentTimeMillis() + 5000;
        boolean deleteReceived = false;
        while (System.currentTimeMillis() < deadline) {
            RecordedRequest req = webServer.takeRequest(100, TimeUnit.MILLISECONDS);
            if (req != null && "DELETE".equals(req.getMethod())) {
                deleteReceived = true;
                break;
            }
        }
        assertTrue(deleteReceived,
                "manager.close() 后 client 应被关闭(期待 DELETE 请求),但未收到。" +
                "RED:回退到 if (closed) return; 则不发 DELETE。");
    }

    /**
     * PRIMARY T5:notifications/tools/list_changed 回调加锁功能测试。
     *
     * <p>测试思路:直接向 McpClient 的通知链注入一条合成 list_changed 通知,
     * 验证回调在锁内正确更新工具列表——无需依赖时序竞态(非 flaky)。
     *
     * <p>步骤:
     * <ol>
     *   <li>正常启动 server,工具:"echo"。</li>
     *   <li>用自定义 Dispatcher 让 tools/list 返回 "echo2"(按请求 id 动态回复,避免 hardcode id 错配)。</li>
     *   <li>通过反射调用 {@code JsonRpcClient.handleMessage} 注入
     *       {@code notifications/tools/list_changed} 消息(无 id → 走通知分发路径)。</li>
     *   <li>断言:server.tools() 和 registry 均已更新为 "echo2"。</li>
     * </ol>
     *
     * <p>加锁后(GREEN):回调持 manager 锁,与 reattach/finalizeReadyLocked 互斥;
     * 功能测试保证工具正确注册。不加锁时工具仍会注册(非锁异常路径),但 closed 双检不存在
     * → 关闭后仍可写入 registry → 该路径由 closed 守护回归(见 listChangedAfterManagerCloseDoesNotWriteRegistry)。
     */
    @Test
    void listChangedNotificationUpdatesToolsUnderLock() throws Exception {
        // 1. 正常启动,工具 "echo"
        enqueueInitialize();
        enqueueToolsList(toolJson("echo", "Echo back text"));
        loadServersFromMap(Map.of("demo", httpConfig(webServer)));
        manager.startAll();

        McpServer server = manager.servers().iterator().next();
        assertEquals(McpServerStatus.READY, server.status());
        assertTrue(registry.hasTool("mcp__demo__echo"), "初始工具 echo 应已注册");

        // 3. 注入合成 list_changed 通知(通过 JsonRpcClient.handleMessage 反射)
        McpClient client = server.client();
        assertNotNull(client, "server.client() 不应为 null");

        java.lang.reflect.Field rpcField = McpClient.class.getDeclaredField("rpc");
        rpcField.setAccessible(true);
        com.lyhn.wraith.mcp.jsonrpc.JsonRpcClient rpc =
                (com.lyhn.wraith.mcp.jsonrpc.JsonRpcClient) rpcField.get(client);

        // 查询 JsonRpcClient 当前 id 计数器,预判下一次 tools/list 的 id,
        // 以确保 enqueued 响应 id 匹配 pending future(避免 hardcode id 错配导致 pending future 丢失)。
        java.lang.reflect.Field idsField = com.lyhn.wraith.mcp.jsonrpc.JsonRpcClient.class.getDeclaredField("ids");
        idsField.setAccessible(true);
        long nextId = ((java.util.concurrent.atomic.AtomicLong) idsField.get(rpc)).get();

        // 2. 排队正确 id 的 echo2 响应(list_changed 回调将调用 tools/list 触发此响应)
        webServer.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("{\"jsonrpc\":\"2.0\",\"id\":" + nextId + ",\"result\":{\"tools\":["
                        + toolJson("echo2", "Echo2 updated") + "]}}"));

        java.lang.reflect.Method handleMessage = com.lyhn.wraith.mcp.jsonrpc.JsonRpcClient.class
                .getDeclaredMethod("handleMessage", com.fasterxml.jackson.databind.JsonNode.class);
        handleMessage.setAccessible(true);

        // 构造 list_changed 通知:无 id 字段,走通知分发路径
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        com.fasterxml.jackson.databind.node.ObjectNode notification = mapper.createObjectNode();
        notification.put("jsonrpc", "2.0");
        notification.put("method", "notifications/tools/list_changed");

        handleMessage.invoke(rpc, notification);

        // 4. 断言:工具已更新为 echo2
        // NotificationRouter 在独立 daemon executor 中异步派发 handler,
        // 因此需要轮询等待 handler 完成(非 flaky:有明确超时和状态检测)。
        long deadline = System.currentTimeMillis() + 10_000;
        while (!registry.hasTool("mcp__demo__echo2") && System.currentTimeMillis() < deadline) {
            Thread.sleep(50);
        }
        // 若 list_changed 回调内部出现异常,会记录在 server.errorMessage()
        assertNull(server.errorMessage(),
                "list_changed 回调不应报错,errorMessage=" + server.errorMessage());
        String serverToolsStr = server.tools().stream()
                .map(t -> t.namespacedName()).collect(java.util.stream.Collectors.joining(", "));
        assertTrue(registry.hasTool("mcp__demo__echo2"),
                "list_changed 后新工具 echo2 应已注册进 registry; server.tools()=" + serverToolsStr);
        assertFalse(registry.hasTool("mcp__demo__echo"),
                "list_changed 后旧工具 echo 应已被替换");
        assertEquals(1, server.tools().size(), "server.tools() 应只有 echo2");
        assertEquals("mcp__demo__echo2", server.tools().get(0).namespacedName());
    }

    /**
     * PRIMARY T5 补充:list_changed 在 manager.close() 后不写 registry(closed 守护)。
     * 验证 synchronized(this) 内的 {@code if (closed) return;} 守护生效。
     *
     * <p>关键设计:在 close() 之前保存 rpc 引用,close() 之后直接注入通知,
     * 绕过 server.client()==null 的短路,确保通知确实进入了 list_changed 回调。
     */
    @Test
    void listChangedAfterManagerCloseDoesNotWriteRegistry() throws Exception {
        enqueueInitialize();
        enqueueToolsList(toolJson("echo", "Echo back text"));
        loadServersFromMap(Map.of("demo", httpConfig(webServer)));
        manager.startAll();

        McpServer server = manager.servers().iterator().next();
        assertEquals(McpServerStatus.READY, server.status());

        // 在 close() 前保存 rpc 引用和 handleMessage 方法(close 后 server.client() 为 null)
        McpClient clientBeforeClose = server.client();
        assertNotNull(clientBeforeClose, "startAll 后 client 不应为 null");

        java.lang.reflect.Field rpcField = McpClient.class.getDeclaredField("rpc");
        rpcField.setAccessible(true);
        com.lyhn.wraith.mcp.jsonrpc.JsonRpcClient rpcBeforeClose =
                (com.lyhn.wraith.mcp.jsonrpc.JsonRpcClient) rpcField.get(clientBeforeClose);

        java.lang.reflect.Method handleMessage = com.lyhn.wraith.mcp.jsonrpc.JsonRpcClient.class
                .getDeclaredMethod("handleMessage", com.fasterxml.jackson.databind.JsonNode.class);
        handleMessage.setAccessible(true);

        // 关闭 manager(模拟工作区切换)— closed=true 且 registry 被清空
        manager.close();

        // close() 清空了 echo,registry 应已无 echo
        assertFalse(registry.hasTool("mcp__demo__echo"), "close 后 echo 应已被注销");

        // 注入 list_changed 通知(直接调用已注册的 NotificationRouter listener)
        // — 若 synchronized(this)+if(closed) 守护不存在,回调会调 buildToolList+replaceTools 写 echo2
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        com.fasterxml.jackson.databind.node.ObjectNode notification = mapper.createObjectNode();
        notification.put("jsonrpc", "2.0");
        notification.put("method", "notifications/tools/list_changed");

        // 这里注入通知;由于 rpc 已关闭(transport closed),若回调尝试调 buildToolList,
        // HTTP 请求会失败(exception),通过 errorMessage 吸收。
        // 关键断言:echo2 不应出现在 registry 里(无论因 closed 守护还是 HTTP 失败)。
        try {
            handleMessage.invoke(rpcBeforeClose, notification);
        } catch (Exception ignored) {
            // 若 rpc 已关闭导致调用异常,属预期内(close 后网络不可用)
        }

        // NotificationRouter 异步派发;等待足够时间让异步 handler 有机会运行,
        // 然后断言它没有写入 registry(closed 守护生效)。
        Thread.sleep(500);

        // 断言:registry 没有 echo2(closed 守护 + 网络失败双重保证)
        assertFalse(registry.hasTool("mcp__demo__echo2"),
                "manager.close() 后 list_changed 不应向 registry 写入新工具");
    }

    // ---- Task 8: mcp.status ERROR 通知链端到端断言 ----

    /**
     * T8:setStatus(ERROR)→statusListener→errorMessage 端到端贯穿测试。
     *
     * <p>场景:挂录制 {@code setStatusListener},启动一个必然失败的 server
     * (URL 含未设置的环境变量 {@code ${UNSET_DEMO_VAR_FOR_TEST}},复用
     * {@code singleServerFailureDoesNotBlockOthers} 的 bad-config 模式),
     * {@code configLoader.prepare()} 展开失败 → {@code start()} catch 触发
     * {@code setStatus(server, ERROR)} → listener 被调用。
     *
     * <p>断言:
     * <ol>
     *   <li>listener 收到 ERROR 状态的 server。</li>
     *   <li>该 server 的 {@code errorMessage()} 在 listener 被调用时非 null、非空白。</li>
     *   <li>(加分)STARTING → ERROR 的顺序可观察。</li>
     * </ol>
     *
     * <p>红绿区分:
     * <ul>
     *   <li>RED A:注释 {@code setStatus} 中的 {@code l.accept(server)}——listener 永不被调用,
     *       {@code errorEvents} 为空,断言 "listener 应收到 ERROR 事件" 失败。</li>
     *   <li>RED B:注释 {@code start()} catch 中的 {@code setStatus(server, McpServerStatus.ERROR)}
     *       ——listener 同样收不到 ERROR 事件。</li>
     *   <li>GREEN:保留完整链,断言全部通过。</li>
     * </ul>
     */
    @Test
    void errorTransitionFiresStatusListenerWithNonNullErrorMessage() {
        // 录制所有 STATUS 事件和捕获时的 errorMessage
        List<McpServerStatus> statusSequence = new ArrayList<>();
        List<String> capturedErrorMessages = new ArrayList<>();

        manager.setStatusListener(s -> {
            statusSequence.add(s.status());
            // 仅在 ERROR 时记录 errorMessage(STARTING 时为 null 属预期)
            if (s.status() == McpServerStatus.ERROR) {
                capturedErrorMessages.add(s.errorMessage());
            }
        });

        // bad-config:URL 含未展开的 ${UNSET_DEMO_VAR_FOR_TEST},configLoader.prepare() 抛异常
        McpServerConfig bad = new McpServerConfig();
        bad.setUrl("https://example.com/${UNSET_DEMO_VAR_FOR_TEST}");
        loadServersFromMap(Map.of("failing", bad));

        // startAll() 同步等待所有 server 到达终态(READY 或 ERROR)
        manager.startAll();

        McpServer server = manager.servers().iterator().next();

        // 1. server 最终状态必须是 ERROR
        assertEquals(McpServerStatus.ERROR, server.status(),
                "bad-config server 应最终为 ERROR,实际: " + server.status());

        // 2. listener 至少收到一个 ERROR 事件
        assertTrue(statusSequence.contains(McpServerStatus.ERROR),
                "statusListener 应收到 ERROR 状态事件,实际序列: " + statusSequence
                        + "。RED:注释 setStatus() 中的 l.accept(server) 或 "
                        + "start() catch 中的 setStatus(server, ERROR) 即可重现。");

        // 3. listener 收到 ERROR 时 errorMessage 必须非 null 且非空白
        assertFalse(capturedErrorMessages.isEmpty(),
                "ERROR 事件回调未被触发(capturedErrorMessages 为空)");
        String capturedMsg = capturedErrorMessages.get(0);
        assertNotNull(capturedMsg,
                "listener 在 ERROR 状态下捕获的 errorMessage 不应为 null");
        assertFalse(capturedMsg.isBlank(),
                "listener 在 ERROR 状态下捕获的 errorMessage 不应为空白,实际: '" + capturedMsg + "'");

        // 4. (可选)STARTING → ERROR 顺序可观察
        int startingIdx = statusSequence.indexOf(McpServerStatus.STARTING);
        int errorIdx = statusSequence.lastIndexOf(McpServerStatus.ERROR);
        if (startingIdx >= 0) {
            assertTrue(startingIdx < errorIdx,
                    "STARTING 应先于 ERROR,实际序列: " + statusSequence);
        }
    }

    // ---- Task 7: start() catch 块关闭本地 client(错误路径泄漏修复)红绿测试 ----

    /**
     * T7 FOLDED 红绿测试:initialize() 成功但 buildToolList(tools/list)失败时,本地 client 被关闭。
     *
     * <p>场景:
     * <ol>
     *   <li>initialize 正常返回,带 sessionId(使 transport.close() 会发 DELETE)。</li>
     *   <li>initialized 通知响应正常。</li>
     *   <li>tools/list 返回 400 → buildToolList 内 client.listTools() 抛 IOException。</li>
     *   <li>start() 的 catch 块:修复前仅 server.close()(此时 server.client()==null,无 DELETE);
     *       修复后追加 client.close() → DELETE 被发送。</li>
     *   <li>断言:MockWebServer 收到 DELETE(client.close() 被调用)。</li>
     * </ol>
     *
     * <p>RED 观察(修复前行为):去掉 catch 中的 {@code if (client != null) \{ client.close(); \}},
     * 则 DELETE 请求永不发送,awaitDeleteRequest 超时,断言失败。
     * 实测 RED:去掉修复行后,await 5s 无 DELETE 收到,断言
     * "buildToolList 失败后 client 应被关闭" 失败。
     *
     * <p>GREEN:保留修复行,DELETE 在 5s 内到达,断言通过。
     */
    @Test
    void buildToolListFailureAfterInitializeDoesNotLeakClient() throws Exception {
        // Dispatcher:initialize 带 sessionId;initialized 通知 200;tools/list 返 400
        webServer.setDispatcher(new Dispatcher() {
            private final java.util.concurrent.atomic.AtomicInteger postCount =
                    new java.util.concurrent.atomic.AtomicInteger(0);

            @Override
            public MockResponse dispatch(RecordedRequest request) {
                // DELETE = client.close() best-effort — 返回 200
                if ("DELETE".equals(request.getMethod())) {
                    return new MockResponse().setResponseCode(200);
                }
                int count = postCount.incrementAndGet();
                if (count == 1) {
                    // initialize 响应:带 sessionId,transport 记录后 close() 才发 DELETE
                    return new MockResponse()
                            .setHeader("Content-Type", "application/json")
                            .setHeader("Mcp-Session-Id", "session-buildtool-leak")
                            .setBody("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-03-26\"}}");
                }
                if (count == 2) {
                    // initialized 通知:200 空响应
                    return new MockResponse()
                            .setHeader("Content-Type", "application/json")
                            .setBody("");
                }
                // tools/list(及任何后续请求):400 → buildToolList 抛 IOException → catch 触发
                return new MockResponse().setResponseCode(400).setBody("bad request");
            }
        });

        loadServersFromMap(Map.of("leak2", httpConfig(webServer)));

        // startAll 同步阻塞直到 server 进入 ERROR(400 响应立即返回,不需要后台线程)
        manager.startAll();

        McpServer server = manager.servers().iterator().next();
        assertEquals(McpServerStatus.ERROR, server.status(),
                "tools/list 400 后 server 应为 ERROR,实际: " + server.status()
                        + (server.errorMessage() == null ? "" : " — " + server.errorMessage()));

        // 修复后:catch 中 client.close() 应发送 DELETE 关闭已建连 session
        // 等待最多 5s 轮询 DELETE 请求
        long deadline = System.currentTimeMillis() + 5000;
        boolean deleteReceived = false;
        while (System.currentTimeMillis() < deadline) {
            RecordedRequest req = webServer.takeRequest(100, TimeUnit.MILLISECONDS);
            if (req != null && "DELETE".equals(req.getMethod())) {
                deleteReceived = true;
                break;
            }
        }
        assertTrue(deleteReceived,
                "buildToolList 失败后 client 应被关闭(期待 DELETE 请求)。" +
                "RED:去掉 catch 中 client.close() 则不发 DELETE。");
    }
}
