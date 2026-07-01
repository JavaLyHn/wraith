# Wraith 桌面端 Phase B（多会话 + 持久化 + 侧栏）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给桌面壳加会话持久化、会话列表、功能侧栏(列表/新建/切换=resume)、重启重连后自动 resume、`sandbox.unavailable` 提示;单活跃会话,大量复用现有 `SessionStore`。

**Architecture:** app-server 保持**单槽**(不引 `Map`、不做并行 agent)。"多会话"= 磁盘上多个 `SessionStore` 会话 + 侧栏列表 + resume 切换(把选中会话 `restoreHistory` 进唯一 Agent)。每轮 `turn.completed` 前 `persist`,并把**真实持久化 sessionId** 通过 `turn.completed` 回给前端作为活跃 id(解决 AppServer 占位 id 与 SessionStore 惰性 id 的错位)。

**Tech Stack:** Java 17(app-server + 现有 `session/` 持久化)· Electron 32 / React 18 / TS · Tailwind + shadcn(Phase A 已装)· vitest · @playwright/test · react-markdown。

关联 spec:`docs/specs/2026-07-01-desktop-phase-b-multi-conversation.md`。

## Global Constraints

- **单活跃会话**:AppServer 单槽,`session` 字段不变;**不引入** `Map<sessionId,...>`、不做每会话线程或并行多活跃 agent。
- **复用现有持久化,不重造**:`SessionStore`(`session/SessionStore.java`)、`SessionMessageCodec`、`SessionMeta`、`Agent.restoreHistory(List<Message>)`、`Agent.getConversationHistory()`。
- **精确 Java API**(逐字):
  - `SessionStore.open(Path home, String projectPath, String provider, String model)` → `SessionStore`;`startNew()`;`persist(List<LlmClient.Message>)`;`resume(String id)` → `List<LlmClient.Message>`(缺失回 `List.of()`);`list(int limit)` → `List<SessionMeta>`(updatedAt 倒序);`currentId` 私有、**惰性**(首个 `persist` 才分配,`SessionStore.java:89-90`)——本阶段新增 `currentId()` getter。
  - `SessionMeta(String id, String cwd, String createdAt, String updatedAt, String provider, String model, String title, int turns)`(record)。
  - `SessionMessageCodec.toJson(ObjectMapper, LlmClient.Message)` 产出字段:`role`,`content`,`reasoningContent?`,`toolCallId?`,`toolCalls?:[{id,name,arguments}]`(name/arguments 扁平,无 `function` 包裹)。
  - `LlmClient.Message(role, content, reasoningContent, toolCalls, toolCallId)`(5 参便捷构造);`LlmClient.ToolCall(String id, Function function)`,`Function(String name, String arguments)`。
  - `CommandSandbox.available()` 是 **static**(`policy/sandbox/CommandSandbox.java:32`);`client.getProviderName()` / `client.getModelName()` 存在。
- **协议**:新增 `session.list {}` → `{sessions: SessionMeta[]}`;`session.resume {sessionId}` → `{sessionId, messages: ResumedMessage[]}`;`session.start` 语义=新会话;`initialize` 的 `capabilities.sandbox` 诚实(`"macos-seatbelt"` / `"none"`);`turn.completed` 现携带**真实持久化 sessionId**(空对话时为占位 id)。
- **`ResumedMessage` 线格式** = `SessionMessageCodec.toJson` 输出:`{role:string, content:string|null, reasoningContent?:string, toolCallId?:string, toolCalls?:{id,name,arguments}[]}`。
- **`messagesToItems` 映射**:`user`→`{type:'user',text:content??''}`;`assistant`:`reasoningContent`→`{type:'thinking',label:'',text,done:true}`(在正文前)、`content`(非空)→`{type:'message',text}`、每个 `toolCalls`→`{type:'tool',card:{callId:id,name,argsJson:arguments,output:'',done:true,ok:true}}`;`tool`→按 `toolCallId` 找卡填 `output=content`;`system`→跳过。
- **前端**:`src/shared/` 纯 TS 零 UI 依赖;保留全部既有 `data-testid`;新增 `conversation-item`、`new-conversation`、`sandbox-badge`;新增 `user` Item 类型 + 提交时 echo user 气泡。
- **沙箱**:`state.sandbox ∈ {'macos-seatbelt','none','unknown'}`(存 `initialize.capabilities.sandbox` 原值,初 `'unknown'`);徽标 `'none'` 警示。
- **安全/构建不降级**:`contextIsolation:true`/`nodeIntegration:false`;preload 保持 CJS;Tailwind 仅 renderer;无 `rehype-raw`。
- **测试**:纯模块 vitest;Playwright 打 mock、auto-waiting、无 sleep、无像素断言;Java 测试**避 Mockito**,走 headless JSON-RPC harness / `@TempDir`(见 `SessionStoreTest`、`AppServerTest`)。
- **提交尾注**:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。分支 `feat/desktop-phase-b`。

---

## File Structure

**后端(Java)**
- Modify `session/SessionStore.java`:加 `public synchronized String currentId()`。
- Modify `runtime/appserver/AppServer.java`:`SessionRunner` 加 3 个 default 方法;`dispatch` 加 `session.list`/`session.resume`;`handleTurn` 落盘 + 回真实 id。
- Modify `cli/Main.java`:工厂接 `SessionStore` + 实现 3 方法;`buildInitializeResult` 加 `sandboxAvailable` 参数。
- Test `runtime/appserver/AppServerSessionTest.java`(新)、`cli/MainInitializeResultTest.java`(改:sandbox 分支)。

**前端(desktop/)**
- Modify `src/shared/types.ts`:`ResumedMessage`/`ResumedToolCall`/`SessionMeta`。
- Create `src/shared/messagesToItems.ts`(纯函数)。
- Modify `src/shared/transcriptReducer.ts`:`user` Item、`sessionId`/`sandbox` 字段、`loadHistory`/`setSessionId`/`setSandbox`/`addUserItem`、`turn.completed` 读 sessionId。
- Modify `src/preload/index.ts` + `src/main/index.ts`:`listSessions`/`resumeSession` IPC。
- Modify `src/renderer/components/Transcript.tsx`:渲染 `user` 气泡。
- Modify `src/renderer/components/Sidebar.tsx`:功能化(props:sessions/activeSessionId/onNew/onSelect/sandbox)。
- Modify `src/renderer/App.tsx`:会话列表 state、handlers、reconnect effect、sandbox 接线、submit echo。
- Modify `test/fixtures/mock-appserver.mjs`:`session.list`/`session.resume`;`turn.completed` 已带 sessionId。
- Modify `test/e2e/shell.e2e.ts` + `test/transcriptReducer.test.ts` + `test/messagesToItems.test.ts`(新)。

