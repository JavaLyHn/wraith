package com.lyhn.wraith.gateway.weixin;

import com.lyhn.wraith.automation.delivery.DeliveryAdapter;
import com.lyhn.wraith.gateway.ImTurnDriver;
import com.lyhn.wraith.gateway.GatewaySession;
import com.lyhn.wraith.gateway.SessionRouter;
import com.lyhn.wraith.gateway.format.MarkdownLite;
import com.lyhn.wraith.gateway.qq.Dedup;
import com.lyhn.wraith.gateway.spi.ImProvider;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.wechat.IlinkClient;
import com.lyhn.wraith.wechat.WechatAccount;
import com.lyhn.wraith.wechat.WechatAccountStore;
import com.lyhn.wraith.wechat.WechatMessage;
import com.lyhn.wraith.wechat.WechatUpdate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * 个人微信单聊 provider:复用 wechat 包的 IlinkClient 长轮询收发(纯 HTTP,免公网)。
 * 扫码者即主人(account.boundUserId),非主人 IGNORE;回复经 contextToken 关联并
 * toPlainText 清洗(微信不渲染 markdown)。游标 syncBuf 每次轮询持久化到账号店。
 * Phase A:HITL no-op、无投递适配器(归 Phase B)。
 * ⚠ 与 REPL /wechat 通道共用同一游标,两者不可同时运行(见 spec 共存约束)。
 */
public final class WeixinProvider implements ImProvider {

    private static final Logger log = LoggerFactory.getLogger(WeixinProvider.class);
    private static final int SESSION_EXPIRED = -14;
    private static final long[] BACKOFF = {2, 5, 10, 30, 60};

    private final String boundUserId;
    private final Runnable pollLoop;
    private final ExecutorService pool;
    private volatile Thread thread;
    private volatile boolean stopping;
    /** 主人最近一条入站的 context_token(主动发送用;Phase B 的审批提示/投递消费)。 */
    private volatile String ownerLastContextToken;

    /** 生产构造:复用 IlinkClient/账号店,组好阻塞长轮询回路。构造不触网。 */
    public WeixinProvider(WechatAccount initialAccount,
                          LlmClient client,
                          Map<String, CompletableFuture<ApprovalResult>> pendingApprovals) {
        IlinkClient ilink = new IlinkClient();
        WechatAccountStore store = WechatAccountStore.createDefault();
        this.boundUserId = initialAccount.boundUserId();
        this.pool = Executors.newCachedThreadPool();

        Dedup dedup = new Dedup(1000);
        // account 随游标推进而更新;回路线程写、Sender/池线程读,AtomicReference 保证可见性
        final AtomicReference<WechatAccount> accountRef = new AtomicReference<>(initialAccount);

        SessionRouter router = new SessionRouter(userid ->
                new GatewaySession(userid, initialAccount.workspace(), client, sessKey -> { /* HITL: Phase B */ }));

        ImTurnDriver driver = new ImTurnDriver(router, (userid, text, replyTo) -> {
            try {
                ilink.sendText(accountRef.get(), userid, replyTo, MarkdownLite.toPlainText(text));
                typing(ilink, accountRef.get(), userid, replyTo, 2); // 回复完成,停打字指示
            } catch (Exception e) {
                log.warn("[gateway] 微信回复发送失败: {}", e.toString());
            }
        }, this.pool);

        this.pollLoop = () -> {
            System.out.println("WRAITH_GATEWAY_STATUS starting");
            try { ilink.notifyStart(accountRef.get()); } catch (Exception e) { log.warn("[gateway] 微信 notifyStart 失败: {}", e.toString()); }
            long timeoutMs = 35_000;
            int attempt = 0;
            boolean running = false;
            while (!stopping && !Thread.currentThread().isInterrupted()) {
                try {
                    WechatUpdate update = ilink.getUpdates(accountRef.get(), timeoutMs);
                    if (update.ret() == SESSION_EXPIRED) {
                        System.out.println("WRAITH_GATEWAY_STATUS auth-failed");
                        System.err.println("[gateway] 微信登录态失效,请重新运行 wraith gateway bind-weixin");
                        break; // token 失效,重试无意义
                    }
                    if (!running) { System.out.println("WRAITH_GATEWAY_STATUS running"); running = true; }
                    attempt = 0;
                    if (update.nextLongPollTimeoutMs() != null && update.nextLongPollTimeoutMs() > 0) {
                        timeoutMs = update.nextLongPollTimeoutMs();
                    }
                    if (update.nextSyncBuf() != null && !update.nextSyncBuf().isBlank()) {
                        accountRef.set(accountRef.get().withSyncBuf(update.nextSyncBuf()));
                        store.save(accountRef.get());
                    }
                    for (WechatMessage m : update.messages()) {
                        handleInbound(ilink, accountRef.get(), dedup, driver, m);
                    }
                } catch (Exception e) {
                    log.warn("[gateway] 微信轮询异常: {}", e.toString());
                    if (running) { System.out.println("WRAITH_GATEWAY_STATUS disconnected"); running = false; }
                    try {
                        TimeUnit.SECONDS.sleep(BACKOFF[Math.min(attempt++, BACKOFF.length - 1)]);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                    }
                }
            }
            try { ilink.notifyStop(accountRef.get()); } catch (Exception ignored) { /* best-effort */ }
        };
    }

    /** 测试构造:注入 boundUserId / stub 回路(不触网)。 */
    WeixinProvider(String boundUserId, Runnable pollLoop) {
        this.boundUserId = boundUserId;
        this.pollLoop = pollLoop;
        this.pool = null;
    }

    private void handleInbound(IlinkClient ilink, WechatAccount account,
                               Dedup dedup, ImTurnDriver driver, WechatMessage m) {
        if (m == null) return;
        String mid = m.messageId();
        if (mid != null && !mid.isBlank() && dedup.seen(mid)) return;
        WeixinInbound.Result r = WeixinInbound.classify(m, boundUserId, false, System.currentTimeMillis());
        switch (r.kind()) {
            case IGNORE, APPROVAL_REPLY, APPROVAL_NUDGE -> { /* 审批分支 Phase B 接线 */ }
            case NONTEXT_NOTICE -> {
                try { ilink.sendText(account, boundUserId, m.contextToken(), "暂只支持文本消息。"); }
                catch (Exception e) { log.warn("[gateway] 微信提示发送失败: {}", e.toString()); }
            }
            case PROCESS -> {
                ownerLastContextToken = m.contextToken();
                typing(ilink, account, boundUserId, m.contextToken(), 1); // 处理中,起打字指示
                driver.onMessage(r.msg());
            }
        }
    }

    /** 打字指示器,纯 best-effort(失败仅 debug 级,不影响主链路)。 */
    private static void typing(IlinkClient ilink, WechatAccount account, String toUserId, String contextToken, int status) {
        try {
            ilink.sendTyping(account, toUserId, contextToken, status);
        } catch (Exception e) {
            log.debug("[gateway] 微信打字指示失败: {}", e.toString());
        }
    }

    @Override public String platform() { return "weixin"; }

    @Override public Optional<DeliveryAdapter> deliveryAdapter() { return Optional.empty(); }

    @Override public void start() {
        Thread t = new Thread(pollLoop, "wraith-weixin-provider");
        t.setDaemon(true);
        this.thread = t;
        t.start();
    }

    @Override public void stop() {
        stopping = true;
        Thread t = this.thread;
        if (t != null) t.interrupt();
        if (pool != null) pool.shutdownNow();
    }
}
