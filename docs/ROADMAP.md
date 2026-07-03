# Wraith 桌面化路线图

> 北极星:把 Wraith 从纯 CLI 扩成 **Codex 桌面级 AI agent app**。核心判断:agent 核心已是事件溯源式(只调 `Renderer` 语义方法),桌面化是**加法**(新增事件流出口 + 壳),不重写。
>
> 图例:✅ 已合并 main · 🟡 spec/计划就绪未编码 · ⬜ 未开始。最后更新:2026-07-02。

## 已实现 ✅

| 阶段 | 内容 | 关键产出 |
|---|---|---|
| **P1** 后端协议骨架 | app-server 入口 + `EventStreamRenderer` + stdio JSON-RPC 2.0(JSONL)+ headless harness | `src/main/java/com/lyhn/wraith/runtime/appserver/`;事件流端到端验证 |
| **P2** 沙箱 | macOS Seatbelt(`sandbox-exec`)包裹命令子进程:默认断网、限写、宽读;fail-open 降级 + 警告 | `policy/sandbox/`;`ToolRegistry` 注入 `CommandSandbox` |
| **P3a** 协议补全 + 流式 | 单飞守卫、`session.start` 目录校验、`initialize` 能力位;**工具卡片实时输出**(`tool.output.delta`/`tool.result`,ThreadLocal callId) | `AppServer` 4 参构造;`CommandOutputObserver` |
| **P3b** Electron 壳 | spawn/守护 java、JSON-RPC client、transcript+markdown、可折叠思考块、工具卡片、**最小审批弹窗**、断连横幅、Playwright-electron E2E | `desktop/`(electron-vite + React18 + TS);preload CJS |
| **Phase A** 前门 + 视觉身份 | Wraith 柔和浅色视觉身份(Tailwind + shadcn/Radix token 主题);欢迎空态`今天做点什么？`;富 Composer(**功能**:替我审批开关 + 重选目录;**占位**:附件、模型/强度只读);静态侧栏骨架;5 组件重皮;唯一后端 `session.setApprovalMode`→`hitl.setEnabled(!auto)` | 合并 `174115a`(9 提交);vitest 35 + Playwright 6 + Java 2/2;spec `docs/specs/2026-07-01-desktop-phase-a-front-door.md`、plan `docs/plans/2026-07-01-desktop-phase-a.md` |
| **Phase B** 多会话 + 持久化 + 侧栏 | 单活跃会话:接现有 `SessionStore` 持久化(每轮落盘)、会话列表、**功能侧栏**(新建/切换=resume 静态回放 `messagesToItems`)、重连自动 resume、sandbox 徽标、对话视图加 user 气泡;`turn.completed` 回真实持久化 id 对齐 activeSessionId | 合并 `6d707ac`(9 提交);Java AppServerSessionTest 3/3 + MainInitializeResultTest 3/3 + 回归、vitest 54、Playwright 10/10;spec/plan `docs/*/2026-07-01-desktop-phase-b*.md` |
| **Phase C** 富对话视图 | Monaco DiffEditor(单 editor.worker,只进 renderer):diff **事后卡片**(消费既有 `diff` 事件,wire 键 `file`)+ **审批前预览**(后端 `ApprovalRequest.beforeContent`,512KB 上限三态归 null);**富审批弹窗**(命令编辑→`MODIFIED`、本次放行网络→`allowNetworkOnce`+`grantNetworkOnce` 消费即清含早退兜底、JSON 改参兜底、本会话放行→`APPROVED_ALL`、`suggestion` 展示、key 隔离+提交防重);**token 状态 chip**(消费既有 `status` 事件,App 入口 100ms 节流带 cancel) | 合并 `b6d6447`(16 提交);Java 新测 19(全量 893 维持 3F/38E 基线)、vitest 77、Playwright 16/16、tsc/build 干净;整支终审(Fable)捕获两个跨任务缺陷(diff 键名三方错位、networkOnce 早退泄漏)已修;spec/plan `docs/*/2026-07-02-desktop-phase-c*.md` |
| **Phase D** 项目工作区 | 项目列表 + 单活跃切换(settings `projects` 持久化/迁移播种);侧栏 ProjectSwitcher(Popover):切换自动恢复最近会话、移出/重命名/最近使用排序、失踪目录置灰;Composer 重选目录汇流 addProject(`pickWorkspace` 退役);E2E userData 隔离(`WRAITH_E2E_USERDATA`) | Java 后端零改动;vitest 102、Playwright 25/25;spec/plan `docs/*/2026-07-02-desktop-phase-d*.md` |
| **Phase E-1** MCP 插件管理 | app-server 挂载 McpServerManager(按工作区复用+`reattach` 不搬审批状态);`mcp.*` 九路 RPC + `mcp.status` 通知(异步 startAll);整页插件面板(状态/启停/重启/日志/工具/资源/提示词 + 配置表单 env 不回显);Composer @-mention 两级补全(后端 AtMentionExpander 展开);树式 `McpConfigWriter`(保留未知字段) | Java 新测 27(全量 937 维持 3F/38E)、vitest 115、Playwright 32/32;spec/plan `docs/*/2026-07-02-desktop-phase-e1-mcp*.md` |
| **Phase E-2** 定时任务 | Electron main 调度(30s tick/`computeNextRun` 三档/并发1队列/miss 可见);每次运行独立 app-server 子进程(Java 零改动);**遇审批挂起等人**(复用 ApprovalModal,独立 push channel);结果四件套(会话落盘/运行历史/系统通知/侧栏红点);`automations.json`+`runs.json`(每任务留50) | vitest ~135、Playwright 37/37;spec/plan `docs/*/2026-07-02-desktop-phase-e2*.md` |
| **清债波** Debt Sweep | 三层债全清(14 项+新增 3F 真 bug):**Java 门禁转 0F/0E**(mockito 5.18 清 38E+修 3 真实断言失败);E2E 偶发根因(顺藤揪出 submit→turn.started 产品竞态,markStarted 即 running+turnRef+resetSession 清 turn,编辑重发对称关窗);mcp.enable/restart/disable 异步受理不卡 dispatch;will-quit stopNow 消孤儿;严格并发1(exited 退净再出队,红绿自证);reattach 三步同锁;锚点保留/失踪通知/taskId 前缀/红点涟漪/面板即已读/mock 保真(turnId+configError)/@-mention 过滤/Phase C 批次 | **Java 944 @ 0F/0E(BUILD SUCCESS)**、vitest 155、Playwright 41/41(含 20 连压测);spec/plan `docs/*/2026-07-03-debt-sweep.md` |

