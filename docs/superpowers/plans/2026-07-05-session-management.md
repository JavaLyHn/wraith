# 会话管理(新建/改名/删除/star)+ 自动化会话可见性修复 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给会话加 star / 改名 / 删除 / 新建 UI,并修复"查看会话不跳转"和"定时任务触发后侧边栏不显示新会话"两个 bug。

**Architecture:** `SessionMeta`(Java record + TS)加 `starred` + `name` 两字段;`SessionStore` 复用现有 `read()`+`write()` 增加按 id 的 `setStarred`/`rename`/`deleteById`,并在内存态保留 starred/name 以免 `persist()` 每轮重写时清零;新增 `session.setStarred`/`rename`/`delete` 三个 JSON-RPC,经 preload/IPC 暴露;Sidebar 顶部新建按钮 + "⭐重点"置顶分区 + 每行 ★/✎/🗑。两个 bug 分别修传参(workspace 回退)与刷新信号(Part D 轮询发 `runs-changed`)。

**Tech Stack:** Java 17 / Jackson / JUnit5;Electron + React + TypeScript / Vitest / Playwright。

## Global Constraints

- 门禁:Java 全量 `mvn -DskipTests=false test` 0F/0E(基线约 4F/38E 的 JDK26+Mockito 噪声不计);桌面 `npm run typecheck` + `npx vitest run` 全绿。
- 每个 commit 前跑密钥红线:`git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指/测试金丝雀)。
- commit trailer 必带:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 与 `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- 单写者:会话文件的 star/改名/删除一律经 app-server 的 `SessionStore`;daemon 仅在跑自动化时 `startNew()+persist()` 新建会话,`id` 唯一不撞。
- 范围内(YAGNI):仅当前项目内按 id 操作;不做跨项目聚合;不改 `list()` 的 updatedAt 倒序契约(star 分组在 UI 层)。
- 分支:`feat/session-management`(已建,spec 已提交)。

---

### Task 1: SessionMeta 加 starred/name + SessionStore 存取(含 persist 保留)+ setStarred/rename

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/session/SessionMeta.java`
- Modify: `src/main/java/com/lyhn/wraith/session/SessionStore.java`
- Modify: `desktop/src/shared/types.ts:122-132`
- Test: `src/test/java/com/lyhn/wraith/session/SessionStarNameTest.java`(新建)

**Interfaces:**
- Produces(Java):`SessionMeta(String id, String cwd, String createdAt, String updatedAt, String provider, String model, String title, int turns, boolean starred, String name)`;`SessionStore.setStarred(String id, boolean) → boolean`(找到并写成功=true);`SessionStore.rename(String id, String name) → boolean`(name 空白/ null → 清除自定义名回落 title)。
- Produces(TS):`SessionMeta` 新增可选字段 `starred?: boolean`、`name?: string`。

- [ ] **Step 1: 写失败测试**

新建 `src/test/java/com/lyhn/wraith/session/SessionStarNameTest.java`:

```java
package com.lyhn.wraith.session;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SessionStarNameTest {

    @TempDir Path home;

    private SessionStore openStore() {
        return SessionStore.open(home, "/proj-A", "deepseek", "deepseek-chat");
    }

    private String seedOneTurn(SessionStore s) {
        s.startNew();
        s.persist(List.of(LlmClient.Message.user("你好世界")));
        return s.currentId();
    }

    @Test void newSessionDefaultsStarredFalseNameNull() {
        SessionStore s = openStore();
        String id = seedOneTurn(s);
        SessionMeta m = s.meta(id);
        assertNotNull(m);
        assertFalse(m.starred());
        assertNull(m.name());
    }

    @Test void setStarredPersistsAndSurvivesNextPersist() {
        SessionStore s = openStore();
        String id = seedOneTurn(s);
        assertTrue(s.setStarred(id, true));
        assertTrue(s.meta(id).starred(), "setStarred 应写入 starred=true");
        // 同一会话再来一轮对话:persist 不得把 starred 冲掉
        s.persist(List.of(LlmClient.Message.user("你好世界"), LlmClient.Message.assistant("在"),
                LlmClient.Message.user("再来一句")));
        assertTrue(s.meta(id).starred(), "persist 必须保留已有 starred");
    }

    @Test void renameSetsAndClears() {
        SessionStore s = openStore();
        String id = seedOneTurn(s);
        assertTrue(s.rename(id, "部署脚本"));
        assertEquals("部署脚本", s.meta(id).name());
        assertTrue(s.rename(id, "  "));               // 空白 → 清除
        assertNull(s.meta(id).name(), "空白 name 应清除自定义名");
    }

    @Test void setStarredRenameOnMissingIdReturnsFalse() {
        SessionStore s = openStore();
        assertFalse(s.setStarred("nope-0000", true));
        assertFalse(s.rename("nope-0000", "x"));
    }

    @Test void legacyFileWithoutStarredNameReadsAsFalseNull() throws Exception {
        // 手写一个旧格式 meta 行(无 starred/name)+ 一条消息
        Path dir = home.resolve(".wraith").resolve("sessions").resolve(SessionStore.hash("/proj-A"));
        Files.createDirectories(dir);
        String legacy = "{\"v\":1,\"id\":\"20260101-000000-abcd\",\"cwd\":\"/proj-A\","
                + "\"createdAt\":\"2026-01-01T00:00:00Z\",\"updatedAt\":\"2026-01-01T00:00:00Z\","
                + "\"provider\":\"deepseek\",\"model\":\"deepseek-chat\",\"title\":\"旧会话\",\"turns\":1}\n"
                + "{\"role\":\"user\",\"content\":\"hi\"}\n";
        Files.writeString(dir.resolve("20260101-000000-abcd.jsonl"), legacy, StandardCharsets.UTF_8);
        SessionStore s = openStore();
        SessionMeta m = s.meta("20260101-000000-abcd");
        assertNotNull(m);
        assertFalse(m.starred());
        assertNull(m.name());
        assertEquals("旧会话", m.title());
    }
}
```

> 注:若 `LlmClient.Message.user(...)`/`.assistant(...)` 工厂签名与本仓库不同,按实际工厂构造 user/assistant 消息(实现前先 `grep -n "static.*Message user\|Message.user\|record Message" src/main/java/com/lyhn/wraith/llm/LlmClient.java` 对齐)。

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=SessionStarNameTest test`
Expected: 编译失败 —— `SessionMeta` 无 `starred()/name()`、`SessionStore` 无 `setStarred/rename`。

