# 飞书网关 Phase B:飞书后端 provider 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用官方飞书 Java SDK 长连接实现 `FeishuProvider`(实现 Phase A 的 `ImProvider` SPI),接成飞书 p2p 单聊 bot,HITL 走飞书交互卡片按钮(`card.action.trigger` over WS);泛化 config/RPC/daemon 以并列 QQ 与飞书。QQ 行为零回归。

**Architecture:** 飞书用 `com.lark.oapi.ws.Client` 长连接收事件、`com.lark.oapi.Client` REST 发消息,`EventDispatcher` 注册消息 + 卡片回调 handler。`FeishuProvider` 自带 `SessionRouter`/`ImTurnDriver`/`Authorizer`/`Dedup`(与 QQ 对称,复用 Phase A 的可复用核心),**统一用 open_id** 作鉴权+会话 key+回发目标(`receive_id_type=open_id`)。飞书能主动发消息,故投递/审批卡**立即发**,无 QQ 的被动窗口/待发队列。`GatewayDaemon.buildProviders` 增飞书分支;`AppServer` 的 `gateway.config.get/set` 增 `platform` 参(默认 `qq`,向后兼容)。

**Tech Stack:** Java 17,Maven,JUnit 5;新依赖 `com.larksuite.oapi:oapi-sdk:2.4.19`(包名 `com.lark.oapi`)。

## Global Constraints

- **依赖**:仅新增 `com.larksuite.oapi:oapi-sdk:2.4.19`;不引入其它新依赖。
- **QQ 行为零回归**:不改动任何 `gateway.qq.*`(除被 import 的 `InboundMsg`)/`QqProvider`/QQ delivery 类;现有 QQ 全回归测试零改动通过。
- **密钥红线**:`appSecret` 只落 `~/.wraith/config.json`(仓库外),**绝不进日志/RPC 回包**;`gateway.config.get` 只回 `hasSecret:boolean`,绝不回 `appSecret` 明文。每次提交前跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer|app.?secret"`(只应命中字段名/自指/测试金丝雀)。
- **统一 open_id**:飞书鉴权、会话 key、回发目标(`receive_id_type=open_id`)全用 sender open_id;仅处理 `chat_type=="p2p"`、`message_type=="text"`。
- **Authorizer deny-all**:仅放行 `ownerOpenid`;未绑定(ownerOpenid 空)时对来访者回显其 open_id(配对),不自动授权。
- **SPI 契约**:`FeishuProvider.start()` 非阻塞(WS 阻塞循环放守护线程),对瞬时连接失败**不得抛出**(仅 `build()` 可能抛,发生在构造期;`ws.start()` 在线程内 try/catch)。
- **SDK API(v2.4.19,逐字确认)**:
  - REST:`com.lark.oapi.Client.newBuilder(appId, appSecret).openBaseUrl(BaseUrlEnum.FeiShu|LarkSuite).build()`。
  - WS:`new com.lark.oapi.ws.Client.Builder(appId, appSecret).eventHandler(dispatcher).domain(BaseUrlEnum.X.getUrl()).build()`;`.start()` 阻塞、void。
  - 分发器:`com.lark.oapi.event.EventDispatcher.newBuilder("", "").onP2MessageReceiveV1(h).onP2CardActionTrigger(h).build()`。
  - 消息 handler:抽象类 `com.lark.oapi.service.im.ImService.P2MessageReceiveV1Handler`,覆写 `void handle(P2MessageReceiveV1 event) throws Exception`(无 ctx 参)。
  - 消息 getter:`event.getEvent().getSender().getSenderId().getOpenId()`;`event.getEvent().getMessage().getChatId()/.getChatType()/.getMessageId()/.getMessageType()/.getContent()`(content 是 JSON 串 `{"text":"..."}`)。
  - 卡片 handler:抽象类 `com.lark.oapi.event.cardcallback.P2CardActionTriggerHandler`,覆写 `P2CardActionTriggerResponse handle(P2CardActionTrigger event)`,**返回 null 合法**;`event.getEvent().getAction().getValue()` 为 `Map<String,Object>`,`event.getEvent().getOperator().getOpenId()` 为 String。
  - 发送:`client.im().v1().message().create(CreateMessageReq.newBuilder().receiveIdType("open_id").createMessageReqBody(CreateMessageReqBody.newBuilder().receiveId(openId).msgType("text"|"interactive").content(...).build()).build())`;文本 content 用 `com.lark.oapi.service.im.v1.model.ext.MessageText.newBuilder().text(t).build()`(返回 String);卡片 content 直接传 card 2.0 JSON 字符串。
