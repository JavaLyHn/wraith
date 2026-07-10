# 企业微信网关 Phase A 实现计划(后端长连接 + 单聊对话闭环)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 执行本计划。步骤用 `- [ ]` 勾选。

**Goal:** 手改 `~/.wraith/config.json` 加上企微配置后,`wraith gateway` 能连上企业微信智能机器人长连接,主人单聊发消息能收到 agent 的 markdown 回复(可真机眼验)。

**Architecture:** 新增 `WecomProvider implements ImProvider`,与 Qq/Feishu 平级;`WecomWsClient`(okhttp WebSocket)连 `wss://openws.work.weixin.qq.com`,`aibot_subscribe` 订阅、30s `ping`、收 `aibot_msg_callback`、回 `aibot_respond_msg`(复用入站 req_id,msgtype=markdown 透传)。纯逻辑(帧构造/解析、入站分类)抽成静态方法脱网单测。

**Tech Stack:** Java 17,okhttp3(项目已依赖),Jackson,JUnit5。包 `com.lyhn.wraith.gateway.wecom`。

## Global Constraints

- 密钥红线:`secret` 只存 `~/.wraith/config.json`,**绝不进日志 / RPC 回包 / renderer**;日志打 botId/userid 可以,secret 不可。
- 协议真相源:企微官方 Node SDK 类型定义(见 spec)。帧信封 `{cmd?, headers:{req_id}, body?, errcode?, errmsg?}`。
- 会话 key = 裸 userid;仅处理 `chattype=="single"`;回复 markdown **透传** agent 原文(企微原生渲染,不做清洗/转换)。
- 回复必须复用入站 `headers.req_id`;经 `ImTurnDriver.Sender` 的 `replyToMsgId` 参数承载(InboundMsg.msgId := req_id)。
- 状态灯 stdout 机读:`WRAITH_GATEWAY_STATUS <token>`,企微 token = `subscribed`(→running)/`disconnected`(→starting)/`auth-failed`(→error)。
- 每个任务结束跑其覆盖测试;提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。

---

### Task 1: GatewayWecomConfig(配置载体)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/config/WraithConfig.java`(在 `GatewayConfig` 内加 wecom 字段 + 新增静态类 `GatewayWecomConfig`)

**Interfaces:**
- Produces:`WraithConfig.GatewayWecomConfig`(字段 `botId/secret/ownerUserid/workspace` + getter/setter);`GatewayConfig.getWecom()/setWecom(...)`。

先读现有 `WraithConfig.GatewayConfig` 与 `GatewayFeishuConfig` 的写法(Jackson 注解风格),**逐字照其风格**新增,不要臆造注解。

- [ ] **Step 1: 加 GatewayWecomConfig 静态类 + GatewayConfig.wecom 字段**

在 `GatewayConfig` 里(紧挨 `feishu` 字段处)加:
```java
private GatewayWecomConfig wecom;
public GatewayWecomConfig getWecom() { return wecom; }
public void setWecom(GatewayWecomConfig wecom) { this.wecom = wecom; }
```
在 `WraithConfig` 里(紧挨 `GatewayFeishuConfig` 类处)加(注解风格对齐 `GatewayFeishuConfig`,如其用 `@JsonIgnoreProperties(ignoreUnknown = true)` 则照抄):
```java
@com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
public static class GatewayWecomConfig {
    private String botId;
    private String secret;
    private String ownerUserid;
    private String workspace;
    public String getBotId() { return botId; }
    public void setBotId(String botId) { this.botId = botId; }
    public String getSecret() { return secret; }
    public void setSecret(String secret) { this.secret = secret; }
    public String getOwnerUserid() { return ownerUserid; }
    public void setOwnerUserid(String ownerUserid) { this.ownerUserid = ownerUserid; }
    public String getWorkspace() { return workspace; }
    public void setWorkspace(String workspace) { this.workspace = workspace; }
}
```
> 若 `GatewayFeishuConfig` 的注解/风格与上不同,以其为准照抄(字段名保持 botId/secret/ownerUserid/workspace)。

- [ ] **Step 2: 编译验证**

Run: `mvn -q -DskipTests compile`
Expected: BUILD SUCCESS。

- [ ] **Step 3: Commit**