**依赖顺序**:1 后端路由 → 2 后端 Main 接线 → 3 shared(types+mapper+reducer)→ 4 IPC+mock → 5 user 气泡 → 6 功能侧栏 → 7 重连+沙箱徽标。

---

### Task 1: 后端 `session.list`/`session.resume` 路由 + 每轮落盘回真实 id

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/session/SessionStore.java`(加 `currentId()`)
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSessionTest.java`

**Interfaces:**
- Consumes: `SessionMeta`、`LlmClient.Message`、`SessionMessageCodec.toJson`、`JsonRpc.MAPPER`。
- Produces: `SessionRunner` 新增 `default List<SessionMeta> listSessions()`、`default List<LlmClient.Message> resume(String sessionId)`、`default String persistTurn()`;RPC `session.list`→`{sessions}`、`session.resume`→`{sessionId,messages}`;`turn.completed.sessionId` = persistTurn 返回值(非 null 时)。

- [ ] **Step 1: 写失败测试**

Create `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSessionTest.java`:

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.session.SessionMeta;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class AppServerSessionTest {

    private List<JsonNode> parseAll(String s) throws Exception {
        List<JsonNode> out = new ArrayList<>();
        for (String ln : s.split("\n")) if (!ln.isBlank()) out.add(JsonRpc.MAPPER.readTree(ln));
        return out;
    }

    /** Fake runner: canned list/resume, records persistTurn, returns a fixed persisted id. */
    private AppServer.SessionRunnerFactory factory(AtomicInteger persistCount) {
        return (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { r.appendAssistantContentDelta("ok"); r.finishAssistantContent(); return "ok"; }
                public List<SessionMeta> listSessions() {
                    return List.of(new SessionMeta("s1", "/p", "c", "u", "prov", "mod", "hello world", 3));
                }
                public List<LlmClient.Message> resume(String id) {
                    return List.of(
                        new LlmClient.Message("user", "hi", null, null, null),
                        new LlmClient.Message("assistant", "yo", null, null, null));
                }
                public String persistTurn() { persistCount.incrementAndGet(); return "persisted-9"; }
            };
        };
    }

    @Test
    void sessionListSerializesMetas() throws Exception {
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.list\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, factory(new AtomicInteger())).serve();
        JsonNode listResult = parseAll(out.toString(StandardCharsets.UTF_8)).stream()
            .filter(n -> n.path("id").asInt(-1) == 2 && n.has("result")).findFirst().orElseThrow();
        JsonNode sessions = listResult.get("result").get("sessions");
        assertTrue(sessions.isArray() && sessions.size() == 1);
        assertEquals("s1", sessions.get(0).get("id").asText());
        assertEquals("hello world", sessions.get(0).get("title").asText());
        assertEquals(3, sessions.get(0).get("turns").asInt());
    }

    @Test
    void sessionResumeSerializesMessages() throws Exception {
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.resume\",\"params\":{\"sessionId\":\"s1\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, factory(new AtomicInteger())).serve();
        JsonNode res = parseAll(out.toString(StandardCharsets.UTF_8)).stream()
            .filter(n -> n.path("id").asInt(-1) == 2 && n.has("result")).findFirst().orElseThrow().get("result");
        assertEquals("s1", res.get("sessionId").asText());
        JsonNode msgs = res.get("messages");
        assertEquals(2, msgs.size());
        assertEquals("user", msgs.get(0).get("role").asText());
        assertEquals("hi", msgs.get(0).get("content").asText());
    }

    @Test
    void turnPersistsAndReportsRealSessionId() throws Exception {
        AtomicInteger persist = new AtomicInteger();
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"turn.submit\",\"params\":{\"input\":\"hi\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, factory(persist)).serve();
        long deadline = System.currentTimeMillis() + 2000;
        while (System.currentTimeMillis() < deadline && !out.toString(StandardCharsets.UTF_8).contains("turn.completed")) Thread.sleep(20);
        assertEquals(1, persist.get(), "persistTurn should be called once after the turn");
        JsonNode completed = parseAll(out.toString(StandardCharsets.UTF_8)).stream()
            .filter(n -> "turn.completed".equals(n.path("method").asText(null))).findFirst().orElseThrow();
        assertEquals("persisted-9", completed.get("params").get("sessionId").asText(),
            "turn.completed should carry the real persisted sessionId");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=AppServerSessionTest`
Expected: 编译失败 —— `SessionRunner` 无 `listSessions/resume/persistTurn`,dispatch 无 `session.list`/`session.resume`,turn.completed 未带真实 id。

- [ ] **Step 3: `SessionStore` 加 `currentId()` getter**

在 `SessionStore.java` 的 `resume(...)` 方法之后加:

```java
    /** 当前正在写入的会话 ID(首个 persist 前为 null)。 */
    public synchronized String currentId() {
        return currentId;
    }
```

- [ ] **Step 4: `SessionRunner` 加 3 个 default 方法**

在 `AppServer.java` 的 `SessionRunner` 接口里(`setApprovalMode` default 之后)加:

```java
        /** 本项目历史会话(最近在前)。默认空。 */
        default java.util.List<com.lyhn.wraith.session.SessionMeta> listSessions() {
            return java.util.List.of();
        }
        /** 续接会话:恢复历史进 Agent,返回该会话消息(供 UI 回放)。默认空。 */
        default java.util.List<com.lyhn.wraith.llm.LlmClient.Message> resume(String sessionId) {
            return java.util.List.of();
        }
        /** 落盘当前对话,返回持久化后的真实 sessionId(空对话可能为 null)。默认 no-op。 */
        default String persistTurn() { return null; }
```

- [ ] **Step 5: dispatch + handlers + handleTurn 落盘**

在 `AppServer.dispatch` 的 switch 里,`session.setApprovalMode` 之后加两行:

```java
            case "session.list" -> handleSessionList(msg);
            case "session.resume" -> handleSessionResume(msg);
```

在 `handleSetApprovalMode` 之后新增两个 handler:

```java
    private void handleSessionList(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        writer.result(msg.id(), Map.of("sessions", session.listSessions()));
    }

    private void handleSessionResume(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String id = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (id.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        java.util.List<com.lyhn.wraith.llm.LlmClient.Message> msgs = session.resume(id);
        java.util.List<com.fasterxml.jackson.databind.node.ObjectNode> wire = new java.util.ArrayList<>();
        for (com.lyhn.wraith.llm.LlmClient.Message m : msgs) {
            wire.add(com.lyhn.wraith.session.SessionMessageCodec.toJson(JsonRpc.MAPPER, m));
        }
        sessionId = id; // 活跃会话切到 resume 的
        writer.result(msg.id(), Map.of("sessionId", id, "messages", wire));
    }
```

在 `handleTurn` 的 worker 线程里,`session.runTurn(input)` 成功后、发 `turn.completed` 前落盘并用真实 id:

```java
        Thread t = new Thread(() -> {
            try {
                session.runTurn(input);
                String persisted = session.persistTurn();
                String reported = (persisted != null) ? persisted : sessionId;
                if (persisted != null) sessionId = persisted;
                writer.notify("turn.completed", Map.of("sessionId", reported, "turnId", turnId, "status", "completed"));
            } catch (Exception e) {
                writer.notify("turn.failed", Map.of("sessionId", sessionId, "turnId", turnId, "error", e.toString()));
            }
        }, "wraith-appserver-turn");
```

- [ ] **Step 6: 跑测试确认通过 + 回归**

Run: `mvn test -DskipTests=false -Dtest=AppServerSessionTest,AppServerTest,AppServerSetApprovalModeTest`
Expected: 新 3 测试 + 既有 app-server 测试全绿(default 方法不破坏旧匿名 runner)。

- [ ] **Step 7: 提交**

```bash
git add src/main/java/com/lyhn/wraith/session/SessionStore.java \
        src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSessionTest.java
git commit -m "feat(app-server): session.list/session.resume 路由 + 每轮落盘回真实 sessionId

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Main.java 接 SessionStore + `initialize` 沙箱诚实

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(`startAppServer` 工厂 + `buildInitializeResult`)
- Test: `src/test/java/com/lyhn/wraith/cli/MainInitializeResultTest.java`

**Interfaces:**
- Consumes: Task 1 的 `SessionRunner` 三方法;`SessionStore.open/startNew/persist/resume/list/currentId`;`Agent.restoreHistory/getConversationHistory`;`CommandSandbox.available()`(static)。
- Produces: `buildInitializeResult(String model, boolean sandboxAvailable)` → `capabilities.sandbox` = `"macos-seatbelt"`/`"none"`;工厂返回的 `SessionRunner` 实现 `listSessions/resume/persistTurn`。

- [ ] **Step 1: 改/写失败测试(sandbox 分支)**

替换 `src/test/java/com/lyhn/wraith/cli/MainInitializeResultTest.java` 里对 `buildInitializeResult` 的调用为双参并加分支断言(若文件不存在则新建):

```java
package com.lyhn.wraith.cli;

import org.junit.jupiter.api.Test;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class MainInitializeResultTest {
    @Test
    void sandboxAvailableReportsSeatbelt() {
        Map<String, Object> res = Main.buildInitializeResult("deepseek", true);
        @SuppressWarnings("unchecked")
        Map<String, Object> caps = (Map<String, Object>) res.get("capabilities");
        assertEquals("macos-seatbelt", caps.get("sandbox"));
        assertEquals("deepseek", res.get("model"));
    }

    @Test
    void sandboxUnavailableReportsNone() {
        Map<String, Object> res = Main.buildInitializeResult("m", false);
        @SuppressWarnings("unchecked")
        Map<String, Object> caps = (Map<String, Object>) res.get("capabilities");
        assertEquals("none", caps.get("sandbox"));
    }
}
```

- [ ] **Step 2: 跑确认失败**

Run: `mvn test -DskipTests=false -Dtest=MainInitializeResultTest`
Expected: 编译失败 —— `buildInitializeResult` 目前是单参 `(String model)`。

- [ ] **Step 3: `buildInitializeResult` 加 `sandboxAvailable` 参数**

`Main.java` 的 `buildInitializeResult` 改签名与那一行:

```java
    static java.util.Map<String, Object> buildInitializeResult(String model, boolean sandboxAvailable) {
        java.util.Map<String, Object> caps = new java.util.LinkedHashMap<>();
        caps.put("streaming", true);
        caps.put("approvals", true);
        caps.put("toolOutputStreaming", true);
        caps.put("diff", true);
        caps.put("sandbox", sandboxAvailable ? "macos-seatbelt" : "none");
        java.util.Map<String, Object> res = new java.util.LinkedHashMap<>();
        res.put("serverInfo", "wraith-app-server");
        res.put("protocol", "1");
        res.put("model", model == null ? "" : model);
        res.put("capabilities", caps);
        return res;
    }
```

- [ ] **Step 4: 工厂调用处传 sandbox 可用性**

`startAppServer` 里 `new AppServer(..., buildInitializeResult(client.getModelName()))` 改为:

```java
    }, buildInitializeResult(client.getModelName(), com.lyhn.wraith.policy.sandbox.CommandSandbox.available()));
```

- [ ] **Step 5: 工厂接 SessionStore + 实现 3 方法**

在工厂 lambda 里,`agent.setRenderer(renderer);` 之后、`RendererHitlHandler` 之前,构造 SessionStore:

```java
                com.lyhn.wraith.session.SessionStore sessionStore =
                        com.lyhn.wraith.session.SessionStore.open(
                                java.nio.file.Path.of(System.getProperty("user.home")),
                                root, client.getProviderName(), client.getModelName());
                sessionStore.startNew();
```

把返回的匿名 `SessionRunner` 扩成:

```java
                return new com.lyhn.wraith.runtime.appserver.AppServer.SessionRunner() {
                    public com.lyhn.wraith.runtime.appserver.EventStreamRenderer renderer() { return renderer; }
                    public String runTurn(String input) { return agent.run(input); }
                    public void setApprovalMode(boolean auto) { hitl.setEnabled(!auto); }
                    public java.util.List<com.lyhn.wraith.session.SessionMeta> listSessions() {
                        return sessionStore.list(50);
                    }
                    public java.util.List<com.lyhn.wraith.llm.LlmClient.Message> resume(String id) {
                        java.util.List<com.lyhn.wraith.llm.LlmClient.Message> msgs = sessionStore.resume(id);
                        agent.restoreHistory(msgs);
                        return msgs;
                    }
                    public String persistTurn() {
                        sessionStore.persist(agent.getConversationHistory());
                        return sessionStore.currentId();
                    }
                };
```

- [ ] **Step 6: 跑测试 + 构建**

Run: `mvn test -DskipTests=false -Dtest=MainInitializeResultTest,MainAppServerCommandTest,MainAppServerSandboxTest && mvn -q -DskipTests compile`
Expected: 测试绿;`compile` 成功(SessionStore 接线编译通过)。SessionStore 端到端由 `SessionStoreTest`(已存)+ Task 1 路由 + 收尾控制器眼验覆盖。

- [ ] **Step 7: 提交**

```bash
git add src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/cli/MainInitializeResultTest.java
git commit -m "feat(app-server): Main 接 SessionStore(list/resume/persist) + initialize 沙箱诚实

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: shared — 类型 + `messagesToItems` + reducer 扩展

**Files:**
- Modify: `desktop/src/shared/types.ts`
- Create: `desktop/src/shared/messagesToItems.ts`
- Modify: `desktop/src/shared/transcriptReducer.ts`
- Test: `desktop/test/messagesToItems.test.ts`(新)、`desktop/test/transcriptReducer.test.ts`

**Interfaces:**
- Produces: `SessionMeta`/`ResumedMessage`/`ResumedToolCall` 类型;`messagesToItems(msgs): Item[]`;`Item` 加 `{type:'user';text}`;`TranscriptState` 加 `sessionId:string`、`sandbox:'macos-seatbelt'|'none'|'unknown'`;helper `loadHistory(state, items)`、`setSessionId(state, id)`、`setSandbox(state, s)`、`addUserItem(state, text)`;`turn.completed` 读 `params.sessionId`。

- [ ] **Step 1: 写失败测试(messagesToItems)**

Create `desktop/test/messagesToItems.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { messagesToItems } from '../src/shared/messagesToItems'
import type { ResumedMessage } from '../src/shared/types'

describe('messagesToItems', () => {
  it('maps user → user item', () => {
    const items = messagesToItems([{ role: 'user', content: 'hi' }])
    expect(items).toEqual([{ type: 'user', text: 'hi' }])
  })

  it('assistant reasoning precedes content', () => {
    const items = messagesToItems([{ role: 'assistant', content: 'answer', reasoningContent: 'thinking' }])
    expect(items[0]).toEqual({ type: 'thinking', label: '', text: 'thinking', done: true })
    expect(items[1]).toEqual({ type: 'message', text: 'answer' })
  })

  it('assistant toolCalls → tool cards, tool message fills output by callId', () => {
    const msgs: ResumedMessage[] = [
      { role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'run', arguments: '{"cmd":"ls"}' }] },
      { role: 'tool', content: 'file.txt', toolCallId: 'c1' },
    ]
    const items = messagesToItems(msgs)
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({
      type: 'tool',
      card: { callId: 'c1', name: 'run', argsJson: '{"cmd":"ls"}', output: 'file.txt', done: true, ok: true },
    })
  })

  it('empty → []', () => {
    expect(messagesToItems([])).toEqual([])
  })

  it('skips system', () => {
    expect(messagesToItems([{ role: 'system', content: 'x' }])).toEqual([])
  })
})
```

- [ ] **Step 2: 跑确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/messagesToItems.test.ts`
Expected: FAIL —— 模块/函数不存在。

