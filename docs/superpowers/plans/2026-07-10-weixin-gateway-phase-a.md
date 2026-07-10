# 微信网关 Phase A 实现计划(复用 iLink 栈 + 单聊对话闭环)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 执行本计划。步骤用 `- [ ]`。

**Goal:** `wraith gateway bind-weixin` 终端扫码绑定后,`wraith gateway` 能作为 weixin provider 长轮询收发个人微信单聊消息(可真机眼验)。

**Architecture:** 全量复用现有 `com.lyhn.wraith.wechat` 包(IlinkClient / WechatAccountStore / 消息模型 / TerminalQrRenderer,**一律不改动**);新增网关侧:`WeixinInbound`(分类纯函数)、`WeixinProvider`(长轮询回路 + ImTurnDriver 装配)、`WeixinBind`(bind-weixin CLI)、buildProviders 接线。

**Tech Stack:** Java 17,复用 okhttp/Jackson(经 IlinkClient),JUnit5。新包 `com.lyhn.wraith.gateway.weixin`。

## Global Constraints

- 密钥红线:`bot_token` 只存 `~/.wraith/wechat/accounts/latest.json`(WechatAccountStore 管理,0600),**绝不打印/日志/RPC**;绑定输出只打 accountId/workspace。
- **不修改** `com.lyhn.wraith.wechat` 包任何文件(纯复用;那是 REPL `/wechat` 通道的既有实现)。
- 回复纯文本:`MarkdownLite.toPlainText(text)`(微信不渲染 markdown)。
- 会话 key = `account.boundUserId()`(扫码者即主人,fail-closed,无配对回显);去重键 = `WechatMessage.messageId()`(**不可用 contextToken**);回复关联:`InboundMsg.msgId = contextToken` 经 `Sender.replyTo` 回带 `IlinkClient.sendText`。
- token 失效 `ret == -14` → 打 `WRAITH_GATEWAY_STATUS auth-failed` 并**退出回路**(重试无意义,需重扫码);轮询 IOException → `disconnected` + 退避重连;首次轮询成功 → `running`。状态灯 token 全在现有桌面分类器集合内,零桌面改动。
- Phase A 边界:HITL 为 no-op(`hasPendingApproval` 恒 false;approvalSurface `sessKey -> {}`)、`deliveryAdapter()` 返回 `Optional.empty()`(均归 Phase B)。
- 每任务跑覆盖测试;提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。

---

### Task 1: WeixinInbound(纯函数:入站分类)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/weixin/WeixinInbound.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/weixin/WeixinInboundTest.java`

**Interfaces:**
- Consumes:`com.lyhn.wraith.wechat.WechatMessage`(record `(String messageId, String fromUserId, String contextToken, String text, List<WechatMediaItem> mediaItems)`)、`com.lyhn.wraith.gateway.qq.InboundMsg`(record `(String openid, String text, String msgId, long ts)`)
- Produces:`enum Kind{IGNORE, NONTEXT_NOTICE, APPROVAL_REPLY, APPROVAL_NUDGE, PROCESS}`;`record Result(Kind kind, InboundMsg msg)`;`static Result classify(WechatMessage m, String boundUserId, boolean hasPendingApproval, long nowMs)`

- [ ] **Step 1: 写失败测试 `WeixinInboundTest`**