```bash
git add src/main/java/com/lyhn/wraith/config/WraithConfig.java
git commit -m "feat(config): GatewayWecomConfig(botId/secret/ownerUserid/workspace)"
```

---

### Task 2: WecomFrames(纯函数:帧构造 + 解析)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/wecom/WecomFrames.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/wecom/WecomFramesTest.java`

**Interfaces:**
- Produces:
  - `record Inbound(String reqId, String userid, String chatType, String msgType, String msgId, String text)`
  - `static String subscribeFrame(String botId, String secret, String reqId)`
  - `static String respondMarkdownFrame(String reqId, String content)`
  - `static String pingFrame(String reqId)`
  - `static Inbound parseCallback(String json)` — 非 `aibot_msg_callback` / 缺字段 → null
  - `enum SubResult { SUBSCRIBED, AUTH_FAILED, UNKNOWN }`
  - `static SubResult parseSubscribeResult(String json, String subscribeReqId)` — 帧 req_id 匹配且有 errcode 时判定

- [ ] **Step 1: 写失败测试 `WecomFramesTest`**

```java
package com.lyhn.wraith.gateway.wecom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WecomFramesTest {
    private static final ObjectMapper M = new ObjectMapper();

    @Test
    void subscribeFrameShape() throws Exception {
        JsonNode n = M.readTree(WecomFrames.subscribeFrame("bot1", "sec1", "r1"));
        assertEquals("aibot_subscribe", n.get("cmd").asText());
        assertEquals("r1", n.path("headers").path("req_id").asText());
        assertEquals("bot1", n.path("body").path("bot_id").asText());
        assertEquals("sec1", n.path("body").path("secret").asText());
    }

    @Test
    void respondMarkdownFrameReusesReqIdAndEscapes() throws Exception {
        String tricky = "标题\n**粗**带\"引号\"";
        JsonNode n = M.readTree(WecomFrames.respondMarkdownFrame("rX", tricky)); // 非法 JSON 会抛
        assertEquals("aibot_respond_msg", n.get("cmd").asText());
        assertEquals("rX", n.path("headers").path("req_id").asText());
        assertEquals("markdown", n.path("body").path("msgtype").asText());
        assertEquals(tricky, n.path("body").path("markdown").path("content").asText());
    }

    @Test
    void pingFrame() throws Exception {
        JsonNode n = M.readTree(WecomFrames.pingFrame("p1"));
        assertEquals("ping", n.get("cmd").asText());
        assertEquals("p1", n.path("headers").path("req_id").asText());
    }

    @Test
    void parseCallbackExtractsFields() {
        String json = "{\"cmd\":\"aibot_msg_callback\",\"headers\":{\"req_id\":\"R\"},"
            + "\"body\":{\"msgid\":\"M\",\"chattype\":\"single\",\"from\":{\"userid\":\"U\"},"
            + "\"msgtype\":\"text\",\"text\":{\"content\":\"你好\"}}}";
        WecomFrames.Inbound in = WecomFrames.parseCallback(json);
        assertNotNull(in);
        assertEquals("R", in.reqId());
        assertEquals("U", in.userid());
        assertEquals("single", in.chatType());
        assertEquals("text", in.msgType());
        assertEquals("M", in.msgId());
        assertEquals("你好", in.text());
    }

    @Test
    void parseCallbackNonCallbackReturnsNull() {
        assertNull(WecomFrames.parseCallback("{\"cmd\":\"ping\",\"headers\":{\"req_id\":\"x\"}}"));
        assertNull(WecomFrames.parseCallback("not json"));
        assertNull(WecomFrames.parseCallback(null));
    }

    @Test
    void parseCallbackNonTextHasNullText() {
        String json = "{\"cmd\":\"aibot_msg_callback\",\"headers\":{\"req_id\":\"R\"},"
            + "\"body\":{\"msgid\":\"M\",\"chattype\":\"single\",\"from\":{\"userid\":\"U\"},"
            + "\"msgtype\":\"image\"}}";
        WecomFrames.Inbound in = WecomFrames.parseCallback(json);
        assertNotNull(in);
        assertEquals("image", in.msgType());
        assertNull(in.text());
    }

    @Test
    void parseSubscribeResult() {
        String ok = "{\"headers\":{\"req_id\":\"S\"},\"errcode\":0}";
        String bad = "{\"headers\":{\"req_id\":\"S\"},\"errcode\":40001,\"errmsg\":\"invalid secret\"}";
        String other = "{\"headers\":{\"req_id\":\"OTHER\"},\"errcode\":0}";
        assertEquals(WecomFrames.SubResult.SUBSCRIBED, WecomFrames.parseSubscribeResult(ok, "S"));
        assertEquals(WecomFrames.SubResult.AUTH_FAILED, WecomFrames.parseSubscribeResult(bad, "S"));
        assertEquals(WecomFrames.SubResult.UNKNOWN, WecomFrames.parseSubscribeResult(other, "S"));
        assertEquals(WecomFrames.SubResult.UNKNOWN, WecomFrames.parseSubscribeResult("not json", "S"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=WecomFramesTest test`
