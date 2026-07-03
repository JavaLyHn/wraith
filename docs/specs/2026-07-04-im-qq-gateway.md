# wraith IM v1 设计规格:对话式 QQ 单聊 bot(`wraith gateway`)

状态:设计已定,待"开工前现场验证闸"通过后进入 plan。
参照实现:Hermes(NousResearch/hermes-agent,Python)的 `gateway/` —— 本 spec 是把其架构移植到 wraith 的 Java 核内 daemon,概念对照见文末指针。

---

## 1. 背景与动机

- 目标:给 wraith 一个 **IM 前端** —— 你在 QQ 单聊里给自己的 bot 发消息,驱动一个常驻的 wraith 会话,回复发回来;危险操作在 QQ 里按钮审批。
- 这条能力与"always-on 定时任务(cron)"**共用同一块 daemon 地基**,但本 spec **只做对话式 v1**;cron / 投递见后续 Spec 2。一次只落一刀,先 de-risk 整条链。
- 已核实的关键平台事实(见 §9 来源):
  - QQ 官方**个人测试级 bot**:单聊(C2C)**被动回复免费**(用户发消息后有回复窗口);**主动消息约 4 条/月**。→ v1 **只做被动对话,不做主动推**;真要主动推是后续、且走 QQ 以外通道(单聊主动配额太小,频道不在本产品范围)。
  - openclaw 扫码绑定 `/lite/create_bind_task` + `/lite/poll_bind_result` 端点**已探活、无 source 门控、无认证即可调**(create→retcode:0+task_id,poll→status:1 PENDING)。→ 可原样移植 Hermes `onboard.py` 的扫码绑定;保底路径:后台手填 AppID/Secret。

## 2. 范围

### 2.1 范围内(v1)
1. `wraith gateway` 常驻子命令(Java 核内,进程内直驱 SessionRunner,一 JVM 多会话)。
2. `wraith gateway bind`:openclaw 扫码绑定,把 `appId / clientSecret / ownerOpenid / workspace` 写进 `~/.wraith/config.json`。
3. QQ 官方 bot **C2C 单聊**:WS 网关(identify/resume/心跳/重连退避)+ REST(`getAppAccessToken`、`POST /v2/users/{openid}/messages`,text/markdown、`msg_seq`、被动 `msg_id`、4000 字分片)。
4. 准入:**deny-all + 单 owner openid 白名单**;入站去重(msg_id / 300s 窗口)。
5. 会话映射:`openid → sessionId` 持久映射,每个 chat 一条**长活会话带历史**,`/new` 重开。
6. 回合驱动:提交 turn、把流式输出**缓冲成整条回复**回发、`turn.failed` 转错误消息、`input_notify` 打字态。
7. **HITL-over-单聊**:`approval.requested` → C2C Approve/Deny 按钮 → `INTERACTION_CREATE` → ACK → `approval.respond`。
8. 红绿测试:单元 + mock QQ WS 集成。

### 2.2 范围外
- **频道 / 群**(彻底不做,单聊-only)。
- **cron / 定时投递**(Spec 2)。
- 媒体收发、多平台、agent 自排期(后续)。
- 服务化部署(launchd/systemd);v1 手动跑 `wraith gateway`。
- **CLI 交互路径任何改动**(零改动约束)。

### 2.3 后续 spec 指针
- **Spec 2 — always-on cron + 单聊-pull 投递**:automations 下沉进 daemon(关应用也跑);cron 结果排队,你戳 bot 时在被动窗口免费吐出(pull,不撞主动配额);真主动推走 OS 通知/邮件另一通道。
- **Spec 3 — cron 富化**:cron 表达式 / 一次性 `once` / per-job 模型与工具集 / agent 自排期。

## 3. 架构

- **形态**:Java 核内新增 `com.lyhn.wraith.gateway` 包 + `wraith gateway` 子命令;进程内直接驱动 **SessionRunner**(满足"新能力只经 SessionRunner"约束)。
- **为何进程内直驱而非走 app-server RPC**:app-server 是 stdio 单客户端,且其 `session.start` 返回 `sess_<纳秒>`、首个 `turn.completed` 换成持久化 id(命名空间分歧 = T12)。进程内直驱 SessionRunner **不经过那根线、不经历换号**,直接握持久 id 自己存映射 → **天然绕开 T12**、天然多会话。
- **组件**(小而专,可独立测):

