package com.lyhn.wraith.gateway.qq;

import com.lyhn.wraith.automation.delivery.DeliveryAdapter;
import com.lyhn.wraith.automation.delivery.PassiveWindow;
import com.lyhn.wraith.automation.delivery.QqDeliveryAdapter;
import com.lyhn.wraith.automation.delivery.QqPendingStore;
import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.gateway.Authorizer;
import com.lyhn.wraith.gateway.GatewaySession;
import com.lyhn.wraith.gateway.ImTurnDriver;
import com.lyhn.wraith.gateway.SessionRouter;
import com.lyhn.wraith.gateway.spi.ImProvider;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import okhttp3.OkHttpClient;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * QQ 单聊 provider:把原 {@code GatewayDaemon} 的 QQ 装配(api + ws + 会话路由 +
 * 投递 + 被动窗口 + 定时审批 surfacing)整体收进本类,行为逐字保持不变。
 *
 * <p>自带独立的 {@link SessionRouter}/{@link ImTurnDriver}/{@link Authorizer}/
 * {@link Dedup};会话 key 仍是裸 openid。{@link #start()} 把阻塞的
 * {@link QqWsClient#connect} 放到一条守护线程上跑。
 */
public final class QqProvider implements ImProvider {

    private final QqDeliveryAdapter qqDeliver;
    private final QqPendingStore qqPending;
    private final Runnable wsLoop;
    private volatile Thread thread;

    /**
     * 生产构造:建 api/ws/投递/会话路由/被动窗口,并组好阻塞的 WS 连接回路。
     * 构造本身不触网(connect 在 {@link #start()} 的线程里才发生)。
     */
    public QqProvider(WraithConfig.GatewayQqConfig qq,
                      LlmClient client,
                      Path wraithDir,
                      Map<String, CompletableFuture<ApprovalResult>> pendingApprovals) {
        OkHttpClient http = new OkHttpClient(); // 单个共享 OkHttpClient(api + ws 复用)
        QqApiClient api = new QqApiClient(qq.getAppId(), qq.getClientSecret(),
                "https://api.sgroup.qq.com", "https://bots.qq.com/app/getAppAccessToken", http);

        this.qqPending = new QqPendingStore(wraithDir);

        // 被动窗口状态:openid → 最近入站 msg_id / 时间戳;60 分钟窗口。
        Map<String, String> lastMsgId = new ConcurrentHashMap<>();
        Map<String, Long> lastInboundAt = new ConcurrentHashMap<>();
        PassiveWindow window = openid -> {
            Long t = lastInboundAt.get(openid);
            String mid = lastMsgId.get(openid);
            return (mid != null && t != null
                    && System.currentTimeMillis() - t < 60 * 60 * 1000L)
                    ? mid : null;
        };
        this.qqDeliver = new QqDeliveryAdapter(qq.getOwnerOpenid(), api, qqPending, window);

        Authorizer authz = new Authorizer(qq.getOwnerOpenid());
        Dedup dedup = new Dedup(1000);
        ExecutorService pool = Executors.newCachedThreadPool();

        // LlmClient 只建一次(daemon 传入),经 factory 闭包共享给每个 openid 的会话。
        SessionRouter router = new SessionRouter(openid ->
                new GatewaySession(openid, qq.getWorkspace(), client, sessKey -> {
                    try {
                        api.sendC2CWithKeyboard(openid, "⚠️ 需要审批（点按钮同意/拒绝）：",
                                lastMsgId.get(openid), QqApproval.keyboardJson(sessKey));
                    } catch (IOException e) {
                        System.err.println("[gateway] 审批按钮发送失败: " + e.getMessage());
                        throw new UncheckedIOException(e);
                    }
                }));

        ImTurnDriver driver = new ImTurnDriver(router, (openid, text, replyTo) -> {
            try {
                api.sendC2C(openid, text, replyTo);
            } catch (IOException e) {
                System.err.println("[gateway] 回复发送失败: " + e.getClass().getSimpleName());
            }
        }, pool);

        final QqDeliveryAdapter qqDeliverRef = this.qqDeliver;
        QqWsClient ws = new QqWsClient(api, http);
        this.wsLoop = () -> ws.connect(
                inbound -> {
                    if (authz.isAllowed(inbound.openid()) && !dedup.seen(inbound.msgId())) {
                        lastMsgId.put(inbound.openid(), inbound.msgId());
                        lastInboundAt.put(inbound.openid(), System.currentTimeMillis());
                        qqDeliverRef.flush(inbound.msgId());
                        driver.onMessage(inbound);
                    }
                },
                interaction -> {
                    try {
                        api.ackInteraction(interaction.id());
                    } catch (IOException ignored) {
                        // best-effort ack
                    }
                    if (!authz.isAllowed(interaction.openid())) return; // deny-all
                    QqApproval.Callback cb = QqApproval.parse(interaction.buttonData());
                    if (cb != null) {
                        // 先按 approvalId 试解定时审批;命中则 complete + return,否则路由到 IM-session。
                        boolean isScheduledApproval = pendingApprovals.containsKey(cb.sessionKey());
                        if (isScheduledApproval) {
                            CompletableFuture<ApprovalResult> f = pendingApprovals.remove(cb.sessionKey());
                            if (f != null) {
                                boolean approved = cb.result().isApproved();
                                f.complete(approved
                                        ? ApprovalResult.approve()
                                        : ApprovalResult.reject("qq rejected"));
                            }
                            return;
                        }
                        driver.onApproval(cb.sessionKey(), cb.result());
                    }
                },
                // 连接状态 → stdout 机读标记,桌面点灯。
                state -> System.out.println("WRAITH_GATEWAY_STATUS " + state.wire()));
    }

    /** 测试构造:注入 delivery/pending 与一个 stub WS 回路(不触网)。 */
    QqProvider(QqDeliveryAdapter qqDeliver, QqPendingStore qqPending, Runnable wsLoop) {
        this.qqDeliver = qqDeliver;
        this.qqPending = qqPending;
        this.wsLoop = wsLoop;
    }

    @Override
    public String platform() {
        return "qq";
    }

    @Override
    public Optional<DeliveryAdapter> deliveryAdapter() {
        return Optional.of(qqDeliver);
    }

    @Override
    public void surfaceScheduledApproval(String approvalId, String toolName, String suggestion) {
        QqPendingStore.Pending ap = new QqPendingStore.Pending();
        ap.taskName = toolName;
        ap.answer = suggestion != null ? suggestion : "定时任务审批";
        ap.ts = System.currentTimeMillis();
        ap.approvalId = approvalId;
        qqPending.enqueue(ap);
    }

    @Override
    public void start() {
        Thread t = new Thread(wsLoop, "wraith-qq-provider");
        t.setDaemon(true);
        this.thread = t;
        t.start();
    }

    @Override
    public void stop() {
        Thread t = this.thread;
        if (t != null) {
            t.interrupt();
        }
    }
}
