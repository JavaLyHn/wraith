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
            // McpServerConfig.getEnv() confirmed — getter is getEnv()
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
