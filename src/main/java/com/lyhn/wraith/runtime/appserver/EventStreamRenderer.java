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

    // ---- 卡片事件录制（null = 关闭；非 null = 录制中）----
    private volatile java.util.List<Map<String, Object>> cardRecording; // null=关闭；volatile for cross-thread visibility
    private final PrintStream discard = new PrintStream(OutputStream.nullOutputStream());
    private volatile String currentTurnId = "";
    private final java.util.concurrent.atomic.AtomicLong approvalSeq = new java.util.concurrent.atomic.AtomicLong();
    private final Map<String, java.util.concurrent.CompletableFuture<ApprovalResult>> pending =
            new java.util.concurrent.ConcurrentHashMap<>();

    // 计划复审管道（镜像 approval 管道，独立字段避免干扰）
    private final java.util.concurrent.atomic.AtomicLong reviewSeq = new java.util.concurrent.atomic.AtomicLong();
    private final Map<String, java.util.concurrent.CompletableFuture<PlanReviewOutcome>> pendingReviews =
            new java.util.concurrent.ConcurrentHashMap<>();

    /** 计划复审结果；decision ∈ {"execute","supplement","cancel"}。 */
    public record PlanReviewOutcome(String decision, String feedback) {}

    public EventStreamRenderer(JsonRpcWriter writer, String sessionId) {
        this.writer = writer;
        this.sessionId = sessionId;
    }

    public void setCurrentTurnId(String turnId) { this.currentTurnId = turnId; }

    // ---- 卡片录制公共 API ----

    /** 开始录制本轮卡片事件（plan.{@literal *}/team.{@literal *} 方法，plan.review.requested 除外）。 */
    public void startCardRecording() { this.cardRecording = java.util.Collections.synchronizedList(new java.util.ArrayList<>()); }

    /**
     * 返回本轮录制并合流后的事件列表；关闭录制。无录制 → 空列表。
     * 每项格式：{"method": String, "params": Map}。
     */
    public List<Map<String, Object>> stopCardRecording() {
        java.util.List<Map<String, Object>> raw = cardRecording == null
                ? java.util.List.of() : cardRecording;
        cardRecording = null;
        return coalesce(raw);
    }

    /** 判断是否为卡片事件（plan.* 或 team.*，但排除 plan.review.requested）。 */
    private static boolean isCardMethod(String m) {
        return (m.startsWith("plan.") || m.startsWith("team."))
                && !m.equals("plan.review.requested");
    }

    /**
     * 统一出口：录制开启且是卡片事件则缓存，再照常 notify。
     * 录制关闭时与直接 writer.notify(method, p) 行为完全一致。
     */
    private void emit(String method, Map<String, Object> p) {
        java.util.List<Map<String, Object>> buf = cardRecording; // read volatile field once into local
        if (buf != null && isCardMethod(method)) {
            Map<String, Object> rec = new java.util.LinkedHashMap<>();
            rec.put("method", method);
            rec.put("params", new java.util.LinkedHashMap<>(p)); // 浅拷贝，防后续复用
            buf.add(rec);
        }
        writer.notify(method, p);
    }

    /** 合并连续同通道 *.output（method 相同且除 text 外字段全等）→ text 拼接。 */
    private static List<Map<String, Object>> coalesce(List<Map<String, Object>> in) {
        java.util.List<Map<String, Object>> out = new java.util.ArrayList<>();
        for (Map<String, Object> ev : in) {
            String method = (String) ev.get("method");
            boolean isOutput = method.endsWith(".output");
            if (isOutput && !out.isEmpty()) {
                Map<String, Object> prev = out.get(out.size() - 1);
                if (sameChannel(prev, ev)) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> pp = (Map<String, Object>) prev.get("params");
                    @SuppressWarnings("unchecked")
                    Map<String, Object> cp = (Map<String, Object>) ev.get("params");
                    pp.put("text", String.valueOf(pp.getOrDefault("text", ""))
                            + String.valueOf(cp.getOrDefault("text", "")));
                    continue;
                }
            }
            out.add(ev);
        }
        return out;
    }

    private static boolean sameChannel(Map<String, Object> a, Map<String, Object> b) {
        if (!java.util.Objects.equals(a.get("method"), b.get("method"))) return false;
        @SuppressWarnings("unchecked")
        Map<String, Object> pa = new java.util.HashMap<>((Map<String, Object>) a.get("params"));
        @SuppressWarnings("unchecked")
        Map<String, Object> pb = new java.util.HashMap<>((Map<String, Object>) b.get("params"));
        pa.remove("text");
        pb.remove("text");
        return pa.equals(pb);
    }

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

    // ---- plan.* 通知发射方法（供 Task A5 的 sink 调用）----

    /** 计划已创建通知。 */
    public void emitPlanCreated(String planId, String goal, java.util.List<java.util.Map<String, Object>> steps) {
        Map<String, Object> p = base(); p.put("planId", planId); p.put("goal", goal); p.put("steps", steps);
        emit("plan.created", p);
    }

    /** 计划步骤开始通知。 */
    public void emitPlanStepStarted(String planId, String stepId) {
        Map<String, Object> p = base(); p.put("planId", planId); p.put("stepId", stepId);
        emit("plan.step.started", p);
    }

    /** 计划步骤完成通知。 */
    public void emitPlanStepCompleted(String planId, String stepId, boolean ok, String result) {
        Map<String, Object> p = base(); p.put("planId", planId); p.put("stepId", stepId);
        p.put("ok", ok); p.put("result", result);
        emit("plan.step.completed", p);
    }

    /** 计划步骤流式正文片段（嵌套在清单步骤行下方，不浮动为独立 message）。 */
    public void emitPlanStepOutput(String planId, String stepId, String text) {
        Map<String, Object> p = base(); p.put("planId", planId); p.put("stepId", stepId); p.put("text", text);
        emit("plan.step.output", p);
    }

    // ---- 计划复审阻塞管道（镜像 promptApproval）----

    /**
     * 请求前端复审计划。阻塞直到 resolvePlanReview 被调用。
     * 中断或异常时返回 cancel 结果，避免 agent 线程悬挂。
     */
    public PlanReviewOutcome requestPlanReview(String planId, String goal,
                                               java.util.List<java.util.Map<String, Object>> steps) {
        String reviewId = "review_" + reviewSeq.incrementAndGet();
        java.util.concurrent.CompletableFuture<PlanReviewOutcome> fut = new java.util.concurrent.CompletableFuture<>();
        pendingReviews.put(reviewId, fut);
        Map<String, Object> p = base();
        p.put("reviewId", reviewId); p.put("planId", planId); p.put("goal", goal); p.put("steps", steps);
        emit("plan.review.requested", p);
        try {
            return fut.get();
        } catch (Exception e) {
            return new PlanReviewOutcome("cancel", null);   // 中断/异常 → 取消，避免线程悬挂
        } finally {
            pendingReviews.remove(reviewId);
        }
    }

    /** AppServer 收到 plan.review.respond 时调用；未知 reviewId 幂等忽略。 */
    public void resolvePlanReview(String reviewId, String decision, String feedback) {
        java.util.concurrent.CompletableFuture<PlanReviewOutcome> fut = pendingReviews.get(reviewId);
        if (fut != null) fut.complete(new PlanReviewOutcome(decision == null ? "cancel" : decision, feedback));
    }

    // ---- team.* 通知发射方法（供 EventStreamTeamListener 调用）----
    // JsonRpcWriter.notify 内部已 synchronized，多线程并发调用安全，无需额外锁。

    /** 多 Agent 协作开始通知。 */
    public void emitTeamStarted(String teamId, String goal, List<Map<String, Object>> agents) {
        Map<String, Object> p = base(); p.put("teamId", teamId); p.put("goal", goal); p.put("agents", agents);
        emit("team.started", p);
    }

    /** 协作计划已解析通知。 */
    public void emitTeamPlan(String teamId, List<Map<String, Object>> steps) {
        Map<String, Object> p = base(); p.put("teamId", teamId); p.put("steps", steps);
        emit("team.plan", p);
    }

    /** 批次启动通知。 */
    public void emitTeamBatch(String teamId, int batchIndex, List<String> stepIds) {
        Map<String, Object> p = base(); p.put("teamId", teamId); p.put("batchIndex", batchIndex); p.put("stepIds", stepIds);
        emit("team.batch", p);
    }

    /** 协作步骤开始通知（可并发触发）。 */
    public void emitTeamStepStarted(String teamId, String stepId, String agent) {
        Map<String, Object> p = base(); p.put("teamId", teamId); p.put("stepId", stepId); p.put("agent", agent);
        emit("team.step.started", p);
    }

    /** 协作步骤完成通知（可并发触发）。 */
    public void emitTeamStepCompleted(String teamId, String stepId, String status, String result,
                                      boolean approved, int retries) {
        Map<String, Object> p = base();
        p.put("teamId", teamId); p.put("stepId", stepId); p.put("status", status);
        p.put("result", result); p.put("approved", approved); p.put("retries", retries);
        emit("team.step.completed", p);
    }

    /** 多 Agent 协作结束通知。 */
    public void emitTeamFinished(String teamId, String status) {
        Map<String, Object> p = base(); p.put("teamId", teamId); p.put("status", status);
        emit("team.finished", p);
    }

    /** Planner LLM 流式正文片段（嵌套在 TeamCard 计划行下，不浮动为独立 message）。 */
    public void emitTeamPlanOutput(String teamId, String text) {
        Map<String, Object> p = base(); p.put("teamId", teamId); p.put("text", text);
        emit("team.plan.output", p);
    }

    /** 协作步骤 LLM 流式正文片段（嵌套在 TeamCard 步骤行下，不浮动为独立 message）。 */
    public void emitTeamStepOutput(String teamId, String stepId, String text) {
        Map<String, Object> p = base(); p.put("teamId", teamId); p.put("stepId", stepId); p.put("text", text);
        emit("team.step.output", p);
    }

    /** 协作步骤审查 LLM 流式正文片段（嵌套在 TeamCard 步骤行下，标识为 reviewer 输出）。 */
    public void emitTeamReviewOutput(String teamId, String stepId, String text) {
        Map<String, Object> p = base(); p.put("teamId", teamId); p.put("stepId", stepId); p.put("text", text);
        emit("team.review.output", p);
    }
}
