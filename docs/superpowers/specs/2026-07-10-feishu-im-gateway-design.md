# 飞书 IM 网关接入 (Feishu Gateway) 设计

**日期:** 2026-07-10
**分支:** feat/im-feishu-gateway(从 main 起,main 已含 QQ 网关 + MCP 三特性)
**状态:** 设计已获批,待用户复核 spec

## Goal

给 wraith 网关新增**飞书(Feishu/Lark)**作为第二个 IM provider:对话式**单聊** bot,支持 HITL 审批(飞书交互卡片按钮),与现有 QQ 单聊 bot 对等。借这次「第二个 provider」把入站侧抽出 `ImProvider` SPI(对称于已有的出站 `DeliveryAdapter`),让第三个平台零架构改动。

## 背景与现状信号

- 现网关已支持 QQ 单聊(`com.lyhn.wraith.gateway` + `gateway.qq`,已在 main、真机可用)。
- 会话核心**早已平台无关**:`SessionRouter`、`ImTurnDriver`(仅依赖 `Sender` 接口)、`GatewaySession`、`GatewayRenderer`、`Authorizer`、`Dedup`、`PassiveWindow` 接口、`InboundMsg`(openid/text/msgId/ts)。
- 出站侧 SPI 已存在:`DeliveryAdapter`(`DesktopDeliveryAdapter` 已是第二个实现,证明多 provider 走得通)。
- 桌面已平台化:`imPlatforms.ts` 里飞书已挂 `status:'soon'`;`ImGatewayPanel` 顶部平台卡片网格 `IM_PLATFORMS.map`。
- **QQ 是直连腾讯的**;OpenClaw(`gateway/bind/Openclaw.java`)只是 QQ 的一次性扫码绑定门户,不是运行时中继——飞书不能蹭,须原生集成。

## 已验证的可行性事实(关键)

- **Java 飞书 SDK 有原生 WS 长连接**:坐标 `com.larksuite.oapi:oapi-sdk:2.4.19`(包名 `com.lark.oapi`)。
  - `com.lark.oapi.ws.Client`:builder `newBuilder(appId, appSecret).eventHandler(dispatcher).domain(...).build()` → `.start()`;**autoReconnect 默认 true**,带 `onReconnecting/onReconnected` 回调(`ws/Client.java`)。
  - REST:`com.lark.oapi.Client`,`im.message.create` 发消息。
  - `com.lark.oapi.event.EventDispatcher`:`.onP2MessageReceiveV1(...)`(消息)、`.onP2CardActionTrigger(...)` 注册 `card.action.trigger`(`event/EventDispatcher.java:380`)。
  - **卡片按钮回调走 WS**:WS `Client` 处理 `CARD` 帧(`ws/Client.java:493 case CARD`)→ 交 eventHandler。**故长连接下卡片 HITL 无需公网 URL。**
  - tenant_access_token **SDK 全自动**;只需 `app_id` + `app_secret`。
  - 域名:飞书 `open.feishu.cn` / Lark 国际 `open.larksuite.com`,SDK `BaseUrlEnum.FeiShu`(默认)/`Lark` 切换。
- **入站事件形态**(参考 openhanako `@larksuiteoapi/node-sdk` 实现,概念同构):
  - `data = {message, sender}`;`sender.sender_id.open_id`;`message.chat_id`(`oc_xxx`,私聊也有)、`chat_type`(`p2p`/`group`)、`message_id`(`om_xxx`)、`message_type`、`content`(JSON 串,text 在 `content.text`)。
  - 发消息统一 `receive_id_type=chat_id`(私聊/群都用 chat_id),不必区分 open_id。
  - **自我回声过滤**:sender 是本 app 时丢弃,防自触发循环。
- **本地 daemon 无公网 URL** → 只有长连接模式适用(webhook 需公网,出局);长连接只需出网。

## 关键决策(来自设计对话)

| # | 决策 | 选择 |
|---|---|---|
| 传输 | 飞书长连接实现方式 | **官方飞书 Java SDK**(`com.lark.oapi.ws.Client`);raw 自研(私有 protobuf,风险极高)与 webhook(需公网)均否 |
| 架构 | 飞书怎么嵌进网关 | **抽 `ImProvider` 接缝**:QQ 回填为 `QqProvider`,飞书为 `FeishuProvider`,daemon 遍历已配置 provider |
| HITL | v1 是否上审批 | **飞书交互卡片按钮**(最全,对标 QQ inline keyboard);从零照飞书文档实现(openhanako 无参考) |
| 范围 | 单聊 vs 群 | **仅 p2p 单聊**(与 QQ 对等,群 v1 忽略) |
| 绑定 | 飞书凭据获取 | **桌面表单手粘 appId/appSecret/region**(飞书后台自取),无 OpenClaw、无 CLI bind 子命令 |
| owner | Authorizer 主人识别 | **fail-closed + 配对回显**:未绑定时 bot 回显来访者 open_id + 日志,用户填进桌面设为 owner;绑定前一律拒 |

## 架构

### Part 1:`ImProvider` SPI + QQ 回填 + daemon 改造

