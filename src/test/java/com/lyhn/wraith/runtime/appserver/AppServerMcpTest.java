package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.mcp.McpServer;
import com.lyhn.wraith.mcp.McpServerManager;
import com.lyhn.wraith.mcp.config.McpServerConfig;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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
    void listReturnsCommandAndArgsForStdioServerButNotEnvValue(@TempDir Path ws) throws Exception {
        McpServerConfig cfg = new McpServerConfig();
        cfg.setCommand("npx");
        cfg.setArgs(List.of("-y", "pkg"));
        cfg.setEnv(Map.of("TOKEN", "v"));
        McpServer srv = new McpServer("test-stdio", cfg);

        AppServerMcp mcp = new AppServerMcp((reg, dir) -> new FakeManager(reg, dir) {
            @Override public java.util.Collection<McpServer> servers() { return List.of(srv); }
        });
        mcp.ensureFor(ws.toString(), registry(ws), null);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> servers = (List<Map<String, Object>>) mcp.list().get("servers");
        assertEquals(1, servers.size());
        Map<String, Object> entry = servers.get(0);

        assertEquals("npx", entry.get("command"), "command 必须回传");
        assertEquals(List.of("-y", "pkg"), entry.get("args"), "args 必须回传");
        assertEquals(List.of("TOKEN"), entry.get("envKeys"), "envKeys 只含 key 名");
        // env 值不得出现在条目中
        assertNull(entry.get("env"), "env map 不得出现");
        assertFalse(String.valueOf(entry).contains("\"v\"") || String.valueOf(entry).contains("=v"),
                "env 值 'v' 不得出现在序列化条目中");
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
