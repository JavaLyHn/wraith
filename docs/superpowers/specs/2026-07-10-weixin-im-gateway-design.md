# 个人微信(Weixin)IM 网关接入设计(v2:复用现有 wechat 包)

**日期:** 2026-07-10(v2 修订:发现仓库自带完整 iLink 实现,设计从「从零实现」改为「复用 + 网关化包装」)
**分支:** feat/im-weixin-gateway(基于已合并飞书+企微的 main,8df0e82)
**状态:** 已获用户批准

## 问题 / 目标

wraith 网关已支持 QQ、飞书、企业微信三个 IM provider。新增**个人微信**作为第四个 provider:
对话式**单聊** bot,进桌面 IM 网关屏、cron 投递、HITL 审批(**文本 y/a/n**,用户已拍板)。

## 通道确认(官方,非灰产)

腾讯官方「微信 ClawBot」/ iLink 协议(`github.com/Tencent/openclaw-weixin` + npm `@tencent-weixin/*`),
纯 HTTP/JSON + 长轮询,域名 `ilinkai.weixin.qq.com` + 扫码下发的 `baseurl`。登录 = 本人手机微信扫码授权。
第三方 hook/逆向(封号风险)不予考虑。

## 关键前提:仓库已有完整 iLink 实现(PaiCLI 原生,`com.lyhn.wraith.wechat` 包,2353 行)

**直接复用(不动或微调):**
- `IlinkClient`(249 行):扫码登录(`startQrLogin`/`pollQrStatus`)、`getUpdates(account, timeoutMs)`
  (游标)、`sendText(account, toUserId, contextToken, text)`、`sendTyping`(打字指示器)、
  `notifyStart/notifyStop`。请求头(AuthorizationType/X-WECHAT-UIN 随机 base64/Bearer)全对。
- 模型:`WechatQrLogin` / `WechatLoginResult` / `WechatMessage(messageId, fromUserId, contextToken, text, mediaItems)`
  / `WechatUpdate(ret, errmsg, nextSyncBuf, nextLongPollTimeoutMs, messages)` / `WechatMediaItem`。
