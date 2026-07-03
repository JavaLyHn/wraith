# 清债波(Debt Sweep)设计 spec

> 日期:2026-07-03 · 分支:`feat/debt-sweep` · 定位:Phase F(打包)前的全量债务清理
> 决策(用户已确认):**全清**三层债;Java 3F/38E 噪音**时间盒尝试**;**边清边验**(每域清完即实机验证,不等全部完成)。
> 债目全部来自各阶段评审留档(`.superpowers/sdd/progress.md` 与 ROADMAP 遗留 Minor 节),本 spec 不新增功能。

## 0. 目标与非目标

**目标**:清空 A/B/C 三层债目,使打包阶段面对的是零已知缺陷、门禁全绿稳定(无偶发)、真链路经过实机验证的代码库。

**非目标**:打包本身(Phase F);多会话并行、模型/强度切换、附件、事件触发/工作流自动化、Linux/Windows 沙箱(均为后续方向,不属债)。

## 1. A 层:功能债(用户可感知,6 项)

### A1 (Java) `mcp.enable`/`mcp.restart` 阻塞 dispatch 线程
- **来源**:E-1 Task 4 评审 backlog(当时挂"E-2 票"未还)。
- **现状**:`AppServerMcp.enable/restart`(AppServerMcp.java:131/133)在 dispatch 线程同步调 `McpServerManager.enable/restart`(McpServerManager.java:243/203)——两者 `synchronized` 且同步 `start(server)`(spawn 子进程+initialize 握手,秒级)。期间**所有 RPC(含主会话 turn.submit)被卡死**。
- **修法**:只改 AppServerMcp 层,manager 同步语义保留给 CLI:`enable/restart` 把实际启动提交到 daemon 执行器立即返回(RPC result 形如 `{accepted:true}`);结果经既有 `mcp.status` 通知链(STARTING→READY/ERROR)到达,桌面端 E-1 已实现 status→refetch,无需新 UI。preload/渲染端同步适配返回值形状(以实际消费点为准,PluginsPanel 若依赖同步结果串改为乐观+状态驱动)。
- **验收**:Java 新测(enable 返回即刻;状态经通知到达;dispatch 线程不阻塞——可用慢 fixture 证明 enable 挂起期间另一 RPC 可完成)。实机:启用一个真 MCP server(npx 拉包,数秒)期间主会话正常对话。

### A2 will-quit 不实际发信号(E-2 终审 M8)
- **现状**:`AutomationRunner.stop()` 只发 turn.interrupt RPC+排 500ms unref 定时器;will-quit 同步返回后 app 退出,定时器永不触发,SIGTERM 从未送达,靠子进程 stdin EOF 兜底;JVM 的工具孙进程可能残留。
- **修法**:Runner 增同步终止路径(如 `stopNow()`:立即 SIGTERM+清 timer,不等宽限;interrupted 落盘路径不变),`stopAll()` 改用它。正常 stop() 的 500ms 宽限语义不变。
- **验收**:fake-child 单测(stopNow 后立刻收到 SIGTERM)。实机:自动化运行中退出 app,`ps` 无 wraith 相关孤儿进程,运行历史该条为 interrupted。

### A3 renderer 全量回写覆盖 lastFiredAt(E-2 终审 M4)
- **现状**:表单保存/toggle 全量回写 task 对象,若调度器在 fetch 与 save 之间触发过该任务,旧 `lastFiredAt` 写回 → interval 锚点回退可提早重复触发。
- **修法**:main 侧 `automationUpsert` 对已存在任务**忽略 renderer 传入的 lastFiredAt,保留 store 现值**(新任务用传入值)。
- **验收**:store/IPC 层单测:并发窗口模拟(先 upsert 新 lastFiredAt 再以旧值回写,断言保留新值)。

