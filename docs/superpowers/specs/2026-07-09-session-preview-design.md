# 运行中会话只读预览 (Session Read-Only Preview) 设计

**日期:** 2026-07-09
**分支:** feat/desktop-multiagent-ui(累积功能之一)
**状态:** 设计已获批(第 1、2 节),待用户复核 spec

## Goal

一个 turn 正在运行时,允许用户在侧栏点开**同项目**内的其它历史会话进行**只读查看**(以及打开空白「新对话」预览),正在运行的 turn 在后台继续,不被打断。消除今天"点侧栏别的会话/新对话时静默无反应,像卡死"的体验。

## 背景与问题

今天桌面端在 turn 运行时对导航有一道**静默守卫**:

- `App.tsx:handleSelectSession` 开头 `if (turnRef.current === 'running') return`
- `App.tsx:handleNewConversation` 开头同样的 `return`
- `switchToProject` / `handleAddProject` 同样(切项目——本设计**不改其预览行为**)

守卫本身有正当理由:当前架构是**单活跃会话 + 单份 transcript**,流式事件(`message.delta` / `plan.*` / `team.*`)直接 append 进 reducer 的 `items`,turn 归 `state.sessionId`。turn 运行中切走会把流式 delta 灌进错的会话、`sessionId` 错位、turn 结束时持久化归属混乱。

问题在于守卫是**静默 no-op**:`SessionRow` 按钮看起来完全可点,点了却毫无反馈,因此"感觉像 bug/卡死"。

## 关键决策(来自设计对话)

| # | 决策 | 选择 |
|---|---|---|
| Q1 | 预览作用域 | **仅同项目会话**。跨项目要连带切 workspace/MCP/工具集,超出范围。 |
| Q2 | live turn 完成时(用户正预览别处) | **留在预览,不打断**。视图不动,live 会话侧栏指示从"运行中"转"完成"。 |
| Q3 | 返回/识别"正在跑的会话" | **顶部横幅 + 侧栏脉动**双入口。 |
| Q4 | 运行中「＋新对话」 | **也可点**:显示空白新会话预览,输入框锁到 live 完成,顶部有返回横幅。 |
| — | 切项目/加项目 | **保留 running 守卫**(不做跨项目预览);仅要求把静默失效改为可见禁用(不在本 spec 的必做项,记为可选跟进)。 |

## 可行性前提(已在代码中验证)

- `AppServer.handleTurn` 把 turn 丢到**独立线程**运行(`turnThread = new Thread(...); t.start()`,行 577-590),reader 循环(行 176)立刻回去继续读下一条 RPC。故 turn 运行时其它 RPC(如新增的 `session.peek`)能在 reader 线程**并发**处理,不被阻塞。
- `turnThread` 为 `volatile` 单例 → 同一时刻**只有一个** turn 运行 → 永远最多 **1 个 live + 1 个 preview**,不需要通用多会话结构。
- 现有 `session.resume`(`AppServer.handleSessionResume`,行 729)**有副作用**:`session.resume(id)` 会 `agent.restoreHistory` + 换 `LlmClient` + 改 `SessionStore.currentId`,且 `sessionId = id`(行 739)。**turn 运行时调它会劫持后端会话 → 数据损坏。** 因此只读预览**必须走新增的纯读旁路**,绝不复用 `resume`。

## 架构:方案 A(reducer=流式身份 + App 层只读覆盖)

已否决的备选:
- **方案 B**(reducer=当前查看会话 + 后台缓冲区存流式):流式 append 逻辑(CLI 对等敏感、重测试的热路径)要参数化成双目标,风险与测试量都大。
- **方案 C**(全 N 会话 map):YAGNI,后端单 turn 决定了最多 1 live + 1 preview。

