# 企业微信网关 Phase B 实现计划(HITL 卡片 + cron 投递 + 配置 RPC)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 执行。步骤用 `- [ ]`。
> **前置**:Phase A(feat/im-wecom-gateway,HEAD 1de4afb)已完成——单聊对话闭环 + 状态灯。本计划在其上扩展。
> **建议**:执行本计划前最好先真机眼验 Phase A;Phase B 的主动推送(chatid)与卡片事件带真机不确定性,眼验可提前暴露。

**Goal:** 企微 provider 支持 HITL 审批交互卡片(按钮同意/拒绝)+ 定时任务(cron)结果投递给主人 + 桌面/AppServer 配置读写(platform=wecom),达到与 QQ/飞书 provider 功能对齐。

**Architecture:** 扩展 Phase A 的 `WecomFrames`/`WecomWsClient`/`WecomProvider`;新增 `WecomApproval`(button_interaction 卡片构造 + 事件解析)与 `WecomDeliveryAdapter`(cron 投递);AppServer 加 wecom 配置分支。主动推送用 `aibot_send_msg`(目标 chatid),故 provider 需从入站捕获并记住主人的最近 chatid。

**Tech Stack:** Java 17,okhttp3,Jackson,JUnit5。协议真相源:企微 Node SDK 类型定义。

## Global Constraints

- 密钥红线:`secret` 只存 config,绝不进日志/RPC/renderer;AppServer wecom 视图**只报 hasSecret,不回 secret 明文**。
- 协议(Node SDK 钉死):
  - 卡片:`{card_type:"button_interaction", main_title:{title,desc}, task_id:<sessionKey>, button_list:[{text,style,key}]}`。style:1=主要,2=警示(危险)。
  - 按钮点击:`aibot_event_callback`,`body.msgtype="event"`,`body.event.eventtype="template_card_event"`,`body.event.event_key`=按钮 key,`body.event.task_id`=卡片 task_id,`body.from.userid`=操作者。
  - in-turn 卡片回复:`aibot_respond_msg`,`body.msgtype="template_card"`,`body.template_card`=卡片对象,复用入站 req_id。
  - 主动推送:`aibot_send_msg`,`body` 含目标 `chatid` + `msgtype`(markdown/template_card)。需用户先给 bot 发过消息。
- 主人绑定/授权沿用 Phase A 的 `Authorizer`(owner=userid);卡片事件也须 `authz.isAllowed(operator)` 方受理(deny-all)。
- 会话键约定:`event_key ∈ {approve_once, approve_always, deny}`;`task_id`=sessionKey(定时审批为 approvalId `runId#N`,IM 会话审批为 GatewaySession 的 sessKey)。
- 每任务跑覆盖测试;提交前红线扫描 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。

---

### Task 1: WecomFrames 扩展(chatid + 事件解析 + 卡片/主动推送帧)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/gateway/wecom/WecomFrames.java`
- Modify: `src/test/java/com/lyhn/wraith/gateway/wecom/WecomFramesTest.java`

**先读现有 `WecomFrames.java` 全文**(Phase A 版)再改。保持既有方法不变,新增以下:

**Interfaces(新增/改):**
- 在 `record Inbound` 增字段 `chatId`:`record Inbound(String reqId, String userid, String chatType, String chatId, String msgType, String msgId, String text)`。`parseCallback` 补 `body.chatid` 提取。**注意**:此签名变更会影响 Phase A 的 `WecomInbound`(其构造 Inbound 处)与相关测试——本任务需同步修正 `WecomInbound.classify` 里对 Inbound 的字段读取不受影响(它只读 userid/chatType/msgType/text/reqId),但**测试里 `new WecomFrames.Inbound(...)` 的构造调用要补 chatId 参数**(WecomInboundTest / WecomWsClientLogicTest 若直接构造 Inbound 需补参)。
- `record CardEvent(String eventKey, String taskId, String operatorUserid)`
- `static CardEvent parseCardEvent(String json)` — 非 `aibot_event_callback` 或 event.eventtype != template_card_event → null。
- `static String respondCardFrame(String reqId, String cardJson)` — `aibot_respond_msg`,msgtype=template_card,template_card=<解析 cardJson 为对象嵌入>。
- `static String sendMarkdownFrame(String chatId, String content)` — `aibot_send_msg`,body{chatid,msgtype:markdown,markdown:{content}}。
- `static String sendCardFrame(String chatId, String cardJson)` — `aibot_send_msg`,body{chatid,msgtype:template_card,template_card:<对象>}。
- 需要 reqId 的帧(respond*)由调用方传 reqId;send*(主动推送)自带新 reqId(用 `java.util.UUID.randomUUID().toString()`)。

