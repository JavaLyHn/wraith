# IM v1 —— 对话式 QQ 单聊 bot(`wraith gateway`)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个常驻 `wraith gateway` Java daemon,让你在 QQ 单聊里给自己的 bot 发消息、驱动一个进程内 wraith 会话、把回复发回,危险操作在 QQ 里按钮审批。

**Architecture:** Java 核内新包 `com.lyhn.wraith.gateway`;`wraith gateway` 子命令(在 `Main.main` 分发,`return` 退出、不进 CLI 交互循环)。进程内直接复用 `Agent` + `HitlToolRegistry` + `SessionStore`(= SessionRunner 级组件),用一个 `GatewayRenderer` 承接审批;QQ 官方 bot 走 OkHttp WebSocket 网关(收) + REST(发)。**不经 app-server JSON-RPC,故不碰 T12。**

**Tech Stack:** Java 17 / Maven;OkHttp 4.12(HTTP + WebSocket);Jackson 2.16(JSON);JCE(AES-GCM);JUnit 5 + Mockito 5 + OkHttp MockWebServer。

## Global Constraints

- 包名 `com.lyhn.wraith.gateway`;Java 17;不新增第三方依赖(全部用现有:OkHttp/Jackson/JCE)。
- **CLI 交互路径零行为变化**:只在 `Main.main` 加一个 `if (isGatewayCommand(args)){…;return;}` 分支;**不改** `startAppServer()` 工厂、不改交互循环。
- **新能力只经 SessionRunner 级组件**(`Agent`/`HitlToolRegistry`/`SessionStore`),复用现有 HITL 链。
- **密钥红线**:`appId/clientSecret/token/openid-secret` 只存 `~/.wraith/config.json`(仓库外),**绝不进日志、绝不入库**。每次提交前跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`,只应命中字段名/自指(benign,报告注明)。
- **单聊-only**:只处理 `C2C_MESSAGE_CREATE` 与 `INTERACTION_CREATE`;频道/群不做。无主动推——回复一律用入站 `msg_id` 做被动回复。
- 准入 **deny-all**:仅放行 `config.gateway.qq.ownerOpenid`。
- 测试:`mvn test -DskipTests=false -Dtest=<Class>`(单类);全量门禁 `mvn test -DskipTests=false` 须 **0F/0E BUILD SUCCESS**。
- 提交尾注:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- ⚠️ **开工闸**:实现前须通过 spec §10 三条现场验证(个人测试级 bot 开 C2C 单聊 / 沙箱收发 / openclaw 端点)。WS 实连与端到端属**眼验**(需真 QQ),计划内其余单元均可红绿自动化。

## File Structure

```
src/main/java/com/lyhn/wraith/
  config/WraithConfig.java                      # 修改:加 gateway.qq 节
  cli/Main.java                                 # 修改:加 gateway 分发(仅 +1 分支)
  gateway/
    GatewayConfigAccess.java                    # 读 gateway.qq(空/缺失安全)
    Authorizer.java                             # deny-all + owner openid
    qq/QqText.java                              # 4000 分片 + msg_seq
    qq/InboundMsg.java                          # 归一化入站(record)
    qq/QqEvents.java                            # 解析 C2C / INTERACTION JSON
    qq/Dedup.java                               # msgId 去重(300s/1000)
    qq/QqApiClient.java                         # token + sendC2C + ackInteraction
    qq/QqApproval.java                          # 审批 keyboard 构造 + 回调解析
    qq/QqWsClient.java                          # WS:payload/backoff/dispatch + socket shell
    GatewayRenderer.java                        # Renderer 实现:promptApproval→QQ 按钮
    GatewaySession.java                         # 组装 Agent+registry+store+renderer;runTurn
    SessionRouter.java                          # openid→GatewaySession;持久映射;/new
    ImTurnDriver.java                           # handle(openid,text):跑回合→回发+审批+错误
    GatewayDaemon.java                          # start:装配 + 连 WS + 运行
    bind/Openclaw.java                          # create/poll + AES-GCM 解密
    bind/BindCommand.java                       # gateway bind:跑绑定→写 config
src/test/java/com/lyhn/wraith/gateway/         # 各单元测试 + 集成
```

---

### Task 1: `WraithConfig` 加 `gateway.qq` 节

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/config/WraithConfig.java`
- Test: `src/test/java/com/lyhn/wraith/config/WraithConfigGatewayTest.java`