**方案 A 要点:** reducer 继续**只代表"正在流式的会话"(live 身份)**,流式热路径一行不动 → CLI 对等安全、现有测试零冲击。新增一个 App 层 `preview` 覆盖态(只读)。审批 modal、`status`、`pendingApproval` 全留在 reducer=live 身份 → 预览零改动继续工作(审批是全局 `ApprovalModal`,读 `state.pendingApproval`,天然盖在预览之上;审批为阻塞式紧急事件,本就该打断预览)。

### 状态机

新增 App 层状态(**不进 reducer**):

```ts
type Preview =
  | null                                          // 看 live(默认)
  | { kind: 'session'; sessionId: string; items: Item[] }  // 只读看某历史会话
  | { kind: 'new' }                               // 空白新会话预览
```

**渲染选择:**
- 主区 transcript:`preview.kind==='session'` → 渲染 `preview.items`;`preview.kind==='new'` → 欢迎/空态;否则 → reducer `items`(live)。
- Composer:锁定规则**不变** —— `turn==='running'` 即锁。故预览任何东西时,只要 live 还在跑,输入框都锁。
- 返回横幅「◀ 返回进行中的会话 · 运行中…」:`preview!==null && turn==='running'` 时显示。
- 侧栏脉动:live 的 `sessionId` 行在 `turn==='running'` 时显运行指示。
- 侧栏高亮:跟随**被查看**会话——`preview.kind==='session'` → 高亮 X;`preview.kind==='new'` → 无高亮(`activeSessionId=''`);`preview===null` → 高亮 live。

**转移(turn 运行中):**

| 动作 | 结果 |
|---|---|
| 点会话 X(X ≠ live.sessionId) | `preview = {kind:'session', sessionId:X, items: peek(X)}` |
| 点 live.sessionId 行 / 点横幅 | `preview = null`(回 live) |
| 点「＋新对话」 | `preview = {kind:'new'}` |

**关键转移:live turn 完成(running→idle)** —— 遵循 Q2"不打断",**视图不动**,把挂着的 preview**落定(执行被推迟的真实切换)**为活跃会话(集中在一个 effect,`resolveOnIdle`)。

⚠️ **正确性核心:** peek 是纯读,后端 `currentId`/agent 内存**从未切到 X**(仍是刚完成的 live 会话 Y)。落定**必须调真正的、有副作用的** `resumeSession(X)`(此刻 turn 已 idle,安全)来把后端 agent+currentId 同步到 X;若只在前端 `loadHistory` 标 X 为活跃,后续 `turn.submit` 会打到后端的 Y → 消息进错会话。故:
- `preview={kind:'session', X}` → `await resumeSession(X)`(真实切换,同步后端)→ `loadHistory(messages)` + `setSessionId(X)` + `markResumed` + `preview=null`。**等价于把运行期推迟的完整切换补做**。仍在看 X,X 成活跃会话,输入框解锁、可续聊。
- `preview={kind:'new'}` → `startSession(workspace)` + `resetSession` + `preview=null`(等价补做「新对话」)。空白新会话激活,输入框解锁。
- `preview=null` → 今天的行为(停在刚完成的 live 会话续聊)。
- 刚完成的 live 会话内容已落盘(turn 末 `persist`),侧栏点它可重新载入 → 落定不丢数据。

**心智模型:preview = 被推迟的切换。** 运行中它是只读影子(peek);引擎空下来时执行真实切换。因此 `resolveOnIdle(session X)` ≡ 运行期若非阻塞本会走的 **idle 完整切换**;`resolveOnIdle(new)` ≡ idle 的「新对话」。二者复用同一套 idle 路径代码,天然对称。

**idle 态点会话**:走今天的完整切换(`resumeSession` 成活跃会话,并清掉任何残留 preview)。即**规则按 `turn` 分叉**:running→预览覆盖(peek 只读影子),idle→完整切换(真实 resume)。

## 后端改动(纯读旁路)