| 组件 | 职责 | 依赖 |
|---|---|---|
| `QqWsClient` | WS 网关:连接/identify/resume/心跳/重连退避/事件分发 | `QqApiClient`(取网关 URL、token) |
| `QqApiClient` | REST:`getAppAccessToken`、发消息(C2C)、ACK 交互 | config(appId/secret) |
| `QqAdapter` | 入站事件→归一化 `InboundMsg`;出站 `send`;`lastMsgId` 缓存;审批按钮构造/回调解析 | `QqWsClient`/`QqApiClient` |
| `Authorizer` | deny-all + 单 owner openid 白名单 | config(ownerOpenid) |
| `SessionRouter` | `openid → sessionId` 持久映射;长活会话;`/new` | SessionRunner 工厂、`gateway-sessions.json` |
| `ImTurnDriver` | 提交 turn、缓冲回发、approval 往返→QQ 按钮、错误回发 | SessionRunner、`QqAdapter` |
| `GatewayConfig` + `bind` | 读配置;openclaw 扫码绑定 | `~/.wraith/config.json` |

## 4. 组件接口(做什么 / 怎么用 / 依赖)

- **`QqWsClient`**:`connect()` → `GET /gateway` 取 wss → 开连 → Op10 Hello(取 heartbeat_interval,按 80% 心跳)→ 有 `(session_id,seq)` 则 Op6 Resume 否则 Op2 Identify(intents 含 **C2C 消息 + 交互**)→ READY 存 `session_id` → 循环 Op1 心跳、分发 Op0 事件。重连退避 `[2,5,10,30,60]`,`<5s 连断×3` 判致命上抛。回调:`onInbound(rawEvent)`、`onInteraction(rawEvent)`、`onFatal(err)`。
- **`QqApiClient`**:`ensureToken()`(`POST bots.qq.com/app/getAppAccessToken`,2h,singleflight 锁),头 `Authorization: QQBot {token}`;`sendC2C(openid, body)`(`POST /v2/users/{openid}/messages`);`ackInteraction(id)`(`PUT /interactions/{id}` code:0)。
- **`QqAdapter`**:`parseInbound(raw) → InboundMsg{openid, text, msgId, ts, mediaUrls?}`;`send(openid, text, replyToMsgId?)`(格式化 → 4000 字分片 → 逐块带 `msg_seq` 发,首块带 `msg_id` 做被动回复,余块清 `msg_id`);`renderApproval(openid, sessionKey, req)`(带 keyboard `approve:{sessionKey}:{allow-once|allow-always|deny}` 的 C2C 消息);`parseApprovalCallback(buttonData) → (sessionKey, decision)`。缓存 `lastMsgId[openid]`。
- **`Authorizer`**:`isAllowed(openid) → openid == config.ownerOpenid`(deny-all)。
- **`SessionRouter`**:`resolve(openid) → SessionRunner`(查 `openid→sessionId`,进程内 get-or-create,workspace=config.workspace);`reset(openid)`(`/new`:结束旧、清映射);映射持久化到 `~/.wraith/gateway-sessions.json`。
- **`ImTurnDriver`**:`handle(openid, text)` → 若 `/new` 则 `router.reset`;否则 `runner.submitTurn(text)`,订阅事件:`approval.requested`→`adapter.renderApproval` 并挂起等回调→`runner.approvalRespond(...)`;`turn.completed`→缓冲文本 `adapter.send(openid, text, lastMsgId)`;`turn.failed`→发错误消息。长回合期间周期 `input_notify`。
- **`GatewayConfig` + `bind`**:`bind()` 跑 openclaw(`create_bind_task`→展示 QR/URL→轮询 `poll_bind_result`→本地 AES-GCM 解密 secret)→ 写 `appId/clientSecret/ownerOpenid`;`workspace` 由用户在 bind 时或配置里指定。

## 5. 数据流(一轮对话时序)

```
QQ 用户私聊 → WS C2C_MESSAGE_CREATE
  → QqAdapter.parseInbound(去重 msgId/300s)
  → Authorizer.isAllowed(openid)? 否 → 静默丢弃
  → SessionRouter.resolve(openid) → SessionRunner(进程内,workspace=配置)
  → ImTurnDriver.handle(openid, text):
       runner.submitTurn(text)
       ├─ approval.requested → QqAdapter.renderApproval(Approve/Deny 按钮)
       │     → INTERACTION_CREATE → QqApiClient.ackInteraction(id)
       │     → parseApprovalCallback → runner.approvalRespond(decision) → 继续
       ├─ (可选)长回合 → 周期 input_notify 打字态
       └─ turn.completed → 缓冲整条 → QqAdapter.send(openid, text, replyTo=lastMsgId)
                                        # 被动回复,免主动配额
```

## 6. 安全模型

