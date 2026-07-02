# Wraith 桌面端 Phase E-2：定时任务(Automations) 设计 spec

> 日期:2026-07-02 · 前置:Phase E-1 已合并(6dfc3c8) · 决策人:LyHn
> 形态决策:定时任务(Codex Automations 对齐);Electron main 调度,app 开着才跑;
> **遇审批挂起等人**(完整审批链,非只读白名单);结果=会话落盘+面板运行历史+macOS 通知+侧栏红点;
> 调度预设三档(间隔/每日/每周)。

## 0. 背景与关键事实

- 「自动化」无任何现成子系统(cron/watcher/scheduler 全空白)——本期是**净新**领域;
  但执行载体全部现成:app-server 协议(P1)、审批链(P3b/C)、会话持久化(B)、MCP 挂载(E-1)。
- Electron main 已有 spawn/驱动 jar 子进程的全套设施(`spawnBackend`/`resolveBackendCommand`/
  `JsonRpcClient`,`desktop/src/main/index.ts` + `backend.ts`)——后台任务子进程是同款复制。
- **审批挂起在协议层是自然态**:`approval.requested` 发出后 turn 线程阻塞等 `approval.respond`
  (RendererHitlHandler 语义),没人应答=挂起,零后端改动。
- 会话标题 = 首条 user 消息(SessionStore 语义)→ 任务 prompt 即标题,天然可辨识。
- `turn.completed` 携带真实持久化 sessionId(Phase B 对齐)→ runs 跳转会话的钥匙。
- userData JSON 持久化模式已有先例(settings.ts 纯函数 + @TempDir 式单测;
  `WRAITH_E2E_USERDATA` 隔离机制 E-1 已建立)。

## 1. 目标与非目标

### 1.1 目标(E-2 交付)

1. **任务定义与持久化**:name/prompt/项目(从项目列表选)/调度三档/启停;
   userData `automations.json` + `runs.json`(每任务保留最近 50 条运行记录)。
2. **调度器(Electron main)**:30s tick;`computeNextRun` 纯函数;全局并发上限 1(到点排队);
   同任务上次运行未结束则本次跳过记 miss;app 未开不跑、不自动补跑;app 退出 kill 运行中
   子进程并标 `interrupted`。
3. **后台运行器**:每次运行 spawn 独立 app-server 子进程,协议驱动
   (initialize → session.start(projectPath) → turn.submit(prompt)),事件流由 main 聚合;
   跑完(或终止)子进程退出。
4. **审批挂起等人**:子进程 `approval.requested` → run 置 `waiting_approval` + 系统通知 + 侧栏红点;
   用户在自动化面板点开 → **既有 ApprovalModal**(改参/放行网络/本会话放行全套)→ respond
   经 main 转发回对应子进程 → turn 继续。挂起无限期;面板可手动终止该次运行。
5. **AutomationsPanel 整页**(E-1 版式):左任务列表(启停 toggle + 下次运行时间),
   右详情 = 定义表单 + **「立即运行」**按钮 + runs 历史 tab(状态/开始/时长/摘要,
   点击跳转对应会话 = 复用切项目+resume 链路);删除任务二次确认(连带 runs 记录,会话不删)。
6. **结果四件套**:运行即真会话落盘(对应项目会话列表可见);面板 runs 历史;
   macOS 系统通知(waiting_approval 与终态时,点击唤起 app 并打开自动化面板);
   侧栏「自动化」红点(存在 waiting_approval,或有终态运行晚于上次打开面板)。

### 1.2 关键约束

- **Java 后端零改动、协议零新增**(连续第三期;后台子进程用的全是现有 RPC/事件)。
- 后台运行与交互会话进程隔离:绝不复用主子进程(单飞锁不冲突);后台子进程崩溃不影响主会话。
- 审批语义不降级:后台任务默认 ask 模式(审批链完整,挂起才有意义);任务级 auto 覆盖是非目标。
- 密钥红线沿用;`automations.json`/`runs.json` 只存任务定义与运行元数据,不存会话内容。

### 1.3 非目标(推迟)

- 常驻 daemon(app 关了也跑,留待 Phase F 后);cron 表达式;事件触发(文件/git watcher);
  miss 自动补跑;任务级模型/审批模式覆盖;运行并发 >1;暂停中任务的跨 app 重启恢复
  (app 退出即 interrupted)。

## 2. 架构

```
Electron main
 ├─ AutomationScheduler(30s tick, computeNextRun, 并发=1 队列)
 ├─ AutomationRunner(每次运行: spawn jar 子进程 + JsonRpcClient 驱动 + 事件聚合)
 │    child: 既有 app-server(审批链/MCP/持久化全免费)
 ├─ automationsStore(automations.json / runs.json 纯函数,settings.ts 同款)
 └─ IPC + push: renderer AutomationsPanel / ApprovalModal(复用) / Sidebar 红点
```