```java
package com.lyhn.wraith.gateway.weixin;

import com.lyhn.wraith.wechat.WechatMediaItem;
import com.lyhn.wraith.wechat.WechatMessage;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class WeixinInboundTest {

    private WechatMessage msg(String from, String text) {
        return new WechatMessage("MID1", from, "CTX1", text, List.of());
    }

    @Test
    void ownerTextProcessesWithContextTokenAsMsgId() {
        var r = WeixinInbound.classify(msg("OWNER", "你好"), "OWNER", false, 42L);
        assertEquals(WeixinInbound.Kind.PROCESS, r.kind());
        assertEquals("OWNER", r.msg().openid());
        assertEquals("你好", r.msg().text());
        assertEquals("CTX1", r.msg().msgId(), "msgId 应为 contextToken 以承载回复关联");
        assertEquals(42L, r.msg().ts());
    }

    @Test
    void nonOwnerIgnored() {
        assertEquals(WeixinInbound.Kind.IGNORE,
                WeixinInbound.classify(msg("STRANGER", "hi"), "OWNER", false, 0L).kind());
    }

    @Test
    void blankFromIgnored() {
        assertEquals(WeixinInbound.Kind.IGNORE,
                WeixinInbound.classify(msg("", "hi"), "OWNER", false, 0L).kind());
        assertEquals(WeixinInbound.Kind.IGNORE,
                WeixinInbound.classify(null, "OWNER", false, 0L).kind());
    }

    @Test
    void mediaOnlyGetsNonTextNotice() {
        WechatMessage media = new WechatMessage("MID2", "OWNER", "CTX2", "",
                List.of(new WechatMediaItem("image", null, "image/png", "q", "k")));
        assertEquals(WeixinInbound.Kind.NONTEXT_NOTICE,
                WeixinInbound.classify(media, "OWNER", false, 0L).kind());
    }

    @Test
    void ownerBlankTextIgnored() {
        assertEquals(WeixinInbound.Kind.IGNORE,
                WeixinInbound.classify(msg("OWNER", "   "), "OWNER", false, 0L).kind());
    }

    @Test
    void pendingApprovalYanAreReplies() {
        for (String t : new String[]{"y", "Y", "a", "N", " n "}) {
            assertEquals(WeixinInbound.Kind.APPROVAL_REPLY,
                    WeixinInbound.classify(msg("OWNER", t), "OWNER", true, 0L).kind(), "输入: " + t);
        }
    }

    @Test
    void pendingApprovalOtherTextIsNudge() {
        assertEquals(WeixinInbound.Kind.APPROVAL_NUDGE,
                WeixinInbound.classify(msg("OWNER", "帮我跑个测试"), "OWNER", true, 0L).kind());
    }

    @Test
    void pendingApprovalNonOwnerStillIgnored() {
        assertEquals(WeixinInbound.Kind.IGNORE,
                WeixinInbound.classify(msg("STRANGER", "y"), "OWNER", true, 0L).kind());
    }
}
```

- [ ] **Step 2: 跑确认失败** — `mvn -q -DskipTests=false -Dtest=WeixinInboundTest test`(编译失败)。

- [ ] **Step 3: 写 `WeixinInbound`**

```java
package com.lyhn.wraith.gateway.weixin;

import com.lyhn.wraith.gateway.qq.InboundMsg;
import com.lyhn.wraith.wechat.WechatMessage;

import java.util.Locale;

/**
 * 微信入站消息分类(纯逻辑)。扫码者即主人(boundUserId),非主人一律 IGNORE(fail-closed,
 * 无配对回显)。挂起文本审批时,y/a/n 判为 APPROVAL_REPLY、其余判 APPROVAL_NUDGE(Phase B 消费;
 * Phase A 调用方恒传 hasPendingApproval=false)。PROCESS 时 InboundMsg.msgId 用 contextToken
 * 承载回复关联;去重由调用方以 messageId 在 classify 之前完成。
 */
public final class WeixinInbound {

    private WeixinInbound() {}

    public enum Kind { IGNORE, NONTEXT_NOTICE, APPROVAL_REPLY, APPROVAL_NUDGE, PROCESS }

    public record Result(Kind kind, InboundMsg msg) {
        static Result of(Kind k) { return new Result(k, null); }
        static Result process(InboundMsg m) { return new Result(Kind.PROCESS, m); }
    }

    public static Result classify(WechatMessage m, String boundUserId, boolean hasPendingApproval, long nowMs) {
        if (m == null || m.fromUserId() == null || m.fromUserId().isBlank()) return Result.of(Kind.IGNORE);
        if (boundUserId == null || !boundUserId.equals(m.fromUserId())) return Result.of(Kind.IGNORE);
        String text = m.text() == null ? "" : m.text().trim();
        if (text.isEmpty() && m.mediaItems() != null && !m.mediaItems().isEmpty()) {
            return Result.of(Kind.NONTEXT_NOTICE);
        }
        if (hasPendingApproval) {
            String t = text.toLowerCase(Locale.ROOT);
            return ("y".equals(t) || "a".equals(t) || "n".equals(t))
                    ? Result.of(Kind.APPROVAL_REPLY)
                    : Result.of(Kind.APPROVAL_NUDGE);
        }
        if (text.isEmpty()) return Result.of(Kind.IGNORE);
        return Result.process(new InboundMsg(m.fromUserId(), text, m.contextToken(), nowMs));
    }
}
```

