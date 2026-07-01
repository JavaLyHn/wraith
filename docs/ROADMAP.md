# Wraith 桌面化路线图

> 北极星:把 Wraith 从纯 CLI 扩成 **Codex 桌面级 AI agent app**。核心判断:agent 核心已是事件溯源式(只调 `Renderer` 语义方法),桌面化是**加法**(新增事件流出口 + 壳),不重写。
>
> 图例:✅ 已合并 main · 🟡 spec/计划就绪未编码 · ⬜ 未开始。最后更新:2026-07-01。

## 已实现 ✅

| 阶段 | 内容 | 关键产出 |
|---|---|---|
| **P1** 后端协议骨架 | app-server 入口 + `EventStreamRenderer` + stdio JSON-RPC 2.0(JSONL)+ headless harness | `src/main/java/com/lyhn/wraith/runtime/appserver/`;事件流端到端验证 |
| **P2** 沙箱 | macOS Seatbelt(`sandbox-exec`)包裹命令子进程:默认断网、限写、宽读;fail-open 降级 + 警告 | `policy/sandbox/`;`ToolRegistry` 注入 `CommandSandbox` |
| **P3a** 协议补全 + 流式 | 单飞守卫、`session.start` 目录校验、`initialize` 能力位;**工具卡片实时输出**(`tool.output.delta`/`tool.result`,ThreadLocal callId) | `AppServer` 4 参构造;`CommandOutputObserver` |
| **P3b** Electron 壳 | spawn/守护 java、JSON-RPC client、transcript+markdown、可折叠思考块、工具卡片、**最小审批弹窗**、断连横幅、Playwright-electron E2E | `desktop/`(electron-vite + React18 + TS);preload CJS |

提前兑现的旧-P4 项:**工具卡片实时输出**(P3a)、**基础审批弹窗**(P3b)。

## 进行中 🟡

| 阶段 | 状态 | 内容 |
|---|---|---|
| **Phase A** 前门 + 视觉身份 | spec + 8 任务实施计划已提交分支 `feat/desktop-phase-a`,子代理驱动执行中 | Wraith 柔和浅色视觉身份;欢迎空态大标题 `今天做点什么？`;富 Composer(**功能**:替我审批开关 + 重选目录;**占位**:附件、模型/强度只读);静态侧栏骨架;5 组件重皮;唯一后端改动 `session.setApprovalMode`(→ `hitl.setEnabled(!auto)`) |

关联文档:`docs/specs/2026-07-01-desktop-phase-a-front-door.md`、`docs/plans/2026-07-01-desktop-phase-a.md`。

## 未实现 ⬜(Codex 对齐 A–E,取代旧 P4/P5)

| 阶段 | 内容 | 需后端? | 吸收的旧条目 |
|---|---|---|---|
| **Phase B** 侧边栏 + 多会话 + 持久化 | 真实多会话路由、会话列表/切换、持久化;重启重连 | 是(`RuntimeThreadStore`/每 Agent 隔离已有底子) | 旧-P4 重启重连 / `session.resume` / `sandbox.unavailable` |
| **Phase B.5** 富对话视图 | Monaco per-hunk diff、富审批(改参 / 本次放行网络)、token 状态展示 | 部分(放行网络需沙箱联动) | 旧-P4 Monaco diff / 富审批 / 状态栏 |
| **Phase C** 项目工作区 | 多项目并存、项目列表、项目侧栏 | 可能 | (新) |
| **Phase D** 插件 / 自动化 | MCP 插件管理 UI、自动化流程 | 是 | (新) |
| **Phase E** 打包 | jpackage 裁剪 JRE + electron-builder + macOS 签名/notarize;CSP 加固 | 构建链 | 旧-P4 CSP / 旧-P5 打包 |

## 旧路线 → 新路线对账

旧 spec §9(`docs/specs/2026-06-30-desktop-shell-v1.md`)是 **P1→P2→P3→P4(富 UI)→P5(打包)**。看过 Codex 桌面截图后重定为 **A–E 的 Codex 对齐超集**:P1–P3 已落地不变;**旧「P4」名字退休**,其条目拆进 B / B.5;旧 P5 = Phase E。已完成的工作全部保留复用。

## 固定约束(跨阶段)

- 栈固定:Java 17 / Maven,包 `com.lyhn.wraith`,跑 DeepSeek;桌面 `desktop/` 子目录(npm,独立于 Maven)。
- v1 仅 macOS 沙箱;Linux(Landlock)/ Windows 留待用户出现。
- 单机单会话(Phase A 止);多会话从 Phase B 起。
- 密钥永不入库;`~/.wraith/config.json` 持有 key(仓外)。
