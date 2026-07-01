# Wraith 桌面端 Phase B：多会话 + 持久化 + 侧栏 设计 spec

- 日期：2026-07-01
- 状态：设计已确认(单活跃会话 · 切换=静态回放 · 含重连自动 resume + sandbox.unavailable);待用户复核 spec
- 关联:`desktop/`(P3b 壳 + Phase A 前门/侧栏骨架)、`src/main/java/com/lyhn/wraith/session/`(已有持久化)、`src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`、`Main.java` app-server 启动
- 前置:P1/P2/P3a/P3b/Phase A 均已合并 main

## 0. 背景与关键发现

Codex 对齐路线的 Phase B。核心发现(经代码勘察):**会话持久化层已存在且生产级**,只是没接进 app-server:
- `SessionStore`(`src/main/java/com/lyhn/wraith/session/SessionStore.java`):`open(home, projectPath)` → `~/.wraith/sessions/<project_hash>/<id>.jsonl`;`startNew()`、`persist(List<Message>)`(整文件原子写)、`resume(id)`→消息列表、`list(limit)`→`SessionMeta[]`、`latest()`。
- `SessionMeta`(record:id/cwd/createdAt/updatedAt/provider/model/title/turns)、`SessionMessageCodec`(toJson/fromJson,跳过 system 与图片)。
- `Agent`(`agent/Agent.java`):`conversationHistory`(`List<LlmClient.Message>`)、`restoreHistory(List<Message>)`(保留 system[0]、替换其余)、`getConversationHistory()`(防御性拷贝)。

所以 Phase B 的"持久化"主要是**接线 + 少量新 RPC + 前端**,不是从零造。

## 1. 目标与非目标

### 1.1 目标(Phase B 交付)
1. **会话持久化**:app-server 每轮结束把对话写盘(接 `SessionStore`),按项目分组。
2. **会话列表 + 功能侧栏**:侧栏列出当前项目的历史会话(标题 + 相对时间);「新对话」新建;点某条**切换**=resume 该会话。
3. **切换渲染 = 静态回放**:resume 返回存储消息,前端用纯函数 `messagesToItems` 重建静态 transcript(user / 思考 / 工具卡片),新 turn 在其上实时流式。
4. **重启重连后自动 resume**:后端崩溃/重启后,自动把当前活跃会话 resume 回来,不丢上下文。
5. **`sandbox.unavailable` 提示**:`initialize` 诚实反映沙箱可用性;侧栏页脚显示沙箱状态徽标。

### 1.2 关键约束:单活跃会话(已定)
任一时刻 app-server 只有**一个**活的 `SessionRunner`/`Agent`。"多会话"= 磁盘上多个持久化会话(`SessionStore`)+ 侧栏列表 + resume 切换(把选中会话的历史 `restoreHistory` 进那唯一的 Agent)。**AppServer 保持单槽,不引入 `Map<sessionId,...>`、不做每会话线程,也不做并行多活跃 agent 重构**——这是本阶段低风险的根本原因。

### 1.3 非目标(推迟)
- 并行多活跃 agent(多个 turn 同时跑)→「指挥中心」,留 v1.x。
- Monaco per-hunk diff / 富审批(改参·放行网络)/ token 状态栏 → **Phase B.5**。
- 跨项目聚合列表 / 多项目并存 / 项目管理 → **Phase C**。
- 会话重命名 / 删除 / 搜索 → 后续(本阶段侧栏只列表 + 新建 + 切换)。
- 富回放(逐字符重放思考流、精确时间线)→ 静态回放足够;非目标。

## 2. 架构

```
侧栏(功能化)                     MainPane
┌─────────────┐   session.list   ┌──────────────────────────┐
│ 新对话        │─session.start──▶ │ Transcript(user+助手+思考 │
│ ── 对话 ──    │                  │  +工具卡片;resume=静态,  │
│ 会话A(选中)  │─session.resume─▶ │  新 turn 实时)            │
│ 会话B         │                  │ Composer(替我审批/重选目录)│
│ 会话C         │                  └──────────────────────────┘
│ ── 页脚 ──    │
│ 📁项目 · 沙箱徽标 │
└─────────────┘
        │
   app-server(单槽 SessionRunner,持一个 SessionStore[按项目])
   每轮 turn.completed → sessionStore.persist(agent.getConversationHistory())
```

数据流三条路径都作用于**同一个**活跃 runner:
- **新对话**:`session.start`(重建 runner + `startNew()` 空历史)。
- **切换**:`session.resume(id)`(同 runner:`sessionStore.resume(id)` → `agent.restoreHistory` → 回消息)。
- **重连**:respawn 后 `initialize` + `session.start(workspace)` + `session.resume(activeId)`。

## 3. 后端改动(Java)

### 3.1 SessionRunner 接口扩展(`AppServer.java`)
`SessionRunner` 新增(default 方法,零回归旧匿名实现):
- `default SessionMeta[] listSessions() { return new SessionMeta[0]; }`
- `default ResumeResult resume(String sessionId) { return null; }`(`ResumeResult` = sessionId + `List<LlmClient.Message>`)
- `default void persistTurn() { }`(turn 后调,写盘)
- 已有 `renderer()`/`runTurn()`/`setApprovalMode()` 不变。

