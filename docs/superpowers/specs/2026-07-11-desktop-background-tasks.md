# 桌面「后台任务」面板(补齐 CLI /task)

- 日期:2026-07-11
- 状态:**已实现**(2026-07-11)。注:`DurableTaskManager` 已有 `find(id)`,无需新增 `get(id)`;
  task 运行目录用共享 `AtomicReference<String> taskRoot`(会话工厂设为当前会话 root),
  经 `runHeadlessTaskAt(prompt, client, root)` 执行。
- 关联:CLI `/task list/add/cancel/log`(`Main.java` case TASK → `TaskCommandFormatter.handle(taskManager, …)`)、`DurableTaskManager`、`DurableTask`

## 背景 / 动机

CLI 有「后台异步任务」:`/task add <指令>` 丢一个**独立的 headless Agent** 到后台跑,
不阻塞主对话,`/task log <id>` 看结果、`/task cancel <id>` 取消、`/task` 列表。
底层 `DurableTaskManager` 持久化在 **SQLite `~/.wraith/tasks/tasks.db`**,重启可恢复。

桌面**没有**这个能力(是 CLI↔桌面对照里剩下的两个缺口之一)。桌面现有的
「定时自动化(Automations)」是 **cron/周期投递**,与「一次性即时后台作业」不是一回事。

## 目标

1. 桌面新增「后台任务」面板:提交任务、看列表/状态、看单个任务 log、取消。
2. 复用 CLI 同一套 `DurableTaskManager` + 同一个 `~/.wraith/tasks/tasks.db`
   → **桌面与 CLI 的后台任务互通**(一边提交,另一边也看得到)。
3. 后台任务是**独立 headless Agent**(全新 ToolRegistry,不共享当前对话上下文),
   与 CLI 语义完全一致。

## 非目标

- 不做任务进度**实时流式**(headless 跑,DB 只记状态转移);v1 用「打开面板/刷新按钮」拉取 + 完成通知。
- 不改 `DurableTaskManager` 的执行/持久化模型。
- 不合并进「定时自动化」——两者概念不同,各自独立面板。

## 关键约束(必须先解决)

**app-server 模式当前没有 `DurableTaskManager`**:它只在 CLI REPL 路径创建
(`Main.java:347` `openTaskManager` + `start()` + shutdown hook)。`startAppServer()`
路径(桌面 spawn 的就是它)**没有**。所以第一步是让 app-server 也建一个 task manager。

- task runner 复用 `runHeadlessTask(prompt, llmClient)` 语义:每个任务起**全新
  `ToolRegistry` + `Agent`**,`agent.run(prompt)`,项目目录用会话的 `root`。
- LLM client 用会话当前的 `currentClient[0]`(与 REPL 的 `llmClientRef.get()` 对应)。
- 生命周期:app-server 启动时 `manager.start()`,进程关闭 hook `manager.close()`。

## 设计

### 后端

1. **DurableTaskManager 补一个 `get(String id)`**(现只有 `list/enqueue/cancel`):
   log 视图要看单任务完整 result/error,`list(limit)` 不适合承载长文本。
   `public DurableTask get(String id)`(查 DB 单行,不存在返回 null)。

2. **app-server 装配 task manager**(`startAppServer()` 内,SessionRunner 可见的作用域):
   ```java
   DurableTaskManager taskManager = DurableTaskManager.openDefault(
       prompt -> { /* 新 registry+agent,agent.run(prompt) —— 复刻 runHeadlessTask,root 用会话根 */ });
   taskManager.start();
   // 进程关闭时 close
   ```

3. **AppServer SessionRunner + dispatch(4 个 RPC)**:
   - `task.list(limit)` → `[{id,status,prompt,createdAt,durationMs}]`(不带 result,列表轻量)
   - `task.add(prompt)` → `{id}`(enqueue)
   - `task.get(id)` → `{id,status,prompt,result,error,createdAt,durationMs}`(log 视图)
   - `task.cancel(id)` → `{ok}`
   task.add/cancel/list/get 都是 DB/入队操作,**快**,走同步 dispatch 即可(非 HITL、不阻塞)。

4. **完成通知(可选增强)**:任务转 COMPLETED/FAILED 时 `writer.notify("task.changed", …)`
   → 桌面刷新列表 + 可选 OS 通知。v1 可先不做,靠面板刷新。

### 桌面

5. **preload + shared 类型**:`taskList/taskAdd/taskGet/taskCancel` + `DurableTaskView`。
6. **`TaskPanel.tsx`**:顶部提交框(textarea + 提交)、任务列表(状态徽标 + prompt 摘要 +
   相对时间 + 取消按钮)、点某条展开看 result/error(调 `taskGet`)。复用现有面板范式
   (参考 MemoryPanel/SnapshotPanel):返回按钮、刷新、空态。
7. **纯函数 + 单测**(`lib/taskView.ts`):`taskStatusLabel(status)`、`taskStatusTone(status)`
   (PENDING/RUNNING/COMPLETED/FAILED/CANCELLED → 中文 + 颜色)、`promptSummary(prompt)`。
8. **Sidebar 入口**:「工具」组里加一项「后台任务」;运行中任务数可做角标(可选)。

### 安全红线

- 任务 prompt / result 可能含用户内容,但**不含密钥**;RPC 回包不带 apiKey。
- 异常只报 `e.getClass().getSimpleName()`。
- **测试隔离铁律**:单测只测纯函数(taskView),**绝不**碰真实 `~/.wraith/tasks/tasks.db`;
  后端若加集成测试须用临时 db 路径。

## 测试

- `desktop/test/taskView.test.ts`:状态映射、prompt 摘要、相对时间。
- 后端 `DurableTaskManager.get` 若加,用临时 db 单测(不碰真实库)。
- typecheck / vitest / build 全绿;**改了 Java → 重打 jar + 同步 ~/.wraith/wraith.jar + 重启桌面**。

## 验收

- 桌面「后台任务」面板提交一个任务 → 列表出现(RUNNING → COMPLETED)。
- 点开看 result;能取消 RUNNING/PENDING 任务。
- CLI `/task` 能看到桌面提交的任务(反之亦然)—— 共享同一 db。

## 工作量与风险

- 后端:app-server 装配 task manager(~30 行)+ `get(id)`(~15 行)+ 4 RPC(~50 行)。
- 桌面:preload/types(~20)+ TaskPanel(~150)+ taskView 纯函数与测试(~60)+ Sidebar 接线。
- 风险点:app-server 装配 task manager 的作用域(要在 SessionRunner 能引用到、且随会话 root 走);
  task runner 的 root 取值(会话可切工作区 → 用提交那刻的 root)。中等,非高危。