**新接口(新包 `gateway/spi/`):**
```java
interface ImProvider {
    String platform();                              // "qq" | "feishu"
    void start(InboundSink sink) throws Exception;  // 起传输(自带重连);入站消息+审批回调喂给 sink
    void stop();
    Sender sender();                                // ImTurnDriver 回发用
    ApprovalSurface approvals();                    // 平台原生 HITL:render(approval) + parseCallback
}
interface InboundSink {
    void onMessage(InboundMsg m);
    void onApprovalCallback(ApprovalCallback c);
}
```
- `InboundMsg`(openid/text/msgId/ts)原样复用;飞书把 `chat_id` 放进 openid 位(私聊语义等价)。
- `Sender`(现有 `void send(String openid, String text, String replyToMsgId)`)、`ApprovalSurface` 各平台各一份实现。
- `ApprovalCallback`:`{ sessionKey, action(approve/deny), scope(once/always) }`。

**QQ 回填(风险最高,红线守 QQ 行为不变):**
- 新建 `QqProvider implements ImProvider`,把现 `GatewayDaemon.start()` 中 QQ 装配段(约 90–147、258–320)**整体挪入**,行为逐字不变。
- `ImTurnDriver`/`SessionRouter`/`GatewaySession`/`GatewayRenderer`/`Authorizer`/`Dedup` **零改动**。
- 用现有 QQ 测试(`QqWsClientLogicTest`/`QqApprovalTest`/`QqEventsTest`/`GatewaySessionTest`/`ImTurnDriverTest` 等)当回归网。

**daemon 改造(`GatewayDaemon`):**
- `start()` 从「写死 QQ」改为:读 config → 构造已配置 provider 列表(`gw.getQq()!=null → QqProvider`;`gw.getFeishu()!=null → FeishuProvider`)→ 各自 `start(sink)`。
- 共享一个 `SessionRouter`+`ImTurnDriver`+Agent/LLM/AutomationStore/Scheduler;`sink` 把入站路由进共享 router。
- **会话 key 带平台前缀**防串号:`qq:<openid>` / `fs:<chatId>`。安全性已验证:`SessionRouter` 是**纯内存映射**(`ConcurrentHashMap`,持久化 deferred),session key **不映射任何磁盘路径**(`SessionStore` 按 workspace root 定位,每次 daemon 启动 `startNew()`)——故给 QQ key 统一加 `qq:` 前缀零磁盘风险;QQ 审批按钮 `value` 的 sessionKey 在运行时由同一 key 派生,内部保持一致。
- Deliverer 注册表加 `FeishuDeliveryAdapter`(平台 `"feishu"`),与 `QqDeliveryAdapter`/`DesktopDeliveryAdapter` 并列。

### Part 2:FeishuProvider 内部(新包 `gateway/feishu/`)

依赖:`pom.xml` 加 `com.larksuite.oapi:oapi-sdk:2.4.19`。

- **FeishuWsClient**:包 `com.lark.oapi.ws.Client`。后台线程 `.start()`;`onReconnecting/onReconnected` 打状态灯(复用 QQ 的 `WRAITH_GATEWAY_STATUS <state>` 行协议:starting/running/error)。
- **FeishuEvents**:构建 `EventDispatcher`,注册:
  - `.onP2MessageReceiveV1`:解析 `open_id`/`chat_id`/`chat_type`/`message_id`/`message_type`;**过滤自我回声**(sender 是本 app)、**仅 p2p**(群忽略)、**仅 text**(非 text 回「暂只支持文本」);组 `InboundMsg` 喂 sink。
  - `.onP2CardActionTrigger`:解 `event.action.value` → `ApprovalCallback` → `sink.onApprovalCallback`;返回更新卡(见 Part 5)。
- **FeishuApiClient / FeishuSender(Sender 实现)**:包 `com.lark.oapi.Client`;`im.message.create`,`receive_id_type=chat_id`,text `msg_type="text"` content `{"text":...}`;超长分块(新 `FeishuText.chunk`,阈值按飞书上限,远大于 QQ 4000)。
- **FeishuApproval(ApprovalSurface 实现)**:`render` 生成飞书 interactive card;`parseCallback` 解 `CallBackAction`。
- **FeishuDeliveryAdapter(DeliveryAdapter 实现)/ FeishuPendingStore**:窗口内即发、窗口外入队 `~/.wraith/feishu-pending.json`(镜像 `QqDeliveryAdapter`/`QqPendingStore`);`PassiveWindow` 接口复用。

### Part 3:config / RPC / 绑定 / owner 配对

**config(`WraithConfig`)**:`GatewayConfig` 加 `GatewayFeishuConfig`:
```
gateway.feishu = { appId, appSecret, ownerOpenid, region, workspace }
```
- `region ∈ {"feishu","lark"}`,缺省 `"feishu"`。
- **红线**:`appSecret` 只落 `~/.wraith/config.json`,绝不进日志/RPC 回包。