- [ ] **Step 3: types.ts 加类型**

在 `desktop/src/shared/types.ts` 末尾加:

```ts
// ---------------------------------------------------------------------------
// Phase B: session persistence / resume wire types
// ---------------------------------------------------------------------------

/** One session's metadata (mirrors Java SessionMeta record). */
export interface SessionMeta {
  id: string
  cwd: string
  createdAt: string
  updatedAt: string
  provider: string
  model: string
  title: string
  turns: number
}

/** A tool call inside a resumed assistant message (mirrors SessionMessageCodec). */
export interface ResumedToolCall {
  id: string
  name: string
  arguments: string
}

/** A stored message returned by session.resume (SessionMessageCodec.toJson shape). */
export interface ResumedMessage {
  role: string
  content: string | null
  reasoningContent?: string
  toolCallId?: string
  toolCalls?: ResumedToolCall[]
}
```

- [ ] **Step 4: 加 `user` Item 类型(reducer)**

`desktop/src/shared/transcriptReducer.ts` 的 `Item` 联合加一行:

```ts
export type Item =
  | { type: 'user'; text: string }
  | { type: 'message'; text: string }
  | { type: 'thinking'; label: string; text: string; done: boolean }
  | { type: 'tool'; card: ToolCard }
```

- [ ] **Step 5: 写 messagesToItems.ts**

