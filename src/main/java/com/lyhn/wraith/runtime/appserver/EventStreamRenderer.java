package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.render.Renderer;
import com.lyhn.wraith.render.StatusInfo;
import com.lyhn.wraith.tool.todo.TodoItem;

import java.io.OutputStream;
import java.io.PrintStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 把 Renderer 语义调用序列化成 JSON-RPC 通知。stdout 纯净：正文走 message.delta，stream() 丢弃。 */
public final class EventStreamRenderer implements Renderer {
    private final JsonRpcWriter writer;
    private final String sessionId;
    private final PrintStream discard = new PrintStream(OutputStream.nullOutputStream());
    private volatile String currentTurnId = "";
    private final java.util.concurrent.atomic.AtomicLong approvalSeq = new java.util.concurrent.atomic.AtomicLong();
    private final Map<String, java.util.concurrent.CompletableFuture<ApprovalResult>> pending =
            new java.util.concurrent.ConcurrentHashMap<>();

    public EventStreamRenderer(JsonRpcWriter writer, String sessionId) {
        this.writer = writer;
        this.sessionId = sessionId;
    }

    public void setCurrentTurnId(String turnId) { this.currentTurnId = turnId; }

    private Map<String, Object> base() {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("sessionId", sessionId);
        p.put("turnId", currentTurnId);
        return p;
    }

    @Override public void start() {}
    @Override public void close() {}
    @Override public PrintStream stream() { return discard; }

    @Override public boolean supportsThinkingPanel() { return true; } // 让 reasoning 走 appendThinking

    @Override public void beginThinking(String label) {
        Map<String, Object> p = base(); p.put("label", label); writer.notify("thinking.begin", p);
    }
    @Override public void appendThinking(String delta) {
        Map<String, Object> p = base(); p.put("text", delta); writer.notify("thinking.delta", p);
    }
    @Override public void endThinking() { writer.notify("thinking.end", base()); }

    @Override public void appendAssistantContentDelta(String delta) {
        Map<String, Object> p = base(); p.put("text", delta); writer.notify("message.delta", p);
    }
    @Override public void finishAssistantContent() { writer.notify("message.end", base()); }

    @Override public void appendToolCalls(List<LlmClient.ToolCall> toolCalls) {
        if (toolCalls == null) return;
        for (LlmClient.ToolCall tc : toolCalls) {
            Map<String, Object> p = base();
            p.put("callId", tc.id());
            p.put("name", tc.function() == null ? "" : tc.function().name());
            p.put("argsJson", tc.function() == null ? "" : tc.function().arguments());
            writer.notify("tool.call", p);
        }
    }

    @Override public void appendToolOutputDelta(String callId, String stream, String chunk) {
        Map<String, Object> p = base(); p.put("callId", callId); p.put("stream", stream); p.put("chunk", chunk);
        writer.notify("tool.output.delta", p);
    }
    @Override public void appendToolResult(String callId, boolean ok, int exitCode) {
        Map<String, Object> p = base(); p.put("callId", callId); p.put("ok", ok); p.put("exitCode", exitCode);
        writer.notify("tool.result", p);
    }

    @Override public void appendDiff(String filePath, String before, String after) {
        Map<String, Object> p = base(); p.put("file", filePath); p.put("before", before); p.put("after", after);
        writer.notify("diff", p);
    }

    @Override public void renderTodos(List<TodoItem> todos) {
        Map<String, Object> p = base(); p.put("items", todos); writer.notify("todos", p);
    }

    @Override public void updateStatus(StatusInfo status) {
        Map<String, Object> p = base(); p.put("status", status); writer.notify("status", p);
    }

    @Override public int openPalette(String title, List<String> items) { return -1; } // v1 不暴露

    @Override public ApprovalResult promptApproval(ApprovalRequest request) {
        String approvalId = "appr_" + approvalSeq.incrementAndGet();
        java.util.concurrent.CompletableFuture<ApprovalResult> fut = new java.util.concurrent.CompletableFuture<>();
        pending.put(approvalId, fut);
        Map<String, Object> p = base();
        p.put("approvalId", approvalId);
        p.put("toolName", request.toolName());
        p.put("argsJson", request.arguments());
        p.put("dangerLevel", request.dangerLevel());
        p.put("riskDescription", request.riskDescription());
        p.put("suggestion", request.suggestion());
        writer.notify("approval.requested", p);
        try {
            return fut.get();
        } catch (Exception e) {
            return new ApprovalResult(ApprovalResult.Decision.REJECTED, null, "interrupted");
        } finally {
            pending.remove(approvalId);
        }
    }

    /** AppServer 收到 approval.respond 时调用。 */
    public void resolveApproval(String approvalId, ApprovalResult result) {
        java.util.concurrent.CompletableFuture<ApprovalResult> fut = pending.get(approvalId);
        if (fut != null) fut.complete(result);
    }
}