所有权:任务定义、调度、运行状态归 **main**;renderer 纯展示 + 操作转发。
主会话链路(client/currentSessionId 等)与自动化链路互不触碰。

## 3. 数据模型(userData,main 持有)

```ts
interface AutomationTask {
  id: string                 // uuid
  name: string
  prompt: string
  projectPath: string        // 绝对路径(项目列表中选)
  schedule: Schedule
  enabled: boolean
  createdAt: number          // epoch ms
}
type Schedule =
  | { kind: 'interval'; everyMinutes: number }          // ≥5 分钟,表单下限校验
  | { kind: 'daily'; time: string }                     // 'HH:mm' 本地时区
  | { kind: 'weekly'; weekday: number; time: string }   // weekday 0-6(周日=0)

interface AutomationRun {
  runId: string
  taskId: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'waiting_approval' | 'success' | 'failed' | 'interrupted'
  sessionId?: string         // turn.completed 携带的真实持久化 id
  summary?: string           // 最终助手消息首 120 字
  miss?: boolean             // 该记录表示一次被跳过的到点(上次未结束)
}
```

- 持久化:`automations.json`(任务数组)、`runs.json`(全部任务的 runs,写穿,每任务裁剪至最近 50)。
- 红点判定辅助:main 另存 `lastPanelOpenedAt`(打开自动化面板时 renderer 上报清零)。

## 4. 调度器语义

- `computeNextRun(schedule, now, lastFiredAt | null): number`(epoch ms,纯函数,单测核心):
  - interval:`(lastFiredAt ?? enabled 时刻) + everyMinutes*60_000`;
  - daily:今天 HH:mm,已过则明天;边界:今天该时刻 `>= now` 判「未过」(恰等即触发);
  - weekly:本周 weekday 的 HH:mm,已过则下周(同上边界语义)。
  - 本地时区;**DST 不做特殊处理**(声明:夏令时切换日可能偏移一小时,接受)。
- tick(30s):对每个 enabled 任务,`now >= nextRun` 即到点:
  - 该任务已有 running/waiting_approval 的 run → 记一条 `miss:true` 的 run,不触发;
  - 全局已有运行中的自动化 → 入 FIFO 队列,当前运行结束后立即出队执行;
  - 否则触发运行。`lastFiredAt` 以**触发时刻**更新(miss 也更新,防止连环补触发)。
- 「立即运行」走同一触发入口(绕过 nextRun 判定,同样受并发=1 与同任务互斥约束);
  **不更新 `lastFiredAt`**(手动调试不扰动自动调度节奏)。
- 排队期间同任务再次到点:已在队列则不重复入队(记 miss)。
- app 退出(`will-quit`):kill 全部自动化子进程,其 running/waiting_approval runs 落盘为 `interrupted`。

## 5. 后台运行器

- spawn:与主后端同款 `resolveBackendCommand`(尊重 `WRAITH_APPSERVER_CMD`,E2E 靠它注入 mock);
  独立 `JsonRpcClient` 实例;stderr 转发 main stderr(带 `[automation:<taskId>]` 前缀)。
- 驱动序列:`initialize {clientInfo:'wraith-automation'}` → `session.start {workspaceDir: projectPath}`
  → `turn.submit {input: prompt}`;`turn.completed` → 记 sessionId、status=success、endedAt、kill 子进程;
  `turn.failed` → failed;子进程意外退出(未完成)→ failed(或 interrupted,按是否 main 主动 kill)。
- 事件聚合:main 监听该 client 的全部通知:
  - 助手正文 delta 聚合出 `summary`(最终消息首 120 字;**wire 事件名计划期按 EventStreamRenderer
    实名钉死**,侦察项);
  - `approval.requested` → run 置 waiting_approval + 缓存完整 payload + 通知/红点推送;
  - 其余事件(thinking/tool/diff/status)v1 不转发 renderer(回看走会话落盘)。
- 审批转发:renderer respond → main 依 runId 路由到对应子进程 client 发 `approval.respond`
  → run 回 `running`。
- 手动终止:面板「终止」→ main 对该子进程发 `turn.interrupt`(尽力)后 kill → interrupted。

## 6. 前端(desktop/)

### 6.1 视图与 Sidebar

- App `view` 扩展为 `'chat' | 'plugins' | 'automations'`;侧栏「自动化」nav 启用
  (占位 hint 移除),active 高亮;**红点徽标**(`nav-automations-badge`)按 §1.1-6 条件渲染,
  main 经 push 事件驱动。