- [ ] **Step 3: SessionMeta 加两个 record 组件**

`src/main/java/com/lyhn/wraith/session/SessionMeta.java` 改 record 头(其余 javadoc 保留,补两行 @param):

```java
public record SessionMeta(
        String id,
        String cwd,
        String createdAt,
        String updatedAt,
        String provider,
        String model,
        String title,
        int turns,
        boolean starred,
        String name) {
}
```

- [ ] **Step 4: SessionStore 加内存态 + 读写 + setStarred/rename**

在 `SessionStore.java`:

1) 字段区(`private String title;` 之后)加:
```java
    private boolean starred;
    private String name;
```

2) `startNew()` 末尾补重置:
```java
        starred = false;
        name = null;
```

3) `persist(...)` 里构造 meta 的那行(现 `write(new SessionMeta(currentId, cwd, createdAt, now, provider, model, title, turns), convo);`)改为:
```java
            write(new SessionMeta(currentId, cwd, createdAt, now, provider, model, title, turns, starred, name), convo);
```

4) `resume(String id)` 内(设置 `title = rec.meta().title();` 之后)补载入:
```java
        starred = rec.meta().starred();
        name = rec.meta().name();
```

5) `readMeta(...)` 里 `return new SessionMeta(...)` 改为带两新字段:
```java
            return new SessionMeta(
                    text(n, "id"), text(n, "cwd"), text(n, "createdAt"), text(n, "updatedAt"),
                    text(n, "provider"), text(n, "model"), text(n, "title"),
                    n.has("turns") ? n.get("turns").asInt() : 0,
                    n.has("starred") && n.get("starred").asBoolean(),
                    text(n, "name"));
```

6) `metaJson(SessionMeta m)` 在 `n.put("turns", m.turns());` 后补:
```java
        n.put("starred", m.starred());
        if (m.name() != null) {
            n.put("name", m.name());
        }
```

7) 在 `deleteCurrent()` 之后加两个公有方法 + 一个私有重写助手:
```java
    /** 给指定会话加/去星。找不到该会话返回 false。 */
    public synchronized boolean setStarred(String id, boolean starredFlag) {
        return rewriteMeta(id, m -> new SessionMeta(m.id(), m.cwd(), m.createdAt(), m.updatedAt(),
                m.provider(), m.model(), m.title(), m.turns(), starredFlag, m.name()));
    }

    /** 给指定会话设自定义名;name 为 null/空白 → 清除(回落 title)。找不到返回 false。 */
    public synchronized boolean rename(String id, String newName) {
        String nm = (newName == null || newName.isBlank()) ? null : newName.strip();
        return rewriteMeta(id, m -> new SessionMeta(m.id(), m.cwd(), m.createdAt(), m.updatedAt(),
                m.provider(), m.model(), m.title(), m.turns(), m.starred(), nm));
    }

    /** 读该会话整文件 → 变换 meta 首行 → 原子写回。若是当前会话,同步内存态。 */
    private boolean rewriteMeta(String id, java.util.function.UnaryOperator<SessionMeta> mutator) {
        SessionRecord rec = read(id);
        if (rec == null) {
            return false;
        }
        SessionMeta updated = mutator.apply(rec.meta());
        try {
            write(updated, rec.messages());
        } catch (IOException e) {
            return false;
        }
        if (updated.id().equals(currentId)) {
            this.starred = updated.starred();
            this.name = updated.name();
        }
        return true;
    }
```

