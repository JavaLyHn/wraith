# QQ 待发队列 UI 设计稿

日期:2026-07-16
状态:设计已在对话中确认,待写实现计划
背景:cron/多-IM 投递(2026-07-05)已上线;QQ 因平台限制走「被动窗口 + 待发队列」,队列今日不可见。

## 目标

把 `~/.wraith/qq-pending.json` 的积压(定时结果 + 待审批卡片)在桌面可视化:可看、可删单条、可清空;并修一个真实正确性问题——桌面批完审批后,队列里同 approvalId 的过期卡片要跟着清掉。

## 非目标(YAGNI)

- **无「立即发送」按钮**:QQ 无新鲜 msg_id 物理发不出,不做必然失败的按钮;UI 用提示语引导(给机器人发条消息即送达)。
- 不做投递失败告警面板(独立增强)。
- 飞书/企微/微信无此队列(可直推),不做同类 UI。

## 现状锚点

- `QqPendingStore`(`automation/delivery/QqPendingStore.java`):`Pending{taskName, answer, ts, approvalId}`,仅 `enqueue/drainAll/size`;Jackson 原子写(tmp→ATOMIC_MOVE),损坏读降级为空。
- `QqDeliveryAdapter.flush(freshMsgId)`:下次入站 DM 时冲刷——审批项逐条发键盘卡片,普通项合并为一条摘要;发送失败重新入队。
- 桌面↔daemon 信令:AppServer RPC `automations.*`(AppServer.java:843+)+ `RequestInbox`(run-now / 审批响应已走此通道,daemon poller 消费)。

## 设计

### Java 侧

1. **`QqPendingStore` 扩三个方法**(同类 synchronized + 原子写范式):
   - `Pending.id`(String,新增字段):`enqueue()` 时若空则赋 UUID。旧文件里无 id 的遗留项容忍(反序列化为 null)。
   - `List<Pending> snapshot()`:只读副本,不清队。
   - `boolean removeById(String id)`:按 id 删一条;`void clearResults()`:清掉所有 approvalId==null 的结果项。**审批项不可手删**(删了对应 run 会永远卡在 waiting_approval;其唯一出口是批/拒→联动清理),null-id 遗留结果项由 clearResults 覆盖。
2. **RequestInbox 新增请求类型 `qqPendingClear`**:载荷 `{id?: string}`(缺省=清空全部)。daemon poller 消费时在**daemon 持有的 store 实例上**执行 remove/clear——桌面/AppServer 不得直接写该 JSON(跨进程会与 daemon 的 enqueue 竞态;读安全,写必须经 daemon)。
3. **审批联动清理(正确性修复)**:daemon 处理审批响应(现有 RequestInbox 审批信令)时,顺带 `removeByApprovalId` 清掉队列中同 approvalId 的待发卡片,避免下次冲刷发出已失效的键盘消息。`QqPendingStore` 相应加 `removeByApprovalId(String)`。

### AppServer RPC(桌面读写入口)

- `automations.qqPending` → `{items: [{id, taskName, answerPreview, ts, kind: 'result'|'approval', approvalId?}], count}`。实现:AppServer 直接 `new QqPendingStore(~/.wraith)` 调 `snapshot()`(原子写保证读到完整旧/新文件;answer 截断 ~120 字为 preview,全文不外传——runs 历史里已有)。
- `automations.qqPendingClear` → 写 RequestInbox `qqPendingClear` 请求(`{id?}`:带 id 删单条结果项,缺省=clearResults),立即返回 ack(最终一致,UI 下轮轮询刷新);daemon 侧对带 approvalId 的目标拒绝执行(防御)。

### 桌面侧

- preload 暴露 `qqPending()` / `qqPendingClear(id?)`。
- **AutomationsPanel**:
  - 顶部徽标 `QQ 待发 N`(N>0 时显示;复用现有 runs 轮询节奏一并拉取)。
  - 待发区块(N>0 时渲染):审批项(⚠️,置顶高亮,提示「在运行历史中审批」——审批操作本身复用既有 runs 的 respondApproval UI,不重复造)、结果项(📋,taskName + preview + 相对时间 + 行内 ✕)。
  - 底部固定提示:「QQ 仅支持被动回复:给机器人发任意一条消息,以上将自动送达」+ `清空结果`(confirm 一次;只清结果项,审批项不受影响)。

## 错误处理

- snapshot 读损坏文件 → 空列表(沿用 store 既有降级);UI 显示为无积压。
- clear 请求与并发冲刷竞态:daemon 在实例锁内执行,drainAll 之后到达的 remove 自然 no-op(id 已不在),幂等。
- RPC 在 daemon 未运行时:读仍可用(直接读文件);clear 请求会积压在 inbox 待 daemon 起后消费——UI 不需特殊处理,提示条已说明依赖 daemon。

## 测试

- Java 单测:snapshot 不清队;removeById 幂等 + 遗留 null-id 容忍 + 拒删审批项;removeByApprovalId;clearResults 不动审批项;审批响应联动清理(daemon 处理器层)。
- AppServer dispatch 测试:qqPending 返回形状 + preview 截断;qqPendingClear 写 inbox。
- 桌面:纯函数测(排序=审批置顶再按 ts 倒序、preview/相对时间格式化);typecheck 0 + vitest 基线不降。
- 测试不得写真实 `~/.wraith`(用临时目录,沿用既有 store 测试范式)。

## 安全

- 不涉密钥;RPC 只暴露任务名 + 结果截断预览(内容已在 runs 历史中可见),无新暴露面。
