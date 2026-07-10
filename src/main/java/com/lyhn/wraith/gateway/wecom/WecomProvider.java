package com.lyhn.wraith.gateway.wecom;

import com.lyhn.wraith.automation.delivery.DeliveryAdapter;
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
 * Phase A:无投递适配器 / HITL(归 Phase B),审批 surface 为 no-op。
 */
public final class WecomProvider implements ImProvider {

    private final String ownerUserid;
    private final WecomWsClient ws;
    private final Runnable wsLoop;
    private final ExecutorService pool;
    private volatile Thread thread;

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

        SessionRouter router = new SessionRouter(userid ->
                new GatewaySession(userid, cfg.getWorkspace(), client, sessKey -> { /* HITL: Phase B */ }));

        // 回复出口:reqId 经 InboundMsg.msgId → Sender.replyTo → respondMarkdown;markdown 透传。
        ImTurnDriver driver = new ImTurnDriver(router,
                (userid, text, replyTo) -> ws.respondMarkdown(replyTo, text), this.pool);

        WecomWsClient.OnInbound onInbound = frame -> {
            WecomInbound.Result r = WecomInbound.classify(
                    frame, ownerBound, authz.isAllowed(frame.userid()), System.currentTimeMillis());
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

        this.wsLoop = () -> ws.connect(onInbound, onStatus);
    }

    /** 测试构造:注入 ownerUserid / ws / stub 回路(不触网)。 */
    WecomProvider(String ownerUserid, WecomWsClient ws, Runnable wsLoop) {
        this.ownerUserid = ownerUserid;
        this.ws = ws;
        this.wsLoop = wsLoop;
        this.pool = null;
    }

    @Override public String platform() { return "wecom"; }

    @Override public Optional<DeliveryAdapter> deliveryAdapter() { return Optional.empty(); }

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
