# 飞书网关 Phase A:ImProvider SPI + QQ 回填 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把网关的 IM 会话回路抽成 `ImProvider` SPI,QQ 现有装配整体回填为 `QqProvider`,`GatewayDaemon` 控制流从「阻塞在 ws.connect」改为「多 provider 各起线程 + 主线程阻塞在 latch」——QQ 行为字节级不变,为 Phase B 的 FeishuProvider 铺好接缝。

**Architecture:** 每个 IM 平台是一个 `ImProvider`,**自带**自己的 `SessionRouter`/`ImTurnDriver`/`Authorizer`/`Dedup`/传输回路(不共享,避免给 QQ 的会话 key 加前缀而动到行为)。daemon 只持有共享的 `LlmClient`/`AutomationStore`/`Scheduler`/`Deliverer`/`pendingApprovals`,遍历 provider 列表:注册各自的 `DeliveryAdapter`、把定时审批 surfacing 广播给每个 provider、逐个 `start()` 到独立守护线程,最后阻塞在 `CountDownLatch`。

**Tech Stack:** Java 17,Maven,JUnit 5,现有 `com.lyhn.wraith.gateway` / `automation.delivery` 代码。本阶段**不引入任何新依赖**(飞书 SDK 在 Phase B 才加)。

## Global Constraints

- **QQ 行为零回归**:本阶段是纯重构;`ImTurnDriver`/`GatewaySession`/`GatewayRenderer`/`Authorizer`/`SessionRouter`/`Dedup`/`QqApiClient`/`QqWsClient`/`QqEvents`/`QqApproval`/`QqDeliveryAdapter`/`QqPendingStore` 源码**不改动**(只被 `QqProvider` 引用);现有 gateway/delivery/config 测试全部零改动通过。
- **QQ 会话 key 保持裸 openid**(不加平台前缀);provider 各自持有独立 router,天然不串号。
- **控制流**:`GatewayDaemon.start()` 结尾恒定阻塞在 `new CountDownLatch(1).await()`;所有 IM 传输回路跑在 daemon 线程(`setDaemon(true)`)。
- **状态灯协议**:连接状态经 `System.out.println("WRAITH_GATEWAY_STATUS " + state.wire())` 输出(桌面端点灯),保持不变。
- **密钥红线**:不新增密钥读写路径;`appId/clientSecret` 只经现有 `QqApiClient` 通道;提交前跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指/测试金丝雀)。
- **commit trailer**:每次提交带 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 与 `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- **测试运行**:本仓库测试默认跳过,须 `-DskipTests=false`;~4F 基线是 JDK/Mockito 噪声,非本改动引入。

---

### Task 1: `ImProvider` SPI + `QqProvider` 回填

把 QQ 的传输/会话/投递/定时审批 surfacing 装配整体搬进 `QqProvider`,实现新接口 `ImProvider`。**此任务结束后 daemon 尚未使用 `QqProvider`**(仍走旧内联块),`QqProvider` 作为独立单元先建成并单测;Task 2 再切换 daemon 并删除旧块。

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/spi/ImProvider.java`
- Create: `src/main/java/com/lyhn/wraith/gateway/qq/QqProvider.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/qq/QqProviderTest.java`

**Interfaces:**
- Consumes:
  - `WraithConfig.GatewayQqConfig`(getters:`getAppId()`/`getClientSecret()`/`getOwnerOpenid()`/`getWorkspace()`)。
  - `LlmClient`、`java.nio.file.Path`(`~/.wraith` 目录)、`Map<String, CompletableFuture<ApprovalResult>> pendingApprovals`。
  - `QqApiClient(appId, clientSecret, apiBase, tokenUrl, OkHttpClient)`、`QqWsClient(QqApiClient, OkHttpClient)`、`QqWsClient.connect(Consumer<InboundMsg>, Consumer<QqEvents.Interaction>, Consumer<ConnState>)`;`QqEvents.Interaction`(`.id()`/`.openid()`/`.buttonData()`);`ConnState.wire()`。
  - `QqApproval.keyboardJson(String)`、`QqApproval.parse(String) -> QqApproval.Callback`(`.sessionKey()`/`.result()`)。
  - `QqApiClient.sendC2C(openid,text,replyTo)`/`sendC2CWithKeyboard(openid,text,replyTo,keyboardJson)`/`ackInteraction(id)`(均 `throws IOException`)。
  - `QqDeliveryAdapter(ownerOpenid, QqApiClient, QqPendingStore, PassiveWindow)`、`QqPendingStore(Path)` + `QqPendingStore.Pending`(public 字段 `taskName/answer/ts/approvalId`)。
  - `SessionRouter(Function<String,GatewaySession>)`、`GatewaySession(sessionKey, workspace, LlmClient, Consumer<String> approvalPusher)`、`ImTurnDriver(SessionRouter, Sender, ExecutorService)`、`Authorizer(ownerOpenid)`、`Dedup(int)`。
  - `ApprovalResult.approve()`/`approveAll()`/`reject(String)`/`isApproved()`。
