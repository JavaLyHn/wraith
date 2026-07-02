package com.lyhn.wraith.mcp;

import com.lyhn.wraith.mcp.config.McpConfigLoader;
import com.lyhn.wraith.mcp.config.McpServerConfig;
import com.lyhn.wraith.mcp.protocol.McpToolDescriptor;
import com.lyhn.wraith.tool.ToolRegistry;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
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
import java.util.concurrent.TimeUnit;

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

    // ---- Phase E-1 Task 1 辅助方法 ----

    /** 与 disableRemovesToolsFromRegistry 中的断言保持同样 API */
    private static boolean registryHasTool(ToolRegistry reg, String toolName) {
        return reg.hasTool(toolName);
    }

    /** 与 setUp 中同参构造第二个 ToolRegistry（只构造空 registry，不含任何 MCP 工具） */
    private ToolRegistry newRegistryLikeSetUp() {
        return new ToolRegistry();
    }
}
