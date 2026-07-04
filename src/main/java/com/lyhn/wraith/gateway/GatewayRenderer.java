package com.lyhn.wraith.gateway;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.render.Renderer;
import com.lyhn.wraith.render.StatusInfo;

import java.io.OutputStream;
import java.io.PrintStream;
import java.util.List;
import java.util.concurrent.*;
import java.util.function.Consumer;

/**
 * 网关用 Renderer:QQ 不流式,只把 HITL 审批路由成 QQ 按钮;其余回调 no-op。
 *
 * <p>核心职责:
 * <ol>
 *   <li>{@link #promptApproval} — 阻塞在 CompletableFuture 上,先调 approvalPusher 发 QQ 按钮。</li>
 *   <li>{@link #resolveApproval} — 由 WS 线程收到按钮回调后调用,完成 future。</li>
 * </ol>
 * 其他 Renderer 方法对 QQ 通道无意义,均为 no-op 或安全默认值。
 */
public final class GatewayRenderer implements Renderer {

    private final String sessionKey;
    private final Consumer<String> approvalPusher; // 收 sessionKey,负责发 QQ 审批按钮

    /**
     * Discarding sink — ensures {@link #stream()} never returns null and
     * {@link #close()} has something to close.
     */
    private final PrintStream sink = new PrintStream(OutputStream.nullOutputStream());

    /** Pending HITL future; volatile so the WS thread sees it promptly. */
    private volatile CompletableFuture<ApprovalResult> pending;

    /** 审批等待上限：QQ 用户可能不在场，超时后 fail-closed 拒绝，避免回合永久阻塞。 */
    static final long DEFAULT_APPROVAL_TIMEOUT_MS = 300_000; // 5 分钟

    private final long approvalTimeoutMs;

    public GatewayRenderer(String sessionKey, Consumer<String> approvalPusher) {
        this(sessionKey, approvalPusher, DEFAULT_APPROVAL_TIMEOUT_MS);
    }

    /** 可注入超时时长的构造（供测试与调优）。 */
    GatewayRenderer(String sessionKey, Consumer<String> approvalPusher, long approvalTimeoutMs) {
        this.sessionKey = sessionKey;
        this.approvalPusher = approvalPusher;
        this.approvalTimeoutMs = approvalTimeoutMs;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core HITL methods
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 阻塞直到 WS 线程通过 {@link #resolveApproval} 传入结果。
     * 先调 approvalPusher(sessionKey) 触发 QQ 审批按钮推送。
     */
    @Override
    public ApprovalResult promptApproval(ApprovalRequest request) {
        CompletableFuture<ApprovalResult> f = new CompletableFuture<>();
        this.pending = f;
        try {
            approvalPusher.accept(sessionKey); // 触发 QQ 审批按钮推送
        } catch (RuntimeException e) {
            // 推送失败（网络/QQ 拒绝）→ fail-closed 默认拒绝，绝不让回合永久阻塞在下面的 get()。
            this.pending = null;
            return ApprovalResult.reject("审批推送失败，已默认拒绝");
        }
        try {
            return f.get(approvalTimeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            // 用户一直没点 → fail-closed，避免无限阻塞占用会话线程。
            return ApprovalResult.reject("审批超时（未在限定时间内点击），已默认拒绝");
        } catch (Exception e) {
            return ApprovalResult.reject("interrupted");
        } finally {
            this.pending = null;
        }
    }

    /**
     * 由 WS 线程收到按钮回调后调用。完成 pending future；若无则忽略。
     */
    public void resolveApproval(ApprovalResult result) {
        CompletableFuture<ApprovalResult> f = this.pending;
        if (f != null) {
            f.complete(result);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer abstract methods — no-op / safe defaults for QQ channel
    // ─────────────────────────────────────────────────────────────────────────

    /** No-op — QQ gateway has no terminal to set up. */
    @Override
    public void start() {
    }

    /** Returns a discarding (null-output) PrintStream — never null. */
    @Override
    public PrintStream stream() {
        return sink;
    }

    /** Closes the discarding sink. */
    @Override
    public void close() {
        sink.close();
    }

    /** No-op — QQ channel does not render tool-call labels inline. */
    @Override
    public void appendToolCalls(List<LlmClient.ToolCall> toolCalls) {
    }

    /** No-op — QQ channel does not display file diffs. */
    @Override
    public void appendDiff(String filePath, String before, String after) {
    }

    /** No-op — QQ channel has no status bar. */
    @Override
    public void updateStatus(StatusInfo status) {
    }

    /**
     * Returns -1 (cancel / no selection) — QQ has no interactive palette.
     */
    @Override
    public int openPalette(String title, List<String> items) {
        return -1;
    }
}
