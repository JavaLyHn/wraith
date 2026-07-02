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

    // 惰性 thinking 块:Agent 在每次 LLM 调用前无条件 beginThinking,但非 reasoning
    // 模型(如 DeepSeek-V4-Flash)整段不产生思考流——空 begin/end 对不得上 wire,
    // 否则桌面端每步渲染一根空折叠条。首个 delta 到达才真正发 begin。
    private String pendingThinkingLabel = null;
    private boolean thinkingOpen = false;

    @Override public void beginThinking(String label) {
        pendingThinkingLabel = (label == null) ? "" : label;
    }
    @Override public void appendThinking(String delta) {
        if (pendingThinkingLabel != null) {
            Map<String, Object> b = base(); b.put("label", pendingThinkingLabel);
            writer.notify("thinking.begin", b);
            pendingThinkingLabel = null;
        }
        thinkingOpen = true; // 裸 delta(无 begin)也视为开块,保持 endThinking 语义
        Map<String, Object> p = base(); p.put("text", delta); writer.notify("thinking.delta", p);
    }
    @Override public void endThinking() {
        pendingThinkingLabel = null;
        if (thinkingOpen) {
            thinkingOpen = false;
            writer.notify("thinking.end", base());
        }
    }

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

    /** MCP server 状态通知(Phase E-1):starting/ready/disabled/error;error 空白则省略字段。 */
    public void emitMcpStatus(String name, String state, String error) {
        Map<String, Object> p = base();
        p.put("name", name);
        p.put("state", state);
        if (error != null && !error.isBlank()) p.put("error", error);
        writer.notify("mcp.status", p);
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
        p.put("beforeContent", request.beforeContent()); // 可空;LinkedHashMap 允许 null → JSON null
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
