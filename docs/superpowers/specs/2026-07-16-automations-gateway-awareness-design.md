# 自动化面板网关感知 + QQ 待发投递反馈 设计稿

日期:2026-07-16
状态:设计已与用户逐点确认(修复范围、刷新机制),待用户审阅本 spec
背景:cron/多-IM 投递已上线;QQ 待发队列 UI(2026-07-16)刚合入。真机使用暴露两个 UX 坑。

## 目标

让自动化面板**如实反映后端实时状态**,修两个坑:
- **坑 A(网关感知)**:调度器只在 `wraith gateway` daemon 里跑(`GatewayDaemon.java:113` 是全仓唯一 `new Scheduler`),桌面自动 spawn 的 app-server 不含调度器;gateway 仅在用户于「IM 网关」屏点「启动网关」才起,而该键 `disabled={!anyBound}`(须先绑 IM)。后果:没绑 IM/只投桌面通知的人从桌面起不了调度器;任务卡「● 运行中」只看 `t.enabled`(`AutomationsPanel.tsx:139`),网关没跑也显示"运行中",误导。
- **坑 B(投递反馈)**:QQ 入站消息触发 `QqDeliveryAdapter.flush()`→`drainAll()` 清空并发出,但这发生在 gateway daemon 进程内,桌面 `fetchQqPending` 只在 mount/runs-changed/用户删除后刷新,**flush 无任何触发** → 已投递的待发条目在面板上不消失,直到 remount。

## 确认的决策(用户)

- 修复范围:**提示条(头部胶囊)+ 修任务卡标签**;**不**动 IM 面板启动键的 anyBound gate。
- 刷新机制:**事件驱动 + 轻轮询兜底**(flush 打 stdout 标记 → 桌面即时刷新 + 「已投递」提示;面板开着时每 ~6s 轻轮询兜底,覆盖终端起的网关/漏标记)。
- 头部胶囊放法、"已启用·网关未运行"文案、一键启动不弹确认(只附副作用提示)——随推荐方案一并确认。

## 全局约束

- 复用既有 `GatewayStatus`/`GatewayState`(`stopped|starting|running|error`)、`gatewayStatus()`/`onGatewayEvent`/`gatewayStart()` 桥(全已存在,无新增后端管道)。
- 一键启动直接调 `gatewayStart()`,**绕开 anyBound gate**(cron 不需 IM;`GatewayDaemon` 无 provider 也跑 cron)。
- desktop typecheck 0;vitest 基线不降;Java `mvn package` 通过;不写真实 `~/.wraith`。
- 不改调度器架构(scheduler 仍在 gateway daemon);不动 IM 面板。

---

## Part A — 网关感知(纯桌面渲染)

### A1. 头部「网关状态胶囊」
放自动化面板头部行(与「QQ 待发 N」徽标同一行,右侧)。按 `gatewayState` 四态:

| 网关态 | 胶囊 | 交互 |
|---|---|---|
| `stopped` | ⚠ 琥珀「网关未运行 · **启动网关**」 | 点「启动网关」→ `window.wraith.gatewayStart()` |
| `starting` | 「网关启动中…」灰、不可点 | — |
| `running` | ● 绿「网关运行中」 | 纯状态,无按钮 |
| `error` | ✕ 红「网关异常 · **重试**」(带 `status.message` 摘要,若有) | 点「重试」→ `gatewayStart()` |

- `stopped`/`error` 态胶囊下附一行轻提示:「启动后会连上已绑定的 QQ/飞书/微信」(告知副作用;不弹确认)。
- 状态来源:mount 时 `gatewayStatus()` 取初值 + `onGatewayEvent` 订阅 `status` 事件更新(cleanup 退订)。

### A2. 任务卡副标签 gateway-aware
`AutomationsPanel.tsx:139` 现为 `t.enabled ? '● 运行中' : '⏸ 已暂停'`。改为调纯函数 `taskStatusLabel(enabled, gatewayState)`:

| 条件 | 标签 |
|---|---|
| `!enabled` | `⏸ 已暂停` |
| `enabled` 且 `gatewayState==='running'` | `● 运行中` |
| `enabled` 且 `gatewayState!=='running'`(stopped/starting/error) | `已启用 · 网关未运行`(灰,不称"运行中") |

第二行 `下次 MM-DD HH:mm`(`computeNextRunLabel`)保持不变(仅 enabled 时显示)。

---

## Part B — flush 投递反馈(跨 Java + 桌面)

### B1. Java:flush 成功打 stdout 标记
- `QqDeliveryAdapter.flush(String freshMsgId)` 返回类型由 `String` 改为 **`int`** = 本次**实际投递成功**的条目数(drained 总数 − 发送失败被重新入队的数;审批项 + 普通项都计)。当前返回值在 `QqProvider.java:102` 被忽略,改签名安全。
  - 内部:普通项合并成功发送计 `plain.size()`;每条审批项发送成功各计 1;失败重新入队的不计。空队列返回 0。
- `QqProvider.java:102` 改为:`int n = qqDeliverRef.flush(inbound.msgId()); if (n > 0) System.out.println("WRAITH_QQ_FLUSHED " + n);`——与既有 `WRAITH_GATEWAY_STATUS`(:130)同一 stdout 机读标记范式。