- [ ] **Step 5: TS SessionMeta 加可选字段**

`desktop/src/shared/types.ts` 的 `SessionMeta` 接口(第 122-132 行区)补两行:
```typescript
  turns: number           // count of user turns
  starred?: boolean        // 用户标记的重点会话
  name?: string            // 用户自定义名;显示优先于 title
```

- [ ] **Step 6: 跑测试确认通过**

Run: `mvn -DskipTests=false -Dtest=SessionStarNameTest test`
Expected: `Tests run: 5, Failures: 0, Errors: 0`

- [ ] **Step 7: 桌面 typecheck(TS 类型改动)**

Run: `cd desktop && npm run typecheck`
Expected: 无输出(通过)。

- [ ] **Step 8: 提交**

```bash
git add src/main/java/com/lyhn/wraith/session/SessionMeta.java src/main/java/com/lyhn/wraith/session/SessionStore.java src/test/java/com/lyhn/wraith/session/SessionStarNameTest.java desktop/src/shared/types.ts
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"   # 应仅命中字段名/无
git commit -m "feat(session): SessionMeta 加 starred/name + SessionStore setStarred/rename(persist 保留)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 2: SessionStore.deleteById

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/session/SessionStore.java`
- Test: `src/test/java/com/lyhn/wraith/session/SessionStarNameTest.java`(追加)

**Interfaces:**
- Produces:`SessionStore.deleteById(String id) → boolean`(删除成功=true;文件本就不存在=false;非法 id 安全返回 false)。

- [ ] **Step 1: 追加失败测试**

在 `SessionStarNameTest` 追加:
```java
    @Test void deleteByIdRemovesFileAndIsIdempotent() {
        SessionStore s = openStore();
        String id = seedOneTurn(s);
        assertNotNull(s.meta(id));
        assertTrue(s.deleteById(id), "首次删除应返回 true");
        assertNull(s.meta(id), "删除后 meta 应为 null");
        assertFalse(s.deleteById(id), "再次删除不存在的文件返回 false");
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=SessionStarNameTest#deleteByIdRemovesFileAndIsIdempotent test`
Expected: 编译失败 —— 无 `deleteById`。

- [ ] **Step 3: 实现 deleteById**

在 `SessionStore.java` 的 `deleteCurrent()` 附近加:
```java
    /** 按 id 删除会话文件;成功=true,文件不存在=false。非法 id 安全返回 false。 */
    public synchronized boolean deleteById(String id) {
        if (id == null || id.isBlank()) {
            return false;
        }
        try {
            boolean removed = Files.deleteIfExists(dir.resolve(safeId(id) + ".jsonl"));
            if (removed && id.equals(currentId)) {
                startNew();   // 删掉的是当前会话 → 重置内存态
            }
            return removed;
        } catch (IOException e) {
            return false;
        }
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -DskipTests=false -Dtest=SessionStarNameTest test`
Expected: `Tests run: 6, Failures: 0, Errors: 0`

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/session/SessionStore.java src/test/java/com/lyhn/wraith/session/SessionStarNameTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"
git commit -m "feat(session): SessionStore.deleteById(按 id 删会话,幂等)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 3: session.setStarred / rename / delete 三个 RPC(AppServer + Main + 端到端测试)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(接口默认方法 :26 区 + dispatch :114 区 + 三个 handler)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(匿名 SessionRunner :1176 区加三个方法)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSessionOpsTest.java`(新建)

**Interfaces:**
- Consumes:Task 1/2 的 `SessionStore.setStarred/rename/deleteById`。
- Produces(SessionRunner 接口默认方法):`boolean setSessionStarred(String id, boolean starred)`、`boolean renameSession(String id, String name)`、`boolean deleteSession(String id)`(默认返回 false)。
- Produces(RPC):`session.setStarred{sessionId,starred}` / `session.rename{sessionId,name}` / `session.delete{sessionId}`,均返回 `{ok:true}`;缺 sessionId → `-32602`;无 session → `-32000`。

- [ ] **Step 1: 写失败测试(端到端)**

新建 `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSessionOpsTest.java`。用与 `AppServerAutomationsTest` 相同的 `run(...)` 骨架驱动一个内存 AppServer;`SessionRunnerFactory` 用真实 `SessionStore`(临时目录),预置一个会话,再经 RPC 加星/改名/删除并断言。

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.session.SessionMeta;
import com.lyhn.wraith.session.SessionStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

class AppServerSessionOpsTest {

    @TempDir Path home;

    /** 预置一个会话,返回其 id。 */
    private String seed() {
        SessionStore s = SessionStore.open(home, "/proj", "deepseek", "deepseek-chat");
        s.startNew();
        s.persist(List.of(LlmClient.Message.user("hello")));
        return s.currentId();
    }

