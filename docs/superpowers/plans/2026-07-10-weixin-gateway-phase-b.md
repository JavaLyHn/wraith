# 微信网关 Phase B 实现计划(文本 HITL + cron 投递 + 配置视图)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 执行。步骤用 `- [ ]`。
> **前置**:Phase A(feat/im-weixin-gateway,HEAD e046a5e)已完成——绑定 CLI + 单聊对话闭环。本计划在其上扩展。

**Goal:** 微信 provider 支持文本审批(y/a/n)、cron 结果投递给主人、AppServer 配置视图(platform=weixin),功能对齐 QQ/飞书/企微。

**Architecture:** `WeixinApproval`(promptText/parse 纯函数)+ `WeixinDeliveryAdapter`(投递,目标=主人最近 context_token)+ `WeixinProvider` 扩展(挂起审批状态机:一次一个 pendingSessionKey;APPROVAL_REPLY→pendingApprovals(定时)或 driver.onApproval(IM);NUDGE 提醒;surfaceScheduledApproval 主动推提示)+ AppServer 读**账号店**组装视图(token 永不回)。

**Tech Stack:** Java 17,JUnit5。继续零改动 `com.lyhn.wraith.wechat` 包。

## Global Constraints

- 密钥红线:`bot_token` 绝不进日志/RPC/输出;**异常输出只报 `e.getClass().getSimpleName()`**(IlinkClient 的 IOException 携带完整响应体——终审 I-1 教训,全 Phase 适用)。
- **测试隔离红线(企微事故教训)**:任何测试**不得写真实** `~/.wraith/wechat/accounts/latest.json` 或 `~/.wraith/config.json`——AppServer 的 weixin **set 不写测试**(EYE-VERIFY);get 测试只断言视图结构 + 无 token 字段,不断言 bound 具体值(依赖用户真实文件)。
- 文本审批协议(spec 已定):promptText=「⚠️ 需要审批:<tool>。回复 y 批准 / a 总是允许 / n 拒绝」;parse:y→approve() / a→approveAll() / n→reject("用户在微信拒绝") / 其它→null。
- 挂起状态机:v1 一次一个 `pendingSessionKey`;新审批到来先把旧挂起 reject("被新审批替换");审批提示送达依赖 `ownerLastContextToken`,缺失→**自动拒绝该审批**(fail-closed,不悬挂)+ warn。
- 每任务跑覆盖测试;提交前红线扫描 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer|getMessage"`(getMessage 新增命中须逐条解释)。

---

### Task 1: WeixinApproval(纯函数)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/weixin/WeixinApproval.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/weixin/WeixinApprovalTest.java`

**Interfaces:**
- Consumes:`com.lyhn.wraith.hitl.ApprovalResult`(`approve()/approveAll()/reject(String)`、`isApproved()/isApprovedAll()`)
- Produces:`static String promptText(String toolName)`;`static ApprovalResult parse(String text)`

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.gateway.weixin;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WeixinApprovalTest {

    @Test
    void promptTextContainsToolNameAndKeys() {
        String p = WeixinApproval.promptText("shell");
        assertTrue(p.contains("shell"));
        assertTrue(p.contains("y") && p.contains("a") && p.contains("n"));
    }

    @Test
    void promptTextNullToolFallsBackGeneric() {
        String p = WeixinApproval.promptText(null);
        assertFalse(p.contains("null"));
        assertTrue(p.contains("审批"));
    }

    @Test
    void parseYaN() {
        assertTrue(WeixinApproval.parse("y").isApproved());
        assertFalse(WeixinApproval.parse("y").isApprovedAll());
        assertTrue(WeixinApproval.parse("A").isApprovedAll());
        assertFalse(WeixinApproval.parse(" n ").isApproved());
    }

    @Test
    void parseOtherReturnsNull() {
        assertNull(WeixinApproval.parse("yes"));
        assertNull(WeixinApproval.parse(""));
        assertNull(WeixinApproval.parse(null));
    }
}
```

- [ ] **Step 2: 跑确认失败** — `mvn -q -DskipTests=false -Dtest=WeixinApprovalTest test`。

- [ ] **Step 3: 写实现**

```java
package com.lyhn.wraith.gateway.weixin;

import com.lyhn.wraith.hitl.ApprovalResult;

import java.util.Locale;

/**
 * 微信文本 HITL:审批提示文案 + 主人回复解析(y/a/n)。个人微信无按钮/卡片,
 * 审批走纯文本三键协议;非 y/a/n 由 WeixinInbound 判为 APPROVAL_NUDGE(重提醒)。
 */