> cardJson 以字符串传入(由 WecomApproval 生成),嵌入帧时用 `M.readTree(cardJson)` 转为 JsonNode 再 set 进 body.template_card,保证是对象而非字符串。

- [ ] **Step 1: 追加失败测试**(在 WecomFramesTest 末尾加):

```java
    @Test
    void parseCallbackExtractsChatId() {
        String json = "{\"cmd\":\"aibot_msg_callback\",\"headers\":{\"req_id\":\"R\"},"
            + "\"body\":{\"msgid\":\"M\",\"chatid\":\"C1\",\"chattype\":\"single\","
            + "\"from\":{\"userid\":\"U\"},\"msgtype\":\"text\",\"text\":{\"content\":\"hi\"}}}";
        WecomFrames.Inbound in = WecomFrames.parseCallback(json);
        assertEquals("C1", in.chatId());
    }

    @Test
    void parseCardEventExtractsKeyTaskOperator() {
        String json = "{\"cmd\":\"aibot_event_callback\",\"headers\":{\"req_id\":\"R\"},"
            + "\"body\":{\"msgtype\":\"event\",\"from\":{\"userid\":\"OP\"},"
            + "\"event\":{\"eventtype\":\"template_card_event\",\"event_key\":\"approve_once\",\"task_id\":\"S1\"}}}";
        WecomFrames.CardEvent ev = WecomFrames.parseCardEvent(json);
        assertNotNull(ev);
        assertEquals("approve_once", ev.eventKey());
        assertEquals("S1", ev.taskId());
        assertEquals("OP", ev.operatorUserid());
    }

    @Test
    void parseCardEventNonEventReturnsNull() {
        assertNull(WecomFrames.parseCardEvent("{\"cmd\":\"aibot_msg_callback\",\"headers\":{\"req_id\":\"R\"}}"));
        assertNull(WecomFrames.parseCardEvent("not json"));
        assertNull(WecomFrames.parseCardEvent(null));
    }

    @Test
    void respondCardFrameEmbedsCardObjectReusingReqId() throws Exception {
        String card = "{\"card_type\":\"button_interaction\",\"task_id\":\"S1\"}";
        JsonNode n = M.readTree(WecomFrames.respondCardFrame("rX", card));
        assertEquals("aibot_respond_msg", n.get("cmd").asText());
        assertEquals("rX", n.path("headers").path("req_id").asText());
        assertEquals("template_card", n.path("body").path("msgtype").asText());
        assertEquals("button_interaction", n.path("body").path("template_card").path("card_type").asText());
    }

    @Test
    void sendMarkdownFrameTargetsChatId() throws Exception {
        JsonNode n = M.readTree(WecomFrames.sendMarkdownFrame("C9", "文本"));
        assertEquals("aibot_send_msg", n.get("cmd").asText());
        assertEquals("C9", n.path("body").path("chatid").asText());
        assertEquals("markdown", n.path("body").path("msgtype").asText());
        assertEquals("文本", n.path("body").path("markdown").path("content").asText());
        assertFalse(n.path("headers").path("req_id").asText().isEmpty());
    }

    @Test
    void sendCardFrameTargetsChatIdEmbedsCard() throws Exception {
        String card = "{\"card_type\":\"button_interaction\"}";
        JsonNode n = M.readTree(WecomFrames.sendCardFrame("C9", card));
        assertEquals("aibot_send_msg", n.get("cmd").asText());
        assertEquals("C9", n.path("body").path("chatid").asText());
        assertEquals("template_card", n.path("body").path("msgtype").asText());
        assertEquals("button_interaction", n.path("body").path("template_card").path("card_type").asText());
    }
```