- `WechatAccountStore`:账号(token/accountId/baseUrl/**boundUserId**/workspace/**syncBuf**)持久化到
  `~/.wraith/wechat/accounts/latest.json`(0600 权限)。
- `TerminalQrRenderer`:终端渲染二维码。
- 常量:token 失效 `ret == -14`(SESSION_EXPIRED,见 WechatMessageLoop)。

**不复用(保留原样、不共跑):** `WechatMessageLoop`/`WechatAgentSession`/`WechatCommandParser` 等
—— 那是 `/wechat` REPL 通道的单机形态(自带队列/REPL 命令/独立 agent 会话),与网关 SPI 平行。
本特性不动它们。

**⚠ 共存约束(文档级,v1 不做互斥锁):** 网关 weixin provider 与 REPL `/wechat` 消费同一
getupdates 游标,**不能同时运行**,否则互抢消息。README/帮助文案注明。

## 协议要点(已核对,与 IlinkClient 实现一致)

- 路径:`POST {baseurl}/ilink/bot/getupdates`、`/ilink/bot/sendmessage`(baseurl 空则回退 ilinkai 域名)。
- `message_type`:1=用户入站、2=Bot 发出(发送恒 2,IlinkClient 已如此)。
- 群聊:有 `group_id` 字段、未文档化 → v1 仅处理 owner 单聊(fromUserId == boundUserId),其余 IGNORE。
- 错误:HTTP 非 2xx 抛 IOException;`ret == -14` = token 失效 → 状态灯 `auth-failed`(提示重新扫码);
  其余异常 → warn + 退避重连。
- 游标 `syncBuf` 每次轮询更新并**持久化到账号店**(高频写,故 token/游标不进 config.json)。
- 去重键:`WechatMessage.messageId`(message_id,缺省 seq)——不可用 context_token(关联会话窗口,可能复用)。

## 架构

```
绑定(一次性): wraith gateway bind-weixin [--workspace <dir>]
   IlinkClient.startQrLogin → TerminalQrRenderer 打终端二维码(+打印链接兜底)
   → 手机微信扫码确认 → pollQrStatus → {token, accountId, baseUrl, ilink_user_id}
   → WechatAccountStore.save(boundUserId = 扫码者 ilink_user_id ⇒ 扫码者即主人,无需配对回显)

运行(常驻): GatewayDaemon.buildProviders:latest.json 存在 ⇒ 构造 WeixinProvider
   WeixinProvider.start() → 守护线程长轮询回路:
   notifyStart → 循环 getUpdates(游标,35s)→ 持久化新游标 → 逐条:
        │  WeixinInbound.classify(msg, isOwner, hasPendingApproval)
        ▼
   IGNORE / NONTEXT_NOTICE / APPROVAL_REPLY(y|a|n) / APPROVAL_NUDGE / PROCESS
        │  PROCESS: dedup(messageId) → 更新 ownerLastContextToken → ImTurnDriver.onMessage
        │           (InboundMsg.msgId = contextToken,经 Sender.replyTo 回带)
        ▼
   runTurn(打字指示器开)→ reply → sendText(toPlainText 清洗,微信不渲染 markdown)
   ret==-14 → 状态灯 auth-failed;异常 → 退避重连;stop() → notifyStop
```

与 QQ/飞书/企微同构:独立 SessionRouter / ImTurnDriver / Dedup;会话 key = boundUserId;
构造不触网。Authorizer 语义 = `fromUserId.equals(account.boundUserId())`(扫码即绑定,fail-closed)。

## 新增组件(文件)

### 1. `gateway/weixin/WeixinInbound.java`(纯函数)
- `classify(WechatMessage m, String boundUserId, boolean hasPendingApproval)` →
  `{IGNORE, NONTEXT_NOTICE, APPROVAL_REPLY, APPROVAL_NUDGE, PROCESS}`。
- 规则依次:m/fromUserId 空 → IGNORE;fromUserId != boundUserId → IGNORE(fail-closed,无配对回显);
  文本空且有媒体 → NONTEXT_NOTICE(「暂只支持文本消息」);挂起审批中:text(trim/小写)∈{y,a,n} →
  APPROVAL_REPLY,否则 → APPROVAL_NUDGE;文本空 → IGNORE;其余 → PROCESS
  (InboundMsg(boundUserId, text, contextToken, now);**去重由 provider 用 m.messageId 做,在 classify 之前**)。

### 2. `gateway/weixin/WeixinApproval.java`(纯函数,文本 HITL)
- `static String promptText(String toolName)` → 「⚠️ 需要审批:<tool>。回复 y 批准 / a 总是允许 / n 拒绝」
- `static ApprovalResult parse(String text)` → y→approve() / a→approveAll() / n→reject("用户在微信拒绝") / 其它→null。

### 3. `gateway/weixin/WeixinProvider.java`(装配,implements ImProvider)
- 生产构造 `(WechatAccount account, LlmClient client, Map<String,CompletableFuture<ApprovalResult>> pendingApprovals)`
  + 内建 `IlinkClient`、`WechatAccountStore`(游标持久化)。测试构造注入 stub 不触网。
- platform() = `"weixin"`。
- 文本 HITL 状态:`volatile String pendingSessionKey`(v1 单聊一次一个挂起;新审批到来先 reject 旧挂起);
  approvalSurface 闭包 = 发 promptText(用 ownerLastContextToken)+ 登记挂起;
  APPROVAL_REPLY → parse → pendingApprovals 命中 complete(定时审批)否则 driver.onApproval;清挂起;
  `surfaceScheduledApproval` 同 approvalSurface(approvalId 为 sessionKey)。
- `volatile String ownerLastContextToken`:owner 每条入站更新;主动发送(审批提示/cron 投递)用;
  缺失 → 跳过 + warn(≈ QQ 被动窗口 / 企微 chatid 语义)。
- 回复出口 Sender:`(userid, text, replyTo) -> ilink.sendText(account, userid, replyTo, MarkdownLite.toPlainText(text))`
  + 发送前后打字指示器(best-effort,失败仅 debug 日志)。
- 状态灯:`starting`(起回路)→ 轮询成功 `running`;IOException → `disconnected` + 退避(复用
  backoffSeconds 模式);`ret==-14` → `auth-failed`(现有分类器 token 集已覆盖,无桌面改动)。
- `deliveryAdapter()`:Phase B 起返回 WeixinDeliveryAdapter。

### 4. `automation/delivery/WeixinDeliveryAdapter.java`(Phase B)
- 复刻 Wecom 形态:`(Supplier<String> ownerContextToken, BiConsumer<String,String> sink)`;
  目标 = boundUserId;文本 = 「⏰ <任务名>:\n<toPlainText(结果)>」;contextToken 缺失 → 跳过 + warn;
  try/catch 守护。

### 5. 绑定 CLI:`wraith gateway bind-weixin`(cli/Main.java gateway 路由加分支)
- 非交互:`--workspace <dir>`(缺省当前目录绝对路径);复用 startQrLogin + TerminalQrRenderer +
  waitWechatLogin 模式(限时 5 分钟)→ 写账号店 → 打印「✅ 微信绑定成功 账号:xxx」;
  失败/超时打印可读原因(桌面 Phase C spawn 此命令解析输出,照 QQ bind 模式)。

### 6. `runtime/appserver/AppServer.java`(Phase B)
- `gateway.config.get` 加 `platform=weixin`:读 WechatAccountStore(非 config.json),视图
  `{bound(token 非空), hasSecret(=bound), ownerUserid(=boundUserId, mask 由前端做), workspace}`,
  **绝不回 token**。`gateway.config.set(weixin)`:只允许改 workspace(owner 由扫码定,token 归绑定流程)。

### 7. `gateway/GatewayDaemon.java`
- buildProviders 加 weixin 分支:`WechatAccountStore.createDefault().loadLatest()` 有值 ⇒ 构造
  WeixinProvider(与 config.json 无关;此判据写注释说明)。

### 8. 桌面 UI(Phase C)
- `imPlatforms.ts` weixin → available;`ImGatewayPanel` 微信分支:「扫码绑定」按钮(spawn
  `gateway bind-weixin`,输出行解析绑定进度;二维码在终端/输出中呈现,桌面 v1 显示指引文案 +
  绑定状态)+ 工作目录表单(owner 只读展示);anyBound 并入 weixin(经 config.get 视图)。

## 密钥红线

**`bot_token` 即密钥**(等价个人微信登录态):只存 `~/.wraith/wechat/accounts/latest.json`(0600),
绝不进日志 / RPC 回包 / renderer;仅进 `Authorization: Bearer` 头(IlinkClient 内部)。
提交前照常红线扫描。

## YAGNI(v1 不做)

- 群聊、媒体收发(CDN AES 解密/上传)、引用/@、REPL `/wechat` 与网关的互斥锁、多账号、token 自动续期。
- REPL `/wechat` 通道本身不动、不删、不重构。

## 测试

- `WeixinInboundTest`:各分支(owner 判定、挂起审批 y/a/n 与 nudge、非文本、空文本)。
- `WeixinApprovalTest`:promptText 含工具名;parse y/a/n/大小写/其它 null。
- `WeixinProviderTest`(测试构造):platform、start 起线程、挂起登记/清除、
  APPROVAL_REPLY 完成 pendingApprovals future、deliveryAdapter(Phase B)。
- `WeixinDeliveryAdapterTest`(Phase B):contextToken 缺失跳过 / 正常发送 / sink 异常守护。
- 现有 `IlinkClient` 无单测(触网),沿用「真机眼验」;不为其补测(YAGNI,已有 REPL 通道实战验证)。

## 交付节奏

Phase A(bind-weixin CLI + WeixinInbound + WeixinProvider 单聊闭环 + buildProviders,可眼验)
→ B(文本 HITL + cron 投递 + AppServer 视图)→ C(桌面 UI)。每阶段 SDD + opus 整支终审;真机眼验后合并。
