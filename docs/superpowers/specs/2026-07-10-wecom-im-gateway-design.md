# 企业微信(WeCom)IM 网关接入设计

**日期:** 2026-07-10
**分支:** feat/im-wecom-gateway(基于 feat/im-feishu-gateway,复用 ImProvider SPI + 回复美化)
**状态:** 待用户过目

## 问题 / 目标

wraith 网关已支持 QQ、飞书两个 IM provider。新增**企业微信**作为第三个 provider,对话式**单聊** bot。
用户已拍板:**先只做企业微信**(个人微信/公众号待定),接入走 **智能机器人长连接**。

## 为什么选长连接(已获批)

企微收消息有两种模式,二选一:
- **自建应用回调 URL**:腾讯 POST 加密消息到公网地址(URL+Token+EncodingAESKey)→ 需公网可达 + 内网穿透 + WXBizMsgCrypt 解密。**不选**(破坏本地 daemon 模型)。
- **智能机器人长连接**:WebSocket **出站**长连接(BotID+Secret)→ 像 QQ/飞书那样本地 daemon 直连,**免公网**。**选此**。

## 协议要点(来源:企微官方长连接文档 + 官方 Python/Node SDK)

- **连接**:`wss://openws.work.weixin.qq.com`。
- **订阅**(握手后立即发):
  ```json
  {"cmd":"aibot_subscribe","headers":{"req_id":"<uuid>"},"body":{"bot_id":"<BOTID>","secret":"<SECRET>"}}
  ```
  同一 bot 同时只允许一条有效长连接(新连接踢掉旧的)。
- **心跳**:每 30s 发 `ping`;连续收不到 ack 判定连接异常 → 重连。
- **收消息** `aibot_msg_callback`:
  ```json
  {"cmd":"aibot_msg_callback","headers":{"req_id":"<REQ>"},
   "body":{"msgid":"<MSGID>","aibotid":"<AIBOTID>","chatid":"<CHATID>",
     "chattype":"single|group","from":{"userid":"<加密USERID>"},
     "msgtype":"text","text":{"content":"<用户文本>"}}}
  ```
  长连接模式**文本无需加解密**。`from.userid` 为企业主体下加密 userid(稳定,可作会话 key / 鉴权 / 回发目标)。
- **回消息** `aibot_respond_msg`(**同一条 WS 回发,非 REST**),**headers.req_id 必须复用入站消息的 req_id** 以关联:
  ```json
  {"cmd":"aibot_respond_msg","headers":{"req_id":"<复用入站REQ>"},
   "body":{"msgtype":"markdown","markdown":{"content":"<agent 回复,markdown 原文>"}}}
  ```
  msgtype 支持 markdown(标题/列表/代码块/表格)、template_card、stream、媒体。**企微原生渲染 markdown**。
- **鉴权密钥**:BotID + Secret(长连接专用,与回调模式的 Token/EncodingAESKey 不同;模式二选一,切换使连接失效)。
- **限频**:30 条/分钟、1000 条/小时;普通回复 24h 窗口内可回。

> **实现期第一步需从官方 Python SDK client 源码钉死的细节**(不影响架构):(a)订阅成功/失败的响应帧字段
> (用于状态灯区分 subscribed vs auth-failed);(b)`aibot_respond_msg` markdown body 的精确键名;
> (c)ack 帧格式与串行等待。以官方 SDK 源码为准,如与本 spec 示例不符以源码为准并更新 spec。

## 架构

新增 `WecomProvider implements ImProvider`,与 `QqProvider`/`FeishuProvider` 平级。沿用现有装配:
自带独立 `SessionRouter` / `ImTurnDriver` / `Authorizer` / `Dedup`;会话 key = 裸 userid。
构造不触网;`start()` 把阻塞的 WS 回路放到守护线程。`GatewayDaemon.buildProviders` 已按配置迭代,
新增 wecom 分支即可(与 qq/feishu 同构)。

```
wss 长连接(WecomWsClient, okhttp)
  ├─ 订阅 aibot_subscribe(bot_id+secret)→ 打状态灯
  ├─ 每 30s ping
  └─ 收 aibot_msg_callback
         │  WecomInbound.classify(userid, chattype, msgtype, msgid, content, ownerBound, allowed)
         ▼
      IGNORE / PAIRING_ECHO / NONTEXT_NOTICE / PROCESS
         │  PROCESS: dedup(msgid) → ImTurnDriver.onMessage
         ▼
      runTurn → reply(markdown 原文)
         │  Sender: WecomWsClient.respondMarkdown(reqId, userid, content)
         ▼
      aibot_respond_msg(复用入站 req_id, msgtype=markdown)
```

## 组件(文件)

### 1. `gateway/wecom/WecomWsClient.java`
- okhttp `WebSocket` 封装(项目已依赖 okhttp;`QqWsClient` 为范式)。
- 职责:connect(`wss://openws.work.weixin.qq.com`)→ 发 `aibot_subscribe` → 心跳 30s ping →
  收帧分发(`aibot_msg_callback` → onMessage 回调;订阅响应 → onStatus 回调)→ 发 `aibot_respond_msg`。
- 用 Jackson 收发 JSON(转义交给库)。断线重连(内部循环 + 退避)。
- 纯逻辑部分(帧解析/分类、构造订阅/回复帧)抽成静态方法,可脱网单测(`WecomFrames`)。

### 2. `gateway/wecom/WecomFrames.java`(纯函数,可单测)
- `static String subscribeFrame(botId, secret, reqId)`
- `static String respondMarkdownFrame(reqId, content)`
- `static String pingFrame(reqId)`
- `record Inbound(String reqId, String userid, String chatType, String msgType, String msgId, String text)`
- `static Inbound parseCallback(String json)` — 非 `aibot_msg_callback` / 缺字段 → null。
- `static SubStatus parseSubscribeResp(String json)` — subscribed / auth-failed / unknown(帧字段实现期钉)。