- [ ] **Step 2: 跑确认失败** — `mvn -q -DskipTests=false -Dtest=WecomFramesTest test`(编译失败或新用例红)。

- [ ] **Step 3: 改 WecomFrames**

- Inbound record 增 `chatId`(在 chatType 后、msgType 前):
  `public record Inbound(String reqId, String userid, String chatType, String chatId, String msgType, String msgId, String text) {}`
- `parseCallback` 里增 `String chatId = body.path("chatid").asText(null);` 并传入 new Inbound。
- 新增(全部用 Jackson 构造,与既有 write() 兜底一致):

```java
    public record CardEvent(String eventKey, String taskId, String operatorUserid) {}

    public static CardEvent parseCardEvent(String json) {
        if (json == null) return null;
        try {
            JsonNode n = M.readTree(json);
            if (!"aibot_event_callback".equals(n.path("cmd").asText())) return null;
            JsonNode ev = n.path("body").path("event");
            if (!"template_card_event".equals(ev.path("eventtype").asText())) return null;
            return new CardEvent(
                    ev.path("event_key").asText(null),
                    ev.path("task_id").asText(null),
                    n.path("body").path("from").path("userid").asText(null));
        } catch (Exception e) {
            return null;
        }
    }

    public static String respondCardFrame(String reqId, String cardJson) {
        ObjectNode root = M.createObjectNode();
        root.put("cmd", "aibot_respond_msg");
        root.putObject("headers").put("req_id", reqId);
        ObjectNode body = root.putObject("body");
        body.put("msgtype", "template_card");
        body.set("template_card", cardNode(cardJson));
        return write(root, "{}");
    }

    public static String sendMarkdownFrame(String chatId, String content) {
        ObjectNode root = M.createObjectNode();
        root.put("cmd", "aibot_send_msg");
        root.putObject("headers").put("req_id", java.util.UUID.randomUUID().toString());
        ObjectNode body = root.putObject("body");
        body.put("chatid", chatId);
        body.put("msgtype", "markdown");
        body.putObject("markdown").put("content", content == null ? "" : content);
        return write(root, "{}");
    }

    public static String sendCardFrame(String chatId, String cardJson) {
        ObjectNode root = M.createObjectNode();
        root.put("cmd", "aibot_send_msg");
        root.putObject("headers").put("req_id", java.util.UUID.randomUUID().toString());
        ObjectNode body = root.putObject("body");
        body.put("chatid", chatId);
        body.put("msgtype", "template_card");
        body.set("template_card", cardNode(cardJson));
        return write(root, "{}");
    }

    /** 把卡片 JSON 串解析为对象节点嵌入帧;失败则空对象。 */
    private static JsonNode cardNode(String cardJson) {
        try {
            return M.readTree(cardJson == null ? "{}" : cardJson);
        } catch (Exception e) {
            return M.createObjectNode();
        }
    }
```

- [ ] **Step 4: 同步修 Inbound 构造点** — 因 Inbound 增了 chatId 参数,修 `WecomInbound.classify`(其 `new InboundMsg(...)` 不受影响,但它读 `f.chatType()` 等不变;确认编译)。再修**测试**里直接 `new WecomFrames.Inbound(...)` 的构造(`WecomInboundTest` 的 helper `f(...)`、`WecomWsClientLogicTest` 若有)——补 chatId 实参(可传 `"C1"`)。跑受影响测试类确认全绿。

- [ ] **Step 5: 跑全部企微 frames/inbound/wsclient 测试确认通过**
Run: `mvn -DskipTests=false -Dtest='WecomFramesTest,WecomInboundTest,WecomWsClientLogicTest' test`
Expected: 全绿(FramesTest 新增 6 → 13;Inbound 7;WsClientLogic 5)。

