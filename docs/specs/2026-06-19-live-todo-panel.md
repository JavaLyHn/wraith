# Spec:实时 TODO / 任务清单面板(Claude TodoWrite 同款)

- 日期:2026-06-19
- 状态:已实现(2026-06-19);渲染机制与草案不同——dock 内嵌原地刷新实测不可靠,已改为每次更新打印清单块(见 §11)
- 背景:对标 Claude Code 的 TodoWrite——Agent 维护一份可见任务清单,随执行原地刷新
  (✓ 完成 / ▶ 进行中 / ○ 待办)。仅默认 ReAct 模式启用(Plan/Team 已有各自步骤显示)。
- 关联评审决定:**显示=原地实时刷新单面板**;**范围=仅 ReAct**。

## 1. 目标 / 非目标

**目标**
- 新增工具 `todo_write`,LLM 用它写/更新一份任务清单。
- 清单以**单个原地刷新的面板**呈现,贯穿任务全程、在底部输入框上方常驻,随每次更新就地变化。
- 任务推进时勾选状态(○→▶→✓),用户随时看到"它在干嘛、干到哪"。

**非目标(本期不做)**
- Plan/Team 模式接入(它们已有 ExecutionPlan / Orchestrator 步骤显示)。
- 持久化到磁盘(清单是会话内瞬态;`/clear` 清空)。
- 子任务 / 嵌套 / 优先级 / 截止时间。
- 用户手动编辑清单(只由 Agent 通过工具维护)。

## 2. 数据模型

- `TodoStatus`:`PENDING` / `IN_PROGRESS` / `COMPLETED`。
- `TodoItem(String content, TodoStatus status)`(record)。
- `TodoState`:持有当前 `List<TodoItem>`,`replace(list)` 整体替换(Agent 每次传完整清单,语义同 Claude TodoWrite)。线程安全(synchronized)。

## 3. 工具 `todo_write`

- 在 `ToolRegistry.registerTodoTools()` 注册(沿用 `new Tool(name, desc, schema, invoker)` 范式)。
- 参数:`todos` —— 数组,每项 `{content: string, status: "pending"|"in_progress"|"completed"}`。
  (内置工具 invoker 收到的是 `Map<String,String>`;`todos` 取到的是 JSON 串,invoker 内用 Jackson 解析。)
- 行为:解析 → `TodoState.replace(...)` → 通过 sink 通知渲染层 → 返回简短确认串(如 `已更新任务清单:3 项,1 完成`)给 LLM。
- 描述里写清用法引导:**多步任务开始时先列计划;每完成一步就把它标 completed、把下一步标 in_progress;同一时刻最多一个 in_progress**(对齐 Claude 的 TodoWrite 习惯)。
- 空数组 → 清空面板。

## 4. 注入与渲染钩子

- `ToolRegistry.setTodoSink(Consumer<List<TodoItem>>)`——仿 `setScopedMemorySaver` / `setWriteFileObserver` 的注入范式。`todo_write` invoker 调用它。
- `Renderer` 加默认方法 `default void renderTodos(List<TodoItem> todos) {}`(PlainRenderer 可重写为纯文本打印;LanternaRenderer 不实现也无妨)。
- `Main` 启动时:`reactAgent.getToolRegistry().setTodoSink(todos -> renderer.renderTodos(todos))`。

## 5. 渲染机制(核心,原地刷新单面板)

**选定方案:把 TODO 面板并入底部 dock 的预留区(BottomStatusBar)。**
理由:dock 已经是一块**用 DECSTBM 预留、就地重绘、并自动调整滚动区**的常驻区域;把清单画在状态行上方,天然得到"常驻 + 原地刷新 + 在输入框上方"的单面板,复用既有机制,不另起一个易错的固定区(避免重蹈 banner 固定区的坑)。

- `BottomStatusBar` 持有 `TodoState`;`renderTodos` → 更新 state → 重算 `reservedRows`(= 状态行数 + dock 下线 + **TODO 面板行数**)→ `renderDock()` 重绘 → 滚动区底边随之 reassert。
- TODO 面板行(就地重绘,**只清自己这几行**,绝不 `ESC[J` 清到屏幕底——与 `InlineActivityDisplay` / 修复后的 `SlashPalette` 同款安全画法):
  ```
   Tasks
    ✓ 读取 SessionStore
    ▶ 重构 persist 方法
    ○ 补充单测
  ```
  标记:`✓`(绿/暗)完成、`▶`(粗)进行中、`○` 待办;标题行 `Tasks`(可带计数)。
