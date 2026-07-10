package com.lyhn.wraith.gateway.weixin;

import com.lyhn.wraith.automation.delivery.DeliveryAdapter;
import com.lyhn.wraith.automation.delivery.WeixinDeliveryAdapter;
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
 * Phase B:文本 HITL 状态机(y/a/n,一次一挂起,fail-closed)+ 投递接线。
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

    private final Map<String, CompletableFuture<ApprovalResult>> pendingApprovals;
    private final ImTurnDriver driver;                 // 生产构造赋值;测试构造可 null
    private final java.util.function.BiConsumer<String, String> plainSender; // (contextToken,text) 纯文本发送口
    private final WeixinDeliveryAdapter deliver;
    /** 文本 HITL:当前挂起审批 sessionKey(v1 一次一个;null=无挂起)。仅测试注释:生产由回路线程/审批线程写。 */
    private volatile String pendingSessionKey;

    /** 生产构造:复用 IlinkClient/账号店,组好阻塞长轮询回路。构造不触网。 */
    public WeixinProvider(WechatAccount initialAccount,
                          LlmClient client,
                          Map<String, CompletableFuture<ApprovalResult>> pendingApprovals) {
        IlinkClient ilink = new IlinkClient();
        WechatAccountStore store = WechatAccountStore.createDefault();
        this.boundUserId = initialAccount.boundUserId();
        this.pool = Executors.newCachedThreadPool();
        this.pendingApprovals = pendingApprovals;

        Dedup dedup = new Dedup(1000);
        // account 随游标推进而更新;回路线程写、Sender/池线程读,AtomicReference 保证可见性
        final AtomicReference<WechatAccount> accountRef = new AtomicReference<>(initialAccount);

        this.plainSender = (ctx, text) -> {
            try {
                ilink.sendText(accountRef.get(), this.boundUserId, ctx, text);
            } catch (Exception e) {
                log.warn("[gateway] 微信文本发送失败: {}", e.getClass().getSimpleName());
            }
        };

        this.deliver = new WeixinDeliveryAdapter(() -> ownerLastContextToken, plainSender);

        SessionRouter router = new SessionRouter(userid ->
                new GatewaySession(userid, initialAccount.workspace(), client, sessKey -> surfaceApproval(sessKey, null)));

        this.driver = new ImTurnDriver(router, (userid, text, replyTo) -> {
            try {
                ilink.sendText(accountRef.get(), userid, replyTo, MarkdownLite.toPlainText(text));
                typing(ilink, accountRef.get(), userid, replyTo, 2); // 回复完成,停打字指示
            } catch (Exception e) {
                log.warn("[gateway] 微信回复发送失败: {}", e.getClass().getSimpleName());
            }
        }, this.pool);

        this.pollLoop = () -> {
            System.out.println("WRAITH_GATEWAY_STATUS starting");
            try { ilink.notifyStart(accountRef.get()); } catch (Exception e) { log.warn("[gateway] 微信 notifyStart 失败: {}", e.getClass().getSimpleName()); }
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
                        handleInbound(ilink, accountRef, dedup, m);
                    }
                } catch (Exception e) {
                    log.warn("[gateway] 微信轮询异常: {}", e.getClass().getSimpleName());
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

    /** 测试构造(四参):注入 boundUserId / stub 回路 / pendingApprovals / plainSender(不触网)。 */
    WeixinProvider(String boundUserId, Runnable pollLoop,
                   Map<String, CompletableFuture<ApprovalResult>> pendingApprovals,
                   java.util.function.BiConsumer<String, String> plainSender) {
        this.boundUserId = boundUserId;
        this.pollLoop = pollLoop;
        this.pool = null;
        this.driver = null;
        this.pendingApprovals = pendingApprovals;
        this.plainSender = plainSender;
        this.deliver = new WeixinDeliveryAdapter(() -> ownerLastContextToken, plainSender);
    }

    /** 测试构造(两参):委托四参,用空 pendingApprovals 和 no-op plainSender。 */
    WeixinProvider(String boundUserId, Runnable pollLoop) {
        this(boundUserId, pollLoop,
             new java.util.concurrent.ConcurrentHashMap<>(),
             (c, t) -> {});
    }

    /** 呈现一个审批:发文本提示 + 登记挂起;主人不可达则 fail-closed 自动拒绝(不悬挂)。 */
    private void surfaceApproval(String sessionKey, String toolName) {
        String ctx = ownerLastContextToken;
        if (ctx == null || ctx.isBlank()) {
            log.warn("[gateway] 微信审批无法送达(主人尚无入站消息),自动拒绝: {}", sessionKey);
            resolveApproval(sessionKey, ApprovalResult.reject("微信不可达,自动拒绝"));
            return;
        }
        String old = pendingSessionKey;
        if (old != null && !old.equals(sessionKey)) {
            resolveApproval(old, ApprovalResult.reject("被新审批替换"));
        }
        pendingSessionKey = sessionKey;
        plainSender.accept(ctx, WeixinApproval.promptText(toolName));
    }

    /** 把审批结果送达正确的等待方:定时审批(pendingApprovals)或 IM 会话(driver)。 */
    private void resolveApproval(String sessionKey, ApprovalResult result) {
        CompletableFuture<ApprovalResult> f = pendingApprovals == null ? null : pendingApprovals.remove(sessionKey);
        if (f != null) {
            f.complete(result.isApproved()
                    ? (result.isApprovedAll() ? ApprovalResult.approveAll() : ApprovalResult.approve())
                    : ApprovalResult.reject("weixin rejected"));
            return;
        }
        if (driver != null) driver.onApproval(sessionKey, result);
    }

    /** 主人回复 y/a/n 的处理(APPROVAL_REPLY 分支与测试接缝共用)。 */
    void handleApprovalText(String text, String contextToken) {
        ApprovalResult res = WeixinApproval.parse(text);
        String key = pendingSessionKey;
        if (key == null || res == null) return;
        pendingSessionKey = null;
        resolveApproval(key, res);
        plainSender.accept(contextToken, res.isApproved() ? "✅ 已批准" : "⛔ 已拒绝");
    }

    private void handleInbound(IlinkClient ilink, AtomicReference<WechatAccount> accountRef,
                                Dedup dedup, WechatMessage m) {
        if (m == null) return;
        String mid = m.messageId();
        if (mid != null && !mid.isBlank() && dedup.seen(mid)) return;
        if (boundUserId.equals(m.fromUserId())) {
            ownerLastContextToken = m.contextToken();
        }
        WeixinInbound.Result r = WeixinInbound.classify(m, boundUserId, pendingSessionKey != null, System.currentTimeMillis());
        switch (r.kind()) {
            case IGNORE -> { /* 非主人或空消息,忽略 */ }
            case APPROVAL_REPLY -> handleApprovalText(m.text(), m.contextToken());
            case APPROVAL_NUDGE -> plainSender.accept(m.contextToken(),
                    "有待审批操作,请先回复 y 批准 / a 总是允许 / n 拒绝");
            case NONTEXT_NOTICE -> plainSender.accept(m.contextToken(), "暂只支持文本消息。");
            case PROCESS -> {
                typing(ilink, accountRef.get(), boundUserId, m.contextToken(), 1); // 处理中,起打字指示
                driver.onMessage(r.msg());
            }
        }
    }

    /** 打字指示器,纯 best-effort(失败仅 debug 级,不影响主链路)。 */
    private static void typing(IlinkClient ilink, WechatAccount account, String toUserId, String contextToken, int status) {
        try {
            ilink.sendTyping(account, toUserId, contextToken, status);
        } catch (Exception e) {
            log.debug("[gateway] 微信打字指示失败: {}", e.getClass().getSimpleName());
        }
    }

    @Override
    public void surfaceScheduledApproval(String approvalId, String toolName, String suggestion) {
        surfaceApproval(approvalId, toolName);
    }

    @Override public String platform() { return "weixin"; }

    @Override public Optional<DeliveryAdapter> deliveryAdapter() { return Optional.ofNullable(deliver); }

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

    /** 仅测试:登记挂起审批 + 注入主人 context_token。生产路径不调用。 */
    void registerPendingForTest(String sessionKey, String ownerContextToken) {
        this.pendingSessionKey = sessionKey;
        this.ownerLastContextToken = ownerContextToken;
    }

    String pendingSessionKeyForTest() { return pendingSessionKey; }
}