    /** 每个请求前先 session.start;factory 的 SessionRunner 用共享 SessionStore。 */
    private List<JsonNode> run(String... requests) throws Exception {
        SessionStore store = SessionStore.open(home, "/proj", "deepseek", "deepseek-chat");
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            public List<SessionMeta> listSessions() { return store.list(50); }
            public boolean setSessionStarred(String id, boolean starred) { return store.setStarred(id, starred); }
            public boolean renameSession(String id, String name) { return store.rename(id, name); }
            public boolean deleteSession(String id) { return store.deleteById(id); }
        };
        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        int id = 2;
        for (String req : requests) lines.add(req.replace("__ID__", String.valueOf(id++)));
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)),
                out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n"))
            if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }

    private JsonNode byId(List<JsonNode> replies, int id) {
        return replies.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst()
                .orElseThrow(() -> new AssertionError("no reply for id=" + id));
    }

    @Test void setStarredThenListShowsStarred() throws Exception {
        String sid = seed();
        List<JsonNode> r = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.setStarred\",\"params\":{\"sessionId\":\"" + sid + "\",\"starred\":true}}",
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.list\",\"params\":{}}");
        assertTrue(byId(r, 2).path("result").path("ok").asBoolean());
        JsonNode s0 = byId(r, 3).path("result").path("sessions").get(0);
        assertTrue(s0.path("starred").asBoolean(), "list 里该会话应 starred=true");
    }

    @Test void renameThenListShowsName() throws Exception {
        String sid = seed();
        List<JsonNode> r = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.rename\",\"params\":{\"sessionId\":\"" + sid + "\",\"name\":\"部署脚本\"}}",
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.list\",\"params\":{}}");
        assertTrue(byId(r, 2).path("result").path("ok").asBoolean());
        assertEquals("部署脚本", byId(r, 3).path("result").path("sessions").get(0).path("name").asText());
    }

    @Test void deleteThenListEmpty() throws Exception {
        String sid = seed();
        List<JsonNode> r = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.delete\",\"params\":{\"sessionId\":\"" + sid + "\"}}",
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.list\",\"params\":{}}");
        assertTrue(byId(r, 2).path("result").path("ok").asBoolean());
        assertEquals(0, byId(r, 3).path("result").path("sessions").size());
    }

    @Test void missingSessionIdIsParamError() throws Exception {
        List<JsonNode> r = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.setStarred\",\"params\":{\"starred\":true}}");
        assertNotNull(byId(r, 2).get("error"));
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=AppServerSessionOpsTest test`
Expected: 编译失败(SessionRunner 无 setSessionStarred 等)或方法未分发 → error 断言失败。

- [ ] **Step 3: SessionRunner 接口加三个默认方法**

`AppServer.java` 接口 `SessionRunner`(:26)内,`default boolean rewind(int userOrdinal) { return false; }`(:48)附近加:
```java
        default boolean setSessionStarred(String sessionId, boolean starred) { return false; }
        default boolean renameSession(String sessionId, String name) { return false; }
        default boolean deleteSession(String sessionId) { return false; }
```

- [ ] **Step 4: dispatch 加三个 case + 三个 handler**

在 dispatch switch(`case "session.rewind" -> handleSessionRewind(msg);` 之后)加:
```java
            case "session.setStarred" -> handleSessionSetStarred(msg);
            case "session.rename" -> handleSessionRename(msg);
            case "session.delete" -> handleSessionDelete(msg);
