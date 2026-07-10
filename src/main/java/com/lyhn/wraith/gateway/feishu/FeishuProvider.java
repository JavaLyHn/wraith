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
import com.fasterxml.jackson.databind.ObjectMapper;
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
            public void handle(P2MessageReceiveV1 event) throws Exception {
                var ev = event.getEvent();
                if (ev == null) return;
                try {
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
                            if (!dedup.seen(msg.msgId())) {
                                sendReaction(rest, msg.msgId(), REACTION_ACK); // 「已收到,处理中」即时回执
                                driver.onMessage(msg);
                            }
                        }
                    }
                } catch (Exception e) {
                    System.err.println("[gateway] 飞书消息处理异常: " + e.getClass().getSimpleName());
                }
            }
        };

        // 卡片 handler:提取 value → FeishuApproval.parse → scheduled(pendingApprovals) 或 IM-session
        P2CardActionTriggerHandler cardHandler = new P2CardActionTriggerHandler() {
            @Override
            public P2CardActionTriggerResponse handle(P2CardActionTrigger event) throws Exception {
                var ev = event.getEvent();
                if (ev == null) return null;
                try {
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
                } catch (Exception e) {
                    System.err.println("[gateway] 飞书卡片处理异常: " + e.getClass().getSimpleName());
                    return null;
                }
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
            System.out.println("WRAITH_GATEWAY_STATUS running");
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

    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(FeishuProvider.class);

    private static final ObjectMapper JSON = new ObjectMapper();

    /**
     * 文本消息 content 必须是一段 JSON 字符串 {@code {"text":"..."}}。
     * ⚠ 不能用 SDK 的 {@code MessageText.newBuilder().text(t).build()}——它是裸 StringBuilder 拼接,
     * 不转义换行/引号/反斜杠,含这些字符的答案会拼出坏 JSON,飞书回 code=230001
     * "content is not a string in json format" 并静默丢弃(用户收不到回复)。这里用 Jackson 保证转义。
     */
    static String textContentJson(String text) {
        try {
            return JSON.writeValueAsString(java.util.Collections.singletonMap("text", text == null ? "" : text));
        } catch (Exception e) {
            return "{\"text\":\"\"}";
        }
    }

    private static void sendText(com.lark.oapi.Client rest, String openId, String text) {
        try {
            com.lark.oapi.service.im.v1.model.CreateMessageResp resp =
                    rest.im().v1().message().create(CreateMessageReq.newBuilder()
                            .receiveIdType("open_id")
                            .createMessageReqBody(CreateMessageReqBody.newBuilder()
                                    .receiveId(openId)
                                    .msgType("text")
                                    .content(textContentJson(text))
                                    .build())
                            .build());
            if (resp == null || !resp.success()) {
                log.warn("[gateway] 飞书文本发送失败: code={} msg={} openId={}",
                        resp == null ? -1 : resp.getCode(), resp == null ? "null-resp" : resp.getMsg(), openId);
            }
        } catch (Exception e) {
            log.warn("[gateway] 飞书文本发送异常: {}", e.toString());
        }
    }

    private static void sendCard(com.lark.oapi.Client rest, String openId, String cardJson) {
        try {
            com.lark.oapi.service.im.v1.model.CreateMessageResp resp =
                    rest.im().v1().message().create(CreateMessageReq.newBuilder()
                            .receiveIdType("open_id")
                            .createMessageReqBody(CreateMessageReqBody.newBuilder()
                                    .receiveId(openId)
                                    .msgType("interactive")
                                    .content(cardJson)
                                    .build())
                            .build());
            if (resp == null || !resp.success()) {
                log.warn("[gateway] 飞书卡片发送失败: code={} msg={} openId={}",
                        resp == null ? -1 : resp.getCode(), resp == null ? "null-resp" : resp.getMsg(), openId);
            }
        } catch (Exception e) {
            log.warn("[gateway] 飞书卡片发送异常: {}", e.toString());
        }
    }

    /** 「已收到,处理中」回执用的表情 emoji_type。Get = 飞书「[了解]」表情(黄底 GET 徽标);
     *  ⚠ emoji_type 区分大小写,全大写 GET 会被 code=231001 reaction type is invalid 拒。 */
    private static final String REACTION_ACK = "Get";

    /**
     * 给指定消息贴表情回复(reaction),作为「已收到、正在处理」的即时回执。
     * 失败仅日志、绝不阻塞正文回复;需应用具备 im:message 读写域,缺权限会回非 0 code。
     */
    private static void sendReaction(com.lark.oapi.Client rest, String messageId, String emojiType) {
        if (messageId == null || messageId.isBlank()) return;
        try {
            com.lark.oapi.service.im.v1.model.CreateMessageReactionResp resp =
                    rest.im().v1().messageReaction().create(
                            com.lark.oapi.service.im.v1.model.CreateMessageReactionReq.newBuilder()
                                    .messageId(messageId)
                                    .createMessageReactionReqBody(
                                            com.lark.oapi.service.im.v1.model.CreateMessageReactionReqBody.newBuilder()
                                                    .reactionType(com.lark.oapi.service.im.v1.model.Emoji.newBuilder()
                                                            .emojiType(emojiType).build())
                                                    .build())
                                    .build());
            if (resp == null || !resp.success()) {
                log.warn("[gateway] 飞书表情回执失败: code={} msg={} messageId={}",
                        resp == null ? -1 : resp.getCode(), resp == null ? "null-resp" : resp.getMsg(), messageId);
            }
        } catch (Exception e) {
            log.warn("[gateway] 飞书表情回执异常: {}", e.toString());
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
