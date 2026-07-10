package com.lyhn.wraith.gateway.wecom;

import com.lyhn.wraith.automation.delivery.DeliveryAdapter;
import com.lyhn.wraith.automation.delivery.WecomDeliveryAdapter;
import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.gateway.Authorizer;
import com.lyhn.wraith.gateway.GatewaySession;
import com.lyhn.wraith.gateway.ImTurnDriver;
import com.lyhn.wraith.gateway.SessionRouter;
import com.lyhn.wraith.gateway.qq.Dedup;
import com.lyhn.wraith.gateway.qq.InboundMsg;
import com.lyhn.wraith.gateway.spi.ImProvider;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import okhttp3.OkHttpClient;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 企业微信单聊 provider:okhttp 长连接收 aibot_msg_callback + 同链回 aibot_respond_msg。
 * 会话 key=userid;回复透传 agent markdown(企微原生渲染)。构造不触网;start() 起守护线程。
 * Phase B:卡片 HITL + 主人 chatid 捕获 + 定时审批呈现 + 投递适配器。
 */
public final class WecomProvider implements ImProvider {

    private final String ownerUserid;
    private final WecomWsClient ws;
    private final Runnable wsLoop;
    private final ExecutorService pool;
    private volatile Thread thread;

    /** 主人最近 chatid,用于主动推送卡片。运行期由 onInbound 捕获。 */
    volatile String ownerChatId;

    private final WecomDeliveryAdapter deliver;

    /** 生产构造:建 ws + 会话路由 + driver,组好阻塞 WS 回路。构造不触网。 */
    public WecomProvider(WraithConfig.GatewayWecomConfig cfg,
                         LlmClient client,
                         Map<String, CompletableFuture<ApprovalResult>> pendingApprovals) {
        this.ownerUserid = cfg.getOwnerUserid();
        this.ws = new WecomWsClient(new OkHttpClient(), cfg.getBotId(), cfg.getSecret());
        this.pool = Executors.newCachedThreadPool();

        Authorizer authz = new Authorizer(this.ownerUserid);
        Dedup dedup = new Dedup(1000);
        boolean ownerBound = this.ownerUserid != null && !this.ownerUserid.isBlank();

        // 投递适配器:懒取 ownerChatId,发送走 ws.sendMarkdown
        this.deliver = new WecomDeliveryAdapter(() -> ownerChatId,
                (chatId, text) -> ws.sendMarkdown(chatId, text));

        SessionRouter router = new SessionRouter(userid ->
                new GatewaySession(userid, cfg.getWorkspace(), client,
                        sessKey -> {
                            if (ownerChatId != null && !ownerChatId.isBlank())
                                ws.sendCard(ownerChatId,
                                        WecomApproval.cardJson(sessKey, "⚠️ 需要审批(点按钮同意/拒绝)"));
                        }));

        // 回复出口:reqId 经 InboundMsg.msgId → Sender.replyTo → respondMarkdown;markdown 透传。
        ImTurnDriver driver = new ImTurnDriver(router,
                (userid, text, replyTo) -> ws.respondMarkdown(replyTo, text), this.pool);

        WecomWsClient.OnInbound onInbound = frame -> {
            boolean isOwner = authz.isAllowed(frame.userid());
            if (isOwner) {
                ownerChatId = frame.chatId();
            }
            WecomInbound.Result r = WecomInbound.classify(
                    frame, ownerBound, isOwner, System.currentTimeMillis());
            switch (r.kind()) {
                case IGNORE -> { /* no-op */ }
                case PAIRING_ECHO -> ws.respondMarkdown(frame.reqId(),
                        "你的 userid 是 `" + frame.userid() + "`;若这是你,请到桌面端把它绑定为主人。");
                case NONTEXT_NOTICE -> ws.respondMarkdown(frame.reqId(), "暂只支持文本消息。");
                case PROCESS -> {
                    InboundMsg m = r.msg();
                    if (!dedup.seen(m.msgId())) driver.onMessage(m);
                }
            }
        };

        WecomWsClient.OnStatus onStatus = token -> System.out.println("WRAITH_GATEWAY_STATUS " + token);

        WecomWsClient.OnEvent onEvent = ce -> {
            if (!authz.isAllowed(ce.operatorUserid())) return; // deny-all
            WecomApproval.Callback cb = WecomApproval.parse(ce);
            if (cb == null) return;
            CompletableFuture<ApprovalResult> f = pendingApprovals.remove(cb.sessionKey());
            if (f != null) {                    // 定时任务审批
                f.complete(cb.result().isApproved()
                        ? ApprovalResult.approve()
                        : ApprovalResult.reject("wecom rejected"));
                return;
            }
            driver.onApproval(cb.sessionKey(), cb.result());  // IM 会话内审批
        };

        this.wsLoop = () -> ws.connect(onInbound, onStatus, onEvent);
    }