提前兑现的旧-P4 项:**工具卡片实时输出**(P3a)、**基础审批弹窗**(P3b);Phase A 交付旧-P4 的**替我审批模式切换** + model 展示(移入 composer);Phase B 交付旧-P4 的**重启重连 / `session.resume` / `sandbox.unavailable`**。

## 进行中 🟡

（无——Phase A、B、C、D、E-1、E-2 已合并 main。下一阶段 **Phase F**（打包:jpackage 裁剪 JRE + electron-builder + 签名/notarize)待启动。）

## 遗留 Minor（后续阶段顺手清)

- ✅ 已清（2026-07-02):Phase A 三项(移除 `class-variance-authority`、Composer `disabled:cursor-not-allowed`、残留 inline style)+ Phase B 五项(list/resume 负路径测试、`currentId()` 直测、`turn.failed` 回归、`loadHistory` 保留字段断言、`handleSelectSession` 补 `fetchSessions`)+ Sidebar 占位 tooltip 阶段编号对齐 D/E。
- ✅ 已清（2026-07-03 清债波):Phase C 批次全部(harness `assertFalse(isAlive)`、`validateArgsJson('')`、DiffCard `aria-expanded`、hover token 化、throttle cancel 紧贴 dispatch)+E-1 三项(reattach 竞态窗/@-mention 候选过滤/mock 保真)+E-2 六项(will-quit 信号/锚点覆盖/红点重亮/失踪通知/taskId 前缀/双子进程窗)+JDK26 噪音与 3 个真实断言失败。
- **清债波终审归档 backlog**:session 级通知过滤(多会话/后台 turn 时升必做);interrupt 钮早窗(turn.submit 回包前点击以旧 turnId 发出,静默丢失可重按);B5 占位窗(settle→exited ≤2s 内 runNow 静默 ok:false/恰落窗 tick 记 miss);**reloadFromConfig/reattach 同步竞争票**(慢 enable 在途时 config.upsert/同工作区 session.start 阻塞 dispatch——disable 已异步化,此二者有响应通道/换绑时序耦合待独立设计);tools/list_changed 回调无锁 replaceTools 同类窗(可复用 finalizeReadyLocked 模式);manager close() 非 synchronized(兜底型);CodeIndex `catch(Exception)` 静默吞异常(实现债);runner spawn 同步抛未包 try(严格并发1后砖死后果,优先级升);mcp.status ERROR 通知链无自动化断言;stderr 多行 chunk 仅首行前缀;submit 本地失败无 UX 提示(仅 console);DiffView 边缘空盒(生产近不可达,Phase C 存留)。
- **待眼验(非自动覆盖)**:重连 auto-resume 真·断连往返;真 `java` 落盘/list/resume 端到端;**Phase C 新增**——真后端 `write_file`→diff 卡片全链路(wire 键 `file` 已按真后端对齐,但未实机验证);真沙箱「本次放行网络」联动(勾选后命令内 `curl` 通、**下一条**命令不通,验证消费即清+早退兜底);**Phase D 新增**——两真实目录来回切:会话隔离(`~/.wraith/sessions/<hash>` 不串)+ 切换自动恢复最近会话 + 移出/重命名落盘 `settings.json`;**Phase E-1 新增**——真 MCP server(如 @modelcontextprotocol/server-filesystem)全链路:添加→ready→模型调用工具→审批弹窗→@-mention 展开;切项目后项目级 mcp.json 重载;「本会话放行」在新会话不残留(reattach 红线);**Phase E-2 新增**——真 30s tick 到点触发一次真任务;macOS 通知实机点击唤起并打开面板;app 退出时运行中任务落 interrupted;审批挂起过夜再处理;**清债波新增(眼验卡A/B)**——真 MCP 慢启动(npx 冷拉)期间主会话正常对话(A1)+ 慢 enable 在途点另一 server「停用」观察延迟生效的 UI 表现(I-2 串行语义);自动化运行中退出 app 后 `ps` 无 wraith 孤儿进程且历史落 interrupted(A2);自动化面板停留期间任务跑完红点不重亮(A4);目录失踪任务收到系统通知(A5);侧栏红点涟漪动效+系统减动效时退静态(B6);submit/编辑重发后手速点重选目录被正确禁止(Task 2 竞态关窗)。以上均需重建 `~/.wraith/wraith.jar`(动现装 CLI,先征求同意)后 `npm run dev` 实机跑。