public final class WeixinApproval {

    private WeixinApproval() {}

    /** 审批提示文案;toolName 空则用通用文案。 */
    public static String promptText(String toolName) {
        String what = toolName == null || toolName.isBlank() ? "工具操作" : toolName;
        return "⚠️ 需要审批:" + what + "。回复 y 批准 / a 总是允许 / n 拒绝";
    }

    /** 解析主人回复:y/a/n(忽略大小写与空白);其它返回 null。 */
    public static ApprovalResult parse(String text) {
        if (text == null) return null;
        return switch (text.trim().toLowerCase(Locale.ROOT)) {
            case "y" -> ApprovalResult.approve();
            case "a" -> ApprovalResult.approveAll();
            case "n" -> ApprovalResult.reject("用户在微信拒绝");
            default -> null;
        };
    }
}
```

- [ ] **Step 4: 跑确认通过**(4/4)。

- [ ] **Step 5: Commit**
```bash
git add src/main/java/com/lyhn/wraith/gateway/weixin/WeixinApproval.java src/test/java/com/lyhn/wraith/gateway/weixin/WeixinApprovalTest.java
git commit -m "feat(gateway/weixin): WeixinApproval 文本审批提示/解析纯模块 + 单测"
```

---

### Task 2: WeixinDeliveryAdapter(cron 投递)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/automation/delivery/WeixinDeliveryAdapter.java`
- Test: `src/test/java/com/lyhn/wraith/automation/delivery/WeixinDeliveryAdapterTest.java`

**先读** `WecomDeliveryAdapter.java` 与其测试(同形态范式;RunResult/DeliveryTarget/AutomationTask 的构造以真实定义为准——`RunResult(String status, String answer, String sessionId, List<String>)`、`DeliveryTarget` 公共字段、`AutomationTask.name` 公共字段)。

**Interfaces:**
- 构造 `(java.util.function.Supplier<String> ownerContextTokenSupplier, java.util.function.BiConsumer<String,String> sink)`——sink 收 `(contextToken, text)`。
- `platform()` = `"weixin"`;`deliver(...)`:contextToken 空→warn 跳过;否则 `sink.accept(ctx, "⏰ <任务名>:\n" + MarkdownLite.toPlainText(结果))`;整体 try/catch(**catch 打 `e.getClass().getSimpleName()`**)。

- [ ] **Step 1-5**:TDD 复刻 WecomDeliveryAdapterTest 的用例形态(platform、空/null contextToken 跳过、正常发送含任务名+纯文本结果、sink 抛异常被守护),实现照上述;commit:
```bash
git commit -m "feat(gateway/weixin): WeixinDeliveryAdapter cron 投递(主人最近 context_token)+ 单测"
```

---

### Task 3: WeixinProvider 扩展(文本 HITL 状态机 + 投递接线)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/gateway/weixin/WeixinProvider.java`
- Modify: `src/test/java/com/lyhn/wraith/gateway/weixin/WeixinProviderTest.java`

**先读现有 WeixinProvider 全文**(Phase A 版)。改动要点(完整代码块如下,实现者按现有结构融入):

(a) **字段提升与新增**(部分 ctor 局部量升为字段,便于 HITL/测试接缝):
```java
    private final Map<String, CompletableFuture<ApprovalResult>> pendingApprovals;
    private final ImTurnDriver driver;                 // 生产构造赋值;测试构造可 null
    private final java.util.function.BiConsumer<String, String> plainSender; // (contextToken,text) 纯文本发送口
    private final WeixinDeliveryAdapter deliver;
    /** 文本 HITL:当前挂起审批 sessionKey(v1 一次一个;null=无挂起)。仅测试注释:生产由回路线程/审批线程写。 */
    private volatile String pendingSessionKey;
```
生产构造:`this.pendingApprovals = pendingApprovals;`;`this.plainSender = (ctx, text) -> { try { ilink.sendText(accountRef.get(), this.boundUserId, ctx, text); } catch (Exception e) { log.warn("[gateway] 微信文本发送失败: {}", e.getClass().getSimpleName()); } };`;driver 赋给字段(Sender lambda 不变);
`this.deliver = new WeixinDeliveryAdapter(() -> ownerLastContextToken, plainSender);`。
`GatewaySession` 的 approvalSurface 闭包从 no-op 改为:`sessKey -> surfaceApproval(sessKey, null)`。

(b) **审批核心方法**:
```java
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
```

