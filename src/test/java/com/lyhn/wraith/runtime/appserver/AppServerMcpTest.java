package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.mcp.McpServer;
import com.lyhn.wraith.mcp.McpServerManager;
import com.lyhn.wraith.mcp.McpServerStatus;
import com.lyhn.wraith.mcp.config.McpServerConfig;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class AppServerMcpTest {

    /** 记录型假 manager:不起任何真进程。 */
    static class FakeManager extends McpServerManager {
        final List<String> calls = new ArrayList<>();
        FakeManager(ToolRegistry r, Path p) { super(r, p); }
        @Override public void loadConfiguredServers() throws IOException { calls.add("load"); }
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

    /** FIX 1: loadConfiguredServers 抛 IOException → ensureFor 不抛,manager 非 null,list() 不抛 ISE */
    @Test
    void loadConfiguredServersThrowsIoExceptionIsFailOpen(@TempDir Path ws) {
        // FakeManager whose loadConfiguredServers() throws IOException
        AppServerMcp mcp = new AppServerMcp((reg, dir) -> new FakeManager(reg, dir) {
            @Override public void loadConfiguredServers() throws IOException {
                throw new IOException("坏 JSON 模拟");
            }
        });
        assertDoesNotThrow(() -> mcp.ensureFor(ws.toString(), registry(ws), null),
                "loadConfiguredServers 抛 IOException,ensureFor 不应向上传播");
        assertNotNull(mcp.manager(), "配置加载失败后 manager 仍须挂载(空载降级)");
        // list() 应返回 map 而不是 IllegalStateException
        assertDoesNotThrow(() -> mcp.list(), "配置加载失败后 list() 不应抛 IllegalStateException");
        @SuppressWarnings("unchecked")
        List<?> servers = (List<?>) mcp.list().get("servers");
        assertNotNull(servers, "list() 结果含 servers 字段");
    }

    /** FIX 1: 坏 JSON 项目级 mcp.json → list() 返回含 configError 字段 */
    @Test
    void corruptProjectMcpJsonSurfacesConfigErrorInList(@TempDir Path ws) throws Exception {
        // 写入坏 JSON 的项目级 mcp.json
        Path mcpDir = ws.resolve(".wraith");
        Files.createDirectories(mcpDir);
        Files.writeString(mcpDir.resolve("mcp.json"), "not json{{");

        AppServerMcp mcp = new AppServerMcp((reg, dir) -> new FakeManager(reg, dir));
        mcp.ensureFor(ws.toString(), registry(ws), null);

        Map<String, Object> result = mcp.list();
        assertNotNull(result.get("configError"),
                "坏 JSON 项目级 mcp.json 应令 list() 返回附 configError 字段,实际: " + result);
    }

    // ── Task 3: enable/restart 异步化 ────────────────────────────────────────

    /**
     * 慢 Manager:enable/restart 模拟 3s 阻塞(握手前 sleep),用于证明异步化前后行为差异。
     * servers() 中含一个 "slow" server,status 初始 DISABLED。
     */
    static class SlowFakeManager extends FakeManager {
        private final McpServer slowServer;

        SlowFakeManager(ToolRegistry r, Path p) {
            super(r, p);
            McpServerConfig cfg = new McpServerConfig();
            cfg.setCommand("true");
            slowServer = new McpServer("slow", cfg);
            slowServer.status(McpServerStatus.DISABLED);
        }

        @Override public McpServer server(String name) {
            return "slow".equals(name) ? slowServer : null;
        }

        @Override public Collection<McpServer> servers() {
            List<McpServer> list = new ArrayList<>();
            list.add(slowServer);
            return list;
        }

        @Override public synchronized String enable(String name) {
            if (!"slow".equals(name)) return "未找到 MCP server: " + name;
            try { Thread.sleep(3000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            slowServer.status(McpServerStatus.READY);
            return "ok";
        }

        @Override public synchronized String restart(String name) {
            if (!"slow".equals(name)) return "未找到 MCP server: " + name;
            try { Thread.sleep(3000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            slowServer.status(McpServerStatus.READY);
            return "ok";
        }
    }

    /** 轮询直到 manager.server(name).status() == expected,超时则 fail。 */
    private static void awaitStatus(AppServerMcp mcp, String name, McpServerStatus expected, long timeoutMs)
            throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            McpServerManager m = mcp.manager();
            if (m != null) {
                McpServer s = m.server(name);
                if (s != null && s.status() == expected) return;
            }
            Thread.sleep(50);
        }
        McpServerManager m = mcp.manager();
        McpServerStatus actual = m != null && m.server(name) != null ? m.server(name).status() : null;
        fail("awaitStatus 超时: 期望 " + name + " 状态 " + expected + ",实际 " + actual);
    }

    @Test
    void enableReturnsBeforeSlowServerReady(@TempDir Path ws) throws Exception {
        AppServerMcp mcp = new AppServerMcp((reg, dir) -> new SlowFakeManager(reg, dir));
        mcp.ensureFor(ws.toString(), registry(ws), null);

        long t0 = System.nanoTime();
        mcp.enable("slow");
        long elapsedMs = (System.nanoTime() - t0) / 1_000_000;

        assertTrue(elapsedMs < 1000, "enable 阻塞了 " + elapsedMs + "ms,应小于 1000ms");
        awaitStatus(mcp, "slow", McpServerStatus.READY, 10_000);
    }

    @Test
    void restartReturnsBeforeSlowServerReady(@TempDir Path ws) throws Exception {
        AppServerMcp mcp = new AppServerMcp((reg, dir) -> new SlowFakeManager(reg, dir));
        mcp.ensureFor(ws.toString(), registry(ws), null);

        long t0 = System.nanoTime();
        mcp.restart("slow");
        long elapsedMs = (System.nanoTime() - t0) / 1_000_000;

        assertTrue(elapsedMs < 1000, "restart 阻塞了 " + elapsedMs + "ms,应小于 1000ms");
        awaitStatus(mcp, "slow", McpServerStatus.READY, 10_000);
    }

    @Test
    void slowEnableDoesNotBlockOtherRpc(@TempDir Path ws) throws Exception {
        AppServerMcp mcp = new AppServerMcp((reg, dir) -> new SlowFakeManager(reg, dir));
        mcp.ensureFor(ws.toString(), registry(ws), null);

        mcp.enable("slow");                             // 3s 慢启动在途

        long t0 = System.nanoTime();
        Map<String, Object> r = mcp.list();             // 另一个 MCP 调用应立即完成
        assertTrue((System.nanoTime() - t0) / 1_000_000 < 1000,
                "list() 被 enable 阻塞了");
        assertNotNull(r.get("servers"));
    }
}