### B2. 桌面主进程:解析标记 → 派事件
- `desktop/src/shared/gateway.ts` `GatewayEvent` 联合增:`| { kind: 'qq-flushed'; count: number }`。
- `gatewayManager.ts` stdout 行处理(:204-208,现调 `classifyGatewayStatusLine`)增:匹配 `^WRAITH_QQ_FLUSHED (\d+)$` → `this.onEvent({ kind: 'qq-flushed', count })`。抽一个纯函数 `parseQqFlushedLine(line): number | null` 便于单测(与 `classifyGatewayStatusLine` 并列导出)。
- 该行同时仍走 `pushLog`(日志区可见)。

### B3. 桌面渲染:即时刷新 + 提示 + 轮询兜底
- `AutomationsPanel` 的 `onGatewayEvent` 处理:
  - `status` 事件 → 更新 `gatewayState`(驱动 Part A 胶囊/标签);
  - `qq-flushed` 事件 → `fetchQqPending()`(条目消失)+ 弹 3 秒轻提示 **`✓ 已投递 {count} 条到 QQ`**(面板内顶部瞬态条,自动消失)。
- **轮询兜底**:面板 mount 时起 `setInterval(fetchQqPending, 6000)`,unmount 清除。仅刷新(条目消失),**不弹提示**(避免"计数下降"启发式误报;提示只由 `qq-flushed` 事件产生)。覆盖终端起的网关(其 stdout 不被桌面 GatewayManager 读)或漏标记场景。

### 交互链
```
QQ 入站 DM → GatewayDaemon(QqProvider inbound)→ flush() 发送 + drainAll 清空 → 返回 n
 → System.out.println "WRAITH_QQ_FLUSHED n"
 → (桌面管理的 gateway)GatewayManager 解析 → onEvent{kind:'qq-flushed',count:n}
 → 主进程转发 wraith:gateway-event → AutomationsPanel
 → fetchQqPending()(条目消失)+ toast「✓ 已投递 n 条到 QQ」
[兜底] 面板每 6s fetchQqPending() — 终端起的网关也能在 6s 内消失(无 toast)
```

---

## 文件与拆分

- **新** `desktop/src/renderer/lib/gatewayGate.ts`(纯函数,可单测):
  - `taskStatusLabel(enabled: boolean, gatewayState: GatewayState): string`
  - `gatewayPillView(status: GatewayStatus): { text: string; tone: 'ok'|'warn'|'err'|'muted'; action: 'start'|'retry'|null; hint?: string }`
- **改** `desktop/src/main/gatewayManager.ts`:导出 `parseQqFlushedLine`;stdout 处理派 `qq-flushed` 事件。
- **改** `desktop/src/shared/gateway.ts`:`GatewayEvent` 增 `qq-flushed`。
- **改** `desktop/src/renderer/components/AutomationsPanel.tsx`:接 `gatewayState` + 胶囊 + :139 标签改调纯函数 + `qq-flushed`→刷新+toast + 6s 轮询。
- **改** `src/main/java/com/lyhn/wraith/automation/delivery/QqDeliveryAdapter.java`:`flush` 返回 `int`(成功投递数)。
- **改** `src/main/java/com/lyhn/wraith/gateway/qq/QqProvider.java`:`:102` 打 `WRAITH_QQ_FLUSHED` 标记。
- 复用:`gatewayStatus`/`onGatewayEvent`/`gatewayStart` 桥、`GatewayStatus`/`GatewayState` 类型、`computeNextRunLabel`。

## 测试

- **纯函数 vitest**:`taskStatusLabel` 三态 ×(running/stopped/starting/error)矩阵;`gatewayPillView` 四态(text/tone/action/hint);`parseQqFlushedLine`(合法 `WRAITH_QQ_FLUSHED 3`→3、非匹配→null、非数字→null)。
- **Java**:`QqDeliveryAdapter` flush 返回数正确(空→0、纯项→plain 数、含审批→计入、发送失败重入队不计)——扩现有 `QqDeliveryAdapterTest`/`QqDeliveryAdapterApprovalFlushTest`,断言从"digest 字符串"改为"返回计数"(旧断言按新签名调整)。
- typecheck 0;vitest 基线不降;`mvn package` 通过;相关 Java 测试类绿。
- 眼验:网关停→面板胶囊「网关未运行·启动网关」+ 任务卡「已启用·网关未运行」;点启动→变「运行中」+ 任务卡「● 运行中」;QQ 发消息→待发条目消失 + 弹「✓ 已投递 N 条到 QQ」。

## 风险 / 边界

- flush 部分失败(某些项重入队):返回数只计成功项,提示「已投递 N 条」与实际相符;失败项留在队列、下次入站再冲刷。
- 终端起的 gateway:其 stdout 不被桌面读 → 无 `qq-flushed` 事件、无 toast;6s 轮询仍让条目消失(降级可接受)。
- `error`/`starting` 归"网关未运行"档:任务卡不称"运行中",保守但不误导。
- 6s 轮询仅面板打开时;读的是本地小 JSON(app-server RPC),开销可忽略;unmount 必须清 interval 防泄漏。
- 一键启动连上所有已绑定 IM(单进程服务全平台),胶囊下提示已告知,不弹确认(与 IM 面板行为一致)。

## 不做(YAGNI)

- 不改 IM 面板启动键 anyBound gate;不弹启动确认;不做 per-row「✓ 已投递」逐条动画(用顶部瞬态条即可);不给终端起的网关补 toast;不改调度器架构。
