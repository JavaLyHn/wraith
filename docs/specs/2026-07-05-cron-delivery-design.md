# 设计:常驻 cron + 多 IM 投递(v1)

- 日期:2026-07-05
- 流程:superpowers:brainstorming(六段设计逐段过审后整合);spec 批准前不写实现代码。
- 相关记忆:[[wraith-im-cron-direction]]

## 1. 背景与目标

现有桌面 automations 已能"定时跑 agent"(`desktop/src/main/automationScheduler.ts` 30s tick + interval/daily/weekly;`automationRunner.ts` 每次 spawn 一个 `wraith.jar` app-server 子进程跑一轮),但有三个缺口:

1. **只投递到桌面**——结果进 `runs.json` + OS 通知/UI,从不发给任何 IM;
2. **关 app 就停**——scheduler 活在 Electron 主进程里,退出即死(非常驻);
3. **和 QQ 网关完全隔离**——两个子系统零交互。

用户明确:**cron 是核心能力、平台无关**(QQ 推不了主动消息是 QQ 的限制,不该反过来砍 cron);后续不止接 QQ(Telegram 等能主动推)。

**目标**:补上三个缺口——把调度**常驻化**(进已常驻的 Java daemon)+ 加一层**投递抽象**(多 IM),QQ 作为受限适配器(pull/被动),为将来的推送型 IM 预留接缝。

**用途**(用户确认全要):定时产出报告、监控/告警、定时提醒、定时触发外部动作 —— 本质是"通用定时跑 agent + 可选投递"。

## 2. 范围

| 能力 | 本 spec(v1) | 后续 spec |
|---|---|---|
| 常驻调度器(进 Java daemon) | ✅ | |
| Runner(进程内跑回合) | ✅ | |
| `Deliverer` 投递抽象(接口 + 分发) | ✅ | |
| QQ 投递适配器(pull/被动) | ✅ | |
| desktop 投递(观察式 OS 通知) | ✅ | |
| cron 表达式(`0 9 * * 1-5`,标准 5 段 UNIX) | ✅ | |
| 现有 automations 迁移 + 桌面面板改配置编辑器 | ✅ | |
| 三种审批模式 + 按工具 allowlist | ✅ | |
| **推送型 IM(Telegram 等)适配器** | ❌ | ⏳ 各是一个小 spec,套进同一接口 |

**常驻程度**:**本机常驻 daemon**(关桌面 app 后台进程继续跑,只要电脑醒着)。**不上云**;定时在电脑睡/关时不跑,唤醒后按"错过补偿"策略跳过(见 §5)。

**非目标**:云/服务器 24/7 部署;cron 之外的调度表达;跨 daemon 重启的真·挂起恢复(受 ReAct 阻塞模型所限,见 §7);按工具 allowlist 之外的更细粒度沙箱。

## 3. 架构总览

daemon(现 `wraith gateway`,升级为"常驻运行时",同时承载 IM 会话与定时任务;命令名 v1 不改)长出三块新组件,复用已有的进程内会话/回合机制:

```
Java 常驻 daemon(wraith gateway 升级)
├─[已有] QqWsClient → 会话 → 回合 ; Deliverer 的 QQ 适配器复用 QqApiClient
├─[新] Scheduler   30s tick,读定义+状态,决定"到点没"(interval/daily/weekly/cron)
├─[新] Runner      到点→进程内跑一轮 agent(复用 SessionRunner,不 spawn 子进程),
│                  按 per-task approval 策略处理审批
└─[新] Deliverer   跑完→按 deliverTo 投递:QQ 适配器(v1) / desktop(观察式) / 未来 Telegram

桌面 AutomationsPanel → 只配任务(经 app-server RPC 写)+ 看 daemon 报的状态/历史
```

**两进程用文件当接口**(和 `gateway.config` 一个套路):桌面经 app-server RPC 读写文件,daemon 读定义 / 写状态与历史。daemon 无条件起调度器;**QQ 未配置也能跑 cron**(投桌面 / 只跑动作),QQ 适配器仅在绑定 QQ 时注册。

## 4. 数据模型

**任务定义**(在现有 `AutomationTask` 上扩两个字段,`lastFiredAt` 移出到状态文件):

