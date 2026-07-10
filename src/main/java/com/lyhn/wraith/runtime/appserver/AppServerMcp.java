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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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

    /** 单线程 daemon 执行器:串行化 enable/restart 的异步 offload,防 dispatch 线程被慢启动卡死。 */
    private volatile ExecutorService mcpControlExecutor = newMcpControlExecutor();

    public AppServerMcp() { this(McpServerManager::new); }

    AppServerMcp(ManagerFactory factory) { this.factory = factory; }

    private static ExecutorService newMcpControlExecutor() {
        return Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "wraith-mcp-control");
            t.setDaemon(true);
            return t;
        });
    }

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
                // 换工作区:shutdownNow 取消针对旧 manager 的在途 enable/restart,防止其结果写到新会话
                mcpControlExecutor.shutdownNow();
                mcpControlExecutor = newMcpControlExecutor();
                try { old.close(); } catch (Exception e) { /* fail-open */ }
            }
            currentWorkspace = normalized;
            McpServerManager fresh = factory.create(registry, Path.of(normalized));
            fresh.setStatusListener(this::pushStatus);
            try {
                fresh.loadConfiguredServers();
            } catch (IOException configEx) {
                // 坏 JSON 等配置加载失败:降级空载,manager 照常挂载,list() 通过 namesIn 的 configError 路径上报横幅
                System.err.println("[app-server] MCP 配置加载失败(降级空载): " + configEx.getMessage());
            }
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
            s.tools().forEach(t -> {
                Map<String, Object> tv = new LinkedHashMap<>();
                tv.put("name", t.name());
                tv.put("description", t.description() == null ? "" : t.description());
                if (t.inputSchema() != null) {
                    tv.put("parameters", t.inputSchema()); // sanitized JSON schema;null(仅防御)时省略
                }
                tools.add(tv);
            });
            e.put("tools", tools);
            // McpServerConfig.getEnv() confirmed — getter is getEnv()
            List<String> envKeys = s.config() != null && s.config().getEnv() != null
                    ? new ArrayList<>(s.config().getEnv().keySet()) : new ArrayList<>();
            Collections.sort(envKeys);
            e.put("envKeys", envKeys);
            if (s.config() != null && s.config().getCommand() != null && !s.config().getCommand().isBlank()) {
                e.put("command", s.config().getCommand());
                e.put("args", s.config().getArgs() == null ? List.of() : s.config().getArgs());
            }
            if (s.status() == McpServerStatus.ERROR && s.errorMessage() != null) e.put("error", s.errorMessage());
            out.add(e);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("servers", out);
        if (configError.length() > 0) result.put("configError", configError.toString());
        return result;
    }

    @Override public void enable(String name) {
        requireServer(name);                    // 校验同步(快):未知名仍即时抛 NoSuchElementException
        McpServerManager m = requireManager();
        mcpControlExecutor.submit(() -> {
            try { m.enable(name); }
            catch (RuntimeException e) { /* 结果经 mcp.status(ERROR) 呈现,此处无响应通道 */ }
        });
    }

    @Override public void disable(String name) {
        requireServer(name);                    // 校验同步(快):未知名仍即时抛 NoSuchElementException
        McpServerManager m = requireManager();
        // 与 enable/restart 对称:submit 到单线程执行器。慢 enable 持 manager 锁期间,
        // 同步 disable 会在 dispatch 线程上等锁,卡死全部 RPC;异步 offload 后 disable 即时返回,
        // 结果经 setStatus(DISABLED) 通知链呈现。
        mcpControlExecutor.submit(() -> {
            try { m.disable(name); }
            catch (RuntimeException e) { /* 结果经 mcp.status(DISABLED) 呈现,此处无响应通道 */ }
        });
    }

    @Override public void restart(String name) {
        requireServer(name);                    // 校验同步(快)
        McpServerManager m = requireManager();
        mcpControlExecutor.submit(() -> {
            try { m.restart(name); }
            catch (RuntimeException e) { /* 结果经 mcp.status(ERROR) 呈现,此处无响应通道 */ }
        });
    }
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

    @Override public Map<String, Object> test(String scope, String name, String command,
                                              List<String> args, Map<String, String> env) {
        Map<String, String> merged = mergeEnvForTest(env, savedEntryOrNull(scope, name));
        long t0 = System.currentTimeMillis();
        com.lyhn.wraith.mcp.transport.StdioTransport transport = null;
        com.lyhn.wraith.mcp.McpClient client = null;
        try {
            java.nio.file.Path workDir = currentWorkspace != null
                    ? java.nio.file.Path.of(currentWorkspace) : java.nio.file.Path.of(".");
            transport = new com.lyhn.wraith.mcp.transport.StdioTransport(command, args, merged, workDir);
            client = new com.lyhn.wraith.mcp.McpClient("__test__", transport);
            client.initialize();
            int toolCount = client.listTools().size();
            Map<String, Object> ok = new LinkedHashMap<>();
            ok.put("ok", true);
            ok.put("toolCount", toolCount);
            ok.put("latencyMs", System.currentTimeMillis() - t0);
            return ok;
        } catch (Exception ex) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("ok", false);
            err.put("error", buildTestError(ex, transport)); // 绝不含 env 值
            return err;
        } finally {
            // 临时进程绝不残留:client 建成走级联关闭,否则直接关 transport
            if (client != null) client.close();
            else if (transport != null) try { transport.close(); } catch (Exception ignore) { }
        }
    }

    /** 读 scope 配置里 name 的已存条目(供测试 env 合并);任何失败按"无存值"返 null。 */
    private JsonNode savedEntryOrNull(String scope, String name) {
        try {
            java.nio.file.Path fp = scopePath(scope);
            if (!Files.exists(fp)) return null;
            JsonNode servers = MAPPER.readTree(fp.toFile()).get("mcpServers");
            return servers == null ? null : servers.get(name);
        } catch (Exception e) {
            return null;
        }
    }

    /** 测试用 env 合并:空串=沿用已存值(与 McpConfigWriter.upsert 密钥编辑语义一致);无存值保持空串。 */
    static Map<String, String> mergeEnvForTest(Map<String, String> formEnv, JsonNode savedEntry) {
        JsonNode savedEnv = savedEntry != null && savedEntry.has("env") && savedEntry.get("env").isObject()
                ? savedEntry.get("env") : null;
        Map<String, String> out = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : formEnv.entrySet()) {
            String v = e.getValue();
            if (v != null && v.isEmpty() && savedEnv != null && savedEnv.hasNonNull(e.getKey())) {
                out.put(e.getKey(), savedEnv.get(e.getKey()).asText());
            } else {
                out.put(e.getKey(), v == null ? "" : v);
            }
        }
        return out;
    }

    /** 组测试失败报文:异常消息 + stderr 尾部(≤5 行),总长截断 500 字符。 */
    private static String buildTestError(Exception ex, com.lyhn.wraith.mcp.transport.StdioTransport transport) {
        StringBuilder sb = new StringBuilder(
                ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage());
        if (transport != null) {
            List<String> lines = transport.stderrLines();
            if (lines != null && !lines.isEmpty()) {
                List<String> tail = lines.subList(Math.max(0, lines.size() - 5), lines.size());
                sb.append('\n').append(String.join("\n", tail));
            }
        }
        String s = sb.toString();
        return s.length() > 500 ? s.substring(0, 500) + "…" : s;
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
