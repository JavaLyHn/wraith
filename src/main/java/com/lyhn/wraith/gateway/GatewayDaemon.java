package com.lyhn.wraith.gateway;

import com.lyhn.wraith.automation.AutomationStore;
import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.RequestInbox;
import com.lyhn.wraith.automation.ScheduledRunRenderer;
import com.lyhn.wraith.automation.Scheduler;
import com.lyhn.wraith.automation.delivery.Deliverer;
import com.lyhn.wraith.automation.delivery.DesktopDeliveryAdapter;
import com.lyhn.wraith.automation.delivery.DeliveryAdapter;
import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.gateway.qq.QqProvider;
import com.lyhn.wraith.gateway.spi.ImProvider;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClientFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 网关守护进程装配:构造共享的 LLM / 存储 / 调度器 / 投递器 / 审批登记,遍历已配置
 * 的 {@link ImProvider}(QQ、后续飞书),注册各自的 DeliveryAdapter、广播定时审批
 * surfacing、逐个起到守护线程,最后阻塞在 {@link CountDownLatch} 常驻。
 *
 * <p>调度器(cron)独立于 IM:无任何 provider 时仅跑 cron;JVM 靠 latch 常驻。
 */
public final class GatewayDaemon {

    private static final Logger log = LoggerFactory.getLogger(GatewayDaemon.class);

    private GatewayDaemon() {}