- [ ] **Step 6: Commit**
```bash
git add src/main/java/com/lyhn/wraith/gateway/wecom/WecomFrames.java src/test/java/com/lyhn/wraith/gateway/wecom/WecomFramesTest.java src/test/java/com/lyhn/wraith/gateway/wecom/WecomInboundTest.java src/test/java/com/lyhn/wraith/gateway/wecom/WecomWsClientLogicTest.java
git commit -m "feat(gateway/wecom): WecomFrames 加 chatid/事件解析/卡片与主动推送帧"
```

---

### Task 2: WecomApproval(HITL 卡片构造 + 事件解析)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/gateway/wecom/WecomApproval.java`
- Test: `src/test/java/com/lyhn/wraith/gateway/wecom/WecomApprovalTest.java`

**Interfaces(复刻 FeishuApproval 语义):**
- Consumes:`WecomFrames.CardEvent`、`com.lyhn.wraith.hitl.ApprovalResult`(有 `approve()/approveAll()/reject(String)`,`isApproved()/isApprovedAll()`)
- Produces:
  - `record Callback(String sessionKey, ApprovalResult result)`
  - `static String cardJson(String sessionKey, String promptText)` — button_interaction 卡片(三按钮:approve_once/approve_always/deny;task_id=sessionKey)
  - `static Callback parse(WecomFrames.CardEvent ev)` — event_key→ApprovalResult,taskId→sessionKey;非法→null

先读 `src/main/java/com/lyhn/wraith/gateway/feishu/FeishuApproval.java` 对齐 ApprovalResult 用法与 ObjectMapper 风格。

- [ ] **Step 1: 写失败测试 `WecomApprovalTest`**
```java
package com.lyhn.wraith.gateway.wecom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WecomApprovalTest {
    private static final ObjectMapper M = new ObjectMapper();

    @Test
    void cardJsonIsButtonInteractionWithSessionKeyAndThreeButtons() throws Exception {
        JsonNode c = M.readTree(WecomApproval.cardJson("S1", "需要审批:shell"));
        assertEquals("button_interaction", c.path("card_type").asText());
        assertEquals("S1", c.path("task_id").asText());
        JsonNode btns = c.path("button_list");
        assertEquals(3, btns.size());
        // 收集 key
        java.util.Set<String> keys = new java.util.HashSet<>();
        btns.forEach(b -> keys.add(b.path("key").asText()));
        assertTrue(keys.containsAll(java.util.Set.of("approve_once", "approve_always", "deny")));
    }

    @Test
    void parseApproveOnce() {
        var cb = WecomApproval.parse(new WecomFrames.CardEvent("approve_once", "S1", "OP"));
        assertNotNull(cb);
        assertEquals("S1", cb.sessionKey());
        assertTrue(cb.result().isApproved());
        assertFalse(cb.result().isApprovedAll());
    }

    @Test
    void parseApproveAlways() {
        var cb = WecomApproval.parse(new WecomFrames.CardEvent("approve_always", "S1", "OP"));
        assertTrue(cb.result().isApprovedAll());
    }

    @Test
    void parseDeny() {
        var cb = WecomApproval.parse(new WecomFrames.CardEvent("deny", "S1", "OP"));
        assertFalse(cb.result().isApproved());
    }

    @Test
    void parseUnknownOrMissingReturnsNull() {
        assertNull(WecomApproval.parse(new WecomFrames.CardEvent("bogus", "S1", "OP")));
        assertNull(WecomApproval.parse(new WecomFrames.CardEvent("approve_once", "", "OP")));
        assertNull(WecomApproval.parse(null));
    }
}
```

- [ ] **Step 2: 跑确认失败** — `mvn -q -DskipTests=false -Dtest=WecomApprovalTest test`。

