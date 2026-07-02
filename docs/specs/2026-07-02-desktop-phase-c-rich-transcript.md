# Wraith 桌面端 Phase C：富对话视图 设计 spec

> 日期：2026-07-02 · 状态：已过用户设计评审，待 spec 复核
> 前置：Phase A（174115a）、Phase B（6d707ac）已合并 main。
> 交互决策（用户已拍板）：diff 两落点都要（事后卡片 + 审批前预览）；渲染用 **Monaco DiffEditor**；富审批四项全要（命令编辑 / 本次放行网络 / 通用 JSON 改参兜底 / 本会话放行此工具）；token 状态放 **Composer 区域**；架构走 **方案 1（后端最小增量）**。

## 0. 背景与关键发现

探索结论：后端远比 ROADMAP 预想成熟，Phase C 大头在前端消费已有事件。

- `Renderer.appendDiff(filePath, before, after)` 已存在；app-server 路径已接 `registry.setWriteFileObserver`（`Main.java:1133`）——**每次 `write_file` 执行后已在发 `diff` 事件（含完整 before/after）**，桌面端目前丢弃。
- `Renderer.updateStatus(StatusInfo)` 已存在；Agent 每轮调用（`Agent.java:644`），`EventStreamRenderer` 已发 `status` 事件（model/totalTokens/contextWindow/in/out/cached/estimatedCost/hitlEnabled/elapsedMillis/phase）——桌面端目前丢弃。
- `AppServer.handleApprovalRespond` 已解析**任意** `ApprovalResult.Decision`（含 `MODIFIED`+`modifiedArgs`、`APPROVED_ALL`）并直通 `resolveApproval`——改参与本会话放行是**纯前端**工作。
- `approval.requested` 已携带 `suggestion`（执行理由），前端未展示。
- 真正的后端缺口只有两个：① 审批 `write_file` 时事件无旧文件内容；② 沙箱 `networkAllowed` 是进程级死值（`-Dwraith.sandbox.network`），无单次放行链路。

## 1. 目标与非目标

### 1.1 目标（Phase C 交付）

1. **diff 事后卡片**：transcript 消费 `diff` 事件，渲染 Monaco per-hunk diff 卡片。
2. **审批前 diff 预览**：`write_file` 审批弹窗内直接看 diff（后端补 `beforeContent`）。
3. **富审批弹窗**：命令行编辑（`MODIFIED`）、本次放行网络（新链路）、通用 JSON 改参兜底、本会话放行此工具（`APPROVED_ALL`）、展示 `suggestion`。
4. **token 状态 chip**：Composer 区域常显 context 占用 %，Tooltip 展开明细；消费已有 `status` 事件（前端节流）。

### 1.2 关键约束（沿用）

- 单活跃会话架构不变；AppServer 单槽不变。
- preload 保持 CJS；`desktop/src/shared/` 保持纯 TS（Monaco 相关代码只进 renderer）。
- 密钥永不入库；`.superpowers/sdd/` 不入库。

### 1.3 非目标（推迟）

- per-hunk **单独批准/拒绝**（本期 diff 是查看粒度，审批仍是整个工具调用一票）。
- 会话级网络开关 UI（全局放行继续走 `-Dwraith.sandbox.network=on`）。
- 自动审批（auto）模式下的网络放行入口（无弹窗即无入口，接受）。
- diff 卡片的语法高亮语言 worker（用 Monaco 内置 basic-languages tokenizer，不引语言 worker）。
- `todos` 事件消费（另属后续阶段）。

## 2. 架构

方案 1：**后端最小增量，前端吃现有事件**。已否决的备选：后端算 hunks 下发（与 Monaco 自带 diff 计算重复、多引 Java 依赖）；Electron main 直读磁盘做预览（绕过 PathGuard、焊死同机假设）。

数据流总览：