### 6.2 AutomationsPanel(整页,新;E-1 PluginsPanel 版式)

- 左列(`automation-item`):名称 + enabled toggle(`automation-toggle`)+ 下次运行时间
  (disabled 显示「已停用」);底部「＋ 新建任务」(`automation-add`)。
- 右详情两 tab:
  - **定义**(`AutomationForm`):name/prompt(多行)/项目下拉(数据=既有项目列表)/调度三档
    (kind 下拉 + 条件字段:分钟数│HH:mm│weekday+HH:mm)/保存(`automation-save`)/
    删除(`automation-remove`,二次确认——破坏性:连带 runs 记录;会话不删)/
    **立即运行**(`automation-run-now`,未保存改动时先保存再跑)。
  - **运行历史**(`automation-runs`):每条 run 状态徽标/开始时间/时长/摘要;
    `waiting_approval` 条目带「处理审批」钮(`automation-approve`)→ 弹**既有 ApprovalModal**
    (payload 来自 main 缓存);running 条目带「终止」钮(`automation-stop`);
    有 sessionId 的终态条目可点击跳转会话(切项目+resume 复用既有链路)。
- turn 运行中(交互会话 busy)不限制自动化面板任何操作(进程隔离,互不冲突)。

### 6.3 IPC 面(main ↔ renderer,全部新增)

- 调用:`automationList()/automationUpsert(task)/automationRemove(id)/automationToggle(id, enabled)/
  automationRunNow(id)/automationStop(runId)/automationRuns(taskId?)/
  automationRespondApproval(runId, approvalId, decision, opts)/automationPanelOpened()`。
- push(main→renderer,走既有 onEvent 通道之外的专用 channel `wraith:automation-event`):
  `{kind:'runs-changed'} | {kind:'badge', show:boolean} | {kind:'approval', runId, payload}`。
- macOS 通知:main 侧 Electron `Notification`;点击 → 唤起窗口 + push 打开自动化面板指令
  (`{kind:'open-panel'}`)。

## 7. 错误处理

- 子进程 spawn 失败/initialize 超时(30s)→ run=failed,summary=错误一行;不重试(下个调度点再说)。
- projectPath 失踪:触发前校验,失败 → run=failed(「项目目录不存在」),任务不自动禁用。
- `automations.json`/`runs.json` 坏 JSON → 按空处理 + stderr 警告(与 settings.ts 容错一致;
  写侧整文件重写,无局部合并需求)。
- respond 路由失败(子进程已死)→ run 已是 interrupted/failed,IPC 返回 `{ok:false}`,面板刷新。
- 通知权限被拒:静默降级(红点与面板仍然工作)。

## 8. 测试策略

- **vitest(纯函数,主战场)**:`computeNextRun` 全分支(三档×已过/未过/首个触发/跨周;DST 声明外);
  automationsStore CRUD/裁剪 50/坏 JSON 容错;红点判定;runs 状态机迁移合法性
  (running→waiting_approval→running→success 等)。
- **Playwright E2E(mock 后端,续 T32)**:调度到点不进 E2E(时钟控制不值);
  以「立即运行」驱动:T33 建任务+立即运行→mock 完成→runs 出现 success+摘要;
  T34 挂起链(mock `MOCK_APPROVAL_TOOL`)→红点+「处理审批」→ApprovalModal respond→完成;
  T35 终止 running;T36 启停 toggle + 删除二次确认;T37 runs 跳转会话(切项目+回放可见)。
  mock 子进程复用 `WRAITH_APPSERVER_CMD`(自动化 spawn 同样尊重它,E2E 天然注入)。
- **Java**:零改动零新测,合并前全量回归基线。
- **待眼验**:真 30s tick 到点触发一次真任务;macOS 通知实机点击唤起;app 退出 interrupted 落盘。

## 9. 范围边界(红线)

- Java/协议零改动;主会话链路(client/currentSessionId/审批槽)零触碰——自动化审批走独立
  channel 与独立 ApprovalModal 实例数据源,不与交互会话的 pendingApproval 槽混用。
- 不做 §1.3 全部非目标项。

## 10. 风险与开放问题

- **每次运行冷启动成本**:子进程 JVM + MCP servers 全量拉起(任务项目配了重 MCP 则更久)。
  v1 接受(任务粒度是分钟级不是秒级);优化(子进程池/复用)留 F 后。
- 助手正文 wire 事件名(摘要聚合依赖)——计划期侦察钉死,防 Phase C 式拍脑袋。
- 审批 payload 的完整形状(beforeContent 等 E-1/C 扩展字段)需原样透传给 ApprovalModal——
  计划期核对 payload 字段清单。
- 队列语义极简(FIFO,不持久化):app 重启队列即空,接受。