### A4 面板停留期间红点重亮不清(E-2 终审 M7)
- **现状**:`automationPanelOpened` 仅面板 mount 时上报一次;停留期间新终态到达 → badge 重亮,直到重进面板。
- **修法**:面板可见即已读——面板存活期间收到 runs-changed 事件时(debounce 后的拉取回调里)再次调 `automationPanelOpened()`;main 的 panelOpened 处理已会回推 badge(现算),红点即清。
- **验收**:E2E:面板停留中触发一次运行至终态,断言红点不亮(或亮后随事件消)。

### A5 目录失踪的 failed run 不发系统通知(E-2 终审 M3)
- **现状**:fire 前 statSync 校验失败落 failed run 走 putRun+onRunsChanged,但不经 finishRun/onTerminal → 无 macOS 通知(spec §1.1-6 终态应通知)。
- **修法**:该路径补调 onTerminal(或等价 notifyOS)——与 finishRun 的通知语义一致。
- **验收**:单测(校验失败路径 onTerminal 被调)。

### A6 自动化子进程 stderr 前缀缺 taskId(E-2 终审 M1)
- **现状**:Runner 的 stderr 转发无标识;多任务排查时无法归属。spec §5 要求 `[automation:<taskId>]` 前缀。
- **修法**:转发行加前缀。**验收**:单测断言前缀格式。

## 2. B 层:打磨债(6 项)

### B1 (Java) reattach 在途 READY 窗(E-1 终审 backlog)
- **现状**:`McpServerManager.reattach`(McpServerManager.java:559,synchronized)与 startAll 在途 worker 的 READY 转换(约 :445-450)存在窗口:worker 持有旧 registry 引用完成注册,reattach 换 registry 后该 server 工具落在旧 registry。
- **修法**:以代码实测为准——最小方案:worker 注册前二次读 volatile registry 引用/或注册经统一入口读当前 registry;补并发单测(reattach 与延迟 READY 交错)。
- **验收**:新 Java 并发测试;既有 McpServerManagerTest 全绿。

### B2 @-mention 不可展开候选未过滤(E-1 终审 backlog)
- **现状**:补全列表含选中后无法展开的候选(以 E-1 AtMentionExpander/补全数据流实际为准)。
- **修法**:补全数据源过滤不可展开项;**验收**:vitest(mentionTrigger/候选过滤)。

### B3 mock 保真:configError 场景 + turnId(E-1 终审 backlog)
- **现状**:mock-appserver 无 configError 注入能力、turnId 不保真——E-1 终审证实 mock 保真缺口会掩蔽真缺陷(工具列表永久空、T35 interrupted 假象两例在案)。
- **修法**:fixture 增 `MOCK_MCP_CONFIG_ERROR` 注入与 turnId 透传保真;补一条 E2E 用 configError 断言插件面板降级横幅(E-1 终审 I1 的修复至今只有 Java 侧测试)。
- **验收**:新 E2E 绿;既有 37 例不回归。

### B4 Phase C 遗留批次(ROADMAP 在册)
- 可及性:DiffCard 折叠钮/ThinkingBlock `aria-expanded` 等一并补齐;
- 深色主题 hover 色修正;
- `statusThrottle.cancel` 紧贴 `resetSession` dispatch(理论时序窗);
- 审批 harness 测试 `join` 后补 `assertFalse(server.isAlive())`;
- `validateArgsJson('')` 边界测试。
- **验收**:各自单测/E2E 断言;可及性用 role/aria 断言。

### B5 E-2 双子进程窗(终审 M6):严格并发 1
- **现状**:换任务瞬间旧 child(SIGTERM→SIGKILL ≤2s 窗)与新 child 可并存。
- **修法**:Runner 暴露"child 已完全退出"信号(exit 已有钩子);scheduler drain 出队 fire 前若旧 child 未退,延迟到 exit 回调再继续 drain(保持全同步不变量:exit 回调里调 drainQueue)。
- **验收**:fake-child 单测(慢退子进程下第二任务的 spawn 时刻晚于第一 child exit)。

