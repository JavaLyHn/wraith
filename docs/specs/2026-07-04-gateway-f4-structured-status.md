# F-4:网关结构化连接状态(可靠的"已连接"灯)

- 日期:2026-07-04
- 前置:Phase F(`2026-07-04-desktop-phase-f-im-gateway.md`)已落地并真机点验;本文是其 deferred 项 F-4。

## 问题

桌面「IM 网关」屏的状态灯目前**只反映进程存活**:`GatewayManager` 在 `proc.on('spawn')`(子进程起来)时就把状态置为 `running`。这跟 QQ WebSocket 是否真的连上、认证是否通过**无关**——进程活着但 WS 反复 4004 认证失败时,灯依旧显示"运行中",是假绿。

WS 生命周期(`WS opened` / `READY` / `WS closed` / 连续 4004 放弃)现在只经 slf4j 进日志**文件**,桌面端读不到。

## 目标

让 Java 网关在**连接状态切换**时,往 **stdout** 打一行**稳定、机器可读**的标记,桌面端解析它点亮状态灯。取代"进程活着=已连接"的猜测,且与日志格式解耦(不靠正则日志文本)。

## 线协议

daemon stdout 上单行标记:

```
WRAITH_GATEWAY_STATUS <state>
```

`<state>` ∈ `{connecting, connected, disconnected, auth-failed}`(小写,下划线转连字符)。

发射点(Java `QqWsClient`):

| 状态 | 触发 |
|---|---|
| `connecting` | 每次进入 connect 尝试(含重连)时 |
| `connected` | 收到 `READY`(op 0,t=READY)—— WS 已认证、会话已建立(真·连上) |
| `disconnected` | WS `onClosed` / `onFailure`(断开,即将按 backoff 重连) |
| `auth-failed` | 连续 3 次 4004 认证失败、放弃前(终态,随后进程退出) |

选 `READY` 而非 `onOpen` 作为 `connected`:`onOpen` 只是 socket 打开,尚未认证;4004 认证失败恰恰发生在 `onOpen` 之后。`READY` 才是"认证通过 + 可收发"的真信号。

## Java 改动(`QqWsClient`)

- 新增 `public enum ConnState { CONNECTING, CONNECTED, DISCONNECTED, AUTH_FAILED }`,含纯函数 `wire()`(→ 线字符串)。
- 新增实例字段 `onState`(`Consumer<ConnState>`,默认 no-op),经**包私** `setStateListener` 注入(测试用),并由 `connect` 的三参重载设置。
- `connect(onC2C, onInteraction, onState)` 三参重载:设 `onState` 后跑原循环;保留二参重载 → 委托到三参 + no-op(现有调用/测试不破)。
- 在上表四个点发射 `onState.accept(...)`。`READY` 发射在 `handleFrame`(包私缝,可单测);其余在 socket 循环 / listener(Part B,eye-verify + 本发射的单测覆盖 wire + READY)。

## Java 改动(`GatewayDaemon`)

- 组装 `onState`:`state -> System.out.println("WRAITH_GATEWAY_STATUS " + state.wire())`,传入 `ws.connect(...)` 三参重载。stdout 与 logback(文件)解耦。

## 桌面改动

- `shared/gateway.ts`:`GatewayState` 语义收紧——`running` = 真·已连接;类型不新增。
- `main/gatewayManager.ts`:
  - 新增纯函数 `classifyGatewayStatusLine(line): GatewayStatus | null`,解析标记 → 映射:
    - `connecting` → `{state:'starting', message:'连接 QQ 中…'}`
    - `connected` → `{state:'running'}`
    - `disconnected` → `{state:'starting', message:'连接断开,重连中…'}`
    - `auth-failed` → `{state:'error', message:'认证失败——凭证可能失效,请检查机器人密钥'}`
    - 其它行 → `null`
  - `GatewayManager.start()`:`spawn` → 置 `starting`(不再直接 `running`);stdout 行经 `classifyGatewayStatusLine` → `setStatus`;`stopping` 时忽略状态行(避免关停瞬间闪 `starting`);`error` 态记入 `lastErr`,好让退出处理器沿用该文案而非通用"进程退出"。

## 测试(TDD)

- Java `QqWsClientLogicTest`:`ConnState.wire()` 四值映射;`handleFrame` 喂 `READY` 帧 → `onState` 收到 `CONNECTED`。
- 桌面 `gatewayManager.test.ts`:`classifyGatewayStatusLine` 四状态 + 未知/无关行 → null。

## 门禁

Java 全量 0F/0E;桌面 typecheck + vitest + electron-vite build 全绿。改动后 rebuild + 重装 `~/.wraith/wraith.jar`(旧 jar 不发标记 → 灯停在 `starting`;桌面「启动网关」spawn 的是新 jar 才有真绿灯)。

## 非目标

- 不做心跳延迟 / 队列深度等细粒度指标(YAGNI)。
- 断开原因(close code)暂不随标记透传;v1 用固定文案。
