package com.lyhn.wraith.automation;

import com.lyhn.wraith.agent.Agent;
import com.lyhn.wraith.hitl.HitlToolRegistry;
import com.lyhn.wraith.hitl.RendererHitlHandler;
import com.lyhn.wraith.hitl.SwitchableHitlHandler;
import com.lyhn.wraith.hitl.TerminalHitlHandler;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.mcp.McpServerManager;
import com.lyhn.wraith.policy.sandbox.CommandSandbox;
import com.lyhn.wraith.session.SessionStore;
import com.lyhn.wraith.tool.ToolRegistry;

import java.nio.file.Path;
import java.util.List;

/**
 * AutomationRunner — 进程内跑一轮 → RunResult.
 *
 * <p>此类是命名空间容器，包含三个公共类型：
 * <ul>
 *   <li>{@link TurnEngine} — 接口；Scheduler（Task 6）依赖此接口而非具体类，
 *       便于单测注入假引擎。</li>
 *   <li>{@link RunResult} — 一轮运行结果 record。</li>
 *   <li>{@link InProcessTurnEngine} — 真实实现；装配逻辑逐行复刻
 *       {@code GatewaySession}，将 {@code GatewayRenderer} 换成
 *       {@link ScheduledRunRenderer}，observers 全部 no-op。</li>
 * </ul>
 */
public final class AutomationRunner {

    private AutomationRunner() { /* utility namespace — do not instantiate */ }

