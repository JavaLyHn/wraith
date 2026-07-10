# 桌面「安全策略 + 审计」查看(roadmap #6)

**日期:** 2026-07-11 **状态:** 设计定稿,准备实现 **依赖:** roadmap `2026-07-10-desktop-cli-capability-gap-roadmap.md` #6

## 目标

补齐 CLI 的 `/policy` + `/audit [N]` —— 桌面新增「安全」侧栏视图:**只读**展示安全策略状态(路径围栏/命令黑名单/危险工具/限额)+ 危险工具审计链。纯只读、零外部依赖、零风险。

## 后端事实基线(已核验)

- 策略多为**固定内建**(路径围栏、命令黑名单、5MB 写限、60s/8KB 命令限);动态位:项目根、审计目录、危险工具集。
- `ApprovalPolicy.getDangerousTools() → Set<String>`(`hitl/ApprovalPolicy.java:66`)。
- `ToolRegistry.getAuditLog()`(1305)、`getProjectPath()`(162);`AuditLog.readRecent(n) → List<AuditEntry>`、`getAuditDir() → Path`(**按天存**,读当天文件)。
- `AuditEntry(timestamp(ISO), tool, args, outcome, reason, approver, durationMs, metadata)`;`outcome ∈ allow|deny|error`;`approver ∈ hitl|policy|none|mention`;`metadata = BrowserAuditMetadata(browserMode, sensitive, targetUrl)` 可空。

## RPC 设计(2 个,只读)

| method | params | result |
|---|---|---|
| `policy.status` | — | `{ projectRoot, auditDir, dangerousTools[] }` |
| `audit.list` | `{ limit? }` | `{ entries: AuditEntryView[] }`(默认 20) |

`AuditEntryView = { timestamp, tool, args, outcome, reason?, approver?, durationMs, browserMode?, sensitive?, targetUrl? }`

**实现三处**(仿 memory/snapshot 切片):
1. `AppServer.Session` 接口:`policyStatus()` / `auditList(int limit)` 两个 default(抛 UnsupportedOperationException)。
2. `AppServer` dispatch:`policy.status` / `audit.list` case(session==null 卫)。
3. `Main.java` Session 匿名类:override,用 `agent.getToolRegistry()` + `ApprovalPolicy.getDangerousTools()`;LinkedHashMap 允许 null(reason/approver 可空)。

## 桌面接线

- IPC:`wraith:policyStatus/auditList`。
- preload:2 方法。
- shared:`PolicyStatusView`、`AuditEntryView`、`AuditListResult`。

## UI(renderer)

- 侧栏新增视图 `'policy'`,图标 lucide `ShieldCheck`(已在 Sidebar 引入)。
- `PolicyPanel.tsx`:
  - 上半「策略」:项目根、审计目录、危险工具 chips;+ 固定策略说明卡(路径围栏/命令黑名单/写限 5MB/命令 60s·8KB)—— 这些是内建常量,作说明性文案。
  - 下半「审计」:limit 选择(10/20/50)+ 条目列表:outcome 徽标(允许/拒绝/错误,颜色)+ tool + 时间 + 耗时 + approver + reason + 浏览器元数据(若有)。
  - 空态:「今日尚无审计记录。危险工具(写文件/执行命令等)一经调用即记录在此。」

## 纯函数 + 测试

`renderer/lib/policyView.ts`:`outcomeLabel(allow|deny|error→允许/拒绝/错误)`、`approverLabel(hitl|policy|none|mention)`、`formatAuditTime(iso)`(ISO→本地 `MM-DD HH:mm:ss`)。配 `desktop/test/policyView.test.ts`。

## 测试隔离铁律

Java RPC 薄委托只读,**不写触碰真实审计/config 的单测**;靠 `mvn package` + 眼验。桌面纯函数走 vitest。

## 验证

`mvn -q clean package` ✓ + 同步 `~/.wraith/wraith.jar` · typecheck · vitest 全绿 · build ✓ · 红线 CLEAN。手动:桌面重启 → 侧栏「安全」→ 策略 + 审计(先跑几次带写文件/命令的对话产生审计)。