- **commit trailer**:每次提交带 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 与 `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- **测试运行**:`mvn -q -DskipTests=false -Dtest=... test`;全量基线 0F(Phase A 后确认干净)。

---

### Task 1: 依赖 + `GatewayFeishuConfig`

**Files:**
- Modify: `pom.xml`(`<dependencies>` 内新增 oapi-sdk)
- Modify: `src/main/java/com/lyhn/wraith/config/WraithConfig.java`(`GatewayConfig` 加 `feishu` + 新静态类 `GatewayFeishuConfig`)
- Test: `src/test/java/com/lyhn/wraith/config/WraithConfigFeishuTest.java`

**Interfaces:**
- Produces:`WraithConfig.GatewayConfig.getFeishu()/setFeishu(GatewayFeishuConfig)`;`WraithConfig.GatewayFeishuConfig`(getters/setters:`appId`/`appSecret`/`ownerOpenid`/`region`/`workspace`)。

- [ ] **Step 1: 写失败测试**

`src/test/java/com/lyhn/wraith/config/WraithConfigFeishuTest.java`:

```java
package com.lyhn.wraith.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class WraithConfigFeishuTest {

    @Test
    void gatewayFeishuConfigRoundTripsThroughJackson() throws Exception {
        WraithConfig.GatewayFeishuConfig fs = new WraithConfig.GatewayFeishuConfig();
        fs.setAppId("cli_x");
        fs.setAppSecret("sec_x");
        fs.setOwnerOpenid("ou_owner");
        fs.setRegion("feishu");
        fs.setWorkspace("/tmp/ws");
        WraithConfig.GatewayConfig gw = new WraithConfig.GatewayConfig();
        gw.setFeishu(fs);

        ObjectMapper m = new ObjectMapper();
        String json = m.writeValueAsString(gw);
        WraithConfig.GatewayConfig back = m.readValue(json, WraithConfig.GatewayConfig.class);

        assertNotNull(back.getFeishu());
        assertEquals("cli_x", back.getFeishu().getAppId());
        assertEquals("sec_x", back.getFeishu().getAppSecret());
        assertEquals("ou_owner", back.getFeishu().getOwnerOpenid());
        assertEquals("feishu", back.getFeishu().getRegion());
        assertEquals("/tmp/ws", back.getFeishu().getWorkspace());
    }

    @Test
    void gatewayConfigWithoutFeishuHasNullFeishu() {
        assertNull(new WraithConfig.GatewayConfig().getFeishu());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=WraithConfigFeishuTest test`
Expected: 编译失败 —— `GatewayFeishuConfig`/`getFeishu`/`setFeishu` 不存在。

- [ ] **Step 3: 改 `WraithConfig.java`**

在 `GatewayConfig` 静态类内(现有 `qq` 字段旁)加飞书字段与访问器,并在 `WraithConfig` 内新增 `GatewayFeishuConfig` 静态类(紧随 `GatewayQqConfig` 之后)。GatewayConfig 改为:

```java
    public static class GatewayConfig {
        private GatewayQqConfig qq;
        private GatewayFeishuConfig feishu;
        public GatewayQqConfig getQq() { return qq; }
        public void setQq(GatewayQqConfig qq) { this.qq = qq; }
        public GatewayFeishuConfig getFeishu() { return feishu; }
        public void setFeishu(GatewayFeishuConfig feishu) { this.feishu = feishu; }
    }
```

新增静态类(与 `GatewayQqConfig` 同风格):

```java
    public static class GatewayFeishuConfig {
        private String appId;
        private String appSecret;
        private String ownerOpenid;
        private String region;      // "feishu"(默认)| "lark"
        private String workspace;
        public String getAppId() { return appId; }               public void setAppId(String v){ appId=v; }
        public String getAppSecret() { return appSecret; }        public void setAppSecret(String v){ appSecret=v; }
        public String getOwnerOpenid() { return ownerOpenid; }    public void setOwnerOpenid(String v){ ownerOpenid=v; }
        public String getRegion() { return region; }             public void setRegion(String v){ region=v; }
        public String getWorkspace() { return workspace; }       public void setWorkspace(String v){ workspace=v; }
    }
```

- [ ] **Step 4: 改 `pom.xml`**

在 `<dependencies>` 内加(紧随其它第三方依赖):

```xml
        <dependency>
            <groupId>com.larksuite.oapi</groupId>
            <artifactId>oapi-sdk</artifactId>
            <version>2.4.19</version>
        </dependency>
```

- [ ] **Step 5: 跑测试确认通过 + 拉依赖**

Run: `mvn -q -DskipTests=false -Dtest=WraithConfigFeishuTest test`
Expected: PASS(2 tests);Maven 首次会下载 oapi-sdk 及其传递依赖,`BUILD SUCCESS`。

- [ ] **Step 6: 提交**

```bash
git add pom.xml src/main/java/com/lyhn/wraith/config/WraithConfig.java src/test/java/com/lyhn/wraith/config/WraithConfigFeishuTest.java
git commit -m "feat(config): GatewayFeishuConfig + oapi-sdk 2.4.19 依赖

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 2: `FeishuApproval`(卡片构造 + 回调解析)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/feishu/FeishuApproval.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/feishu/FeishuApprovalTest.java`

**Interfaces:**
- Consumes:`com.lyhn.wraith.hitl.ApprovalResult`(`approve()`/`approveAll()`/`reject(String)`)。
- Produces:
  - `static String FeishuApproval.cardJson(String sessionKey, String promptText)` —— card 2.0 JSON(markdown 提示 + 三按钮,按钮 `value={"a","scope","s"}`)。
  - `record FeishuApproval.Callback(String sessionKey, ApprovalResult result)`。
  - `static FeishuApproval.Callback parse(java.util.Map<String,Object> value)` —— 解按钮 value;非法返回 null。

- [ ] **Step 1: 写失败测试**

`src/test/java/com/lyhn/wraith/gateway/feishu/FeishuApprovalTest.java`:

```java
package com.lyhn.wraith.gateway.feishu;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class FeishuApprovalTest {

    private static Map<String, Object> value(String a, String scope, String s) {
        Map<String, Object> m = new HashMap<>();
        m.put("a", a);
        m.put("scope", scope);
        m.put("s", s);
        return m;
    }

    @Test
    void cardJsonIsValidCard2AndCarriesSessionKeyInEveryButton() throws Exception {
        String json = FeishuApproval.cardJson("sess-1", "⚠️ 需要审批:执行 shell?");
        JsonNode root = new ObjectMapper().readTree(json);
        assertEquals("2.0", root.get("schema").asText());
        JsonNode elements = root.get("body").get("elements");
        // 第 0 个是 markdown 提示,第 1 个是 action(含 3 按钮)
        JsonNode actions = elements.get(1).get("actions");
        assertEquals(3, actions.size());
        for (JsonNode btn : actions) {
            assertEquals("sess-1", btn.get("value").get("s").asText());
        }
        // 提示文本透传
        assertTrue(json.contains("执行 shell"));
    }

    @Test
    void parseAllowOnce() {
        FeishuApproval.Callback cb = FeishuApproval.parse(value("approve", "once", "sess-1"));
        assertNotNull(cb);
        assertEquals("sess-1", cb.sessionKey());
        assertTrue(cb.result().isApproved());
    }

    @Test
    void parseAllowAlwaysIsApproved() {
        FeishuApproval.Callback cb = FeishuApproval.parse(value("approve", "always", "sess-2"));
        assertNotNull(cb);
        assertTrue(cb.result().isApproved());
    }

    @Test
    void parseDenyIsNotApproved() {
        FeishuApproval.Callback cb = FeishuApproval.parse(value("deny", "once", "sess-3"));
        assertNotNull(cb);
        assertEquals("sess-3", cb.sessionKey());
        assertFalse(cb.result().isApproved());
    }

    @Test
    void parseGarbageReturnsNull() {
        assertNull(FeishuApproval.parse(value("bogus", "once", "s")));
        assertNull(FeishuApproval.parse(new HashMap<>()));
        assertNull(FeishuApproval.parse(null));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=FeishuApprovalTest test`
Expected: 编译失败 —— `FeishuApproval` 不存在。

- [ ] **Step 3: 建 `FeishuApproval.java`**

```java
package com.lyhn.wraith.gateway.feishu;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.lyhn.wraith.hitl.ApprovalResult;

import java.util.Map;

/**
 * 飞书 HITL:构造 card 2.0 审批卡(approve-once / allow-always / deny 三按钮),
 * 解析按钮回调的 value payload。按钮 value 形如 {"a":"approve|deny","scope":"once|always","s":"<sessionKey>"}。
 * card.action.trigger 回调经 WS 长连接送达(见 FeishuProvider)。
 */
public final class FeishuApproval {

    private static final ObjectMapper M = new ObjectMapper();

    private FeishuApproval() {}

    public record Callback(String sessionKey, ApprovalResult result) {}

    /** 构造审批卡 JSON。{@code promptText} 为顶部说明,{@code sessionKey} 嵌进每个按钮的 value。 */
    public static String cardJson(String sessionKey, String promptText) {
        ObjectNode root = M.createObjectNode();
        root.put("schema", "2.0");
        ObjectNode body = root.putObject("body");
        ArrayNode elements = body.putArray("elements");

        ObjectNode md = elements.addObject();
        md.put("tag", "markdown");
        md.put("content", promptText);

        ObjectNode action = elements.addObject();
        action.put("tag", "action");
        ArrayNode actions = action.putArray("actions");
        actions.add(button("✅ 批准一次", "primary", "approve", "once", sessionKey));
        actions.add(button("✅ 总是允许", "primary", "approve", "always", sessionKey));
        actions.add(button("⛔ 拒绝", "danger", "deny", "once", sessionKey));

        try {
            return M.writeValueAsString(root);
        } catch (Exception e) {
            // ObjectNode 序列化不会失败;兜底返回极简卡防 NPE。
            return "{\"schema\":\"2.0\",\"body\":{\"elements\":[]}}";
        }
    }

    private static ObjectNode button(String label, String type, String a, String scope, String sessionKey) {
        ObjectNode btn = M.createObjectNode();
        btn.put("tag", "button");
        ObjectNode text = btn.putObject("text");
        text.put("tag", "plain_text");
        text.put("content", label);
        btn.put("type", type);
        ObjectNode value = btn.putObject("value");
        value.put("a", a);
        value.put("scope", scope);
        value.put("s", sessionKey);
        return btn;
    }

    /** 解按钮 value → Callback;非法/缺字段返回 null。 */
    public static Callback parse(Map<String, Object> value) {
        if (value == null) return null;
        Object a = value.get("a");
        Object scope = value.get("scope");
        Object s = value.get("s");
        if (!(s instanceof String) || ((String) s).isEmpty()) return null;
        ApprovalResult r;
        if ("approve".equals(a)) {
            r = "always".equals(scope) ? ApprovalResult.approveAll() : ApprovalResult.approve();
        } else if ("deny".equals(a)) {
            r = ApprovalResult.reject("用户在飞书拒绝");
        } else {
            return null;
        }
        return new Callback((String) s, r);
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=FeishuApprovalTest test`
Expected: PASS(5 tests)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/feishu/FeishuApproval.java src/test/java/com/lyhn/wraith/gateway/feishu/FeishuApprovalTest.java
git commit -m "feat(gateway/feishu): FeishuApproval — card 2.0 审批卡构造 + 按钮回调解析

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 3: `FeishuInbound`(入站分类,纯逻辑)

把「收到一条飞书消息 → 该忽略 / 配对回显 / 非文本提示 / 正常处理」的全部决策抽成纯函数,便于单测。SDK 事件字段的提取(getter 链)留在 Task 5 的 provider 胶水里(网络代码,眼验)。

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/feishu/FeishuInbound.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/feishu/FeishuInboundTest.java`

**Interfaces:**
- Consumes:`com.lyhn.wraith.gateway.qq.InboundMsg`(record `InboundMsg(String openid, String text, String msgId, long ts)`)。
- Produces:
  - `enum FeishuInbound.Kind { IGNORE, PAIRING_ECHO, NONTEXT_NOTICE, PROCESS }`
  - `record FeishuInbound.Result(Kind kind, InboundMsg msg)`
  - `static FeishuInbound.Result classify(String openId, String chatType, String msgType, String msgId, String contentJson, boolean ownerBound, boolean isOwner, long nowMs)`
  - `static String FeishuInbound.extractText(String contentJson)` —— 从 `{"text":"..."}` 取 text;失败/缺字段返回 null。

- [ ] **Step 1: 写失败测试**

`src/test/java/com/lyhn/wraith/gateway/feishu/FeishuInboundTest.java`:

```java
package com.lyhn.wraith.gateway.feishu;

import com.lyhn.wraith.gateway.qq.InboundMsg;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class FeishuInboundTest {

    private static final String TEXT = "{\"text\":\"你好\"}";

    @Test
    void nullOrBlankOpenIdIgnored() {
        assertEquals(FeishuInbound.Kind.IGNORE,
                FeishuInbound.classify(null, "p2p", "text", "om_1", TEXT, true, true, 1L).kind());
        assertEquals(FeishuInbound.Kind.IGNORE,
                FeishuInbound.classify("  ", "p2p", "text", "om_1", TEXT, true, true, 1L).kind());
    }

    @Test
    void groupChatIgnored() {
        assertEquals(FeishuInbound.Kind.IGNORE,
                FeishuInbound.classify("ou_a", "group", "text", "om_1", TEXT, true, true, 1L).kind());
    }

    @Test
    void unknownSenderWhenUnboundGetsPairingEcho() {
        assertEquals(FeishuInbound.Kind.PAIRING_ECHO,
                FeishuInbound.classify("ou_a", "p2p", "text", "om_1", TEXT, false, false, 1L).kind());
    }

    @Test
    void unknownSenderWhenBoundIsIgnored() {
        // owner 已绑定但来的不是 owner → deny-all,静默忽略(不回显)
        assertEquals(FeishuInbound.Kind.IGNORE,
                FeishuInbound.classify("ou_stranger", "p2p", "text", "om_1", TEXT, true, false, 1L).kind());
    }

    @Test
    void ownerNonTextGetsNotice() {
        assertEquals(FeishuInbound.Kind.NONTEXT_NOTICE,
                FeishuInbound.classify("ou_owner", "p2p", "image", "om_1", "{\"image_key\":\"x\"}", true, true, 1L).kind());
    }

    @Test
    void ownerTextIsProcessedIntoInboundMsg() {
        FeishuInbound.Result r =
                FeishuInbound.classify("ou_owner", "p2p", "text", "om_9", TEXT, true, true, 4242L);
        assertEquals(FeishuInbound.Kind.PROCESS, r.kind());
        InboundMsg m = r.msg();
        assertNotNull(m);
        assertEquals("ou_owner", m.openid());
        assertEquals("你好", m.text());
        assertEquals("om_9", m.msgId());
        assertEquals(4242L, m.ts());
    }

    @Test
    void ownerBlankTextIgnored() {
        assertEquals(FeishuInbound.Kind.IGNORE,
                FeishuInbound.classify("ou_owner", "p2p", "text", "om_1", "{\"text\":\"   \"}", true, true, 1L).kind());
    }

    @Test
    void extractTextParsesTextField() {
        assertEquals("你好", FeishuInbound.extractText(TEXT));
        assertNull(FeishuInbound.extractText("{\"nope\":1}"));
        assertNull(FeishuInbound.extractText("not json"));
        assertNull(FeishuInbound.extractText(null));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=FeishuInboundTest test`
Expected: 编译失败 —— `FeishuInbound` 不存在。

- [ ] **Step 3: 建 `FeishuInbound.java`**

```java
package com.lyhn.wraith.gateway.feishu;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.gateway.qq.InboundMsg;

/**
 * 飞书入站消息分类(纯逻辑)。把「忽略 / 配对回显 / 非文本提示 / 正常处理」的决策与
 * SDK 事件解耦,便于单测;SDK getter 提取在 FeishuProvider 胶水里完成。
 *
 * <p>规则(依次):open_id 空 → IGNORE;非 p2p → IGNORE;非 owner → 未绑定则 PAIRING_ECHO、
 * 已绑定则 IGNORE(deny-all);owner 非文本 → NONTEXT_NOTICE;owner 文本为空 → IGNORE;
 * owner 文本 → PROCESS(InboundMsg)。
 */
public final class FeishuInbound {

    private static final ObjectMapper M = new ObjectMapper();

    private FeishuInbound() {}

    public enum Kind { IGNORE, PAIRING_ECHO, NONTEXT_NOTICE, PROCESS }

    public record Result(Kind kind, InboundMsg msg) {
        static Result ignore()        { return new Result(Kind.IGNORE, null); }
        static Result pairingEcho()   { return new Result(Kind.PAIRING_ECHO, null); }
        static Result nonTextNotice() { return new Result(Kind.NONTEXT_NOTICE, null); }
        static Result process(InboundMsg m) { return new Result(Kind.PROCESS, m); }
    }

    public static Result classify(String openId, String chatType, String msgType,
                                  String msgId, String contentJson,
                                  boolean ownerBound, boolean isOwner, long nowMs) {
        if (openId == null || openId.isBlank()) return Result.ignore();
        if (!"p2p".equals(chatType)) return Result.ignore();
        if (!isOwner) return ownerBound ? Result.ignore() : Result.pairingEcho();
        if (!"text".equals(msgType)) return Result.nonTextNotice();
        String text = extractText(contentJson);
        if (text == null || text.isBlank()) return Result.ignore();
        return Result.process(new InboundMsg(openId, text, msgId, nowMs));
    }

    /** 从飞书文本消息 content(JSON 串 {@code {"text":"..."}})提取纯文本;失败返回 null。 */
    public static String extractText(String contentJson) {
        if (contentJson == null) return null;
        try {
            JsonNode n = M.readTree(contentJson);
            JsonNode t = n.get("text");
            return t == null ? null : t.asText();
        } catch (Exception e) {
            return null;
        }
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=FeishuInboundTest test`
Expected: PASS(8 tests)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/feishu/FeishuInbound.java src/test/java/com/lyhn/wraith/gateway/feishu/FeishuInboundTest.java
git commit -m "feat(gateway/feishu): FeishuInbound — 入站分类纯逻辑(忽略/配对/非文本/处理)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 4: `FeishuDeliveryAdapter`(cron 结果投递)

飞书能主动发消息,故投递**立即发**(无 QQ 的被动窗口/待发队列)。

**Files:**
- Create: `src/main/java/com/lyhn/wraith/automation/delivery/FeishuDeliveryAdapter.java`
- Test: `src/test/java/com/lyhn/wraith/automation/delivery/FeishuDeliveryAdapterTest.java`

**Interfaces:**
- Consumes:`DeliveryAdapter`(`String platform()`;`void deliver(DeliveryTarget, AutomationTask, AutomationRunner.RunResult)`);`AutomationTask`(public `String name`);`AutomationRunner.RunResult`(`String answer()`);`DeliveryTarget`。
- Produces:
  - `interface FeishuDeliveryAdapter.Sink { void send(String openId, String text); }`
  - `FeishuDeliveryAdapter(String ownerOpenid, Sink sink)`;`platform()=="feishu"`。

- [ ] **Step 1: 写失败测试**

`src/test/java/com/lyhn/wraith/automation/delivery/FeishuDeliveryAdapterTest.java`:

```java
package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class FeishuDeliveryAdapterTest {

    @Test
    void platformIsFeishu() {
        assertEquals("feishu", new FeishuDeliveryAdapter("ou_o", (o, t) -> {}).platform());
    }

    @Test
    void deliverSendsFormattedResultToOwnerImmediately() {
        List<String[]> sent = new ArrayList<>();
        FeishuDeliveryAdapter a = new FeishuDeliveryAdapter("ou_o", (o, t) -> sent.add(new String[]{o, t}));

        AutomationTask task = new AutomationTask();
        task.name = "daily-report";
        AutomationRunner.RunResult result = new AutomationRunner.RunResult("全绿", true, null);

        a.deliver(new DeliveryTarget("feishu", "ou_o"), task, result);

        assertEquals(1, sent.size());
        assertEquals("ou_o", sent.get(0)[0]);
        assertTrue(sent.get(0)[1].contains("daily-report"));
        assertTrue(sent.get(0)[1].contains("全绿"));
    }
}
```

> 实现者注意:`AutomationRunner.RunResult` 与 `DeliveryTarget` 的真实构造签名以仓库为准 —— 若与上面测试里的构造不符,按真实签名调整测试的构造调用(保持断言语义:投给 ownerOpenid、文本含 task.name 与 answer)。核心被测行为是 `deliver` 立即经 sink 发出、格式含任务名与结果。

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=FeishuDeliveryAdapterTest test`
Expected: 编译失败 —— `FeishuDeliveryAdapter` 不存在(或 RunResult/DeliveryTarget 构造需按真实签名微调后再失败于类缺失)。

- [ ] **Step 3: 建 `FeishuDeliveryAdapter.java`**

```java
package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;

/**
 * DeliveryAdapter for 飞书单聊。飞书可随时主动发消息,故直接立即发给 owner
 * (无 QQ 的 60 分钟被动窗口 / 待发队列)。发送经注入的 {@link Sink}(由
 * FeishuProvider 接到 im.message.create),便于单测。不抛异常。
 */
public final class FeishuDeliveryAdapter implements DeliveryAdapter {

    /** 出站文本发送口(openId, text)。 */
    public interface Sink { void send(String openId, String text); }

    private final String ownerOpenid;
    private final Sink sink;

    public FeishuDeliveryAdapter(String ownerOpenid, Sink sink) {
        this.ownerOpenid = ownerOpenid;
        this.sink = sink;
    }

    @Override
    public String platform() {
        return "feishu";
    }

    @Override
    public void deliver(DeliveryTarget target, AutomationTask task, AutomationRunner.RunResult result) {
        sink.send(ownerOpenid, "⏰ " + task.name + ":\n" + result.answer());
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=FeishuDeliveryAdapterTest test`
Expected: PASS(2 tests)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/automation/delivery/FeishuDeliveryAdapter.java src/test/java/com/lyhn/wraith/automation/delivery/FeishuDeliveryAdapterTest.java
git commit -m "feat(delivery): FeishuDeliveryAdapter — cron 结果立即投递飞书 owner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 5: `FeishuProvider`(SDK 长连接装配,实现 ImProvider)

组装 REST/WS 客户端 + EventDispatcher(消息 + 卡片 handler)+ 会话路由/驱动 + 鉴权/去重 + 审批卡推送 + 投递适配器。可测部分(platform/deliveryAdapter/surfaceScheduledApproval/start 起线程)经 package-private 测试构造注入;SDK 网络胶水(WS handler 内的 getter 提取与路由)由 Task 2/3 的纯逻辑单测 + 眼验覆盖。

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/feishu/FeishuProvider.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/feishu/FeishuProviderTest.java`

**Interfaces:**
- Consumes:Task 1–4 产物 + Phase A 的 `ImProvider`/`InboundMsg`/`SessionRouter`/`GatewaySession`/`ImTurnDriver`/`Authorizer`/`Dedup`;SDK 类(见 Global Constraints)。
- Produces:`final class FeishuProvider implements ImProvider`;public 生产构造 `FeishuProvider(WraithConfig.GatewayFeishuConfig, LlmClient, Map<String,CompletableFuture<ApprovalResult>>)`;package-private 测试构造 `FeishuProvider(FeishuDeliveryAdapter deliver, String ownerOpenid, java.util.function.BiConsumer<String,String> cardSender, Runnable wsLoop)`。

- [ ] **Step 1: 写失败测试**

`src/test/java/com/lyhn/wraith/gateway/feishu/FeishuProviderTest.java`:

```java
package com.lyhn.wraith.gateway.feishu;

import com.lyhn.wraith.automation.delivery.FeishuDeliveryAdapter;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class FeishuProviderTest {

    private FeishuProvider provider(String ownerOpenid, List<String[]> cards, Runnable wsLoop) {
        FeishuDeliveryAdapter deliver = new FeishuDeliveryAdapter(ownerOpenid, (o, t) -> {});
        return new FeishuProvider(deliver, ownerOpenid,
                (openId, cardJson) -> cards.add(new String[]{openId, cardJson}), wsLoop);
    }

    @Test
    void platformIsFeishu() {
        assertEquals("feishu", provider("ou_o", new ArrayList<>(), () -> {}).platform());
    }

    @Test
    void deliveryAdapterPresentAndFeishu() {
        var p = provider("ou_o", new ArrayList<>(), () -> {});
        var opt = p.deliveryAdapter();
        assertTrue(opt.isPresent());
        assertEquals("feishu", opt.get().platform());
    }

    @Test
    void surfaceScheduledApprovalSendsCardToOwnerWithApprovalId() {
        List<String[]> cards = new ArrayList<>();
        provider("ou_o", cards, () -> {}).surfaceScheduledApproval("run1#1", "shell", "跑个脚本");
        assertEquals(1, cards.size());
        assertEquals("ou_o", cards.get(0)[0]);
        assertTrue(cards.get(0)[1].contains("run1#1"), "审批卡按钮 value 应含 approvalId 作 sessionKey");
    }

    @Test
    void surfaceScheduledApprovalNoOpWhenOwnerUnbound() {
        List<String[]> cards = new ArrayList<>();
        provider("", cards, () -> {}).surfaceScheduledApproval("run1#1", "shell", "跑个脚本");
        assertTrue(cards.isEmpty(), "owner 未绑定时不应发审批卡");
    }

    @Test
    void startRunsWsLoopOnDaemonThread() throws Exception {
        CountDownLatch ran = new CountDownLatch(1);
        provider("ou_o", new ArrayList<>(), ran::countDown).start();
        assertTrue(ran.await(2, TimeUnit.SECONDS), "start() 应把 wsLoop 放到新线程上跑并立即返回");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=FeishuProviderTest test`
Expected: 编译失败 —— `FeishuProvider` 不存在。

- [ ] **Step 3: 建 `FeishuProvider.java`**

```java
package com.lyhn.wraith.gateway.feishu;

import com.lark.oapi.core.enums.BaseUrlEnum;
import com.lark.oapi.event.EventDispatcher;
import com.lark.oapi.event.cardcallback.P2CardActionTriggerHandler;
import com.lark.oapi.event.cardcallback.model.P2CardActionTrigger;
import com.lark.oapi.event.cardcallback.model.P2CardActionTriggerResponse;
import com.lark.oapi.service.im.ImService;
import com.lark.oapi.service.im.v1.model.CreateMessageReq;
import com.lark.oapi.service.im.v1.model.CreateMessageReqBody;
import com.lark.oapi.service.im.v1.model.P2MessageReceiveV1;
import com.lark.oapi.service.im.v1.model.ext.MessageText;
import com.lyhn.wraith.automation.delivery.DeliveryAdapter;
import com.lyhn.wraith.automation.delivery.FeishuDeliveryAdapter;
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

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BiConsumer;

/**
 * 飞书单聊 provider:官方 SDK 长连接收事件 + REST 发消息。统一用 open_id 作鉴权/会话 key/
 * 回发目标(receive_id_type=open_id)。HITL 走 card.action.trigger(over WS)。投递/审批卡立即发。
 */
public final class FeishuProvider implements ImProvider {

    private final FeishuDeliveryAdapter deliver;
    private final String ownerOpenid;
    private final BiConsumer<String, String> cardSender; // (openId, cardJson) → 发交互卡
    private final Runnable wsLoop;
    private final ExecutorService pool;
    private volatile Thread thread;

    /** 生产构造:建 REST + WS + 分发器 + 会话路由,组好阻塞的 WS 回路。构造不触网。 */
    public FeishuProvider(WraithConfig.GatewayFeishuConfig fs,
                          LlmClient client,
                          Map<String, CompletableFuture<ApprovalResult>> pendingApprovals) {
        BaseUrlEnum region = "lark".equalsIgnoreCase(fs.getRegion()) ? BaseUrlEnum.LarkSuite : BaseUrlEnum.FeiShu;
        com.lark.oapi.Client rest = com.lark.oapi.Client.newBuilder(fs.getAppId(), fs.getAppSecret())
                .openBaseUrl(region).build();

        this.ownerOpenid = fs.getOwnerOpenid();
        this.cardSender = (openId, cardJson) -> sendCard(rest, openId, cardJson);
        this.deliver = new FeishuDeliveryAdapter(this.ownerOpenid, (openId, text) -> sendText(rest, openId, text));
        this.pool = Executors.newCachedThreadPool();

        Authorizer authz = new Authorizer(this.ownerOpenid);
        Dedup dedup = new Dedup(1000);
        boolean ownerBound = this.ownerOpenid != null && !this.ownerOpenid.isBlank();

        SessionRouter router = new SessionRouter(openid ->
                new GatewaySession(openid, fs.getWorkspace(), client,
                        sessKey -> sendCard(rest, openid,
                                FeishuApproval.cardJson(sessKey, "⚠️ 需要审批(点按钮同意/拒绝):"))));

        ImTurnDriver driver = new ImTurnDriver(router,
                (openid, text, replyTo) -> sendText(rest, openid, text), this.pool);

        // 消息 handler:提取 getter → FeishuInbound.classify → 执行结果
        ImService.P2MessageReceiveV1Handler msgHandler = new ImService.P2MessageReceiveV1Handler() {
            @Override
            public void handle(P2MessageReceiveV1 event) {
                var ev = event.getEvent();
                var senderId = ev.getSender() == null ? null : ev.getSender().getSenderId();
                String openId = senderId == null ? null : senderId.getOpenId();
                var m = ev.getMessage();
                FeishuInbound.Result r = FeishuInbound.classify(
                        openId,
                        m == null ? null : m.getChatType(),
                        m == null ? null : m.getMessageType(),
                        m == null ? null : m.getMessageId(),
                        m == null ? null : m.getContent(),
                        ownerBound,
                        authz.isAllowed(openId),
                        System.currentTimeMillis());
                switch (r.kind()) {
                    case IGNORE -> { /* no-op */ }
                    case PAIRING_ECHO -> sendText(rest, openId,
                            "你的 open_id 是 " + openId + ";若这是你,请到桌面端把它绑定为主人。");
                    case NONTEXT_NOTICE -> sendText(rest, openId, "暂只支持文本消息。");
                    case PROCESS -> {
                        InboundMsg msg = r.msg();
                        if (!dedup.seen(msg.msgId())) driver.onMessage(msg);
                    }
                }
            }
        };

        // 卡片 handler:提取 value → FeishuApproval.parse → scheduled(pendingApprovals) 或 IM-session
        P2CardActionTriggerHandler cardHandler = new P2CardActionTriggerHandler() {
            @Override
            public P2CardActionTriggerResponse handle(P2CardActionTrigger event) {
                var ev = event.getEvent();
                String operator = ev.getOperator() == null ? null : ev.getOperator().getOpenId();
                if (!authz.isAllowed(operator)) return null; // deny-all
                Map<String, Object> value = ev.getAction() == null ? null : ev.getAction().getValue();
                FeishuApproval.Callback cb = FeishuApproval.parse(value);
                if (cb != null) {
                    boolean scheduled = pendingApprovals.containsKey(cb.sessionKey());
                    if (scheduled) {
                        CompletableFuture<ApprovalResult> f = pendingApprovals.remove(cb.sessionKey());
                        if (f != null) {
                            f.complete(cb.result().isApproved()
                                    ? ApprovalResult.approve()
                                    : ApprovalResult.reject("feishu rejected"));
                        }
                        return null;
                    }
                    driver.onApproval(cb.sessionKey(), cb.result());
                }
                return null; // v1 不回更新卡;按钮已完成 HITL,重复点安全(future 已 remove)
            }
        };

        EventDispatcher dispatcher = EventDispatcher.newBuilder("", "")
                .onP2MessageReceiveV1(msgHandler)
                .onP2CardActionTrigger(cardHandler)
                .build();

        com.lark.oapi.ws.Client ws = new com.lark.oapi.ws.Client.Builder(fs.getAppId(), fs.getAppSecret())
                .eventHandler(dispatcher)
                .domain(region.getUrl())
                .build();

        // ws.start() 阻塞(内部自带重连);包 try/catch 防致命异常杀 daemon,状态灯打点。
        this.wsLoop = () -> {
            System.out.println("WRAITH_GATEWAY_STATUS starting");
            try {
                ws.start();
            } catch (Throwable t) {
                System.out.println("WRAITH_GATEWAY_STATUS error");
                System.err.println("[gateway] 飞书长连接退出: " + t.getClass().getSimpleName());
            }
        };
    }

    /** 测试构造:注入投递适配器 / ownerOpenid / 卡片发送口 / stub WS 回路(不触网)。 */
    FeishuProvider(FeishuDeliveryAdapter deliver, String ownerOpenid,
                   BiConsumer<String, String> cardSender, Runnable wsLoop) {
        this.deliver = deliver;
        this.ownerOpenid = ownerOpenid;
        this.cardSender = cardSender;
        this.wsLoop = wsLoop;
        this.pool = null;
    }

    private static void sendText(com.lark.oapi.Client rest, String openId, String text) {
        try {
            rest.im().v1().message().create(CreateMessageReq.newBuilder()
                    .receiveIdType("open_id")
                    .createMessageReqBody(CreateMessageReqBody.newBuilder()
                            .receiveId(openId)
                            .msgType("text")
                            .content(MessageText.newBuilder().text(text).build())
                            .build())
                    .build());
        } catch (Exception e) {
            System.err.println("[gateway] 飞书发送失败: " + e.getClass().getSimpleName());
        }
    }

    private static void sendCard(com.lark.oapi.Client rest, String openId, String cardJson) {
        try {
            rest.im().v1().message().create(CreateMessageReq.newBuilder()
                    .receiveIdType("open_id")
                    .createMessageReqBody(CreateMessageReqBody.newBuilder()
                            .receiveId(openId)
                            .msgType("interactive")
                            .content(cardJson)
                            .build())
                    .build());
        } catch (Exception e) {
            System.err.println("[gateway] 飞书卡片发送失败: " + e.getClass().getSimpleName());
        }
    }

    @Override
    public String platform() {
        return "feishu";
    }

    @Override
    public Optional<DeliveryAdapter> deliveryAdapter() {
        return Optional.of(deliver);
    }

    @Override
    public void surfaceScheduledApproval(String approvalId, String toolName, String suggestion) {
        if (ownerOpenid == null || ownerOpenid.isBlank()) return;
        cardSender.accept(ownerOpenid,
                FeishuApproval.cardJson(approvalId, "⏰ 定时任务需审批:" + toolName));
    }

    @Override
    public void start() {
        Thread t = new Thread(wsLoop, "wraith-feishu-provider");
        t.setDaemon(true);
        this.thread = t;
        t.start();
    }

    @Override
    public void stop() {
        Thread t = this.thread;
        if (t != null) t.interrupt();
        if (pool != null) pool.shutdownNow();
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=FeishuProviderTest test`
Expected: PASS(5 tests)。

> 若 SDK getter 链有细微差异(如 `getSender()` 返回类型的方法名),以 v2.4.19 真实类为准修正 handler 内的 getter,不改 handler 的控制流与 FeishuInbound/FeishuApproval 调用。若发现 getter 与 Global Constraints 所列不符,报 NEEDS_CONTEXT 而非猜测。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/feishu/FeishuProvider.java src/test/java/com/lyhn/wraith/gateway/feishu/FeishuProviderTest.java
git commit -m "feat(gateway/feishu): FeishuProvider — SDK 长连接单聊 bot + 卡片 HITL(实现 ImProvider)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 6: `GatewayDaemon` 接飞书 + shutdown hook + 全失败告警

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/gateway/GatewayDaemon.java`(`buildProviders` 加飞书分支;`start()` 加 shutdown hook + 全 provider 启动失败聚合告警)
- Test: `src/test/java/com/lyhn/wraith/gateway/GatewayDaemonProvidersTest.java`(扩充)

**Interfaces:**
- Consumes:Task 5 的 `FeishuProvider`;`WraithConfig.GatewayConfig.getFeishu()`。
- Produces:`buildProviders` 现在:QQ 已配置 → 含 `QqProvider`;飞书已配置 → 含 `FeishuProvider`;两者都配 → 两个都含(QQ 在前)。

- [ ] **Step 1: 写失败测试(扩充现有类)**

在 `src/test/java/com/lyhn/wraith/gateway/GatewayDaemonProvidersTest.java` 追加(保留现有 3 个测试;新增导入 `WraithConfig.GatewayFeishuConfig` 如需):

```java
    private WraithConfig cfgWithFeishu() {
        WraithConfig cfg = new WraithConfig();
        WraithConfig.GatewayFeishuConfig fs = new WraithConfig.GatewayFeishuConfig();
        fs.setAppId("cli_x");
        fs.setAppSecret("sec_x");
        fs.setOwnerOpenid("ou_owner");
        fs.setRegion("feishu");
        fs.setWorkspace("/tmp/ws");
        WraithConfig.GatewayConfig gw = new WraithConfig.GatewayConfig();
        gw.setFeishu(fs);
        cfg.setGateway(gw);
        return cfg;
    }

    @Test
    void buildsFeishuProviderWhenFeishuConfigured(@TempDir Path dir) {
        Map<String, CompletableFuture<ApprovalResult>> pending = new ConcurrentHashMap<>();
        List<ImProvider> providers = GatewayDaemon.buildProviders(cfgWithFeishu(), null, dir, pending);
        assertEquals(1, providers.size());
        assertEquals("feishu", providers.get(0).platform());
        assertTrue(providers.get(0).deliveryAdapter().isPresent());
    }

    @Test
    void buildsBothProvidersWhenBothConfigured(@TempDir Path dir) {
        WraithConfig cfg = cfgWithQq();
        cfg.getGateway().setFeishu(cfgWithFeishu().getGateway().getFeishu());
        Map<String, CompletableFuture<ApprovalResult>> pending = new ConcurrentHashMap<>();
        List<ImProvider> providers = GatewayDaemon.buildProviders(cfg, null, dir, pending);
        assertEquals(2, providers.size());
        assertEquals("qq", providers.get(0).platform());     // QQ 在前
        assertEquals("feishu", providers.get(1).platform());
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=GatewayDaemonProvidersTest test`
Expected: 新增两用例失败(buildProviders 尚无飞书分支 → 飞书 provider 未构造,size 断言不符)。

- [ ] **Step 3: 改 `GatewayDaemon.java`**

在 `buildProviders` 内 QQ 分支之后加飞书分支:

```java
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
        return providers;
    }
```

在 `start()` 的 Step 11(启动 providers 的循环)替换为带失败计数 + 全失败聚合告警,并在其后加 shutdown hook(把这两处 Phase-A 终审提出的收尾一并做掉):

```java
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
```

- [ ] **Step 4: 跑新测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=GatewayDaemonProvidersTest test`
Expected: PASS(5 tests:原 3 + 新 2)。

- [ ] **Step 5: QQ 回归 + 全量构建**

Run: `mvn -q -DskipTests=false -Dtest='Qq*Test,QqProviderTest,GatewaySessionTest,ImTurnDriverTest,GatewayDaemonProvidersTest,Feishu*Test,WraithConfigGatewayTest,WraithConfigFeishuTest' test`
Expected: 全 PASS。
Run: `mvn -q -DskipTests=false test`
Expected: 0 新增失败(全量绿)。

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/GatewayDaemon.java src/test/java/com/lyhn/wraith/gateway/GatewayDaemonProvidersTest.java
git commit -m "feat(gateway): daemon 接飞书 provider + shutdown hook + 全 provider 启动失败告警

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 7: `AppServer` gateway RPC 泛化(platform 参数)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(`gateway.config.get` / `gateway.config.set` 加 `platform` 参,默认 `qq`)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerGatewayConfigTest.java`(扩充)

**Interfaces:**
- Produces:`gateway.config.get`/`set` 支持 `params.platform ∈ {"qq"(默认),"feishu"}`;飞书 get 回 `{bound, hasSecret, appId, ownerOpenid, region, workspace}`,**不含 appSecret**;飞书 set 写 `appId/appSecret/ownerOpenid/region/workspace`。

- [ ] **Step 1: 写失败测试(扩充现有类)**

在 `AppServerGatewayConfigTest.java` 追加:

```java
    @Test
    void gatewayConfigGetFeishuReturnsSafeViewWithoutSecret() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"gateway.config.get\",\"params\":{\"platform\":\"feishu\"}}");
        JsonNode res = byId(r, 2).get("result");
        assertNotNull(res, "gateway.config.get(feishu) 应返回 result");
        assertTrue(res.has("bound"), "缺 bound");
        assertTrue(res.has("hasSecret"), "缺 hasSecret");
        assertTrue(res.has("appId"), "缺 appId");
        assertTrue(res.has("ownerOpenid"), "缺 ownerOpenid");
        assertTrue(res.has("region"), "缺 region");
        assertTrue(res.has("workspace"), "缺 workspace");
        // 密钥红线:绝不回 appSecret 明文
        assertFalse(res.has("appSecret"), "gateway.config.get(feishu) 绝不能返回 appSecret 明文");
    }

    @Test
    void gatewayConfigGetDefaultsToQqWhenNoPlatform() throws Exception {
        // 无 platform 参 → 沿用 QQ 视图(向后兼容,QQ 现有桌面面板不受影响)
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"gateway.config.get\",\"params\":{}}");
        JsonNode res = byId(r, 2).get("result");
        assertTrue(res.has("workspace"));
        assertFalse(res.has("clientSecret"), "QQ 视图也绝不回 clientSecret");
        assertFalse(res.has("region"), "QQ 视图不含 region 字段");
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=AppServerGatewayConfigTest test`
Expected: `gatewayConfigGetFeishuReturnsSafeViewWithoutSecret` 失败(feishu 视图未实现,缺 region 等字段);`gatewayConfigGetDefaultsToQqWhenNoPlatform` 可能已通过(现有行为)。

- [ ] **Step 3: 改 `AppServer.java`**

把 `gateway.config.get` case 整体替换为按 platform 分派:

```java
            case "gateway.config.get" -> {
                JsonNode p = msg.params();
                String platform = (p != null && p.hasNonNull("platform")) ? p.get("platform").asText() : "qq";
                WraithConfig cfg = WraithConfig.load();
                WraithConfig.GatewayConfig gw = cfg.getGateway();
                Map<String, Object> r = new LinkedHashMap<>();
                if ("feishu".equals(platform)) {
                    WraithConfig.GatewayFeishuConfig fs = gw == null ? null : gw.getFeishu();
                    boolean hasSecret = fs != null && fs.getAppSecret() != null && !fs.getAppSecret().isBlank();
                    r.put("bound", hasSecret);
                    r.put("hasSecret", hasSecret);
                    r.put("appId", fs == null ? null : fs.getAppId());
                    r.put("ownerOpenid", fs == null ? null : fs.getOwnerOpenid());
                    r.put("region", fs == null ? null : fs.getRegion());
                    r.put("workspace", fs == null ? null : fs.getWorkspace());
                } else {
                    WraithConfig.GatewayQqConfig qq = gw == null ? null : gw.getQq();
                    boolean hasSecret = qq != null && qq.getClientSecret() != null && !qq.getClientSecret().isBlank();
                    r.put("bound", hasSecret);
                    r.put("hasSecret", hasSecret);
                    r.put("appId", qq == null ? null : qq.getAppId());
                    r.put("ownerOpenid", qq == null ? null : qq.getOwnerOpenid());
                    r.put("workspace", qq == null ? null : qq.getWorkspace());
                }
                writer.result(msg.id(), r); // 注意:绝不回传 secret 明文,只报 hasSecret
            }
```

把 `gateway.config.set` case 整体替换为按 platform 分派:

```java
            case "gateway.config.set" -> {
                JsonNode p = msg.params();
                String platform = (p != null && p.hasNonNull("platform")) ? p.get("platform").asText() : "qq";
                try {
                    WraithConfig cfg = WraithConfig.load();
                    WraithConfig.GatewayConfig gw = cfg.getGateway();
                    if (gw == null) { gw = new WraithConfig.GatewayConfig(); cfg.setGateway(gw); }
                    if ("feishu".equals(platform)) {
                        WraithConfig.GatewayFeishuConfig fs = gw.getFeishu();
                        if (fs == null) { fs = new WraithConfig.GatewayFeishuConfig(); gw.setFeishu(fs); }
                        if (p != null && p.hasNonNull("appId")) fs.setAppId(p.get("appId").asText());
                        if (p != null && p.hasNonNull("appSecret")) fs.setAppSecret(p.get("appSecret").asText());
                        if (p != null && p.hasNonNull("ownerOpenid")) fs.setOwnerOpenid(p.get("ownerOpenid").asText());
                        if (p != null && p.hasNonNull("region")) fs.setRegion(p.get("region").asText());
                        if (p != null && p.hasNonNull("workspace")) fs.setWorkspace(p.get("workspace").asText());
                    } else {
                        WraithConfig.GatewayQqConfig qq = gw.getQq();
                        if (qq == null) { qq = new WraithConfig.GatewayQqConfig(); gw.setQq(qq); }
                        if (p != null && p.hasNonNull("clientSecret")) qq.setClientSecret(p.get("clientSecret").asText());
                        if (p != null && p.hasNonNull("workspace")) qq.setWorkspace(p.get("workspace").asText());
                    }
                    cfg.save();
                    ok(msg);
                } catch (Exception e) {
                    writer.error(msg.id(), -32000, "gateway 配置写入失败: " + e.getMessage());
                }
            }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=AppServerGatewayConfigTest test`
Expected: PASS(原 1 + 新 2 = 3 tests)。

- [ ] **Step 5: 全量构建**

Run: `mvn -q -DskipTests=false test`
Expected: 全量绿,0 新增失败。

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerGatewayConfigTest.java
git commit -m "feat(appserver): gateway.config.get/set 加 platform 参(默认 qq,飞书视图不回 appSecret)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

## 自审(写完计划回看 spec)

**1. Spec 覆盖**:覆盖 spec 的 Part 2(FeishuProvider 内部:transport/events/sender/approval/delivery)、Part 3(config + RPC;绑定=桌面手粘走 Task 7 RPC + Phase C UI;owner 配对回显在 FeishuInbound/FeishuProvider)、Part 5(卡片 HITL:FeishuApproval + FeishuProvider 卡片 handler)。桌面 UI(Part 4)是 Phase C。

**2. 占位扫描**:无 TBD/TODO;每个代码步给完整代码;测试均有真实断言。Task 4 测试里 `RunResult`/`DeliveryTarget` 构造标注了「以真实签名为准微调」——这是唯一的运行时依赖点,不是占位(被测行为已钉死)。

**3. 类型一致性**:`GatewayFeishuConfig`(Task 1)字段被 Task 5/6/7 一致消费;`FeishuApproval.cardJson/parse`(Task 2)被 Task 5 一致调用;`FeishuInbound.classify/Kind/Result`(Task 3)被 Task 5 一致消费;`FeishuDeliveryAdapter(ownerOpenid, Sink)`(Task 4)被 Task 5 一致构造;`FeishuProvider` 两构造签名与 Task 5 测试 + Task 6 buildProviders 一致;`buildProviders` 签名与 Phase A 一致(不变)。

**4. 已知外部待验点(诚实标注)**:
- 卡片 2.0 JSON 的确切 tag 结构(`action`/`button`/`plain_text`)—— `parse` 侧可单测,渲染 + 按钮回传 value 靠飞书真机眼验。
- SDK getter 链细微差异 —— 实现者以 v2.4.19 真实类为准,冲突则报 NEEDS_CONTEXT。
- `RunResult`/`DeliveryTarget` 构造签名 —— 以仓库为准微调 Task 4 测试构造。
- FeishuProvider WS handler 内的路由 + ws.start() 长连接为网络代码,不单测;靠 FeishuInbound/FeishuApproval 纯逻辑单测 + 眼验。

**眼验脚本(Phase B 完工 + Phase C UI 后整体验;B 完可先 CLI 验)**:飞书开放平台建自建应用(开长连接 + 加 `im:message` 权限 + 订阅 `im.message.receive_v1`)→ 把 appId/appSecret 写进 `~/.wraith/config.json` 的 `gateway.feishu`(region/ownerOpenid 先留空)→ `wraith gateway` → 私聊 bot 发消息 → 收到配对回显 open_id → 填 ownerOpenid 重启 → 对话收到回复 → 触发 HITL 看审批卡三按钮 → 点「批准一次」turn 继续 → `ps` 查无残留 node/java 僵进程。