**Interfaces:**
- Produces: `WraithConfig.getGateway() → GatewayConfig`;`GatewayConfig.getQq() → GatewayQqConfig`;`GatewayQqConfig{appId,clientSecret,ownerOpenid,workspace}` 的 getter/setter。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WraithConfigGatewayTest {
    @Test
    void deserializesGatewayQqSection() throws Exception {
        String json = """
            {"defaultProvider":"glm","providers":{},
             "gateway":{"qq":{"appId":"A","clientSecret":"S","ownerOpenid":"O","workspace":"/w"}}}""";
        WraithConfig c = new ObjectMapper().readValue(json, WraithConfig.class);
        assertNotNull(c.getGateway());
        assertNotNull(c.getGateway().getQq());
        assertEquals("A", c.getGateway().getQq().getAppId());
        assertEquals("O", c.getGateway().getQq().getOwnerOpenid());
        assertEquals("/w", c.getGateway().getQq().getWorkspace());
    }

    @Test
    void missingGatewaySectionIsNull() throws Exception {
        WraithConfig c = new ObjectMapper().readValue("{\"providers\":{}}", WraithConfig.class);
        assertNull(c.getGateway());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=WraithConfigGatewayTest`
Expected: FAIL(编译错误:`getGateway()` 不存在)

- [ ] **Step 3: 加节(在 `WraithConfig` 里)**

```java
// 字段(与 providers 并列)
private GatewayConfig gateway;
public GatewayConfig getGateway() { return gateway; }
public void setGateway(GatewayConfig gateway) { this.gateway = gateway; }

@JsonIgnoreProperties(ignoreUnknown = true)
public static class GatewayConfig {
    private GatewayQqConfig qq;
    public GatewayQqConfig getQq() { return qq; }
    public void setQq(GatewayQqConfig qq) { this.qq = qq; }
}

@JsonIgnoreProperties(ignoreUnknown = true)
public static class GatewayQqConfig {
    private String appId, clientSecret, ownerOpenid, workspace;
    public String getAppId() { return appId; }               public void setAppId(String v){ appId=v; }
    public String getClientSecret() { return clientSecret; } public void setClientSecret(String v){ clientSecret=v; }
    public String getOwnerOpenid() { return ownerOpenid; }   public void setOwnerOpenid(String v){ ownerOpenid=v; }
    public String getWorkspace() { return workspace; }       public void setWorkspace(String v){ workspace=v; }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=WraithConfigGatewayTest`
Expected: PASS(2 tests)

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/config/WraithConfig.java src/test/java/com/lyhn/wraith/config/WraithConfigGatewayTest.java
git commit -m "feat(gateway): WraithConfig 增 gateway.qq 节"
```

---

### Task 2: `Authorizer`(deny-all + owner openid)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/Authorizer.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/AuthorizerTest.java`

**Interfaces:**
- Consumes: 无。
- Produces: `new Authorizer(String ownerOpenid)`;`boolean isAllowed(String openid)`。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.gateway;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class AuthorizerTest {
    @Test void ownerAllowedOthersDenied() {
        Authorizer a = new Authorizer("owner-123");
        assertTrue(a.isAllowed("owner-123"));
        assertFalse(a.isAllowed("someone-else"));
        assertFalse(a.isAllowed(null));
        assertFalse(a.isAllowed(""));
    }
    @Test void nullOwnerDeniesAll() {
        assertFalse(new Authorizer(null).isAllowed("anyone"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `mvn test -DskipTests=false -Dtest=AuthorizerTest` → FAIL(类不存在)

- [ ] **Step 3: 实现**

```java
package com.lyhn.wraith.gateway;

/** deny-all:仅放行绑定得到的 owner openid。 */
public final class Authorizer {
    private final String ownerOpenid;
    public Authorizer(String ownerOpenid) { this.ownerOpenid = ownerOpenid; }
    public boolean isAllowed(String openid) {
        return ownerOpenid != null && !ownerOpenid.isEmpty() && ownerOpenid.equals(openid);
    }
}
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS(2 tests)

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/Authorizer.java src/test/java/com/lyhn/wraith/gateway/AuthorizerTest.java
git commit -m "feat(gateway): Authorizer deny-all + owner openid"
```

---

### Task 3: `QqText`(4000 分片 + msg_seq)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/qq/QqText.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/qq/QqTextTest.java`

**Interfaces:**
- Produces: `static List<String> chunk(String text, int max)`(按 max 切,尽量在换行处断);`static int nextMsgSeq(java.util.concurrent.atomic.AtomicInteger ctr)`(1..65535 单调环绕)。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.gateway.qq;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class QqTextTest {
    @Test void shortTextOneChunk() {
        assertEquals(List.of("hi"), QqText.chunk("hi", 4000));
    }
    @Test void splitsOnNewlineWithinLimit() {
        String t = "a".repeat(3990) + "\n" + "b".repeat(20);
        List<String> cs = QqText.chunk(t, 4000);
        assertEquals(2, cs.size());
        assertTrue(cs.get(0).length() <= 4000);
        assertEquals("a".repeat(3990), cs.get(0));   // 在换行断
        assertEquals("b".repeat(20), cs.get(1));
    }
    @Test void hardSplitWhenNoNewline() {
        List<String> cs = QqText.chunk("x".repeat(9000), 4000);
        assertEquals(3, cs.size());
        assertEquals(4000, cs.get(0).length());
        assertEquals(1000, cs.get(2).length());
    }
    @Test void msgSeqInRangeAndIncrements() {
        AtomicInteger c = new AtomicInteger(0);
        int a = QqText.nextMsgSeq(c), b = QqText.nextMsgSeq(c);
        assertTrue(a >= 1 && a <= 65535);
        assertNotEquals(a, b);
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — FAIL(类不存在)

- [ ] **Step 3: 实现**

```java
package com.lyhn.wraith.gateway.qq;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

public final class QqText {
    private QqText() {}

    public static List<String> chunk(String text, int max) {
        List<String> out = new ArrayList<>();
        if (text == null) text = "";
        int i = 0, n = text.length();
        while (i < n) {
            int end = Math.min(i + max, n);
            if (end < n) {
                int nl = text.lastIndexOf('\n', end);
                if (nl > i) end = nl;               // 在窗口内的换行处断(去掉该换行)
            }
            String piece = text.substring(i, end);
            out.add(end < n && text.charAt(end) == '\n' ? piece : piece);
            i = (end < n && text.charAt(end) == '\n') ? end + 1 : end;
        }
        if (out.isEmpty()) out.add("");
        return out;
    }

    /** msg_seq:1..65535 环绕,防 QQ 对同 msg_id 重复发的去重。 */
    public static int nextMsgSeq(AtomicInteger ctr) {
        int v = ctr.updateAndGet(x -> x >= 65535 ? 1 : x + 1);
        return v;
    }
}
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS(4 tests)

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/qq/QqText.java src/test/java/com/lyhn/wraith/gateway/qq/QqTextTest.java
git commit -m "feat(gateway): QqText 分片 + msg_seq"
```

---

### Task 4: 入站解析 `InboundMsg` / `QqEvents` / `Dedup`

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/qq/InboundMsg.java`
- Create: `src/main/java/com/lyhn/wraith/gateway/qq/QqEvents.java`
- Create: `src/main/java/com/lyhn/wraith/gateway/qq/Dedup.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/qq/QqEventsTest.java`

**Interfaces:**
- Consumes: Jackson `JsonNode`。
- Produces: `record InboundMsg(String openid, String text, String msgId, long ts)`;`static InboundMsg QqEvents.parseC2C(JsonNode payloadD)`;`record Interaction(String id, String openid, String buttonData)`;`static Interaction QqEvents.parseInteraction(JsonNode d)`;`new Dedup(int maxSize).seen(String id)`。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.gateway.qq;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class QqEventsTest {
    private final ObjectMapper M = new ObjectMapper();

    @Test void parsesC2cMessage() throws Exception {
        // QQ C2C_MESSAGE_CREATE 的 d 负载(简化真实字段)
        JsonNode d = M.readTree("""
            {"id":"MSG123","content":"你好","timestamp":"2026-07-04T12:00:00+08:00",
             "author":{"user_openid":"OPENID_A"}}""");
        InboundMsg m = QqEvents.parseC2C(d);
        assertEquals("OPENID_A", m.openid());
        assertEquals("你好", m.text());
        assertEquals("MSG123", m.msgId());
    }

    @Test void parsesInteraction() throws Exception {
        JsonNode d = M.readTree("""
            {"id":"INT1","chat_type":1,"user_openid":"OPENID_A",
             "data":{"resolved":{"button_data":"approve:sess-1:allow-once"}}}""");
        QqEvents.Interaction it = QqEvents.parseInteraction(d);
        assertEquals("INT1", it.id());
        assertEquals("approve:sess-1:allow-once", it.buttonData());
    }

    @Test void dedupCatchesRepeat() {
        Dedup d = new Dedup(1000);
        assertFalse(d.seen("m1"));
        assertTrue(d.seen("m1"));
        assertFalse(d.seen("m2"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — FAIL(类不存在)

- [ ] **Step 3: 实现**

`InboundMsg.java`:
```java
package com.lyhn.wraith.gateway.qq;
public record InboundMsg(String openid, String text, String msgId, long ts) {}
```

`QqEvents.java`:
```java
package com.lyhn.wraith.gateway.qq;
import com.fasterxml.jackson.databind.JsonNode;

public final class QqEvents {
    private QqEvents() {}
    public record Interaction(String id, String openid, String buttonData) {}

    public static InboundMsg parseC2C(JsonNode d) {
        String openid = d.path("author").path("user_openid").asText("");
        String text = d.path("content").asText("").trim();
        String msgId = d.path("id").asText("");
        return new InboundMsg(openid, text, msgId, System.currentTimeMillis());
    }

    public static Interaction parseInteraction(JsonNode d) {
        String id = d.path("id").asText("");
        String openid = d.path("user_openid").asText("");
        String btn = d.path("data").path("resolved").path("button_data").asText("");
        return new Interaction(id, openid, btn);
    }
}
```

`Dedup.java`:
```java
package com.lyhn.wraith.gateway.qq;
import java.util.LinkedHashMap;
import java.util.Map;

/** msgId 去重:LRU 上限;seen(id) 首见 false、再见 true。 */
public final class Dedup {
    private final int max;
    private final Map<String, Boolean> seen;
    public Dedup(int max) {
        this.max = max;
        this.seen = new LinkedHashMap<>(16, 0.75f, false) {
            @Override protected boolean removeEldestEntry(Map.Entry<String, Boolean> e) { return size() > Dedup.this.max; }
        };
    }
    public synchronized boolean seen(String id) {
        if (id == null || id.isEmpty()) return false;
        return seen.put(id, Boolean.TRUE) != null;
    }
}
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS(3 tests)

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/qq/InboundMsg.java src/main/java/com/lyhn/wraith/gateway/qq/QqEvents.java src/main/java/com/lyhn/wraith/gateway/qq/Dedup.java src/test/java/com/lyhn/wraith/gateway/qq/QqEventsTest.java
git commit -m "feat(gateway): QQ 入站解析 + 去重"
```

---

### Task 5: `QqApiClient`(token + sendC2C + ackInteraction)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/qq/QqApiClient.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/qq/QqApiClientTest.java`

**Interfaces:**
- Consumes: `QqText`(Task 3);OkHttp `OkHttpClient`;Jackson。
- Produces: `new QqApiClient(String appId, String clientSecret, String apiBase, String tokenUrl, OkHttpClient http)`;`String ensureToken()`(缓存,提前 60s 刷新,singleflight);`void sendC2C(String openid, String text, String replyToMsgId)`(格式化→分片→逐块 POST `/v2/users/{openid}/messages`,首块带 `msg_id`,每块带 `msg_seq`);`void ackInteraction(String id)`(`PUT /interactions/{id}` body `{"code":0}`)。

- [ ] **Step 1: 写失败测试(MockWebServer)**

```java
package com.lyhn.wraith.gateway.qq;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.*;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

class QqApiClientTest {
    MockWebServer server;
    @BeforeEach void up() throws Exception { server = new MockWebServer(); server.start(); }
    @AfterEach void down() throws Exception { server.shutdown(); }

    private QqApiClient client() {
        String base = server.url("/").toString().replaceAll("/$","");
        return new QqApiClient("APP","SECRET", base, base + "/app/getAppAccessToken", new OkHttpClient());
    }

    @Test void fetchesAndCachesToken() throws Exception {
        server.enqueue(new MockResponse().setBody("{\"access_token\":\"TOK\",\"expires_in\":7200}"));
        QqApiClient c = client();
        assertEquals("TOK", c.ensureToken());
        assertEquals("TOK", c.ensureToken());              // 第二次走缓存
        assertEquals(1, server.getRequestCount());          // 未二次请求 token
    }

    @Test void sendC2cPostsPassiveReply() throws Exception {
        server.enqueue(new MockResponse().setBody("{\"access_token\":\"TOK\",\"expires_in\":7200}"));
        server.enqueue(new MockResponse().setBody("{\"id\":\"x\"}"));
        client().sendC2C("OPENID_A", "hi", "MSG1");
        server.takeRequest();                               // token 请求
        RecordedRequest send = server.takeRequest();
        assertEquals("/v2/users/OPENID_A/messages", send.getPath());
        assertTrue(send.getHeader("Authorization").startsWith("QQBot "));
        String body = send.getBody().readUtf8();
        assertTrue(body.contains("\"content\":\"hi\""));
        assertTrue(body.contains("\"msg_id\":\"MSG1\""));   // 被动回复
        assertTrue(body.contains("\"msg_seq\""));
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — FAIL(类不存在)

- [ ] **Step 3: 实现**

```java
package com.lyhn.wraith.gateway.qq;

import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;
import java.io.IOException;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

public final class QqApiClient {
    private static final MediaType JSON = MediaType.get("application/json");
    private final String appId, clientSecret, apiBase, tokenUrl;
    private final OkHttpClient http;
    private final ObjectMapper M = new ObjectMapper();
    private final AtomicInteger seqCtr = new AtomicInteger(0);
    private volatile String token;
    private volatile long expiresAtMs;

    public QqApiClient(String appId, String clientSecret, String apiBase, String tokenUrl, OkHttpClient http) {
        this.appId = appId; this.clientSecret = clientSecret; this.apiBase = apiBase; this.tokenUrl = tokenUrl; this.http = http;
    }

    public synchronized String ensureToken() throws IOException {   // singleflight via synchronized
        if (token != null && System.currentTimeMillis() < expiresAtMs - 60_000) return token;
        String body = M.writeValueAsString(java.util.Map.of("appId", appId, "clientSecret", clientSecret));
        try (Response r = http.newCall(new Request.Builder().url(tokenUrl)
                .post(RequestBody.create(body, JSON)).header("Accept", "application/json").build()).execute()) {
            var node = M.readTree(r.body().string());
            token = node.path("access_token").asText();
            long ttl = node.path("expires_in").asLong(7200);
            expiresAtMs = System.currentTimeMillis() + ttl * 1000;
            if (token == null || token.isEmpty()) throw new IOException("no access_token");
            return token;
        }
    }

    public void sendC2C(String openid, String text, String replyToMsgId) throws IOException {
        List<String> parts = QqText.chunk(text, 4000);
        boolean first = true;
        for (String part : parts) {
            var body = new java.util.LinkedHashMap<String, Object>();
            body.put("content", part);
            body.put("msg_type", 0);                              // text
            body.put("msg_seq", QqText.nextMsgSeq(seqCtr));
            if (first && replyToMsgId != null && !replyToMsgId.isEmpty()) body.put("msg_id", replyToMsgId);
            post("/v2/users/" + openid + "/messages", M.writeValueAsString(body));
            first = false;
        }
    }

    public void ackInteraction(String id) throws IOException {
        Request req = new Request.Builder().url(apiBase + "/interactions/" + id)
                .put(RequestBody.create("{\"code\":0}", JSON))
                .header("Authorization", "QQBot " + ensureToken()).header("Accept", "application/json").build();
        try (Response r = http.newCall(req).execute()) { /* best-effort ack */ }
    }

    private void post(String path, String json) throws IOException {
        Request req = new Request.Builder().url(apiBase + path)
                .post(RequestBody.create(json, JSON))
                .header("Authorization", "QQBot " + ensureToken()).header("Accept", "application/json").build();
        try (Response r = http.newCall(req).execute()) {
            if (!r.isSuccessful()) throw new IOException("QQ send failed: HTTP " + r.code());
        }
    }
}
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS(2 tests)

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/qq/QqApiClient.java src/test/java/com/lyhn/wraith/gateway/qq/QqApiClientTest.java
git commit -m "feat(gateway): QqApiClient token + C2C 被动回复 + ack"
```

---

### Task 6: `QqApproval`(审批 keyboard 构造 + 回调解析)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/qq/QqApproval.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/qq/QqApprovalTest.java`

**Interfaces:**
- Consumes: `com.lyhn.wraith.hitl.ApprovalResult`(现有 record,Decision 枚举)。
- Produces: `static String keyboardJson(String sessionKey)`(三键 `approve:{sessionKey}:{allow-once|allow-always|deny}`);`record Callback(String sessionKey, ApprovalResult result)`;`static Callback parse(String buttonData)`(未知→null)。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.gateway.qq;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class QqApprovalTest {
    @Test void keyboardHasThreeButtons() {
        String j = QqApproval.keyboardJson("sess-1");
        assertTrue(j.contains("approve:sess-1:allow-once"));
        assertTrue(j.contains("approve:sess-1:allow-always"));
        assertTrue(j.contains("approve:sess-1:deny"));
    }
    @Test void parseMapsDecisions() {
        assertEquals(ApprovalResult.Decision.APPROVED, QqApproval.parse("approve:s:allow-once").result().decision());
        assertEquals(ApprovalResult.Decision.APPROVED_ALL, QqApproval.parse("approve:s:allow-always").result().decision());
        assertEquals(ApprovalResult.Decision.REJECTED, QqApproval.parse("approve:s:deny").result().decision());
        assertEquals("s", QqApproval.parse("approve:s:deny").sessionKey());
        assertNull(QqApproval.parse("garbage"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — FAIL(类不存在)

- [ ] **Step 3: 实现**

```java
package com.lyhn.wraith.gateway.qq;

import com.lyhn.wraith.hitl.ApprovalResult;

public final class QqApproval {
    private QqApproval() {}
    public record Callback(String sessionKey, ApprovalResult result) {}

    public static String keyboardJson(String sessionKey) {
        // QQ inline keyboard:三个 callback(action.type=1)按钮,group 互斥
        String btn = "{\"id\":\"%s\",\"render_data\":{\"label\":\"%s\",\"style\":%d}," +
                "\"action\":{\"type\":1,\"data\":\"approve:%s:%s\",\"permission\":{\"type\":1}}}";
        String once   = String.format(btn, "1", "✅ 批准一次", 1, sessionKey, "allow-once");
        String always = String.format(btn, "2", "✅ 总是允许", 1, sessionKey, "allow-always");
        String deny   = String.format(btn, "3", "⛔ 拒绝", 2, sessionKey, "deny");
        return "{\"content\":{\"rows\":[{\"buttons\":[" + once + "," + always + "," + deny + "]}]}}";
    }

    public static Callback parse(String buttonData) {
        if (buttonData == null) return null;
        String[] p = buttonData.split(":", 3);
        if (p.length != 3 || !"approve".equals(p[0])) return null;
        ApprovalResult r = switch (p[2]) {
            case "allow-once" -> ApprovalResult.approve();
            case "allow-always" -> ApprovalResult.approveAll();
            case "deny" -> ApprovalResult.reject("用户在 QQ 拒绝");
            default -> null;
        };
        return r == null ? null : new Callback(p[1], r);
    }
}
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS(2 tests)

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/qq/QqApproval.java src/test/java/com/lyhn/wraith/gateway/qq/QqApprovalTest.java
git commit -m "feat(gateway): QQ 审批按钮构造 + 回调解析"
```

---

### Task 7: `GatewayRenderer`(承接 promptApproval → QQ 按钮)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/GatewayRenderer.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/GatewayRendererTest.java`

**Interfaces:**
- Consumes: `com.lyhn.wraith.render.Renderer`(实现该接口,大部分方法 no-op);`ApprovalRequest`/`ApprovalResult`。
- Produces: `new GatewayRenderer(String sessionKey, java.util.function.Consumer<String> approvalPusher)`(`approvalPusher` 收到本会话 `sessionKey`,负责给 QQ 发审批按钮);`ApprovalResult promptApproval(ApprovalRequest)`(阻塞);`void resolveApproval(ApprovalResult)`(由 WS 线程按 sessionKey 唤醒)。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.gateway;
import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class GatewayRendererTest {
    @Test @Timeout(5)
    void promptBlocksUntilResolved() throws Exception {
        AtomicReference<String> pushed = new AtomicReference<>();
        GatewayRenderer r = new GatewayRenderer("sess-1", pushed::set);
        ApprovalRequest req = new ApprovalRequest("run_terminal","{\"cmd\":\"rm x\"}","high","risk","sug","ctx","sens");
        ExecutorService ex = Executors.newSingleThreadExecutor();
        Future<ApprovalResult> f = ex.submit(() -> r.promptApproval(req));
        Thread.sleep(100);
        assertEquals("sess-1", pushed.get());               // 已推审批
        assertFalse(f.isDone());                            // 阻塞中
        r.resolveApproval(ApprovalResult.approve());
        assertEquals(ApprovalResult.Decision.APPROVED, f.get(2, TimeUnit.SECONDS).decision());
        ex.shutdownNow();
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — FAIL(类不存在)

- [ ] **Step 3: 实现**（实现 `Renderer` 全部方法:除 `promptApproval` 外一律空体;仅列关键方法,其余用 IDE "implement methods" 生成 no-op）

```java
package com.lyhn.wraith.gateway;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.render.Renderer;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

/** 网关用 Renderer:QQ 不流式,只把 HITL 审批路由成 QQ 按钮;其余回调 no-op。 */
public final class GatewayRenderer implements Renderer {
    private final String sessionKey;
    private final Consumer<String> approvalPusher;      // 收 sessionKey,负责发 QQ 审批按钮
    private volatile CompletableFuture<ApprovalResult> pending;

    public GatewayRenderer(String sessionKey, Consumer<String> approvalPusher) {
        this.sessionKey = sessionKey; this.approvalPusher = approvalPusher;
    }

    @Override public ApprovalResult promptApproval(ApprovalRequest request) {
        CompletableFuture<ApprovalResult> f = new CompletableFuture<>();
        this.pending = f;
        approvalPusher.accept(sessionKey);              // ImTurnDriver 收到后发按钮
        try { return f.get(); }
        catch (Exception e) { return ApprovalResult.reject("interrupted"); }
        finally { this.pending = null; }
    }

    /** WS 线程收到按钮回调后调用。 */
    public void resolveApproval(ApprovalResult result) {
        CompletableFuture<ApprovalResult> f = this.pending;
        if (f != null) f.complete(result);
    }

    // ── 以下为 Renderer 其余方法:QQ 用整条 runTurn 返回值,故全部 no-op ──
    @Override public void appendAssistantContentDelta(String delta) {}
    @Override public void finishAssistantContent() {}
    @Override public void appendToolCalls(List<LlmClient.ToolCall> toolCalls) {}
    @Override public void appendToolOutputDelta(String callId, String stream, String chunk) {}
    @Override public void appendToolResult(String callId, boolean ok, int exitCode) {}
    @Override public void beginThinking(String label) {}
    @Override public void appendThinking(String delta) {}
    @Override public void endThinking() {}
    // 注:Renderer 若还有其它方法(appendDiff、todos、status、mcpStatus 等),同样以空体实现。
}
```

> 执行提示:打开 `render/Renderer.java` 对齐**完整**方法列表,未在上面列出的一律空体实现,确保编译通过。

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS(1 test)

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/GatewayRenderer.java src/test/java/com/lyhn/wraith/gateway/GatewayRendererTest.java
git commit -m "feat(gateway): GatewayRenderer 承接 HITL 审批"
```

---

### Task 8: `GatewaySession`(组装会话 + runTurn)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/GatewaySession.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/GatewaySessionTest.java`

**Interfaces:**
- Consumes: `GatewayRenderer`(Task 7);现有 `Agent`、`HitlToolRegistry`、`SwitchableHitlHandler`、`TerminalHitlHandler`、`RendererHitlHandler`、`AppServerMcp`、`SessionStore`、`LlmClient`。
- Produces: `new GatewaySession(String sessionKey, String workspace, LlmClient client, Consumer<String> approvalPusher)`;`String runTurn(String input)`(阻塞返回最终文本);`GatewayRenderer renderer()`;`String persist()`。

> 本任务**复刻** `Main.startAppServer` 工厂的装配(AppServer.java 引导),但用 `GatewayRenderer` 替换 `EventStreamRenderer`。为保持 app-server 零改动,采取复刻而非抽取共享(债务记录在 spec §2.3 之外的重构 backlog)。

- [ ] **Step 1: 写失败测试(用 Mockito 造 LlmClient,让 Agent 直接回文本)**

```java
package com.lyhn.wraith.gateway;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GatewaySessionTest {
    @Test void runTurnReturnsAssistantText(@TempDir Path tmp) throws Exception {
        System.setProperty("user.home", tmp.toString());      // 隔离 SessionStore/config
        LlmClient client = mock(LlmClient.class);
        when(client.getProviderName()).thenReturn("stub");
        when(client.getModelName()).thenReturn("stub-1");
        // Agent 无工具调用时,单轮 LLM 应答即最终文本;按现有 LlmClient 接口 stub 一条 assistant 回复。
        // (执行时对齐 LlmClient.chat(...) 的真实签名与 Message 构造。)
        StubLlm.wire(client, "你好,我在");
        GatewaySession s = new GatewaySession("sess-1", tmp.toString(), client, key -> {});
        assertEquals("你好,我在", s.runTurn("在吗").trim());
    }
}
```

> 执行提示:`StubLlm.wire` 是本测试的小助手,按 `LlmClient` 真实的 `chat`/流式接口把一条 assistant 文本喂给 Agent(参考现有 `LlmClientFactoryTest` 与 Agent 单测的 stub 方式)。若现有测试里已有可复用的 fake LlmClient,优先复用。

- [ ] **Step 2: 跑测试确认失败** — FAIL(类不存在)

- [ ] **Step 3: 实现**(复刻工厂装配,替换 renderer)

```java
package com.lyhn.wraith.gateway;

import com.lyhn.wraith.agent.Agent;
import com.lyhn.wraith.hitl.*;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.runtime.appserver.AppServerMcp;
import com.lyhn.wraith.session.SessionStore;
import com.lyhn.wraith.tool.ToolRegistry;
import java.nio.file.Path;
import java.util.function.Consumer;

public final class GatewaySession {
    private final GatewayRenderer renderer;
    private final Agent agent;
    private final SessionStore store;

    public GatewaySession(String sessionKey, String workspace, LlmClient client, Consumer<String> approvalPusher) {
        this.renderer = new GatewayRenderer(sessionKey, approvalPusher);
        // HITL 链:Terminal(非交互)→Switchable→RendererHitl(路由到 renderer.promptApproval)
        SwitchableHitlHandler hitl = new SwitchableHitlHandler(new TerminalHitlHandler(false));
        hitl.setEnabled(true);
        HitlToolRegistry registry = new HitlToolRegistry(hitl);
        String root = (workspace != null && !workspace.isBlank())
                ? workspace : Path.of(".").toAbsolutePath().normalize().toString();
        AppServerMcp mcp = new AppServerMcp();
        mcp.ensureFor(root, registry, renderer);
        registry.setProjectPath(root);
        registry.setWriteFileObserver((path, ba) -> renderer.appendDiff(path, ba[0], ba[1]));  // 若 Renderer 有该方法
        registry.setCommandOutputObserver(new ToolRegistry.CommandOutputObserver() {
            public void onChunk(String callId, String stream, String chunk) {}
            public void onResult(String callId, boolean ok, int exitCode) {}
        });
        hitl.setDelegate(new RendererHitlHandler(renderer, hitl.isEnabled()));
        this.agent = new Agent(client, registry);
        this.agent.setRenderer(renderer);
        this.store = SessionStore.open(Path.of(System.getProperty("user.home")), root,
                client.getProviderName(), client.getModelName());
        this.store.startNew();
    }

    /** 阻塞跑完一轮,返回最终助手文本。 */
    public String runTurn(String input) { return agent.run(input); }
    public GatewayRenderer renderer() { return renderer; }
    public String persist() { /* 参照 app-server persistTurn:落盘 store,返回持久 id */ return null; }
}
```

> 执行提示:对齐 `registry.setCommandSandbox(...)`(app-server 用 `buildAppServerSandbox()`)——网关应复用同样的沙箱,勿放开。`appendDiff` 等按 Renderer 实际方法名对齐。`persist()` 参照 `Main` 工厂里 `persistTurn()` 的实现落盘。

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS(1 test)

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/GatewaySession.java src/test/java/com/lyhn/wraith/gateway/GatewaySessionTest.java
git commit -m "feat(gateway): GatewaySession 组装 Agent+HITL+store,runTurn 返回最终文本"
```

---

### Task 9: `SessionRouter`(openid→会话,持久映射,/new)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/SessionRouter.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/SessionRouterTest.java`

**Interfaces:**
- Consumes: `GatewaySession`(Task 8);会话工厂 `Function<String,GatewaySession>`(测试注入 fake)。
- Produces: `new SessionRouter(Path stateFile, Function<String,GatewaySession> factory)`;`GatewaySession resolve(String openid)`(get-or-create,进程内长活);`void reset(String openid)`(/new:丢弃并下次重建);持久 `openid→内部序号` 到 `stateFile`。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.gateway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

class SessionRouterTest {
    @Test void resolveCreatesOnceThenReuses(@TempDir Path tmp) {
        AtomicInteger created = new AtomicInteger();
        SessionRouter r = new SessionRouter(tmp.resolve("g.json"),
                openid -> { created.incrementAndGet(); return mock(GatewaySession.class); });
        GatewaySession a = r.resolve("O1");
        GatewaySession b = r.resolve("O1");
        assertSame(a, b);
        assertEquals(1, created.get());
        r.reset("O1");
        GatewaySession c = r.resolve("O1");
        assertNotSame(a, c);
        assertEquals(2, created.get());
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — FAIL(类不存在)

- [ ] **Step 3: 实现**

```java
package com.lyhn.wraith.gateway;

import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/** openid→进程内长活会话;/new 重建。映射持久化留待 persist() 落 sessionId(v1 先内存映射)。 */
public final class SessionRouter {
    private final Path stateFile;
    private final Function<String, GatewaySession> factory;
    private final Map<String, GatewaySession> live = new ConcurrentHashMap<>();

    public SessionRouter(Path stateFile, Function<String, GatewaySession> factory) {
        this.stateFile = stateFile; this.factory = factory;
    }
    public GatewaySession resolve(String openid) {
        return live.computeIfAbsent(openid, factory);
    }
    public void reset(String openid) {
        live.remove(openid);   // 下次 resolve 重建;历史落盘由 GatewaySession.persist 负责
    }
}
```

> 执行提示:v1 只需进程内映射即可跑通对话;`stateFile` 持久化(openid→持久 sessionId,重启续接)可作本任务的**第二个测试 + 增量**——用 `GatewaySession.persist()` 的返回 id 写盘、启动时预载。若时间紧,持久化可拆为紧随的小任务,但需在本 plan 勾掉前补上测试。

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS(1 test)

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/SessionRouter.java src/test/java/com/lyhn/wraith/gateway/SessionRouterTest.java
git commit -m "feat(gateway): SessionRouter openid→会话 + /new"
```

---

### Task 10: `ImTurnDriver`(跑回合→回发 + 审批 + 错误)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/ImTurnDriver.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/ImTurnDriverTest.java`

**Interfaces:**
- Consumes: `SessionRouter`(Task 9)、`GatewaySession`/`GatewayRenderer`(7/8)、`QqApproval`(6);一个发送口 `interface Sender { void send(String openid, String text, String replyToMsgId); }`(生产实现 = `QqApiClient::sendC2C` 适配)。
- Produces: `new ImTurnDriver(SessionRouter router, Sender sender, ExecutorService pool)`;`void onMessage(InboundMsg m)`(异步跑 `runTurn`,完成后 `sender.send(final,replyTo)`;`/new` → reset + 提示;异常 → 错误消息);`void onApproval(String sessionKey, ApprovalResult r)`(→ `session.renderer().resolveApproval`)。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.gateway;
import com.lyhn.wraith.gateway.qq.InboundMsg;
import org.junit.jupiter.api.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ImTurnDriverTest {
    ExecutorService pool;
    @BeforeEach void up(){ pool = Executors.newCachedThreadPool(); }
    @AfterEach void down(){ pool.shutdownNow(); }

    @Test @Timeout(5)
    void runsTurnAndSendsPassiveReply() throws Exception {
        GatewaySession sess = mock(GatewaySession.class);
        when(sess.runTurn("在吗")).thenReturn("你好");
        SessionRouter router = mock(SessionRouter.class);
        when(router.resolve("O1")).thenReturn(sess);
        CountDownLatch sent = new CountDownLatch(1);
        AtomicReference<String[]> got = new AtomicReference<>();
        ImTurnDriver d = new ImTurnDriver(router,
                (openid,text,reply) -> { got.set(new String[]{openid,text,reply}); sent.countDown(); }, pool);
        d.onMessage(new InboundMsg("O1","在吗","MSG1", 0));
        assertTrue(sent.await(3, TimeUnit.SECONDS));
        assertArrayEquals(new String[]{"O1","你好","MSG1"}, got.get());
    }

    @Test @Timeout(5)
    void newCommandResetsSession() throws Exception {
        SessionRouter router = mock(SessionRouter.class);
        CountDownLatch sent = new CountDownLatch(1);
        ImTurnDriver d = new ImTurnDriver(router, (o,t,r) -> sent.countDown(), pool);
        d.onMessage(new InboundMsg("O1","/new","MSG2", 0));
        assertTrue(sent.await(3, TimeUnit.SECONDS));
        verify(router).reset("O1");
        verify(router, never()).resolve("O1");
    }

    @Test @Timeout(5)
    void turnFailureSendsError() throws Exception {
        GatewaySession sess = mock(GatewaySession.class);
        when(sess.runTurn(anyString())).thenThrow(new RuntimeException("boom"));
        SessionRouter router = mock(SessionRouter.class);
        when(router.resolve("O1")).thenReturn(sess);
        AtomicReference<String> msg = new AtomicReference<>();
        CountDownLatch sent = new CountDownLatch(1);
        ImTurnDriver d = new ImTurnDriver(router, (o,t,r) -> { msg.set(t); sent.countDown(); }, pool);
        d.onMessage(new InboundMsg("O1","hi","MSG3", 0));
        assertTrue(sent.await(3, TimeUnit.SECONDS));
        assertTrue(msg.get().contains("出错"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — FAIL(类不存在)

- [ ] **Step 3: 实现**

```java
package com.lyhn.wraith.gateway;

import com.lyhn.wraith.gateway.qq.InboundMsg;
import com.lyhn.wraith.hitl.ApprovalResult;
import java.util.concurrent.ExecutorService;

public final class ImTurnDriver {
    public interface Sender { void send(String openid, String text, String replyToMsgId); }

    private final SessionRouter router;
    private final Sender sender;
    private final ExecutorService pool;

    public ImTurnDriver(SessionRouter router, Sender sender, ExecutorService pool) {
        this.router = router; this.sender = sender; this.pool = pool;
    }

    public void onMessage(InboundMsg m) {
        if ("/new".equals(m.text().trim())) {
            router.reset(m.openid());
            sender.send(m.openid(), "已开启新会话。", m.msgId());
            return;
        }
        pool.submit(() -> {
            try {
                GatewaySession s = router.resolve(m.openid());
                String reply = s.runTurn(m.text());
                sender.send(m.openid(), reply == null || reply.isBlank() ? "(空回复)" : reply, m.msgId());
            } catch (Exception e) {
                sender.send(m.openid(), "出错了:" + e.getClass().getSimpleName(), m.msgId());
            }
        });
    }

    /** WS 线程:按 sessionKey(= openid)唤醒挂起的审批。 */
    public void onApproval(String openid, ApprovalResult r) {
        GatewaySession s = router.resolve(openid);
        s.renderer().resolveApproval(r);
    }
}
```

> 执行提示:审批按钮的推送口(`GatewayRenderer` 的 `approvalPusher`)在 `GatewayDaemon`(Task 12)接线时绑定为"给该 openid 发 `QqApproval.keyboardJson` 消息",带被动 `msg_id`。sessionKey 在 v1 即 openid(单聊单 owner)。

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS(3 tests)

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/ImTurnDriver.java src/test/java/com/lyhn/wraith/gateway/ImTurnDriverTest.java
git commit -m "feat(gateway): ImTurnDriver 跑回合→被动回发 + /new + 错误 + 审批唤醒"
```

---

### Task 11: `QqWsClient`(纯 payload/backoff/dispatch + socket 壳)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/qq/QqWsClient.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/qq/QqWsClientLogicTest.java`

**Interfaces:**
- Consumes: OkHttp `WebSocket`;`QqApiClient.ensureToken()`。
- Produces: `static String identifyPayload(String token, int intents)`;`static String resumePayload(String token, String sid, long seq)`;`static String heartbeatPayload(Long seq)`;`static long backoffSeconds(int attempt)`([2,5,10,30,60] 封顶);`static boolean isFatalQuickDisconnect(long[] recentDurationsMs)`(3 次 <5s);实例:`connect(Consumer<InboundMsg> onC2C, BiConsumer<String,String> onInteraction)`(socket 壳,眼验)。

- [ ] **Step 1: 写失败测试(纯逻辑)**

```java
package com.lyhn.wraith.gateway.qq;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class QqWsClientLogicTest {
    @Test void identifyCarriesTokenAndIntents() {
        String p = QqWsClient.identifyPayload("QQBot TOK", QqWsClient.INTENTS_C2C_AND_INTERACTION);
        assertTrue(p.contains("\"op\":2"));
        assertTrue(p.contains("QQBot TOK"));
        assertTrue(p.contains("\"intents\":" + QqWsClient.INTENTS_C2C_AND_INTERACTION));
    }
    @Test void resumeCarriesSessionAndSeq() {
        String p = QqWsClient.resumePayload("QQBot TOK", "SID", 42);
        assertTrue(p.contains("\"op\":6"));
        assertTrue(p.contains("\"session_id\":\"SID\""));
        assertTrue(p.contains("\"seq\":42"));
    }
    @Test void backoffSequenceThenCaps() {
        assertEquals(2, QqWsClient.backoffSeconds(0));
        assertEquals(5, QqWsClient.backoffSeconds(1));
        assertEquals(60, QqWsClient.backoffSeconds(4));
        assertEquals(60, QqWsClient.backoffSeconds(99));
    }
    @Test void threeQuickDisconnectsFatal() {
        assertTrue(QqWsClient.isFatalQuickDisconnect(new long[]{1000,2000,3000}));
        assertFalse(QqWsClient.isFatalQuickDisconnect(new long[]{1000,9000,1000}));
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — FAIL(类不存在)

- [ ] **Step 3: 实现纯逻辑(socket 壳留最小)**

```java
package com.lyhn.wraith.gateway.qq;

public final class QqWsClient {
    // intents 位:C2C 消息 + 交互(单聊 v1;不含群/频道位)
    public static final int INTENTS_C2C_AND_INTERACTION = (1 << 25) | (1 << 26);
    private static final long[] BACKOFF = {2, 5, 10, 30, 60};

    public static String identifyPayload(String token, int intents) {
        return "{\"op\":2,\"d\":{\"token\":\"" + token + "\",\"intents\":" + intents +
               ",\"shard\":[0,1],\"properties\":{}}}";
    }
    public static String resumePayload(String token, String sid, long seq) {
        return "{\"op\":6,\"d\":{\"token\":\"" + token + "\",\"session_id\":\"" + sid + "\",\"seq\":" + seq + "}}";
    }
    public static String heartbeatPayload(Long seq) {
        return "{\"op\":1,\"d\":" + (seq == null ? "null" : seq) + "}";
    }
    public static long backoffSeconds(int attempt) {
        return BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
    }
    public static boolean isFatalQuickDisconnect(long[] recentDurationsMs) {
        if (recentDurationsMs.length < 3) return false;
        for (long d : recentDurationsMs) if (d >= 5000) return false;
        return true;
    }
    // connect(...) socket 壳:用 OkHttp WebSocket;收 Op10→心跳、Op0→分发、断线→backoff 重连。眼验(需真 QQ)。
}
```

> 执行提示:`INTENTS_C2C_AND_INTERACTION` 的确切位以 QQ 官方文档/沙箱实测为准(Hermes 用 `(1<<25)|(1<<30)|(1<<12)|(1<<26)` 含群/频道/私信;v1 单聊只需 C2C + 交互位,**实测**收得到 `C2C_MESSAGE_CREATE` 即对)。`connect` 的 socket 循环无自动化测试,列入 Task 13 mock-WS 集成 + 眼验。

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS(4 tests)

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/qq/QqWsClient.java src/test/java/com/lyhn/wraith/gateway/qq/QqWsClientLogicTest.java
git commit -m "feat(gateway): QqWsClient payload/backoff/quick-disconnect 纯逻辑"
```

---

### Task 12: `gateway` 命令分发 + `bind`(openclaw)+ `GatewayDaemon` 装配

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(+1 分发分支 + starter)
- Create: `src/main/java/com/lyhn/wraith/gateway/bind/Openclaw.java`
- Create: `src/main/java/com/lyhn/wraith/gateway/bind/BindCommand.java`
- Create: `src/main/java/com/lyhn/wraith/gateway/GatewayDaemon.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/bind/OpenclawTest.java`
- Test: `src/test/java/com/lyhn/wraith/cli/MainGatewayDispatchTest.java`

**Interfaces:**
- Consumes: 全部前置任务。
- Produces: `Main.isGatewayCommand(String[])`;`Openclaw.decryptSecret(String b64Cipher, byte[] aesKey) → String`;`Openclaw.createBindTask()/pollBindResult(taskId)`(OkHttp);`GatewayDaemon.start(WraithConfig)`(装配 QqApiClient/WsClient/Router/Driver 并连 WS)。

- [ ] **Step 1: 写失败测试(分发判定 + AES-GCM 解密往返)**

```java
// MainGatewayDispatchTest.java
package com.lyhn.wraith.cli;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class MainGatewayDispatchTest {
    @Test void detectsGatewayCommand() {
        assertTrue(Main.isGatewayCommand(new String[]{"gateway"}));
        assertTrue(Main.isGatewayCommand(new String[]{"gateway","bind"}));
        assertFalse(Main.isGatewayCommand(new String[]{"app-server"}));
        assertFalse(Main.isGatewayCommand(new String[]{}));
    }
}
```

```java
// OpenclawTest.java —— 用同一把 key 现加密再解密,验证 IV|ct|tag 布局解析
package com.lyhn.wraith.gateway.bind;
import org.junit.jupiter.api.Test;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.util.Base64;
import static org.junit.jupiter.api.Assertions.*;

class OpenclawTest {
    @Test void decryptsAesGcm() throws Exception {
        byte[] key = new byte[32]; for (int i=0;i<32;i++) key[i]=(byte)i;
        byte[] iv = new byte[12]; for (int i=0;i<12;i++) iv[i]=(byte)(i+1);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key,"AES"), new GCMParameterSpec(128, iv));
        byte[] ct = c.doFinal("SECRET-XYZ".getBytes("UTF-8"));   // ct 末尾含 16B tag
        byte[] packed = ByteBuffer.allocate(12+ct.length).put(iv).put(ct).array();
        String b64 = Base64.getEncoder().encodeToString(packed);
        assertEquals("SECRET-XYZ", Openclaw.decryptSecret(b64, key));
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — FAIL(方法/类不存在)

- [ ] **Step 3a: `Main` 加分发(在 `isAppServerCommand` 分支之前)**

```java
// 在 main() 里,isAppServerCommand 之前:
if (isGatewayCommand(args)) {
    configureLogging();
    com.lyhn.wraith.gateway.bind.BindCommand.dispatch(args);   // bind → 绑定;否则 → GatewayDaemon.start
    return;
}
```
```java
static boolean isGatewayCommand(String[] args) {
    return args != null && args.length >= 1 && "gateway".equalsIgnoreCase(args[0]);
}
```

- [ ] **Step 3b: `Openclaw`(create/poll + 解密)**

```java
package com.lyhn.wraith.gateway.bind;

import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.Base64;

public final class Openclaw {
    private static final MediaType JSON = MediaType.get("application/json");
    private static final String PORTAL = "https://q.qq.com";
    private final OkHttpClient http; private final ObjectMapper M = new ObjectMapper();
    public Openclaw(OkHttpClient http) { this.http = http; }

    public static String decryptSecret(String b64Cipher, byte[] aesKey) throws Exception {
        byte[] all = Base64.getDecoder().decode(b64Cipher);
        ByteBuffer bb = ByteBuffer.wrap(all);
        byte[] iv = new byte[12]; bb.get(iv);
        byte[] rest = new byte[all.length - 12]; bb.get(rest);      // ct + 16B tag
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(aesKey, "AES"), new GCMParameterSpec(128, iv));
        return new String(c.doFinal(rest), "UTF-8");
    }

    public String createBindTask(String base64Key) throws IOException {
        String body = M.writeValueAsString(java.util.Map.of("key", base64Key));
        try (Response r = http.newCall(new Request.Builder().url(PORTAL + "/lite/create_bind_task")
                .post(RequestBody.create(body, JSON)).header("Accept","application/json").build()).execute()) {
            var d = M.readTree(r.body().string());
            if (d.path("retcode").asInt(-1) != 0) throw new IOException(d.path("msg").asText());
            return d.path("data").path("task_id").asText();
        }
    }
    /** 返回 [status, bot_appid, bot_encrypt_secret, user_openid];status:1 PENDING/2 COMPLETED/3 EXPIRED */
    public String[] pollBindResult(String taskId) throws IOException {
        String body = M.writeValueAsString(java.util.Map.of("task_id", taskId));
        try (Response r = http.newCall(new Request.Builder().url(PORTAL + "/lite/poll_bind_result")
                .post(RequestBody.create(body, JSON)).header("Accept","application/json").build()).execute()) {
            var d = M.readTree(r.body().string()).path("data");
            return new String[]{ d.path("status").asText("0"), d.path("bot_appid").asText(""),
                    d.path("bot_encrypt_secret").asText(""), d.path("user_openid").asText("") };
        }
    }
}
```

- [ ] **Step 3c: `BindCommand` + `GatewayDaemon`(装配)**

```java
// BindCommand.dispatch(args):args[1]=="bind" → 跑 Openclaw 扫码流程,写 config.gateway.qq;否则 GatewayDaemon.start(load())
// GatewayDaemon.start(cfg):
//   QqApiClient api = new QqApiClient(qq.appId, qq.clientSecret, "https://api.sgroup.qq.com",
//                                     "https://bots.qq.com/app/getAppAccessToken", new OkHttpClient());
//   Authorizer authz = new Authorizer(qq.ownerOpenid);
//   ExecutorService pool = Executors.newCachedThreadPool();
//   SessionRouter router = new SessionRouter(gatewaySessionsPath(),
//       openid -> new GatewaySession(openid, qq.workspace, LlmClientFactory.createFromConfig(cfg),
//                    sessKey -> api.sendC2C(openid, "⚠️ 需要审批(点按钮):", lastMsgId) + 附 keyboard));
//   ImTurnDriver driver = new ImTurnDriver(router, api::sendC2C, pool);
//   QqWsClient ws = new QqWsClient(api);
//   ws.connect(
//       inbound -> { if (authz.isAllowed(inbound.openid()) && !dedup.seen(inbound.msgId())) driver.onMessage(inbound); },
//       (interactionId, buttonData) -> {
//           api.ackInteraction(interactionId);
//           var cb = QqApproval.parse(buttonData);
//           if (cb != null) driver.onApproval(cb.sessionKey(), cb.result());
//       });
//   // 阻塞主线程直到进程被杀
```

> 执行提示:审批按钮的实际发送要带 `keyboard`(用 `QqApproval.keyboardJson`)——给 `QqApiClient` 加一个 `sendC2CWithKeyboard(openid, text, replyTo, keyboardJson)` 重载(与 `sendC2C` 同构,body 里多塞 `"keyboard"`),`approvalPusher` 调它。`lastMsgId` 由 adapter 维护(每条入站更新)。`GatewayDaemon.start` 的 WS 主循环是眼验路径。

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=MainGatewayDispatchTest,OpenclawTest`
Expected: PASS

- [ ] **Step 5: 提交(提交前跑密钥扫描)**

```bash
git add -A src/main/java/com/lyhn/wraith/gateway src/main/java/com/lyhn/wraith/cli/Main.java src/test/java/com/lyhn/wraith/gateway src/test/java/com/lyhn/wraith/cli/MainGatewayDispatchTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "(only benign field-name refs)"
git commit -m "feat(gateway): gateway 命令分发 + openclaw 绑定 + GatewayDaemon 装配"
```

---

### Task 13: 集成测试(mock QQ WS 端到端)+ 全量门禁

**Files:**
- Test: `src/test/java/com/lyhn/wraith/gateway/GatewayIntegrationTest.java`

**Interfaces:**
- Consumes: 全部;MockWebServer(WebSocket + HTTP)。

- [ ] **Step 1: 写集成测试**

```java
package com.lyhn.wraith.gateway;
// 用 MockWebServer 起一个 WebSocket:握手后推一条 C2C_MESSAGE_CREATE(op:0,t:"C2C_MESSAGE_CREATE",d:{...}),
// 断言:driver 收到 → (stub 会话回 "pong")→ 向 mock 的 /v2/users/{openid}/messages 发出带 msg_id 的 body。
// 再推一条 INTERACTION_CREATE(button_data="approve:O1:allow-once"),断言:PUT /interactions/{id} 被调用、
// 且挂起的审批被 resolve 为 APPROVED。
// (装配用 stub LlmClient / fake GatewaySession,聚焦 WS→driver→api 这条线。)
```

> 执行提示:此测试覆盖 WS 事件→分发→回发/审批的接线;真 QQ 网关握手仍属眼验。用 `MockWebServer` 的 `webSocket` 支持,或对 `QqWsClient.connect` 注入一个可编程的 `WebSocket` 工厂以便无网络驱动事件。

- [ ] **Step 2: 跑集成测试** — `mvn test -DskipTests=false -Dtest=GatewayIntegrationTest` → PASS

- [ ] **Step 3: 全量门禁**

Run: `mvn test -DskipTests=false`
Expected: **BUILD SUCCESS**,0 Failures / 0 Errors(gateway 新增测试全绿,存量不回归)

- [ ] **Step 4: 提交**

```bash
git add src/test/java/com/lyhn/wraith/gateway/GatewayIntegrationTest.java
git commit -m "test(gateway): mock QQ WS 端到端集成 + 全量门禁绿"
```

- [ ] **Step 5: 眼验(需真 QQ,见 spec §10 三闸)**

绑定真 bot → `wraith gateway` → 沙箱 QQ 私聊 → 收到回复;触发危险操作 → QQ 弹按钮,拒绝不执行/批准才执行;非白名单 openid 静默丢;断网重连仍能对话。

---

## Self-Review

**1. Spec coverage:** §2.1 八点全部落到任务:①daemon=T12;②bind=T12;③QQ C2C WS/REST=T5/T11/T12;④authz+去重=T2/T4;⑤会话映射=T9;⑥回合驱动回发=T10;⑦HITL-over-单聊=T6/T7/T10;⑧红绿=各任务+T13。§6 安全模型=T2(deny-all)+T7/T6(HITL)+全局红线。§7 错误处理=T5(token)/T11(backoff/quick-disc)/T4(去重)/T10(turn 失败)。§8 配置=T1。§10 验证闸=T13 Step 5 眼验。

**2. Placeholder scan:** 无 "TODO/TBD"。socket 壳(T11)、`GatewayDaemon` 主循环(T12)、集成测试骨架(T13)标注为眼验/需真 QQ,并给了确切装配代码与判据——非占位,是不可自动化的真实边界。

**3. Type consistency:** `sendC2C(openid,text,replyToMsgId)`(T5)= `ImTurnDriver.Sender.send`(T10)同签名;`GatewayRenderer.resolveApproval(ApprovalResult)`(T7)由 `ImTurnDriver.onApproval`(T10)经 `session.renderer()`(T8)调用一致;`QqApproval.parse→Callback{sessionKey,result}`(T6)喂 `onApproval(sessionKey,result)`(T10)一致;`ApprovalResult.Decision`(现有)在 T6/T7 用法一致。

---

**执行前置**:spec §10 三条现场验证(个人测试级 bot C2C 单聊 / 沙箱收发 / openclaw 端点——后者已探活)须先过。