### 3.2 Main.java SessionRunner 工厂
构造时 `SessionStore store = SessionStore.open(home, projectPath)` 并 `store.startNew()`(新会话);runner 实现:
- `listSessions()` → `store.list(limit)`。
- `resume(id)` → `List<Message> msgs = store.resume(id); agent.restoreHistory(msgs); return new ResumeResult(id, msgs)`。
- `persistTurn()` → `store.persist(agent.getConversationHistory())`。
- `runTurn(input)` 后由 AppServer 调 `persistTurn()`(见 3.3)。

### 3.3 AppServer 路由(仍单槽,`session` 字段不变)
- `session.start`:语义仍是"(重)建活跃 runner + 新会话"(工厂已 `startNew()`)。前端「新对话」与「重选目录」都走它。
- 新增 `session.list` → `session.listSessions()` → `{sessions: SessionMeta[]}`。
- 新增 `session.resume {sessionId}` → `session.resume(id)` → `{sessionId, messages: ResumedMessage[]}`;无会话/无效 id 回 `-32000`/`-32602`。
- `handleTurn` worker 线程:`runTurn` 成功后、发 `turn.completed` 前调 `session.persistTurn()`(每轮落盘)。

### 3.4 沙箱诚实(`Main.buildInitializeResult`)
`capabilities.sandbox`:`CommandSandbox.available()` 为真 → `"macos-seatbelt"`,否则 `"none"`(现在硬编码 `macos-seatbelt`,非 macOS 是假的)。不改沙箱本身逻辑,只改上报。

### 3.5 协议新增/变更
| method | params | result |
|---|---|---|
| `session.list` | `{}` | `{sessions: SessionMeta[]}`(id/title/updatedAt/turns) |
| `session.resume` | `{sessionId}` | `{sessionId, messages: ResumedMessage[]}` |
- `session.start` 语义明确为"新会话";`initialize` 的 `capabilities.sandbox` 现诚实(`macos-seatbelt`/`none`)。
- `ResumedMessage` = 存储消息投影:`{role:'user'|'assistant'|'tool', content?, reasoningContent?, toolCalls?:[{id,name,argsJson}], toolCallId?}`(字段以 `SessionMessageCodec` 实际输出为准,plan 阶段对齐)。

## 4. 前端(desktop/)

### 4.1 shared 纯 TS(reducer + mapper + types)
- `TranscriptState` 加:`sessionId: string`(当前活跃会话)、`sandbox: 'macos-seatbelt' | 'none' | 'unknown'`(初 `'unknown'`,存 `initialize` 回的原始 `capabilities.sandbox` 值)。
- **新增 Item 变体 `{type:'user', text:string}`**:让 transcript 成为真正的对话视图(user 气泡 + 助手回复)。当前实况 transcript 不回显用户输入;Phase B 起 **live 提交时也 echo 一条 user item**,使实时与回放一致(Codex 观感)。
- **新增纯函数 `messagesToItems(msgs: ResumedMessage[]): Item[]`**(shared,可 vitest):
  - `user` → `{type:'user', text:content}`
  - `assistant`:有 `reasoningContent` → 先出 `{type:'thinking', label:'', text:reasoningContent, done:true}`;有 `content` → `{type:'message', text:content}`;有 `toolCalls` → 每个出 `{type:'tool', card:{callId:tc.id, name:tc.name, argsJson:tc.argsJson, output:'', done:true, ok:true}}`
  - `tool` → 按 `toolCallId` 找到先前的 tool 卡,填 `output=content`、`done:true`(单次前向遍历 + callId→索引 map)
- reducer 新增 helper:`loadHistory(state, items)`(整体替换 items、`_messageOpen:false`)、`setSessionId(state, id)`、`setSandbox(state, s)`、`addUserItem(state, text)`(live echo)。

### 4.2 侧栏功能化(`Sidebar.tsx`)
从 Phase A 的静态骨架升级:
- 挂载 + 每次 workspace 变(resetSession/startup)时拉 `session.list` → 渲染会话列表(`SessionMeta.title` + 相对时间;`data-testid="conversation-item"`,选中态高亮)。
- 「新对话」按钮功能化(`data-testid="new-conversation"`):`session.start(currentWorkspace)` → `resetSession` + 刷新列表。
- 点某条会话:`session.resume(id)` → `loadHistory(messagesToItems(messages))` + `setSessionId(id)` + `markStarted`(进对话态)。
- 页脚沙箱徽标(`data-testid="sandbox-badge"`):`state.sandbox==='none'` 警示色 + tooltip「命令未在沙箱内执行」;`'macos-seatbelt'` 常态。