(c) **handleInbound 改动**:dedup 后、classify 前,凡主人消息先更新 `ownerLastContextToken = m.contextToken();`(取代原 PROCESS 分支里的赋值);classify 传 `pendingSessionKey != null`;分支:
```java
            case APPROVAL_REPLY -> handleApprovalText(m.text(), m.contextToken());
            case APPROVAL_NUDGE -> plainSender.accept(m.contextToken(),
                    "有待审批操作,请先回复 y 批准 / a 总是允许 / n 拒绝");
```
NONTEXT_NOTICE 的发送也改走 `plainSender.accept(m.contextToken(), "暂只支持文本消息。")`(统一出口)。

(d) **override surfaceScheduledApproval**:
```java
    @Override
    public void surfaceScheduledApproval(String approvalId, String toolName, String suggestion) {
        surfaceApproval(approvalId, toolName);
    }
```

(e) **deliveryAdapter()** 改 `return Optional.ofNullable(deliver);`(测试构造 deliver 也构造,见下)。

(f) **测试构造**扩为:
```java
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
```
旧两参测试构造保留,委托四参(`pendingApprovals = new java.util.concurrent.ConcurrentHashMap<>()`,`plainSender = (c, t) -> {}`)。
加包私测试接缝:
```java
    /** 仅测试:登记挂起审批 + 注入主人 context_token。生产路径不调用。 */
    void registerPendingForTest(String sessionKey, String ownerContextToken) {
        this.pendingSessionKey = sessionKey;
        this.ownerLastContextToken = ownerContextToken;
    }
    String pendingSessionKeyForTest() { return pendingSessionKey; }
```

- [ ] **Step 1: 改/加测试**(WeixinProviderTest;保留原 3 个,`deliveryAdapterEmptyInPhaseA` 改断言 present):

```java
    @Test
    void deliveryAdapterPresentInPhaseB() {
        var opt = new WeixinProvider("OWNER", () -> {}).deliveryAdapter();
        assertTrue(opt.isPresent());
        assertEquals("weixin", opt.get().platform());
    }

    @Test
    void approvalReplyCompletesScheduledFuture() {
        java.util.Map<String, java.util.concurrent.CompletableFuture<com.lyhn.wraith.hitl.ApprovalResult>> pending =
                new java.util.concurrent.ConcurrentHashMap<>();
        var future = new java.util.concurrent.CompletableFuture<com.lyhn.wraith.hitl.ApprovalResult>();
        pending.put("run1#1", future);
        java.util.List<String> sent = new java.util.ArrayList<>();
        WeixinProvider p = new WeixinProvider("OWNER", () -> {}, pending, (ctx, text) -> sent.add(text));
        p.registerPendingForTest("run1#1", "CTX");
        p.handleApprovalText("y", "CTX");
        assertTrue(future.isDone());
        assertTrue(future.join().isApproved());
        assertNull(p.pendingSessionKeyForTest(), "回复后应清挂起");
        assertFalse(sent.isEmpty(), "应回执「已批准」");
    }

    @Test
    void surfaceScheduledApprovalUnreachableAutoRejects() {
        java.util.Map<String, java.util.concurrent.CompletableFuture<com.lyhn.wraith.hitl.ApprovalResult>> pending =
                new java.util.concurrent.ConcurrentHashMap<>();
        var future = new java.util.concurrent.CompletableFuture<com.lyhn.wraith.hitl.ApprovalResult>();
        pending.put("run2#1", future);
        WeixinProvider p = new WeixinProvider("OWNER", () -> {}, pending, (ctx, text) -> {});
        p.surfaceScheduledApproval("run2#1", "shell", "跑脚本"); // 无 ownerContextToken
        assertTrue(future.isDone());
        assertFalse(future.join().isApproved(), "不可达应 fail-closed 自动拒绝");
    }
```

- [ ] **Step 2: 跑确认失败** → **Step 3: 按要点改实现** → **Step 4: 跑确认通过**(`mvn -q -DskipTests=false -Dtest='WeixinProviderTest,WeixinInboundTest' test` 全绿)+ `mvn -q -DskipTests compile`。

- [ ] **Step 5: Commit**
```bash
git add src/main/java/com/lyhn/wraith/gateway/weixin/WeixinProvider.java src/test/java/com/lyhn/wraith/gateway/weixin/WeixinProviderTest.java
git commit -m "feat(gateway/weixin): 文本 HITL 状态机(y/a/n,一次一挂起,fail-closed)+ 投递接线"
```

---