1. **`SessionStore.peek(id)`**(新):
   ```java
   /** 只读载入指定会话的消息,不改 currentId/内存态(供只读预览)。找不到返回空列表。 */
   public synchronized List<LlmClient.Message> peek(String id) {
       SessionRecord rec = read(id);
       return rec == null ? List.of() : rec.messages();
   }
   ```
   `synchronized` → 与 `persist/beginTurn/appendCard` 同一把锁,读 X 文件、turn 写 Y 文件,互斥无撕裂。

2. **`AppServer.SessionRunner.peekSession(id)`**(新 default 方法):
   ```java
   /** 只读读取指定会话消息,不切活跃会话/不碰 agent(供预览)。默认空。 */
   default java.util.List<com.lyhn.wraith.llm.LlmClient.Message> peekSession(String sessionId) {
       return java.util.List.of();
   }
   ```
   Main.java 的 SessionRunner 实现覆写 → `return sessionStore.peek(id);`(不碰 agent / model / currentId)。

3. **`AppServer` 新 RPC `session.peek`**(dispatch 新增 case + handler):
   - 调 `session.peekSession(id)` 得 messages,`SessionMessageCodec.toJson` 序列化;
   - 复用现有 `session.readCards(id)`;
   - 返回 `{ sessionId:id, messages, cards }`;
   - **绝不** `sessionId = id`,**绝不**碰 agent/provider/model。

## 前端改动

4. **preload / IPC**:新增 `window.wraith.peekSession(id: string): Promise<{sessionId, messages, cards}>` → ipcMain → JSON-RPC `session.peek`。
   ⚠️ 加 preload 方法后 dev app 必须**完全重启**(preload 不热重载,否则 `window.wraith.peekSession is not a function`——已知坑)。

5. **`desktop/src/shared/sessionPreview.ts`(新纯模块)** —— 把状态机抽成纯函数,照 `spliceCards.ts`/`sessionView.ts` 先例,vitest 单测:
   - `previewSelect(preview, clickedId, liveSessionId, items)` → 新 Preview(点会话:同 live 则 null,否则 session-kind)
   - `previewNewConv()` → `{kind:'new'}`
   - `previewReturnLive()` → `null`
   - `resolveOnIdle(preview)` → 一个描述"落定动作"的判别结果(`{action:'resume', sessionId}` / `{action:'new'}` / `{action:'none'}`),供 App effect 执行**真实** `resumeSession`/`startSession`/no-op,纯函数便于测试。
   - 说明:RPC 调用与 dispatch 留在 App(有副作用),纯模块只做决策。落定执行的是**有副作用的真实切换**(见状态机正确性核心),不是纯前端 loadHistory。

6. **`App.tsx`**:
   - `const [preview, setPreview] = useState<Preview>(null)`
   - `handleSelectSession(id)`:`turnRef.current==='running'` → 走预览(同 live→`setPreview(null)`;否则 `peekSession(id)` → `setPreview({kind:'session',...})`);否则 → 今天的完整 `resume` 切换 + `setPreview(null)`。均 `setView('chat')`。
   - `handleNewConversation()`:running → `setPreview({kind:'new'})` + `setView('chat')`;否则 → 今天的 reset 行为 + `setPreview(null)`。
   - `returnToLive = () => setPreview(null)`。
   - `resolveOnIdle` effect(复用现有 `prevTurnRef` 的 running→idle 边沿):按 preview 类型落定(见状态机)。
   - 渲染选择:计算 `viewedItems`;`activeSessionId`=被查看会话;新增 `runningSessionId = state.turn==='running' ? state.sessionId : ''`。

7. **`Sidebar.tsx`**:新增 `runningSessionId` prop,在该行渲染脉动指示(`SessionRow` 收 `running` 标志);`activeSessionId` 语义改为"被查看会话"(高亮跟随查看)。

8. **`PreviewBanner`**(App 内联):`preview!==null && turn==='running'` 时显「◀ 返回进行中的会话 · 运行中…」→ `returnToLive`。