### B6 E-2 微项打包(一个任务顺手清)
- 坏 JSON warn 的 console.warn spy 断言;坏 JSON 场景补 `readLastPanelOpenedAt` 断言(Task 1 遗留);
- `waiting_approval` 与 `failed` 状态色区分(waiting 用 warning 色);
- AutomationRuns stop 按钮 then 链改 async 风格(与文件一致);
- computeNextRunLabel 对 `enabledAt=0` 历史日期显示兜底(显示"—"或"待触发")。
- **验收**:相应 vitest 断言。

## 3. C 层:测试基建(2 项)

### C1 workspace-switch E2E 偶发根因(E-2 收尾新档)
- **现象**:`workspace switch re-picks dir` 在机器高负载时 turn 卡 30s+(workspace-switch 钮 disabled 超时),BASE 与 HEAD 失败率一致(~19-25%),既有问题。
- **修法**:系统化调查(systematic-debugging):mock 侧加时间戳日志、record 文件对照、renderer 事件到达 instrumentation,定位 turn.completed 在 mock→main→renderer 链上的停滞点;修根因。若根因证实为纯环境(如 Electron 冷启动抖动),以非 sleep 的确定性等待改造该用例并记录证据。
- **验收**:`--repeat-each=20 --workers=1` 全绿(此前 BASE 挂 5/20)。

### C2 Java 3F/38E 环境噪音(时间盒)
- **现状**:全量 939 恒有 3F/38E,JDK26+Mockito 兼容问题,每次回归人工对基线,mvn 恒非零退出。
- **时间盒协议**:一个 SDD 任务,两步止损——①诊断:抓 38E 实际堆栈,确认是否 Mockito/ByteBuddy 版本不支持当前 JDK 字节码级别;②若"升级 mockito-core/byte-buddy 版本(pom 一处)+ 全量转绿"可达即执行,得到 **0F/0E 新基线**;若诊断显示需 JDK 降级/大版本迁移/多处 API 适配,立即止损:实现者返回 BLOCKED + 诊断报告,基线维持文档化。
- **验收**:成功路径:全量 939 0F/0E,mvn 退出码 0(后续门禁简化);止损路径:诊断报告入 docs/,ROADMAP 记明原因。

## 4. 边清边验机制

- 任务按域分组,**C 域(基建)先行**:C1 先修让每个后续任务的 E2E 门禁可信;C2 先试,若成功则 A1/B1 的 Java 改动在 0F/0E 新基线下验证。之后 **A 域(功能债)→ B 域(打磨)**;A1/B1 含 Java 改动,A 域完成后即重建 `~/.wraith/wraith.jar`(用户已授权;备份 `wraith.jar.bak-20260702*` 在)。
- 每域清完:controller 先跑 headless 可验部分(jar 管道 smoke,如 E-1 先例);再给用户一张 **≤5 分钟眼验小卡**,把该域新修项与 ROADMAP 在册旧欠项(B/C/D/E-1/E-2 真链路)合并勾销,穿插进行。
- 全部眼验完成后 ROADMAP「待眼验」节清空,方可进 Phase F。

## 5. 测试与门禁

- Java 全量:939 @ 3F/38E 基线(C2 成功则切 0F/0E 新基线,以后者优先);
- vitest:143 + 新增(各任务 brief 钉数);Playwright:37 + B3 新增,C1 修后加压测门禁(20 连全绿);tsc 0;
- 秘钥纪律、`.superpowers/sdd/` 不入库、trailer 规则沿用;E2E 一律 `WRAITH_E2E_USERDATA` 隔离、零 sleep。

## 6. 风险与止损

- C2 兔子洞风险由时间盒协议兜住(BLOCKED 即止损)。
- A1 是本波唯一 wire 契约变更(enable/restart 返回形状),桌面端消费点须同任务内同步适配并有 E2E 覆盖;CLI 路径不动 manager 同步语义,零影响。
- C1 若根因不可确定性复现,允许"确定性等待改造+证据记录"作为降级出口,不允许加 sleep 或跳测。