- [ ] **Step 3: 写 `WecomApproval`**
```java
package com.lyhn.wraith.gateway.wecom;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.lyhn.wraith.hitl.ApprovalResult;

/**
 * 企微 HITL:构造 button_interaction 审批卡(批准一次 / 总是允许 / 拒绝)+ 解析按钮点击事件。
 * 按钮 key ∈ {approve_once, approve_always, deny};卡片 task_id 承载 sessionKey。
 * 事件经 aibot_event_callback(template_card_event)送达(见 WecomProvider)。
 */
public final class WecomApproval {

    private static final ObjectMapper M = new ObjectMapper();

    private WecomApproval() {}

    public record Callback(String sessionKey, ApprovalResult result) {}

    public static String cardJson(String sessionKey, String promptText) {
        ObjectNode card = M.createObjectNode();
        card.put("card_type", "button_interaction");
        ObjectNode mainTitle = card.putObject("main_title");
        mainTitle.put("title", "需要审批");
        mainTitle.put("desc", promptText == null ? "" : promptText);
        card.put("task_id", sessionKey);
        ArrayNode buttons = card.putArray("button_list");
        buttons.add(button("✅ 批准一次", 1, "approve_once"));
        buttons.add(button("✅ 总是允许", 1, "approve_always"));
        buttons.add(button("⛔ 拒绝", 2, "deny"));
        try {
            return M.writeValueAsString(card);
        } catch (Exception e) {
            return "{\"card_type\":\"button_interaction\",\"task_id\":\"" + "\"}";
        }
    }

    private static ObjectNode button(String text, int style, String key) {
        ObjectNode b = M.createObjectNode();
        b.put("text", text);
        b.put("style", style);
        b.put("key", key);
        return b;
    }

    public static Callback parse(WecomFrames.CardEvent ev) {
        if (ev == null) return null;
        String s = ev.taskId();
        if (s == null || s.isEmpty()) return null;
        ApprovalResult r;
        switch (ev.eventKey() == null ? "" : ev.eventKey()) {
            case "approve_once" -> r = ApprovalResult.approve();
            case "approve_always" -> r = ApprovalResult.approveAll();
            case "deny" -> r = ApprovalResult.reject("用户在企微拒绝");
            default -> { return null; }
        }
        return new Callback(s, r);
    }
}
```
> 兜底串里 task_id 用空占位即可;正常路径不会走兜底(ObjectNode 序列化不失败)。若嫌兜底串难看,可直接 `return "{\"card_type\":\"button_interaction\"}";`。

- [ ] **Step 4: 跑确认通过** — `mvn -q -DskipTests=false -Dtest=WecomApprovalTest test`,预期 5/5。

- [ ] **Step 5: Commit**
```bash
git add src/main/java/com/lyhn/wraith/gateway/wecom/WecomApproval.java src/test/java/com/lyhn/wraith/gateway/wecom/WecomApprovalTest.java
git commit -m "feat(gateway/wecom): WecomApproval button_interaction 审批卡 + 事件解析 + 单测"
```

---

### Task 3: WecomWsClient 扩展(事件回调 + 卡片回复 + 主动推送)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/gateway/wecom/WecomWsClient.java`
- Modify: `src/test/java/com/lyhn/wraith/gateway/wecom/WecomWsClientLogicTest.java`

**先读现有 `WecomWsClient.java` 全文**再改。新增:
- 回调接口 `interface OnEvent { void onEvent(WecomFrames.CardEvent ev); }`。
- `connect(OnInbound, OnStatus, OnEvent)` 三参重载(旧两参重载保留,委托三参传 `ev -> {}`);`handleFrame` 增第四参 OnEvent。
- `handleFrame` 分发增:`WecomFrames.parseCardEvent(text)` 命中 → `onEvent.onEvent(ev)`(在 callback 判定之后、inbound 之前或之后均可,注意 event 与 msg_callback cmd 不同,互斥)。
- `respondCard(String reqId, String cardJson)` → `ws.send(WecomFrames.respondCardFrame(reqId, cardJson))`。
- `sendMarkdown(String chatId, String content)` → `ws.send(WecomFrames.sendMarkdownFrame(chatId, content))`(主动推送)。
- `sendCard(String chatId, String cardJson)` → `ws.send(WecomFrames.sendCardFrame(chatId, cardJson))`(主动推送)。