### 4.3 IPC / preload / main
- preload + main 新增:`listSessions(): Promise<{sessions: SessionMeta[]}>`、`resumeSession(id): Promise<{sessionId, messages}>`。
- `initialize` 响应里读 `capabilities.sandbox` → App 启动 `setSandbox`。
- main:`session.list`/`session.resume` 转发(无需 sessionId 追踪变化——单槽)。

### 4.4 重连自动 resume(`App.tsx`)
- 新增一个 **keyed on `connection` 由 `disconnected`→`connected` 的 effect**(区别于 `startedRef` once-guard 的启动 effect):检测到重连 → `initialize` + `session.start(workspace)` + 若有 `activeSessionId` 则 `session.resume(activeId)` → `loadHistory`。
- 启动流程也顺带:`initialize` 后 `setSandbox`;首个 `session.start` 后可选 `session.list`(填侧栏)。

## 5. 数据流(端到端)
- **新对话**:点「新对话」→ `session.start(ws)` → 后端重建 runner+startNew → 前端 `resetSession` + `session.list` 刷新。
- **提交**:composer 提交 → `addUserItem` echo + `markStarted` + `submitTurn` → 实时流式;turn 完 → 后端 `persistTurn` 落盘 → (可选)侧栏 `session.list` 刷新标题/时间。
- **切换**:点会话 → `session.resume(id)` → `loadHistory(messagesToItems(...))` + `setSessionId` + `markStarted`;后续 turn 在静态历史上实时。
- **重连**:disconnect→banner→respawn→connected→reconnect effect→`initialize`+`session.start`+`session.resume(active)`→历史恢复。
- **沙箱**:`initialize.capabilities.sandbox` → `setSandbox` → 页脚徽标。

## 6. 错误处理
- `session.resume` 无效 id / 无 runner → `-32602`/`-32000`;前端捕获 → console.error + 保持当前 transcript 不变。
- 持久化写失败(`SessionStore.persist` 内部)→ 不崩会话(best-effort,已有原子写);turn 仍完成。
- 重连时 `session.resume` 失败 → 退化为空的新会话 + banner 仍可手动重试(不阻塞)。
- 畸形/未知 method → 沿用 AppServer 现有 `-32601` + 跳过。

## 7. 测试策略(沿用金字塔)
- **vitest(纯模块)**:
  - `messagesToItems`:user/assistant(content/thinking/toolCalls)/tool 各映射;tool 按 callId 配对填 output;思考先于回复;空历史 → [];不可变。
  - reducer:`loadHistory`(整替换 + 重置 _messageOpen)、`setSessionId`、`setSandbox`、`addUserItem`;既有分支回归。
- **Java(headless JSON-RPC harness,避 Mockito)**:
  - `session.list` 空 → [];一轮 turn 后 `persistTurn` → `session.list` 可见该会话;`session.resume(id)` 回放消息数正确、`restoreHistory` 生效(下轮带上下文)。
  - `initialize` 的 `capabilities.sandbox`:available 真→`macos-seatbelt`、假→`none`(用 `assumeTrue`/注入或直接断言分支)。
- **Playwright(打 mock 后端)**:mock 加 `session.list`/`session.resume`(返回固定 metas + 一段消息);断言:侧栏列出会话、点「新对话」清空、点某条 → transcript 出现回放的 user/助手/工具卡片、断连后重连 → 历史恢复、`sandbox-badge` 在 `none` 时警示。
- **控制器真后端眼验**:真 resume 一段历史、真重启后自动恢复、非 macOS(或模拟)看 sandbox 徽标。临时脚本用后删、不提交。
- 注意 JDK26+Mockito 环境性基线(`testing_quirks`),新增 Java 测试走 harness、不引 Mockito。

## 8. 范围边界(红线)
Phase B 只做:持久化接线 + 会话列表 + 功能侧栏(列表/新建/切换=resume)+ 重连自动 resume + sandbox 徽标 + 对话视图加 user 气泡。**不做**:并行多活跃会话、Monaco diff/富审批/状态栏(B.5)、跨项目/项目管理(C)、会话改名/删除/搜索、富逐帧回放。

## 9. 风险与开放问题
- **「新对话」重建整个 runner**(session.start 语义)→ 会重造 Agent(含 MemoryManager/compactor)。单活跃会话下可接受;若嫌重,后续可加轻量 `runner.newConversation()`(仅清 agent 历史 + `store.startNew()`)。本阶段复用 session.start=重建以省一个 RPC。
- **静态回放保真度**:从存储的 `LlmClient.Message` 重建,思考来自 `reasoningContent`、工具卡片来自 `toolCalls`+`tool` 消息;无图片/无 system/无逐字符时间线——足够读,不追求逐帧。
- **live 加 user 气泡**是对现有实时 transcript 的行为变更(此前不回显用户输入),为与回放一致而引入;需确认 happy-path E2E 不因多一个 user item 而误断言(现有断言查 `strong`/`thinking`/`tool-card`,不查 user,应安全)。
- **session.list 时机**:每轮后刷新会更新标题/时间但增 RPC;本阶段在新建/切换/turn 完后刷新即可。
- **多 Agent 内存**:单活跃会话规避了(只一个 Agent 常驻)。
