# 运行中会话只读预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个 turn 正在运行时,允许用户在侧栏只读查看同项目内其它会话(以及打开空白「新对话」预览),运行中的 turn 后台继续、不被打断。

**Architecture:** 方案 A —— reducer 继续只代表"正在流式的会话"(live 身份),流式热路径一行不动;新增 App 层只读覆盖态 `preview`。后端新增纯读旁路 `SessionStore.peek` / `SessionRunner.peekSession` / RPC `session.peek`(现有 `session.resume` 有副作用,turn 运行时调会劫持后端 → 必须旁路)。`preview = 被推迟的切换`:运行中是 peek 只读影子,turn→idle 时 `resolveOnIdle` 执行真实 `resumeSession` 落定。

**Tech Stack:** Java 17 / Maven(后端);Electron + React + TypeScript + Vitest(桌面)。设计详见 `docs/superpowers/specs/2026-07-09-session-preview-design.md`。

## Global Constraints

- **CLI 对等第一约束**:流式热路径(`message.delta` / `plan.*` / `team.*` 的 append 逻辑、reducer、现有 `session.resume` 路径)**一行不改**;现有测试必须全绿即证无回归。
- **`peek` 纯只读铁律**:`SessionStore.peek` / `SessionRunner.peekSession` / `session.peek` 绝不改 `currentId`、绝不碰 agent 内存、绝不换 LlmClient、绝不设 `AppServer.sessionId`。这是数据安全核心不变量。
- **作用域仅同项目会话**;切项目/加项目保留现有 `running` 守卫(不做跨项目预览)。
- **后端单 turn**:同时最多 1 个 live turn;永远最多 1 live + 1 preview,不引入通用多会话结构(YAGNI)。
- **密钥红线**:不新增任何密钥读写路径;`session.peek` 回包只含 messages + card 事件,不含 apiKey/secret。提交前跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。
- **中文**回答;commit trailer 用 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- Java 测试默认被跳过,单测须带 `-DskipTests=false`;基线约 4F 为 JDK/Mockito 噪声,非本改动引入。
- 桌面无 RTL:App/Sidebar 接线靠 `npm run typecheck` + `npm run build` + 眼验;可测逻辑一律沉进纯模块用 vitest 覆盖。

---

## File Structure

- `src/main/java/com/lyhn/wraith/session/SessionStore.java` — 新增 `peek(id)` 纯读方法(Task 1)。
- `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` — `SessionRunner.peekSession` 默认方法 + `session.peek` dispatch/handler(Task 2)。
- `src/main/java/com/lyhn/wraith/cli/Main.java` — SessionRunner 实现覆写 `peekSession` → `sessionStore.peek`(Task 2)。
- `desktop/src/preload/index.ts` + `desktop/src/main/index.ts` — `peekSession` 跨层通道(Task 3)。
- `desktop/src/shared/sessionPreview.ts`(新)— 纯决策/派生模块(Task 4)。
- `desktop/src/renderer/App.tsx` + `Sidebar.tsx` + `PreviewBanner.tsx`(新)— 接线(Task 5)。`Transcript.tsx` 无需改(busy/items 由 App 传入)。

---