    // ─────────────────────────────────────────────────────────────────────────
    // TurnEngine interface
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Thin abstraction over "run one automation turn".
     * Scheduler (Task 6) depends on this interface so it can inject a fake engine
     * for deterministic unit tests without touching the network or LLM.
     */
    @FunctionalInterface
    public interface TurnEngine {
        RunResult run(AutomationTask task);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RunResult record
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * The result of a single automation turn.
     *
     * @param status      {@code "success"} or {@code "failed"}
     * @param answer      the LLM's final answer text (or an error message on failure)
     * @param sessionId   the persisted session id, or {@code null} on failure
     * @param deniedTools tool names denied (DENY or ASK-timeout) during this run
     */
    public record RunResult(
            String status,
            String answer,
            String sessionId,
            List<String> deniedTools
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // InProcessTurnEngine — real engine, mirrors GatewaySession assembly
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Production {@link TurnEngine} that runs a turn in-process.
     *
     * <p>Assembly mirrors {@code GatewaySession} constructor (HITL chain →
     * registry → sandbox → observers → optional MCP → Agent → SessionStore),
     * with two substitutions:
     * <ul>
     *   <li>{@link ScheduledRunRenderer} replaces {@code GatewayRenderer}.</li>
     *   <li>Write-file and command-output observers are no-ops: there is no
     *       interactive UI to stream to during an unattended scheduled run.</li>
     * </ul>
     *
     * <p>Constructor: {@code (LlmClient, AskSurface, int defaultAskTimeoutMinutes)}.
     *
     * <p>NOT unit-tested directly — it touches network / LLM and is verified by
     * eye-verify in Phase 1 integration. The {@link TurnEngine} contract is tested
     * via a fake lambda engine in {@code AutomationRunnerTest}.
     */
    public static final class InProcessTurnEngine implements TurnEngine {

        private final LlmClient client;
        private final ScheduledRunRenderer.AskSurface askSurface;
        private final int defaultAskTimeoutMinutes;

        /**
         * @param client                   the LLM client to use for inference
         * @param askSurface               callback that surfaces ASK-mode approvals
         *                                 to an external channel (desktop, QQ, etc.)
         * @param defaultAskTimeoutMinutes fallback timeout when the task's
         *                                 ApprovalPolicy does not specify askTimeoutMinutes
         */
        public InProcessTurnEngine(LlmClient client,
                                   ScheduledRunRenderer.AskSurface askSurface,
                                   int defaultAskTimeoutMinutes) {
            this.client = client;
            this.askSurface = askSurface;
            this.defaultAskTimeoutMinutes = defaultAskTimeoutMinutes;
        }

        /**
         * Runs one automation turn in-process and returns the result.
         *
         * <p>Assembly order mirrors {@code GatewaySession}:
         * <ol>
         *   <li>Build {@link ScheduledRunRenderer} (substitutes GatewayRenderer).</li>
         *   <li>HITL chain: {@code TerminalHitlHandler → SwitchableHitlHandler →
         *       HitlToolRegistry}.</li>
         *   <li>CommandSandbox wired same as GatewaySession.</li>
         *   <li>Observers no-op (no UI to stream to).</li>
         *   <li>Optionally start {@link McpServerManager} on a daemon thread (fail-open).</li>
         *   <li>Build {@link Agent}, wire renderer, enable
         *       {@code returnFinalResponseWhenStreamed}.</li>
         *   <li>Open {@link SessionStore} + {@code startNew()}.</li>
         *   <li>Tail-swap: replace HITL delegate with {@link RendererHitlHandler}
         *       (same order as GatewaySession).</li>
         * </ol>
         */
        @Override
        public RunResult run(AutomationTask task) {
            // ── resolve workspace root ────────────────────────────────────────
            String root = (task.workspace != null && !task.workspace.isBlank())
                    ? task.workspace
                    : Path.of(".").toAbsolutePath().normalize().toString();

            // ── renderer (substitutes GatewayRenderer) ───────────────────────
            ApprovalPolicy policy = task.approval != null ? task.approval : new ApprovalPolicy();
            long askTimeoutMs = (long) policy.askTimeoutMinutesOr(defaultAskTimeoutMinutes) * 60_000L;
            ScheduledRunRenderer scheduledRenderer =
                    new ScheduledRunRenderer(policy, askTimeoutMs, askSurface);
            scheduledRenderer.setRunId(task.id != null ? task.id : "");

            // ── HITL chain: Terminal → Switchable → HitlToolRegistry ──────────
            TerminalHitlHandler terminal = new TerminalHitlHandler(false);
            SwitchableHitlHandler hitl = new SwitchableHitlHandler(terminal);
            hitl.setEnabled(true);
            HitlToolRegistry registry = new HitlToolRegistry(hitl);

            registry.setProjectPath(root);

            // Observers: no-op — scheduled/unattended run, no UI to stream to.
            // Do NOT invent ScheduledRunRenderer methods: observers silently discard.
            registry.setWriteFileObserver((path, ba) -> { /* no-op */ });
            registry.setCommandSandbox(new CommandSandbox(
                    "on".equalsIgnoreCase(System.getProperty("wraith.sandbox.network", "off"))));
            registry.setCommandOutputObserver(new ToolRegistry.CommandOutputObserver() {
                @Override public void onChunk(String callId, String stream, String chunk) { /* no-op */ }
                @Override public void onResult(String callId, boolean ok, int exitCode) { /* no-op */ }
            });

            // ── MCP: fail-open on daemon thread, same pattern as GatewaySession ─
            McpServerManager mcp = new McpServerManager(registry, Path.of(root));
            Thread starter = new Thread(() -> {
                try {
                    mcp.loadConfiguredServers();
                    mcp.startAll();
                } catch (Exception e) {
                    System.err.println("[automation] MCP 启动失败（fail-open）: " + e.getMessage());
                }
            }, "wraith-automation-mcp-startall");
            starter.setDaemon(true);
            starter.start();

            // ── Agent ─────────────────────────────────────────────────────────
            Agent agent = new Agent(client, registry);
            agent.setRenderer(scheduledRenderer);
            agent.setReturnFinalResponseWhenStreamed(true);

            // ── SessionStore ──────────────────────────────────────────────────
            SessionStore store = SessionStore.open(
                    Path.of(System.getProperty("user.home")),
                    root,
                    client.getProviderName(),
                    client.getModelName());
            store.startNew();

            // ── tail-swap HITL delegate (same order as GatewaySession) ─────────
            hitl.setDelegate(new RendererHitlHandler(scheduledRenderer, hitl.isEnabled()));

            // ── run turn ──────────────────────────────────────────────────────
            try {
                String answer = agent.run(task.prompt);
                store.persist(agent.getConversationHistory());
                String sessionId = store.currentId();
                return new RunResult("success", answer, sessionId, scheduledRenderer.deniedTools());
            } catch (Exception e) {
                return new RunResult("failed", "运行失败: " + e.getMessage(),
                        null, scheduledRenderer.deniedTools());
            } finally {
                try {
                    mcp.close();
                } catch (Exception ignored) {
                    // best-effort: close failure does not affect run result
                }
            }
        }
    }
}