- [ ] **Step 1: 追加失败测试**(WecomWsClientLogicTest):
```java
    @Test
    void handleFrameDispatchesCardEventToOnEvent() {
        java.util.List<WecomFrames.CardEvent> got = new java.util.ArrayList<>();
        String ev = "{\"cmd\":\"aibot_event_callback\",\"headers\":{\"req_id\":\"R\"},"
            + "\"body\":{\"msgtype\":\"event\",\"from\":{\"userid\":\"OP\"},"
            + "\"event\":{\"eventtype\":\"template_card_event\",\"event_key\":\"deny\",\"task_id\":\"S1\"}}}";
        client().handleFrame(ev, m -> {}, t -> {}, got::add);
        assertEquals(1, got.size());
        assertEquals("deny", got.get(0).eventKey());
        assertEquals("S1", got.get(0).taskId());
    }
```
> 说明:测试用四参 `handleFrame(text, onInbound, onStatus, onEvent)`。既有三参调用点若存在,改为四参并传 `ev->{}`;或保留三参重载委托四参。以能编译 + 既有 5 测试仍绿为准。

- [ ] **Step 2: 跑确认失败**。

- [ ] **Step 3: 改 WecomWsClient**(要点)
- 增 `public interface OnEvent { void onEvent(WecomFrames.CardEvent ev); }`。
- 保留 `connect(OnInbound,OnStatus)` → 委托 `connect(onInbound,onStatus, ev->{})`。
- 新 `connect(OnInbound,OnStatus,OnEvent)`:与原实现相同,只是 onMessage 回调里 `handleFrame(text, onInbound, onStatus, onEvent)`。
- `handleFrame` 改四参:先 parseSubscribeResult(不变);再 `WecomFrames.CardEvent ce = WecomFrames.parseCardEvent(text); if (ce != null) { onEvent.onEvent(ce); return; }`;再 parseCallback(不变)。
- 新增三个发送方法(用现有 `this.ws` 字段与 null 守护,与 respondMarkdown 同款):respondCard/sendMarkdown/sendCard。

- [ ] **Step 4: 跑确认通过** — `mvn -q -DskipTests=false -Dtest=WecomWsClientLogicTest test`,预期 6/6(原 5 + 新 1)。

- [ ] **Step 5: Commit**
```bash
git add src/main/java/com/lyhn/wraith/gateway/wecom/WecomWsClient.java src/test/java/com/lyhn/wraith/gateway/wecom/WecomWsClientLogicTest.java
git commit -m "feat(gateway/wecom): WecomWsClient 加事件回调 + 卡片回复 + 主动推送发送口"
```

---

### Task 4: WecomProvider 扩展(卡片 HITL 接线 + 主人 chatid 捕获 + 定时审批呈现)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/gateway/wecom/WecomProvider.java`
- Modify: `src/test/java/com/lyhn/wraith/gateway/wecom/WecomProviderTest.java`

**先读现有 `WecomProvider.java` + `FeishuProvider.java`**(飞书的卡片 handler + pendingApprovals + surfaceScheduledApproval 是范式)。改动:

- 生产构造:
  - 新增 `volatile String ownerChatId;`(主人最近 chatid,主动推送用)。
  - onInbound 里 PROCESS/所有来自主人的入站:记录 `if (isOwner) ownerChatId = frame.chatId();`(在 classify 前用 authz.isAllowed(userid) 判 owner;或在 PROCESS 分支记录)。
  - approvalSurface 闭包(原 Phase A no-op)改为:in-turn 无法拿 reqId(审批发生在 turn 执行中,已脱离入站帧)——因此审批卡走**主动推送**到 ownerChatId:`sessKey -> { if (ownerChatId != null) ws.sendCard(ownerChatId, WecomApproval.cardJson(sessKey, "⚠️ 需要审批(点按钮同意/拒绝)")); }`。
  - onEvent 卡片事件 handler:
    ```java
    WecomWsClient.OnEvent onEvent = ce -> {
        if (!authz.isAllowed(ce.operatorUserid())) return; // deny-all
        WecomApproval.Callback cb = WecomApproval.parse(ce);
        if (cb == null) return;
        CompletableFuture<ApprovalResult> f = pendingApprovals.remove(cb.sessionKey());
        if (f != null) {                    // 定时任务审批
            f.complete(cb.result().isApproved() ? ApprovalResult.approve() : ApprovalResult.reject("wecom rejected"));
            return;
        }
        driver.onApproval(cb.sessionKey(), cb.result());  // IM 会话内审批
    };
    ```
    (确认 `ImTurnDriver.onApproval(String sessionKey, ApprovalResult)` 存在——对照 FeishuProvider 的用法;若签名不同以实际为准。)
  - wsLoop 改为 `ws.connect(onInbound, onStatus, onEvent)`(三参)。
- `surfaceScheduledApproval(approvalId, toolName, suggestion)` override(原用接口默认 no-op):
  ```java
  @Override public void surfaceScheduledApproval(String approvalId, String toolName, String suggestion) {
      if (ownerChatId == null) return; // 主人尚未与 bot 建会话,无法主动推送
      ws.sendCard(ownerChatId, WecomApproval.cardJson(approvalId, "⏰ 定时任务需审批:" + toolName));
  }
  ```
- `deliveryAdapter()`:Phase B 返回 `Optional.of(deliver)`(Task 5 的 WecomDeliveryAdapter);构造里建 `this.deliver = new WecomDeliveryAdapter(() -> ownerChatId, (chatId, text) -> ws.sendMarkdown(chatId, text));`(投递目标为主人 chatid,懒取 ownerChatId)。
- 测试构造:增能注入 ownerChatId/deliver 的形态(或保留现有测试构造 + 新增断言 deliveryAdapter 存在)。**注意**:Phase A 的 `deliveryAdapterEmptyInPhaseA` 测试要改为断言 `isPresent()` 且 platform=="wecom"(Phase B 起有投递适配器)。

- [ ] **Step 1: 改测试**(WecomProviderTest):把 `deliveryAdapterEmptyInPhaseA` 改为:
```java
    @Test
    void deliveryAdapterPresentInPhaseB() {
        var opt = provider("U", () -> {}).deliveryAdapter();
        assertTrue(opt.isPresent());
        assertEquals("wecom", opt.get().platform());
    }
```
(测试构造需能构造出带 deliver 的 provider;若现有测试构造不建 deliver,给测试构造补一个默认 WecomDeliveryAdapter,或调整测试构造签名。以能编译 + 表达意图为准。)保留 platformIsWecom / startRunsWsLoopOnDaemonThread。

- [ ] **Step 2: 跑确认失败**。

- [ ] **Step 3: 改 WecomProvider** 按上述要点。**读 FeishuProvider 对齐** pendingApprovals/onApproval/deliver 装配。DeliveryAdapter 平台名返回 "wecom"(见 Task 5)。

- [ ] **Step 4: 跑确认通过** — `mvn -q -DskipTests=false -Dtest=WecomProviderTest test`。

- [ ] **Step 5: Commit**
```bash
git add src/main/java/com/lyhn/wraith/gateway/wecom/WecomProvider.java src/test/java/com/lyhn/wraith/gateway/wecom/WecomProviderTest.java
git commit -m "feat(gateway/wecom): WecomProvider 卡片 HITL + 主人 chatid 捕获 + 定时审批呈现 + 投递适配器"
```

---

### Task 5: WecomDeliveryAdapter(cron 结果投递)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/automation/delivery/WecomDeliveryAdapter.java`
- Test: `src/test/java/com/lyhn/wraith/automation/delivery/WecomDeliveryAdapterTest.java`

