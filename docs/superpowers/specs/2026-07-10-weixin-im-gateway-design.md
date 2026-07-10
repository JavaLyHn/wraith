# 个人微信(Weixin)IM 网关接入设计

**日期:** 2026-07-10
**分支:** feat/im-weixin-gateway(基于已合并飞书+企微的 main,8df0e82)
**状态:** 待用户过目

## 问题 / 目标

wraith 网关已支持 QQ、飞书、企业微信三个 IM provider。新增**个人微信**作为第四个 provider,
对话式**单聊** bot。用户已拍板:HITL 走**文本审批 y/n**;分支从合并后的干净 main 开。

## 通道确认(官方,非灰产)

2026-03 腾讯开放个人微信首个官方 Bot API:**微信 ClawBot 功能**,底层协议 **iLink**。
- 官方仓库:`github.com/Tencent/openclaw-weixin`(腾讯 GitHub org);官方 npm `@tencent-weixin/openclaw-weixin`。
- 域名:`ilinkai.weixin.qq.com`(登录)+ 扫码后下发的 `baseurl`(收发)。
- **纯 HTTP/JSON + 长轮询**,无需 SDK、无需 WebSocket、免公网——okhttp + Jackson 直接实现。
- 有官方《微信ClawBot功能使用条款》背书;登录 = 用户本人手机微信扫码授权,合规路径。
- 第三方 hook/逆向方案(封号风险)**不予考虑**。

## 协议要点(来源:官方插件源码 + 社区协议文档 hao-ji-xing/openclaw-weixin/weixin-bot-api.md)

### 登录(一次性,扫码换 token)
```
GET https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3
→ { "qrcode": "<二维码值>", "qrcode_img_content": "<图像内容(base64)>" }

GET https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode={qrcode}   (轮询)
→ { "status": "confirmed", "bot_token": "<token>", "baseurl": "<收发服务器>" }
```

### 请求头(登录后所有请求)
```
Content-Type: application/json
AuthorizationType: ilink_bot_token
X-WECHAT-UIN: <base64(random_uint32)>
Authorization: Bearer {bot_token}
```

### 收消息(长轮询,35s hold + 游标)
```
POST {baseurl}/…/getupdates
body: { "get_updates_buf": "<上次返回的游标,首次为空>", "base_info": { "channel_version": "1.0.2" } }
→ { "ret": 0,
    "msgs": [ { "from_user_id": "xxx@im.wechat", "to_user_id": "xxx@im.bot",
                "message_type": 1, "message_state": 2, "context_token": "AAR...",
                "item_list": [ { "type": 1, "text_item": { "text": "消息内容" } } ] } ],
    "get_updates_buf": "<新游标>", "longpolling_timeout_ms": 35000 }
```
游标**必须**每次更新回带,否则重复收取。item type:1=文本、2=图片、3=语音、4=文件、5=视频。

### 发消息
```
POST {baseurl}/…/sendmessage
body: { "msg": { "to_user_id": "<对方 user_id>", "message_type": 2, "message_state": 2,
                 "context_token": "<从入站消息取,原样回带>",
                 "item_list": [ { "type": 1, "text_item": { "text": "回复内容" } } ] } }
```
`context_token` 必须原样回带,否则不关联到对话窗口。

### 已钉死的细节(据协议文档定向核对,2026-07-10)
- **路径**:`POST {baseurl}/ilink/bot/getupdates`、`POST {baseurl}/ilink/bot/sendmessage`
  (baseurl 取扫码响应;为空则回退 `https://ilinkai.weixin.qq.com`)。
- **message_type = 方向标记**:1=用户入站、2=Bot 发出;发送恒填 2。
- **群聊判别**:消息有 `group_id` 字段(群聊支持未文档化,可能需额外权限)→ v1 见 `group_id` 非空即 IGNORE。
- **错误响应无文档** → 防御式:HTTP 401/403 或鉴权类失败 → 状态灯 `auth-failed`(提示重新扫码);
  其余非 0 `ret`/异常 → warn 日志 + 退避重试。
- **X-WECHAT-UIN**:随机 uint32 → 十进制字符串 → base64,**每次请求重新生成**(防重放)。

## 架构