Create `desktop/src/shared/messagesToItems.ts`:

```ts
import type { Item, ToolCard } from './transcriptReducer'
import type { ResumedMessage } from './types'

/**
 * Rebuild a static transcript (Item[]) from stored session messages.
 * user → user bubble; assistant reasoning → thinking (before content);
 * assistant content → message; assistant toolCalls → tool cards; tool → fills
 * the matching card's output by toolCallId. system messages are skipped.
 */
export function messagesToItems(msgs: ResumedMessage[]): Item[] {
  const items: Item[] = []
  const cardIndexByCallId = new Map<string, number>()

  for (const m of msgs) {
    if (m.role === 'user') {
      items.push({ type: 'user', text: m.content ?? '' })
    } else if (m.role === 'assistant') {
      if (m.reasoningContent) {
        items.push({ type: 'thinking', label: '', text: m.reasoningContent, done: true })
      }
      if (m.content) {
        items.push({ type: 'message', text: m.content })
      }
      for (const tc of m.toolCalls ?? []) {
        const card: ToolCard = {
          callId: tc.id,
          name: tc.name,
          argsJson: tc.arguments,
          output: '',
          done: true,
          ok: true,
        }
        cardIndexByCallId.set(tc.id, items.length)
        items.push({ type: 'tool', card })
      }
    } else if (m.role === 'tool') {
      const idx = m.toolCallId != null ? cardIndexByCallId.get(m.toolCallId) : undefined
      if (idx != null) {
        const item = items[idx]
        if (item.type === 'tool') {
          items[idx] = { type: 'tool', card: { ...item.card, output: m.content ?? '', done: true } }
        }
      }
    }
    // system → skip
  }
  return items
}
```

- [ ] **Step 6: reducer 加字段 + helper + turn.completed 读 sessionId**

`TranscriptState`(在 `workspace` 之后、`_messageOpen` 之前)加:

```ts
  workspace: string
  /** 当前活跃会话 id(turn.completed / resume 更新)。 */
  sessionId: string
  /** 沙箱状态(来自 initialize.capabilities.sandbox)。 */
  sandbox: 'macos-seatbelt' | 'none' | 'unknown'
  _messageOpen: boolean
```

`initialState` 加 `sessionId: '',` 与 `sandbox: 'unknown',`(在 `workspace: ''` 之后)。