**先读 `FeishuDeliveryAdapter.java`** 对齐 `DeliveryAdapter` 接口(方法 `platform()` + `deliver(...)` 签名、DeliveryTarget/RunResult 类型)。

**Interfaces:**
- 构造 `WecomDeliveryAdapter(java.util.function.Supplier<String> ownerChatIdSupplier, java.util.function.BiConsumer<String,String> markdownSink)`。
- `platform()` 返回 `"wecom"`。
- `deliver(...)`:取 `ownerChatIdSupplier.get()`,为空则跳过(记 warn);否则 `markdownSink.accept(chatId, 渲染文本)`,try/catch 守护(DeliveryAdapter 契约)。渲染格式对齐 FeishuDeliveryAdapter(任务名 + 结果)。

- [ ] **Step 1-5**:TDD(测试:ownerChatId 为空跳过、非空时 sink 收到 chatId+文本、sink 抛异常被守护)。实现复刻 FeishuDeliveryAdapter 的 deliver 语义,发送口换成 markdownSink(chatId, text)。commit message:`feat(gateway/wecom): WecomDeliveryAdapter cron 投递(主动推送到主人 chatid)+ 单测`。
> 因 DeliveryAdapter 的确切方法签名依赖既有接口,实现者须以 `FeishuDeliveryAdapter.java` 实际签名为准编写(本任务不臆造签名)。

---

### Task 6: AppServer 配置 RPC(platform=wecom)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(`gateway.config.get` / `gateway.config.set` 加 wecom 分支)
- Test: 若有 AppServer gateway 配置测试则同步;否则新增最小测试或依赖手验。

**先读 AppServer 现有 feishu 分支**(get/set 的 platform 分派 + 视图字段 + 红线注释)。加 wecom 分支:
- `get`:`hasSecret = wecom!=null && wecom.getSecret()!=null && !isBlank`;视图 `{bound:hasSecret, hasSecret, botId, ownerUserid, workspace}`,**不含 secret**。
- `set`:接收 `{botId, secret?, ownerUserid, workspace}`;secret 空则保持已存(不覆盖);写回 config。

- [ ] **Step 1-3**:读现有 feishu 分支照葫芦画瓢加 wecom;编译 + 跑相关测试(若存在 AppServer 测试);红线扫描确认视图不回 secret。commit:`feat(appserver): gateway.config get/set 支持 platform=wecom(视图不含 secret)`。
> 视图字段名(botId/ownerUserid/workspace)与 desktop Phase C 表单对齐;secret 永不回。

---

## Phase B 收尾 / 眼验补充

- 全量企微测试:`mvn -DskipTests=false -Dtest='Wecom*Test' test` 全绿。
- 真机眼验(接 Phase A):① 定时任务触发审批 → 主人企微收到 button_interaction 卡片 → 点「批准/拒绝」→ turn 继续/中止。② cron 任务结果 → 主人收到 markdown 推送。
  - 前提:主人**已给 bot 发过消息**(捕获 ownerChatId);否则主动推送/审批卡无法送达(日志会提示 ownerChatId 为空)。
- opus 整支终审(BASE=Phase A HEAD 1de4afb .. Phase B HEAD),携本阶段 Minor 清单 triage。

## Self-Review 记录

- Spec 覆盖:HITL 卡片(spec 组件 5)、cron 投递(组件 6)、config RPC(组件 8)—— Task 2/4/5/6 覆盖;桌面 UI 归 Phase C。
- 关键新设计:主动推送目标为 **chatid**(非 userid),故 provider 捕获主人 chatid(Task 4)、Inbound 增 chatid(Task 1)。已在 Global Constraints 与 Task 1/4 显式说明。
- 依赖既有签名(ImTurnDriver.onApproval、DeliveryAdapter、ApprovalResult、AppServer feishu 分支)处,均要求实现者**先读实际文件对齐**,不臆造。
- 真机不确定项(主动推送 chatid 行为、卡片事件 event_key/task_id 回传)已标注,建议眼验 Phase A 后再执行 Phase B。