```
绑定(一次性,CLI/桌面): get_bot_qrcode → 存 ~/.wraith/weixin-qr.png 并自动打开
   → 手机微信扫码确认 → 轮询 get_qrcode_status → {bot_token, baseurl} 写 config
   (≈ QQ 的 openclaw bind 流程;token 不可手填)

运行(常驻): WeixinProvider.start() → 守护线程跑长轮询回路
   getupdates(游标) ─循环─▶ 每条 msg
        │  WeixinFrames.parseUpdates → Inbound{fromUserId, contextToken, msgType, text, msgKey}
        ▼
   WeixinInbound.classify(ownerBound, isOwner) → IGNORE / PAIRING_ECHO / NONTEXT_NOTICE
        / APPROVAL_REPLY(有挂起审批且文本为 y/a/n) / PROCESS
        │  PROCESS: dedup → ImTurnDriver.onMessage(InboundMsg{userId, text, contextToken, ts})
        ▼
   runTurn → reply → sendmessage(context_token=InboundMsg.msgId 经 Sender.replyTo 回带)
   回复纯文本:MarkdownLite.toPlainText(微信不渲染 markdown;QQ 同款)
```

与 QQ/飞书/企微同构:自带独立 SessionRouter / ImTurnDriver / Authorizer / Dedup;
会话 key = 裸 from_user_id;构造不触网;`GatewayDaemon.buildProviders` 加 weixin 分支。

## 组件(文件)

### 1. `gateway/weixin/WeixinFrames.java`(纯函数,可单测)
- `record Inbound(String fromUserId, String contextToken, int msgType, String text, String msgKey)`
  —— msgKey 为去重键(实现期定:优先消息自带唯一 id,无则 contextToken)。
- `static String updatesRequest(String cursor)` —— getupdates 请求体(Jackson)。
- `record Updates(String cursor, java.util.List<Inbound> msgs)`
- `static Updates parseUpdates(String json)` —— 解析响应;非法/ret!=0 → null。
- `static String sendTextRequest(String toUserId, String contextToken, String text)` —— sendmessage 请求体。
- 转义全交 Jackson(沿用 MessageText 230001 的教训)。

### 2. `gateway/weixin/WeixinHttp.java`(okhttp 外壳)
- 构造 `(OkHttpClient, String baseUrl, String botToken)`;统一注入四个请求头。
- `String pollUpdates(String cursorRequestBody)` —— 阻塞长轮询一跳(读超时 ≥ 45s)。
- `void sendText(String requestBody)` —— 发送,失败打 code/msg 日志(resp 检查,静默吞是大忌)。
- 登录静态方法(绑定流程用,走 ilinkai 域名):`fetchQrcode()` / `pollQrcodeStatus(qrcode)`。
- 纯逻辑(头构造、URL 拼接)抽静态可测;真 socket 眼验。

### 3. `gateway/weixin/WeixinInbound.java`(纯函数)
- `classify(Inbound f, boolean ownerBound, boolean isOwner, boolean hasPendingApproval, long now)` →
  `{IGNORE, PAIRING_ECHO, NONTEXT_NOTICE, APPROVAL_REPLY, APPROVAL_NUDGE, PROCESS}`。
- 规则依次:fromUserId 空/非单聊形态 → IGNORE;非 owner → 未绑定 PAIRING_ECHO / 已绑定 IGNORE;
  owner 非文本 → NONTEXT_NOTICE;owner 有挂起审批:文本(trim,忽略大小写)∈ {y,a,n} → APPROVAL_REPLY,
  否则 → APPROVAL_NUDGE(provider 回「有待审批操作,请先回复 y 批准 / a 总是允许 / n 拒绝」,消息不投 turn);
  owner 文本空 → IGNORE;owner 文本 → PROCESS(InboundMsg.msgId = contextToken,承载回带;
  **去重用 frame.msgKey 而非 contextToken**——context_token 关联会话窗口,可能跨消息复用,不可作去重键)。

### 4. `gateway/weixin/WeixinApproval.java`(纯函数,文本 HITL)
- `static String promptText(String toolName)` → 「⚠️ 需要审批:<tool>。回复 y 批准 / a 总是允许 / n 拒绝」
- `static ApprovalResult parse(String text)` → y→approve() / a→approveAll() / n→reject("用户在微信拒绝");
  其它 → null。

### 5. `gateway/weixin/WeixinProvider.java`(装配,implements ImProvider)
- platform() = `"weixin"`。
- 文本 HITL 状态:`Map<String/*sessionKey*/, ?>` 挂起审批登记 + owner 的「当前挂起 sessionKey」
  (v1 单聊单会话,一次一个挂起;新审批到来时旧挂起先 reject)。