`turn.completed`/`turn.failed` 分支改为(completed 额外读 sessionId):

```ts
    case 'turn.completed': {
      const sid = typeof p['sessionId'] === 'string' ? p['sessionId'] : ''
      return { ...state, turn: 'idle', ...(sid ? { sessionId: sid } : {}) }
    }
    case 'turn.failed':
      return { ...state, turn: 'idle' }
```

在文件末尾(`resetSession` 之后)加 helper:

```ts
/** 用回放的 items 整体替换 transcript(切换/resume 时)。 */
export function loadHistory(state: TranscriptState, items: Item[]): TranscriptState {
  return { ...state, items, _messageOpen: false }
}

/** 设置活跃会话 id。 */
export function setSessionId(state: TranscriptState, sessionId: string): TranscriptState {
  return { ...state, sessionId }
}

/** 设置沙箱状态。 */
export function setSandbox(state: TranscriptState, sandbox: 'macos-seatbelt' | 'none' | 'unknown'): TranscriptState {
  return { ...state, sandbox }
}

/** 提交时 echo 一条 user 气泡(封口当前 message)。 */
export function addUserItem(state: TranscriptState, text: string): TranscriptState {
  return { ...state, items: [...state.items, { type: 'user', text }], _messageOpen: false }
}
```

`resetSession` 也重置 `sessionId`(在其返回对象里加 `sessionId: ''`)。

- [ ] **Step 7: 写 reducer 新测试**

在 `desktop/test/transcriptReducer.test.ts` import 追加 `loadHistory, setSessionId, setSandbox, addUserItem`,并加:

```ts
describe('phase-B state additions', () => {
  it('initial has sessionId="" and sandbox="unknown"', () => {
    expect(initialState.sessionId).toBe('')
    expect(initialState.sandbox).toBe('unknown')
  })
  it('loadHistory replaces items immutably', () => {
    const s = loadHistory(initialState, [{ type: 'user', text: 'x' }])
    expect(s.items).toEqual([{ type: 'user', text: 'x' }])
    expect(s._messageOpen).toBe(false)
    expect(initialState.items).toEqual([])
  })
  it('setSessionId / setSandbox', () => {
    expect(setSessionId(initialState, 'abc').sessionId).toBe('abc')
    expect(setSandbox(initialState, 'none').sandbox).toBe('none')
  })
  it('addUserItem appends a user item', () => {
    const s = addUserItem(initialState, 'hello')
    expect(s.items[s.items.length - 1]).toEqual({ type: 'user', text: 'hello' })
  })
  it('turn.completed with sessionId updates sessionId', () => {
    const s = reduce(initialState, { kind: 'notification', method: 'turn.completed', params: { sessionId: 'sess-real' } })
    expect(s.turn).toBe('idle')
    expect(s.sessionId).toBe('sess-real')
  })
})
```

- [ ] **Step 8: 跑全绿 + typecheck**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/messagesToItems.test.ts test/transcriptReducer.test.ts && npm run typecheck`
Expected: 全通过;typecheck 0。

- [ ] **Step 9: 提交**

```bash
git add desktop/src/shared/types.ts desktop/src/shared/messagesToItems.ts \
        desktop/src/shared/transcriptReducer.ts desktop/test/messagesToItems.test.ts \
        desktop/test/transcriptReducer.test.ts
git commit -m "feat(desktop): 会话回放类型 + messagesToItems + reducer(user/loadHistory/sessionId/sandbox)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: IPC(listSessions/resumeSession)+ mock 后端

**Files:**
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/test/fixtures/mock-appserver.mjs`

**Interfaces:**
- Consumes: Task 3 的 `SessionMeta`/`ResumedMessage`。
- Produces: `window.wraith.listSessions(): Promise<{sessions: SessionMeta[]}>`、`window.wraith.resumeSession(id): Promise<{sessionId, messages: ResumedMessage[]}>`;mock 支持 `session.list`/`session.resume`。

- [ ] **Step 1: preload 暴露两方法**

`desktop/src/preload/index.ts`:`WraithApi` 接口在 `restartBackend` 之后加(并 import 类型):

```ts
import type { BackendEvent, SessionMeta, ResumedMessage } from '../shared/types'
```
```ts
  restartBackend(): Promise<void>
  setApprovalMode(auto: boolean): Promise<{ ok: boolean }>
  listSessions(): Promise<{ sessions: SessionMeta[] }>
  resumeSession(sessionId: string): Promise<{ sessionId: string; messages: ResumedMessage[] }>
  onEvent(cb: (evt: BackendEvent) => void): () => void
```
`const wraith` 实现里 `setApprovalMode` 之后加:

```ts
  listSessions() {
    return ipcRenderer.invoke('wraith:listSessions') as Promise<{ sessions: SessionMeta[] }>
  },

  resumeSession(sessionId) {
    return ipcRenderer.invoke('wraith:resumeSession', sessionId) as Promise<{
      sessionId: string
      messages: ResumedMessage[]
    }>
  },
```

- [ ] **Step 2: main 加两个 IPC handler**

`desktop/src/main/index.ts`,`wraith:setApprovalMode` handler 之后加:

```ts
ipcMain.handle('wraith:listSessions', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.list', {})
})

