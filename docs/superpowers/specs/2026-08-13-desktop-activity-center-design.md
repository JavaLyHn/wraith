# 桌面端活动中心设计

## 背景

Wraith 桌面端目前可以在侧边栏看到当前会话、项目和后台任务入口，但跨项目查看“哪些 Agent 正在运行、等待什么、最近完成了什么”仍需要逐个打开项目或工具页。Codex 桌面端把活动视图作为多个 Agent 的控制面：项目是上下文容器，活动是运行中的工作单元，用户可以从一个地方继续、处理或停止任务。

本设计为 Wraith 增加一个本机活动中心，聚合现有会话、持久后台任务和自动化运行，不引入云端同步或新的执行引擎。

## 目标与非目标

### 目标

- 在一个入口展示跨项目的运行中、等待中和最近完成/失败的活动。
- 明确显示活动所属项目、会话或任务、当前状态、最近动作和更新时间。
- 从活动卡片进入原会话或任务详情，并在现有能力允许时停止/取消。
- 复用现有事件流和 RPC；面板打开时完整拉取，活动变化时增量更新。
- 断线或数据源失败时保留上一次数据并明确标记可能已过期。

### 非目标

- 不新增云端活动同步、远程控制或跨设备继续。
- 不自动创建、删除、清理 Git worktree。
- 不在第一期增加提交、推送、切分支等 Git 写操作。
- 不自动重试失败活动。
- 不把所有历史会话都视为活动。

## 用户入口与布局

侧边栏新增“活动”入口。入口只在存在运行中或等待中活动时显示数量徽标；无活动时仍保留入口，便于查看最近结果。

点击入口后，主区域打开 `ActivityPanel`，侧边栏保持可见。活动按以下顺序分组：

1. 正在运行
2. 等待处理
3. 最近完成或失败（最多 10 条）

每一项显示项目名和路径、会话/任务标题、分支或 worktree（能读取时）、状态、最近动作、Git 改动摘要和最后更新时间。点击活动进入原会话或对应任务详情。

## 统一活动模型

前端使用统一的 `ActivityItem` 视图模型，来源分为三类：

- `session`：Agent 会话；
- `task`：持久后台任务；
- `automation`：自动化运行。

建议字段：

```text
activityId
kind: session | task | automation
status: running | waiting | completed | failed | canceled | interrupted | unknown
projectPath
sessionId/taskId/runId
title
summary
branch
worktree
startedAt
updatedAt
error
stale
```

`activityId` 必须在同一来源内稳定，避免事件更新造成列表闪烁。`projectPath` 为空时显示“未关联项目”，不能丢弃活动。

## 数据流与状态规则

主进程维护轻量活动注册表，负责把已有来源转换为统一视图。活动面板打开时调用聚合查询；收到后端通知、任务变化或自动化运行事件时，只推送受影响活动的更新。第一期不采用固定高频轮询。

状态映射规则：

- Agent 正在执行工具或模型请求 → `running`；
- 等待审批、计划确认或用户输入 → `waiting`；
- 后台任务/自动化成功 → `completed`；
- 异常结束 → `failed`；
- 用户主动停止或取消 → `canceled`；
- 应用重启后无法确认仍在运行的活动 → `interrupted` 或 `unknown`，不得伪装成 `running`。

如果某个数据源查询失败，活动中心保留最近一次成功快照，并在标题区域显示“数据可能已过期”；如果从未成功加载，则显示明确错误和重试按钮。

## 操作边界

- `session` 的停止沿用现有 `interrupt`；
- `task` 的停止沿用 `taskCancel`；
- `automation` 的停止沿用 `automationStop`；
- `waiting` 活动提供进入会话/审批处理入口，不绕过现有审批策略；
- `completed`、`failed`、`canceled`、`interrupted` 活动只提供查看入口；失败活动第一期不自动复制或重试。

操作失败必须在卡片上显示原因，并保留活动原状态；不能把请求发出就直接渲染为成功停止。

## 代码落点

新增：

- `desktop/src/main/activityStore.ts`：主进程活动注册、聚合和快照；
- `desktop/src/renderer/components/ActivityPanel.tsx`：活动中心界面；
- `desktop/src/renderer/lib/activityView.ts`：分组、排序、状态文案等纯函数；
- 相关 Vitest 测试和组件测试。

改动：

- `desktop/src/shared/types.ts`：`ActivityItem`、查询结果和事件类型；
- `desktop/src/main/index.ts`：活动查询、操作和事件转发 IPC；
- `desktop/src/preload/index.ts`：类型化活动桥；
- `desktop/src/renderer/App.tsx`、`Sidebar.tsx`：导航、徽标和活动详情回调；
- 如现有 Git 单项查询无法满足跨项目卡片，再增加只读批量 Git 状态接口。

## 测试与验收

### 纯函数测试

- 三种来源正确映射到统一模型；
- 状态分组顺序为运行中、等待处理、最近结果；
- 最近结果最多保留 10 条，并按更新时间倒序；
- 缺少项目、分支或错误字段时仍能生成可读文案；
- 旧快照标记为 `stale` 后不会被误显示为实时状态。

### 组件与 IPC 测试

- 活动入口徽标只统计运行中和等待中活动；
- 点击活动可定位到会话或任务；
- 停止/取消按钮调用正确 API，失败时保留原状态并显示错误；
- 数据源失败时保留快照并显示过期提示；
- 事件更新只改变对应活动，不重复插入列表。

### 回归

```text
cd desktop && npx vitest run
cd desktop && npx tsc --noEmit
mvn -DskipTests=false test
```

活动中心不得改变现有会话、后台任务、自动化和 Git pill 的行为。

## 分阶段实施建议

1. 先建立统一类型、纯函数和测试，锁定状态与排序语义。
2. 接入主进程聚合查询和事件更新，补齐 preload IPC。
3. 增加活动面板和侧边栏入口，接入进入/停止/取消操作。
4. 做断线、重启、跨项目和缺失 Git 状态验收，再跑全量回归。