Expected: 编译失败(WecomFrames 不存在)。

- [ ] **Step 3: 写 `WecomFrames`**

```java
package com.lyhn.wraith.gateway.wecom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 企微智能机器人长连接的帧构造与解析(纯函数,脱网单测)。
 * 帧信封:{@code {cmd?, headers:{req_id}, body?, errcode?, errmsg?}}。
 * 收发 JSON 用 Jackson(转义交给库,规避裸拼坏 JSON)。
 */
public final class WecomFrames {

    private static final ObjectMapper M = new ObjectMapper();

    private WecomFrames() {}

    /** 入站文本消息的关键字段;msgType!=text 时 text 为 null。 */
    public record Inbound(String reqId, String userid, String chatType,
                          String msgType, String msgId, String text) {}

    public enum SubResult { SUBSCRIBED, AUTH_FAILED, UNKNOWN }

    /** 订阅帧:aibot_subscribe(bot_id + secret)。 */
    public static String subscribeFrame(String botId, String secret, String reqId) {
        ObjectNode root = M.createObjectNode();
        root.put("cmd", "aibot_subscribe");
        root.putObject("headers").put("req_id", reqId);
        ObjectNode body = root.putObject("body");
        body.put("bot_id", botId);
        body.put("secret", secret);
        return write(root, "{}");
    }

    /** 回复帧:aibot_respond_msg,msgtype=markdown,复用入站 reqId。 */
    public static String respondMarkdownFrame(String reqId, String content) {
        ObjectNode root = M.createObjectNode();
        root.put("cmd", "aibot_respond_msg");
        root.putObject("headers").put("req_id", reqId);
        ObjectNode body = root.putObject("body");
        body.put("msgtype", "markdown");
        body.putObject("markdown").put("content", content == null ? "" : content);
        return write(root, "{\"cmd\":\"aibot_respond_msg\",\"headers\":{\"req_id\":\"" + reqId + "\"}}");
    }

    /** 心跳帧:ping。 */
    public static String pingFrame(String reqId) {
        ObjectNode root = M.createObjectNode();
        root.put("cmd", "ping");
        root.putObject("headers").put("req_id", reqId);
        return write(root, "{\"cmd\":\"ping\"}");
    }

    /** 解析入站 aibot_msg_callback;非该 cmd / 非法 → null。 */
    public static Inbound parseCallback(String json) {
        if (json == null) return null;
        try {
            JsonNode n = M.readTree(json);
            if (!"aibot_msg_callback".equals(n.path("cmd").asText())) return null;
            JsonNode body = n.path("body");
            String reqId = n.path("headers").path("req_id").asText(null);
            String userid = body.path("from").path("userid").asText(null);
            String chatType = body.path("chattype").asText(null);
            String msgType = body.path("msgtype").asText(null);
            String msgId = body.path("msgid").asText(null);
            String text = "text".equals(msgType) ? body.path("text").path("content").asText(null) : null;
            return new Inbound(reqId, userid, chatType, msgType, msgId, text);
        } catch (Exception e) {
            return null;
        }
    }

    /** 判定订阅结果:仅当帧 req_id == 我们的订阅 reqId 且带 errcode 时有效。 */
    public static SubResult parseSubscribeResult(String json, String subscribeReqId) {
        if (json == null) return SubResult.UNKNOWN;
        try {
            JsonNode n = M.readTree(json);
            String rid = n.path("headers").path("req_id").asText(null);
            if (rid == null || !rid.equals(subscribeReqId)) return SubResult.UNKNOWN;
            if (!n.has("errcode")) return SubResult.UNKNOWN;
            return n.path("errcode").asInt(-1) == 0 ? SubResult.SUBSCRIBED : SubResult.AUTH_FAILED;
        } catch (Exception e) {
            return SubResult.UNKNOWN;
        }
    }

    private static String write(ObjectNode root, String fallback) {
        try {
            return M.writeValueAsString(root);
        } catch (Exception e) {
            return fallback;
        }
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=WecomFramesTest test`
Expected: Tests run: 7, Failures: 0, Errors: 0。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/gateway/wecom/WecomFrames.java src/test/java/com/lyhn/wraith/gateway/wecom/WecomFramesTest.java
git commit -m "feat(gateway/wecom): WecomFrames 帧构造/解析纯模块 + 单测"
```

---

### Task 3: WecomInbound(纯函数:入站分类)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/wecom/WecomInbound.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/wecom/WecomInboundTest.java`