ipcMain.handle('wraith:resumeSession', async (_e, sessionId: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.resume', { sessionId })
})
```

- [ ] **Step 3: mock 支持 session.list / session.resume**

`desktop/test/fixtures/mock-appserver.mjs`,`turn.interrupt` case 之后加:

```js
    case 'session.list': {
      reply(id, {
        sessions: [
          { id: 'sess_a', cwd: '/p', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T01:00:00Z', provider: 'mock', model: 'mock-model', title: '第一段对话', turns: 2 },
          { id: 'sess_b', cwd: '/p', createdAt: '2026-06-30T00:00:00Z', updatedAt: '2026-06-30T01:00:00Z', provider: 'mock', model: 'mock-model', title: '早先的对话', turns: 5 }
        ]
      })
      break
    }

    case 'session.resume': {
      const rid = (params && params.sessionId) || 'sess_a'
      reply(id, {
        sessionId: rid,
        messages: [
          { role: 'user', content: '之前问的问题' },
          { role: 'assistant', content: '之前的**回答**', reasoningContent: '之前的思考' }
        ]
      })
      break
    }
```

- [ ] **Step 4: typecheck + build + 既有 E2E 回归**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run build && npx playwright test`
Expected: typecheck 0;build 成功;既有 6 个 E2E 仍绿(未用新 IPC,mock 新增 case 不影响旧路径)。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/preload/index.ts desktop/src/main/index.ts desktop/test/fixtures/mock-appserver.mjs
git commit -m "feat(desktop): listSessions/resumeSession IPC + mock session.list/resume

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 对话视图加 user 气泡(Transcript + 提交 echo)

**Files:**
- Modify: `desktop/src/renderer/components/Transcript.tsx`
- Modify: `desktop/src/renderer/App.tsx`
- Test: `desktop/test/e2e/shell.e2e.ts`

**Interfaces:**
- Consumes: Task 3 的 `user` Item + `addUserItem`。
- Produces: Transcript 渲染 `user` 气泡(`data-testid="user-msg"`);`handleSubmit` 提交时 `dispatch(addUserItem)`。

- [ ] **Step 1: 写失败 E2E**

在 `desktop/test/e2e/shell.e2e.ts` 末尾加:

```ts
test('submitting echoes the user message as a bubble', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1' }
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })
  await input.fill('我的问题')
  await input.press('Enter')
  await expect(win.locator('[data-testid="user-msg"]')).toHaveText('我的问题', { timeout: 10000 })
  await app.close()
})
```

- [ ] **Step 2: 跑确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run build && npx playwright test -g "echoes the user message"`
Expected: FAIL —— 无 `user-msg`。

- [ ] **Step 3: Transcript 渲染 user 气泡**

`desktop/src/renderer/components/Transcript.tsx`,在 `items.map` 里 `if (item.type === 'message')` 之前加:

```tsx
        if (item.type === 'user') {
          return (
            <div
              key={idx}
              data-testid="user-msg"
              className="self-end max-w-[85%] rounded-2xl bg-accent/10 px-3 py-2 text-sm text-fg"
            >
              {item.text}
            </div>
          )
        }
```

- [ ] **Step 4: 提交时 echo user item**

`desktop/src/renderer/App.tsx`,import 追加 `addUserItem`? 不——App 用 dispatch + LocalAction。给 `LocalAction` 加 `| { type: 'addUserItem'; text: string }`,`reduceAdapter` 加分支 `if ('type' in action && action.type === 'addUserItem') return addUserItem(state, action.text)`(import `addUserItem`),`handleSubmit` 改:

```tsx
  const handleSubmit = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || state.turn === 'running') return
    setInputValue('')
    dispatch({ type: 'markStarted' })
    dispatch({ type: 'addUserItem', text })
    try {
      await window.wraith.submitTurn(text)
    } catch (err) {
      console.error('[wraith] submitTurn error:', err)
    }
  }, [inputValue, state.turn])
```

(在 `App.tsx` 顶部 import 里补 `addUserItem`;`LocalAction`/`reduceAdapter` 同 Phase A 既有模式加一条分支。)

- [ ] **Step 5: 跑 E2E 确认通过 + 既有回归**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run build && npx playwright test`
Expected: 新测试绿;既有 6 个仍绿(happy-path 断 `strong`/`thinking`/`tool-card`,多一个 user 气泡不影响)。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/components/Transcript.tsx desktop/src/renderer/App.tsx desktop/test/e2e/shell.e2e.ts
git commit -m "feat(desktop): 对话视图加 user 气泡(提交回显 + 回放一致)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 功能侧栏(会话列表 / 新建 / 切换=resume)

**Files:**
- Modify: `desktop/src/renderer/components/Sidebar.tsx`
- Modify: `desktop/src/renderer/App.tsx`
- Test: `desktop/test/e2e/shell.e2e.ts`

**Interfaces:**
- Consumes: Task 3 的 `messagesToItems`/`loadHistory`/`setSessionId`;Task 4 的 `window.wraith.listSessions`/`resumeSession`;`SessionMeta`。
- Produces: `Sidebar` 变 presentational(props:`workspace, sessions: SessionMeta[], activeSessionId, onNewConversation, onSelectSession`);App 拥有 `sessions` state + `fetchSessions`/`handleNewConversation`/`handleSelectSession`;新增 testid `new-conversation`、`conversation-item`。

- [ ] **Step 1: 写失败 E2E**

追加:

```ts
test('sidebar lists sessions; new clears; selecting resumes history', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1' }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })

  // list rendered from session.list
  await expect(win.locator('[data-testid="conversation-item"]')).toHaveCount(2, { timeout: 10000 })
  await expect(win.locator('[data-testid="conversation-item"]').first()).toContainText('第一段对话')

  // selecting resumes → static history (user bubble + assistant answer) shows
  await win.locator('[data-testid="conversation-item"]').first().click()
  await expect(win.locator('[data-testid="user-msg"]')).toContainText('之前问的问题', { timeout: 10000 })
  await expect(win.locator('[data-testid="transcript"] strong')).toHaveText('回答', { timeout: 10000 })

  // new conversation clears transcript back to welcome
  await win.locator('[data-testid="new-conversation"]').click()
  await expect(win.locator('text=今天做点什么？')).toBeVisible({ timeout: 10000 })

  await app.close()
})
```

- [ ] **Step 2: 跑确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run build && npx playwright test -g "sidebar lists sessions"`
Expected: FAIL —— 无 `conversation-item`/`new-conversation`(侧栏仍静态)。

- [ ] **Step 3: Sidebar 改 presentational**

整替换 `desktop/src/renderer/components/Sidebar.tsx`:

```tsx
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './ui/tooltip'
import { baseName } from '../lib/paths'
import type { SessionMeta } from '../../shared/types'

interface SidebarProps {
  workspace: string
  sessions: SessionMeta[]
  activeSessionId: string
  onNewConversation: () => void
  onSelectSession: (id: string) => void
}

const NAV: { key: string; label: string; hint: string }[] = [
  { key: 'search', label: '搜索', hint: '搜索在后续阶段' },
  { key: 'plugins', label: '插件', hint: '插件在 Phase D' },
  { key: 'automation', label: '自动化', hint: '自动化在 Phase D' },
  { key: 'projects', label: '项目', hint: '多项目在 Phase C' },
]