```
write_file 执行后:  ToolRegistry(writeFileObserver) → Renderer.appendDiff → diff 事件 → reducer → DiffCard
write_file 审批前:  HitlToolRegistry(读旧文件) → ApprovalRequest.beforeContent → approval.requested → 弹窗 diff 预览
本次放行网络:       弹窗 Switch → approval.respond{allowNetwork:true} → ApprovalResult.allowNetworkOnce
                    → HitlToolRegistry.grantNetworkOnce() → executeCommand wrap 消费即清
token 状态:         Agent.updateStatus → status 事件 → App.tsx 节流 → reducer.state.status → StatusChip
```

## 3. 后端改动（Java）

### 3.1 `ApprovalRequest` + `beforeContent`（可空）

- record 加第 8 个字段 `String beforeContent`；现有 `of(...)` 工厂全部默认 `null`，新增带 `beforeContent` 的重载。TUI 的 `toDisplayText()` 不使用该字段（终端不渲染大文本 diff）。
- 填充点：`HitlToolRegistry.executeAfterExplicitApproval()`。仅当 `name.equals("write_file")`：解析 `argumentsJson` 的 `path` → 经与 `write_file` 执行同源的路径解析/PathGuard 校验 → 文件存在则 `Files.readString`。
- 三种情况统一映射为 `null`，**不加区分字段**：文件不存在（新文件）、读取异常（不阻断审批）、文件 > 512KB（防事件爆炸）。前端见到 `beforeContent == null` 统一显示「新文件（或无预览）」，措辞见 §4.2。

### 3.2 `ApprovalResult` + `allowNetworkOnce`

- record 加第 4 个字段 `boolean allowNetworkOnce`；现有工厂全部 `false`。
- `AppServer.handleApprovalRespond` 读可选参数 `allowNetwork`（缺省 false），构造 `new ApprovalResult(d, modifiedArgs, reason, allowNetwork)`。

### 3.3 网络单次覆盖链（`ToolRegistry` / `HitlToolRegistry` / `CommandSandbox`）

- `ToolRegistry` 加 `private volatile boolean networkOnceGrant` + `public void grantNetworkOnce()`；`executeCommand` 的沙箱 wrap 处消费即清：置位时用 `new CommandSandbox(true)` 包**本条**命令（写限制/读策略不变，仅省略断网规则），随后立即复位。
- `HitlToolRegistry.executeAfterExplicitApproval`：`result.isApproved() && result.allowNetworkOnce() && "execute_command".equals(name)` → `grantNetworkOnce()`。
- 线程安全依据：审批（`promptApproval` 阻塞等待）与执行（`super.doExecuteTool`）在同一工具线程、同一对象上顺序发生（已验证 `HitlToolRegistry extends ToolRegistry`）；单活跃会话下无并发工具线程。volatile 仅作跨线程可见性兜底。

### 3.4 `EventStreamRenderer.promptApproval`

- `approval.requested` payload 追加 `beforeContent`（可空）。`suggestion` 已在 payload，无改动。

### 3.5 协议新增/变更汇总

| 方向 | 消息 | 变更 |
|---|---|---|
| S→C | `approval.requested` | += `beforeContent`（string\|null，仅 write_file 非空） |
| C→S | `approval.respond` | += `allowNetwork`（bool，可选，缺省 false）；`decision` 开始使用 `MODIFIED`（携 `modifiedArgs`）与 `APPROVED_ALL`（wire 早已支持） |
| S→C | `diff` | 已有（`filePath`/`before`/`after`），前端新增消费 |
| S→C | `status` | 已有（StatusInfo 全字段），前端新增消费 |

## 4. 前端（desktop/）

### 4.1 Monaco 集成（仅 renderer）

- 依赖 `monaco-editor`；electron-vite renderer 配置手动注入 **`editor.worker` 一个**（diff 计算用），不引语言 worker；`MonacoEnvironment.getWorker` 用 `?worker` 导入。
- 封装 `renderer/components/DiffView.tsx`：只读 inline DiffEditor，`hideUnchangedRegions: true`（原生 per-hunk 折叠）、`automaticLayout: true`、高度按内容 clamp（上限 400px）。**动态 import Monaco，失败降级**为纯文本 before/after 双块，不白屏。
- 实例纪律：unmount 必 `dispose()`；DiffCard 折叠时**卸载** DiffView（不是 CSS 隐藏），控多卡内存。

