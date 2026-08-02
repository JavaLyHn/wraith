package com.lyhn.wraith.cli;

import com.lyhn.wraith.browser.BrowserConnectivityCheck;
import com.lyhn.wraith.browser.BrowserConnectivityCheck.Failure;
import com.lyhn.wraith.browser.BrowserMode;
import com.lyhn.wraith.browser.BrowserSession;
import com.lyhn.wraith.hitl.HitlToolRegistry;
import com.lyhn.wraith.hitl.TerminalHitlHandler;
import com.lyhn.wraith.mcp.McpServer;
import com.lyhn.wraith.mcp.McpServerManager;
import com.lyhn.wraith.mcp.McpServerStatus;
import com.lyhn.wraith.mcp.config.McpConfigLoader;
import com.lyhn.wraith.mcp.config.McpServerConfig;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class MainBrowserCommandTest {

    @Test
    void browserStatusShowsCurrentMode(@TempDir Path tempDir) throws IOException {
        Harness h = new Harness(tempDir);

        String result = Main.handleBrowserCommand("status", h.session, h.connectivity, h.manager, h.registry, h.handler);

        assertTrue(result.contains("当前模式"));
        assertTrue(result.contains("isolated"));
    }

    @Test
    void browserConnectRejectsInvalidPort(@TempDir Path tempDir) throws IOException {
        Harness h = new Harness(tempDir);

        String result = Main.handleBrowserCommand("connect 80", h.session, h.connectivity, h.manager, h.registry, h.handler);

        assertTrue(result.contains("1024-65535"));
        assertEquals(BrowserMode.ISOLATED, h.session.mode());
    }

    @Test
    void browserConnectDefaultUsesAutoConnectWithoutLegacyProbe(@TempDir Path tempDir) {
        BrowserSession session = new BrowserSession();
        HitlToolRegistry registry = new HitlToolRegistry(new TerminalHitlHandler(false));
        CountingConnectivityCheck connectivity = new CountingConnectivityCheck();
        FakeMcpServerManager manager = new FakeMcpServerManager(registry, tempDir);

        String result = Main.handleBrowserCommand("connect", session, connectivity, manager, registry, new TerminalHitlHandler(false));

        assertTrue(result.contains("--autoConnect"));
        assertEquals(BrowserMode.SHARED, session.mode());
        assertEquals("autoConnect", session.browserUrl());
        assertEquals(0, connectivity.probeCount);
        assertEquals(List.of("-y", "chrome-devtools-mcp@latest", "--autoConnect"), manager.lastArgs);
    }

    @Test
    void browserDisconnectRestartsIsolated(@TempDir Path tempDir) {
        // chrome-devtools 现在是 McpConfigLoader 的内建项 —— 空 mcp.json 也照样有这个 server。
        // 此前这条用例断言的是「未配置」,那正是本次修掉的 bug(桌面用户永远等不到浏览器能力)。
        // 用 FakeMcpServerManager 而不是真 manager:真 manager 会去 restart,
        // 也就是真的 spawn 一次 npx —— 单测里不该有这种东西。
        BrowserSession session = new BrowserSession();
        HitlToolRegistry registry = new HitlToolRegistry(new TerminalHitlHandler(false));
        FakeMcpServerManager manager = new FakeMcpServerManager(registry, tempDir);
        session.switchToShared("http://127.0.0.1:9222");

        String result = Main.handleBrowserCommand("disconnect", session, new CountingConnectivityCheck(),
                manager, registry, new TerminalHitlHandler(false));

        assertTrue(result.contains("isolated"), result);
        assertEquals(BrowserMode.ISOLATED, session.mode());
        assertEquals(List.of("-y", "chrome-devtools-mcp@latest", "--isolated=true"), manager.lastArgs);
    }

    @Test
    void browserDisconnectWithoutServerClearsSession(@TempDir Path tempDir) throws IOException {
        // 「真的没有这个 server」现在只剩一条路:用户显式退订内建项。
        // 这条分支仍然要活着 —— 退订的人做 /browser disconnect 不该崩,该被告知并清干净本地状态。
        System.setProperty("wraith.mcp.builtin.browser", "off");
        try {
            Harness h = new Harness(tempDir);
            h.session.switchToShared("http://127.0.0.1:9222");

            String result = Main.handleBrowserCommand("disconnect", h.session, h.connectivity, h.manager, h.registry, h.handler);

            assertTrue(result.contains("未配置"), result);
            assertEquals(BrowserMode.ISOLATED, h.session.mode());
        } finally {
            System.clearProperty("wraith.mcp.builtin.browser");
        }
    }

    @Test
    void browserTabsInIsolatedModeGivesConnectHint(@TempDir Path tempDir) throws IOException {
        Harness h = new Harness(tempDir);

        String result = Main.handleBrowserCommand("tabs", h.session, h.connectivity, h.manager, h.registry, h.handler);

        assertTrue(result.contains("isolated"));
        assertTrue(result.contains("/browser connect"));
    }

    @Test
    void unknownBrowserSubCommandShowsHelp(@TempDir Path tempDir) throws IOException {
        Harness h = new Harness(tempDir);

        String result = Main.handleBrowserCommand("wat", h.session, h.connectivity, h.manager, h.registry, h.handler);

        assertTrue(result.contains("未知 /browser 子命令"));
        assertTrue(result.contains("/browser connect"));
    }

    private static final class Harness {
        private final BrowserSession session = new BrowserSession();
        private final BrowserConnectivityCheck connectivity = new BrowserConnectivityCheck();
        private final TerminalHitlHandler handler = new TerminalHitlHandler(false);
        private final HitlToolRegistry registry = new HitlToolRegistry(handler);
        private final McpServerManager manager;

        private Harness(Path tempDir) throws IOException {
            manager = new McpServerManager(
                    registry,
                    tempDir,
                    new McpConfigLoader(tempDir.resolve("user.json"), tempDir.resolve("project.json"), tempDir));
            manager.loadConfiguredServers();
        }
    }

    private static final class CountingConnectivityCheck extends BrowserConnectivityCheck {
        private int probeCount;

        @Override
        public ProbeResult probe(int port) {
            probeCount++;
            return new ProbeResult(false, null, "should not probe", Failure.UNREACHABLE);
        }
    }

    private static final class FakeMcpServerManager extends McpServerManager {
        private final McpServer server;
        private List<String> lastArgs = List.of();

        private FakeMcpServerManager(HitlToolRegistry registry, Path projectDir) {
            super(registry, projectDir);
            McpServerConfig config = new McpServerConfig();
            config.setCommand("npx");
            config.setArgs(List.of("-y", "chrome-devtools-mcp@latest", "--isolated=true"));
            this.server = new McpServer("chrome-devtools", config);
            this.server.status(McpServerStatus.READY);
        }

        @Override
        public synchronized String restartWithArgs(String name, List<String> args) {
            lastArgs = List.copyOf(args);
            server.config().setArgs(args);
            server.status(McpServerStatus.READY);
            return "✅ MCP server 已重启: " + name;
        }

        @Override
        public McpServer server(String name) {
            return "chrome-devtools".equals(name) ? server : null;
        }
    }
}