- Produces:
  - `interface ImProvider { String platform(); void start() throws Exception; void stop(); Optional<DeliveryAdapter> deliveryAdapter(); default void surfaceScheduledApproval(String approvalId, String toolName, String suggestion) {} }`
  - `final class QqProvider implements ImProvider`:public production 构造 `QqProvider(WraithConfig.GatewayQqConfig, LlmClient, Path wraithDir, Map<String,CompletableFuture<ApprovalResult>>)`;package-private 测试构造 `QqProvider(QqDeliveryAdapter, QqPendingStore, Runnable wsLoop)`。

- [ ] **Step 1: 写失败测试 `QqProviderTest`**

`src/test/java/com/lyhn/wraith/gateway/qq/QqProviderTest.java`:

```java
package com.lyhn.wraith.gateway.qq;

import com.lyhn.wraith.automation.delivery.QqDeliveryAdapter;
import com.lyhn.wraith.automation.delivery.QqPendingStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class QqProviderTest {

    private QqProvider provider(Path dir, Runnable wsLoop) {
        QqPendingStore pending = new QqPendingStore(dir);
        // api=null: these tests never call deliver()/flush(), so no network is touched.
        QqDeliveryAdapter adapter = new QqDeliveryAdapter("owner-openid", null, pending, openid -> null);
        return new QqProvider(adapter, pending, wsLoop);
    }

    @Test
    void platformIsQq(@TempDir Path dir) {
        assertEquals("qq", provider(dir, () -> {}).platform());
    }

    @Test
    void deliveryAdapterPresentAndQq(@TempDir Path dir) {
        var p = provider(dir, () -> {});
        assertTrue(p.deliveryAdapter().isPresent());
        assertEquals("qq", p.deliveryAdapter().get().platform());
    }

    @Test
    void surfaceScheduledApprovalEnqueuesApprovalPending(@TempDir Path dir) {
        QqPendingStore pending = new QqPendingStore(dir);
        QqDeliveryAdapter adapter = new QqDeliveryAdapter("owner-openid", null, pending, openid -> null);
        QqProvider p = new QqProvider(adapter, pending, () -> {});

        p.surfaceScheduledApproval("run1#1", "web_fetch", "抓取每日榜单");

        List<QqPendingStore.Pending> list = pending.drainAll();
        assertEquals(1, list.size());
        assertEquals("run1#1", list.get(0).approvalId);
        assertEquals("web_fetch", list.get(0).taskName);
        assertEquals("抓取每日榜单", list.get(0).answer);
    }

    @Test
    void surfaceScheduledApprovalNullSuggestionUsesDefault(@TempDir Path dir) {
        QqPendingStore pending = new QqPendingStore(dir);
        QqDeliveryAdapter adapter = new QqDeliveryAdapter("owner-openid", null, pending, openid -> null);
        QqProvider p = new QqProvider(adapter, pending, () -> {});

        p.surfaceScheduledApproval("run1#2", "shell", null);

        assertEquals("定时任务审批", pending.drainAll().get(0).answer);
    }

    @Test
    void startRunsWsLoopOnDaemonThread(@TempDir Path dir) throws Exception {
        CountDownLatch ran = new CountDownLatch(1);
        QqProvider p = provider(dir, ran::countDown);
        p.start();
        assertTrue(ran.await(2, TimeUnit.SECONDS), "start() 应把 wsLoop 放到一条新线程上跑,并立即返回");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=QqProviderTest test`
Expected: 编译失败 —— `QqProvider`/`ImProvider` 不存在(cannot find symbol)。

- [ ] **Step 3: 建 `ImProvider` 接口**

`src/main/java/com/lyhn/wraith/gateway/spi/ImProvider.java`:

```java
package com.lyhn.wraith.gateway.spi;

import com.lyhn.wraith.automation.delivery.DeliveryAdapter;

import java.util.Optional;

/**
 * 一个 IM 平台接入的 SPI。每个平台(qq、feishu、…)实现一份,自带自己的
 * 传输回路 + 会话路由 + 鉴权 + 去重;daemon 只按接口 start/stop 并收集其
 * {@link DeliveryAdapter}(供 cron 结果投递)。
 */
public interface ImProvider {

    /** 平台标识,如 {@code "qq"}、{@code "feishu"}。 */
    String platform();

    /** 起传输回路(应在独立线程,立即返回,非阻塞)。 */
    void start() throws Exception;

    /** 尽力停止传输回路(shutdown 时调用;best-effort)。 */
    void stop();

    /** 本平台的 cron 结果投递适配器(无则 empty),由 daemon 注册进 Deliverer。 */
    Optional<DeliveryAdapter> deliveryAdapter();

    /**
     * 把一个定时任务审批以本平台原生方式呈现给主人(如 QQ 待发队列 → 下次入站发按钮)。
     * 默认 no-op(不支持 IM 审批呈现的平台无需实现)。
     */
    default void surfaceScheduledApproval(String approvalId, String toolName, String suggestion) {}
}
```

- [ ] **Step 4: 建 `QqProvider`(回填 daemon 的 QQ 装配)**

`src/main/java/com/lyhn/wraith/gateway/qq/QqProvider.java`:

```java
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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=QqProviderTest test`
Expected: PASS(5 tests)。

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/spi/ImProvider.java \
        src/main/java/com/lyhn/wraith/gateway/qq/QqProvider.java \
        src/test/java/com/lyhn/wraith/gateway/qq/QqProviderTest.java
git commit -m "feat(gateway): ImProvider SPI + QqProvider 回填(QQ 装配收进 provider,行为不变)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 2: `GatewayDaemon` 切换到多-provider 控制流

把 `GatewayDaemon.start()` 从「内联 QQ 块 + 阻塞在 ws.connect」改为「`buildProviders()` 造 provider 列表 → 注册各自 DeliveryAdapter → askSurface 广播 surfacing → 逐个 start 到线程 → 阻塞在 latch」。删除旧内联 QQ 装配块。

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/gateway/GatewayDaemon.java`(整段重写 `start()`,新增 `buildProviders`)
- Test: `src/test/java/com/lyhn/wraith/gateway/GatewayDaemonProvidersTest.java`(新建)

**Interfaces:**
- Consumes:Task 1 的 `ImProvider`、`QqProvider`;`WraithConfig`(`getGateway()`→`GatewayConfig.getQq()`);既有 `LlmClient`/`AutomationStore`/`Scheduler`/`Deliverer`/`DesktopDeliveryAdapter`/`RequestInbox`/`ScheduledRunRenderer.AskSurface`/`AutomationRunner.InProcessTurnEngine`。
- Produces:`static List<ImProvider> GatewayDaemon.buildProviders(WraithConfig cfg, LlmClient client, Path wraithDir, Map<String,CompletableFuture<ApprovalResult>> pendingApprovals)` —— package-private,供测试。

- [ ] **Step 1: 写失败测试 `GatewayDaemonProvidersTest`**

`src/test/java/com/lyhn/wraith/gateway/GatewayDaemonProvidersTest.java`:

```java
package com.lyhn.wraith.gateway;

import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.gateway.spi.ImProvider;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.*;

class GatewayDaemonProvidersTest {

    private WraithConfig cfgWithQq() {
        WraithConfig cfg = new WraithConfig();
        WraithConfig.GatewayQqConfig qq = new WraithConfig.GatewayQqConfig();
        qq.setAppId("appid-x");
        qq.setClientSecret("secret-x");
        qq.setOwnerOpenid("owner-x");
        qq.setWorkspace("/tmp/ws");
        WraithConfig.GatewayConfig gw = new WraithConfig.GatewayConfig();
        gw.setQq(qq);
        cfg.setGateway(gw);
        return cfg;
    }

    @Test
    void buildsQqProviderWhenQqConfigured(@TempDir Path dir) {
        Map<String, CompletableFuture<ApprovalResult>> pending = new ConcurrentHashMap<>();
        // client=null: buildProviders does not touch the LLM (session factory is lazy).
        List<ImProvider> providers =
                GatewayDaemon.buildProviders(cfgWithQq(), null, dir, pending);
        assertEquals(1, providers.size());
        assertEquals("qq", providers.get(0).platform());
        assertTrue(providers.get(0).deliveryAdapter().isPresent());
    }