export default function Sidebar({
  workspace,
  sessions,
  activeSessionId,
  onNewConversation,
  onSelectSession,
}: SidebarProps): JSX.Element {
  return (
    <TooltipProvider delayDuration={200}>
      <aside
        data-testid="sidebar"
        className="sidebar-gradient flex h-full w-60 flex-col border-r border-border"
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="text-accent">✦</span>
          <span className="text-sm font-bold tracking-wide text-fg">WRAITH</span>
        </div>

        {/* new conversation — functional */}
        <div className="px-3">
          <button
            data-testid="new-conversation"
            onClick={onNewConversation}
            className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-left text-xs text-fg hover:border-accent hover:text-accent"
          >
            ＋ 新对话
          </button>
        </div>

        {/* nav — disabled placeholders */}
        <nav className="mt-3 flex flex-col gap-0.5 px-3">
          {NAV.map(n => (
            <Tooltip key={n.key}>
              <TooltipTrigger asChild>
                <button
                  data-testid={`nav-${n.key}`}
                  disabled
                  className="rounded-lg px-3 py-1.5 text-left text-xs text-fg-muted opacity-60"
                >
                  {n.label}
                </button>
              </TooltipTrigger>
              <TooltipContent>{n.hint}</TooltipContent>
            </Tooltip>
          ))}
        </nav>

        {/* conversations — from session.list */}
        <div className="mt-4 px-3 text-[10px] uppercase tracking-wider text-fg-subtle">对话</div>
        <div className="flex-1 overflow-y-auto px-3">
          {sessions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-fg-subtle">还没有历史会话</div>
          ) : (
            sessions.map(s => (
              <button
                key={s.id}
                data-testid="conversation-item"
                onClick={() => onSelectSession(s.id)}
                className={
                  'mb-0.5 block w-full truncate rounded-lg px-3 py-2 text-left text-xs ' +
                  (s.id === activeSessionId ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')
                }
                title={s.title}
              >
                {s.title || '(未命名)'}
              </button>
            ))
          )}
        </div>

        {/* footer: workspace */}
        <div className="border-t border-border px-3 py-3">
          <div className="truncate text-[11px] text-fg-subtle" title={workspace || '默认工作目录'}>
            📁 {baseName(workspace)}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
```

> 说明:删掉旧的静态"当前会话"条目、`nav-new`/`nav-settings` 占位(新建已功能化;设置留后续)。既有 testid 中仅 `sidebar`、`nav-plugins` 等导航保留;`nav-new`/`nav-settings` 移除(Phase A E2E 只断 `sidebar` 可见 + `nav-plugins` disabled——仍成立)。

- [ ] **Step 4: App 拥有列表 state + handlers + 传参**

`desktop/src/renderer/App.tsx`:
1. import 追加 `import { messagesToItems } from '../shared/messagesToItems'` 与 `loadHistory, setSessionId` (helper);import `SessionMeta`/`ResumedMessage` 类型。
2. `LocalAction` 加 `| { type: 'loadHistory'; items: Item[] }`(import `Item` 类型)与 `| { type: 'setSessionId'; sessionId: string }`;`reduceAdapter` 加对应两分支。
3. 加 `const [sessions, setSessions] = useState<SessionMeta[]>([])`。
4. 加:

```tsx
  const fetchSessions = useCallback(async () => {
    try {
      const { sessions } = await window.wraith.listSessions()
      setSessions(sessions)
    } catch (err) {
      console.error('[wraith] listSessions error:', err)
    }
  }, [])

  const handleNewConversation = useCallback(async () => {
    if (state.turn === 'running') return
    try {
      await window.wraith.startSession(state.workspace || null)
      dispatch({ type: 'resetSession', ws: state.workspace })
      void fetchSessions()
    } catch (err) {
      console.error('[wraith] newConversation error:', err)
    }
  }, [state.turn, state.workspace, fetchSessions])

  const handleSelectSession = useCallback(async (id: string) => {
    if (state.turn === 'running') return
    try {
      const { sessionId, messages } = await window.wraith.resumeSession(id)
      dispatch({ type: 'loadHistory', items: messagesToItems(messages) })
      dispatch({ type: 'setSessionId', sessionId })
      dispatch({ type: 'markStarted' })
    } catch (err) {
      console.error('[wraith] resumeSession error:', err)
    }
  }, [state.turn])
```

5. 启动 effect 末尾(`startSession` 之后)加 `void fetchSessions()`。
6. 加一个 effect:turn 由 running→idle 后刷新列表(标题/时间会变):

```tsx
  const prevTurnRef = useRef(state.turn)
  useEffect(() => {
    if (prevTurnRef.current === 'running' && state.turn === 'idle') {
      void fetchSessions()
    }
    prevTurnRef.current = state.turn
  }, [state.turn, fetchSessions])
```

7. `<Sidebar>` 传参:

```tsx
      <Sidebar
        workspace={state.workspace}
        sessions={sessions}
        activeSessionId={state.sessionId}
        onNewConversation={handleNewConversation}
        onSelectSession={handleSelectSession}
      />
```

- [ ] **Step 5: 跑 E2E + typecheck + build**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run build && npx playwright test`
Expected: 新侧栏测试绿(列表 2 条、选中回放 user+助手、新建回欢迎);既有全绿(Phase A 侧栏测试仍成立:`sidebar` 可见、`nav-plugins` disabled)。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/components/Sidebar.tsx desktop/src/renderer/App.tsx desktop/test/e2e/shell.e2e.ts
git commit -m "feat(desktop): 功能侧栏(会话列表/新建/切换=resume)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 重连自动 resume + 沙箱徽标

**Files:**
- Modify: `desktop/src/renderer/App.tsx`
- Modify: `desktop/src/renderer/components/Sidebar.tsx`
- Test: `desktop/test/e2e/shell.e2e.ts`

**Interfaces:**
- Consumes: Task 3 `setSandbox`;`state.sandbox`/`state.sessionId`;Task 4 `resumeSession`。
- Produces: 重连 effect(disconnected→connected 自动 `initialize`+`startSession`+`resumeSession(active)`);Sidebar 加 `sandbox` prop + `data-testid="sandbox-badge"`;App 从 `initialize` 设 sandbox。

- [ ] **Step 1: 写失败 E2E(沙箱徽标 + 重连恢复)**

追加:

```ts
test('sandbox badge shows unavailable when capabilities.sandbox=none', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1', MOCK_SANDBOX: 'none' }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="sandbox-badge"]')).toContainText('未启用', { timeout: 15000 })
  await app.close()
})
```

并在 mock 的 `initialize` 里让 `capabilities.sandbox` 受 `MOCK_SANDBOX` 控制(Step 3 会改 mock)。

- [ ] **Step 2: 跑确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run build && npx playwright test -g "sandbox badge"`
Expected: FAIL —— 无 `sandbox-badge`。

- [ ] **Step 3: mock initialize 带 sandbox**

`desktop/test/fixtures/mock-appserver.mjs` 的 `initialize` case 的 `capabilities` 改为:

```js
        capabilities: { toolOutputStreaming: true, sandbox: process.env['MOCK_SANDBOX'] || 'macos-seatbelt' }
```

- [ ] **Step 4: Sidebar 加沙箱徽标**

`Sidebar.tsx`:`SidebarProps` 加 `sandbox: 'macos-seatbelt' | 'none' | 'unknown'`;footer 里 workspace 那行下面加:

```tsx
          <div
            data-testid="sandbox-badge"
            className={
              'mt-2 truncate text-[11px] ' +
              (sandbox === 'none' ? 'text-danger' : 'text-fg-subtle')
            }
            title={sandbox === 'none' ? '命令未在沙箱内执行' : '命令在 Seatbelt 沙箱内执行'}
          >
            {sandbox === 'none' ? '⚠ 沙箱未启用' : sandbox === 'macos-seatbelt' ? '🛡 沙箱: Seatbelt' : '沙箱: —'}
          </div>
```

(函数签名解构加 `sandbox`。)

- [ ] **Step 5: App 设 sandbox + 传参 + 重连 effect**

`App.tsx`:
1. `LocalAction` 加 `| { type: 'setSandbox'; sandbox: 'macos-seatbelt' | 'none' | 'unknown' }`;`reduceAdapter` 加分支(import `setSandbox`)。
2. 启动 effect 里读 sandbox:`const init = await window.wraith.initialize(ws)` 之后:

```tsx
        const initObj = init as { model?: string; capabilities?: { sandbox?: string } }
        if (initObj.model) dispatch({ type: 'setModel', model: initObj.model })
        const sb = initObj.capabilities?.sandbox
        dispatch({ type: 'setSandbox', sandbox: sb === 'none' ? 'none' : sb === 'macos-seatbelt' ? 'macos-seatbelt' : 'unknown' })
```

3. 新增重连 effect(区别于 once-guard 启动 effect):

```tsx
  const reconnectRef = useRef(false)
  useEffect(() => {
    if (state.connection === 'disconnected') {
      reconnectRef.current = true
      return
    }
    // connected
    if (!reconnectRef.current) return // 首次连接由启动 effect 处理
    reconnectRef.current = false
    const activeId = state.sessionId
    void (async () => {
      try {
        const ws = state.workspace || null
        const init = await window.wraith.initialize(ws)
        const sb = (init as { capabilities?: { sandbox?: string } }).capabilities?.sandbox
        dispatch({ type: 'setSandbox', sandbox: sb === 'none' ? 'none' : sb === 'macos-seatbelt' ? 'macos-seatbelt' : 'unknown' })
        await window.wraith.startSession(ws)
        if (activeId) {
          const { messages } = await window.wraith.resumeSession(activeId)
          dispatch({ type: 'loadHistory', items: messagesToItems(messages) })
        }
        void fetchSessions()
      } catch (err) {
        console.error('[wraith] reconnect error:', err)
      }
    })()
  }, [state.connection, state.sessionId, state.workspace, fetchSessions])
```

4. `<Sidebar>` 加 `sandbox={state.sandbox}`。

- [ ] **Step 6: 加重连恢复 E2E**

追加(用现有 `MOCK_EXIT_AFTER_INIT`? 不——需要一轮后再断。用一个可控的二次 spawn:点 restart 后重连):

```ts
test('reconnect after restart re-resumes the active session', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1' }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })
  // one turn → turn.completed carries sessionId (mock sess_mock_N) → activeSessionId set
  await win.locator('[data-testid="input"]').fill('hi')
  await win.locator('[data-testid="input"]').press('Enter')
  await expect(win.locator('[data-testid="transcript"]')).toBeVisible({ timeout: 15000 })
  await expect(win.locator('[data-testid="tool-card"]')).toContainText('exit 0', { timeout: 15000 })
  // (manual restart path is controller-eyeballed; here we assert reconnect effect exists via no-crash on connected)
  await app.close()
})
```

> 真·断连→重连的自动 resume 往返较难在 mock 里确定性触发(涉及子进程重启时序);E2E 只做"一轮后活跃 id 建立 + 不崩"冒烟,**真实重连恢复放控制器眼验**(Step 收尾)。

- [ ] **Step 7: 全套测试**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run test && npm run build && npx playwright test`
Expected: vitest 全绿;typecheck 0;build;Playwright 全绿(沙箱徽标 none 警示、重连冒烟、既有全过)。

- [ ] **Step 8: 提交**

```bash
git add desktop/src/renderer/App.tsx desktop/src/renderer/components/Sidebar.tsx \
        desktop/test/fixtures/mock-appserver.mjs desktop/test/e2e/shell.e2e.ts
git commit -m "feat(desktop): 重连自动 resume + 沙箱徽标

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 收尾(整支终审前后)

- **控制器真后端眼验**(spec §7):真 `java -jar ~/.wraith/wraith.jar app-server`——① 跑一轮 → 侧栏 `session.list` 出现该会话;② 点历史会话 → 静态回放(user + 助手 + 工具卡);③ 新对话清空;④ 杀后端进程 → banner → 重连 → 活跃会话历史自动 resume(后端 Agent 有上下文,下一轮延续);⑤ 非 macOS 或模拟 → 沙箱徽标"未启用"。临时脚本用后删、不提交。
- 全套 Java 回归:`mvn test -DskipTests=false`(对照 `testing_quirks` ~3F/38E 环境性基线)。

## Self-Review（已过）

- **Spec 覆盖**:持久化接线→T2;list/resume 协议→T1;单活跃会话(单槽)→T1/T2 不引 Map;messagesToItems 静态回放→T3;user 气泡→T3/T5;功能侧栏→T6;重连→T7;sandbox 诚实+徽标→T2/T7。
- **占位扫描**:无 TBD/TODO;每个改码步给完整代码或精确插入点 + 代码。
- **类型一致**:`SessionMeta`/`ResumedMessage`(T3)↔ 后端 SessionMeta record + SessionMessageCodec 字段(Global Constraints)↔ IPC(T4)↔ Sidebar/messagesToItems(T3/T6)一致;`sessionId`/`sandbox` 值域('macos-seatbelt'/'none'/'unknown')全程一致;`persistTurn(): String`(T1 接口)↔ Main 实现(T2)↔ turn.completed 读取(T1)↔ reducer sessionId(T3)一致;新 testid(`user-msg`/`conversation-item`/`new-conversation`/`sandbox-badge`)在创建任务定义、E2E 断言一致。
- **跨任务约束**:T6 删除 Sidebar 的 `nav-new`/`nav-settings` 占位——Phase A 的 "static sidebar" E2E 只断 `sidebar` 可见 + `nav-plugins` disabled,仍成立(已在 T6 Step3 说明)。