### Task 4: AppServer 配置视图(platform=weixin)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`
- Modify: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerGatewayConfigTest.java`(**只加 get 用例**)

**先读** AppServer 现有 `gateway.config.get/set` 的 wecom 分支。weixin 特殊:**读账号店而非 config.json**;set 只允许改 workspace(token/owner 归 bind-weixin)。

- [ ] **Step 1: get 加分支**(wecom 分支后):

```java
                } else if ("weixin".equals(platform)) {
                    // 微信:读 wechat 账号店(token/游标高频写,不进 config.json);绝不回 token
                    boolean bound = false; String owner = null; String ws = null;
                    try {
                        var acc = com.lyhn.wraith.wechat.WechatAccountStore.createDefault().loadLatest();
                        if (acc.isPresent()) {
                            bound = acc.get().token() != null && !acc.get().token().isBlank();
                            owner = acc.get().boundUserId();
                            ws = acc.get().workspace();
                        }
                    } catch (Exception e) { /* 账号店缺失/损坏 → 按未绑定视图 */ }
                    r.put("bound", bound);
                    r.put("hasSecret", bound);
                    r.put("ownerUserid", owner);
                    r.put("workspace", ws);
                }
```

- [ ] **Step 2: set 加分支**(wecom set 分支后;**EYE-VERIFY,不写测试**——它写真实账号店):

```java
                    } else if ("weixin".equals(platform)) {
                        // 只允许改 workspace;token/owner 由 bind-weixin 扫码流程写入账号店
                        if (p != null && p.hasNonNull("workspace")) {
                            try {
                                var store = com.lyhn.wraith.wechat.WechatAccountStore.createDefault();
                                store.loadLatest().ifPresent(acc ->
                                        store.save(acc.withWorkspace(p.get("workspace").asText())));
                            } catch (Exception e) { /* 账号店缺失/损坏,忽略 */ }
                        }
                    }
```
(具体嵌入位置以现有 set 的 if/else-if 链为准;若链尾有 qq 兜底 else,放它之前。)

- [ ] **Step 3: 只加 get 测试**(照 wecom get 用例形态;**只断言结构与红线,不断言 bound 值**——视图读的是用户真实账号店):

```java
    @Test
    void gatewayConfigGetWeixinReturnsSafeViewWithoutToken() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"gateway.config.get\",\"params\":{\"platform\":\"weixin\"}}");
        JsonNode res = byId(r, 2).get("result");
        assertNotNull(res, "gateway.config.get(weixin) 应返回 result");
        assertTrue(res.has("bound"));
        assertTrue(res.has("hasSecret"));
        assertTrue(res.has("ownerUserid"));
        assertTrue(res.has("workspace"));
        // 密钥红线:绝不回 token(任何命名)
        assertFalse(res.has("token"), "绝不能返回 token");
        assertFalse(res.has("botToken"), "绝不能返回 botToken");
    }
```

- [ ] **Step 4: 验证** — `mvn -DskipTests=false -Dtest='AppServerGatewayConfigTest,Weixin*Test' test` 全绿 + 编译。

- [ ] **Step 5: Commit**
```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerGatewayConfigTest.java
git commit -m "feat(appserver): gateway.config get/set 支持 platform=weixin(读账号店,token 永不回;set 仅 workspace)"
```

---

## Phase B 收尾 / 眼验补充

- 全量:`mvn -DskipTests=false -Dtest='Weixin*Test,AppServerGatewayConfigTest' test` 全绿。
- 真机眼验(接 Phase A):① 触发需审批操作 → 微信收到「⚠️ 需要审批…回复 y/a/n」→ 回 y/n → turn 继续/中止 + 收到回执;② 挂起时发别的话 → 收到重提醒;③ cron 结果 → 微信收到「⏰ …」推送(前提:主人先发过消息)。
- opus 整支终审(BASE=e046a5e..HEAD),携 Minor 清单。

## Self-Review 记录

- Spec 覆盖:组件 2(WeixinApproval)、4(投递)、6(AppServer)+ provider HITL 扩展全落;桌面归 Phase C。
- 关键设计:审批不可达 fail-closed 自动拒绝(不悬挂 future);挂起一次一个,新替旧 reject;回执统一走 plainSender(异常只报类名——终审 I-1 教训全 Phase 贯彻)。
- 测试隔离:AppServer set(weixin)不写测试(写真实账号店,企微事故教训);get 测试只断结构+红线。
- 依赖签名均此前已核(onApproval/ApprovalResult/DeliveryAdapter/RunResult/withWorkspace/AppServer 分支)。