**RPC(`AppServer`)**:`gateway.config.get/set` 现写死 `getQq()`,改为**带 `platform` 参数**分发 `getQq()/getFeishu()`。飞书回包 view:`{ bound, hasSecret, appId, ownerOpenid, region, workspace }`,**不回明文 secret**(镜像 QQ `clientSecret` 处理)。

**绑定**:飞书**不走 OpenClaw**、无 CLI bind 子命令。用户在飞书开放平台后台建自建应用取 `app_id`/`app_secret` → 桌面表单粘贴(appId/appSecret/region)→ `gateway.config.set(platform=feishu)` 落盘 → `wraith gateway` 起来按 config 拉起 FeishuProvider。

**owner 配对**(Authorizer deny-all,仅放行 owner):`ownerOpenid` 未配置时,任何私聊进来 bot 回一句「你的 open_id 是 `ou_xxx`;若这是你,请到桌面端绑定为主人」并写 gateway 日志;用户把 open_id 填进桌面表单设为 owner;绑定前一律拒绝(不自动授权)。open_id 按应用隔离、非密,回显不泄密。

### Part 4:桌面 UI

- `imPlatforms.ts`:飞书 `status:'soon'` → `'available'`。
- `ImGatewayPanel.tsx`:抽出**按平台条件渲染**;选中飞书显示飞书表单(appId、appSecret、region 下拉 feishu/lark、workspace、ownerOpenid),QQ 段维持原样。平台网格点飞书卡切飞书视图。
- `gatewayManager.ts`:`parseConnectUrl/classifyBindLine`(QQ openclaw 专用)飞书不复用;`classifyGatewayStatusLine`(`WRAITH_GATEWAY_STATUS`)通用,飞书 provider 也发此行,状态灯直接复用。
- `shared/gateway.ts`:`GatewayConfigView` 加飞书字段(或按平台判别);飞书无扫码阶段。

### Part 5:HITL 飞书交互卡片(从零)

- **发审批卡**:`msg_type="interactive"`,card 2.0:说明要批的动作 + action 模块含三 button:`同意一次`/`一直允许`/`拒绝`。每 button `value = {"a":"approve|deny","scope":"once|always","s":"<sessionKey>"}`。
- **收点击**:`onP2CardActionTrigger` handler → `event.action.value` → 解 action/scope/sessionKey → `sink.onApprovalCallback` → ImTurnDriver 按 sessionKey resolve(**复用 QQ 既有 approve-once/always/deny 解析与唤醒语义**,仅回调来源换飞书)。
- **回执**:handler 返回更新卡(`P2CardActionTriggerResponse`)把按钮换「✅ 已批准(本次)/已拒绝」,防重复点击。
- **超时/fail-closed**:沿用 QQ 既有审批超时与 fail-closed 语义,不新造。

## 边界与错误

- app_id/secret 错 → SDK 起连接即失败 → 状态灯 error + 日志(不含 secret)。
- 断线 → SDK autoReconnect,状态灯 starting↔running。
- 3 秒 ACK 约束由 SDK 内置处理;turn 异步跑不阻塞 event handler。
- 群消息 v1 忽略;非 text 消息类型 v1 回「暂只支持文本」。
- 空消息(text/attachments 皆空)直接 return 不触发 onMessage。

## 安全红线复核

- `appSecret` 只在 `~/.wraith/config.json`;RPC/日志绝不回显;回包只 `hasSecret:boolean`。
- Authorizer deny-all 默认拒,owner 未绑一律拒。
- 提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer|app.?secret"`(只应命中字段名/自指/测试金丝雀)。
- push 是对外操作,需用户单独点头。

## Out of Scope(YAGNI)

- 群聊、群 @mention 门禁。
- 图片/富文本(post)收发、文件、语音。
- CardKit 流式(`cardkit.v1.*`,需企业版权限)、post→interactive 动态升级。
- 飞书文档/日历/审批等其它 open API。
- 飞书与 Lark 同时双开(region 单选)。
- 飞书凭据的 CLI bind 子命令 / 扫码门户。

## 测试策略

- **Java 纯逻辑(不连真飞书)**:
  - `FeishuEvents`:text/p2p 解析、群过滤、自我回声过滤、非 text 兜底。
  - `FeishuApproval`:card JSON 构造 + `CallBackAction` 解析(action/scope/sessionKey 往返)。
  - `FeishuText`:分块阈值。
  - `FeishuProvider`:用 fake SDK 门面验装配 + `InboundSink` 路由。
  - `Authorizer`:owner 门禁(未绑拒、绑后放行)。
  - config 读写 + RPC 平台分发(`gateway.config.get/set` platform=feishu 回包不含 secret)。
  - **QQ 回归全绿**(QqProvider 挪动后既有 QQ 测试零改动通过)。
- **前端**:`imPlatforms` 飞书 available、平台切换渲染、config view 纯函数 vitest;`npm run typecheck` + `npx vitest run` + `npm run build`。
- **眼验**:飞书后台建应用 → 桌面填 appId/secret/region → `wraith gateway` → 私聊 bot → 配对回显 open_id → 绑 owner → 对话 → 触发审批看卡片按钮 → 点同意继续 → `ps` 查无残留。真机验证归用户。