**Interfaces:**
- Consumes:`WecomFrames.Inbound`、`com.lyhn.wraith.gateway.qq.InboundMsg`(record `(String openid, String text, String msgId, long ts)`)
- Produces:`WecomInbound.classify(Inbound frame, boolean ownerBound, boolean isOwner, long nowMs) -> Result{Kind, InboundMsg}`;`enum Kind{IGNORE,PAIRING_ECHO,NONTEXT_NOTICE,PROCESS}`

复刻 `FeishuInbound` 语义,规则依次:userid 空→IGNORE;chattype!=single→IGNORE;非 owner→未绑定则 PAIRING_ECHO、已绑定则 IGNORE;owner 非 text→NONTEXT_NOTICE;owner 文本空→IGNORE;owner 文本→PROCESS(InboundMsg,msgId 用 **frame.reqId**,以承载回复关联)。

- [ ] **Step 1: 写失败测试 `WecomInboundTest`**

```java
package com.lyhn.wraith.gateway.wecom;

import com.lyhn.wraith.gateway.qq.InboundMsg;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WecomInboundTest {
    private WecomFrames.Inbound f(String userid, String chatType, String msgType, String text) {
        return new WecomFrames.Inbound("REQ1", userid, chatType, msgType, "MSG1", text);
    }

    @Test
    void ownerTextProcessesWithReqIdAsMsgId() {
        var r = WecomInbound.classify(f("U", "single", "text", "你好"), true, true, 42L);
        assertEquals(WecomInbound.Kind.PROCESS, r.kind());
        InboundMsg m = r.msg();
        assertEquals("U", m.openid());
        assertEquals("你好", m.text());
        assertEquals("REQ1", m.msgId(), "msgId 应为 reqId 以承载回复关联");
        assertEquals(42L, m.ts());
    }

    @Test
    void groupChatIgnored() {
        assertEquals(WecomInbound.Kind.IGNORE,
            WecomInbound.classify(f("U", "group", "text", "hi"), true, true, 0L).kind());
    }

    @Test
    void blankUseridIgnored() {
        assertEquals(WecomInbound.Kind.IGNORE,
            WecomInbound.classify(f("", "single", "text", "hi"), true, true, 0L).kind());
    }

    @Test
    void unknownSenderUnboundGetsPairingEcho() {
        assertEquals(WecomInbound.Kind.PAIRING_ECHO,
            WecomInbound.classify(f("U", "single", "text", "hi"), false, false, 0L).kind());
    }

    @Test
    void unknownSenderBoundIgnored() {
        assertEquals(WecomInbound.Kind.IGNORE,
            WecomInbound.classify(f("U", "single", "text", "hi"), true, false, 0L).kind());
    }

    @Test
    void ownerNonTextGetsNotice() {
        assertEquals(WecomInbound.Kind.NONTEXT_NOTICE,
            WecomInbound.classify(f("U", "single", "image", null), true, true, 0L).kind());
    }

    @Test
    void ownerBlankTextIgnored() {
        assertEquals(WecomInbound.Kind.IGNORE,
            WecomInbound.classify(f("U", "single", "text", "   "), true, true, 0L).kind());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=WecomInboundTest test`
Expected: 编译失败。

- [ ] **Step 3: 写 `WecomInbound`**