    public static void start(WraithConfig cfg) {
        // ── Step 1: LlmClient — 调度器与所有 IM provider 共享 ─────────────────
        LlmClient client = LlmClientFactory.createFromConfig(cfg);
        if (client == null) {
            System.err.println("[gateway] 无可用 LLM provider（缺 API key）");
            System.exit(1);
        }

        // ── Step 2: AutomationStore ──────────────────────────────────────────
        String home = System.getProperty("user.home");
        Path wraithDir = Path.of(home, ".wraith");
        AutomationStore store = new AutomationStore(wraithDir);

        // ── Step 3: pendingApprovals(askSurface + provider 回调 + inbox 三方共享)
        Map<String, CompletableFuture<ApprovalResult>> pendingApprovals = new ConcurrentHashMap<>();
        AtomicLong approvalCounter = new AtomicLong(0);

        // ── Step 4: 按 config 构造 IM provider 列表 ──────────────────────────
        List<ImProvider> providers = buildProviders(cfg, client, wraithDir, pendingApprovals);

        // ── Step 5: 真实 AskSurface — 广播给每个 provider 做平台原生呈现 ──────
        final AutomationStore storeRef = store;
        ScheduledRunRenderer.AskSurface askSurface = (runId, req) -> {
            String approvalId = runId + "#" + approvalCounter.incrementAndGet();
            CompletableFuture<ApprovalResult> f = new CompletableFuture<>();
            pendingApprovals.put(approvalId, f);
            f.whenComplete((r, e) -> pendingApprovals.remove(approvalId));

            // 标记活动 run 为 waiting_approval,让 automations.runs 在桌面浮出。
            try {
                storeRef.nonTerminalRuns().stream()
                        .filter(r -> runId.equals(r.taskId))
                        .findFirst()
                        .ifPresent(r -> {
                            r.status = "waiting_approval";
                            r.approvalId = approvalId;
                            r.approvalTool = req.toolName();
                            storeRef.putRun(r);
                        });
            } catch (Exception e) {
                log.warn("[gateway] AskSurface: run 标记 waiting_approval 失败(不影响审批流): {}", e.getMessage());
            }

            String suggestion = req.suggestion() != null ? req.suggestion() : "定时任务审批";
            for (ImProvider p : providers) {
                p.surfaceScheduledApproval(approvalId, req.toolName(), suggestion);
            }
            // 桌面路径:future 也可经 RequestInbox(approval 类型)由下面的 poller 完成。
            return f;
        };

        // ── Step 6: TurnEngine(需 askSurface) ───────────────────────────────
        AutomationRunner.TurnEngine engine =
                new AutomationRunner.InProcessTurnEngine(client, askSurface, 30);

        // ── Step 7: Deliverer = DesktopDeliveryAdapter 总是 + 每个 provider 的适配器 ─
        List<DeliveryAdapter> adapterList = new ArrayList<>();
        adapterList.add(new DesktopDeliveryAdapter(store));
        for (ImProvider p : providers) {
            p.deliveryAdapter().ifPresent(adapterList::add);
        }
        Deliverer deliverer = new Deliverer(adapterList);

        // ── Step 8: Scheduler — onResult = deliverer::deliver ────────────────
        Scheduler sch = new Scheduler(store, engine, deliverer::deliver, 3, System::currentTimeMillis);

        // ── Step 9: RequestInbox poller — run-now + approval, 2-3s ───────────
        RequestInbox inbox = new RequestInbox(wraithDir.resolve("automation-requests"));
        ScheduledExecutorService inboxPoller = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "wraith-inbox-poller");
            t.setDaemon(true);
            return t;
        });
        inboxPoller.scheduleAtFixedRate(() -> {
            try {
                for (RequestInbox.Request r : inbox.drain()) {
                    try {
                        if ("run-now".equals(r.type())) {
                            sch.requestRunNow(r.id());
                        } else if ("approval".equals(r.type())) {
                            CompletableFuture<ApprovalResult> ff = pendingApprovals.remove(r.id());
                            if (ff != null) {
                                ff.complete("approve".equals(r.payload())
                                        ? ApprovalResult.approve()
                                        : ApprovalResult.reject("desktop rejected"));
                            }
                        }
                    } catch (Exception e) {
                        System.err.println("[gateway] inbox 处理单条请求失败: " + e.getMessage());
                    }
                }
            } catch (Exception e) {
                System.err.println("[gateway] inbox poll 失败: " + e.getMessage());
            }
        }, 2, 3, TimeUnit.SECONDS);

        // ── Step 10: 扫清旧 run,启动调度器 ──────────────────────────────────
        sch.sweepInterrupted();
        sch.start();

        // ── Step 11: 逐个启动 IM provider(各自到守护线程,非阻塞) ───────────
        if (providers.isEmpty()) {
            System.err.println("[gateway] 未配置任何 IM 平台;仅运行定时任务(cron)");
        }
        int started = 0;
        for (ImProvider p : providers) {
            try {
                p.start();
                started++;
                log.info("[gateway] IM provider 已启动: {}", p.platform());
            } catch (Exception e) {
                log.error("[gateway] IM provider 启动失败: {} — {}", p.platform(), e.getMessage());
            }
        }
        if (!providers.isEmpty() && started == 0) {
            System.err.println("[gateway] 所有 IM provider 启动失败;退化为仅 cron 模式");
        }

        // shutdown 时尽力停止各 provider(让 stop() 的线程/线程池清理生效)。
        List<ImProvider> providersRef = providers;
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            for (ImProvider p : providersRef) {
                try { p.stop(); } catch (Exception ignored) { /* best-effort */ }
            }
        }, "wraith-gateway-shutdown"));

        // ── Step 12: 阻塞常驻(provider 与调度器均在守护线程,须显式阻塞防 JVM 退出)
        try {
            new CountDownLatch(1).await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * 按 config 构造已配置的 IM provider 列表(package-private,供测试)。
     * 构造 provider 不触网;传输连接在各 provider 的 {@code start()} 里才发生。
     */
    static List<ImProvider> buildProviders(WraithConfig cfg,
                                           LlmClient client,
                                           Path wraithDir,
                                           Map<String, CompletableFuture<ApprovalResult>> pendingApprovals) {
        List<ImProvider> providers = new ArrayList<>();
        WraithConfig.GatewayConfig gw = cfg.getGateway();
        if (gw != null && gw.getQq() != null) {
            providers.add(new QqProvider(gw.getQq(), client, wraithDir, pendingApprovals));
        }
        if (gw != null && gw.getFeishu() != null) {
            providers.add(new com.lyhn.wraith.gateway.feishu.FeishuProvider(
                    gw.getFeishu(), client, pendingApprovals));
        }
        if (gw != null && gw.getWecom() != null) {
            providers.add(new com.lyhn.wraith.gateway.wecom.WecomProvider(
                    gw.getWecom(), client, pendingApprovals));
        }
        return providers;
    }
}