```

在 `handleSessionRewind` 附近加三个 handler(复用现有 `sessionIdParam` 取参风格,与 `handleSessionResume` 一致):
```java
    private void handleSessionSetStarred(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String id = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (id.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        boolean starred = p.path("starred").asBoolean(false);
        if (!session.setSessionStarred(id, starred)) { writer.error(msg.id(), -32000, "setStarred failed"); return; }
        writer.result(msg.id(), Map.of("ok", true));
    }

    private void handleSessionRename(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String id = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (id.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        String name = p.hasNonNull("name") ? p.get("name").asText() : null;
        if (!session.renameSession(id, name)) { writer.error(msg.id(), -32000, "rename failed"); return; }
        writer.result(msg.id(), Map.of("ok", true));
    }

    private void handleSessionDelete(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String id = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (id.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        session.deleteSession(id);   // 幂等:文件不存在也算删成功(前端只需知道"没了")
        writer.result(msg.id(), Map.of("ok", true));
    }
```

- [ ] **Step 5: Main.java 匿名 SessionRunner 加三个方法**

`Main.java` 匿名 `SessionRunner`(:1176 区,`persistTurn()`/`rewind(...)` 附近)加:
```java
                    public boolean setSessionStarred(String id, boolean starred) {
                        return sessionStore.setStarred(id, starred);
                    }
                    public boolean renameSession(String id, String name) {
                        return sessionStore.rename(id, name);
                    }
                    public boolean deleteSession(String id) {
                        return sessionStore.deleteById(id);
                    }
```

- [ ] **Step 6: 跑测试确认通过**

Run: `mvn -DskipTests=false -Dtest=AppServerSessionOpsTest test`
Expected: `Tests run: 4, Failures: 0, Errors: 0`

- [ ] **Step 7: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/main/java/com/lyhn/wraith/cli/Main.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSessionOpsTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"
git commit -m "feat(session): session.setStarred/rename/delete RPC + SessionRunner 实现" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 4: preload + IPC 暴露三个方法

**Files:**
- Modify: `desktop/src/preload/index.ts`(接口声明区 + 实现区,均在 session 方法附近)
- Modify: `desktop/src/main/index.ts`(session IPC handler 区 :481 附近)

**Interfaces:**
- Consumes:Task 3 的 `session.setStarred/rename/delete` RPC。
- Produces(preload,挂到 `window.wraith`):`setSessionStarred(sessionId: string, starred: boolean): Promise<{ok:boolean}>`、`renameSession(sessionId: string, name: string): Promise<{ok:boolean}>`、`deleteSession(sessionId: string): Promise<{ok:boolean}>`。

- [ ] **Step 1: preload 加接口声明**

`desktop/src/preload/index.ts` 的 API 接口类型区(`rewindSession(userOrdinal: number): Promise<{ ok: boolean }>` 声明附近)加:
```typescript
  setSessionStarred(sessionId: string, starred: boolean): Promise<{ ok: boolean }>
  renameSession(sessionId: string, name: string): Promise<{ ok: boolean }>
  deleteSession(sessionId: string): Promise<{ ok: boolean }>
```

- [ ] **Step 2: preload 加实现**

在 `rewindSession(userOrdinal) { ... }`(:147-149)之后加:
```typescript
  setSessionStarred(sessionId, starred) {
    return ipcRenderer.invoke('wraith:setSessionStarred', sessionId, starred) as Promise<{ ok: boolean }>
  },

  renameSession(sessionId, name) {
    return ipcRenderer.invoke('wraith:renameSession', sessionId, name) as Promise<{ ok: boolean }>
  },

  deleteSession(sessionId) {
    return ipcRenderer.invoke('wraith:deleteSession', sessionId) as Promise<{ ok: boolean }>
  },
```

- [ ] **Step 3: main IPC handler**

`desktop/src/main/index.ts` 的 `wraith:rewindSession` handler(:486-489)之后加:
```typescript
ipcMain.handle('wraith:setSessionStarred', async (_e, sessionId: string, starred: boolean) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.setStarred', { sessionId, starred })
})
ipcMain.handle('wraith:renameSession', async (_e, sessionId: string, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.rename', { sessionId, name })
})
ipcMain.handle('wraith:deleteSession', async (_e, sessionId: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.delete', { sessionId })
})
```

- [ ] **Step 4: typecheck**

Run: `cd desktop && npm run typecheck`
Expected: 通过(无输出)。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/preload/index.ts desktop/src/main/index.ts
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"
git commit -m "feat(desktop): preload+IPC 暴露 setSessionStarred/renameSession/deleteSession" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 5: 渲染层纯函数(显示名 + 重点分组)

**Files:**
- Create: `desktop/src/renderer/lib/sessionView.ts`
- Test: `desktop/test/sessionView.test.ts`(新建)

**Interfaces:**
- Produces:`sessionDisplayName(s: SessionMeta): string`(= `s.name?.trim() || s.title || '(未命名)'`);`partitionStarred(sessions: SessionMeta[]): { starred: SessionMeta[]; rest: SessionMeta[] }`(保持各自原有顺序;`starred===true` 归 starred)。

- [ ] **Step 1: 写失败测试**

新建 `desktop/test/sessionView.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { sessionDisplayName, partitionStarred } from '../src/renderer/lib/sessionView'
import type { SessionMeta } from '../src/shared/types'

function s(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'i', cwd: '/p', createdAt: 't', updatedAt: 't',
    provider: 'deepseek', model: 'm', title: '自动标题', turns: 1, ...over,
  }
}

describe('sessionDisplayName', () => {
  it('有 name 用 name', () => expect(sessionDisplayName(s({ name: '部署脚本' }))).toBe('部署脚本'))
  it('name 空白回落 title', () => expect(sessionDisplayName(s({ name: '  ' }))).toBe('自动标题'))
  it('无 name 用 title', () => expect(sessionDisplayName(s())).toBe('自动标题'))
  it('都无 → (未命名)', () => expect(sessionDisplayName(s({ title: '' }))).toBe('(未命名)'))
})

describe('partitionStarred', () => {
  it('按 starred 拆分并保序', () => {
    const a = s({ id: 'a' }), b = s({ id: 'b', starred: true }), c = s({ id: 'c' }), d = s({ id: 'd', starred: true })
    const { starred, rest } = partitionStarred([a, b, c, d])
    expect(starred.map(x => x.id)).toEqual(['b', 'd'])
    expect(rest.map(x => x.id)).toEqual(['a', 'c'])
  })
  it('无 starred 时 starred 为空', () => {
    const { starred, rest } = partitionStarred([s({ id: 'a' })])
    expect(starred).toEqual([])
    expect(rest.map(x => x.id)).toEqual(['a'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/sessionView.test.ts`
Expected: FAIL —— 模块/函数不存在。

- [ ] **Step 3: 实现纯函数**

新建 `desktop/src/renderer/lib/sessionView.ts`:
```typescript
import type { SessionMeta } from '../../shared/types'

/** 会话展示名:自定义名优先,其次自动标题,最后兜底。 */
export function sessionDisplayName(s: SessionMeta): string {
  const n = s.name?.trim()
  if (n) return n
  return s.title || '(未命名)'
}

/** 按 starred 拆成两组,各自保持传入顺序(不改 updatedAt 倒序)。 */
export function partitionStarred(sessions: SessionMeta[]): { starred: SessionMeta[]; rest: SessionMeta[] } {
  const starred: SessionMeta[] = []
  const rest: SessionMeta[] = []
  for (const s of sessions) (s.starred ? starred : rest).push(s)
  return { starred, rest }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/sessionView.test.ts`
Expected: PASS(6 个)。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/lib/sessionView.ts desktop/test/sessionView.test.ts
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"
git commit -m "feat(desktop): 会话展示名 + 重点分组纯函数 + 单测" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 6: Sidebar UI —— 新建按钮 + ⭐重点分区 + 每行 ★/✎/🗑

**Files:**
- Modify: `desktop/src/renderer/components/Sidebar.tsx`(props + 非搜索态会话列表渲染 :239-260 区)
- Modify: `desktop/src/renderer/App.tsx`(给 Sidebar 传新回调:star/改名/删除)
- Test: `desktop/test/e2e/shell.e2e.ts`(追加一条会话管理 e2e)

**Interfaces:**
- Consumes:Task 4 preload 的 `setSessionStarred/renameSession/deleteSession`;Task 5 的 `sessionDisplayName`/`partitionStarred`;Sidebar 已有 `onNewConversation`/`onSelectSession`/`sessions`/`activeSessionId`。
- Produces(Sidebar 新 props):`onToggleStar(id: string, starred: boolean): void`、`onRenameSession(id: string, name: string): void`、`onDeleteSession(id: string): void`。

- [ ] **Step 1: App.tsx 加三个 handler 并下传**

在 `App.tsx`(`handleSelectSession` 附近)加:
```typescript
  const handleToggleStar = useCallback(async (id: string, starred: boolean) => {
    await window.wraith.setSessionStarred(id, starred)
    void fetchSessions()
  }, [fetchSessions])

  const handleRenameSession = useCallback(async (id: string, name: string) => {
    await window.wraith.renameSession(id, name)
    void fetchSessions()
  }, [fetchSessions])

  const handleDeleteSession = useCallback(async (id: string) => {
    await window.wraith.deleteSession(id)
    if (id === state.sessionId) await window.wraith.startSession(state.workspace || null)  // 删的是当前会话 → 开新会话
    void fetchSessions()
  }, [fetchSessions, state.sessionId, state.workspace])
```

给 `<Sidebar ... />`(渲染处)补三个 props:
```tsx
        onToggleStar={handleToggleStar}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
```

> 实现前先 `grep -n "startSession\|新会话" src/renderer/App.tsx` 确认新会话 handler 名称;若已有 `handleNewConversation`,`onNewConversation` 已在传,无需新增,只加上面三个。

- [ ] **Step 2: Sidebar props 扩展**

`Sidebar.tsx` 的 `SidebarProps` 接口(`onSelectSession` 附近)加:
```typescript
  onToggleStar: (id: string, starred: boolean) => void
  onRenameSession: (id: string, name: string) => void
  onDeleteSession: (id: string) => void
```
并在函数解构参数里补 `onToggleStar, onRenameSession, onDeleteSession,`。

- [ ] **Step 3: 抽一个行组件 + 渲染重点分区**

在 `Sidebar.tsx` 顶部(组件外)加 imports 与行组件:
```tsx
import { sessionDisplayName, partitionStarred } from '../lib/sessionView'
```
```tsx
function SessionRow({ s, active, onSelect, onToggleStar, onRename, onDelete }: {
  s: SessionMeta; active: boolean
  onSelect: (id: string) => void
  onToggleStar: (id: string, starred: boolean) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}): JSX.Element {
  const [confirmDel, setConfirmDel] = useState(false)
  return (
    <div className={'group mb-0.5 flex items-center gap-1 rounded-lg px-1 ' +
      (active ? 'bg-surface' : 'hover:bg-surface/60')}>
      <button data-testid="conversation-item" onClick={() => onSelect(s.id)}
        className={'flex-1 truncate px-2 py-2 text-left text-xs ' + (active ? 'text-fg' : 'text-fg-muted')}
        title={sessionDisplayName(s)}>
        {sessionDisplayName(s)}
      </button>
      <button data-testid="session-star" title={s.starred ? '取消重点' : '标记重点'}
        onClick={() => onToggleStar(s.id, !s.starred)}
        className={'shrink-0 px-1 text-xs ' + (s.starred ? 'text-warning' : 'text-fg-subtle opacity-0 group-hover:opacity-100')}>
        {s.starred ? '★' : '☆'}
      </button>
      <button data-testid="session-rename" title="改名"
        onClick={() => { const n = window.prompt('会话名', sessionDisplayName(s)); if (n !== null) onRename(s.id, n) }}
        className="shrink-0 px-1 text-xs text-fg-subtle opacity-0 group-hover:opacity-100">✎</button>
      <button data-testid="session-delete" title={confirmDel ? '确认删除?' : '删除'}
        onClick={() => { if (!confirmDel) { setConfirmDel(true); return } onDelete(s.id) }}
        className={'shrink-0 px-1 text-xs opacity-0 group-hover:opacity-100 ' + (confirmDel ? 'text-danger opacity-100' : 'text-fg-subtle')}>
        {confirmDel ? '✓' : '🗑'}
      </button>
    </div>
  )
}
```

把**非搜索态**的会话列表(:239-260 的 `sessions.map(...)`)整体替换为分区渲染:
```tsx
            <>
              {(() => { const { starred, rest } = partitionStarred(sessions); return (
                <>
                  {sessions.length === 0 && <div className="mt-4 px-3 py-2 text-xs text-fg-subtle">还没有历史会话</div>}
                  {starred.length > 0 && <>
                    <div className="mt-4 px-3 text-[10px] uppercase tracking-wider text-fg-subtle">⭐ 重点</div>
                    <div className="px-2">{starred.map(s => (
                      <SessionRow key={s.id} s={s} active={s.id === activeSessionId}
                        onSelect={onSelectSession} onToggleStar={onToggleStar}
                        onRename={onRenameSession} onDelete={onDeleteSession} />
                    ))}</div>
                  </>}
                  {rest.length > 0 && <>
                    <div className="mt-4 px-3 text-[10px] uppercase tracking-wider text-fg-subtle">对话</div>
                    <div className="px-2">{rest.map(s => (
                      <SessionRow key={s.id} s={s} active={s.id === activeSessionId}
                        onSelect={onSelectSession} onToggleStar={onToggleStar}
                        onRename={onRenameSession} onDelete={onDeleteSession} />
                    ))}</div>
                  </>}
                </>
              )})()}
            </>
```

> "＋新建会话"按钮:确认 Sidebar 顶部是否已有调用 `onNewConversation` 的按钮(`grep -n "onNewConversation" src/renderer/components/Sidebar.tsx`)。若已有,保持;若无,在"对话"分区标题上方加:
> ```tsx
> <button data-testid="session-new" onClick={onNewConversation}
>   className="mt-4 mb-1 w-full rounded-lg px-3 py-2 text-left text-xs text-fg-muted hover:bg-surface/60">＋ 新建会话</button>
> ```

- [ ] **Step 4: typecheck + 现有 vitest**

Run: `cd desktop && npm run typecheck && npx vitest run`
Expected: typecheck 无输出;vitest 全绿(数量 = 原有 + Task 5 新增)。

- [ ] **Step 5: e2e —— 会话 star/改名/删除**

在 `desktop/test/e2e/shell.e2e.ts` 追加一条(参考现有 `launchAutoApp()` 用例;若 e2e 环境无法产生真实会话,则以"注入一条会话 fixture 后验证 star 置顶/改名回显/删除消失"为准,按现有 e2e fixture 机制对齐):
```typescript
test('会话 star 置顶 / 改名 / 删除', async () => {
  const { app, win, cleanup } = await launchAutoApp()
  // 前置:确保侧边栏至少一条会话(按现有用例产生会话的方式:发一轮消息或注入 fixture)
  await win.locator('[data-testid="session-star"]').first().click()
  await expect(win.locator('[data-testid="conversation-item"]').first()).toBeVisible()
  // 删除(两次点击确认)
  await win.locator('[data-testid="session-delete"]').first().click()
  await win.locator('[data-testid="session-delete"]').first().click()
  await app.close(); cleanup()
})
```

> e2e 若在当前 harness 下难以稳定产生会话,可将本步降级为"仅 typecheck 门禁 + 手动点验",并在报告中注明——不得写空断言充数。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/components/Sidebar.tsx desktop/src/renderer/App.tsx desktop/test/e2e/shell.e2e.ts
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"
git commit -m "feat(desktop): 侧边栏会话 ⭐重点分区 + 每行 star/改名/删除 + 新建会话按钮" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 7: Bug1 —— 查看会话传 workspace 而非 undefined projectPath

**Files:**
- Modify: `desktop/src/renderer/components/AutomationsPanel.tsx:150`

**Interfaces:**
- Consumes:`AutomationTask.workspace`(迁移后规范字段)与可空 `projectPath`(旧别名)。

- [ ] **Step 1: 改传参**

`AutomationsPanel.tsx:150` 现:
```tsx
                <AutomationRuns taskId={current!.id} projectPath={current!.projectPath} onOpenSession={onOpenSession} onApprove={onApprove} />
```
改为:
```tsx
                <AutomationRuns taskId={current!.id} projectPath={current!.workspace ?? current!.projectPath} onOpenSession={onOpenSession} onApprove={onApprove} />
```

- [ ] **Step 2: typecheck**

Run: `cd desktop && npm run typecheck`
Expected: 通过。`AutomationRuns` 的 `projectPath: string` 契约要求非空——若 `workspace` 与 `projectPath` 皆可空导致类型不满足,则用 `current!.workspace ?? current!.projectPath ?? ''`(空串时 `handleOpenAutomationSession` 的 `projectPath !== state.workspace` 仍会走 switch 分支,但 activateProject('') 失败即安全 return;真实任务必有 workspace)。

- [ ] **Step 3: 提交**

```bash
git add desktop/src/renderer/components/AutomationsPanel.tsx
git commit -m "fix(desktop): 查看会话传 workspace(修 undefined projectPath 致跳转中止)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 8: Bug2 —— 定时任务触发后刷新侧边栏会话

**Files:**
- Modify: `desktop/src/main/index.ts`(`pollAndNotify` :651-681)
- Modify: `desktop/src/renderer/App.tsx`(`onAutomationEvent` 处理 :186 区)

**Interfaces:**
- Consumes:现有 `pushAutomation(evt)`(→ `wraith:automation-event`)、`AutomationEvent` 的 `{ kind: 'runs-changed' }`、renderer 的 `fetchSessions`。

- [ ] **Step 1: Part D 在发现新终态 run 时发 runs-changed**

`pollAndNotify`(main/index.ts)改为:通知仍只对 `notifyDesktop` 弹,但**任何新终态 run** 都推进水位并发一次 `runs-changed`:
```typescript
    let maxEndedAt = notifyPollLastSeen
    let sawNew = false

    for (const run of runs) {
      if (!TERMINAL_STATUSES.has(run.status)) continue
      const endedAt = run.endedAt ?? 0
      if (endedAt <= notifyPollLastSeen) continue
      sawNew = true
      if (run.notifyDesktop) {
        const label = run.status === 'success' ? '完成' : run.status === 'failed' ? '失败' : '中断'
        notifyOS('Wraith 自动化任务' + label, run.summary ?? '')
      }
      if (endedAt > maxEndedAt) maxEndedAt = endedAt
    }

    if (maxEndedAt > notifyPollLastSeen) {
      notifyPollLastSeen = maxEndedAt
      pushBadge()
    }
    if (sawNew) pushAutomation({ kind: 'runs-changed' })   // 触发 renderer 刷新会话/运行历史
```

> 确认 `pushAutomation` 在 `index.ts` 作用域可见(`grep -n "function pushAutomation\|pushAutomation(" src/main/index.ts`);它在 :75 区推 `wraith:automation-event`。

- [ ] **Step 2: App.tsx 收到 runs-changed 刷新会话**

`App.tsx` 的 `onAutomationEvent`(:186)在现有 `if (evt.kind === 'badge') ...` 旁加:
```typescript
      if (evt.kind === 'runs-changed') void fetchSessions()
```
并确认该 effect 依赖含 `fetchSessions`(若 lint 报缺依赖,补进依赖数组)。

- [ ] **Step 3: typecheck + vitest**

Run: `cd desktop && npm run typecheck && npx vitest run`
Expected: typecheck 通过;vitest 全绿。

- [ ] **Step 4: 手动点验说明(写入报告)**

自动化难以在单测覆盖跨进程轮询;实现者在报告注明手动点验步骤:desktop 开着 → 建 1 分钟 interval 任务(当前项目)→ 等触发 → 侧边栏 30s 内自动出现新会话;点运行历史"查看会话"→ 跳转到该会话。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/main/index.ts desktop/src/renderer/App.tsx
git commit -m "fix(desktop): 定时任务新终态 run → 推 runs-changed,侧边栏自动刷新会话" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

## 完成后

- 全量门禁:`mvn -DskipTests=false test`(0F/0E)+ `cd desktop && npm run typecheck && npx vitest run`(全绿)。
- 重建 jar + 重装 + 重启 daemon(app-server 从 `~/.wraith/wraith.jar` spawn),重启桌面 app,按 Task 6/8 手动点验 star/改名/删除/新建 + 两个 bug。
- 整支复审(subagent-driven-development 的终审),再进 finishing-a-development-branch。