```java
package com.lyhn.wraith.gateway.wecom;

import com.lyhn.wraith.gateway.qq.InboundMsg;

/**
 * 企微入站消息分类(纯逻辑,复刻 FeishuInbound 语义)。
 * 仅处理 chattype=single;PROCESS 时 InboundMsg.msgId 用 frame.reqId,承载回复关联。
 */
public final class WecomInbound {

    private WecomInbound() {}

    public enum Kind { IGNORE, PAIRING_ECHO, NONTEXT_NOTICE, PROCESS }

    public record Result(Kind kind, InboundMsg msg) {
        static Result ignore()        { return new Result(Kind.IGNORE, null); }
        static Result pairingEcho()   { return new Result(Kind.PAIRING_ECHO, null); }
        static Result nonTextNotice() { return new Result(Kind.NONTEXT_NOTICE, null); }
        static Result process(InboundMsg m) { return new Result(Kind.PROCESS, m); }
    }

    public static Result classify(WecomFrames.Inbound f, boolean ownerBound, boolean isOwner, long nowMs) {
        if (f == null || f.userid() == null || f.userid().isBlank()) return Result.ignore();
        if (!"single".equals(f.chatType())) return Result.ignore();
        if (!isOwner) return ownerBound ? Result.ignore() : Result.pairingEcho();
        if (!"text".equals(f.msgType())) return Result.nonTextNotice();
        String text = f.text();
        if (text == null || text.isBlank()) return Result.ignore();
        return Result.process(new InboundMsg(f.userid(), text, f.reqId(), nowMs));
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=WecomInboundTest test`
Expected: Tests run: 7, Failures: 0。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/gateway/wecom/WecomInbound.java src/test/java/com/lyhn/wraith/gateway/wecom/WecomInboundTest.java
git commit -m "feat(gateway/wecom): WecomInbound 入站分类纯模块 + 单测"
```

---

### Task 4: WecomWsClient(okhttp WebSocket 外壳)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/wecom/WecomWsClient.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/wecom/WecomWsClientLogicTest.java`

**Interfaces:**
- Consumes:`okhttp3.OkHttpClient/WebSocket/WebSocketListener/Request`、`WecomFrames`
- Produces:
  - 构造 `WecomWsClient(OkHttpClient http, String botId, String secret)`
  - 回调接口 `interface OnInbound { void onMessage(WecomFrames.Inbound m); }`、`interface OnStatus { void onStatus(String wireToken); }`
  - `void connect(OnInbound onInbound, OnStatus onStatus)`(阻塞重连循环,放守护线程跑)
  - `void respondMarkdown(String reqId, String content)`
  - `void stop()`
  - 包私接缝 `void handleFrame(String text, OnInbound onInbound, OnStatus onStatus)`(供脱网单测分发逻辑)
  - `static long backoffSeconds(int attempt)`

**说明**:okhttp WebSocket 为异步回调;`connect` 用每连接一个 `CountDownLatch` 阻塞,onClosed/onFailure 后按退避重连。心跳用单线程 `ScheduledExecutorService` 每 30s 发 `pingFrame`。真·socket 部分靠真机眼验;**帧分发逻辑**收进包私 `handleFrame` 由单测覆盖。

- [ ] **Step 1: 写失败测试 `WecomWsClientLogicTest`(只测纯逻辑接缝)**