    /** 测试构造:注入 ownerUserid / ws / stub 回路(不触网)+ pendingApprovals。 */
    WecomProvider(String ownerUserid, WecomWsClient ws, Runnable wsLoop,
                  Map<String, CompletableFuture<ApprovalResult>> pendingApprovals) {
        this.ownerUserid = ownerUserid;
        this.ws = ws;
        this.wsLoop = wsLoop;
        this.pool = null;

        Authorizer authz = new Authorizer(ownerUserid);

        this.deliver = new WecomDeliveryAdapter(() -> ownerChatId,
                (chatId, text) -> ws.sendMarkdown(chatId, text));

        SessionRouter router = new SessionRouter(userid ->
                new GatewaySession(userid, null, null,
                        sessKey -> {
                            if (ownerChatId != null && !ownerChatId.isBlank())
                                ws.sendCard(ownerChatId,
                                        WecomApproval.cardJson(sessKey, "⚠️ 需要审批(点按钮同意/拒绝)"));
                        }));
        ImTurnDriver driver = new ImTurnDriver(router,
                (userid, text, replyTo) -> {}, null);

        this.onEventHandler = ce -> {
            if (!authz.isAllowed(ce.operatorUserid())) return;
            WecomApproval.Callback cb = WecomApproval.parse(ce);
            if (cb == null) return;
            CompletableFuture<ApprovalResult> f = pendingApprovals.remove(cb.sessionKey());
            if (f != null) {
                f.complete(cb.result().isApproved()
                        ? ApprovalResult.approve()
                        : ApprovalResult.reject("wecom rejected"));
                return;
            }
            driver.onApproval(cb.sessionKey(), cb.result());
        };
    }

    /** 包私:测试驱动 onEvent handler。仅测试构造设置 onEventHandler;生产构造为 null,生产路径不调用本方法。 */
    private WecomWsClient.OnEvent onEventHandler;

    void triggerOnEventForTest(WecomFrames.CardEvent ce) {
        if (onEventHandler != null) onEventHandler.onEvent(ce);
    }

    @Override public String platform() { return "wecom"; }

    @Override public Optional<DeliveryAdapter> deliveryAdapter() { return Optional.of(deliver); }

    @Override
    public void surfaceScheduledApproval(String approvalId, String toolName, String suggestion) {
        if (ownerChatId == null || ownerChatId.isBlank()) return; // 主人尚未与 bot 建会话,无法主动推送
        ws.sendCard(ownerChatId, WecomApproval.cardJson(approvalId, "⏰ 定时任务需审批:" + toolName));
    }

    @Override public void start() {
        Thread t = new Thread(wsLoop, "wraith-wecom-provider");
        t.setDaemon(true);
        this.thread = t;
        t.start();
    }

    @Override public void stop() {
        stopping();
    }

    private void stopping() {
        try { ws.stop(); } catch (Exception ignored) {}
        Thread t = this.thread;
        if (t != null) t.interrupt();
        if (pool != null) pool.shutdownNow();
    }
}
