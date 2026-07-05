package com.lyhn.wraith.gateway;

import com.lyhn.wraith.automation.AutomationStore;
import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.ScheduledRunRenderer;
import com.lyhn.wraith.automation.Scheduler;
import com.lyhn.wraith.automation.delivery.Deliverer;
import com.lyhn.wraith.automation.delivery.DesktopDeliveryAdapter;
import com.lyhn.wraith.automation.delivery.DeliveryAdapter;
import com.lyhn.wraith.automation.delivery.PassiveWindow;
import com.lyhn.wraith.automation.delivery.QqDeliveryAdapter;
import com.lyhn.wraith.automation.delivery.QqPendingStore;
import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.gateway.qq.Dedup;
import com.lyhn.wraith.gateway.qq.QqApiClient;
import com.lyhn.wraith.gateway.qq.QqApproval;
import com.lyhn.wraith.gateway.qq.QqEvents;
import com.lyhn.wraith.gateway.qq.QqWsClient;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClientFactory;
import okhttp3.OkHttpClient;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 网关守护进程装配：把前置任务的部件（{@link QqApiClient} / {@link QqWsClient} /
 * {@link SessionRouter} / {@link ImTurnDriver} / {@link Authorizer} / {@link Dedup}）
 * 接成一个可运行的 QQ 单聊 bot，并连上 WS 阻塞常驻。
 *
 * <p>核心装配约定：
 * <ul>
 *   <li>{@link LlmClient} 只建一次，经 factory 闭包共享给所有 openid 会话；</li>
 *   <li>{@link SessionRouter} 只吃 factory（Task 9 起不再持久化 stateFile）；</li>
 *   <li>{@link ImTurnDriver.Sender} 与审批推送器都是 lambda，内部 try/catch
 *       {@code sendC2C}/{@code sendC2CWithKeyboard} 抛的 {@link IOException}（接口未声明该异常）；</li>
 *   <li>交互（按钮回调）按 {@code interaction.openid()}（QQ 认证的真实用户）做 deny-all 鉴权，
 *       而非按钮携带的 data。</li>
 * </ul>
 *
 * <p>调度器（{@link Scheduler}）在 QQ 之前无条件启动，使 cron 独立于 IM：
 * <ul>
 *   <li>QQ 未配置时打印提示，调度器照常运行；JVM 通过 {@link CountDownLatch} 常驻。</li>
 *   <li>QQ 已配置时 {@link QqWsClient#connect} 阻塞（内部 reconnect 循环），daemon 在此常驻。</li>
 * </ul>
 *
 * <p>Task-12 接线：
 * <ul>
 *   <li>{@link Deliverer} 注册 {@link DesktopDeliveryAdapter}（总是），加上
 *       {@link QqDeliveryAdapter}（仅 QQ 已配置时）。</li>
 *   <li>Scheduler 的 {@code onResult} 换成 {@code deliverer::deliver}（Phase-1 stub 已去除）。</li>
 *   <li>{@link PassiveWindow} 实现：复用 {@code lastMsgId} map + 新增 {@code lastInboundAt}
 *       map，当最近入站在 60 分钟内时返回 msg_id，否则返回 null。</li>
 *   <li>入站冲刷：{@code onC2C} 在 dedup+authz 通过后，除原有 {@code lastMsgId.put} +
 *       {@code driver.onMessage} 外，新增 {@code lastInboundAt.put} 和
 *       {@code qqDeliver.flush(inbound.msgId())} 以用新鲜 msg_id 冲刷待发队列。</li>
 * </ul>
 */
public final class GatewayDaemon {

    private GatewayDaemon() {}

    public static void start(WraithConfig cfg) {
        // ── Step 1: LlmClient — 独立于 QQ；调度器和 IM 共享 ─────────────────────
        LlmClient client = LlmClientFactory.createFromConfig(cfg);
        if (client == null) {
            System.err.println("[gateway] 无可用 LLM provider（缺 API key）");
            System.exit(1);
        }

        // ── Step 2: AutomationStore ───────────────────────────────────────────
        AutomationStore store = new AutomationStore(
                Path.of(System.getProperty("user.home"), ".wraith"));

        // ── Step 3: TurnEngine — Phase 1 stub: ASK-mode 立即拒（fail-closed） ──
        ScheduledRunRenderer.AskSurface askSurface =
                (runId, req) -> CompletableFuture.completedFuture(
                        ApprovalResult.reject("ask surfacing not wired in phase 1"));

        AutomationRunner.TurnEngine engine =
                new AutomationRunner.InProcessTurnEngine(client, askSurface, 30);

        // ── Step 4: QQ 配置探测 ───────────────────────────────────────────────
        WraithConfig.GatewayConfig gw = cfg.getGateway();
        boolean hasQq = gw != null && gw.getQq() != null;

        // ── Step 5: 共享被动窗口状态(调度器线程写 PassiveWindow，WS 线程写 map) ──
        // lastMsgId:  openid → 最近一条入站 msg_id（供审批按钮 + PassiveWindow 引用）
        // lastInboundAt: openid → 最近一条入站时间戳(ms)
        Map<String, String> lastMsgId = new ConcurrentHashMap<>();
        Map<String, Long> lastInboundAt = new ConcurrentHashMap<>();

        // ── Step 6: QQ 投递组件（仅 QQ 已配置时）────────────────────────────────
        QqApiClient api = null;
        QqDeliveryAdapter qqDeliver = null;

        if (hasQq) {
            WraithConfig.GatewayQqConfig qq = gw.getQq();
            OkHttpClient httpForQq = new OkHttpClient();
            api = new QqApiClient(qq.getAppId(), qq.getClientSecret(),
                    "https://api.sgroup.qq.com", "https://bots.qq.com/app/getAppAccessToken", httpForQq);

            QqPendingStore pending = new QqPendingStore(
                    Path.of(System.getProperty("user.home"), ".wraith"));

            // PassiveWindow 实现：复用 lastMsgId + lastInboundAt，60 分钟窗口。
            PassiveWindow window = openid -> {
                Long t = lastInboundAt.get(openid);
                String mid = lastMsgId.get(openid);
                return (mid != null && t != null
                        && System.currentTimeMillis() - t < 60 * 60 * 1000L)
                        ? mid : null;
            };

            qqDeliver = new QqDeliveryAdapter(qq.getOwnerOpenid(), api, pending, window);
        }

        // ── Step 7: Deliverer = DesktopDeliveryAdapter 总是 + QqDeliveryAdapter 若有 QQ ──
        List<DeliveryAdapter> adapterList = new ArrayList<>();
        adapterList.add(new DesktopDeliveryAdapter(store));
        if (qqDeliver != null) {
            adapterList.add(qqDeliver);
        }
        Deliverer deliverer = new Deliverer(adapterList);

        // ── Step 8: Scheduler — onResult 换成 deliverer::deliver（Phase-1 stub 已去除） ──
        Scheduler sch = new Scheduler(store, engine, deliverer::deliver, 3, System::currentTimeMillis);

        // ── Step 9: 扫清旧 run，启动调度器 ─────────────────────────────────────
        sch.sweepInterrupted();
        sch.start();

        // ── Step 10: QQ — 可选 ───────────────────────────────────────────────
        if (!hasQq) {
            System.err.println("[gateway] 未配置 gateway.qq；仅运行定时任务(cron)，不接 QQ");
            // 调度器的 ticker/worker 均为 daemon 线程，必须显式阻塞才能防止 JVM 退出。
            try {
                new CountDownLatch(1).await();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return;
        }

        // ── Step 11: QQ WS 接线（复用 Step 6 已建的 api + qqDeliver） ────────────
        WraithConfig.GatewayQqConfig qq = gw.getQq();
        final QqApiClient apiRef = api;
        final QqDeliveryAdapter qqDeliverRef = qqDeliver;

        Authorizer authz = new Authorizer(qq.getOwnerOpenid());
        Dedup dedup = new Dedup(1000);
        ExecutorService pool = Executors.newCachedThreadPool();

        // LlmClient 只建一次，经 factory 闭包共享给每个 openid 的会话。
        SessionRouter router = new SessionRouter(openid ->
                new GatewaySession(openid, qq.getWorkspace(), client, sessKey -> {
                    try {
                        apiRef.sendC2CWithKeyboard(openid, "⚠️ 需要审批（点按钮同意/拒绝）：",
                                lastMsgId.get(openid), QqApproval.keyboardJson(sessKey));
                    } catch (IOException e) {
                        // message 含 HTTP 状态/QQ 错误体（无密钥）；上抛让 promptApproval fail-closed，不吊死回合。
                        System.err.println("[gateway] 审批按钮发送失败: " + e.getMessage());
                        throw new java.io.UncheckedIOException(e);
                    }
                }));

        ImTurnDriver driver = new ImTurnDriver(router, (openid, text, replyTo) -> {
            try {
                apiRef.sendC2C(openid, text, replyTo);
            } catch (IOException e) {
                System.err.println("[gateway] 回复发送失败: " + e.getClass().getSimpleName());
            }
        }, pool);

        OkHttpClient httpForWs = new OkHttpClient();
        QqWsClient ws = new QqWsClient(apiRef, httpForWs);
        ws.connect(
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
                        apiRef.ackInteraction(interaction.id());
                    } catch (IOException ignored) {
                        // best-effort ack
                    }
                    if (!authz.isAllowed(interaction.openid())) return; // deny-all on QQ-authenticated openid
                    QqApproval.Callback cb = QqApproval.parse(interaction.buttonData());
                    if (cb != null) driver.onApproval(cb.sessionKey(), cb.result());
                },
                // F-4:连接状态 → stdout 机读标记(与 logback 文件日志解耦),桌面端点亮状态灯。
                state -> System.out.println("WRAITH_GATEWAY_STATUS " + state.wire()));
        // ws.connect(...) 阻塞（跑 QqWsClient 的 reconnect 循环）——start() 在此常驻。
    }
}
