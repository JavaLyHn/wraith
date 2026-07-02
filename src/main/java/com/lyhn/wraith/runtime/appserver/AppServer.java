package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.hitl.ApprovalResult;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/** stdio JSON-RPC app-server 主循环。v1 单会话。 */
public final class AppServer {

    public interface SessionRunnerFactory {
        SessionRunner create(JsonRpcWriter writer, String sessionId, String workspaceDir);
    }

    public interface SessionRunner {
        EventStreamRenderer renderer();
        String runTurn(String input) throws Exception;
        /** 切换审批模式。auto=true → 关闭 HITL（自动放行）。默认 no-op，旧实现无需改动。 */
        default void setApprovalMode(boolean auto) { }
        /** 本项目历史会话(最近在前)。默认空。 */
        default java.util.List<com.lyhn.wraith.session.SessionMeta> listSessions() {
            return java.util.List.of();
        }
        /** 续接会话:恢复历史进 Agent,返回该会话消息(供 UI 回放)。默认空。 */
        default java.util.List<com.lyhn.wraith.llm.LlmClient.Message> resume(String sessionId) {
            return java.util.List.of();
        }
        /** 落盘当前对话,返回持久化后的真实 sessionId(空对话可能为 null)。默认 no-op。 */
        default String persistTurn() { return null; }
        /** 真回溯:丢弃从第 userOrdinal 条 user 消息(1-based,含)起的全部历史。false=拒绝(超界等)。 */
        default boolean rewind(int userOrdinal) { return false; }
        /** MCP 操作面。实现可返回 null(表示 mcp 不可用)。默认 null。 */
        default McpOps mcp() { return null; }
    }

    private final BufferedReader in;
    private final JsonRpcWriter writer;
    private final SessionRunnerFactory factory;
    private final Map<String, Object> initializeResult;
    private final AtomicLong turnSeq = new AtomicLong();

    private SessionRunner session;
    private volatile String sessionId;
    private volatile Thread turnThread;

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

    public void serve() throws Exception {
        String line;
        while ((line = in.readLine()) != null) {
            JsonRpc.Incoming msg = JsonRpc.parse(line);
            if (msg == null) continue;          // 畸形行跳过
            try {
                if (!dispatch(msg)) break;       // shutdown
            } catch (Exception e) {
                System.err.println("app-server: dispatch error on method "
                        + msg.method() + ": " + e);
            }
        }
    }