```ts
type Schedule =
  | { kind: 'interval'; everyMinutes: number }        // 距上次 N 分钟(锚点相对)
  | { kind: 'daily';    time: string }                // 'HH:mm' 本机时区
  | { kind: 'weekly';   weekday: number; time: string } // 0-6,周日=0
  | { kind: 'cron';     expr: string }                // 标准 5 段 UNIX,本机时区

type ApprovalMode = 'deny' | 'auto-approve' | 'ask'
interface ApprovalPolicy {
  default: ApprovalMode                                // 默认 'deny'
  tools?: Record<string, ApprovalMode>                 // 按工具覆盖 = 细粒度 allowlist
  askTimeoutMinutes?: number                           // ask 超时,默认 30
}

type DeliveryTarget =
  | { platform: 'qq' }                                 // v1:发给绑定 owner 私聊(单一,无需 chatId)
  | { platform: 'desktop' }                            // v1:OS 通知(仅桌面 app 开着时)
  // 未来:{ platform: 'telegram'; chatId: string } 往同一数组里加

interface AutomationTask {
  id: string
  name: string
  prompt: string
  workspace: string          // 原 projectPath,agent cwd
  schedule: Schedule
  enabled: boolean
  deliverTo: DeliveryTarget[] // 空数组 = 只跑不投(触发动作类)
  approval: ApprovalPolicy
  createdAt: number
  enabledAt: number          // enabled 置 true 的时刻(interval 锚点)
}
```

**运行历史**沿用现有 `AutomationRun`(`runId/taskId/startedAt/endedAt?/status/sessionId?/summary?/miss?`),`status ∈ running|waiting_approval|success|failed|interrupted`。

**存储(单写者/文件,消除双写竞争)**:

| 文件(`~/.wraith/`) | 内容 | 写 | 读 |
|---|---|---|---|
| `automations.json` | 任务**定义** | 仅 app-server | daemon |
| `automation-state.json` | 运行时状态:`lastFiredAt` per task | 仅 daemon | app-server(显示下次触发) |
| `automation-runs.json` | 运行**历史** | 仅 daemon | app-server |
| `qq-pending.json` | QQ 待发投递 + 待批审批(等下次 DM) | 仅 daemon | daemon |
| `automation-requests/`(目录,每请求一文件) | 桌面→daemon 信令:run-now / 审批响应 | app-server 落文件 | daemon 消费+删除 |

所有 json 原子写(temp+rename);reader 容忍缺失/半写(降级空)。请求目录用"一请求一文件 + 消费即删",避免同文件并发写。

## 5. 调度器与 Runner

**Tick 循环**:daemon 起一条后台线程,每 30s tick;每 tick 重读定义 + 状态,对每个 enabled 任务算"下次触发时刻",`now ≥ 下次` 就触发。daemon 主线程仍是 `ws.connect` 阻塞(QQ 已配时),调度器为独立线程。为可测,**下次触发计算是纯函数、注入 `now`**(照搬现有 TS scheduler 的 `computeNextRun` 签名)。

**四种 schedule 的"下次触发"**:
- `interval`:`(lastFiredAt ?? enabledAt) + everyMinutes*60_000`(移植现有)。
- `daily`/`weekly`:本机时区目标时刻,移植现有(含 90s 宽限;DST 不特殊处理)。
- `cron`:交给 cron-utils(`CronType.UNIX`)算"now 之后下一次"。

**错过补偿**(daemon 没跑/电脑睡了):daily/weekly 过点 >90s → 跳到下一天/下周;interval 向前走一步;cron 天然取"now 之后下一次"。每次跳过记一条 `miss=true` 的历史。

**并发**:调度任务跑在**固定大小线程池**(上限 `automation.maxConcurrent`,默认 **3**);到点的多任务并行,超额 FIFO 排队。**同一任务不并发**(该任务有活跃 run 就跳过,沿用现有去重)。调度池与 IM 会话池**分开**,互不拖慢。

**每次触发 = 进程内跑一轮**:在任务 `workspace` 开临时会话,把 `prompt` 当一轮 agent 回合跑(复用 daemon 进程内会话机制,不 spawn 子进程),最终回复即"结果"。跑完交 Deliverer 按 `deliverTo` 投递。回合按 §7 的 approval 策略处理审批。

**运行状态 + 崩溃恢复**:run 生命周期 starting→running→[waiting_approval]→success/failed/interrupted,写 `automation-runs.json`(每任务留最近 50 条,沿用现有 pruning)。daemon 启动时扫非终态旧 run → 标 `interrupted`("上次随进程退出中断")。`lastFiredAt` 由 daemon 内多个并发完成回调写 `automation-state.json`,进程内加锁保证线程安全。