- **准入**:deny-all;仅放行绑定得到的 **owner openid**。非白名单消息静默丢(不回、不报错)。
- **工具面**:IM 会话拿**完整工具集**(shell/写文件/MCP),但**危险操作经 HITL**——复用现有 `approval.requested/respond`,渲染成 QQ C2C 按钮。审批默认模式沿用 wraith 现状(非自动批准)。
- **安全红线(沿用,不可破)**:
  - `appId/clientSecret/token` 只存 `~/.wraith/config.json`(仓库外);**绝不进日志、绝不入库**。提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。
  - openid 日志可截断;attachment 内容不落日志/不持久化 base64。
  - **CLI 交互路径零行为变化**;新能力只经 SessionRunner。

## 7. 错误处理与边界

| 情况 | 处理 |
|---|---|
| WS 断线 | 退避重连 `[2,5,10,30,60]`,按 close code 决定 resume vs 重新 identify;`<5s 连断×3` 判致命、上抛 `onFatal` |
| token 过期 | `ensureToken` 提前 60s 刷新,singleflight 防并发刷 |
| 入站重复 | `msgId` 去重,300s 窗口、上限 1000 |
| 未授权发件人 | 静默丢弃 |
| turn 失败/异常 | 发一条"出错了:<摘要>"回用户;不崩 daemon |
| 被动窗口失效(极端:回合超时/无 msgId) | 退主动发,**记日志告警**(可能撞 4/月配额) |
| `bind` 二维码过期/超时 | 刷新最多 3 次;仍失败则提示改用后台手填 AppID/Secret |
| 危险操作审批超时 | 沿用现有 HITL 超时语义,超时按拒绝 |

## 8. 配置(`~/.wraith/config.json` 增量)

```
"gateway": {
  "qq": {
    "appId": "...",           // bind 写入
    "clientSecret": "...",    // bind 写入(仓库外)
    "ownerOpenid": "...",     // bind 得到的你自己的 openid = 白名单
    "workspace": "/abs/path"  // IM 会话的工作区(v1 单一)
  }
}
```

## 9. 测试计划(红绿)

- **单元**:`SessionRouter` 映射/长活/`​/new`;`Authorizer` 门禁;4000 字分片;`msg_seq` 生成;被动/主动 `msg_id` 决策;WS 事件解析;审批按钮 `buttonData` 往返解析。
- **集成**:**mock QQ WS server**(仿 Hermes 测法)—— 灌 `C2C_MESSAGE_CREATE` → 断言 SessionRunner 收到 turn、断言出站 `POST /v2/users/{openid}/messages`;灌 `INTERACTION_CREATE` → 断言 `approval.respond` 与 ACK。
- **门禁基线(沿用)**:Java 全量 0F/0E BUILD SUCCESS;vitest/E2E 不回归;tsc 0;提交前 key 扫描干净。

## 10. ⚠️ 开工前现场验证闸(用户并行验;任一不成立则先决策再动码)

1. **个人测试级 bot 是否开 C2C 单聊**:沙箱 QQ 私聊 bot,程序端能否收到 `C2C_MESSAGE_CREATE`。
2. **沙箱账号能否收发**:`POST /v2/users/{openid}/messages` 带被动 `msg_id` 能否发出、用户能否收到。
3. **openclaw `/lite/*` 端点**:已探活(create→retcode:0+task_id,poll→status:1)。剩余仅"真扫一次 → status:2 出凭证",属流程本身;保底手填 AppID/Secret。

判据:①②都通 → 平台前提成立、v1 开工;收不到 C2C(只能收频道/群)→ 个人测试级不支持单聊 → 改主体(企业)或换方案,先决策。

## 11. Hermes 概念对照(移植蓝图)

| wraith(本 spec) | Hermes 对应 |
|---|---|
| `QqWsClient`/`QqApiClient` | `gateway/platforms/qqbot/adapter.py`(WS 网关 + REST + token) |
| `bind` openclaw | `qqbot/onboard.py` + `crypto.py`(create/poll/decrypt) |
| `SessionRouter` 会话键 | `session.py` 的确定性 `session_key` + 持久 session(简化:单聊单 owner) |
| `ImTurnDriver` 缓冲回发 | `stream_consumer.py`(简化:QQ 不 edit,整条发) |
| HITL 按钮往返 | `tools/approval.py` + adapter `send_exec_approval` + `resolve_gateway_approval` |
| `Authorizer` deny-all | `authz_mixin.py`(默认 deny + allowlist) |

---

**下一步**:验证闸通过后,交 writing-plans 拆成实现计划(逐单元红绿)。