    private boolean dispatch(JsonRpc.Incoming msg) {
        switch (msg.method()) {
            case "initialize" -> writer.result(msg.id(), initializeResult);
            case "session.start" -> handleSessionStart(msg);
            case "turn.submit" -> handleTurn(msg);
            case "turn.interrupt" -> {
                Thread t = turnThread;
                if (t != null) t.interrupt();
                writer.result(msg.id(), Map.of("ok", true));
            }
            case "approval.respond" -> handleApprovalRespond(msg);
            case "session.setApprovalMode" -> handleSetApprovalMode(msg);
            case "session.list" -> handleSessionList(msg);
            case "session.resume" -> handleSessionResume(msg);
            case "session.rewind" -> handleSessionRewind(msg);
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
                List<String> args = new ArrayList<>();
                if (p.has("args") && p.get("args").isArray()) p.get("args").forEach(a -> args.add(a.asText()));
                Map<String, String> env = new LinkedHashMap<>();
                if (p.has("env") && p.get("env").isObject())
                    p.get("env").fields().forEachRemaining(e -> env.put(e.getKey(), e.getValue().asText()));
                // IOException 只能在 lambda 内接:Consumer 不声明受检异常;新增会抛 IOException 的 mcp case 需同样内接
                try { ops.configUpsert(scope, name, command, args, env); ok(msg); }
                catch (IOException e) { writer.error(msg.id(), -32000, "配置写入失败: " + e.getMessage()); }
            });
            case "mcp.config.remove" -> handleMcp(msg, ops -> {
                JsonNode p = msg.params();
                String scope = textParam(p, "scope"); String name = textParam(p, "name");
                if (scope == null || name == null) { writer.error(msg.id(), -32602, "缺 scope/name"); return; }
                try {
                    if (!ops.configRemove(scope, name)) { writer.error(msg.id(), -32000, "该层级无此配置: " + name); return; }
                    ok(msg);
                } catch (IOException e) { writer.error(msg.id(), -32000, "配置写入失败: " + e.getMessage()); }
            });
            case "shutdown" -> {
                writer.result(msg.id(), Map.of("ok", true));
                return false;
            }
            default -> {
                if (!msg.isNotification()) writer.error(msg.id(), -32601, "method not found: " + msg.method());
            }
        }
        return true;
    }

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

    private void handleTurn(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        Thread running = turnThread;
        if (running != null && running.isAlive()) {
            writer.error(msg.id(), -32000, "turn in progress");
            return;
        }
        JsonNode params = msg.params();
        String input = (params != null && params.hasNonNull("input")) ? params.get("input").asText() : "";
        String turnId = "turn_" + turnSeq.incrementAndGet();
        session.renderer().setCurrentTurnId(turnId);
        writer.result(msg.id(), Map.of("turnId", turnId, "status", "running"));
        writer.notify("turn.started", Map.of("sessionId", sessionId, "turnId", turnId));
        Thread t = new Thread(() -> {
            try {
                session.runTurn(input);
                String persisted = session.persistTurn();
                String reported = (persisted != null) ? persisted : sessionId;
                if (persisted != null) sessionId = persisted;
                writer.notify("turn.completed", Map.of("sessionId", reported, "turnId", turnId, "status", "completed"));
            } catch (Exception e) {
                writer.notify("turn.failed", Map.of("sessionId", sessionId, "turnId", turnId, "error", e.toString()));
            }
        }, "wraith-appserver-turn");
        t.setDaemon(true);
        turnThread = t;
        t.start();
    }

    private void handleApprovalRespond(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        if (msg.params() == null) { writer.error(msg.id(), -32602, "missing params"); return; }
        JsonNode p = msg.params();
        String approvalId = p.path("approvalId").asText("");
        String decision = p.path("decision").asText("REJECTED");
        String modifiedArgs = p.hasNonNull("modifiedArgs") ? p.get("modifiedArgs").asText() : null;
        String reason = p.hasNonNull("reason") ? p.get("reason").asText() : null;
        boolean allowNetwork = p.path("allowNetwork").asBoolean(false);
        ApprovalResult.Decision d;
        try {
            d = ApprovalResult.Decision.valueOf(decision);
        } catch (IllegalArgumentException e) {
            writer.error(msg.id(), -32602, "invalid decision: " + decision);
            return;
        }
        ApprovalResult result = new ApprovalResult(d, modifiedArgs, reason, allowNetwork);
        session.renderer().resolveApproval(approvalId, result);
        writer.result(msg.id(), java.util.Map.of("ok", true));
    }

    private void handleSetApprovalMode(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        boolean auto = p != null && p.path("auto").asBoolean(false);
        session.setApprovalMode(auto);
        writer.result(msg.id(), Map.of("ok", true));
    }

    private void handleSessionList(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        writer.result(msg.id(), Map.of("sessions", session.listSessions()));
    }

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
            if (name == null) { writer.error(msg.id(), -32602, "缺 name"); return; }
            action.accept(ops, name);
        });
    }

    private void handleSessionRewind(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        Thread t = turnThread;
        if (t != null && t.isAlive()) { writer.error(msg.id(), -32000, "turn running"); return; }
        JsonNode p = msg.params();
        int ordinal = p == null ? 0 : p.path("userOrdinal").asInt(0);
        if (ordinal < 1) { writer.error(msg.id(), -32602, "missing userOrdinal"); return; }
        if (!session.rewind(ordinal)) { writer.error(msg.id(), -32000, "rewind failed"); return; }
        writer.result(msg.id(), Map.of("ok", true));
    }

    private void handleSessionResume(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String id = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (id.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        java.util.List<com.lyhn.wraith.llm.LlmClient.Message> msgs = session.resume(id);
        java.util.List<com.fasterxml.jackson.databind.node.ObjectNode> wire = new java.util.ArrayList<>();
        for (com.lyhn.wraith.llm.LlmClient.Message m : msgs) {
            wire.add(com.lyhn.wraith.session.SessionMessageCodec.toJson(JsonRpc.MAPPER, m));
        }
        sessionId = id; // 活跃会话切到 resume 的
        writer.result(msg.id(), Map.of("sessionId", id, "messages", wire));
    }
}