**"立即运行"**:面板点"运行 Now" → app-server 往 `automation-requests/` 落一个 run-now 请求 → daemon 下个 tick 消费并立即跑(不动 `lastFiredAt`)。

## 6. 投递抽象(Deliverer)

**接口 + 分发**:

```java
interface DeliveryAdapter { String platform(); void deliver(DeliveryTarget t, RunResult r); }
```

dispatcher 持 `platform → adapter` 表;任务跑完对 `task.deliverTo` 每个 target 找对应 adapter 投;未知 platform → 记日志跳过;`deliverTo` 空 → 只跑不投。v1 注册 `qq`、`desktop`;将来 `telegram` = 再注册一个,**接口/分发零改动**。

**投递内容 + 抑制**:内容 = 任务名 + agent 最终回复(QQ 侧按 4000 分片,沿用网关)。**抑制约定:最终回复为空/纯空白 → 不投递**(白嫖支持"监控/告警"——prompt 写"有异常才输出,否则啥都别说")。失败的 run 投一条简短错误提示。

**QQ 适配器(pull/被动)**:
- `deliver`:① 结果**入持久化待发队列**(`qq-pending.json`,重启不丢);② 若 owner 在 **60 分钟被动窗口内**(daemon 追踪最近入站 msg_id + 时间)→ 立刻用该 msg_id 被动回复发出,成功则出队。
- 不在窗口内 → 留队列。**下次 owner 私聊(任何话)** → 入站路径先冲刷待发队列("📋 你有 N 条定时结果:…"),用新鲜 msg_id 发。
- **≤4 条/msg_id 限制**:待发多条时**合并成 1–2 条摘要**,不逐条炸。

**desktop 投递(观察式)**:daemon 独立进程、app 可能关着,弹通知是 Electron 的事。所以"投桌面" = daemon 在 run 记录标"该 run 要 desktop 通知";桌面 app 开着读到该终态 run 就弹 OS 通知(复用现有 `notifyOS`:标题「Wraith 自动化任务完成/失败/中断」+ 正文 = summary 末 120 字,点击唤起面板)。app 关着 → 无通知。

**未来推送型 IM 接缝**:接 Telegram = 实现一个能主动推的 `telegram` adapter,`deliver` 直接即发(不需队列/pull),dispatcher 与接口不变。

## 7. 审批(无人值守回合)

定时回合无人盯着,且 QQ 推不出审批按钮,故"交互式等人批"在无人值守下需特殊处理。策略 = §4 的 `ApprovalPolicy`:每次某工具 T 要审批,取 `tools[T] ?? default` → 按模式处理。

| 模式 | 行为 |
|---|---|
| `deny`(默认) | 立即拒(fail-closed),agent 收到"被拒"继续;结果注明"⚠️ N 个需审批操作被拒" |
| `auto-approve` | 立即批,回合照常执行工具(为该任务显式开 = 信任其 prompt + workspace) |
| `ask` | 挂起 `waiting_approval`,把审批推给你,等你批;超 `askTimeoutMinutes` 未回 → 降级为拒,run 终结并注明 |

**`ask` 的审批在哪出现**(复用已有能力):
- **桌面(app 开着)**:面板弹审批(沿用现有 `onApproval`→面板);你点批准/拒绝 → app-server 往 `automation-requests/` 落一条审批响应 → daemon 轮询到即唤醒挂起的回合(延迟 ≤ 一个短轮询间隔)。
- **QQ**:审批入 `qq-pending.json`;**下次私聊**时用内联按钮把审批顶出来(复用已实测的 HITL-over-QQ 键盘);你点按钮 → INTERACTION_CREATE 在 daemon 里**就地 resolve**(交互回调本就在 daemon,无需跨进程)。
- **未来推送型 IM**:能主动推,直接把审批按钮推给你。

**`ask` 的代价(已接受)**:
- **挂起时占一个并发槽**:ReAct 回合内存里阻塞跑,无法序列化到盘再恢复,`ask` 时 worker 停着占槽 → `askTimeout` 别太长;`ask` 用得多把 `maxConcurrent` 开大。
- **daemon 重启丢挂起态**:等待中的 run 遇重启 → 崩溃恢复标 `interrupted`,审批作废、需重跑。
- 故 `ask` 适合"你会较快响应"的任务;"跑一半停几小时"做不到。