- [ ] **Step 4: 跑确认通过** — 预期 8/8。

- [ ] **Step 5: Commit**
```bash
git add src/main/java/com/lyhn/wraith/gateway/weixin/WeixinInbound.java src/test/java/com/lyhn/wraith/gateway/weixin/WeixinInboundTest.java
git commit -m "feat(gateway/weixin): WeixinInbound 入站分类纯模块(owner fail-closed + 文本审批分类)+ 单测"
```

---

### Task 2: WeixinProvider(装配:长轮询回路 + 单聊对话)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/weixin/WeixinProvider.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/weixin/WeixinProviderTest.java`

**Interfaces:**
- Consumes(先读对齐,签名已核):`IlinkClient`(`getUpdates(WechatAccount, long)` / `sendText(WechatAccount, String, String, String)` / `sendTyping(WechatAccount, String, String, int)` / `notifyStart/notifyStop(WechatAccount)`,均 throws IOException)、`WechatAccountStore.save(WechatAccount)`、`WechatAccount.withSyncBuf(String)`、`WechatUpdate(ret(), nextSyncBuf(), nextLongPollTimeoutMs(), messages())`、`SessionRouter(Function)`、`GatewaySession(key, workspace, client, Consumer<String>)`、`ImTurnDriver(router, Sender, ExecutorService)`、`Dedup(int).seen`、`MarkdownLite.toPlainText(String)`、`WeixinInbound`(Task 1)。
- Produces:`WeixinProvider implements ImProvider`;生产构造 `(WechatAccount, LlmClient, Map<String,CompletableFuture<ApprovalResult>>)`;测试构造 `(String boundUserId, Runnable pollLoop)`。

- [ ] **Step 1: 写失败测试 `WeixinProviderTest`**(复刻 WecomProviderTest Phase A 风格)

```java
package com.lyhn.wraith.gateway.weixin;

import org.junit.jupiter.api.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class WeixinProviderTest {

    @Test
    void platformIsWeixin() {
        assertEquals("weixin", new WeixinProvider("OWNER", () -> {}).platform());
    }

    @Test
    void deliveryAdapterEmptyInPhaseA() {
        assertTrue(new WeixinProvider("OWNER", () -> {}).deliveryAdapter().isEmpty());
    }

    @Test
    void startRunsPollLoopOnDaemonThread() throws Exception {
        CountDownLatch ran = new CountDownLatch(1);
        new WeixinProvider("OWNER", ran::countDown).start();
        assertTrue(ran.await(2, TimeUnit.SECONDS), "start() 应把轮询回路放新线程跑并立即返回");
    }
}
```

- [ ] **Step 2: 跑确认失败**。

- [ ] **Step 3: 写 `WeixinProvider`**

```java
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
        // account 随游标推进而更新;仅回路线程写,Sender 读(volatile 容器)
        final WechatAccount[] accountRef = {initialAccount};

        SessionRouter router = new SessionRouter(userid ->
                new GatewaySession(userid, initialAccount.workspace(), client, sessKey -> { /* HITL: Phase B */ }));

        ImTurnDriver driver = new ImTurnDriver(router, (userid, text, replyTo) -> {
            try {
                ilink.sendText(accountRef[0], userid, replyTo, MarkdownLite.toPlainText(text));
                typing(ilink, accountRef[0], userid, replyTo, 2); // 回复完成,停打字指示
            } catch (Exception e) {
                log.warn("[gateway] 微信回复发送失败: {}", e.toString());
            }
        }, this.pool);

        this.pollLoop = () -> {
            System.out.println("WRAITH_GATEWAY_STATUS starting");
            try { ilink.notifyStart(accountRef[0]); } catch (Exception e) { log.warn("[gateway] 微信 notifyStart 失败: {}", e.toString()); }
            long timeoutMs = 35_000;
            int attempt = 0;
            boolean running = false;
            while (!stopping && !Thread.currentThread().isInterrupted()) {
                try {
                    WechatUpdate update = ilink.getUpdates(accountRef[0], timeoutMs);
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
                        accountRef[0] = accountRef[0].withSyncBuf(update.nextSyncBuf());
                        store.save(accountRef[0]);
                    }
                    for (WechatMessage m : update.messages()) {
                        handleInbound(ilink, accountRef[0], dedup, driver, m);
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
            try { ilink.notifyStop(accountRef[0]); } catch (Exception ignored) { /* best-effort */ }
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
```

