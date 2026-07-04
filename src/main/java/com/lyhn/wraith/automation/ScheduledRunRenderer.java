package com.lyhn.wraith.automation;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.render.Renderer;
import com.lyhn.wraith.render.StatusInfo;

import java.io.OutputStream;
import java.io.PrintStream;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Renderer for unattended scheduled agent runs.
 *
 * <p>Non-approval Renderer methods are no-ops: there is no interactive UI to stream
 * into during a scheduled (daemon-hosted) run. Only {@link #promptApproval} carries
 * real policy logic via the injected {@link ApprovalPolicy}:
 *
 * <ul>
 *   <li>DENY → reject immediately (fail-closed, no AskSurface invoked)</li>
 *   <li>AUTO_APPROVE → approve immediately</li>
 *   <li>ASK → delegate to {@link AskSurface}; block with a bounded timeout;
 *       reject on timeout or any exception (fail-closed)</li>
 * </ul>
 *
 * <p>Tools denied this run (DENY or ASK-timeout) are recorded in {@link #deniedTools()}.
 */
public final class ScheduledRunRenderer implements Renderer {

    /**
     * Callback interface that surfaces an ASK-mode approval to an external channel
     * (e.g., desktop UI or QQ) and returns a CompletableFuture that resolves when
     * the operator makes a decision. Phase 1 callers may supply a stub that never
     * completes (triggering the timeout path).
     */
    @FunctionalInterface
    public interface AskSurface {
        /**
         * @param runId the current scheduled-run identifier
         * @param req   the approval request
         * @return a future that will be completed with the operator's decision,
         *         or left incomplete (which causes timeout → reject)
         */
        CompletableFuture<ApprovalResult> surface(String runId, ApprovalRequest req);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    private final ApprovalPolicy policy;
    private final long askTimeoutMs;
    private final AskSurface askSurface;

    private volatile String runId = "";

    /** Tools denied (DENY or ASK-timeout) during this run. Thread-safe. */
    private final CopyOnWriteArrayList<String> deniedTools = new CopyOnWriteArrayList<>();

    /** Discarding sink — stream() must never return null. */
    private final PrintStream sink = new PrintStream(OutputStream.nullOutputStream());

    // ─────────────────────────────────────────────────────────────────────────
    // Construction
    // ─────────────────────────────────────────────────────────────────────────

    public ScheduledRunRenderer(ApprovalPolicy policy, long askTimeoutMs, AskSurface askSurface) {
        this.policy = policy;
        this.askTimeoutMs = askTimeoutMs;
        this.askSurface = askSurface;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Run-scoped state
    // ─────────────────────────────────────────────────────────────────────────

    /** Set the identifier for the current scheduled run (used when surfacing ASK). */
    public void setRunId(String runId) {
        this.runId = runId == null ? "" : runId;
    }

    /**
     * Returns the tool names denied (via DENY or ASK-timeout) during this run.
     * Callers may include this list in the delivery summary.
     */
    public List<String> deniedTools() {
        return List.copyOf(deniedTools);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core HITL — policy-driven approval
    // ─────────────────────────────────────────────────────────────────────────

    @Override
    public ApprovalResult promptApproval(ApprovalRequest request) {
        String tool = request.toolName();
        ApprovalMode mode = policy.resolve(tool);

        switch (mode) {
            case DENY:
                deniedTools.add(tool);
                return ApprovalResult.reject("tool denied by scheduled-run policy: " + tool);

            case AUTO_APPROVE:
                return ApprovalResult.approve();

            case ASK: {
                CompletableFuture<ApprovalResult> future;
                try {
                    future = askSurface.surface(runId, request);
                } catch (Exception e) {
                    // AskSurface itself threw — fail-closed
                    deniedTools.add(tool);
                    return ApprovalResult.reject("ask surface error: " + e.getMessage());
                }
                try {
                    return future.get(askTimeoutMs, TimeUnit.MILLISECONDS);
                } catch (TimeoutException e) {
                    deniedTools.add(tool);
                    return ApprovalResult.reject("scheduled ask timeout");
                } catch (Exception e) {
                    deniedTools.add(tool);
                    return ApprovalResult.reject("interrupted");
                }
            }

            default:
                // Unknown / future ApprovalMode — fail-closed, never surface
                deniedTools.add(tool);
                return ApprovalResult.reject("unknown approval mode: " + mode);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer abstract methods — no-op / safe defaults for scheduled runs
    // ─────────────────────────────────────────────────────────────────────────

    /** No-op — scheduled runs have no interactive terminal to set up. */
    @Override
    public void start() {
    }

    /** Returns a discarding (null-output) PrintStream — never null. */
    @Override
    public PrintStream stream() {
        return sink;
    }

    /** No-op — the shared null-output sink requires no cleanup. */
    @Override
    public void close() {
        // discard sink needs no cleanup; do not close the shared sink so stream() stays usable
    }

    /** No-op — scheduled runs do not render tool-call labels inline. */
    @Override
    public void appendToolCalls(List<LlmClient.ToolCall> toolCalls) {
    }

    /** No-op — scheduled runs do not display file diffs. */
    @Override
    public void appendDiff(String filePath, String before, String after) {
    }

    /** No-op — scheduled runs have no status bar. */
    @Override
    public void updateStatus(StatusInfo status) {
    }

    /**
     * Returns -1 (cancel / no selection) — scheduled runs have no interactive palette.
     */
    @Override
    public int openPalette(String title, List<String> items) {
        return -1;
    }
}