### 4.2 DiffCard（事后卡片）与审批预览共用 DiffView

- `shared/transcriptReducer.ts`：Item 联合加 `{type:'diff'; filePath: string; before: string; after: string}`；`case 'diff'` append item 并封口 `_messageOpen`。
- `renderer/components/DiffCard.tsx`：头部 = 文件名（basename，title=全路径）+ 增删统计（`onDidUpdateDiff` 的 lineChanges 回填，未就绪不显示）+ 折叠按钮；主体 = DiffView。默认展开。`data-testid="diff-card"`。
- 审批预览：`before = beforeContent ?? ''`、`after = args.content`；`beforeContent === null` 时头部标注「新文件（或无预览：文件过大/不可读）」。

### 4.3 富审批弹窗 v2（`ApprovalModal.tsx`）

- 头部：工具名 + 危险等级 + 风险描述 + `suggestion`（非空才显示，标签「执行理由」）。
- 主体按 `toolName` 分派：
  - `execute_command`：命令 monospace 单行编辑（初值 `args.command`）＋「本次放行网络」Switch（默认关，`data-testid="allow-network"`）；
  - `write_file`：DiffView 预览，内容**不可编辑**；
  - 其他：参数只读列表 + 「编辑参数」展开原始 JSON textarea（`JSON.parse` 实时校验，非法时禁用批准且显示错误）。
- 按钮区：拒绝（`REJECTED`）／ 本会话放行此工具（`APPROVED_ALL`）／ 批准。有改动 → 按钮文案变「批准修改」发 `MODIFIED + modifiedArgs`（整参重序列化）；**改参后「本会话放行」禁用**（语义互斥）。网络 Switch 只影响 `allowNetwork` 参数，可与 APPROVED/MODIFIED 组合。
- 决策映射抽 `shared/buildApprovalResponse.ts` 纯函数：`(原始 argsJson, 编辑态) → {decision, modifiedArgs?, allowNetwork?}`，vitest 直测。
- IPC：preload `respondApproval(approvalId, decision, opts?: {modifiedArgs?: string; allowNetwork?: boolean})`；main 透传进 `approval.respond` params。类型在 `shared/types.ts` 同步（`PendingApproval` += `suggestion`/`beforeContent`）。

### 4.4 token 状态 chip（Composer 区域）

- reducer：`state.status: {model, totalTokens, contextWindow, inputTokens, outputTokens, cachedInputTokens, estimatedCost, elapsedMillis, phase} | null`（初始 null）+ `case 'status'`；`resetSession` 置 null。
- 节流在 `App.tsx` 的 `onEvent` 入口：`status` 事件 100ms 时间窗合并（保留最新一条，窗口关闭时 dispatch），其他事件不受影响；抽 `shared/throttleLatest.ts` 纯函数便于 vitest。
- `renderer/components/StatusChip.tsx` 放 model chip 旁：常显 context 占用 %（`totalTokens/contextWindow`；分母 ≤0 或 status 为 null 则整枚隐藏，欢迎态自然不显示）；Tooltip 明细：输入/输出/缓存命中 token、估算成本（非空才显示）、耗时 + 阶段（运行中）。`data-testid="status-chip"`。

## 5. 数据流（端到端）