## 未实现 ⬜(Codex 对齐 A–F,取代旧 P4/P5)

| 阶段 | 内容 | 需后端? | 吸收的旧条目 |
|---|---|---|---|
| **Phase F** 打包 | jpackage 裁剪 JRE + electron-builder + macOS 签名/notarize;CSP 加固 | 构建链 | 旧-P4 CSP / 旧-P5 打包 |

## 旧路线 → 新路线对账

旧 spec §9(`docs/specs/2026-06-30-desktop-shell-v1.md`)是 **P1→P2→P3→P4(富 UI)→P5(打包)**。看过 Codex 桌面截图后重定为 **A–F 的 Codex 对齐超集**:P1–P3 已落地不变;**旧「P4」名字退休**,其条目拆进 B / C(富对话视图);旧 P5 = Phase F。已完成的工作全部保留复用。（注:早期把富对话视图记作 "Phase B.5",现更名 Phase C、项目/插件/打包顺延为 D/E/F,去掉小数命名。）

## 固定约束(跨阶段)

- 栈固定:Java 17 / Maven,包 `com.lyhn.wraith`,跑 DeepSeek;桌面 `desktop/` 子目录(npm,独立于 Maven)。
- v1 仅 macOS 沙箱;Linux(Landlock)/ Windows 留待用户出现。
- 单机单会话(Phase A 止);多会话从 Phase B 起。
- 密钥永不入库;`~/.wraith/config.json` 持有 key(仓外)。
