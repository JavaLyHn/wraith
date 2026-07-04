package com.lyhn.wraith.gateway;

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
import java.util.function.Consumer;

/**
 * 网关侧的可运行 wraith 会话：复刻 {@code Main.startAppServer} 工厂的装配
 * （Agent + HITL 链 + MCP + SessionStore），但把 {@code EventStreamRenderer}
 * 换成 {@link GatewayRenderer}（QQ 单聊通道不流式，只把 HITL 审批路由成 QQ 按钮）。
 *
 * <p>为保持 app-server 零改动，本类采取<b>复刻</b>而非抽取共享工厂。
 *
 * <p>生命周期由 {@code SessionRouter}（Task 9）按 openid 管理，{@code ImTurnDriver}
 * （Task 10）调用 {@link #runTurn(String)} 驱动一轮对话。
 */
public final class GatewaySession {

    private final GatewayRenderer renderer;
    private final Agent agent;
    private final SessionStore store;
    private final McpServerManager mcp; // null 表示 MCP 关闭（单测保持 hermetic）

    /** 生产入口：启用 MCP。 */
    public GatewaySession(String sessionKey, String workspace, LlmClient client, Consumer<String> approvalPusher) {
        this(sessionKey, workspace, client, approvalPusher, true);
    }

    /**
     * 包私构造：{@code enableMcp=false} 供单测保持 hermetic
     * （不触发 {@link McpServerManager} 的真 load/startAll，不 spawn 子进程）。
     */
    GatewaySession(String sessionKey, String workspace, LlmClient client,
                   Consumer<String> approvalPusher, boolean enableMcp) {
        this.renderer = new GatewayRenderer(sessionKey, approvalPusher);

        // HITL 链：Terminal（非交互）→ Switchable，末尾再把 delegate 换成 RendererHitl（与 app-server 工厂同序）。
        TerminalHitlHandler terminal = new TerminalHitlHandler(false);
        SwitchableHitlHandler hitl = new SwitchableHitlHandler(terminal);
        hitl.setEnabled(true);
        HitlToolRegistry registry = new HitlToolRegistry(hitl);

        String root = (workspace != null && !workspace.isBlank())
                ? workspace : Path.of(".").toAbsolutePath().normalize().toString();
        registry.setProjectPath(root);
        registry.setWriteFileObserver((path, ba) -> renderer.appendDiff(path, ba[0], ba[1]));

        // 沙箱：buildAppServerSandbox() 是 cli.Main 的包私方法，本包够不着 → 内联同逻辑。
        // 默认断网，-Dwraith.sandbox.network=on 全局放行网络（与 app-server 口径一致）。
        registry.setCommandSandbox(new CommandSandbox(
                "on".equalsIgnoreCase(System.getProperty("wraith.sandbox.network", "off"))));
        registry.setCommandOutputObserver(new ToolRegistry.CommandOutputObserver() {
            @Override
            public void onChunk(String callId, String stream, String chunk) {
                renderer.appendToolOutputDelta(callId, stream, chunk);
            }

            @Override
            public void onResult(String callId, boolean ok, int exitCode) {
                renderer.appendToolResult(callId, ok, exitCode);
            }
        });

        // MCP（用户选择保留）：绕开 AppServerMcp（其 ensureFor 硬绑 EventStreamRenderer），
        // 直接驱动 McpServerManager。startAll() 会阻塞（all.join），故 load+startAll 放 daemon 线程
        // fail-open；工具在 server READY 后异步注册进 registry（不阻塞首轮对话）。
        if (enableMcp) {
            this.mcp = new McpServerManager(registry, Path.of(root));
            Thread starter = new Thread(() -> {
                try {
                    mcp.loadConfiguredServers();
                    mcp.startAll();
                } catch (Exception e) {
                    System.err.println("[gateway] MCP 启动失败（fail-open）: " + e.getMessage());
                }
            }, "wraith-gateway-mcp-startall");
            starter.setDaemon(true);
            starter.start();
        } else {
            this.mcp = null;
        }

        this.agent = new Agent(client, registry);
        this.agent.setRenderer(renderer);
        // GatewayRenderer.stream() 返回丢弃流；一旦真流式客户端调 onContentDelta，
        // agent.run 默认会返回 ""。开这个开关，runTurn 才能拿到完整助手文本。
        this.agent.setReturnFinalResponseWhenStreamed(true);

        this.store = SessionStore.open(Path.of(System.getProperty("user.home")), root,
                client.getProviderName(), client.getModelName());
        this.store.startNew();

        // 末尾把 HITL delegate 从 terminal 换成 renderer（与 app-server 工厂同序）。
        hitl.setDelegate(new RendererHitlHandler(renderer, hitl.isEnabled()));
    }

    /** 阻塞跑完一轮，返回最终助手文本。 */
    public String runTurn(String input) {
        return agent.run(input);
    }

    /** 返回本会话的 renderer，供 WS 线程解析 HITL 审批（resolveApproval）。 */
    public GatewayRenderer renderer() {
        return renderer;
    }

    /** 落盘会话历史，返回持久 sessionId。 */
    public String persist() {
        store.persist(agent.getConversationHistory());
        return store.currentId();
    }

    /** 关 MCP 子进程（资源卫生；SessionRouter.reset 会调）。 */
    public void close() {
        if (mcp != null) {
            try {
                mcp.close();
            } catch (Exception ignored) {
                // best-effort：关闭失败不影响会话废弃
            }
        }
    }
}