- approvalSurface 闭包:发 promptText 给 owner(用 owner 最近 context_token,见「投递」)+ 登记挂起。
- APPROVAL_REPLY:`WeixinApproval.parse` → 定时审批(pendingApprovals 命中 complete)或
  `driver.onApproval(sessionKey, result)`;清挂起。
- `surfaceScheduledApproval`:同 approvalSurface(approvalId 为 sessionKey)。
- 主人最近 context_token 捕获:owner 每条入站更新 `volatile String ownerLastContextToken`
  (+ to_user_id 侧的 owner user_id 记录),供主动发送(审批提示/cron 投递)。无则跳过 + 日志。
- 长轮询回路:循环 pollUpdates → parseUpdates → 逐条 classify 分发;游标持久于内存
  (重启从空游标开始,靠 Dedup 兜重复);断连退避重连;401/token 失效 → 状态灯 auth-failed。
- 状态灯:轮询正常 → `running`;断连重试 → `disconnected`;token 失效 → `auth-failed`
  (复用现有 token 集,桌面分类器无需改)。

### 6. `automation/delivery/WeixinDeliveryAdapter.java`
- 复刻 Wecom 形态:`(Supplier<String> ownerContextTokenSupplier, Supplier<String> ownerUserIdSupplier, BiConsumer 发送口)`
  —— 具体形态实现期照 FeishuDeliveryAdapter/WecomDeliveryAdapter 定;目标=owner,文本=toPlainText(结果)。
  context_token 缺失(主人近期没发过消息)→ 跳过 + warn(同企微 chatid 语义)。

### 7. `config/WraithConfig.java`
- `GatewayWeixinConfig { String botToken; String baseUrl; String ownerUserId; String workspace; }`。
- botToken/baseUrl 由**绑定流程写入**,不手填;ownerUserId 桌面/手工填(经配对回显获得)。

### 8. 绑定 CLI(`wraith gateway bind-weixin`)
- fetchQrcode → `qrcode_img_content` 落 `~/.wraith/weixin-qr.png` → macOS `open` 自动打开 +
  打印路径;轮询 get_qrcode_status(限时,~2 分钟)→ confirmed 则写 config(botToken/baseUrl)
  → 打印「✅ 绑定成功」;超时/失败打印可读原因。桌面 Phase C 复用同一命令(spawn + 解析输出,照 QQ bind)。

### 9. `runtime/appserver/AppServer.java`
- `gateway.config.get/set` 加 `platform=weixin`:视图 `{bound(hasToken), hasSecret(=hasToken), ownerUserId, workspace}`,
  **绝不回 botToken**;set 只收 ownerUserId/workspace(token 归绑定流程)。

### 10. 桌面 UI(Phase C)
- `imPlatforms.ts` weixin → available;`ImGatewayPanel` 微信分支:「扫码绑定」按钮(spawn bind-weixin,
  桌面内展示 `~/.wraith/weixin-qr.png`)+ 主人 userId / 工作目录表单;anyBound 并入 weixin。

## 密钥红线

**`bot_token` 即密钥**(等价个人微信登录态,比 appSecret 更敏感):只存 `~/.wraith/config.json`,
绝不进日志 / RPC 回包 / renderer;仅进 `Authorization: Bearer` 头。qrcode 值与 PNG 为一次性凭据,
绑定完成后 PNG 建议删除(bind CLI 收尾时 best-effort 删)。提交前照常红线扫描。

## YAGNI(v1 不做)

- 群聊、图片/语音/文件/视频收发(含 AES-128-ECB 加密上传)、引用/@。
- 游标持久化(重启重放靠 Dedup 兜)。
- 多账号;token 自动续期(失效即提示重新扫码)。

## 测试

- `WeixinFramesTest`:updatesRequest/sendTextRequest 构造(含转义);parseUpdates 提取字段/游标、
  非法/ret!=0→null、非文本 item。
- `WeixinInboundTest`:各分支(含 APPROVAL_REPLY 的 y/a/n 与非 y/a/n)。
- `WeixinApprovalTest`:promptText 含工具名;parse y/a/n/大小写/其它→null。
- `WeixinProviderTest`:platform、start 起线程、挂起审批登记/清除、deliveryAdapter(Phase B)。
- `WeixinHttpTest`:头构造/URL 拼接纯逻辑。
- 桌面(Phase C):payload/分类器用例照旧。

## 交付节奏

照企微:Phase A(config + frames + http + inbound + provider 单聊闭环 + bind-weixin CLI,可眼验)
→ B(文本 HITL + cron 投递 + 配置 RPC)→ C(桌面 UI)。每阶段 SDD + opus 整支终审;真机眼验后合并。