    @Test
    void buildsEmptyWhenNoGateway(@TempDir Path dir) {
        Map<String, CompletableFuture<ApprovalResult>> pending = new ConcurrentHashMap<>();
        List<ImProvider> providers =
                GatewayDaemon.buildProviders(new WraithConfig(), null, dir, pending);
        assertTrue(providers.isEmpty());
    }

    @Test
    void buildsEmptyWhenGatewayHasNoQq(@TempDir Path dir) {
        Map<String, CompletableFuture<ApprovalResult>> pending = new ConcurrentHashMap<>();
        WraithConfig cfg = new WraithConfig();
        cfg.setGateway(new WraithConfig.GatewayConfig()); // qq == null
        List<ImProvider> providers =
                GatewayDaemon.buildProviders(cfg, null, dir, pending);
        assertTrue(providers.isEmpty());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=GatewayDaemonProvidersTest test`
Expected: 编译失败 —— `GatewayDaemon.buildProviders` 不存在(cannot find symbol)。

- [ ] **Step 3: 重写 `GatewayDaemon`**

整体替换 `src/main/java/com/lyhn/wraith/gateway/GatewayDaemon.java` 的 imports + 类体为下面内容(删除所有 `gateway.qq.*` 与 QQ 专用 delivery import,改用 `ImProvider`/`QqProvider`):

```java
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
        for (ImProvider p : providers) {
            try {
                p.start();
                log.info("[gateway] IM provider 已启动: {}", p.platform());
            } catch (Exception e) {
                log.error("[gateway] IM provider 启动失败: {} — {}", p.platform(), e.getMessage());
            }
        }

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
        return providers;
    }
}
```

- [ ] **Step 4: 跑新测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=GatewayDaemonProvidersTest test`
Expected: PASS(3 tests)。

- [ ] **Step 5: QQ 全回归(核心门禁)**

Run: `mvn -q -DskipTests=false -Dtest='Qq*Test,GatewaySessionTest,ImTurnDriverTest,SessionRouterTest,GatewayRendererTest,AuthorizerTest,AutomationDeliveryFlushTest,MainGatewayDispatchTest,WraithConfigGatewayTest,AppServerGatewayConfigTest,QqProviderTest,GatewayDaemonProvidersTest' test`
Expected: 全 PASS。这些是 QQ 行为的回归网 —— 任何红都说明重构改了行为,必须修回。

- [ ] **Step 6: 全量构建(确认无编译/引用断裂)**

Run: `mvn -q -DskipTests=false test`
Expected: 仅 ~4F 已知 JDK/Mockito 基线噪声,无新增失败;无编译错误。

- [ ] **Step 7: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/GatewayDaemon.java \
        src/test/java/com/lyhn/wraith/gateway/GatewayDaemonProvidersTest.java
git commit -m "refactor(gateway): daemon 切多-provider 控制流(buildProviders + latch 常驻),删 QQ 内联块

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

## 自审(写完计划回看 spec)

**1. Spec 覆盖**:本 Phase A 只覆盖 spec 的「Part 1:ImProvider SPI + QQ 回填 + daemon 改造」。spec 的 Feishu provider(Part 2)、config/RPC(Part 3)、桌面 UI(Part 4)、卡片 HITL(Part 5)属 Phase B/C,不在本计划——符合分阶段决定。

**2. 占位扫描**:无 TBD/TODO;每个代码步给了完整可编译代码;测试均有真实断言(非空测试)。

**3. 类型一致性**:`ImProvider` 五方法签名在 Task 1 定义、Task 2 消费一致;`buildProviders` 签名 Task 2 内自洽;`QqProvider` 两个构造签名与测试用法一致;`surfaceScheduledApproval(approvalId, toolName, suggestion)` 在 daemon Step 5 与 QqProvider 实现一致。

**4. 偏离 spec 的两处(已获用户批准)**:① provider 各自持有 router(非共享+前缀),QQ key 保持裸 openid;② 不引入 InboundSink/ApprovalSurface(provider 自带 driver,审批分流留 provider 内)。

**已知测试限制(诚实标注)**:`QqProvider` 的 WS 连接回路 + `GatewayDaemon.start()` 的阻塞常驻流是网络/阻塞代码,不做单元测试;其正确性由「代码逐字搬迁 + 既有 `QqWsClientLogicTest` 等回归网全绿 + Phase A 完工后真机眼验 QQ 单聊仍工作」共同保证。眼验脚本:`wraith gateway`(已配 QQ)→ QQ 私聊发消息 → 收到回复;触发一次 HITL → 收到审批按钮 → 点批准继续;状态灯正常。