- [ ] **Step 4: 跑确认通过** — `mvn -q -DskipTests=false -Dtest=WeixinProviderTest test`,预期 3/3;并 `mvn -q -DskipTests compile` SUCCESS。

- [ ] **Step 5: Commit**
```bash
git add src/main/java/com/lyhn/wraith/gateway/weixin/WeixinProvider.java src/test/java/com/lyhn/wraith/gateway/weixin/WeixinProviderTest.java
git commit -m "feat(gateway/weixin): WeixinProvider 长轮询装配(复用 IlinkClient,单聊对话)+ 单测"
```

---

### Task 3: bind-weixin CLI

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/bind/WeixinBind.java`
- Modify: `src/main/java/com/lyhn/wraith/gateway/bind/BindCommand.java`(dispatch 加分支)

**Interfaces:**
- Consumes:`IlinkClient.startQrLogin("3")` / `pollQrStatus(qrcodeId)`、`WechatAccountStore.createAccount(token, accountId, baseUrl, boundUserId, workspace)` + `save`、`TerminalQrRenderer.print(PrintStream, String)`、`WechatQrLogin(qrcodeId, qrcodeUrl)`、`WechatLoginResult(connected, expired, ..., token, accountId, baseUrl, userId, message)`。
- Produces:`wraith gateway bind-weixin [--workspace <dir>]`。(EYE-VERIFY:需真机扫码,不做自动化测试——与 QQ bind 同策略,BindCommand javadoc 已有先例。)

- [ ] **Step 1: BindCommand.dispatch 加分支**(在 `"bind".equals(args[1])` 判断之前):

```java
        if (args != null && args.length >= 2 && "bind-weixin".equals(args[1])) {
            WeixinBind.run(args);
            return;
        }
```
并在类 javadoc 的 `<ul>` 里补一行:`<li>{@code wraith gateway bind-weixin [--workspace <dir>]} → 微信 iLink 扫码绑定(终端二维码;EYE-VERIFY)。</li>`

- [ ] **Step 2: 写 `WeixinBind`**

```java
package com.lyhn.wraith.gateway.bind;

import com.lyhn.wraith.wechat.IlinkClient;
import com.lyhn.wraith.wechat.TerminalQrRenderer;
import com.lyhn.wraith.wechat.WechatAccount;
import com.lyhn.wraith.wechat.WechatAccountStore;
import com.lyhn.wraith.wechat.WechatLoginResult;
import com.lyhn.wraith.wechat.WechatQrLogin;

import java.nio.file.Path;
import java.time.Duration;

/**
 * {@code wraith gateway bind-weixin [--workspace <dir>]}:微信 iLink 扫码绑定(非交互)。
 * 终端渲染二维码 → 手机微信扫码确认 → 轮询换 token → 写 WechatAccountStore
 * (扫码者 ilink_user_id 即主人 boundUserId)。EYE-VERIFY:需真机扫码。
 * ⚠ 密钥红线:bot_token 只落账号店,绝不打印。
 */
public final class WeixinBind {

    private static final long POLL_INTERVAL_MS = 3_000L;

    private WeixinBind() {}

    public static void run(String[] args) {
        String workspace = argValue(args, "--workspace");
        if (workspace == null || workspace.isBlank()) {
            workspace = Path.of(".").toAbsolutePath().normalize().toString();
        }
        IlinkClient client = new IlinkClient();
        WechatAccountStore store = WechatAccountStore.createDefault();
        try {
            WechatQrLogin qr = client.startQrLogin("3");
            System.out.println("请用目标微信扫描二维码:");
            TerminalQrRenderer.print(System.out, qr.qrcodeUrl());
            System.out.println("扫码失败时可打开链接:" + qr.qrcodeUrl());
            System.out.println("(等待扫码授权,最长约 300 秒)...");

            long deadline = System.nanoTime() + Duration.ofMinutes(5).toNanos();
            while (System.nanoTime() < deadline) {
                WechatLoginResult r = client.pollQrStatus(qr.qrcodeId());
                if (r.connected()) {
                    WechatAccount account = store.createAccount(
                            r.token(), r.accountId(), r.baseUrl(), r.userId(), workspace);
                    store.save(account);
                    System.out.println("✅ 微信绑定成功,账号: " + r.accountId());
                    System.out.println("工作区: " + workspace);
                    System.out.println("提示:网关将在下次 wraith gateway 启动时接入微信;与 /wechat REPL 通道不可同时运行。");
                    return;
                }
                if (r.expired()) {
                    System.err.println("[gateway] 二维码已过期,请重试 wraith gateway bind-weixin");
                    return;
                }
                Thread.sleep(POLL_INTERVAL_MS);
            }
            System.err.println("[gateway] 绑定超时(未在限定时间内完成扫码),请重试");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            System.err.println("[gateway] 绑定被中断");
        } catch (Exception e) {
            System.err.println("[gateway] 微信绑定失败: " + e.getMessage());
        }
    }