### Task 1: SessionStore.peek — 纯读旁路

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/session/SessionStore.java`(在 `resume` 方法后,现约 268 行)
- Test: `src/test/java/com/lyhn/wraith/session/SessionStoreTest.java`

**Interfaces:**
- Consumes: 现有 `private SessionRecord read(String id)`(336 行)、`private record SessionRecord(SessionMeta meta, List<LlmClient.Message> messages)`(315 行)、`public synchronized String currentId()`(123 行)。
- Produces: `public synchronized List<LlmClient.Message> peek(String id)` —— 返回指定会话消息;不存在返回空列表;**不改任何内存态**。

- [ ] **Step 1: Write the failing test**

在 `SessionStoreTest.java` 末尾(最后一个 `}` 前)加两个用例:

```java
    @Test
    void peekReturnsMessagesWithoutChangingCurrentSession(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "p", "m");
        store.persist(sampleHistory());                 // 会话 A
        store.startNew();
        store.persist(List.of(
                LlmClient.Message.system("s"),
                LlmClient.Message.user("第二个会话")));   // 会话 B(当前)
        String bId = store.currentId();
        List<SessionMeta> metas = store.list(10);
        assertEquals(2, metas.size());
        // 取 A 的 id(list 按 updatedAt 倒序,B 在前,A 在后)
        String aId = metas.get(1).id();

        List<LlmClient.Message> peeked = store.peek(aId);
        assertEquals(2, peeked.size(), "system 不持久化,应剩 user+assistant");
        assertEquals("帮我重构 Foo 类", peeked.get(0).content());
        assertEquals(bId, store.currentId(), "peek 必须只读,绝不改 currentId");
    }

    @Test
    void peekMissingSessionReturnsEmptyAndKeepsCurrent(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "p", "m");
        store.persist(sampleHistory());
        String before = store.currentId();
        assertTrue(store.peek("no-such-id").isEmpty());
        assertEquals(before, store.currentId());
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mvn -Dtest=SessionStoreTest -DskipTests=false test`
Expected: 编译失败 `cannot find symbol: method peek(...)`(方法尚未存在)。

- [ ] **Step 3: Write minimal implementation**

在 `SessionStore.java` 的 `resume(...)` 方法(结束于约 268 行 `}`)之后插入:

```java
    /** 只读载入指定会话的消息,不改 currentId/内存态(供只读预览)。找不到返回空列表。 */
    public synchronized List<LlmClient.Message> peek(String id) {
        SessionRecord rec = read(id);
        return rec == null ? List.of() : rec.messages();
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mvn -Dtest=SessionStoreTest -DskipTests=false test`
Expected: BUILD SUCCESS;`SessionStoreTest` 全部通过(含既有 `persistsAndResumes` 等,证明 `resume` 未受影响)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/session/SessionStore.java \
        src/test/java/com/lyhn/wraith/session/SessionStoreTest.java
git commit -m "feat(session): SessionStore.peek 只读载入会话消息(不切 currentId)"
```

---

### Task 2: session.peek RPC + SessionRunner.peekSession

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(`SessionRunner` 接口约 49-51 行后加默认方法;dispatch 约 202 行后加 case;`handleSessionResume` 约 759 行后加 handler)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(SessionRunner 匿名类,`resume` 覆写约 1246 行后加 `peekSession`)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSessionTest.java`

**Interfaces:**
- Consumes: Task 1 的 `SessionStore.peek(id)`;现有 `SessionMessageCodec.toJson(mapper, msg)`、`SessionRunner.readCards(id)`、`JsonRpcWriter.result/error`。
- Produces: RPC `session.peek {sessionId}` → `{sessionId, messages, cards}`;`SessionRunner.peekSession(String) : List<LlmClient.Message>`(默认空)。**不改 `AppServer.sessionId`,不触发 `resume`。**

- [ ] **Step 1: Write the failing test**

在 `AppServerSessionTest.java` 末尾(最后一个 `}` 前)加:

```java
    @Test
    void sessionPeekReadsMessagesAndCardsWithoutResuming() throws Exception {
        java.util.concurrent.atomic.AtomicInteger resumeCalls = new java.util.concurrent.atomic.AtomicInteger();
        java.util.concurrent.atomic.AtomicInteger peekCalls = new java.util.concurrent.atomic.AtomicInteger();
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
                public List<LlmClient.Message> resume(String id) { resumeCalls.incrementAndGet(); return List.of(); }
                public List<LlmClient.Message> peekSession(String id) {
                    peekCalls.incrementAndGet();
                    return List.of(new LlmClient.Message("user", "peeked-hi", null, null, null));
                }
                public List<JsonNode> readCards(String id) {
                    com.fasterxml.jackson.databind.node.ObjectNode n = JsonRpc.MAPPER.createObjectNode();
                    n.put("turnOrdinal", 1);
                    n.set("events", JsonRpc.MAPPER.createArrayNode());
                    return List.of(n);
                }
            };
        };
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.peek\",\"params\":{\"sessionId\":\"s7\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, f).serve();
        JsonNode res = parseAll(out.toString(StandardCharsets.UTF_8)).stream()
            .filter(n -> n.path("id").asInt(-1) == 2 && n.has("result")).findFirst().orElseThrow().get("result");
        assertEquals("s7", res.get("sessionId").asText());
        assertEquals(1, res.get("messages").size());
        assertEquals("peeked-hi", res.get("messages").get(0).get("content").asText());
        assertTrue(res.get("cards").isArray() && res.get("cards").size() == 1);
        assertEquals(1, peekCalls.get(), "session.peek 必须走 peekSession");
        assertEquals(0, resumeCalls.get(), "session.peek 绝不能触发 resume(有副作用)");
    }

    @Test
    void sessionPeekGuardsNoSessionAndMissingId() throws Exception {
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.peek\",\"params\":{\"sessionId\":\"s1\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"session.peek\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, factory(new AtomicInteger())).serve();
        List<JsonNode> replies = parseAll(out.toString(StandardCharsets.UTF_8));
        assertEquals(-32000, replies.stream().filter(n -> n.path("id").asInt(-1) == 1 && n.has("error"))
            .findFirst().orElseThrow().get("error").get("code").asInt());   // no session
        assertEquals(-32602, replies.stream().filter(n -> n.path("id").asInt(-1) == 3 && n.has("error"))
            .findFirst().orElseThrow().get("error").get("code").asInt());   // missing sessionId
    }