### 3. `gateway/wecom/WecomInbound.java`(纯函数,复刻 FeishuInbound 语义)
- `classify(userid, chatType, msgType, msgId, text, ownerBound, allowed, now)` →
  `{IGNORE, PAIRING_ECHO, NONTEXT_NOTICE, PROCESS}`。
- 仅 `chattype=single` 处理;群聊忽略。非 text → NONTEXT_NOTICE。未绑定主人时给未知发送者 → PAIRING_ECHO(回显 userid)。
  非主人 → IGNORE(fail-closed)。

### 4. `gateway/wecom/WecomProvider.java`(装配)
- 生产构造:建 WecomWsClient + SessionRouter + ImTurnDriver + Authorizer + Dedup,组好阻塞 WS 回路。
- Sender:`(userid, text, replyTo) -> ws.respondMarkdown(reqId, text)`(reqId 由入站帧透传到 driver;
  见下「reqId 透传」)。回复直接透传 agent markdown。
- 测试构造:注入 stub(不触网),复刻 FeishuProviderTest 风格。

### 5. `gateway/wecom/WecomApproval.java`(HITL)
- 构造 `template_card`(approve-once / allow-always / deny 三按钮)+ 解析按钮回调帧。
- 卡片按钮回调帧格式实现期从 SDK 钉死;v1 若回调过重,退化为**文本 HITL**(回一句「回复 y 批准 / n 拒绝」,
  下一条消息解析)——实现期视回调可用性定,spec 更新记录。

### 6. `automation/delivery/WecomDeliveryAdapter.java`
- 复刻 `FeishuDeliveryAdapter`:定时任务结果经主动推送 `aibot_send_msg`(需用户先给 bot 发过消息)投递给主人。

### 7. `config/WraithConfig.java`
- 新增 `GatewayWecomConfig { String botId; String secret; String ownerUserid; String workspace; }` + getter/setter。

### 8. `runtime/appserver/AppServer.java`
- `gateway.config.get/set` 加 `platform=wecom` 分支:视图回 `{bound, hasSecret, botId, ownerUserid, workspace}`,
  **绝不回 secret 明文**。

### 9. 桌面 UI(`desktop/`)
- `imPlatforms.ts` 加企微为 available;`ImGatewayPanel.tsx` 加企微配置表单(BotID / Secret[掩码] /
  主人 userid / 工作目录),照飞书表单那套(hasSecret → `••••••`,空 secret 不下发)。
- `shared/gateway.ts` 视图类型泛化(已有 region? 无需;企微无 region)。
- `gatewayManager.ts` 状态灯:企微 token(subscribed→running / 断连→starting / 鉴权失败→error)并入现有分类器。

## reqId 透传(关键设计)

企微回复必须复用入站 `req_id`。现有 `ImTurnDriver.Sender.send(openid, text, replyToMsgId)` 的
`replyToMsgId` 参数正好承载它:WecomProvider 收帧时把 `req_id` 作为 `replyTo` 传入 driver,
Sender lambda 里 `ws.respondMarkdown(replyTo, text)`。**无需改 ImTurnDriver 接口**(QQ 也用 replyTo 传 msgId)。

## 回复格式

企微原生渲染 markdown → **直接透传 agent 的 markdown 原文**(`msgtype=markdown`)。不需要 QQ 的
`MarkdownLite.toPlainText`,也不需要飞书的 post 转换。系统短文案(配对回显/非文本提示)同样以 markdown 发(纯文本亦是合法 markdown)。

## 主人绑定

fail-closed + 配对回显(与飞书一致):`ownerUserid` 未配 → 任何未知发送者收到自己的 userid 回显供绑定;
已配 → 非主人 IGNORE。userid 为企业加密值,桌面端手填绑定。

## 状态灯协议

daemon 输出 `WRAITH_GATEWAY_STATUS <token>`;企微:`subscribed`(→running)/ `disconnected`(→starting)/
`auth-failed`(→error)。并入 `classifyGatewayStatusLine` 现有分类器(与 QQ/飞书 token 不冲突即可)。

## 密钥红线

botId 尚属标识,`secret` 为敏感密钥:只存 `~/.wraith/config.json`,绝不进日志 / RPC 回包 / renderer。
提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。

## YAGNI(v1 不做)

- 群聊、@人、媒体(image/file/voice/video)收发、流式(stream)刷新 —— 只发最终 markdown 一次。
- 多媒体 aeskey 解密、素材分片上传。
- 微信个人号 / 公众号(本次范围外)。

## 测试

- `WecomFramesTest`:subscribe/respond/ping 帧构造正确;parseCallback 提取字段 / 非法帧→null;
  parseSubscribeResp 分类;含引号/换行的文本经 Jackson 转义后仍合法 JSON。
- `WecomInboundTest`:single/group 过滤、非文本、配对回显、fail-closed 各分支(复刻 FeishuInboundTest)。
- `WecomProviderTest`:platform()=wecom、deliveryAdapter 存在、start() 起守护线程、主人未绑不推送(复刻 FeishuProviderTest)。
- `WecomDeliveryAdapterTest`:投递守 sink、目标为主人 userid。
- 桌面:企微配置 payload(空 secret 省略)+ 状态灯分类用例。

## 交付节奏

照飞书那次:分阶段 plan(A:后端长连接+收发+分类+provider;B:config/RPC/投递/HITL;C:桌面 UI),
每阶段 subagent 驱动 + 逐任务 review + opus 整支终审。真机眼验后合并。