```java
package com.lyhn.wraith.gateway.wecom;

import okhttp3.OkHttpClient;
import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class WecomWsClientLogicTest {

    private WecomWsClient client() {
        return new WecomWsClient(new OkHttpClient(), "bot1", "sec1");
    }

    @Test
    void handleFrameDispatchesCallbackToInbound() {
        List<WecomFrames.Inbound> got = new ArrayList<>();
        String cb = "{\"cmd\":\"aibot_msg_callback\",\"headers\":{\"req_id\":\"R\"},"
            + "\"body\":{\"msgid\":\"M\",\"chattype\":\"single\",\"from\":{\"userid\":\"U\"},"
            + "\"msgtype\":\"text\",\"text\":{\"content\":\"hi\"}}}";
        client().handleFrame(cb, got::add, t -> {});
        assertEquals(1, got.size());
        assertEquals("U", got.get(0).userid());
    }

    @Test
    void handleFrameEmitsAuthFailedOnBadSubscribeResp() {
        // 需先记录订阅 reqId:用 connect 前不可得,故本测直接驱动 handleFrame 的订阅判定分支——
        // 通过反射/包私 setter 注入 subscribeReqId(见实现:setSubscribeReqIdForTest)。
        WecomWsClient c = client();
        c.setSubscribeReqIdForTest("S");
        List<String> status = new ArrayList<>();
        c.handleFrame("{\"headers\":{\"req_id\":\"S\"},\"errcode\":40001,\"errmsg\":\"bad\"}", m -> {}, status::add);
        assertTrue(status.contains("auth-failed"), "订阅失败应打 auth-failed");
    }

    @Test
    void handleFrameEmitsSubscribedOnOkResp() {
        WecomWsClient c = client();
        c.setSubscribeReqIdForTest("S");
        List<String> status = new ArrayList<>();
        c.handleFrame("{\"headers\":{\"req_id\":\"S\"},\"errcode\":0}", m -> {}, status::add);
        assertTrue(status.contains("subscribed"));
    }

    @Test
    void handleFrameIgnoresUnrelated() {
        List<WecomFrames.Inbound> got = new ArrayList<>();
        List<String> status = new ArrayList<>();
        client().handleFrame("{\"cmd\":\"ping\",\"headers\":{\"req_id\":\"x\"}}", got::add, status::add);
        assertTrue(got.isEmpty() && status.isEmpty());
    }

    @Test
    void backoffMonotonicCapped() {
        assertTrue(WecomWsClient.backoffSeconds(0) >= 1);
        assertTrue(WecomWsClient.backoffSeconds(99) <= 60);
        assertTrue(WecomWsClient.backoffSeconds(3) >= WecomWsClient.backoffSeconds(0));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=WecomWsClientLogicTest test`
Expected: 编译失败。

- [ ] **Step 3: 写 `WecomWsClient`**