    /** 提取 `--key value` 形式的参数值;无则 null。 */
    static String argValue(String[] args, String key) {
        if (args == null) return null;
        for (int i = 0; i < args.length - 1; i++) {
            if (key.equals(args[i])) return args[i + 1];
        }
        return null;
    }
}
```

- [ ] **Step 3: 编译验证** — `mvn -q -DskipTests compile` SUCCESS。

- [ ] **Step 4: Commit**
```bash
git add src/main/java/com/lyhn/wraith/gateway/bind/WeixinBind.java src/main/java/com/lyhn/wraith/gateway/bind/BindCommand.java
git commit -m "feat(gateway/weixin): wraith gateway bind-weixin 终端扫码绑定(复用 iLink 登录流)"
```

---

### Task 4: 接线 GatewayDaemon.buildProviders

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/gateway/GatewayDaemon.java`(buildProviders 加 weixin 分支)

**Interfaces:**
- Consumes:`WechatAccountStore.createDefault().loadLatest()`(返回 `Optional<WechatAccount>`;文件损坏抛 IllegalStateException,须 catch)、`WeixinProvider(account, client, pendingApprovals)`。

- [ ] **Step 1: buildProviders 在 wecom 分支后加**:

```java
        // weixin:判据是 wechat 账号店(~/.wraith/wechat/accounts/latest.json)有绑定账号,
        // 而非 config.json —— token/游标由账号店管理(游标高频写,不进 config)。
        try {
            com.lyhn.wraith.wechat.WechatAccountStore.createDefault().loadLatest()
                    .ifPresent(acc -> providers.add(
                            new com.lyhn.wraith.gateway.weixin.WeixinProvider(acc, client, pendingApprovals)));
        } catch (Exception e) {
            log.warn("[gateway] 读取微信账号失败,跳过 weixin provider: {}", e.getMessage());
        }
```

- [ ] **Step 2: 编译 + 全部微信网关测试**

Run: `mvn -q -DskipTests compile` 然后 `mvn -DskipTests=false -Dtest='Weixin*Test' test`
Expected: WeixinInbound 8 + WeixinProvider 3 = 11 全过。

- [ ] **Step 3: Commit**
```bash
git add src/main/java/com/lyhn/wraith/gateway/GatewayDaemon.java
git commit -m "feat(gateway): buildProviders 接入 weixin(账号店有绑定即装配)"
```

---

## 真机眼验(Phase A 收尾)

1. `wraith gateway bind-weixin --workspace <目录>` → 终端出二维码 → 手机微信扫码确认 → 「✅ 微信绑定成功」。
2. 重建 jar 部署,`wraith gateway` 启动 → 日志 `IM provider 已启动: weixin` + `WRAITH_GATEWAY_STATUS running`。
3. **用别的微信号**(或让好友)给绑定的 bot 发消息 → 应被 IGNORE(fail-closed);**主人自己**发文本 → 收到 agent 纯文本回复(有打字指示)。
4. 若 `auth-failed` → 重新 bind-weixin;确保 REPL `/wechat` 未同时运行。

## Self-Review 记录

- Spec 覆盖:组件 1(WeixinInbound)、3(WeixinProvider Phase A 边界)、5(bind CLI)、7(buildProviders)全落;2/4/6/8 明确归 B/C。
- 复用约束:wechat 包零改动;所有消费的签名(IlinkClient/WechatAccount/模型/TerminalQrRenderer/BindCommand.dispatch)已逐一读源核对。
- 类型一致:InboundMsg.msgId=contextToken 贯穿 classify→driver→Sender.replyTo→sendText;去重键 messageId 与 spec 一致。
- 无占位:各步完整代码;bind-weixin 标注 EYE-VERIFY(与 QQ bind 同策略先例)。