9. **`Transcript.tsx`**:`busy` 收紧为 `turn==='running' && preview===null`,使 WorkingIndicator/流式指示只在 live 视图出现,预览为静态。

## 数据流(预览一次)

```
点会话 X (turn 运行中)
  → window.wraith.peekSession(X)            [纯读 RPC,后台 turn 不受扰]
  → spliceCards(messagesToItems(msgs), cards)
  → setPreview({kind:'session', X, items})
  → 主区渲染 preview.items(只读)
  ┊ 期间 live 流式事件继续照常灌进 reducer(用户看不到,后台跑)
turn 完成 (running→idle)
  → resolveOnIdle: await resumeSession(X)   [真实切换,同步后端 agent+currentId 到 X]
  → loadHistory(messages) + setSessionId(X) + markResumed + preview=null
  → 视图不动(仍看 X),X 成活跃会话,composer 解锁并正确指向 X
```

## 边界与并发

- **审批**:运行中审批请求到达 → 全局 `ApprovalModal` 照常弹(读 `state.pendingApproval`=live 身份),盖在预览之上。用户可直接处理,无需先返回 live。零额外代码。
- **status/model**:预览态下 `status`(token 计数)与 header model 继续反映 live turn(唯一在进行的计算),不因预览改变。可接受(状态栏表达"当前活动")。
- **并发安全**:`peek`/`readCards` 与 turn 线程的 `persist`/`beginTurn`/`appendCard` 同一 `SessionStore` monitor,互斥;且预览读 X 文件、turn 写 Y 文件,内容互不影响。
- **预览会话被删**:预览态删除某会话走现有 `deleteSession`;若删的正是预览目标,App 应 `setPreview(null)` 回 live(实现时在删除回调里处理)。
- **连接断开**:`connection==='disconnected'` 时 reducer 置 `turn='idle'`;此时 `resolveOnIdle` 会触发落定。断连场景下 peek 可能失败 → `try/catch`,失败则不进入预览(保持 live)。

## Out of Scope(YAGNI)

- 跨项目会话预览(需切 workspace/MCP/工具集)。
- 项目切换/加项目在运行中的预览行为(保留守卫;静默→可见禁用记为可选跟进,不在本 spec)。
- 多个(>1)后台并行 turn(后端单 turn 模型)。
- 预览态下对历史会话的任何写操作(纯只读)。

## 安全红线复核

- 本功能不新增任何密钥读写路径。`session.peek` 仅回传消息与 card 事件(与现有 `resume` 回包同源),不含 provider apiKey/secret。
- 密钥仍只存 `~/.wraith/config.json`,不进日志/回传。提交前照常跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。

## 测试策略

- **Java**:
  - `SessionStoreTest`:新增 `peek` 用例——(a) 返回目标会话消息;(b) peek 后 `currentId()` 保持不变(核心不变量:纯读无副作用);(c) 不存在的 id 返回空列表。
  - `AppServer` 测试(带 stub SessionRunner):`session.peek` 返回 `{messages, cards}` 且**不改** `sessionId`(可对比 peek 前后一次 turn 的持久化归属)。
  - 现有 `resume` 相关测试**不动** → 绿即证 CLI 对等/现有路径无回归。
- **前端**:
  - `sessionPreview.ts` 纯函数 vitest 全覆盖:四种转移 + 三种 `resolveOnIdle` 分支 + 点 live 返回。
  - App 接线、Sidebar/Banner/Transcript 视觉:`npm run typecheck` + `npx vitest run` + `npm run build` + 眼验(无 RTL)。
- **眼验脚本**:plan/team/react 任一模式发一条长任务 → 运行中点侧栏另一会话 → 立即只读显示其历史(顶部有返回横幅、侧栏原会话脉动)→ 点横幅/原会话行返回 live → 等 turn 结束 → 视图停在所看会话且可续聊;另测运行中点「＋新对话」→ 空白预览 + 锁输入 → turn 结束后解锁可发。