```java
package com.lyhn.wraith.gateway.wecom;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.jetbrains.annotations.NotNull;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * 企微智能机器人长连接客户端(okhttp WebSocket)。connect() 阻塞重连循环:
 * 建连 → 发 aibot_subscribe → 30s ping 心跳 → 收帧经 handleFrame 分发 → 断线退避重连。
 * 帧分发逻辑收在包私 handleFrame,可脱网单测。
 */
public final class WecomWsClient {

    private static final Logger log = LoggerFactory.getLogger(WecomWsClient.class);
    private static final String WS_URL = "wss://openws.work.weixin.qq.com";
    private static final long[] BACKOFF = {2, 5, 10, 30, 60};

    public interface OnInbound { void onMessage(WecomFrames.Inbound m); }
    public interface OnStatus { void onStatus(String wireToken); }

    private final OkHttpClient http;
    private final String botId;
    private final String secret;

    private volatile WebSocket ws;
    private volatile boolean stopping;
    private volatile String subscribeReqId;

    private ScheduledExecutorService heartbeat;

    public WecomWsClient(OkHttpClient http, String botId, String secret) {
        this.http = http;
        this.botId = botId;
        this.secret = secret;
    }

    public static long backoffSeconds(int attempt) {
        return BACKOFF[Math.min(Math.max(attempt, 0), BACKOFF.length - 1)];
    }

    /** 包私:测试注入订阅 reqId 以驱动 handleFrame 的订阅判定分支。 */
    void setSubscribeReqIdForTest(String reqId) { this.subscribeReqId = reqId; }

    /** 阻塞重连循环。放守护线程跑。 */
    public void connect(OnInbound onInbound, OnStatus onStatus) {
        int attempt = 0;
        while (!stopping) {
            final CountDownLatch closed = new CountDownLatch(1);
            onStatus.onStatus("disconnected"); // 连接中先视为未就绪;subscribed 后点亮
            this.subscribeReqId = UUID.randomUUID().toString();
            Request req = new Request.Builder().url(WS_URL).build();
            WebSocket socket = http.newWebSocket(req, new WebSocketListener() {
                @Override public void onOpen(@NotNull WebSocket webSocket, @NotNull Response response) {
                    webSocket.send(WecomFrames.subscribeFrame(botId, secret, subscribeReqId));
                    startHeartbeat(webSocket);
                }
                @Override public void onMessage(@NotNull WebSocket webSocket, @NotNull String text) {
                    try { handleFrame(text, onInbound, onStatus); }
                    catch (Exception e) { log.warn("[gateway] 企微帧处理异常: {}", e.toString()); }
                }
                @Override public void onClosing(@NotNull WebSocket webSocket, int code, @NotNull String reason) {
                    webSocket.close(1000, null);
                }
                @Override public void onClosed(@NotNull WebSocket webSocket, int code, @NotNull String reason) {
                    stopHeartbeat(); closed.countDown();
                }
                @Override public void onFailure(@NotNull WebSocket webSocket, @NotNull Throwable t, Response response) {
                    log.warn("[gateway] 企微长连接失败: {}", t.toString());
                    stopHeartbeat(); closed.countDown();
                }
            });
            this.ws = socket;
            try { closed.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
            if (stopping) break;
            onStatus.onStatus("disconnected");
            long wait = backoffSeconds(attempt++);
            try { TimeUnit.SECONDS.sleep(wait); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
        }
        stopHeartbeat();
    }

    /** 收帧分发:订阅结果 → 状态灯;aibot_msg_callback → onInbound。 */
    void handleFrame(String text, OnInbound onInbound, OnStatus onStatus) {
        WecomFrames.SubResult sub = WecomFrames.parseSubscribeResult(text, subscribeReqId);
        if (sub == WecomFrames.SubResult.SUBSCRIBED) { onStatus.onStatus("subscribed"); return; }
        if (sub == WecomFrames.SubResult.AUTH_FAILED) { onStatus.onStatus("auth-failed"); return; }
        WecomFrames.Inbound in = WecomFrames.parseCallback(text);
        if (in != null) onInbound.onMessage(in);
    }

    /** 回复 markdown(复用入站 reqId)。 */
    public void respondMarkdown(String reqId, String content) {
        WebSocket w = this.ws;
        if (w != null) w.send(WecomFrames.respondMarkdownFrame(reqId, content));
    }

    public void stop() {
        stopping = true;
        stopHeartbeat();
        WebSocket w = this.ws;
        if (w != null) { try { w.close(1000, null); } catch (Exception ignored) {} }
    }

    private synchronized void startHeartbeat(WebSocket socket) {
        stopHeartbeat();
        heartbeat = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "wecom-heartbeat");
            t.setDaemon(true);
            return t;
        });
        heartbeat.scheduleAtFixedRate(() -> {
            try { socket.send(WecomFrames.pingFrame(UUID.randomUUID().toString())); }
            catch (Exception e) { log.warn("[gateway] 企微心跳发送失败: {}", e.toString()); }
        }, 30, 30, TimeUnit.SECONDS);
    }

    private synchronized void stopHeartbeat() {
        if (heartbeat != null) { heartbeat.shutdownNow(); heartbeat = null; }
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=WecomWsClientLogicTest test`
Expected: Tests run: 5, Failures: 0。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/gateway/wecom/WecomWsClient.java src/test/java/com/lyhn/wraith/gateway/wecom/WecomWsClientLogicTest.java
git commit -m "feat(gateway/wecom): WecomWsClient okhttp 长连接外壳 + 分发接缝单测"
```

---

### Task 5: WecomProvider(装配)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/wecom/WecomProvider.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/wecom/WecomProviderTest.java`

**Interfaces:**
- Consumes:`WraithConfig.GatewayWecomConfig`、`LlmClient`、`Authorizer(String owner)` 有 `boolean isAllowed(String)`、`Dedup(int)` 有 `boolean seen(String)`、`SessionRouter(java.util.function.Function<String,GatewaySession>)`、`GatewaySession(String openid, String workspace, LlmClient client, java.util.function.Consumer<String> approvalSurface)`、`ImTurnDriver(SessionRouter, ImTurnDriver.Sender, ExecutorService)` 且 `Sender.send(String openid, String text, String replyToMsgId)`、`WecomFrames`、`WecomInbound`、`WecomWsClient`
- Produces:`WecomProvider implements ImProvider`;生产构造 `WecomProvider(GatewayWecomConfig, LlmClient, Map<String,CompletableFuture<ApprovalResult>> pendingApprovals)`;测试构造 `WecomProvider(String ownerUserid, WecomWsClient ws, Runnable wsLoop)`(不触网)

> 先读 `FeishuProvider.java` 对齐:SessionRouter/GatewaySession/ImTurnDriver 的**确切构造签名**与审批 surface 闭包写法;若与本 Interfaces 描述不符,以 FeishuProvider 实际为准。approvalSurface 闭包 Phase A 先给 no-op(HITL 归 Phase B),即 `sessKey -> {}`。