```

（`factory(...)` 是文件里已有的辅助工厂;其返回的 runner 未覆写 `peekSession`,故走接口默认空实现——第一条 `no session`、第三条 `missing sessionId` 只验守卫,不依赖 peek 返回值。）

- [ ] **Step 2: Run test to verify it fails**

Run: `mvn -Dtest=AppServerSessionTest -DskipTests=false test`
Expected: 编译失败 `method peekSession(...) is undefined` / 或 `session.peek` 无 case 导致返回 method-not-found,断言失败。

- [ ] **Step 3a: SessionRunner 接口加默认方法**

在 `AppServer.java` 的 `resume` 默认方法(49-51 行)之后插入:

```java
        /** 只读读取指定会话消息,不切活跃会话/不碰 agent(供预览)。默认空。 */
        default java.util.List<com.lyhn.wraith.llm.LlmClient.Message> peekSession(String sessionId) {
            return java.util.List.of();
        }
```

- [ ] **Step 3b: dispatch 加 case**

在 `dispatch(...)` 的 `case "session.resume" -> handleSessionResume(msg);`(202 行)之后插入:

```java
            case "session.peek" -> handleSessionPeek(msg);
```

- [ ] **Step 3c: 加 handler**

在 `handleSessionResume(...)` 方法(结束于约 759 行 `}`)之后、类结束 `}` 之前插入:

```java
    private void handleSessionPeek(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String id = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (id.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        // 纯只读:绝不 sessionId = id,绝不碰 agent/model。
        java.util.List<com.lyhn.wraith.llm.LlmClient.Message> msgs = session.peekSession(id);
        java.util.List<com.fasterxml.jackson.databind.node.ObjectNode> wire = new java.util.ArrayList<>();
        for (com.lyhn.wraith.llm.LlmClient.Message m : msgs) {
            wire.add(com.lyhn.wraith.session.SessionMessageCodec.toJson(JsonRpc.MAPPER, m));
        }
        java.util.Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("sessionId", id);
        result.put("messages", wire);
        result.put("cards", session.readCards(id));
        writer.result(msg.id(), result);
    }
```

- [ ] **Step 3d: Main.java 实现覆写**

在 `Main.java` 的 SessionRunner 匿名类里,`resume` 覆写(结束于约 1246 行)之后插入:

```java
                    @Override
                    public java.util.List<com.lyhn.wraith.llm.LlmClient.Message> peekSession(String id) {
                        return sessionStore.peek(id);   // 纯读,不碰 agent/currentId
                    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mvn -Dtest=AppServerSessionTest -DskipTests=false test`
Expected: BUILD SUCCESS;新增两用例通过,既有 `sessionResumeSerializesMessages` 等全绿(证明 resume 路径无回归)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSessionTest.java
git commit -m "feat(appserver): session.peek 只读 RPC + SessionRunner.peekSession(不切活跃会话)"
```

---

### Task 3: 桌面跨层通道 peekSession（preload + main）

**Files:**
- Modify: `desktop/src/preload/index.ts`(WraithApi 接口约 32 行后;实现约 169 行后)
- Modify: `desktop/src/main/index.ts`(ipcMain handler 约 559 行后)

**Interfaces:**
- Consumes: Task 2 的 RPC `session.peek`;现有 `client.request`、`ResumedMessage` 类型。
- Produces: `window.wraith.peekSession(sessionId): Promise<{sessionId, messages: ResumedMessage[], cards?}>` —— 只读,ipcMain **不更新 `currentSessionId`**。

- [ ] **Step 1: 在 WraithApi 接口加签名**

在 `desktop/src/preload/index.ts` 的 `resumeSession(...)` 接口行(32 行)之后插入:

```ts
  peekSession(sessionId: string): Promise<{ sessionId: string; messages: ResumedMessage[]; cards?: Array<{ turnOrdinal: number; events: Array<{ method: string; params: unknown }> }> }>
```

- [ ] **Step 2: 在 preload 实现体加方法**

在同文件 `resumeSession(sessionId) { ... },`(160-169 行)之后插入:

```ts
  peekSession(sessionId) {
    return ipcRenderer.invoke('wraith:peekSession', sessionId) as Promise<{
      sessionId: string
      messages: ResumedMessage[]
      cards?: Array<{ turnOrdinal: number; events: Array<{ method: string; params: unknown }> }>
    }>
  },
```

- [ ] **Step 3: 在 main 加 ipcMain handler**

在 `desktop/src/main/index.ts` 的 `wraith:resumeSession` handler(556-559 行)之后插入:

```ts
ipcMain.handle('wraith:peekSession', async (_e, sessionId: string) => {
  if (!client) throw new Error('Backend not connected')
  // 只读预览:不更新 currentSessionId(这是运行中会话的活跃指针)。
  return client.request('session.peek', { sessionId })
})
```

- [ ] **Step 4: Typecheck + build**

Run: `cd desktop && npm run typecheck && npm run build`
Expected: typecheck 0 error;build 成功。（无单测——IPC 直传层,与既有 `resumeSession` 同款,靠类型贯通验证。）

- [ ] **Step 5: Commit**

```bash
git add desktop/src/preload/index.ts desktop/src/main/index.ts
git commit -m "feat(desktop/ipc): window.wraith.peekSession → session.peek(只读,不改 currentSessionId)"
```

---

### Task 4: sessionPreview.ts 纯决策/派生模块 + vitest

**Files:**
- Create: `desktop/src/shared/sessionPreview.ts`
- Test: `desktop/test/sessionPreview.test.ts`

**Interfaces:**
- Consumes: `Item` 类型(`import type { Item } from './transcriptReducer'`)。
- Produces:
  - `type Preview = null | { kind:'session'; sessionId:string; items:Item[] } | { kind:'new' }`
  - `selectAction(turn, clickedId, liveSessionId)` → `{mode:'preview-return'} | {mode:'preview-open';sessionId} | {mode:'full-switch';sessionId}`
  - `resolveOnIdle(preview)` → `{action:'resume';sessionId} | {action:'new'} | {action:'none'}`
  - `deriveView(preview, live)` → `{items, activeSessionId, runningSessionId, showWelcome, transcriptBusy, showReturnBanner}`

- [ ] **Step 1: Write the failing test**

Create `desktop/test/sessionPreview.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { selectAction, resolveOnIdle, deriveView, type Preview } from '../src/shared/sessionPreview'
import type { Item } from '../src/shared/transcriptReducer'

const A: Item[] = [{ type: 'user', ordinal: 1, text: 'A-hi' } as unknown as Item]
const LIVE: Item[] = [{ type: 'user', ordinal: 1, text: 'live' } as unknown as Item]

describe('selectAction', () => {
  it('running + 点 live 行 → 返回 live', () => {
    expect(selectAction('running', 's-live', 's-live')).toEqual({ mode: 'preview-return' })
  })
  it('running + 点别的会话 → 打开预览', () => {
    expect(selectAction('running', 's-other', 's-live')).toEqual({ mode: 'preview-open', sessionId: 's-other' })
  })
  it('idle → 完整切换', () => {
    expect(selectAction('idle', 's-other', 's-live')).toEqual({ mode: 'full-switch', sessionId: 's-other' })
  })
})

describe('resolveOnIdle', () => {
  it('null → none', () => expect(resolveOnIdle(null)).toEqual({ action: 'none' }))
  it('session → resume+id', () =>
    expect(resolveOnIdle({ kind: 'session', sessionId: 'x', items: A })).toEqual({ action: 'resume', sessionId: 'x' }))
  it('new → new', () => expect(resolveOnIdle({ kind: 'new' })).toEqual({ action: 'new' }))
})

describe('deriveView', () => {
  const live = { sessionId: 's-live', items: LIVE, hasStarted: true, turn: 'running' as const }

  it('看 live(running)→ 渲染 live.items,busy,无横幅', () => {
    expect(deriveView(null, live)).toEqual({
      items: LIVE, activeSessionId: 's-live', runningSessionId: 's-live',
      showWelcome: false, transcriptBusy: true, showReturnBanner: false,
    })
  })
  it('看 live(idle 未开始)→ welcome,不 busy', () => {
    expect(deriveView(null, { ...live, hasStarted: false, turn: 'idle' })).toEqual({
      items: LIVE, activeSessionId: 's-live', runningSessionId: '',
      showWelcome: true, transcriptBusy: false, showReturnBanner: false,
    })
  })
  it('预览会话 X(running)→ 渲染 X.items,不 busy,有横幅,脉动指向 live', () => {
    const p: Preview = { kind: 'session', sessionId: 's-x', items: A }
    expect(deriveView(p, live)).toEqual({
      items: A, activeSessionId: 's-x', runningSessionId: 's-live',
      showWelcome: false, transcriptBusy: false, showReturnBanner: true,
    })
  })
  it('预览新会话(running)→ 空 welcome,有横幅', () => {
    expect(deriveView({ kind: 'new' }, live)).toEqual({
      items: [], activeSessionId: '', runningSessionId: 's-live',
      showWelcome: true, transcriptBusy: false, showReturnBanner: true,
    })
  })
  it('预览会话但 turn 已 idle(落定前一瞬)→ 无横幅、脉动清空', () => {
    const p: Preview = { kind: 'session', sessionId: 's-x', items: A }
    expect(deriveView(p, { ...live, turn: 'idle' })).toEqual({
      items: A, activeSessionId: 's-x', runningSessionId: '',
      showWelcome: false, transcriptBusy: false, showReturnBanner: false,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run test/sessionPreview.test.ts`
Expected: FAIL —— 模块 `../src/shared/sessionPreview` 不存在。

- [ ] **Step 3: Write the module**

Create `desktop/src/shared/sessionPreview.ts`:

```ts
import type { Item } from './transcriptReducer'

/** 只读预览覆盖态(App 层,不进 reducer)。 */
export type Preview =
  | null
  | { kind: 'session'; sessionId: string; items: Item[] }
  | { kind: 'new' }

type Turn = 'idle' | 'running'

/** 点侧栏会话行的决策。running→预览覆盖;idle→完整切换。 */
export function selectAction(
  turn: Turn,
  clickedId: string,
  liveSessionId: string,
):
  | { mode: 'preview-return' }
  | { mode: 'preview-open'; sessionId: string }
  | { mode: 'full-switch'; sessionId: string } {
  if (turn === 'running') {
    return clickedId === liveSessionId
      ? { mode: 'preview-return' }
      : { mode: 'preview-open', sessionId: clickedId }
  }
  return { mode: 'full-switch', sessionId: clickedId }
}

/** turn 跑完时如何落定挂着的 preview(执行被推迟的真实切换)。 */
export function resolveOnIdle(
  preview: Preview,
): { action: 'resume'; sessionId: string } | { action: 'new' } | { action: 'none' } {
  if (preview === null) return { action: 'none' }
  if (preview.kind === 'session') return { action: 'resume', sessionId: preview.sessionId }
  return { action: 'new' }
}

/** 由 preview + live 状态派生视图模型,保持 App 渲染分支瘦。 */
export function deriveView(
  preview: Preview,
  live: { sessionId: string; items: Item[]; hasStarted: boolean; turn: Turn },
): {
  items: Item[]
  activeSessionId: string
  runningSessionId: string
  showWelcome: boolean
  transcriptBusy: boolean
  showReturnBanner: boolean
} {
  const runningSessionId = live.turn === 'running' ? live.sessionId : ''
  if (preview !== null && preview.kind === 'session') {
    return {
      items: preview.items,
      activeSessionId: preview.sessionId,
      runningSessionId,
      showWelcome: false,
      transcriptBusy: false,
      showReturnBanner: live.turn === 'running',
    }
  }
  if (preview !== null && preview.kind === 'new') {
    return {
      items: [],
      activeSessionId: '',
      runningSessionId,
      showWelcome: true,
      transcriptBusy: false,
      showReturnBanner: live.turn === 'running',
    }
  }
  // 看 live
  return {
    items: live.items,
    activeSessionId: live.sessionId,
    runningSessionId,
    showWelcome: !live.hasStarted,
    transcriptBusy: live.turn === 'running',
    showReturnBanner: false,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run test/sessionPreview.test.ts && npm run typecheck`
Expected: 全部用例 PASS;typecheck 0 error。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/sessionPreview.ts desktop/test/sessionPreview.test.ts
git commit -m "feat(desktop): sessionPreview 纯模块(selectAction/resolveOnIdle/deriveView)+ vitest"
```

---

### Task 5: App 接线 + Sidebar 脉动 + PreviewBanner

**Files:**
- Create: `desktop/src/renderer/components/PreviewBanner.tsx`
- Modify: `desktop/src/renderer/components/Sidebar.tsx`(SidebarProps 加 `runningSessionId`;SessionRow 加脉动;搜索态列表加脉动)
- Modify: `desktop/src/renderer/App.tsx`(preview state + handlers + idle 落定 effect + 渲染派生 + 删除边界)

**Interfaces:**
- Consumes: Task 3 `window.wraith.peekSession`;Task 4 `selectAction/resolveOnIdle/deriveView/Preview`;现有 `spliceCards`、`messagesToItems`、`resumeSession`、`startSession`、reducer actions `loadHistory/setSessionId/markResumed/setModel/resetSession`。
- Produces: 运行中侧栏可只读预览会话/新对话;顶部返回横幅;侧栏运行中脉动;turn→idle 自动落定。

- [ ] **Step 1: PreviewBanner 组件**

Create `desktop/src/renderer/components/PreviewBanner.tsx`:

```tsx
/** 预览态顶部横幅:点它返回正在运行的 live 会话。 */
export default function PreviewBanner({ onReturn }: { onReturn: () => void }): JSX.Element {
  return (
    <button
      data-testid="preview-return-banner"
      onClick={onReturn}
      className="flex w-full items-center gap-2 border-b border-accent/40 bg-accent/10 px-4 py-2 text-left text-xs text-accent hover:bg-accent/20"
    >
      <span aria-hidden>◀</span>
      <span>返回进行中的会话</span>
      <span className="ml-1 flex items-center gap-1 text-fg-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
        运行中…
      </span>
    </button>
  )
}
```

- [ ] **Step 2: Sidebar 加 runningSessionId + 脉动**

在 `Sidebar.tsx`:

(a) `SessionRow` 的参数解构与类型加 `running`:

```tsx
function SessionRow({ s, active, running, onSelect, onToggleStar, onRename, onDelete }: {
  s: SessionMeta; active: boolean; running: boolean
  onSelect: (id: string) => void
  onToggleStar: (id: string, starred: boolean) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}): JSX.Element {
```

(b) 在 `SessionRow` 返回的行内、会话名 `<button>`(现约 59-63 行)之前插入脉动点:

```tsx
      {running && (
        <span data-testid="session-running-dot" className="relative ml-1 flex h-2 w-2 shrink-0" title="运行中">
          <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-accent opacity-75 motion-reduce:hidden" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
      )}
```

(c) `SidebarProps` 接口加字段(在 `activeSessionId: string` 后):

```tsx
  runningSessionId: string
```

(d) 组件参数解构加 `runningSessionId`(在 `activeSessionId,` 后):

```tsx
  activeSessionId,
  runningSessionId,
```

(e) `renderRows` 里把 `running` 传下去(现约 328-332 行):

```tsx
                const renderRows = (list: SessionMeta[]): JSX.Element[] => list.map(s => (
                  <SessionRow key={s.id} s={s} active={s.id === activeSessionId}
                    running={s.id === runningSessionId}
                    onSelect={onSelectSession} onToggleStar={onToggleStar}
                    onRename={onRenameSession} onDelete={onDeleteSession} />
                ))
```

(f) 搜索态列表(现约 306-320 行 map)的 `<button>` 内、文本前加同款脉动(该分支 session 为 `{id,title}`):

```tsx
                    <button
                      key={s.id}
                      data-testid="conversation-item"
                      onClick={() => onSelectSession(s.id)}
                      className={
                        'mb-0.5 flex w-full items-center gap-1 truncate rounded-lg px-3 py-2 text-left text-xs ' +
                        (s.id === activeSessionId ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')
                      }
                      title={s.title}
                    >
                      {s.id === runningSessionId && (
                        <span className="relative flex h-2 w-2 shrink-0" title="运行中">
                          <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-accent opacity-75 motion-reduce:hidden" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                        </span>
                      )}
                      <span className="truncate">{s.title || '(未命名)'}</span>
                    </button>
```

（注:(b) 与 (f) 的脉动点 wrapper 均已含 `relative`(`absolute` 子元素定位所需),照抄即可。）

- [ ] **Step 3: App.tsx 接线**

(a) 顶部 import:

```tsx
import PreviewBanner from './components/PreviewBanner'
import { selectAction, resolveOnIdle, deriveView, type Preview } from '../shared/sessionPreview'
```

(b) 在组件内(靠近 `turnRef` 定义,现约 155 行)加 preview state + ref:

```tsx
  const [preview, setPreview] = useState<Preview>(null)
  const previewRef = useRef<Preview>(null)
  useEffect(() => { previewRef.current = preview }, [preview])
```

(c) 新增 `commitSwitchTo`(真实切换,供 idle 完整切换与落定复用),放在 `handleSelectSession` 之前:

```tsx
  // 完整切换到某会话(仅 idle 安全调用):真实 resume 同步后端 agent+currentId + 前端载入。
  const commitSwitchTo = useCallback(async (id: string) => {
    const { sessionId, messages, model, modelFallback, cards } = await window.wraith.resumeSession(id)
    statusThrottleRef.current?.cancel()
    dispatch({ type: 'loadHistory', items: spliceCards(messagesToItems(messages), cards) })
    dispatch({ type: 'setSessionId', sessionId })
    dispatch({ type: 'markResumed' })
    if (model) dispatch({ type: 'setModel', model })
    setModelFallbackNotice(modelFallback === true)
    void fetchSessions()
  }, [fetchSessions])
```

(d) 用下面整体替换现有 `handleSelectSession`(264-281 行):

```tsx
  const handleSelectSession = useCallback(async (id: string) => {
    const act = selectAction(turnRef.current, id, state.sessionId)
    setView('chat')
    if (act.mode === 'preview-return') { setPreview(null); return }
    if (act.mode === 'preview-open') {
      try {
        const { messages, cards } = await window.wraith.peekSession(id)   // 纯读,后台 turn 不受扰
        setPreview({ kind: 'session', sessionId: id, items: spliceCards(messagesToItems(messages), cards ?? []) })
      } catch (err) {
        console.error('[wraith] peekSession error:', err)                 // 失败则不进预览,留在 live
      }
      return
    }
    // full-switch(idle)
    try { setPreview(null); await commitSwitchTo(id) }
    catch (err) { console.error('[wraith] resumeSession error:', err) }
  }, [state.sessionId, commitSwitchTo])
```

(e) 用下面整体替换现有 `handleNewConversation`(249-262 行):

```tsx
  const handleNewConversation = useCallback(async () => {
    if (turnRef.current === 'running') { setPreview({ kind: 'new' }); setView('chat'); return }
    setView('chat')
    try {
      await window.wraith.startSession(state.workspace || null)
      statusThrottleRef.current?.cancel()
      dispatch({ type: 'resetSession', ws: state.workspace })
      setModelFallbackNotice(false)
      setSubmitError(null)
      setPreview(null)
      void fetchSessions()
    } catch (err) {
      console.error('[wraith] newConversation error:', err)
    }
  }, [state.workspace, fetchSessions])
```

(f) 扩展 turn 完成的 effect(370-376 行)以落定 preview:

```tsx
  const prevTurnRef = useRef(state.turn)
  useEffect(() => {
    if (prevTurnRef.current === 'running' && state.turn === 'idle') {
      void fetchSessions()
      const r = resolveOnIdle(previewRef.current)   // 执行被推迟的真实切换
      if (r.action === 'resume') { setPreview(null); void commitSwitchTo(r.sessionId) }
      else if (r.action === 'new') { void handleNewConversation() }   // 其内部走 idle 分支并清 preview
    }
    prevTurnRef.current = state.turn
  }, [state.turn, fetchSessions, commitSwitchTo, handleNewConversation])
```

(g) 删除边界:在 `handleDeleteSession` 里,删除完成后若删的是当前预览目标,回 live。找到 `handleDeleteSession`(约 290-302 行)删除成功分支,加:

```tsx
      const pv = previewRef.current
      if (pv && pv.kind === 'session' && pv.sessionId === id) setPreview(null)
```

- [ ] **Step 4: App.tsx 渲染派生 + 组件接线**

(a) 在 `return (` 之前计算派生视图(现约 698 行):

```tsx
  const pv = deriveView(preview, {
    sessionId: state.sessionId,
    items: state.items,
    hasStarted: state.hasStarted,
    turn: state.turn,
  })
```

(b) `Sidebar` 的 `activeSessionId` 改为派生值,并加 `runningSessionId`(706 行附近):

```tsx
        activeSessionId={pv.activeSessionId}
        runningSessionId={pv.runningSessionId}
```

(c) 在顶部 banner 区(`updateNotice` 块之后,约 750 行,`{view === 'plugins' ...` 之前)插入返回横幅:

```tsx
        {view === 'chat' && pv.showReturnBanner && (
          <PreviewBanner onReturn={() => setPreview(null)} />
        )}
```

(d) chat 分支(777-818 行的 IIFE)里三处替换:

- Composer 的 `centered`:`centered={!state.hasStarted}` → `centered={pv.showWelcome}`
- Transcript 的 `items`/`busy`:`items={state.items}` → `items={pv.items}`;`busy={state.turn === 'running'}` → `busy={pv.transcriptBusy}`
- 布局判据:`return state.hasStarted ? (` → `return !pv.showWelcome ? (`

- [ ] **Step 5: Typecheck + build + 全量 vitest**

Run: `cd desktop && npm run typecheck && npx vitest run && npm run build`
Expected: typecheck 0 error;vitest 全绿(含既有全部用例 + Task 4 新增);build 成功。

- [ ] **Step 6: Commit**

```bash
git add desktop/src/renderer/App.tsx \
        desktop/src/renderer/components/Sidebar.tsx \
        desktop/src/renderer/components/PreviewBanner.tsx
git commit -m "feat(desktop): 运行中会话只读预览(App 覆盖态 + 侧栏脉动 + 返回横幅)"
```

---

## 交付后(执行阶段处理,非本计划的 per-task 步骤)

- **重建并部署 jar**:后端改动需 `mvn -DskipTests package` 后把 jar 覆盖到 `~/.wraith/wraith.jar`;**dev App 必须完全重启**(新 jar + preload 新方法 `peekSession`——preload 不热重载,否则 `window.wraith.peekSession is not a function`)。
- **眼验脚本**:
  1. plan/team/react 任一模式发一条较长任务 → 运行中点侧栏另一会话 → 立即只读显示其历史,顶部出现「◀ 返回进行中的会话 · 运行中…」横幅,侧栏原会话行脉动。
  2. 点横幅 / 点侧栏原会话行 → 返回 live,流式指示恢复。
  3. 运行中点「＋新对话」→ 空白欢迎界面,输入框锁,顶部有返回横幅。
  4. 等 turn 结束 → 视图停在所看会话:预览会话可续聊(消息进对的会话,验证真实切换落定);新对话预览解锁可发。
  5. idle 态点会话仍是完整切换(回归)。
- 提交前跑密钥扫描(见 Global Constraints)。

## Self-Review 记录

- **Spec 覆盖**:peek 纯读旁路(T1/T2)、IPC(T3)、状态机纯逻辑(T4)、审批/status 留 live 身份(T5 靠 deriveView 的 busy 门控 + 现有全局 modal 不动)、返回横幅+脉动(T5)、落定=真实 resume(T5 commitSwitchTo + resolveOnIdle)、作用域同项目(仅同项目侧栏列表,未碰项目切换)、新对话预览(T5)—— 全部有对应任务。
- **占位符扫描**:无 TBD/TODO;每个改码步骤含完整代码。
- **类型一致**:`Preview`、`selectAction`/`resolveOnIdle`/`deriveView` 的签名在 T4 定义、T5 消费一致;`runningSessionId` 在 Sidebar props/解构/renderRows 三处同名;`pv` 在 App 渲染统一命名(避开既有 `view` 面板态)。