**实现**:给定时回合插一个专用 renderer,`promptApproval(tool)` 按解析出的模式:`deny`→立即 REJECTED;`auto-approve`→立即 APPROVED;`ask`→阻塞在审批 future 上(带 `askTimeout`),由桌面响应或 QQ 按钮 tap resolve,超时 REJECTED。复用现有 `ApprovalResult` 与网关 `GatewayRenderer` 同一接口。

**默认最安全**:不配即 `{default:'deny'}`;ask / auto-approve / 按工具 allowlist 均需显式配置才生效,契合 deny-all 基线。

## 8. 桌面侧

- **AutomationsPanel 变配置编辑器**:仍在面板加/改/开关/删任务、看历史,但**不再自己跑**——只经 app-server RPC 写定义、读状态/历史。与 IM 网关面板同构。
- **新 app-server RPC**:`automations.list / upsert / remove / runs`(读写 §4 文件,Java 独占文件、桌面绝不直接碰 fs,沿用红线纪律);`upsert` 时**校验 cron 表达式**(cron-utils),非法拒绝保存 + 明确报错。
- **AutomationForm 扩展**:schedule 加"cron 表达式"输入(与 interval/daily/weekly 并列);加一块审批配置(默认模式下拉 + 可选"按工具覆盖"表);加 `deliverTo` 选择(qq / desktop 多选)。
- **迁移**:桌面首次升级启动,检测旧 `automations.json`(Electron userData)且 daemon 库空 → 逐任务映射(`projectPath→workspace`、`deliverTo=[{platform:'desktop'}]`、`approval={default:'deny'}`、其余原样,`lastFiredAt`→灌 `automation-state.json`)→ 经 upsert RPC 写入 → 在桌面 userData 打"已迁移"本地标记(只迁一次)。**旧文件保留不删**当备份。

## 9. 错误处理与鲁棒性

- 单个 run 失败(回合抛错)→ 标 `failed`,投简短错误,**不影响调度器和其它 run**。
- **坏 cron**:upsert 时 app-server 先校验拒绝;daemon 侧再兜底(遇非法→跳过+日志,不炸)。
- 投递失败:QQ 发失败 → 留待发队列(下次冲刷);desktop app 关着 → no-op。投递是回合后 best-effort,**永不拖垮 run**。
- tick 循环、每个 run 各自 try/catch → 一个坏任务不掀翻调度器。
- daemon 崩溃/重启:非终态 run → 扫成 `interrupted`;`qq-pending.json` + `lastFiredAt` 持久化,重启不丢。
- 文件:原子写 + 单写者/文件;reader 容忍缺失/半写。
- **QQ 未配置也能跑 cron**:调度器无条件起;QQ adapter 仅绑定 QQ 时注册;任务投 qq 而未配 → 留队列 + 日志(不炸)。

## 10. 测试策略(TDD,沿用 Part-A 纯逻辑 / Part-B 集成 两层)

- **纯单测(大头)**:四种 schedule 下次触发(含 cron)、错过补偿、审批解析(`tools[T]??default`)、投递分发(假 adapter)、空回复抑制、QQ 待发入队/冲刷/合并、cron 校验。**注入 `Clock`/`now`** 确保确定性、无 wall-clock flakiness。
- **集成(仿 `GatewayIntegrationTest` + MockWebServer,不起真 socket/LLM)**:到点→跑 mock 回合→假 adapter 投;QQ pull(窗口内即发到 MockWebServer / 窗口外入队 / 下条入站冲刷);ask 模式(挂起→注入响应→恢复;超时→拒);崩溃扫描(非终态→interrupted)。
- **桌面 vitest**:新 RPC(list/upsert/remove/runs)、迁移映射(纯函数)、cron 校验、`AutomationForm` 的 cron 输入 + 审批配置。

## 11. 依赖、门禁、上线

- **依赖**:加 `cron-utils` Maven 依赖(`CronType.UNIX`,标准 5 段)。
- **门禁**:Java 全量 0F/0E;桌面 typecheck + vitest + electron-vite build 全绿;提交前密钥红线扫描(`git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`,只应命中字段名/自指/测试金丝雀)。
- **上线**:完成后 rebuild + 重装 `~/.wraith/wraith.jar`(daemon 需新代码 + app-server 需新 RPC),重启 daemon;桌面重新构建。push 是对外操作,需用户点头。

## 12. 后续 spec(非本次)

- 推送型 IM 适配器(Telegram / Slack / Discord …)——套进 §6 的 `DeliveryAdapter` 接口,`deliver` 主动即发。
- 云/服务器 24/7 部署(若需求升级)。