- [ ] **Step 1: 写失败测试 `WecomProviderTest`(复刻 FeishuProviderTest 风格)**

```java
package com.lyhn.wraith.gateway.wecom;

import okhttp3.OkHttpClient;
import org.junit.jupiter.api.Test;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;

class WecomProviderTest {

    private WecomProvider provider(String owner, Runnable wsLoop) {
        return new WecomProvider(owner, new WecomWsClient(new OkHttpClient(), "b", "s"), wsLoop);
    }

    @Test
    void platformIsWecom() {
        assertEquals("wecom", provider("U", () -> {}).platform());
    }

    @Test
    void deliveryAdapterEmptyInPhaseA() {
        // Phase A 尚无投递适配器(归 Phase B);此处应为 empty。
        assertTrue(provider("U", () -> {}).deliveryAdapter().isEmpty());
    }

    @Test
    void startRunsWsLoopOnDaemonThread() throws Exception {
        CountDownLatch ran = new CountDownLatch(1);
        provider("U", ran::countDown).start();
        assertTrue(ran.await(2, TimeUnit.SECONDS), "start() 应把 wsLoop 放新线程跑并立即返回");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=WecomProviderTest test`
Expected: 编译失败。

- [ ] **Step 3: 写 `WecomProvider`**

```java
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=WecomProviderTest test`
Expected: Tests run: 3, Failures: 0。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/gateway/wecom/WecomProvider.java src/test/java/com/lyhn/wraith/gateway/wecom/WecomProviderTest.java
git commit -m "feat(gateway/wecom): WecomProvider 装配(长连接收发 + 单聊对话)+ 单测"
```

---

### Task 6: 接线 GatewayDaemon.buildProviders

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/gateway/GatewayDaemon.java`(`buildProviders` 加 wecom 分支)

**Interfaces:**
- Consumes:`WraithConfig.GatewayConfig.getWecom()`、`WecomProvider(cfg, client, pendingApprovals)`

- [ ] **Step 1: 在 buildProviders 加 wecom 分支**

在 `feishu` 分支后加:
```java
if (gw != null && gw.getWecom() != null) {
    providers.add(new com.lyhn.wraith.gateway.wecom.WecomProvider(
            gw.getWecom(), client, pendingApprovals));
}
```

- [ ] **Step 2: 编译 + 全量 gateway 测试**

Run: `mvn -q -DskipTests compile` 然后 `mvn -DskipTests=false -Dtest='Wecom*Test' test`
Expected: 全部通过(WecomFrames 7 + WecomInbound 7 + WecomWsClientLogic 5 + WecomProvider 3)。

- [ ] **Step 3: Commit**

```bash
git add src/main/java/com/lyhn/wraith/gateway/GatewayDaemon.java
git commit -m "feat(gateway): buildProviders 接入 wecom(按 config 装配企微 provider)"
```

---

## 真机眼验(Phase A 收尾)

手改 `~/.wraith/config.json` 的 `gateway.wecom`(botId/secret/ownerUserid 先留空 workspace 填绝对路径),
重建 jar 部署,`wraith gateway` 启动:
1. 日志出现 `IM provider 已启动: wecom` + `WRAITH_GATEWAY_STATUS subscribed`。
2. 首次未填 ownerUserid → 企微私聊 bot,应回显你的 userid;填进 config 重启。
3. 再私聊 bot,收到 agent 的 markdown 回复(标题/加粗/列表原生渲染)。
4. 若 `auth-failed` → 核对 botId/secret;若无 subscribed → 读日志 `企微长连接失败`。

## Self-Review 记录

- Spec 覆盖:长连接/订阅/心跳/收发/分类/主人绑定/状态灯/红线 —— Task 2-6 全覆盖;HITL、cron 投递、桌面 UI 明确归 Phase B/C。
- 无占位:各步含完整代码与命令。
- 类型一致:InboundMsg(openid,text,msgId,ts) 全程一致;Sender.replyTo 承载 reqId;WecomFrames 键名与 spec 一致。
- 待实现期以 FeishuProvider 实际签名校准的点已在 Task 5 标注(SessionRouter/GatewaySession/ImTurnDriver 构造)。