- 行数上限(如 ≤ 8 项 + 标题),超出则折叠为 `… 还有 N 项`,避免 dock 过高吃掉对话区。
- 面板宽度按列宽截断(CJK 记 2 宽),防回绕打乱行数(同 SlashPalette.fit)。

**风险(评审需知):** dock 高度随清单项数动态变化 → 每次增删项会改 `reservedRows` → 滚动区底边变化 → 对话区会有一次轻微 reflow(内容上/下挪一行)。这是动态高度的固有代价。缓解:仅在项数变化时重设滚动区;状态翻转(○→▶→✓)不改高度,只重绘内容(零 reflow)。

## 6. 生命周期

- 首次 `todo_write` → 面板出现。
- 后续 `todo_write` → 原地刷新。
- 任务结束(idle)→ 面板保留可见(用户能回看最终清单),直到:
  - 下一个 `todo_write` 覆盖,或
  - `todo_write` 传空数组,或
  - `/clear`(连同对话历史一起清空 TODO)。
- 不随 `beginTurn` 清空(跨轮任务清单要留住)。

## 7. 代码触点(评审后实现)

1. 新增 `tool/todo/TodoItem.java`、`TodoStatus`、`TodoState`。
2. `ToolRegistry`:`registerTodoTools()` + `setTodoSink(...)` + 在构造里调用注册。
3. `Renderer`:加 `default void renderTodos(List<TodoItem>)`。
4. `BottomStatusBar`:持有 TodoState、`renderDock` 加 TODO 面板行、`reservedRows` 计入、提供 `setTodos(list)`。
5. `InlineRenderer.renderTodos`:转发给 `statusBar.setTodos(...)`;`PlainRenderer.renderTodos`:纯文本打印。
6. `Main`:`setTodoSink` 接线;`/clear` 分支清空 TODO。
7. README `## 命令` / `## 可用工具`:补 `todo_write` 与面板说明。

## 8. 边界与局限

- 仅 ReAct;Plan/Team 不接(本期)。
- 清单瞬态(不落盘);会话续接 `/resume` 不恢复 TODO(只恢复对话历史)。
- 终端过矮 / dock 不可用(degraded)时:降级为每次更新打印一份纯文本清单块(不原地刷新)。
- LLM 不调 `todo_write` 就没有面板(纯靠模型自觉;描述里强引导,但不强制)。

## 9. 验证计划

- 纯函数单测:`todo_write` 参数解析(JSON→List<TodoItem>,坏数据容错)、`TodoState.replace`、面板行格式化(标记/截断/折叠)。
- Python pty 端到端:真实跑一个多步任务,断言面板出现、状态随工具调用就地翻转(✓/▶/○)、底部输入框不被顶飞(pyte 渲染网格核验 dock 固定)。
- 降级路径:dock 不可用时打印纯文本清单。

## 10. 开放问题(评审请定)

1. 面板位置:**dock 内、状态行上方**(草案)vs 紧贴对话区底部独立一块?(草案:dock 内,复用预留机制)
2. 面板最多显示几项再折叠?(草案:8)
3. 任务结束后面板**保留**还是**淡出/收起**?(草案:保留,直到被覆盖 / `/clear`)

## 11. 实现说明(与 spec 的偏差,重要)

评审时选的「dock 内嵌、原地刷新单面板」**实测不可靠**:把面板塞进 JLine `Status` 托管的
底部 dock、并随项数动态改保留区高度,会留下残影/错位(面板 + 一段陈旧状态栏卡在屏幕上方,
底部 dock 反而丢内容)。pyte + 真机都复现,两次修(重绘 / `dock.resize()`)无效。已回退。

**实际实现:每次 `todo_write` 被调用,就把当前完整清单作为一块打进 transcript**
(`Tasks N/M` + `✓/▶/○` 标记,走 `InlineRenderer.emit`,随对话滚动)。可靠、零残影。
「实时进度」靠模型每步切换都调用 `todo_write`——为此强化了 `todo_write` 工具描述 +
`prompts/base.md` 新增 Todo Policy(明确要求每个状态切换单独调一次)。

代价:不是单个常驻面板,而是每次更新一份快照块(旧块滚进历史可回看)。给定本渲染器
(主屏 + JLine 滚动区 + 流式输出 + 活动面板共存),这是稳健的选择。

依赖模型自觉:小模型(如 DeepSeek-V4-Flash)不一定每步都更新,过度约束的提示甚至会让它把
工具调用写成乱码;强化提示能改善但不能强制。降级:无 dock / plain 形态走 `PlainRenderer.printTodos`。

验证:5 个解析单测;pty + pyte 端到端确认 Tasks 块正确渲染(✓/▶/○ + 计数)、底部 dock 单一干净。