1. **事后 diff**：`write_file` 获批执行 → `writeFileObserver` → `appendDiff` → `diff` 事件 → reducer append `{type:'diff'}` → DiffCard（Monaco 卡片，per-hunk 折叠）。
2. **审批 diff**：Agent 发起 `write_file` → HitlToolRegistry 读旧文件 → `approval.requested{beforeContent}` → 弹窗 DiffView 预览 → 用户批准 → 执行 → 落点 1 的事后卡片照发（两落点共存，卡片是留档）。
3. **改命令 + 放行网络**：`execute_command` 审批 → 用户改命令 + 勾网络 → `approval.respond{decision:'MODIFIED', modifiedArgs, allowNetwork:true}` → `ApprovalResult(MODIFIED, args, null, true)` → `effectiveArguments` 用改后参数 + `grantNetworkOnce()` → wrap 以 `networkAllowed=true` 执行本条，随后复位。
4. **token**：每次 LLM 往返 → `status` 事件（高频）→ App.tsx 100ms 节流 → `state.status` → StatusChip 渲染。

## 6. 错误处理

- `beforeContent` 读取异常/超限 → `null`，审批流程不受影响，前端显示「新文件（或无预览）」。
- Monaco 动态加载失败 → DiffView 降级纯文本双块（`data-testid="diff-fallback"`）。
- JSON 改参非法 → 批准禁用 + 内联错误文案；不发请求。
- `approval.respond` 携带非法 decision → 后端已有 `-32602 invalid decision`（回归测试覆盖）。
- 弹窗打开期间断连 → 沿用现有 disconnect 处理（banner + `rejectAll`），弹窗随 `pendingApproval` 清理关闭（现状已如此，E2E 回归确认不破坏）。

## 7. 测试策略（沿用金字塔）

- **Java（headless harness / @TempDir，避 Mockito）**：
  - `HitlToolRegistry` beforeContent 三态（存在/新文件/超 512KB）；
  - `allowNetworkOnce` 链：respond 带 `allowNetwork:true` → `grantNetworkOnce` 被调 → 消费即清（连续两条命令第二条不放行）;
  - `AppServerApprovalTest`（harness）：`MODIFIED+modifiedArgs`、`APPROVED_ALL`、`allowNetwork` 解析、invalid decision 回归；
  - `CommandSandbox.buildCommand` 静测：`networkAllowed=true` 时 profile 无 `(deny network*)`。
- **vitest（纯 TS）**：reducer `diff`/`status` case + `resetSession` 清 status；`buildApprovalResponse` 决策映射全分支；JSON 校验；`throttleLatest`。
- **Playwright（mock-appserver）**：mock 补发 `diff`/`status` 事件、approval.requested 带 `beforeContent`/`suggestion`、respond 全量记录进 `WRAITH_E2E_RECORD`；断言：`diff-card` 容器出现且头部含文件名（内部渲染形态 Monaco/降级不作断言，避免 CI 环境耦合）、改命令 → 记录含 `MODIFIED` 与新命令、勾网络 → `allowNetwork:true`、`APPROVED_ALL` 按钮、token chip 文案。Monaco 加载用 testid 显式等待，无 sleep。
- **不在自动覆盖内（照例明说）**：真实后端 write_file → diff 卡片全链路；真沙箱网络放行（实机勾选后命令内 `curl` 通、不勾不通）。建议合并后 `npm run dev` 实机眼验一轮。

## 8. 范围边界（红线）

- 不改 AppServer 单槽结构、不动 session 持久化链路。
- Monaco 只进 renderer 包；`shared/` 不得 import monaco。
- 不做 per-hunk 单独批准、不做会话级网络开关 UI、不做语言 worker。
- `ApprovalRequest`/`ApprovalResult` 加字段不得破坏 TUI 路径（现有工厂签名保留，TUI 行为不变，回归以现有测试为准）。

## 9. 风险与开放问题

- **Monaco 包体积**（+4~5MB）与多实例内存：以「折叠即卸载 + dispose 纪律 + 高度 clamp」控制；若实测卡顿，后备方案是卡片默认折叠只展统计头。
- **status 事件频率**：后端无节流（javadoc 声明渲染器自行节流），前端 100ms 合并；若仍过频可在 EventStreamRenderer 侧再加节流（本期不做）。
- **beforeContent 与执行时文件不一致**（审批期间文件被外部修改）：接受——事后 diff 卡片以执行时真实 before/after 为准，审批预览仅供决策参考。
