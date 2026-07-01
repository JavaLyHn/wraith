package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.hitl.ApprovalResult;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
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
    }

    private final BufferedReader in;
    private final JsonRpcWriter writer;
    private final SessionRunnerFactory factory;
    private final Map<String, Object> initializeResult;
    private final AtomicLong turnSeq = new AtomicLong();

    private SessionRunner session;
    private String sessionId;
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
                writer.notify("turn.completed", Map.of("sessionId", sessionId, "turnId", turnId, "status", "completed"));
            } catch (Exception e) {
                writer.notify("turn.failed", Map.of("sessionId", sessionId, "turnId", turnId,
                        "error", e.toString()));
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
        ApprovalResult.Decision d;
        try {
            d = ApprovalResult.Decision.valueOf(decision);
        } catch (IllegalArgumentException e) {
            writer.error(msg.id(), -32602, "invalid decision: " + decision);
            return;
        }
        ApprovalResult result = new ApprovalResult(d, modifiedArgs, reason);
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
}
