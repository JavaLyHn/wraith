# 桌面「项目」面板 + 归档聊天 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把侧栏那个项目下拉框换成独立的「项目」面板（搜索 / 双列排序 / 重点分区 / 行内展开近期会话 / 行内动作），并新增会话归档 —— 归档的会话从侧栏消失、收进「设置 › 归档」，CLI `/archive` 命令族走同一套存储。

**Architecture:** 归档不新建存储，只给 `SessionMeta` 加一个 `archivedAt` 字段，`SessionStore.list()` 过滤掉它 —— 原会话文件原地不动，`.cards.jsonl`（动作卡）与 `starred` 全保留，取消归档是无损的。「展开项目看它的会话」和「跨项目归档列表」都靠新 RPC 只读打开任意项目的 `SessionStore`（`SessionStore.open` 纯拼路径、不 mkdir，对没跑过的项目安全）。渲染层把逻辑压进两个纯函数模块 `projectsView.ts` / `archiveView.ts`，组件只渲染和转发事件。

**Tech Stack:** Java 17 / Maven / JUnit 5（`@TempDir`）；Electron + React 18 + TypeScript / Tailwind / Radix Popover+Dialog / lucide-react；Vitest + @testing-library/react；Playwright（e2e）。

**Spec:** `docs/superpowers/specs/2026-08-05-desktop-projects-panel-design.md`

## Global Constraints

- **设计文档是唯一权威**。本计划与 spec 冲突时以 spec 为准，且要回写 spec。
- **一行 git 代码都不写**。Composer 顶栏那行 chip（项目 / 本地 / 分支）与 git 分支、变更数的数据通路归「顶栏 Git pill」那个 session（`docs/superpowers/specs/2026-08-05-*`、`docs/superpowers/plans/2026-08-05-*`）。
- **同一工作区有并行 session**。每个 task 开工前先 `git log --oneline -3`，改 `Main.java` / `Sidebar.tsx` / `App.tsx` 这类热文件前先 `git diff <file>` 看有没有别人的未提交改动；有就停下问，不要覆盖。
- **面板 id 是 `projects`**，中文名「项目」。归档区**不是**独立面板，是 `settings` 视图下的二级分区，id `archive`，中文名「归档」。
- **概念用词**：项目和会话的置顶都叫「**重点**」，图标 `Star`。不要出现「收藏」「置顶」「pin」作为用户可见文案。归档叫「**归档**」，图标 `Archive`。
- **测试默认跳过**：Java 测试必须带 `-DskipTests=false` 才会跑。
- **Java 测试基线**：1655 通过 / 0 失败 / 0 错误。任何 task 结束时不得低于这个数。
- **桌面测试基线**：`npm test` 1022 通过、`npm run typecheck` 0 错误。
- **`desktop/test/shell.e2e` 有一小簇负载相关抖动**（审批族，快跑全绿、慢跑掉 1–2 条）。怀疑自己改出 e2e 回归时**必须先 `git stash` 跑两次基线**才有区分力。
- **改了 Java 后桌面 dev 要同步 jar**：dev 跑的是 `~/.wraith/wraith.jar`，不是 `target/`。`mvn package && cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar` 然后重启 App，否则报 `method not found`。
- **preload 不热重载**：加了 preload 方法后必须**整个重启 App**，`window.wraith.X is not a function` 是陈旧进程不是代码 bug。
- **提交信息**：中文，`feat(scope):` / `fix(scope):` / `test(scope):` 前缀，正文说清「为什么」而不只是「做了什么」。每个 task 至少一次提交。

## File Structure

### Java 后端

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/main/java/com/lyhn/wraith/session/SessionMeta.java` | 会话元信息 record，加第 12 个字段 `archivedAt` | 改 |
| `src/main/java/com/lyhn/wraith/session/SessionStore.java` | 归档读写（`setArchived` / `listArchived` / `archiveAll`）+ `list()` 过滤 | 改 |
| `src/main/java/com/lyhn/wraith/session/ProjectSessionReader.java` | **新**：只读地统计/列出任意项目的会话，不碰活跃 store。`projectSummary` / `listForProject` / `listArchived(paths)` 三个静态方法都落在这里 | 新 |
| `src/main/java/com/lyhn/wraith/tui/history/ConversationSnapshot.java` | `new SessionMeta(...)` 构造点补参数 | 改 |
| `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` | `SessionRunner` 新方法 + 五条新 `case` + `session.delete` 读可选 `path` | 改 |
| `src/main/java/com/lyhn/wraith/cli/Main.java` | app-server 匿名实现接线；交互 REPL 补 `/archive` 六命令派发 | 改 |
| `src/main/java/com/lyhn/wraith/cli/CliCommandParser.java` | `/archive` 解析层，**工作区里已写好、不再改** | 已有（未提交） |
| `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java` | `open_panel` 白名单加 `projects`（三处字符串） | 改 |
| `src/main/resources/prompts/capabilities.md`、`prompts/base.md` | 面板清单加「项目」 | 改 |

### Electron 主进程 / preload

| 文件 | 职责 | 动作 |
|---|---|---|
| `desktop/src/main/settings.ts` | `ProjectEntry.starred` + `setProjectStarred()` | 改 |
| `desktop/src/main/index.ts` | 一条 settings IPC + 五条转发 RPC 的 IPC | 改 |
| `desktop/src/preload/index.ts` | 六个新方法 | 改 |
| `desktop/src/shared/types.ts` | `ProjectView.starred`、`SessionMeta.archivedAt`、`ProjectSummary` | 改 |

### 渲染层

| 文件 | 职责 | 动作 |
|---|---|---|
| `desktop/src/renderer/lib/projectsView.ts` | **纯函数**：搜索过滤、双列排序、重点分区、短相对时间 | 新 |
| `desktop/src/renderer/lib/archiveView.ts` | **纯函数**：归档列表搜索 + 项目筛选 + 排序 | 新 |
| `desktop/src/renderer/components/ProjectsPanel.tsx` | 面板外壳：搜索框、表头排序、两段分区、空态、骨架态 | 新 |
| `desktop/src/renderer/components/ProjectRow.tsx` | 单行 + 展开区（懒加载）+ `···` 菜单 + 编辑弹窗 | 新 |
| `desktop/src/renderer/components/SettingsArchive.tsx` | 归档列表 + 搜索 + 项目筛选 + ↩ + 🗑（二步确认） | 新 |
| `desktop/src/renderer/components/ProjectSwitcher.tsx` | 瘦身成快切下拉 | 改 |
| `desktop/src/renderer/components/Sidebar.tsx` | `SessionRow` 的 🗑 → 🗄；`activeNav` 加 `projects` | 改 |
| `desktop/src/renderer/components/SettingsPanel.tsx` | `NAV` 加「归档」 | 改 |
| `desktop/src/renderer/App.tsx` | `view` 加 `projects` + 渲染分支 + 新 handler | 改 |
| `desktop/src/renderer/lib/panelActions.ts` | `PanelId` + `PANEL_LABELS` 加 `projects` | 改 |
| `desktop/src/renderer/lib/commandPalette.ts` | `NAV_ITEMS` 加「项目」 | 改 |

### 测试

| 文件 | 覆盖 | 动作 |
|---|---|---|
| `src/test/java/com/lyhn/wraith/session/SessionArchiveTest.java` | 归档落盘、过滤、向后兼容、幂等 | 新 |
| `src/test/java/com/lyhn/wraith/session/ProjectSessionReaderTest.java` | 跨项目只读、不建目录、汇总统计 | 新 |
| `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerArchiveRpcTest.java` | 五条新 RPC + `session.delete` 扩参 | 新 |
| `src/test/java/com/lyhn/wraith/cli/CliCommandParserArchiveTest.java` | `/archive` 命令族解析边界 | 新 |
| `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSessionTest.java` | `new SessionMeta(...)` 构造点补参数 | 改 |
| `desktop/test/projectsView.test.ts` | 搜索 / 排序 / 分区 / 时间分档 | 新 |
| `desktop/test/archiveView.test.ts` | 归档过滤 / 项目筛选 | 新 |
| `desktop/test/projectsPanel.test.tsx` | 懒加载只请求一次、running 守卫、exists=false | 新 |
| `desktop/test/settingsArchive.test.tsx` | ↩/🗑 传 `path`、失败回滚、二步确认 | 新 |
| `desktop/test/sidebarSessionArchive.test.tsx` | 🗄 调用、running 禁用、无 delete 按钮 | 新 |
| `desktop/test/settings.test.ts`（若已存在则改，否则新建） | `setProjectStarred` 持久化 | 改/新 |

---

## Phase A — Java 后端

### Task 1: `SessionMeta.archivedAt` 字段

给 record 加第 12 个组件，把读写两端和全部 7 处构造点补齐。这一步单独成 task 是因为它是纯机械改动 + 一个真实的向后兼容断言（老会话文件没有这个 key）。

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/session/SessionMeta.java`
- Modify: `src/main/java/com/lyhn/wraith/session/SessionStore.java:128,173,213,220,358,415`
- Modify: `src/main/java/com/lyhn/wraith/tui/history/ConversationSnapshot.java:161`
- Modify: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSessionTest.java:29`
- Test: `src/test/java/com/lyhn/wraith/session/SessionArchiveTest.java`（新建）

**Interfaces:**
- Consumes: 无（首个 task）
- Produces: `SessionMeta(String id, String cwd, String createdAt, String updatedAt, String provider, String model, String title, int turns, boolean starred, String name, String origin, String archivedAt)` —— `archivedAt` 是 **ISO-8601 字符串或 null**，`null` = 未归档。后续所有 task 都按这个 12 参签名构造。

- [ ] **Step 1: 写失败测试 —— 老会话文件（meta 无 archivedAt key）读出来是 null**

新建 `src/test/java/com/lyhn/wraith/session/SessionArchiveTest.java`：

```java
package com.lyhn.wraith.session;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class SessionArchiveTest {

    private List<LlmClient.Message> sampleHistory() {
        return List.of(
                LlmClient.Message.system("SYSTEM PROMPT"),
                LlmClient.Message.user("帮我看看登录"),
                LlmClient.Message.assistant("好的"));
    }

    @Test
    void metaWithoutArchivedAtKeyReadsAsNull(@TempDir Path home) {
        // 模拟老会话:persist 一次(此时新代码会写 archivedAt=null,即不写这个 key),再读回
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());

        List<SessionMeta> metas = store.list(10);
        assertEquals(1, metas.size());
        assertNull(metas.get(0).archivedAt(), "未归档会话的 archivedAt 必须是 null,不能是空串");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -Dtest=SessionArchiveTest -DskipTests=false`
Expected: **编译失败**，`cannot find symbol: method archivedAt()`

- [ ] **Step 3: 给 record 加字段**

`src/main/java/com/lyhn/wraith/session/SessionMeta.java` —— 在 javadoc 里加一行 `@param`，在 record 组件末尾加一个：

```java
 * @param origin    会话来源:null/"user"=交互式(默认);"automation"=定时任务无头运行
 *                  (后者从 {@code list()} 过滤,不进主对话侧栏,但仍可按 id resume/peek)
 * @param archivedAt 归档时间(ISO-8601);null=未归档。归档的会话从 {@code list()} 过滤,
 *                  进 {@code listArchived()},但仍可按 id resume/peek。与 origin 是两个
 *                  独立维度:origin 说「谁产生的」,archivedAt 说「用户是否收起来了」
 */
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
        String name,
        String origin,
        String archivedAt) {
}
```

- [ ] **Step 4: 补 SessionStore 的读写两端**

`SessionStore.java:358` 的 `readMeta`，末尾加一个 `text(n, "archivedAt")`：

```java
            return new SessionMeta(
                    text(n, "id"), text(n, "cwd"), text(n, "createdAt"), text(n, "updatedAt"),
                    text(n, "provider"), text(n, "model"), text(n, "title"),
                    n.has("turns") ? n.get("turns").asInt() : 0,
                    n.has("starred") && n.get("starred").asBoolean(),
                    text(n, "name"), text(n, "origin"), text(n, "archivedAt"));
```

`text()` 已经是 `n.hasNonNull(field) ? ... : null`，key 缺失自然回 null —— 这就是向后兼容，不需要额外分支。

`SessionStore.java:415` 的 `metaJson`，照 `name` / `origin` 的形状**只在非 null 时写**（未归档的会话文件里不出现这个 key，老文件读写往返后字节不变）：

```java
        if (m.origin() != null) {
            n.put("origin", m.origin());
        }
        if (m.archivedAt() != null) {
            n.put("archivedAt", m.archivedAt());
        }
        return mapper.writeValueAsString(n);
```

- [ ] **Step 5: 补 SessionStore 里 4 处构造点**

`SessionStore.java` 加一个私有字段跟随内存态（`starred` / `name` 旁边，约 `:54`）：

```java
    private boolean starred;
    private String name;
    private String archivedAt;   // 当前会话的归档时间;null=未归档
```

`startNew()`（约 `:73`）里复位：

```java
    public synchronized void startNew() {
        currentId = null;
        createdAt = null;
        title = null;
        starred = false;
        name = null;
        archivedAt = null;
    }
```

`:128`（`persist` 里）与 `:173`（`beginTurn` 的桩）末尾都补 `archivedAt`：

```java
            write(new SessionMeta(currentId, cwd, createdAt, now, provider, model, title, turns, starred, name, origin, archivedAt), convo);
```

```java
            write(new SessionMeta(currentId, cwd, createdAt, now, provider, model, title, 1, starred, name, origin, archivedAt), stub);
```

`:213`（`setStarred`）与 `:220`（`rename`）末尾都补 `m.archivedAt()` —— **这两处是关键：改星/改名不能把归档态抹掉**：

```java
    public synchronized boolean setStarred(String id, boolean starredFlag) {
        return rewriteMeta(id, m -> new SessionMeta(m.id(), m.cwd(), m.createdAt(), m.updatedAt(),
                m.provider(), m.model(), m.title(), m.turns(), starredFlag, m.name(), m.origin(), m.archivedAt()));
    }

    public synchronized boolean rename(String id, String newName) {
        String nm = (newName == null || newName.isBlank()) ? null : newName.strip();
        return rewriteMeta(id, m -> new SessionMeta(m.id(), m.cwd(), m.createdAt(), m.updatedAt(),
                m.provider(), m.model(), m.title(), m.turns(), m.starred(), nm, m.origin(), m.archivedAt()));
    }
```

`rewriteMeta` 的内存同步（约 `:275`）也补一行：

```java
        if (updated.id().equals(currentId)) {
            this.starred = updated.starred();
            this.name = updated.name();
            this.archivedAt = updated.archivedAt();
        }
```

`resume()`（约 `:388`）里补：

```java
        starred = rec.meta().starred();
        name = rec.meta().name();
        origin = rec.meta().origin();
        archivedAt = rec.meta().archivedAt();
```

- [ ] **Step 6: 补 ConversationSnapshot 与既有测试的构造点**

`src/main/java/com/lyhn/wraith/tui/history/ConversationSnapshot.java:161` 的 `new SessionMeta(...)` 末尾加 `null`（TUI 快照列表不涉及归档）。

`src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSessionTest.java:29`：

```java
                    return List.of(new SessionMeta("s1", "/p", "c", "u", "prov", "mod", "hello world", 3, false, null, null, null));
```

- [ ] **Step 7: 跑测试确认通过**

Run: `mvn test -Dtest=SessionArchiveTest -DskipTests=false`
Expected: PASS

Run: `mvn test -DskipTests=false 2>&1 | tail -20`
Expected: 1655 通过 / 0 失败 / 0 错误（不得低于基线）

- [ ] **Step 8: 提交**

```bash
git add src/main/java/com/lyhn/wraith/session/SessionMeta.java \
        src/main/java/com/lyhn/wraith/session/SessionStore.java \
        src/main/java/com/lyhn/wraith/tui/history/ConversationSnapshot.java \
        src/test/java/com/lyhn/wraith/session/SessionArchiveTest.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSessionTest.java
git commit -m "feat(session): SessionMeta 加 archivedAt —— 归档不新建存储,只在原文件上打标

setStarred / rename 两处 rewriteMeta 必须把 m.archivedAt() 带回去,
否则改个星就把归档态抹了。metaJson 照 name/origin 的形状只在非 null 时写,
老会话文件读写往返后字节不变。"
```

---

### Task 2: `SessionStore` 的归档读写

`setArchived` / `list()` 过滤 / `listArchived` / `archiveAll` 四件事。

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/session/SessionStore.java`
- Test: `src/test/java/com/lyhn/wraith/session/SessionArchiveTest.java`

**Interfaces:**
- Consumes: Task 1 的 `SessionMeta` 12 参签名
- Produces:
  - `boolean SessionStore.setArchived(String id, boolean archived)` —— `true` 写当前 `Instant.now().toString()`，`false` 写 `null`；找不到会话回 `false`
  - `List<SessionMeta> SessionStore.listArchived(int limit)` —— 只含 `archivedAt != null`，按 `archivedAt` 倒序，`limit <= 0` 回全部
  - `int SessionStore.archiveAll()` —— 把本 store 下全部未归档会话标为归档，返回条数；幂等（再调回 0）
  - `SessionStore.list(int)` 语义变更：**额外过滤掉 `archivedAt != null`**

- [ ] **Step 1: 写失败测试**

追加到 `SessionArchiveTest.java`：

```java
    @Test
    void archivedSessionLeavesListAndEntersListArchived(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());
        String id = store.list(10).get(0).id();

        assertTrue(store.setArchived(id, true));

        assertEquals(0, store.list(10).size(), "归档后不该再进主列表");
        List<SessionMeta> archived = store.listArchived(10);
        assertEquals(1, archived.size());
        assertNotNull(archived.get(0).archivedAt(), "归档条目必须有 archivedAt");
        assertEquals(id, archived.get(0).id());
    }

    @Test
    void unarchiveRestoresToList(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());
        String id = store.list(10).get(0).id();
        store.setArchived(id, true);

        assertTrue(store.setArchived(id, false));

        assertEquals(1, store.list(10).size());
        assertNull(store.list(10).get(0).archivedAt());
        assertEquals(0, store.listArchived(10).size());
    }

    @Test
    void archivedSessionStillResumableAndPeekable(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());
        String id = store.list(10).get(0).id();
        store.setArchived(id, true);

        assertEquals(2, store.peek(id).size(), "归档只影响列表,不影响按 id 读");
        assertEquals(2, store.resume(id).size());
    }

    @Test
    void archivingPreservesStarredAndName(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());
        String id = store.list(10).get(0).id();
        store.setStarred(id, true);
        store.rename(id, "登录排查");

        store.setArchived(id, true);

        SessionMeta m = store.listArchived(10).get(0);
        assertTrue(m.starred(), "归档不该抹掉重点标记");
        assertEquals("登录排查", m.name(), "归档不该抹掉自定义名");
    }

    @Test
    void setArchivedOnMissingIdReturnsFalse(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        assertFalse(store.setArchived("20260101-000000-dead", true));
    }

    @Test
    void projectWithAllSessionsArchivedListsEmpty(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());
        String id = store.list(10).get(0).id();
        store.setArchived(id, true);

        // 钉住 spec §3.2 那一行:全归档的项目 list() 为空 → switchToProject 的自动恢复
        // 不进 resume 分支 → 落到一个干净的新会话。这是正确行为,不需要特判。
        assertEquals(0, store.list(10).size());
        assertEquals(1, store.listArchived(10).size());
    }

    @Test
    void archiveAllIsIdempotent(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());
        store.startNew();
        store.persist(List.of(
                LlmClient.Message.system("S"),
                LlmClient.Message.user("第二个会话")));

        assertEquals(2, store.archiveAll());
        assertEquals(0, store.list(10).size());
        assertEquals(2, store.listArchived(10).size());
        assertEquals(0, store.archiveAll(), "已全部归档时再调必须回 0");
    }
```

顶部补 import：

```java
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -Dtest=SessionArchiveTest -DskipTests=false`
Expected: 编译失败，`cannot find symbol: method setArchived`

- [ ] **Step 3: 实现四个方法**

`SessionStore.java`，在 `rename`（约 `:218`）之后插入：

```java
    /**
     * 给指定会话加/去归档。archived=true 写当前时刻,false 清为 null。找不到该会话返回 false。
     *
     * <p>归档只改 meta 首行,消息体与 sidecar cards 都原地不动 —— 取消归档是无损的。
     */
    public synchronized boolean setArchived(String id, boolean archived) {
        String stamp = archived ? Instant.now().toString() : null;
        return rewriteMeta(id, m -> new SessionMeta(m.id(), m.cwd(), m.createdAt(), m.updatedAt(),
                m.provider(), m.model(), m.title(), m.turns(), m.starred(), m.name(), m.origin(), stamp));
    }

    /** 已归档会话,按归档时间倒序,最多 limit 条(limit&lt;=0 返回全部)。 */
    public List<SessionMeta> listArchived(int limit) {
        List<SessionMeta> metas = readAllMetas(m -> m.archivedAt() != null);
        metas.sort(Comparator.comparing(SessionMeta::archivedAt,
                Comparator.nullsFirst(Comparator.naturalOrder())).reversed());
        if (limit > 0 && metas.size() > limit) {
            return new ArrayList<>(metas.subList(0, limit));
        }
        return metas;
    }

    /** 把本 store 下全部未归档会话标为归档,返回实际归档条数。幂等:已全归档时返回 0。 */
    public synchronized int archiveAll() {
        int n = 0;
        for (SessionMeta m : list(0)) {
            if (setArchived(m.id(), true)) {
                n++;
            }
        }
        return n;
    }
```

- [ ] **Step 4: 抽出 `readAllMetas` 并改 `list()` 过滤**

`list(int limit)`（`:315`）现在的循环体和 `listArchived` 只差一个谓词，抽一个私有辅助（放在 `// ---------------- internals ----------------` 之后）：

```java
    /** 扫本 store 目录读出全部 meta,按 filter 保留。目录不存在或坏行 → 跳过。不排序。 */
    private List<SessionMeta> readAllMetas(java.util.function.Predicate<SessionMeta> filter) {
        if (!Files.isDirectory(dir)) {
            return new ArrayList<>();
        }
        List<SessionMeta> metas = new ArrayList<>();
        try (Stream<Path> files = Files.list(dir)) {
            List<Path> jsonl = files
                    .filter(f -> {
                        String n = f.getFileName().toString();
                        return n.endsWith(".jsonl") && !n.endsWith(".cards.jsonl");
                    })
                    .collect(Collectors.toList());
            for (Path p : jsonl) {
                SessionMeta m = readMeta(p);
                if (m != null && filter.test(m)) {
                    metas.add(m);
                }
            }
        } catch (IOException e) {
            return metas;
        }
        return metas;
    }
```

`list(int limit)` 整体替换成（**两个过滤条件都在这里，语义并列**）：

```java
    public List<SessionMeta> list(int limit) {
        // 两类会话不进主对话列表,但都仍可按 id resume/peek:
        //   origin=automation —— 定时任务无头运行,只属于「运行历史」
        //   archivedAt != null —— 用户主动归档,收进「设置 › 归档」
        List<SessionMeta> metas = readAllMetas(m ->
                !ORIGIN_AUTOMATION.equals(m.origin()) && m.archivedAt() == null);
        metas.sort(Comparator.comparing(SessionMeta::updatedAt,
                Comparator.nullsFirst(Comparator.naturalOrder())).reversed());
        if (limit > 0 && metas.size() > limit) {
            return new ArrayList<>(metas.subList(0, limit));
        }
        return metas;
    }
```

确认 `import java.time.Instant;` 已在（`SessionStore` 已用它生成 `updatedAt`，若无则补）。

- [ ] **Step 5: 跑测试确认通过**

Run: `mvn test -Dtest=SessionArchiveTest -DskipTests=false`
Expected: PASS（9 个测试；含 Task 1 那条向后兼容用例）

Run: `mvn test -Dtest='SessionStoreTest,SessionStarNameTest,SessionStoreCardsTest,SessionStoreBeginTurnTest' -DskipTests=false`
Expected: PASS —— 抽 `readAllMetas` 是重构，既有会话测试必须零回归

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/session/SessionStore.java \
        src/test/java/com/lyhn/wraith/session/SessionArchiveTest.java
git commit -m "feat(session): 归档的读写 —— list() 的两个过滤条件写成并列语义

origin=automation 和 archivedAt!=null 都是「不进主列表但仍可按 id 读」,
所以抽 readAllMetas(predicate) 让两者并列,而不是把归档塞进原来那个
if 里当补丁。listArchived 复用同一个辅助,只换谓词和排序键。"
```

---

### Task 3: `ProjectSessionReader` —— 只读地看任意项目

面板要「不切项目就看别的项目有多少会话 / 最近哪些会话」，归档区要「跨项目列归档」。这些都不能碰活跃 store。独立成一个类而不是往 `SessionStore` 上加静态方法：`SessionStore` 是**有状态的活跃会话游标**（`currentId` / `starred` / `archivedAt` 内存态），而这里全是无状态只读查询，两种职责混在一个类里会让人误以为这些方法会动活跃会话。

**Files:**
- Create: `src/main/java/com/lyhn/wraith/session/ProjectSessionReader.java`
- Test: `src/test/java/com/lyhn/wraith/session/ProjectSessionReaderTest.java`

**Interfaces:**
- Consumes: Task 2 的 `SessionStore.list(int)` / `listArchived(int)` / `archiveAll()`；`SessionStore.open(Path, String, String, String)`（已有，纯拼路径无副作用）
- Produces:
  - `record ProjectSessionReader.Summary(String path, int sessionCount, String lastSessionAt)` —— `lastSessionAt` 是该项目最新**未归档**会话的 `updatedAt`；无会话时为 `null`
  - `static List<Summary> ProjectSessionReader.summaries(Path home, List<String> paths)` —— 顺序与入参一致
  - `static List<SessionMeta> ProjectSessionReader.recent(Path home, String path, int limit)`
  - `static List<SessionMeta> ProjectSessionReader.archived(Path home, List<String> paths, int limit)` —— 跨项目合并后按 `archivedAt` 倒序
  - `static int ProjectSessionReader.archiveAll(Path home, String path)`

- [ ] **Step 1: 写失败测试**

新建 `src/test/java/com/lyhn/wraith/session/ProjectSessionReaderTest.java`：

```java
package com.lyhn.wraith.session;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

class ProjectSessionReaderTest {

    /** 在指定项目下写 n 个会话,返回它们的 id(写入顺序)。 */
    private List<String> seed(Path home, String project, int n) {
        SessionStore store = SessionStore.open(home, project, "deepseek", "m1");
        List<String> ids = new java.util.ArrayList<>();
        for (int i = 0; i < n; i++) {
            store.startNew();
            store.persist(List.of(
                    LlmClient.Message.system("S"),
                    LlmClient.Message.user("消息 " + i)));
            ids.add(store.currentId());
        }
        return ids;
    }

    @Test
    void neverTouchedProjectYieldsZeroAndCreatesNoDirectory(@TempDir Path home) {
        List<ProjectSessionReader.Summary> out =
                ProjectSessionReader.summaries(home, List.of("/proj/never-used"));

        assertEquals(1, out.size());
        assertEquals("/proj/never-used", out.get(0).path());
        assertEquals(0, out.get(0).sessionCount());
        assertNull(out.get(0).lastSessionAt(), "无会话时 lastSessionAt 必须是 null,不是空串");
        assertFalse(Files.exists(home.resolve(".wraith").resolve("sessions")),
                "只读汇总不能在磁盘上建目录");
    }

    @Test
    void summariesKeepInputOrderAndCountPerProject(@TempDir Path home) {
        seed(home, "/proj/a", 3);
        seed(home, "/proj/b", 1);

        List<ProjectSessionReader.Summary> out =
                ProjectSessionReader.summaries(home, List.of("/proj/b", "/proj/a", "/proj/c"));

        assertEquals(List.of("/proj/b", "/proj/a", "/proj/c"),
                out.stream().map(ProjectSessionReader.Summary::path).toList());
        assertEquals(1, out.get(0).sessionCount());
        assertEquals(3, out.get(1).sessionCount());
        assertEquals(0, out.get(2).sessionCount());
        assertNotNull(out.get(1).lastSessionAt());
    }

    @Test
    void summaryExcludesArchivedFromCountAndTimestamp(@TempDir Path home) {
        List<String> ids = seed(home, "/proj/a", 2);
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.setArchived(ids.get(0), true);

        ProjectSessionReader.Summary s =
                ProjectSessionReader.summaries(home, List.of("/proj/a")).get(0);

        assertEquals(1, s.sessionCount(), "归档的不该算进项目会话数");
    }

    @Test
    void recentReadsAnotherProjectWithoutSwitching(@TempDir Path home) {
        seed(home, "/proj/a", 5);

        List<SessionMeta> recent = ProjectSessionReader.recent(home, "/proj/a", 3);

        assertEquals(3, recent.size(), "limit 生效");
        assertEquals("/proj/a", recent.get(0).cwd());
    }

    @Test
    void archivedMergesAcrossProjectsNewestFirst(@TempDir Path home) {
        List<String> a = seed(home, "/proj/a", 1);
        List<String> b = seed(home, "/proj/b", 1);
        SessionStore.open(home, "/proj/a", "p", "m").setArchived(a.get(0), true);
        SessionStore.open(home, "/proj/b", "p", "m").setArchived(b.get(0), true);

        List<SessionMeta> out =
                ProjectSessionReader.archived(home, List.of("/proj/a", "/proj/b"), 0);

        assertEquals(2, out.size());
        // b 后归档 → 倒序在前
        assertEquals("/proj/b", out.get(0).cwd());
        assertEquals("/proj/a", out.get(1).cwd());
    }

    @Test
    void archiveAllOnOneProjectLeavesOtherAlone(@TempDir Path home) {
        seed(home, "/proj/a", 2);
        seed(home, "/proj/b", 1);

        assertEquals(2, ProjectSessionReader.archiveAll(home, "/proj/a"));

        assertEquals(0, ProjectSessionReader.summaries(home, List.of("/proj/a")).get(0).sessionCount());
        assertEquals(1, ProjectSessionReader.summaries(home, List.of("/proj/b")).get(0).sessionCount());
    }
}
```

> 测试用到 `store.currentId()`。若 `SessionStore` 没有这个 public getter，先确认：`Main.java:1524` 的 `persistTurn()` 里已在调 `sessionStore.currentId()`，所以它是 public 的，直接用。

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -Dtest=ProjectSessionReaderTest -DskipTests=false`
Expected: 编译失败，`package ProjectSessionReader does not exist` / `cannot find symbol`

- [ ] **Step 3: 实现**

新建 `src/main/java/com/lyhn/wraith/session/ProjectSessionReader.java`：

```java
package com.lyhn.wraith.session;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 只读地查看**任意项目**的会话,不触碰活跃 {@link SessionStore}。
 *
 * <p>存在理由:会话按项目分目录({@code ~/.wraith/sessions/&lt;hash&gt;/}),而活跃 store 绑死在当前项目上。
 * 「项目面板展开看某项目的会话」「设置里跨项目列归档」这两件事都需要越过当前项目去读。
 *
 * <p>为什么不做成 {@code SessionStore} 的静态方法:{@code SessionStore} 是**有状态的活跃会话游标**
 * (持有 currentId / starred / archivedAt 内存态),这里全是无状态只读查询。混在一起会让调用方
 * 误以为这些方法会动活跃会话。
 *
 * <p>安全性:{@link SessionStore#open} 只拼路径不建目录,{@code list()} 在目录缺失时回空表。
 * 所以对「加进列表但从没跑过」的项目调用本类是安全的,不会在磁盘上留下空目录。
 */
public final class ProjectSessionReader {

    private ProjectSessionReader() {
    }

    /**
     * 一个项目的会话概况。
     *
     * @param path          项目绝对路径(与入参原样回传,便于前端对齐)
     * @param sessionCount  未归档会话数
     * @param lastSessionAt 最新未归档会话的 updatedAt(ISO-8601);无会话时 null
     */
    public record Summary(String path, int sessionCount, String lastSessionAt) {
    }

    /** 批量汇总。返回顺序与 paths 一致(前端按下标对齐,不做二次查找)。 */
    public static List<Summary> summaries(Path home, List<String> paths) {
        List<Summary> out = new ArrayList<>();
        if (paths == null) {
            return out;
        }
        for (String p : paths) {
            List<SessionMeta> metas = storeFor(home, p).list(0);
            // list() 已按 updatedAt 倒序,首条即最新
            String last = metas.isEmpty() ? null : metas.get(0).updatedAt();
            out.add(new Summary(p, metas.size(), last));
        }
        return out;
    }

    /** 某项目最近的未归档会话(最近在前)。limit&lt;=0 返回全部。 */
    public static List<SessionMeta> recent(Path home, String path, int limit) {
        return storeFor(home, path).list(limit);
    }

    /** 跨项目的已归档会话,合并后按 archivedAt 倒序。limit&lt;=0 返回全部。 */
    public static List<SessionMeta> archived(Path home, List<String> paths, int limit) {
        List<SessionMeta> all = new ArrayList<>();
        if (paths == null) {
            return all;
        }
        for (String p : paths) {
            all.addAll(storeFor(home, p).listArchived(0));
        }
        all.sort(Comparator.comparing(SessionMeta::archivedAt,
                Comparator.nullsFirst(Comparator.naturalOrder())).reversed());
        if (limit > 0 && all.size() > limit) {
            return new ArrayList<>(all.subList(0, limit));
        }
        return all;
    }

    /** 归档某项目下全部未归档会话,返回条数。 */
    public static int archiveAll(Path home, String path) {
        return storeFor(home, path).archiveAll();
    }

    /** 只读用的 store:provider/model 传空 —— 本类只读不写,这两个字段不会落盘。 */
    private static SessionStore storeFor(Path home, String path) {
        return SessionStore.open(home, path, "", "");
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -Dtest=ProjectSessionReaderTest -DskipTests=false`
Expected: PASS（6 个测试）

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/session/ProjectSessionReader.java \
        src/test/java/com/lyhn/wraith/session/ProjectSessionReaderTest.java
git commit -m "feat(session): ProjectSessionReader —— 只读地看任意项目,不碰活跃 store

会话按项目分目录,活跃 store 绑死在当前项目上,所以「不切项目就看别的项目
有几个会话」必须越过它去读。没做成 SessionStore 的静态方法:那个类是有状态的
活跃会话游标,混进无状态只读查询会让人误以为这些方法会动活跃会话。

关键断言:对从没跑过的项目调用不能在磁盘上建目录(SessionStore.open 只拼路径)。"
```

---

### Task 4: AppServer 五条新 RPC + `session.delete` 扩参

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerArchiveRpcTest.java`（新建）

**Interfaces:**
- Consumes: Task 3 的 `ProjectSessionReader.Summary`；Task 2 的 `SessionStore` 方法
- Produces（`SessionRunner` 的新 default 方法，Task 5 在 `Main.java` 里实现它们）：
  - `default List<Map<String, Object>> projectSummary(List<String> paths) { return List.of(); }` —— 每项 `{path, sessionCount, lastSessionAt}`
  - `default List<SessionMeta> listSessionsForProject(String path, int limit) { return List.of(); }`
  - `default boolean setSessionArchived(String sessionId, boolean archived, String path) { return false; }` —— `path` 为 null/空 → 活跃 store
  - `default List<SessionMeta> listArchivedSessions(List<String> paths, int limit) { return List.of(); }`
  - `default int archiveProjectSessions(String path) { return 0; }`
  - `default boolean deleteSession(String id, String path) { return deleteSession(id); }` —— **重载**，`path` 为 null/空 → 沿用旧单参行为
- Produces（JSON-RPC 方法名，Task 7 在 preload 里转发）：
  - `session.projectSummary` `{ paths: string[] }` → `{ summaries: [{path, sessionCount, lastSessionAt}] }`
  - `session.listForProject` `{ path, limit? }` → `{ sessions: SessionMeta[] }`
  - `session.setArchived` `{ sessionId, archived, path? }` → `{ ok: true }`
  - `session.listArchived` `{ paths: string[], limit? }` → `{ sessions: SessionMeta[] }`
  - `session.archiveProject` `{ path }` → `{ archived: number }`
  - `session.delete` `{ sessionId, path? }` → `{ ok: true }`（幂等，沿用现有语义）

- [ ] **Step 1: 写失败测试**

新建 `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerArchiveRpcTest.java`。照 `AppServerSessionTest` 的形状搭一个假 `SessionRunner`，断言**参数解析与错误码**（真实的存储行为已在 Task 2/3 覆盖，这里只测 RPC 层）：

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.session.SessionMeta;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AppServerArchiveRpcTest {

    /** 记录被调到的参数,供断言。 */
    private static final class Spy {
        List<String> summaryPaths;
        String listPath;
        int listLimit = -999;
        String archivedId;
        Boolean archivedFlag;
        String archivedPath = "<unset>";
        String deletedId;
        String deletedPath = "<unset>";
        String archiveProjectPath;
    }

    /**
     * AppServer 吃的是 SessionRunnerFactory 而不是裸 SessionRunner。
     * renderer() 必须回真的 EventStreamRenderer —— 回 null 会让 session.start 就崩。
     */
    private static AppServer.SessionRunnerFactory factory(Spy spy) {
        return (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() {
                return r;
            }

            public String runTurn(String input) {
                return "";
            }

            public List<Map<String, Object>> projectSummary(List<String> paths) {
                spy.summaryPaths = paths;
                List<Map<String, Object>> out = new ArrayList<>();
                for (int i = 0; i < paths.size(); i++) {
                    // 第二项刻意给 null lastSessionAt(= 项目没会话):
                    // 前端 mergeSummaries 读这个键,所以序列化必须留 "lastSessionAt":null
                    // 而不是把键整个丢掉。Map.of 不吃 null → 只能 LinkedHashMap。
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("path", paths.get(i));
                    m.put("sessionCount", i == 1 ? 0 : 2);
                    m.put("lastSessionAt", i == 1 ? null : "2026-08-05T10:00:00Z");
                    out.add(m);
                }
                return out;
            }

            public List<SessionMeta> listSessionsForProject(String path, int limit) {
                spy.listPath = path;
                spy.listLimit = limit;
                return List.of(new SessionMeta("s1", path, "c", "u", "prov", "mod", "t", 1, false, null, null, null));
            }

            public boolean setSessionArchived(String sessionId, boolean archived, String path) {
                spy.archivedId = sessionId;
                spy.archivedFlag = archived;
                spy.archivedPath = path;
                return true;
            }

            public List<SessionMeta> listArchivedSessions(List<String> paths, int limit) {
                return List.of(new SessionMeta("a1", "/p", "c", "u", "prov", "mod", "t", 1, false, null, null,
                        "2026-08-05T09:00:00Z"));
            }

            public int archiveProjectSessions(String path) {
                spy.archiveProjectPath = path;
                return 3;
            }

            public boolean deleteSession(String id, String path) {
                spy.deletedId = id;
                spy.deletedPath = path;
                return true;
            }
            };
        };
    }

    /**
     * 起一个 in-process AppServer,发 session.start → 目标方法 → shutdown,回目标方法的 result 节点。
     * 形状抄 AppServerSessionTest.sessionListSerializesMetas(:40) —— 那里已经这么驱动了。
     */
    private static JsonNode call(AppServer.SessionRunnerFactory f, String method, String paramsJson)
            throws Exception {
        return drive(f, method, paramsJson, "result");
    }

    /** 同上,但回 error 节点(断言错误码用)。 */
    private static JsonNode callExpectError(AppServer.SessionRunnerFactory f, String method, String paramsJson)
            throws Exception {
        return drive(f, method, paramsJson, "error");
    }

    private static JsonNode drive(AppServer.SessionRunnerFactory f, String method, String paramsJson,
                                  String field) throws Exception {
        String in = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"" + method + "\",\"params\":" + paramsJson + "}",
                "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, f).serve();
        String raw = out.toString(StandardCharsets.UTF_8);
        for (String ln : raw.split("\n")) {
            if (ln.isBlank()) continue;
            JsonNode n = JsonRpc.MAPPER.readTree(ln);
            if (n.path("id").asInt(-1) == 2 && n.has(field)) {
                return n.get(field);
            }
        }
        throw new AssertionError("没等到 id=2 的 " + field + ",原始输出:\n" + raw);
    }
```

断言部分（返回值是 `JsonNode`，所以取值一律走 `.asInt()` / `.asText()` / `.asBoolean()` / `.has()`；每个方法都要 `throws Exception`，因为 `drive` 会抛）：

```java
    @Test
    void projectSummaryPassesPathsThrough() throws Exception {
        Spy spy = new Spy();
        JsonNode result = call(factory(spy), "session.projectSummary",
                "{\"paths\":[\"/a\",\"/b\"]}");

        assertEquals(List.of("/a", "/b"), spy.summaryPaths);
        assertTrue(result.has("summaries"));
        assertEquals(2, result.get("summaries").size());
        // 无会话的项目:lastSessionAt 这个键必须在、值是 null。丢键会让前端
        // mergeSummaries 读到 undefined 而不是 null,两者在 TS 里不是一回事。
        JsonNode second = result.get("summaries").get(1);
        assertTrue(second.has("lastSessionAt"), "键不能被丢掉");
        assertTrue(second.get("lastSessionAt").isNull());
        assertEquals(0, second.get("sessionCount").asInt());
    }

    @Test
    void projectSummaryMissingPathsIsInvalidParams() throws Exception {
        JsonNode err = callExpectError(factory(new Spy()), "session.projectSummary", "{}");
        assertEquals(-32602, err.get("code").asInt());
    }

    @Test
    void projectSummaryEmptyArrayIsLegal() throws Exception {
        // 空数组是合法输入(没有项目),不该退化成 -32602
        Spy spy = new Spy();
        JsonNode result = call(factory(spy), "session.projectSummary", "{\"paths\":[]}");
        assertEquals(List.of(), spy.summaryPaths);
        assertEquals(0, result.get("summaries").size());
    }

    @Test
    void listForProjectDefaultsLimitToFifty() throws Exception {
        Spy spy = new Spy();
        call(factory(spy), "session.listForProject", "{\"path\":\"/a\"}");
        assertEquals("/a", spy.listPath);
        assertEquals(50, spy.listLimit, "limit 缺省要有明确默认值,不能传 0 变成「全部」");
    }

    @Test
    void listForProjectMissingPathIsInvalidParams() throws Exception {
        JsonNode err = callExpectError(factory(new Spy()), "session.listForProject", "{}");
        assertEquals(-32602, err.get("code").asInt());
    }

    @Test
    void setArchivedWithoutPathPassesNull() throws Exception {
        Spy spy = new Spy();
        call(factory(spy), "session.setArchived", "{\"sessionId\":\"s1\",\"archived\":true}");
        assertEquals("s1", spy.archivedId);
        assertEquals(Boolean.TRUE, spy.archivedFlag);
        // Spy 的初值是 "<unset>",所以 assertNull 同时排除了「压根没被调到」
        assertNull(spy.archivedPath, "不给 path 必须传 null,让实现走活跃 store");
    }

    @Test
    void setArchivedWithPathPassesIt() throws Exception {
        Spy spy = new Spy();
        call(factory(spy), "session.setArchived",
                "{\"sessionId\":\"s1\",\"archived\":false,\"path\":\"/other\"}");
        assertEquals("/other", spy.archivedPath);
        assertEquals(Boolean.FALSE, spy.archivedFlag);
    }

    @Test
    void setArchivedMissingSessionIdIsInvalidParams() throws Exception {
        JsonNode err = callExpectError(factory(new Spy()), "session.setArchived",
                "{\"archived\":true}");
        assertEquals(-32602, err.get("code").asInt());
    }

    @Test
    void deleteWithPathPassesIt() throws Exception {
        Spy spy = new Spy();
        call(factory(spy), "session.delete", "{\"sessionId\":\"s1\",\"path\":\"/other\"}");
        assertEquals("s1", spy.deletedId);
        assertEquals("/other", spy.deletedPath);
    }

    @Test
    void deleteWithoutPathStaysBackwardCompatible() throws Exception {
        Spy spy = new Spy();
        JsonNode result = call(factory(spy), "session.delete", "{\"sessionId\":\"s1\"}");
        assertNull(spy.deletedPath, "旧调用方不传 path,必须收到 null");
        assertTrue(result.get("ok").asBoolean());
    }

    @Test
    void archiveProjectReturnsCount() throws Exception {
        Spy spy = new Spy();
        JsonNode result = call(factory(spy), "session.archiveProject", "{\"path\":\"/a\"}");
        assertEquals("/a", spy.archiveProjectPath);
        assertEquals(3, result.get("archived").asInt());
    }

    @Test
    void archiveProjectMissingPathIsInvalidParams() throws Exception {
        JsonNode err = callExpectError(factory(new Spy()), "session.archiveProject", "{}");
        assertEquals(-32602, err.get("code").asInt());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -Dtest=AppServerArchiveRpcTest -DskipTests=false`
Expected: 编译失败（`SessionRunner` 上没有这些方法）

- [ ] **Step 3: 给 `SessionRunner` 加方法**

`AppServer.java` 的 `SessionRunner` 接口内，`deleteSession` 附近（约 `:62`）：

```java
        default boolean deleteSession(String sessionId) { return false; }
        /**
         * 删会话的带项目重载。path 为 null/空 → 活跃项目(等价旧单参版本)。
         * 「设置 › 归档」是跨项目列表,删别的项目的归档会话必须走这个重载 ——
         * 否则跑在活跃 store 上找不到文件,静默失败。
         */
        default boolean deleteSession(String sessionId, String path) { return deleteSession(sessionId); }
        /** 批量项目概况:每项 {path, sessionCount, lastSessionAt}。默认空。 */
        default java.util.List<java.util.Map<String, Object>> projectSummary(java.util.List<String> paths) {
            return java.util.List.of();
        }
        /** 指定项目的最近未归档会话(只读,不切活跃项目)。默认空。 */
        default java.util.List<com.lyhn.wraith.session.SessionMeta> listSessionsForProject(String path, int limit) {
            return java.util.List.of();
        }
        /** 加/去归档。path 为 null/空 → 活跃项目。默认 false。 */
        default boolean setSessionArchived(String sessionId, boolean archived, String path) { return false; }
        /** 跨项目已归档会话(按归档时间倒序)。默认空。 */
        default java.util.List<com.lyhn.wraith.session.SessionMeta> listArchivedSessions(
                java.util.List<String> paths, int limit) {
            return java.util.List.of();
        }
        /** 归档某项目下全部未归档会话,返回条数。默认 0。 */
        default int archiveProjectSessions(String path) { return 0; }
```

- [ ] **Step 4: 加五条 `case` 与 handler**

`AppServer.handle` 的 switch 里，`case "session.delete"`（`:447`）之后插入：

```java
            case "session.projectSummary" -> handleProjectSummary(msg);
            case "session.listForProject" -> handleListForProject(msg);
            case "session.setArchived" -> handleSessionSetArchived(msg);
            case "session.listArchived" -> handleListArchived(msg);
            case "session.archiveProject" -> handleArchiveProject(msg);
```

在 `handleSessionDelete`（`:1528`）之后插入五个 handler，并改 `handleSessionDelete` 读可选 `path`：

```java
    private void handleSessionDelete(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String id = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (id.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        // path 可选:给了就删那个项目的,没给就删活跃项目的(旧调用方零改动)
        session.deleteSession(id, textParam(p, "path"));   // 幂等:文件不存在也算删成功
        writer.result(msg.id(), Map.of("ok", true));
    }

    private void handleProjectSummary(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        List<String> paths = stringArrayParam(msg.params(), "paths");
        if (paths == null) { writer.error(msg.id(), -32602, "missing paths"); return; }
        writer.result(msg.id(), Map.of("summaries", session.projectSummary(paths)));
    }

    private void handleListForProject(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String path = textParam(p, "path");
        if (path == null) { writer.error(msg.id(), -32602, "missing path"); return; }
        int limit = (p != null && p.hasNonNull("limit")) ? p.get("limit").asInt(50) : 50;
        writer.result(msg.id(), Map.of("sessions", session.listSessionsForProject(path, limit)));
    }

    private void handleSessionSetArchived(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String id = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (id.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        boolean archived = p.path("archived").asBoolean(false);
        // 与 setStarred 同样的幂等不对称:目标会话不存在 = 操作无法施加 → -32000(不是 ok)
        if (!session.setSessionArchived(id, archived, textParam(p, "path"))) {
            writer.error(msg.id(), -32000, "setArchived failed"); return;
        }
        writer.result(msg.id(), Map.of("ok", true));
    }

    private void handleListArchived(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        List<String> paths = stringArrayParam(p, "paths");
        if (paths == null) { writer.error(msg.id(), -32602, "missing paths"); return; }
        int limit = (p != null && p.hasNonNull("limit")) ? p.get("limit").asInt(0) : 0;
        writer.result(msg.id(), Map.of("sessions", session.listArchivedSessions(paths, limit)));
    }

    private void handleArchiveProject(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        String path = textParam(msg.params(), "path");
        if (path == null) { writer.error(msg.id(), -32602, "missing path"); return; }
        writer.result(msg.id(), Map.of("archived", session.archiveProjectSessions(path)));
    }

    /** 读一个字符串数组参数。字段缺失/不是数组 → null(调用方回 -32602);空数组是合法的。 */
    private static List<String> stringArrayParam(JsonNode p, String field) {
        if (p == null || !p.has(field) || !p.get(field).isArray()) {
            return null;
        }
        List<String> out = new ArrayList<>();
        p.get(field).forEach(n -> {
            String s = n.asText();
            if (s != null && !s.isBlank()) {
                out.add(s);
            }
        });
        return out;
    }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `mvn test -Dtest=AppServerArchiveRpcTest -DskipTests=false`
Expected: PASS（12 个测试）

Run: `mvn test -Dtest=AppServerSessionTest -DskipTests=false`
Expected: PASS —— `session.delete` 扩参必须向后兼容

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerArchiveRpcTest.java
git commit -m "feat(appserver): 项目概况/跨项目会话/归档 五条 RPC + session.delete 扩可选 path

session.delete 加 path 是为了堵一个编译和类型都拦不住的洞:设置里的归档列表是
跨项目的,而 deleteSession 跑在活跃项目的 store 上,忘传 path 就静默失败
(前端已乐观移除那一行,刷新后它又回来)。path 可选 → 旧调用方零改动。

setArchived 沿用 setStarred 的幂等不对称:目标不存在回 -32000 而不是 ok,
因为「操作无法施加」和「删掉的东西没了」不是一回事。"
```

---

### Task 5: `Main.java` 接线（app-server 侧）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`（app-server 匿名 `SessionRunner`，`:1484`–`:1660` 区间）

**Interfaces:**
- Consumes: Task 3 的 `ProjectSessionReader`；Task 4 的 `SessionRunner` 新方法签名
- Produces: 上述 RPC 端到端可用。后续渲染层 task 直接调 preload 即可。

- [ ] **Step 1: 先确认热文件没有别人的未提交改动**

Run: `git diff --stat src/main/java/com/lyhn/wraith/cli/Main.java`
Expected: 只有本计划 Task 1 已提交的内容，工作区里应只剩 `/archive` 的 `SlashCommandHint`（`:3429`，来自未提交的解析层）。**若出现别的改动，停下来问。**

- [ ] **Step 2: 在匿名实现里接上六个方法**

`Main.java` 的 `deleteSession`（`:1657`）之后插入。`home` 用与 `:1396` 同一个表达式，抽成局部常量避免重复：

```java
                    public boolean deleteSession(String id) {
                        return sessionStore.deleteById(id);
                    }
                    public boolean deleteSession(String id, String path) {
                        if (path == null || path.isBlank()) return sessionStore.deleteById(id);
                        return com.lyhn.wraith.session.SessionStore
                                .open(userHome(), path, "", "").deleteById(id);
                    }
                    public java.util.List<java.util.Map<String, Object>> projectSummary(java.util.List<String> paths) {
                        java.util.List<java.util.Map<String, Object>> out = new java.util.ArrayList<>();
                        for (com.lyhn.wraith.session.ProjectSessionReader.Summary s
                                : com.lyhn.wraith.session.ProjectSessionReader.summaries(userHome(), paths)) {
                            // lastSessionAt 可能为 null(无会话),Map.of 不吃 null → 用 HashMap
                            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                            m.put("path", s.path());
                            m.put("sessionCount", s.sessionCount());
                            m.put("lastSessionAt", s.lastSessionAt());
                            out.add(m);
                        }
                        return out;
                    }
                    public java.util.List<com.lyhn.wraith.session.SessionMeta> listSessionsForProject(String path, int limit) {
                        return com.lyhn.wraith.session.ProjectSessionReader.recent(userHome(), path, limit);
                    }
                    public boolean setSessionArchived(String id, boolean archived, String path) {
                        if (path == null || path.isBlank()) return sessionStore.setArchived(id, archived);
                        return com.lyhn.wraith.session.SessionStore
                                .open(userHome(), path, "", "").setArchived(id, archived);
                    }
                    public java.util.List<com.lyhn.wraith.session.SessionMeta> listArchivedSessions(
                            java.util.List<String> paths, int limit) {
                        return com.lyhn.wraith.session.ProjectSessionReader.archived(userHome(), paths, limit);
                    }
                    public int archiveProjectSessions(String path) {
                        return com.lyhn.wraith.session.ProjectSessionReader.archiveAll(userHome(), path);
                    }
```

`userHome()` 加成 `Main` 的私有静态方法（放在 `Main` 类的其他私有静态辅助旁边）：

```java
    /** 用户 home。会话与归档存储的根,与 SessionStore.open 的第一参一致。 */
    private static java.nio.file.Path userHome() {
        return java.nio.file.Path.of(System.getProperty("user.home"));
    }
```

并把 `:1396` 那处 `java.nio.file.Path.of(System.getProperty("user.home"))` 换成 `userHome()`，消掉重复。

> **踩坑提醒**：`Map.of()` 不接受 null 值，而 `lastSessionAt` 在项目无会话时就是 null。上面用 `LinkedHashMap` 就是为这个。若图省事写 `Map.of("lastSessionAt", s.lastSessionAt())`，无会话的项目会让整条 RPC 抛 NPE。

- [ ] **Step 3: 编译并跑全量回归**

Run: `mvn -q compile`
Expected: 成功

Run: `mvn test -DskipTests=false 2>&1 | tail -20`
Expected: 通过数 ≥ 1655，失败/错误 0

- [ ] **Step 4: 端到端手验（app-server stdio NDJSON）**

REPL 不吃管道，无 UI 验证只能驱动 app-server。先打包：

```bash
mvn -q clean package
```

然后一行行发（`initialize` → `session.start` → 目标方法）：

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
 '{"jsonrpc":"2.0","id":2,"method":"session.start","params":{"workspace":"'"$PWD"'"}}' \
 '{"jsonrpc":"2.0","id":3,"method":"session.projectSummary","params":{"paths":["'"$PWD"'","/nope"]}}' \
 '{"jsonrpc":"2.0","id":4,"method":"session.listForProject","params":{"path":"'"$PWD"'","limit":3}}' \
 '{"jsonrpc":"2.0","id":5,"method":"session.listArchived","params":{"paths":["'"$PWD"'"]}}' \
 | java -jar target/wraith-1.0-SNAPSHOT.jar app-server 2>/dev/null | grep -E '"id":[345]'
```

Expected：
- `id:3` 回 `summaries` 两项，第二项 `sessionCount:0`、`lastSessionAt:null`
- `id:4` 回 `sessions` 数组（本仓库跑过就非空）
- `id:5` 回 `sessions: []`

若 `app-server` 不是这个子命令名，先 `java -jar target/wraith-1.0-SNAPSHOT.jar --help` 确认。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/cli/Main.java
git commit -m "feat(appserver): 接上五条新 RPC —— lastSessionAt 会是 null,所以不能用 Map.of

Map.of 不吃 null 值,而项目无会话时 lastSessionAt 就是 null。图省事写 Map.of
会让「加进列表但从没跑过」的项目把整条 projectSummary 打成 NPE。用 LinkedHashMap。

顺手把重复的 Path.of(System.getProperty(\"user.home\")) 收成 userHome()。"
```

---

## Phase B — 渲染层地基

### Task 6: `ProjectEntry.starred` + `setProjectStarred`

**Files:**
- Modify: `desktop/src/main/settings.ts:14`（`ProjectEntry`）、`:143` 附近（新函数）、`:189`（`seedProjectsFromJson` 的 normalize）
- Modify: `desktop/src/shared/types.ts:173`（`ProjectView`）
- Test: `desktop/test/projectStarred.test.ts`（新建）

**Interfaces:**
- Consumes: 无
- Produces:
  - `ProjectEntry { path: string; name?: string; lastUsedAt: number; starred?: boolean }`
  - `ProjectView { path: string; name?: string; lastUsedAt: number; exists: boolean; starred?: boolean }`
  - `setProjectStarred(userDataDir: string, projectPath: string, starred: boolean): void` —— `starred === false` 时**删掉这个键**而不是写 `false`（与 `renameProject` 对空名的处理一致，settings.json 不留噪声）

- [ ] **Step 1: 写失败测试**

新建 `desktop/test/projectStarred.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readSettings, writeSettings, setProjectStarred, projectViews } from '../src/main/settings'

let ud: string

beforeEach(() => {
  ud = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-settings-'))
})

afterEach(() => {
  fs.rmSync(ud, { recursive: true, force: true })
})

describe('setProjectStarred', () => {
  it('把指定项目标为重点', () => {
    writeSettings(ud, { projects: [{ path: '/a', lastUsedAt: 1 }, { path: '/b', lastUsedAt: 2 }] })

    setProjectStarred(ud, '/a', true)

    const projects = readSettings(ud).projects ?? []
    expect(projects.find(p => p.path === '/a')?.starred).toBe(true)
    expect(projects.find(p => p.path === '/b')?.starred).toBeUndefined()
  })

  it('取消重点时删掉这个键,不写 false', () => {
    writeSettings(ud, { projects: [{ path: '/a', lastUsedAt: 1, starred: true }] })

    setProjectStarred(ud, '/a', false)

    const entry = (readSettings(ud).projects ?? [])[0]!
    expect('starred' in entry).toBe(false)
  })

  it('路径不匹配时不改任何条目', () => {
    writeSettings(ud, { projects: [{ path: '/a', lastUsedAt: 1 }] })

    setProjectStarred(ud, '/nope', true)

    expect((readSettings(ud).projects ?? [])[0]?.starred).toBeUndefined()
  })

  it('projectViews 带出 starred', () => {
    writeSettings(ud, { projects: [{ path: ud, lastUsedAt: 1, starred: true }] })

    const views = projectViews(ud)

    expect(views[0]?.starred).toBe(true)
    expect(views[0]?.exists).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/projectStarred.test.ts`
Expected: FAIL —— `setProjectStarred is not a function`

- [ ] **Step 3: 加字段**

`desktop/src/main/settings.ts:14`：

```ts
export interface ProjectEntry {
  path: string        // 绝对路径,唯一键(去重依据)
  name?: string       // 显示别名;缺省 UI 用目录名
  lastUsedAt: number  // epoch ms,最近使用排序
  starred?: boolean   // 用户标记的重点项目;面板与快切下拉都置顶。false 不落盘,只删键
}
```

`desktop/src/shared/types.ts:173`：

```ts
/** 项目条目视图(main → renderer):settings.ProjectEntry + 目录存在性。 */
export interface ProjectView {
  path: string
  name?: string
  lastUsedAt: number
  exists: boolean
  starred?: boolean
}
```

- [ ] **Step 4: 加 `setProjectStarred`**

`settings.ts`，`renameProject`（`:143`–`:155`）之后插入 —— 形状照抄 `renameProject`，包括「清除时删键」这个细节：

```ts
/** 标记/取消重点项目。starred=false 时删掉这个键(与 renameProject 对空名的处理一致)。 */
export function setProjectStarred(userDataDir: string, projectPath: string, starred: boolean): void {
  const s = readSettings(userDataDir)
  const projects = (s.projects ?? []).map(p => {
    if (p.path !== projectPath) return p
    if (!starred) {
      const { starred: _drop, ...restEntry } = p
      return restEntry
    }
    return { ...p, starred: true }
  })
  writeSettings(userDataDir, { ...s, projects })
}
```

`seedProjectsFromJson` 的 normalize（`:191`–`:195`）补一行，让外部注入的 JSON 也能带 starred：

```ts
    .map((p, i) => ({
      path: p['path'] as string,
      ...(typeof p['name'] === 'string' && p['name'] ? { name: p['name'] as string } : {}),
      ...(p['starred'] === true ? { starred: true as const } : {}),
      lastUsedAt: typeof p['lastUsedAt'] === 'number' ? (p['lastUsedAt'] as number) : now - i,
    }))
```

`projectViews`（`:158`）不用改 —— 它是 `{ ...p, exists }` 展开，`starred` 自动带出。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/projectStarred.test.ts`
Expected: PASS（4 个）

Run: `cd desktop && npm run typecheck`
Expected: 0 错误

- [ ] **Step 6: 提交**

```bash
git add desktop/src/main/settings.ts desktop/src/shared/types.ts desktop/test/projectStarred.test.ts
git commit -m "feat(desktop): 重点项目落 settings —— 取消时删键而不是写 false

照 renameProject 对空名的处理:settings.json 里不留 starred:false 这种噪声,
否则一个从没标过重点的项目和一个标了又取消的项目在文件里长得不一样。"
```

---

### Task 7: IPC 与 preload 转发

**Files:**
- Modify: `desktop/src/main/index.ts`（`:892` 之后加一条 settings IPC；`:896` 之前加五条 RPC 转发）
- Modify: `desktop/src/preload/index.ts`（接口声明 `:39` 附近 + 实现 `:287` 附近）
- Modify: `desktop/src/shared/types.ts`（`SessionMeta.archivedAt`、新 `ProjectSummary`）

**Interfaces:**
- Consumes: Task 4 的 JSON-RPC 方法名与出参形状；Task 6 的 `setProjectStarred`
- Produces（渲染层可用的 `window.wraith` 方法，后续所有 UI task 只用这些）：
  - `setProjectStarred(path: string, starred: boolean): Promise<void>`
  - `projectSummary(paths: string[]): Promise<{ summaries: ProjectSummary[] }>`
  - `listSessionsForProject(path: string, limit?: number): Promise<{ sessions: SessionMeta[] }>`
  - `setSessionArchived(sessionId: string, archived: boolean, path?: string): Promise<{ ok: boolean }>`
  - `listArchivedSessions(paths: string[], limit?: number): Promise<{ sessions: SessionMeta[] }>`
  - `archiveProjectSessions(path: string): Promise<{ archived: number }>`
  - `deleteSession(sessionId: string, path?: string)` —— **既有方法加第二个可选参数**
- Produces（类型）：
  - `ProjectSummary { path: string; sessionCount: number; lastSessionAt: string | null }`
  - `SessionMeta.archivedAt?: string | null`

- [ ] **Step 1: 加类型**

`desktop/src/shared/types.ts`，`SessionMeta`（`:123`）加一个字段：

```ts
export interface SessionMeta {
  id: string
  cwd: string
  createdAt: string
  updatedAt: string
  provider: string
  model: string
  title: string
  turns: number           // count of user turns
  starred?: boolean        // 用户标记的重点会话
  name?: string            // 用户自定义名;显示优先于 title
  archivedAt?: string | null  // 归档时间(ISO-8601);null/缺省=未归档。归档的不进侧栏列表
}
```

`ProjectView`（`:178`）之后加：

```ts
/** 一个项目的会话概况(session.projectSummary 回传)。 */
export interface ProjectSummary {
  path: string
  sessionCount: number
  /** 最新未归档会话的 updatedAt;无会话时 null */
  lastSessionAt: string | null
}
```

- [ ] **Step 2: 加主进程 IPC**

`desktop/src/main/index.ts`，`wraith:renameProject`（`:892`）之后：

```ts
ipcMain.handle('wraith:setProjectStarred', async (_e, projectPath: string, starred: boolean) => {
  setProjectStarred(app.getPath('userData'), projectPath, starred)
})

ipcMain.handle('wraith:projectSummary', async (_e, paths: string[]) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.projectSummary', { paths })
})

ipcMain.handle('wraith:listSessionsForProject', async (_e, path: string, limit?: number) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.listForProject', { path, ...(limit === undefined ? {} : { limit }) })
})

ipcMain.handle('wraith:setSessionArchived', async (_e, sessionId: string, archived: boolean, path?: string) => {
  if (!client) throw new Error('Backend not connected')
  // path 只在跨项目操作(设置 › 归档)时给;不给 → 后端走活跃项目
  return client.request('session.setArchived', { sessionId, archived, ...(path ? { path } : {}) })
})

ipcMain.handle('wraith:listArchivedSessions', async (_e, paths: string[], limit?: number) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.listArchived', { paths, ...(limit === undefined ? {} : { limit }) })
})

ipcMain.handle('wraith:archiveProjectSessions', async (_e, path: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.archiveProject', { path })
})
```

`index.ts:16` 的 `from './settings'` import 列表里加 `setProjectStarred`。

`wraith:deleteSession` 那条现有 handler 加第二参转发（先 `grep -n "wraith:deleteSession" desktop/src/main/index.ts` 找到它）：

```ts
ipcMain.handle('wraith:deleteSession', async (_e, sessionId: string, path?: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.delete', { sessionId, ...(path ? { path } : {}) })
})
```

- [ ] **Step 3: 加 preload 声明与实现**

`desktop/src/preload/index.ts`，接口里 `renameProject`（`:39`）之后：

```ts
  setProjectStarred(path: string, starred: boolean): Promise<void>
  projectSummary(paths: string[]): Promise<{ summaries: ProjectSummary[] }>
  listSessionsForProject(path: string, limit?: number): Promise<{ sessions: SessionMeta[] }>
  setSessionArchived(sessionId: string, archived: boolean, path?: string): Promise<{ ok: boolean }>
  listArchivedSessions(paths: string[], limit?: number): Promise<{ sessions: SessionMeta[] }>
  archiveProjectSessions(path: string): Promise<{ archived: number }>
```

`:2` 的 `import type { ... }` 列表里加 `ProjectSummary`。

现有 `deleteSession` 的声明加第二参（先 `grep -n "deleteSession" desktop/src/preload/index.ts`）：

```ts
  deleteSession(sessionId: string, path?: string): Promise<{ ok: boolean }>
```

实现部分，`renameProject`（`:285`）之后：

```ts
  setProjectStarred(path, starred) {
    return ipcRenderer.invoke('wraith:setProjectStarred', path, starred) as Promise<void>
  },

  projectSummary(paths) {
    return ipcRenderer.invoke('wraith:projectSummary', paths) as Promise<{ summaries: ProjectSummary[] }>
  },

  listSessionsForProject(path, limit) {
    return ipcRenderer.invoke('wraith:listSessionsForProject', path, limit) as Promise<{ sessions: SessionMeta[] }>
  },

  setSessionArchived(sessionId, archived, path) {
    return ipcRenderer.invoke('wraith:setSessionArchived', sessionId, archived, path) as Promise<{ ok: boolean }>
  },

  listArchivedSessions(paths, limit) {
    return ipcRenderer.invoke('wraith:listArchivedSessions', paths, limit) as Promise<{ sessions: SessionMeta[] }>
  },

  archiveProjectSessions(path) {
    return ipcRenderer.invoke('wraith:archiveProjectSessions', path) as Promise<{ archived: number }>
  },
```

现有 `deleteSession` 实现加第二参转发。

- [ ] **Step 4: typecheck**

Run: `cd desktop && npm run typecheck`
Expected: 0 错误

Run: `cd desktop && npm test 2>&1 | tail -10`
Expected: ≥ 1022 通过（加字段不该弄坏既有测试）

- [ ] **Step 5: 手验 preload 真通了**

> **必须整个重启 App** —— preload 不热重载，不重启会看到 `window.wraith.projectSummary is not a function`，那是陈旧进程不是代码 bug。

```bash
mvn -q clean package && cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar
cd desktop && npm run dev
```

App 起来后在 DevTools Console 里跑：

```js
await window.wraith.projectSummary([(await window.wraith.listProjects()).projects[0].path])
```

Expected: 回 `{ summaries: [{ path, sessionCount, lastSessionAt }] }`

- [ ] **Step 6: 提交**

```bash
git add desktop/src/main/index.ts desktop/src/preload/index.ts desktop/src/shared/types.ts
git commit -m "feat(desktop): 六条新 IPC + deleteSession 加可选 path

path 只在跨项目操作(设置 › 归档)时传;不传 → 后端走活跃项目。主进程这一层
用 ...(path ? { path } : {}) 而不是无条件带上,免得给后端塞一个 undefined
让它把 textParam 读成空串。"
```

---

### Task 8: `projectsView.ts` 纯函数

面板的全部逻辑（搜索、双列排序、重点分区、短相对时间）都在这里，组件只渲染。这样测试不依赖 DOM。

**Files:**
- Create: `desktop/src/renderer/lib/projectsView.ts`
- Test: `desktop/test/projectsView.test.ts`

**Interfaces:**
- Consumes: Task 6/7 的 `ProjectView`、`ProjectSummary`
- Produces:
  - `type ProjectSortKey = 'name' | 'updated'`
  - `type SortDir = 'asc' | 'desc'`
  - `interface ProjectRowData { view: ProjectView; displayName: string; sessionCount: number | null; lastSessionAt: string | null }` —— `sessionCount: null` = 概况还没回来（渲染骨架）
  - `mergeSummaries(projects: ProjectView[], summaries: ProjectSummary[]): ProjectRowData[]`
  - `filterProjects(rows: ProjectRowData[], query: string): ProjectRowData[]`
  - `sortProjects(rows: ProjectRowData[], key: ProjectSortKey, dir: SortDir): ProjectRowData[]`
  - `partitionStarredProjects(rows: ProjectRowData[]): { starred: ProjectRowData[]; rest: ProjectRowData[] }`
  - `shortRelativeTime(iso: string | null, now: number): string` —— `null` → `'—'`

- [ ] **Step 1: 写失败测试**

新建 `desktop/test/projectsView.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  mergeSummaries, filterProjects, sortProjects, partitionStarredProjects, shortRelativeTime,
  type ProjectRowData,
} from '../src/renderer/lib/projectsView'
import type { ProjectView, ProjectSummary } from '../src/shared/types'

function pv(over: Partial<ProjectView> = {}): ProjectView {
  return { path: '/home/me/wraith', lastUsedAt: 1000, exists: true, ...over }
}

function row(over: Partial<ProjectRowData> = {}): ProjectRowData {
  return {
    view: pv(), displayName: 'wraith', sessionCount: 3,
    lastSessionAt: '2026-08-05T10:00:00.000Z', ...over,
  }
}

describe('mergeSummaries', () => {
  it('按 path 对齐概况,顺序跟随 projects', () => {
    const projects = [pv({ path: '/a', name: '甲' }), pv({ path: '/b' })]
    const summaries: ProjectSummary[] = [
      { path: '/b', sessionCount: 1, lastSessionAt: '2026-08-05T09:00:00.000Z' },
      { path: '/a', sessionCount: 7, lastSessionAt: '2026-08-05T10:00:00.000Z' },
    ]

    const rows = mergeSummaries(projects, summaries)

    expect(rows.map(r => r.view.path)).toEqual(['/a', '/b'])
    expect(rows[0]!.sessionCount).toBe(7)
    expect(rows[0]!.displayName).toBe('甲')
    expect(rows[1]!.sessionCount).toBe(1)
  })

  it('概况还没回来的项目 sessionCount 是 null(渲染骨架用)', () => {
    const rows = mergeSummaries([pv({ path: '/a' })], [])
    expect(rows[0]!.sessionCount).toBeNull()
    expect(rows[0]!.lastSessionAt).toBeNull()
  })

  it('无 name 时 displayName 回落目录名', () => {
    const rows = mergeSummaries([pv({ path: '/home/me/my-proj' })], [])
    expect(rows[0]!.displayName).toBe('my-proj')
  })
})

describe('filterProjects', () => {
  it('命中名称', () => {
    const rows = [row({ displayName: 'wraith' }), row({ displayName: 'other' })]
    expect(filterProjects(rows, 'wra').map(r => r.displayName)).toEqual(['wraith'])
  })

  it('命中路径 —— 同名不同路径的项目靠这个筛开', () => {
    const rows = [
      row({ displayName: 'wraith', view: pv({ path: '/work/alpha/wraith' }) }),
      row({ displayName: 'wraith', view: pv({ path: '/work/beta/wraith' }) }),
    ]
    expect(filterProjects(rows, 'alpha')).toHaveLength(1)
  })

  it('不区分大小写', () => {
    expect(filterProjects([row({ displayName: 'Wraith' })], 'wRA')).toHaveLength(1)
  })

  it('空查询回全量', () => {
    const rows = [row(), row()]
    expect(filterProjects(rows, '   ')).toHaveLength(2)
  })

  it('都不命中回空', () => {
    expect(filterProjects([row({ displayName: 'wraith' })], 'zzz')).toEqual([])
  })
})

describe('sortProjects', () => {
  const a = row({ displayName: 'alpha', lastSessionAt: '2026-08-05T08:00:00.000Z' })
  const b = row({ displayName: 'beta', lastSessionAt: '2026-08-05T10:00:00.000Z' })
  const none = row({ displayName: 'zeta', lastSessionAt: null })

  it('已更新倒序:新的在前', () => {
    expect(sortProjects([a, b], 'updated', 'desc').map(r => r.displayName)).toEqual(['beta', 'alpha'])
  })

  it('已更新正序:旧的在前', () => {
    expect(sortProjects([a, b], 'updated', 'asc').map(r => r.displayName)).toEqual(['alpha', 'beta'])
  })

  it('无会话的项目恒排末尾,不受方向影响', () => {
    expect(sortProjects([none, a, b], 'updated', 'desc').map(r => r.displayName))
      .toEqual(['beta', 'alpha', 'zeta'])
    expect(sortProjects([none, a, b], 'updated', 'asc').map(r => r.displayName))
      .toEqual(['alpha', 'beta', 'zeta'])
  })

  it('按名称排序不区分大小写', () => {
    const rows = [row({ displayName: 'beta' }), row({ displayName: 'Alpha' })]
    expect(sortProjects(rows, 'name', 'asc').map(r => r.displayName)).toEqual(['Alpha', 'beta'])
  })

  it('不改原数组', () => {
    const rows = [b, a]
    sortProjects(rows, 'name', 'asc')
    expect(rows.map(r => r.displayName)).toEqual(['beta', 'alpha'])
  })
})

describe('partitionStarredProjects', () => {
  it('重点与其余分开,各自保持传入顺序', () => {
    const s1 = row({ displayName: 's1', view: pv({ starred: true }) })
    const r1 = row({ displayName: 'r1' })
    const s2 = row({ displayName: 's2', view: pv({ starred: true }) })

    const { starred, rest } = partitionStarredProjects([s1, r1, s2])

    expect(starred.map(r => r.displayName)).toEqual(['s1', 's2'])
    expect(rest.map(r => r.displayName)).toEqual(['r1'])
  })

  it('没有重点时 starred 为空数组(组件据此不渲染分区标题)', () => {
    expect(partitionStarredProjects([row()]).starred).toEqual([])
  })
})

describe('shortRelativeTime', () => {
  const now = Date.parse('2026-08-05T12:00:00.000Z')
  const ago = (ms: number): string => new Date(now - ms).toISOString()

  it('null 回破折号', () => {
    expect(shortRelativeTime(null, now)).toBe('—')
  })

  it('不到 1 分钟', () => {
    expect(shortRelativeTime(ago(30_000), now)).toBe('刚刚')
  })

  it('59 分钟仍是分', () => {
    expect(shortRelativeTime(ago(59 * 60_000), now)).toBe('59 分')
  })

  it('60 分钟翻成 1 小时', () => {
    expect(shortRelativeTime(ago(60 * 60_000), now)).toBe('1 小时')
  })

  it('23 小时仍是小时', () => {
    expect(shortRelativeTime(ago(23 * 3600_000), now)).toBe('23 小时')
  })

  it('24 小时翻成 1 天', () => {
    expect(shortRelativeTime(ago(24 * 3600_000), now)).toBe('1 天')
  })

  it('29 天仍是天', () => {
    expect(shortRelativeTime(ago(29 * 86400_000), now)).toBe('29 天')
  })

  it('30 天翻成 1 个月', () => {
    expect(shortRelativeTime(ago(30 * 86400_000), now)).toBe('1 个月')
  })

  it('无法解析的时间戳回破折号,不抛', () => {
    expect(shortRelativeTime('not-a-date', now)).toBe('—')
  })

  it('未来时间当作刚刚,不出现负数', () => {
    expect(shortRelativeTime(new Date(now + 60_000).toISOString(), now)).toBe('刚刚')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/projectsView.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

新建 `desktop/src/renderer/lib/projectsView.ts`：

```ts
import { baseName } from './paths'
import type { ProjectView, ProjectSummary } from '../../shared/types'

export type ProjectSortKey = 'name' | 'updated'
export type SortDir = 'asc' | 'desc'

/** 一行的渲染数据:项目条目 + 该项目的会话概况。 */
export interface ProjectRowData {
  view: ProjectView
  /** name ?? 目录名 */
  displayName: string
  /** 未归档会话数;null = 概况还没回来(渲染骨架) */
  sessionCount: number | null
  /** 最新未归档会话时间;null = 无会话 或 概况还没回来 */
  lastSessionAt: string | null
}

/**
 * 把 listProjects 的条目与 projectSummary 的概况按 path 对齐。
 * 顺序跟随 projects(它已按 lastUsedAt 倒序),概况缺失 → sessionCount=null。
 */
export function mergeSummaries(projects: ProjectView[], summaries: ProjectSummary[]): ProjectRowData[] {
  const byPath = new Map(summaries.map(s => [s.path, s]))
  return projects.map(view => {
    const s = byPath.get(view.path)
    return {
      view,
      displayName: view.name || baseName(view.path),
      sessionCount: s ? s.sessionCount : null,
      lastSessionAt: s ? s.lastSessionAt : null,
    }
  })
}

/** 名称 + 路径双字段子串,不区分大小写。空查询回全量(同一个数组引用不保证)。 */
export function filterProjects(rows: ProjectRowData[], query: string): ProjectRowData[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows.slice()
  return rows.filter(r =>
    r.displayName.toLowerCase().includes(q) || r.view.path.toLowerCase().includes(q))
}

/**
 * 双列排序。不改原数组。
 * 「无会话」(lastSessionAt=null)恒排末尾且不受 dir 影响 —— 让它跟着方向来回跳
 * 会让「按时间排」这件事看起来是坏的。
 */
export function sortProjects(rows: ProjectRowData[], key: ProjectSortKey, dir: SortDir): ProjectRowData[] {
  const sign = dir === 'asc' ? 1 : -1
  const out = rows.slice()
  out.sort((a, b) => {
    if (key === 'name') {
      return sign * a.displayName.localeCompare(b.displayName, 'zh-Hans-CN', { sensitivity: 'base' })
    }
    const av = a.lastSessionAt
    const bv = b.lastSessionAt
    if (av === null && bv === null) return 0
    if (av === null) return 1     // 无会话恒后
    if (bv === null) return -1
    return sign * av.localeCompare(bv)   // ISO-8601 字典序 == 时间序
  })
  return out
}

/** 重点 / 其余 两段。各自保持传入顺序(调用方先排好再分区)。 */
export function partitionStarredProjects(rows: ProjectRowData[]): {
  starred: ProjectRowData[]
  rest: ProjectRowData[]
} {
  const starred: ProjectRowData[] = []
  const rest: ProjectRowData[] = []
  for (const r of rows) {
    if (r.view.starred) starred.push(r)
    else rest.push(r)
  }
  return { starred, rest }
}

/**
 * 短相对时间:'—' / '刚刚' / 'N 分' / 'N 小时' / 'N 天' / 'N 个月'。
 *
 * 不复用 contextPanelView.relativeTime:那个封顶在「N 小时前」且带「前」字,
 * 这里要无后缀短式 + 天/月档。老的在上下文面板里语义正确,不动它。
 */
export function shortRelativeTime(iso: string | null, now: number): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.floor((now - t) / 1000))   // 未来时间夹到 0 → '刚刚'
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时`
  const days = Math.floor(s / 86400)
  if (days < 30) return `${days} 天`
  return `${Math.floor(days / 30)} 个月`
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/projectsView.test.ts`
Expected: PASS（24 个）

Run: `cd desktop && npm run typecheck`
Expected: 0 错误

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/lib/projectsView.ts desktop/test/projectsView.test.ts
git commit -m "feat(desktop): projectsView 纯函数 —— 面板逻辑全在这儿,组件只渲染

两个刻意的决定:
① 无会话的项目(lastSessionAt=null)排序时恒在末尾、不受方向影响。跟着方向
   来回跳会让「按已更新排」这件事看起来是坏的。
② 排序用 ISO-8601 字符串字典序而不是 Date.parse —— 同序且省掉两次解析。

shortRelativeTime 没复用 contextPanelView.relativeTime:那个封顶在小时、带「前」字,
是上下文面板的语义,这里要无后缀短式加天/月档。"
```

---

## Phase C — 项目面板

### Task 9: `ProjectRow` —— 单行 + 展开懒加载

先做行、再做外壳，因为行是外壳的被测依赖。这个 task 只做行主体 + `⌄` 展开 + `☆` + `✎`，`···` 菜单留给 Task 10。

**Files:**
- Create: `desktop/src/renderer/components/ProjectRow.tsx`
- Test: `desktop/test/projectRow.test.tsx`

**Interfaces:**
- Consumes: Task 8 的 `ProjectRowData` / `shortRelativeTime`；Task 7 的 `window.wraith.listSessionsForProject`
- Produces:
  ```ts
  interface ProjectRowProps {
    row: ProjectRowData
    active: boolean            // 是否当前工作目录
    busy: boolean              // turn === 'running'
    now: number                // 相对时间的基准,由外壳统一给,免得每行各算一次
    onOpen: (path: string) => void            // 点行主体:切项目 + 恢复最近会话
    onNewConversation: (path: string) => void // ✎:切项目 + 新会话
    onToggleStar: (path: string, starred: boolean) => void
    onOpenSession: (path: string, sessionId: string) => void
    menu?: React.ReactNode     // Task 10 把 ··· 菜单塞进来
  }
  export default function ProjectRow(props: ProjectRowProps): JSX.Element
  ```
- data-testid 约定（后续 e2e 依赖，**不要改名**）：`project-row` / `project-row-open` / `project-row-expand` / `project-row-star` / `project-row-new` / `project-row-session` / `project-row-view-all` / `project-row-missing`

- [ ] **Step 1: 写失败测试**

新建 `desktop/test/projectRow.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ProjectRow from '../src/renderer/components/ProjectRow'
import type { ProjectRowData } from '../src/renderer/lib/projectsView'
import type { SessionMeta } from '../src/shared/types'

function meta(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 's1', cwd: '/a', createdAt: 'c', updatedAt: '2026-08-05T11:00:00.000Z',
    provider: 'p', model: 'm', title: '接上一轮 Skill 优化工作', turns: 2, ...over,
  }
}

function row(over: Partial<ProjectRowData> = {}): ProjectRowData {
  return {
    view: { path: '/home/me/wraith', lastUsedAt: 1, exists: true },
    displayName: 'wraith', sessionCount: 3,
    lastSessionAt: '2026-08-05T11:00:00.000Z',
    ...over,
  }
}

const NOW = Date.parse('2026-08-05T12:00:00.000Z')

function props(over: Partial<React.ComponentProps<typeof ProjectRow>> = {}) {
  return {
    row: row(), active: false, busy: false, now: NOW,
    onOpen: vi.fn(), onNewConversation: vi.fn(),
    onToggleStar: vi.fn(), onOpenSession: vi.fn(),
    ...over,
  }
}

let listSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  listSpy = vi.fn().mockResolvedValue({ sessions: [meta(), meta({ id: 's2', title: '你好' })] })
  ;(globalThis as unknown as { window: { wraith: unknown } }).window.wraith = {
    listSessionsForProject: listSpy,
  }
})

describe('ProjectRow 基本渲染', () => {
  it('显示名称、会话数、相对时间', () => {
    render(<ProjectRow {...props()} />)
    expect(screen.getByText('wraith')).toBeTruthy()
    expect(screen.getByText(/3 会话/)).toBeTruthy()
    expect(screen.getByText('1 小时')).toBeTruthy()
  })

  it('无会话时显示「无会话」与破折号', () => {
    render(<ProjectRow {...props({ row: row({ sessionCount: 0, lastSessionAt: null }) })} />)
    expect(screen.getByText(/无会话/)).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('概况未回(sessionCount=null)时不显示会话数副标', () => {
    render(<ProjectRow {...props({ row: row({ sessionCount: null, lastSessionAt: null }) })} />)
    expect(screen.queryByText(/会话/)).toBeNull()
  })
})

describe('ProjectRow 动作', () => {
  it('点行主体调 onOpen', () => {
    const p = props()
    render(<ProjectRow {...p} />)
    fireEvent.click(screen.getByTestId('project-row-open'))
    expect(p.onOpen).toHaveBeenCalledWith('/home/me/wraith')
  })

  it('点 ✎ 调 onNewConversation', () => {
    const p = props()
    render(<ProjectRow {...p} />)
    fireEvent.click(screen.getByTestId('project-row-new'))
    expect(p.onNewConversation).toHaveBeenCalledWith('/home/me/wraith')
  })

  it('点 ☆ 调 onToggleStar,传取反后的值', () => {
    const p = props()
    render(<ProjectRow {...p} />)
    fireEvent.click(screen.getByTestId('project-row-star'))
    expect(p.onToggleStar).toHaveBeenCalledWith('/home/me/wraith', true)
  })

  it('已是重点时点 ☆ 传 false', () => {
    const p = props({ row: row({ view: { path: '/home/me/wraith', lastUsedAt: 1, exists: true, starred: true } }) })
    render(<ProjectRow {...p} />)
    fireEvent.click(screen.getByTestId('project-row-star'))
    expect(p.onToggleStar).toHaveBeenCalledWith('/home/me/wraith', false)
  })
})

describe('ProjectRow busy 守卫', () => {
  it('busy 时行主体与 ✎ 禁用', () => {
    render(<ProjectRow {...props({ busy: true })} />)
    expect((screen.getByTestId('project-row-open') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('project-row-new') as HTMLButtonElement).disabled).toBe(true)
  })

  it('busy 时 ☆ 与展开仍可用 —— 前者纯 settings,后者只读', () => {
    render(<ProjectRow {...props({ busy: true })} />)
    expect((screen.getByTestId('project-row-star') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId('project-row-expand') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('ProjectRow 展开懒加载', () => {
  it('首次展开才请求会话', async () => {
    render(<ProjectRow {...props()} />)
    expect(listSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('project-row-expand'))

    await waitFor(() => expect(screen.getAllByTestId('project-row-session')).toHaveLength(2))
    expect(listSpy).toHaveBeenCalledTimes(1)
    expect(listSpy).toHaveBeenCalledWith('/home/me/wraith', 5)
  })

  it('折叠再展开不重复请求(缓存不清)', async () => {
    render(<ProjectRow {...props()} />)
    fireEvent.click(screen.getByTestId('project-row-expand'))
    await waitFor(() => expect(screen.getAllByTestId('project-row-session')).toHaveLength(2))

    fireEvent.click(screen.getByTestId('project-row-expand'))   // 折叠
    await waitFor(() => expect(screen.queryByTestId('project-row-session')).toBeNull())
    fireEvent.click(screen.getByTestId('project-row-expand'))   // 再展开
    await waitFor(() => expect(screen.getAllByTestId('project-row-session')).toHaveLength(2))

    expect(listSpy).toHaveBeenCalledTimes(1)
  })

  it('点展开里的会话调 onOpenSession', async () => {
    const p = props()
    render(<ProjectRow {...p} />)
    fireEvent.click(screen.getByTestId('project-row-expand'))
    await waitFor(() => expect(screen.getAllByTestId('project-row-session')).toHaveLength(2))

    fireEvent.click(screen.getAllByTestId('project-row-session')[1]!)
    expect(p.onOpenSession).toHaveBeenCalledWith('/home/me/wraith', 's2')
  })

  it('会话数超过 5 时出「查看全部」', async () => {
    listSpy.mockResolvedValue({ sessions: [meta(), meta({ id: 's2' }), meta({ id: 's3' }), meta({ id: 's4' }), meta({ id: 's5' })] })
    render(<ProjectRow {...props({ row: row({ sessionCount: 12 }) })} />)
    fireEvent.click(screen.getByTestId('project-row-expand'))

    await waitFor(() => expect(screen.getByTestId('project-row-view-all')).toBeTruthy())
  })

  it('会话数不超过 5 时不出「查看全部」', async () => {
    render(<ProjectRow {...props({ row: row({ sessionCount: 2 }) })} />)
    fireEvent.click(screen.getByTestId('project-row-expand'))
    await waitFor(() => expect(screen.getAllByTestId('project-row-session')).toHaveLength(2))

    expect(screen.queryByTestId('project-row-view-all')).toBeNull()
  })
})

describe('ProjectRow 目录不存在', () => {
  const missing = row({ view: { path: '/gone', lastUsedAt: 1, exists: false } })

  it('显示「目录不存在」,不显示时间', () => {
    render(<ProjectRow {...props({ row: missing })} />)
    expect(screen.getByTestId('project-row-missing')).toBeTruthy()
  })

  it('不渲染展开 / ☆ / ✎', () => {
    render(<ProjectRow {...props({ row: missing })} />)
    expect(screen.queryByTestId('project-row-expand')).toBeNull()
    expect(screen.queryByTestId('project-row-star')).toBeNull()
    expect(screen.queryByTestId('project-row-new')).toBeNull()
  })

  it('行主体禁用', () => {
    render(<ProjectRow {...props({ row: missing })} />)
    expect((screen.getByTestId('project-row-open') as HTMLButtonElement).disabled).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/projectRow.test.tsx`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

新建 `desktop/src/renderer/components/ProjectRow.tsx`：

```tsx
import { useState } from 'react'
import { Folder, ChevronDown, Star, SquarePen } from 'lucide-react'
import { shortRelativeTime, type ProjectRowData } from '../lib/projectsView'
import { sessionDisplayName } from '../lib/sessionView'
import { shortRelativeTime as rel } from '../lib/projectsView'
import type { SessionMeta } from '../../shared/types'

/** 展开时拉几条会话。超过这个数就出「查看全部」引导去侧栏看全量。 */
const EXPAND_LIMIT = 5

export interface ProjectRowProps {
  row: ProjectRowData
  /** 是否当前工作目录(左侧 accent 竖条) */
  active: boolean
  /** turn 运行中:禁激活/新会话;重点与展开不受限 */
  busy: boolean
  /** 相对时间基准。由外壳统一传,免得每行各取一次 Date.now() 导致同屏时间不一致 */
  now: number
  onOpen: (path: string) => void
  onNewConversation: (path: string) => void
  onToggleStar: (path: string, starred: boolean) => void
  onOpenSession: (path: string, sessionId: string) => void
  /** ··· 菜单(Task 10 注入)。行本身不关心它长什么样 */
  menu?: React.ReactNode
}

export default function ProjectRow({
  row, active, busy, now,
  onOpen, onNewConversation, onToggleStar, onOpenSession, menu,
}: ProjectRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  // null = 还没拉过。折叠不清它 —— 折叠再展开不该重复请求
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null)
  const [loading, setLoading] = useState(false)

  const { view, displayName, sessionCount, lastSessionAt } = row
  const path = view.path
  const starred = view.starred === true
  const missing = !view.exists

  const toggleExpand = async (): Promise<void> => {
    const next = !expanded
    setExpanded(next)
    if (!next || sessions !== null || loading) return
    setLoading(true)
    try {
      const { sessions: list } = await window.wraith.listSessionsForProject(path, EXPAND_LIMIT)
      setSessions(list)
    } catch (err) {
      console.error('[wraith] listSessionsForProject error:', err)
      setSessions([])   // 置空数组而不是留 null,免得每次展开都重试
    } finally {
      setLoading(false)
    }
  }

  return (
    <div data-testid="project-row" className="border-b border-border/60">
      <div className={'group flex items-center gap-1 px-2 ' + (active ? 'relative' : '')}>
        {active && (
          <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
        )}
        <Folder className="ml-1 h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.5} />
        {!missing && (
          <button
            data-testid="project-row-expand"
            aria-label={expanded ? '收起会话' : '展开会话'}
            onClick={toggleExpand}
            className="shrink-0 rounded p-0.5 text-fg-subtle hover:text-fg"
          >
            <ChevronDown
              className={'h-3.5 w-3.5 transition-transform ' + (expanded ? '' : '-rotate-90')}
              strokeWidth={1.5}
            />
          </button>
        )}
        <button
          data-testid="project-row-open"
          disabled={busy || missing}
          title={missing ? '目录不存在' : path}
          onClick={() => onOpen(path)}
          className={'flex min-w-0 flex-1 items-baseline gap-2 py-3 text-left disabled:cursor-not-allowed ' +
            (missing ? 'opacity-50' : '')}
        >
          <span className="truncate text-sm text-fg">{displayName}</span>
          {!missing && sessionCount !== null && (
            <span className="shrink-0 text-3xs text-fg-subtle">
              · {sessionCount === 0 ? '无会话' : `${sessionCount} 会话`}
            </span>
          )}
        </button>
        {missing ? (
          <span data-testid="project-row-missing" className="shrink-0 text-xs text-fg-subtle">目录不存在</span>
        ) : (
          <span className="w-16 shrink-0 text-right text-xs text-fg-muted">
            {shortRelativeTime(lastSessionAt, now)}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-0.5 pl-2">
          {menu}
          {!missing && (
            <>
              <button
                data-testid="project-row-star"
                title={starred ? '取消重点' : '标记重点'}
                onClick={() => onToggleStar(path, !starred)}
                className={'rounded p-1 ' + (starred
                  ? 'text-warn'
                  : 'text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100')}
              >
                <Star className="h-3.5 w-3.5" strokeWidth={1.5} fill={starred ? 'currentColor' : 'none'} />
              </button>
              <button
                data-testid="project-row-new"
                disabled={busy}
                title="在此项目新建对话"
                onClick={() => onNewConversation(path)}
                className="rounded p-1 text-fg-subtle opacity-0 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30 group-hover:opacity-100"
              >
                <SquarePen className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="pb-2 pl-10 pr-2">
          {loading && <div className="py-1.5 text-xs text-fg-subtle">载入中…</div>}
          {!loading && sessions !== null && sessions.length === 0 && (
            <div className="py-1.5 text-xs text-fg-subtle">这个项目还没有会话</div>
          )}
          {!loading && sessions?.map(s => (
            <button
              key={s.id}
              data-testid="project-row-session"
              disabled={busy}
              onClick={() => onOpenSession(path, s.id)}
              className="flex w-full items-baseline gap-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="truncate text-xs text-fg-muted hover:text-fg">{sessionDisplayName(s)}</span>
              <span className="ml-auto shrink-0 text-3xs text-fg-subtle">
                {rel(s.updatedAt, now)}
              </span>
            </button>
          ))}
          {!loading && sessions !== null && sessionCount !== null && sessionCount > sessions.length && (
            <button
              data-testid="project-row-view-all"
              disabled={busy}
              onClick={() => onOpen(path)}
              className="py-1.5 text-xs text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              在此项目中查看全部 →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
```

> **清理**：上面同时 import 了 `shortRelativeTime` 和它的别名 `rel`，是为了让两处调用读起来分别是「项目时间」和「会话时间」。实现时**只保留一个 import**（`import { shortRelativeTime, type ProjectRowData } from '../lib/projectsView'`），两处都用 `shortRelativeTime` —— 重复 import 同一个符号会被 lint 拦。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/projectRow.test.tsx`
Expected: PASS（16 个）

Run: `cd desktop && npm run typecheck`
Expected: 0 错误

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/components/ProjectRow.tsx desktop/test/projectRow.test.tsx
git commit -m "feat(desktop): 项目行 —— 展开懒加载,折叠不清缓存

三个断言值得留着:
① 折叠再展开不重复请求(sessions 状态 null=没拉过,[]=拉过是空,两者不同)。
② 请求失败置 [] 而不是留 null,否则每次展开都重试一次。
③ now 由外壳统一传,不在行里各取 Date.now() —— 否则同屏几十行的相对时间
   会因为渲染时刻不同而互相矛盾。

busy 时只禁「切项目 / 新会话」,重点(纯 settings)和展开(只读)照常可用。"
```

---

### Task 10: `ProjectRow` 的 `···` 菜单 + 编辑弹窗

**Files:**
- Create: `desktop/src/renderer/components/ProjectRowMenu.tsx`
- Test: `desktop/test/projectRowMenu.test.tsx`

**Interfaces:**
- Consumes: Task 9 的 `ProjectRowProps.menu` 插槽；`ui/popover`、`ui/dialog`
- Produces:
  ```ts
  interface ProjectRowMenuProps {
    row: ProjectRowData
    active: boolean            // 当前项目不可移出
    onRename: (path: string, name: string) => void
    onArchiveChats: (path: string, count: number) => void
    onRemove: (path: string) => void
  }
  export default function ProjectRowMenu(props: ProjectRowMenuProps): JSX.Element
  ```
- data-testid：`project-row-menu` / `project-menu-edit` / `project-menu-archive` / `project-menu-remove` / `project-edit-dialog` / `project-edit-name` / `project-edit-path` / `project-edit-save`

- [ ] **Step 1: 写失败测试**

新建 `desktop/test/projectRowMenu.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ProjectRowMenu from '../src/renderer/components/ProjectRowMenu'
import type { ProjectRowData } from '../src/renderer/lib/projectsView'

function row(over: Partial<ProjectRowData> = {}): ProjectRowData {
  return {
    view: { path: '/home/me/wraith', lastUsedAt: 1, exists: true },
    displayName: 'wraith', sessionCount: 12, lastSessionAt: '2026-08-05T11:00:00.000Z',
    ...over,
  }
}

function props(over: Partial<React.ComponentProps<typeof ProjectRowMenu>> = {}) {
  return {
    row: row(), active: false,
    onRename: vi.fn(), onArchiveChats: vi.fn(), onRemove: vi.fn(),
    ...over,
  }
}

function openMenu(): void {
  fireEvent.click(screen.getByTestId('project-row-menu'))
}

describe('ProjectRowMenu 菜单项', () => {
  it('三项都在:编辑项目 / 归档聊天 / 移除', () => {
    render(<ProjectRowMenu {...props()} />)
    openMenu()
    expect(screen.getByTestId('project-menu-edit')).toBeTruthy()
    expect(screen.getByTestId('project-menu-archive')).toBeTruthy()
    expect(screen.getByTestId('project-menu-remove')).toBeTruthy()
  })

  it('归档聊天带上会话数量', () => {
    render(<ProjectRowMenu {...props()} />)
    openMenu()
    expect(screen.getByTestId('project-menu-archive').textContent).toMatch(/12/)
  })

  it('无会话时归档聊天禁用', () => {
    render(<ProjectRowMenu {...props({ row: row({ sessionCount: 0 }) })} />)
    openMenu()
    expect((screen.getByTestId('project-menu-archive') as HTMLButtonElement).disabled).toBe(true)
  })

  it('概况未回(null)时归档聊天禁用', () => {
    render(<ProjectRowMenu {...props({ row: row({ sessionCount: null }) })} />)
    openMenu()
    expect((screen.getByTestId('project-menu-archive') as HTMLButtonElement).disabled).toBe(true)
  })

  it('目录不存在时归档聊天禁用,编辑与移除仍可用', () => {
    render(<ProjectRowMenu {...props({ row: row({ view: { path: '/gone', lastUsedAt: 1, exists: false } }) })} />)
    openMenu()
    expect((screen.getByTestId('project-menu-archive') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('project-menu-edit') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId('project-menu-remove') as HTMLButtonElement).disabled).toBe(false)
  })

  it('当前项目不可移出', () => {
    render(<ProjectRowMenu {...props({ active: true })} />)
    openMenu()
    expect((screen.getByTestId('project-menu-remove') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ProjectRowMenu 动作', () => {
  it('点归档聊天把 path 与数量交给上层(确认框在上层弹)', () => {
    const p = props()
    render(<ProjectRowMenu {...p} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-archive'))
    expect(p.onArchiveChats).toHaveBeenCalledWith('/home/me/wraith', 12)
  })

  it('点移除调 onRemove', () => {
    const p = props()
    render(<ProjectRowMenu {...p} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-remove'))
    expect(p.onRemove).toHaveBeenCalledWith('/home/me/wraith')
  })
})

describe('ProjectRowMenu 编辑弹窗', () => {
  it('点编辑项目开弹窗,预填别名与只读路径', () => {
    render(<ProjectRowMenu {...props({ row: row({ view: { path: '/home/me/wraith', name: '主仓', lastUsedAt: 1, exists: true } }) })} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-edit'))

    expect(screen.getByTestId('project-edit-dialog')).toBeTruthy()
    expect((screen.getByTestId('project-edit-name') as HTMLInputElement).value).toBe('主仓')
    expect((screen.getByTestId('project-edit-path') as HTMLInputElement).readOnly).toBe(true)
    expect((screen.getByTestId('project-edit-path') as HTMLInputElement).value).toBe('/home/me/wraith')
  })

  it('没有别名时输入框是空的(而不是填目录名)', () => {
    render(<ProjectRowMenu {...props()} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-edit'))
    expect((screen.getByTestId('project-edit-name') as HTMLInputElement).value).toBe('')
  })

  it('保存调 onRename', () => {
    const p = props()
    render(<ProjectRowMenu {...p} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-edit'))
    fireEvent.change(screen.getByTestId('project-edit-name'), { target: { value: '  新名字  ' } })
    fireEvent.click(screen.getByTestId('project-edit-save'))
    expect(p.onRename).toHaveBeenCalledWith('/home/me/wraith', '新名字')
  })

  it('清空别名后保存传空串(上层据此回落目录名)', () => {
    const p = props({ row: row({ view: { path: '/home/me/wraith', name: '主仓', lastUsedAt: 1, exists: true } }) })
    render(<ProjectRowMenu {...p} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-edit'))
    fireEvent.change(screen.getByTestId('project-edit-name'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('project-edit-save'))
    expect(p.onRename).toHaveBeenCalledWith('/home/me/wraith', '')
  })

  it('Enter 等于保存', () => {
    const p = props()
    render(<ProjectRowMenu {...p} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-edit'))
    fireEvent.change(screen.getByTestId('project-edit-name'), { target: { value: 'x' } })
    fireEvent.keyDown(screen.getByTestId('project-edit-name'), { key: 'Enter' })
    expect(p.onRename).toHaveBeenCalledWith('/home/me/wraith', 'x')
  })

  it('Escape 不保存', () => {
    const p = props()
    render(<ProjectRowMenu {...p} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-edit'))
    fireEvent.change(screen.getByTestId('project-edit-name'), { target: { value: 'x' } })
    fireEvent.keyDown(screen.getByTestId('project-edit-name'), { key: 'Escape' })
    expect(p.onRename).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/projectRowMenu.test.tsx`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

新建 `desktop/src/renderer/components/ProjectRowMenu.tsx`：

```tsx
import { useState } from 'react'
import { MoreHorizontal, Settings, Archive, X } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog'
import type { ProjectRowData } from '../lib/projectsView'

export interface ProjectRowMenuProps {
  row: ProjectRowData
  /** 当前项目不可移出(移出会把工作目录抽走) */
  active: boolean
  onRename: (path: string, name: string) => void
  /** 只把意图交上去;数量提示与确认框在上层(App)弹,菜单不做破坏性确认 */
  onArchiveChats: (path: string, count: number) => void
  onRemove: (path: string) => void
}

export default function ProjectRowMenu({
  row, active, onRename, onArchiveChats, onRemove,
}: ProjectRowMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const { view, sessionCount } = row
  const path = view.path
  // 概况没回来(null)也禁用 —— 不知道数量就不该让用户点一个「归档 N 个」
  const canArchive = view.exists && sessionCount !== null && sessionCount > 0

  const startEdit = (): void => {
    setOpen(false)
    setDraft(view.name ?? '')
    setEditing(true)
  }

  const save = (): void => {
    setEditing(false)
    onRename(path, draft.trim())
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            data-testid="project-row-menu"
            aria-label="更多"
            className="rounded p-1 text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-48">
          <button
            data-testid="project-menu-edit"
            onClick={startEdit}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-fg/5 hover:text-fg"
          >
            <Settings className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />编辑项目
          </button>
          <button
            data-testid="project-menu-archive"
            disabled={!canArchive}
            title={canArchive ? '把这个项目的聊天全部归档' : '没有可归档的聊天'}
            onClick={() => {
              setOpen(false)
              onArchiveChats(path, sessionCount ?? 0)
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Archive className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            归档聊天{canArchive ? `（${sessionCount}）` : ''}
          </button>
          <div className="my-1 border-t border-border" />
          <button
            data-testid="project-menu-remove"
            disabled={active}
            title={active ? '当前项目不可移出' : '移出列表(不删磁盘)'}
            onClick={() => {
              setOpen(false)
              onRemove(path)
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <X className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />移除
          </button>
        </PopoverContent>
      </Popover>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent data-testid="project-edit-dialog" className="w-80">
          <DialogTitle>编辑项目</DialogTitle>
          <DialogDescription>别名只影响显示,不改磁盘上的目录名。</DialogDescription>
          <label className="mt-3 block text-3xs text-fg-subtle">别名</label>
          <input
            data-testid="project-edit-name"
            autoFocus
            value={draft}
            placeholder={row.displayName}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setEditing(false)
            }}
            className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
          />
          <label className="mt-3 block text-3xs text-fg-subtle">路径</label>
          <input
            data-testid="project-edit-path"
            readOnly
            value={path}
            onFocus={e => e.currentTarget.select()}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-fg-muted outline-none"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-fg-muted hover:bg-fg/5"
            >
              取消
            </button>
            <button
              data-testid="project-edit-save"
              onClick={save}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
            >
              保存
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

> **Radix Popover 在 jsdom 里的坑**：`PopoverContent` 走 Portal，`screen.getByTestId` 能找到（Portal 挂在 `document.body`）。若测试报找不到，检查 `desktop/test/setup.ts` 里有没有给 Radix 需要的 `ResizeObserver` / `DOMRect` 打桩 —— 既有的 `automationsPanelLiveNext.test.tsx` 之类已经在用 Radix 组件，照它的 setup 走。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/projectRowMenu.test.tsx`
Expected: PASS（14 个）

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/components/ProjectRowMenu.tsx desktop/test/projectRowMenu.test.tsx
git commit -m "feat(desktop): 项目行 ··· 菜单 —— 归档聊天不知道数量就禁用

sessionCount 为 null(概况还没回来)时和为 0 一样禁用:不能让用户点一个
「归档 ? 个聊天」。菜单本身不弹破坏性确认,只把 (path, count) 交给上层 ——
确认框需要知道项目名和真实数量,那是 App 的上下文。

编辑弹窗里别名空着就是空着,不预填目录名 —— 预填会让「我没设别名」和
「我设了个跟目录同名的别名」在 UI 上不可区分。"
```

---

### Task 11: `ProjectsPanel` 外壳

搜索框、可点表头、重点/其余两段分区、空态、概况骨架态。

**Files:**
- Create: `desktop/src/renderer/components/ProjectsPanel.tsx`
- Test: `desktop/test/projectsPanel.test.tsx`

**Interfaces:**
- Consumes: Task 8 的全部纯函数；Task 9 的 `ProjectRow`；Task 10 的 `ProjectRowMenu`；Task 7 的 `window.wraith.projectSummary`
- Produces:
  ```ts
  interface ProjectsPanelProps {
    projects: ProjectView[]
    activePath: string
    busy: boolean
    onOpen: (path: string) => void
    onNewConversation: (path: string) => void
    onToggleStar: (path: string, starred: boolean) => void
    onOpenSession: (path: string, sessionId: string) => void
    onRename: (path: string, name: string) => void
    onArchiveChats: (path: string, count: number) => void
    onRemove: (path: string) => void
    onAdd: () => void
  }
  export default function ProjectsPanel(props: ProjectsPanelProps): JSX.Element
  ```
- data-testid：`projects-panel` / `projects-search` / `projects-sort-name` / `projects-sort-updated` / `projects-starred-section` / `projects-empty` / `projects-no-match` / `projects-add`

- [ ] **Step 1: 写失败测试**

新建 `desktop/test/projectsPanel.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ProjectsPanel from '../src/renderer/components/ProjectsPanel'
import type { ProjectView } from '../src/shared/types'

function pv(path: string, over: Partial<ProjectView> = {}): ProjectView {
  return { path, lastUsedAt: 1, exists: true, ...over }
}

function props(over: Partial<React.ComponentProps<typeof ProjectsPanel>> = {}) {
  return {
    projects: [pv('/work/wraith'), pv('/work/api-server')],
    activePath: '/work/wraith',
    busy: false,
    onOpen: vi.fn(), onNewConversation: vi.fn(), onToggleStar: vi.fn(),
    onOpenSession: vi.fn(), onRename: vi.fn(), onArchiveChats: vi.fn(),
    onRemove: vi.fn(), onAdd: vi.fn(),
    ...over,
  }
}

let summarySpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  summarySpy = vi.fn().mockResolvedValue({
    summaries: [
      { path: '/work/wraith', sessionCount: 12, lastSessionAt: '2026-08-05T11:00:00.000Z' },
      { path: '/work/api-server', sessionCount: 3, lastSessionAt: '2026-08-05T04:00:00.000Z' },
    ],
  })
  ;(globalThis as unknown as { window: { wraith: unknown } }).window.wraith = {
    projectSummary: summarySpy,
    listSessionsForProject: vi.fn().mockResolvedValue({ sessions: [] }),
  }
})

describe('ProjectsPanel 概况拉取', () => {
  it('挂载时用全部项目路径批量拉一次概况', async () => {
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalledTimes(1))
    expect(summarySpy).toHaveBeenCalledWith(['/work/wraith', '/work/api-server'])
  })

  it('概况回来前不显示会话数副标(骨架态,不显示 0)', () => {
    render(<ProjectsPanel {...props()} />)
    expect(screen.queryByText(/会话/)).toBeNull()
  })

  it('概况失败时仍渲染项目列表,不整页崩', async () => {
    summarySpy.mockRejectedValue(new Error('backend down'))
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(screen.getByText('wraith')).toBeTruthy())
    expect(screen.getByText('api-server')).toBeTruthy()
  })

  it('项目列表变化时重新拉概况', async () => {
    const { rerender } = render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalledTimes(1))

    rerender(<ProjectsPanel {...props({ projects: [pv('/work/wraith'), pv('/work/api-server'), pv('/work/newone')] })} />)

    await waitFor(() => expect(summarySpy).toHaveBeenCalledTimes(2))
    expect(summarySpy).toHaveBeenLastCalledWith(['/work/wraith', '/work/api-server', '/work/newone'])
  })
})

describe('ProjectsPanel 搜索', () => {
  it('输入后只留命中的行', async () => {
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())

    fireEvent.change(screen.getByTestId('projects-search'), { target: { value: 'api' } })

    expect(screen.getByText('api-server')).toBeTruthy()
    expect(screen.queryByText('wraith')).toBeNull()
  })

  it('都不命中时出「没有匹配的项目」而不是空白', async () => {
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())

    fireEvent.change(screen.getByTestId('projects-search'), { target: { value: 'zzzz' } })

    expect(screen.getByTestId('projects-no-match')).toBeTruthy()
  })
})

describe('ProjectsPanel 排序', () => {
  it('默认按已更新倒序', async () => {
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())

    const names = screen.getAllByTestId('project-row-open').map(b => b.textContent ?? '')
    expect(names[0]).toMatch(/wraith/)
    expect(names[1]).toMatch(/api-server/)
  })

  it('点「已更新」表头翻向', async () => {
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())

    fireEvent.click(screen.getByTestId('projects-sort-updated'))

    const names = screen.getAllByTestId('project-row-open').map(b => b.textContent ?? '')
    expect(names[0]).toMatch(/api-server/)
  })

  it('点「名称」表头切到按名称升序', async () => {
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())

    fireEvent.click(screen.getByTestId('projects-sort-name'))

    const names = screen.getAllByTestId('project-row-open').map(b => b.textContent ?? '')
    expect(names[0]).toMatch(/api-server/)
    expect(names[1]).toMatch(/wraith/)
  })
})

describe('ProjectsPanel 重点分区', () => {
  it('有重点项目时出分区标题,重点行在其余行之前', async () => {
    render(<ProjectsPanel {...props({
      projects: [pv('/work/wraith'), pv('/work/api-server', { starred: true })],
    })} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())

    expect(screen.getByTestId('projects-starred-section')).toBeTruthy()
    const names = screen.getAllByTestId('project-row-open').map(b => b.textContent ?? '')
    expect(names[0]).toMatch(/api-server/)
  })

  it('没有重点项目时不渲染分区标题', async () => {
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())
    expect(screen.queryByTestId('projects-starred-section')).toBeNull()
  })
})

describe('ProjectsPanel 空态', () => {
  it('一个项目都没有时出空态与添加按钮', () => {
    render(<ProjectsPanel {...props({ projects: [] })} />)
    expect(screen.getByTestId('projects-empty')).toBeTruthy()
    fireEvent.click(screen.getByTestId('projects-add'))
    expect(screen.queryByTestId('projects-search')).toBeNull()
  })

  it('项目为空时不发概况请求', () => {
    render(<ProjectsPanel {...props({ projects: [] })} />)
    expect(summarySpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/projectsPanel.test.tsx`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

新建 `desktop/src/renderer/components/ProjectsPanel.tsx`：

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Search, ArrowUp, ArrowDown, Star, Plus, FolderPlus } from 'lucide-react'
import ProjectRow from './ProjectRow'
import ProjectRowMenu from './ProjectRowMenu'
import {
  mergeSummaries, filterProjects, sortProjects, partitionStarredProjects,
  type ProjectRowData, type ProjectSortKey, type SortDir,
} from '../lib/projectsView'
import type { ProjectView, ProjectSummary } from '../../shared/types'

export interface ProjectsPanelProps {
  projects: ProjectView[]
  activePath: string
  busy: boolean
  onOpen: (path: string) => void
  onNewConversation: (path: string) => void
  onToggleStar: (path: string, starred: boolean) => void
  onOpenSession: (path: string, sessionId: string) => void
  onRename: (path: string, name: string) => void
  onArchiveChats: (path: string, count: number) => void
  onRemove: (path: string) => void
  onAdd: () => void
}

export default function ProjectsPanel({
  projects, activePath, busy,
  onOpen, onNewConversation, onToggleStar, onOpenSession,
  onRename, onArchiveChats, onRemove, onAdd,
}: ProjectsPanelProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<ProjectSortKey>('updated')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [summaries, setSummaries] = useState<ProjectSummary[]>([])
  // 相对时间的统一基准。一次挂载算一次 —— 同屏几十行必须显示同一个"现在"
  const [now] = useState(() => Date.now())

  const paths = projects.map(p => p.path)
  const pathsKey = paths.join(' ')   // 依赖数组要稳定的标量,不能直接放数组

  useEffect(() => {
    if (paths.length === 0) {
      setSummaries([])
      return
    }
    let alive = true
    void (async () => {
      try {
        const { summaries: got } = await window.wraith.projectSummary(paths)
        if (alive) setSummaries(got)
      } catch (err) {
        // 概况拉不到不该让整页空白:列表照渲染,只是没有会话数与时间
        console.error('[wraith] projectSummary error:', err)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey])

  const rows = useMemo(() => {
    const merged = mergeSummaries(projects, summaries)
    return sortProjects(filterProjects(merged, query), sortKey, sortDir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey, summaries, query, sortKey, sortDir, projects])

  const { starred, rest } = partitionStarredProjects(rows)

  const clickSort = (key: ProjectSortKey): void => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    // 换列时给各自最自然的初始方向:名称 A→Z、时间新→旧
    setSortDir(key === 'name' ? 'asc' : 'desc')
  }

  const renderRow = (r: ProjectRowData): JSX.Element => (
    <ProjectRow
      key={r.view.path}
      row={r}
      active={r.view.path === activePath}
      busy={busy}
      now={now}
      onOpen={onOpen}
      onNewConversation={onNewConversation}
      onToggleStar={onToggleStar}
      onOpenSession={onOpenSession}
      menu={
        <ProjectRowMenu
          row={r}
          active={r.view.path === activePath}
          onRename={onRename}
          onArchiveChats={onArchiveChats}
          onRemove={onRemove}
        />
      }
    />
  )

  if (projects.length === 0) {
    return (
      <div data-testid="projects-panel" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        <FolderPlus className="h-10 w-10 text-fg-subtle" strokeWidth={1.25} />
        <p data-testid="projects-empty" className="text-sm text-fg-muted">还没有项目</p>
        <button
          data-testid="projects-add"
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />添加项目
        </button>
      </div>
    )
  }

  const SortArrow = sortDir === 'asc' ? ArrowUp : ArrowDown

  return (
    <div data-testid="projects-panel" className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold text-fg">项目</h1>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" strokeWidth={1.5} />
          <input
            data-testid="projects-search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索项目"
            className="w-full rounded-full border border-border bg-bg py-2 pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
          />
        </div>

        <div className="mt-6 flex items-center gap-1 border-b border-border px-2 pb-2 text-xs text-fg-muted">
          <button
            data-testid="projects-sort-name"
            onClick={() => clickSort('name')}
            className={'flex items-center gap-1 rounded px-1 hover:text-fg ' + (sortKey === 'name' ? 'text-fg' : '')}
          >
            名称{sortKey === 'name' && <SortArrow className="h-3 w-3" strokeWidth={2} />}
          </button>
          <div className="flex-1" />
          <button
            data-testid="projects-sort-updated"
            onClick={() => clickSort('updated')}
            className={'flex items-center gap-1 rounded px-1 hover:text-fg ' + (sortKey === 'updated' ? 'text-fg' : '')}
          >
            已更新{sortKey === 'updated' && <SortArrow className="h-3 w-3" strokeWidth={2} />}
          </button>
          <span className="w-24 shrink-0" aria-hidden />
        </div>

        {rows.length === 0 && (
          <p data-testid="projects-no-match" className="py-8 text-center text-xs text-fg-subtle">
            没有匹配的项目
          </p>
        )}

        {starred.length > 0 && (
          <>
            <div
              data-testid="projects-starred-section"
              className="flex items-center gap-1.5 px-2 pt-3 pb-1 text-3xs text-fg-subtle"
            >
              <Star className="h-3 w-3" strokeWidth={1.5} />重点
            </div>
            {starred.map(renderRow)}
          </>
        )}
        {rest.map(renderRow)}

        <button
          data-testid="projects-add"
          onClick={onAdd}
          className="mt-4 flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-fg-muted hover:bg-fg/5 hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />添加项目…
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/projectsPanel.test.tsx`
Expected: PASS（13 个）

Run: `cd desktop && npm run typecheck`
Expected: 0 错误

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/components/ProjectsPanel.tsx desktop/test/projectsPanel.test.tsx
git commit -m "feat(desktop): 项目面板外壳 —— 概况拉不到也要把列表渲染出来

三处刻意的选择:
① now 在面板层 useState(() => Date.now()) 算一次传给所有行。若每行各算,
   同屏几十行的相对时间会因渲染时刻不同而互相矛盾。
② 概况请求失败只 console.error,不设错误态 —— 项目名和路径来自 settings,
   本来就该显示;丢的只是会话数和时间两列。
③ useEffect 的依赖用 paths.join('\\0') 这个标量而不是数组,否则每次渲染
   新数组引用都会重新拉一次概况。"
```

---

### Task 12: App.tsx 接线 + 六处注册表的前三处

**Files:**
- Modify: `desktop/src/renderer/App.tsx:188`（`view` 联合类型）、`:1138` 附近（渲染分支）、`:820`–`:890` 区间（新 handler）
- Modify: `desktop/src/renderer/lib/panelActions.ts:9,23`
- Modify: `desktop/src/renderer/components/Sidebar.tsx:170`（`activeNav` 联合类型）

**Interfaces:**
- Consumes: Task 11 的 `ProjectsPanel`；Task 7 的 `window.wraith.setProjectStarred` / `archiveProjectSessions`；现有 `switchToProject` / `handleSelectSession` / `handleNewConversation` / `fetchProjects`
- Produces（App 内部 handler，Task 14 的侧栏快切下拉也会用到 `setView('projects')`）：
  - `handleOpenProject(path)` / `handleProjectNewConversation(path)` / `handleToggleProjectStar(path, starred)` / `handleOpenProjectSession(path, sessionId)` / `handleArchiveProjectChats(path, count)`

- [ ] **Step 1: 先确认热文件干净**

Run: `git diff --stat desktop/src/renderer/App.tsx desktop/src/renderer/components/Sidebar.tsx`
Expected: 空。**有别的改动就停下来问。**

- [ ] **Step 2: 加 view 类型与渲染分支**

`App.tsx:188`：

```tsx
  const [view, setView] = useState<'chat' | 'projects' | 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills' | 'memory' | 'snapshots' | 'policy' | 'browser' | 'rag' | 'tasks' | 'documents' | 'settings'>('chat')
```

`panelActions.ts:9`（`PanelId`）与 `:23`（`PANEL_LABELS`）：

```ts
  | 'memory' | 'snapshots' | 'tasks' | 'policy' | 'browser' | 'rag' | 'documents' | 'projects'
```

```ts
  documents: '文档',
  projects: '项目',
```

`Sidebar.tsx:170` 的 `activeNav`：

```tsx
  activeNav: 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills' | 'memory' | 'snapshots' | 'policy' | 'browser' | 'rag' | 'tasks' | 'documents' | 'projects' | 'settings' | null
```

`App.tsx:1138` 附近的渲染链，在 `view === 'documents'` 分支旁加：

```tsx
        ) : view === 'projects' ? (
          <ProjectsPanel
            projects={projects}
            activePath={state.workspace ?? ''}
            busy={state.turn === 'running'}
            onOpen={handleOpenProject}
            onNewConversation={handleProjectNewConversation}
            onToggleStar={handleToggleProjectStar}
            onOpenSession={handleOpenProjectSession}
            onRename={handleRenameProject}
            onArchiveChats={handleArchiveProjectChats}
            onRemove={handleRemoveProject}
            onAdd={handleAddProject}
          />
```

顶部加 `import ProjectsPanel from './components/ProjectsPanel'`。

- [ ] **Step 3: 加五个 handler**

`App.tsx`，`handleRenameProject`（约 `:875`）之后插入。**注意 `turnRef.current` 而不是 `state.turn`** —— 这是仓库既有约定（读即时快照，避免闭包陈旧漏放行）：

```tsx
  // ── 项目面板:点行 = 切项目 + 恢复最近会话 + 回聊天页 ──────────────────────────
  const handleOpenProject = useCallback(async (projectPath: string) => {
    if (turnRef.current === 'running') return
    const ok = projectPath === state.workspace ? true : await switchToProject(projectPath)
    if (ok) setView('chat')
  }, [state.workspace, switchToProject])

  // ── 项目面板:✎ = 切项目 + 新会话 + 回聊天页 ────────────────────────────────
  const handleProjectNewConversation = useCallback(async (projectPath: string) => {
    if (turnRef.current === 'running') return
    if (projectPath !== state.workspace) {
      const ok = await switchToProject(projectPath)
      if (!ok) return
    }
    setView('chat')
    await handleNewConversation()
  }, [state.workspace, switchToProject, handleNewConversation])

  // ── 项目面板:展开里点会话 = 切项目 + resume + 回聊天页 ──────────────────────
  const handleOpenProjectSession = useCallback(async (projectPath: string, sessionId: string) => {
    if (turnRef.current === 'running') return
    if (projectPath !== state.workspace) {
      const ok = await switchToProject(projectPath)
      if (!ok) return
    }
    setView('chat')
    await handleSelectSession(sessionId)
  }, [state.workspace, switchToProject, handleSelectSession])

  // ── 项目面板:重点 ─────────────────────────────────────────────────────────
  const handleToggleProjectStar = useCallback(async (projectPath: string, starred: boolean) => {
    try {
      await window.wraith.setProjectStarred(projectPath, starred)
      void fetchProjects()   // 侧栏快切下拉的前 5 名也要跟着变
    } catch (err) {
      console.error('[wraith] setProjectStarred error:', err)
    }
  }, [fetchProjects])

  // ── 项目面板:批量归档某项目的聊天(破坏性,先确认) ────────────────────────────
  const handleArchiveProjectChats = useCallback(async (projectPath: string, count: number) => {
    const entry = projects.find(p => p.path === projectPath)
    const label = entry?.name || baseName(projectPath)
    // 渲染进程不支持 window.confirm 吗?—— Electron 渲染进程里 confirm 是可用的,
    // 但本仓库既有约定是不用原生 confirm(rename 就是因为 prompt 不可用才改行内输入框)。
    // 这里用受控状态弹一个 Dialog,不用 confirm。
    setArchiveConfirm({ path: projectPath, label, count })
  }, [projects])
```

`handleArchiveProjectChats` 需要的确认弹窗状态，加在 `App.tsx` 的其他 `useState` 旁：

```tsx
  // 批量归档确认:null=没有待确认项
  const [archiveConfirm, setArchiveConfirm] = useState<{ path: string; label: string; count: number } | null>(null)
```

确认弹窗本体，放在 `App.tsx` 返回的 JSX 末尾（和其他全局弹窗同级）：

```tsx
      <Dialog open={archiveConfirm !== null} onOpenChange={o => { if (!o) setArchiveConfirm(null) }}>
        <DialogContent data-testid="archive-project-confirm" className="w-96">
          <DialogTitle>归档 {archiveConfirm?.label} 的聊天？</DialogTitle>
          <DialogDescription>
            这个项目的 {archiveConfirm?.count} 个聊天会从侧栏隐藏，可在「设置 › 归档」中找回。不删除任何内容。
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setArchiveConfirm(null)}
              className="rounded-lg px-3 py-1.5 text-xs text-fg-muted hover:bg-fg/5"
            >
              取消
            </button>
            <button
              data-testid="archive-project-confirm-ok"
              onClick={async () => {
                const target = archiveConfirm
                setArchiveConfirm(null)
                if (!target) return
                try {
                  await window.wraith.archiveProjectSessions(target.path)
                  // 归档的若是当前项目,侧栏会话列表要立刻重拉
                  if (target.path === state.workspace) void fetchSessions()
                } catch (err) {
                  console.error('[wraith] archiveProjectSessions error:', err)
                }
              }}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
            >
              归档
            </button>
          </div>
        </DialogContent>
      </Dialog>
```

顶部按需补 import：`import { Dialog, DialogContent, DialogTitle, DialogDescription } from './components/ui/dialog'`（若 App.tsx 已 import 过就不重复），以及 `baseName`（若未 import）。

> **注意**：上面那段注释里关于 `window.confirm` 的自问自答**不要抄进代码**。实现时代码里只留一行：`// 批量归档是破坏性动作,用受控 Dialog 确认(本仓库不用原生 confirm/prompt)`。

- [ ] **Step 4: typecheck 与全量测试**

Run: `cd desktop && npm run typecheck`
Expected: 0 错误

Run: `cd desktop && npm test 2>&1 | tail -10`
Expected: 通过数 ≥ 1022 + 本计划新增

- [ ] **Step 5: 真机手验**

```bash
mvn -q clean package && cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar
cd desktop && npm run dev
```

因为侧栏入口还没做（Task 14），临时在 DevTools Console 里进面板不可行（`setView` 不暴露）。**改用命令面板验**：⌘K → 输入「项目」→ 应该还搜不到（Task 13 才登记）。所以本 task 的手验推迟到 Task 14，这里只验 typecheck + 单测。在 plan 里显式记下这个顺序依赖，避免实现者在这一步卡住去改 Task 14 的东西。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/App.tsx desktop/src/renderer/lib/panelActions.ts \
        desktop/src/renderer/components/Sidebar.tsx
git commit -m "feat(desktop): 项目面板接进 App —— 六处注册表的前三处

running 守卫一律读 turnRef.current 而不是 state.turn(仓库既有约定:读即时快照,
避免闭包陈旧漏放行)。

批量归档用受控 Dialog 确认,不用原生 confirm —— 本仓库既有约定是渲染进程不碰
原生对话框(会话改名当初就是因为 window.prompt 不可用才改成行内输入框)。
确认框需要项目名和真实数量,所以确认在 App 弹而不是在菜单组件里。"
```

---

### Task 13: 六处注册表的后三处（漏了不报错）

这三处**漏了编译照过、测试照绿**，只会静默破坏「聊天 ↔ 面板对等」：用户在聊天里说「打开项目面板」时 agent 拿不到合法 panel id，动作卡永远不出现。

**顺手修一个既有漏项**：`prompts/base.md:27` 的 `open_panel` 合法值列表里**没有 `documents`** —— 上一个面板落地时漏了这一处（`ToolRegistry.java` 和 `capabilities.md` 都登记了，只有 base.md 没有）。这一 task 把 `documents` 和 `projects` 一起补上。

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java:1409`（`panels` List）、`:1415`（描述串）、`:1418`（参数描述串）
- Modify: `src/main/resources/prompts/base.md:27`
- Modify: `src/main/resources/prompts/capabilities.md`（表格加一行）
- Modify: `desktop/src/renderer/lib/commandPalette.ts:31`
- Test: 无新测试文件（`ToolRegistry` 的白名单靠下面的 grep 断言 + 手验动作卡）

**Interfaces:**
- Consumes: Task 12 的 `PanelId` 已含 `projects`
- Produces: `open_panel(projects)` 合法；⌘K 能搜到「项目」

- [ ] **Step 1: 改 `ToolRegistry` 三处字符串**

`src/main/java/com/lyhn/wraith/tool/ToolRegistry.java:1409`：

```java
        List<String> panels = List.of(
                "plugins", "automations", "im-gateway", "providers", "skills",
                "memory", "snapshots", "tasks", "policy", "browser", "rag", "documents", "projects");
```

`:1415` 的描述串：

```java
                "在桌面对话中为用户呈现「打开某功能面板」的一键入口。当你引导用户去用 Wraith 的某个功能面板"
                        + "(plugins=MCP / automations / im-gateway / providers / skills / memory / snapshots / tasks / policy / browser / rag / documents / projects)时调用。"
                        + "仅呈现入口,不产生任何文件或命令副作用。",
```

`:1418` 的参数描述串：

```java
                createParameters(new Param("panel", "string",
                        "面板 id:plugins(MCP)|automations|im-gateway|providers|skills|memory|snapshots|tasks|policy|browser|rag|documents|projects", true)),
```

- [ ] **Step 2: 改两份 prompt**

`src/main/resources/prompts/base.md:27` —— 补 `documents`（既有漏项）与 `projects`：

```markdown
15. `open_panel` - 呈现「打开某功能面板」的一键入口，参数：`{"panel": "im-gateway"}`（合法：plugins/automations/im-gateway/providers/skills/memory/snapshots/tasks/policy/browser/rag/documents/projects）
```

`src/main/resources/prompts/capabilities.md` —— 在「文档」那行（`:20`）附近加一行，照同样的三列格式：

```markdown
| **项目** | 你打开过的项目列表：搜索 / 按名称或最近活动排序 / 标记重点 / 展开看某项目最近的聊天 / 在某项目下直接开新对话 / 改别名 / 移出列表 | 项目面板（侧栏顶部的项目名点开 →「全部项目…」）。`open_panel(projects)`。⚠「移出列表」只是不再显示，不删磁盘上的目录 |
```

- [ ] **Step 3: 改命令面板**

`desktop/src/renderer/lib/commandPalette.ts:31` 附近的 `NAV_ITEMS`，加一项。放在列表**靠前**位置（项目是高频入口，不是工具）：

```ts
  { view: 'projects', label: '项目' },
```

- [ ] **Step 4: grep 断言四处都改到了**

Run:
```bash
grep -c projects src/main/java/com/lyhn/wraith/tool/ToolRegistry.java
grep -c projects src/main/resources/prompts/base.md
grep -c '\*\*项目\*\*' src/main/resources/prompts/capabilities.md
grep -c "view: 'projects'" desktop/src/renderer/lib/commandPalette.ts
grep -c documents src/main/resources/prompts/base.md
```
Expected: 依次 `3` / `1` / `1` / `1` / `1`（最后一个是补上的既有漏项）

- [ ] **Step 5: 同步 jar 并手验动作卡**

后两处（`ToolRegistry` + prompts）在 jar 里，**不同步 jar 改了也没用**：

```bash
mvn -q clean package && cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar
cd desktop && npm run dev
```

App 起来后在聊天里发：「帮我打开项目面板」
Expected: 出一张可点的动作卡（而不是模型回一句 `open_panel 失败: 未知面板 'projects'`）

再验命令面板：⌘K → 输入「项目」→ 出「项目」条目 → 回车 → 落到项目面板

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/tool/ToolRegistry.java \
        src/main/resources/prompts/base.md \
        src/main/resources/prompts/capabilities.md \
        desktop/src/renderer/lib/commandPalette.ts
git commit -m "feat(desktop): 项目面板登记后三处注册表,顺手补 base.md 漏掉的 documents

这三处漏了编译照过测试照绿,只会静默破坏「聊天↔面板对等」。而且发现上一个面板
(文档)落地时 base.md:27 的 open_panel 合法值列表就漏了 documents —— ToolRegistry
和 capabilities.md 都登记了,只有这一处没有。一起补。

ToolRegistry 里那个 id 出现在三个地方:panels List、工具描述串、参数描述串。
只改 List 的话模型不知道这个 id 合法,照样不会去调。"
```

---

### Task 14: `ProjectSwitcher` 瘦身成快切下拉

**Files:**
- Modify: `desktop/src/renderer/components/ProjectSwitcher.tsx`（131 行 → ~75 行）
- Modify: `desktop/src/renderer/components/Sidebar.tsx:296`（props 变化）
- Modify: `desktop/src/renderer/App.tsx`（传 `onOpenAllProjects`）
- Test: `desktop/test/projectSwitcher.test.tsx`（新建）

**Interfaces:**
- Consumes: Task 6 的 `ProjectView.starred`；Task 12 的 `setView('projects')`
- Produces:
  ```ts
  interface ProjectSwitcherProps {
    projects: ProjectView[]
    activePath: string
    busy: boolean
    onActivate: (path: string) => void
    onAdd: () => void
    onOpenAllProjects: () => void   // 新增:进面板
  }
  ```
  **移除**的 props：`onRemove` / `onRename`（搬进面板）
- data-testid 保留 `project-switcher` / `project-item` / `project-add`（e2e 在用），**删除** `project-rename` / `project-rename-input` / `project-remove`；新增 `project-view-all`

- [ ] **Step 1: 先查现有 e2e 引用了哪些选择器**

Run: `grep -rn "project-rename\|project-remove\|project-item\|project-switcher\|project-add" desktop/test/`
Expected: 列出所有引用点。**`project-rename` / `project-rename-input` / `project-remove` 的引用要在 Task 20（e2e）里改到面板上**；本 task 只管组件与单测，把 grep 结果记进 Task 20 的清单。

- [ ] **Step 2: 写失败测试**

新建 `desktop/test/projectSwitcher.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ProjectSwitcher from '../src/renderer/components/ProjectSwitcher'
import type { ProjectView } from '../src/shared/types'

function pv(path: string, over: Partial<ProjectView> = {}): ProjectView {
  return { path, lastUsedAt: 1, exists: true, ...over }
}

function props(over: Partial<React.ComponentProps<typeof ProjectSwitcher>> = {}) {
  return {
    projects: [pv('/w/a'), pv('/w/b')],
    activePath: '/w/a',
    busy: false,
    onActivate: vi.fn(), onAdd: vi.fn(), onOpenAllProjects: vi.fn(),
    ...over,
  }
}

function open(): void {
  fireEvent.click(screen.getByTestId('project-switcher'))
}

describe('ProjectSwitcher 触发器', () => {
  it('显示当前项目名', () => {
    render(<ProjectSwitcher {...props({ projects: [pv('/w/a', { name: '主仓' })] })} />)
    expect(screen.getByTestId('project-switcher').textContent).toMatch(/主仓/)
  })

  it('无别名时回落目录名', () => {
    render(<ProjectSwitcher {...props()} />)
    expect(screen.getByTestId('project-switcher').textContent).toMatch(/a/)
  })
})

describe('ProjectSwitcher 列表', () => {
  it('重点项目排在前面', () => {
    render(<ProjectSwitcher {...props({ projects: [pv('/w/a'), pv('/w/zz', { starred: true })] })} />)
    open()
    const items = screen.getAllByTestId('project-item').map(b => b.textContent ?? '')
    expect(items[0]).toMatch(/zz/)
  })

  it('非重点最多列 5 个,重点不占配额', () => {
    const many = [
      pv('/w/s1', { starred: true }), pv('/w/s2', { starred: true }),
      pv('/w/r1'), pv('/w/r2'), pv('/w/r3'), pv('/w/r4'), pv('/w/r5'), pv('/w/r6'), pv('/w/r7'),
    ]
    render(<ProjectSwitcher {...props({ projects: many, activePath: '/w/s1' })} />)
    open()
    expect(screen.getAllByTestId('project-item')).toHaveLength(7)   // 2 重点 + 5 其余
  })

  it('点非当前项目调 onActivate', () => {
    const p = props()
    render(<ProjectSwitcher {...p} />)
    open()
    fireEvent.click(screen.getAllByTestId('project-item')[1]!)
    expect(p.onActivate).toHaveBeenCalledWith('/w/b')
  })

  it('点当前项目只收面板,不调 onActivate', () => {
    const p = props()
    render(<ProjectSwitcher {...p} />)
    open()
    fireEvent.click(screen.getAllByTestId('project-item')[0]!)
    expect(p.onActivate).not.toHaveBeenCalled()
  })

  it('busy 时列表项禁用', () => {
    render(<ProjectSwitcher {...props({ busy: true })} />)
    open()
    expect((screen.getAllByTestId('project-item')[1] as HTMLButtonElement).disabled).toBe(true)
  })

  it('目录不存在的项目禁用', () => {
    render(<ProjectSwitcher {...props({ projects: [pv('/w/a'), pv('/w/gone', { exists: false })] })} />)
    open()
    expect((screen.getAllByTestId('project-item')[1] as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ProjectSwitcher 底部两项', () => {
  it('「全部项目…」调 onOpenAllProjects', () => {
    const p = props()
    render(<ProjectSwitcher {...p} />)
    open()
    fireEvent.click(screen.getByTestId('project-view-all'))
    expect(p.onOpenAllProjects).toHaveBeenCalled()
  })

  it('「添加项目…」调 onAdd', () => {
    const p = props()
    render(<ProjectSwitcher {...p} />)
    open()
    fireEvent.click(screen.getByTestId('project-add'))
    expect(p.onAdd).toHaveBeenCalled()
  })

  it('busy 时「添加项目…」禁用,「全部项目…」仍可用', () => {
    render(<ProjectSwitcher {...props({ busy: true })} />)
    open()
    expect((screen.getByTestId('project-add') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('project-view-all') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('ProjectSwitcher 不再承载的操作', () => {
  it('没有改名与移出按钮(搬进项目面板了)', () => {
    render(<ProjectSwitcher {...props()} />)
    open()
    expect(screen.queryByTestId('project-rename')).toBeNull()
    expect(screen.queryByTestId('project-remove')).toBeNull()
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/projectSwitcher.test.tsx`
Expected: FAIL —— `onOpenAllProjects` 不存在 / `project-view-all` 找不到 / 改名按钮还在

- [ ] **Step 4: 重写组件**

`desktop/src/renderer/components/ProjectSwitcher.tsx` 整体替换：

```tsx
import { useState } from 'react'
import { Folder, ChevronDown, Star, Plus, List } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { baseName } from '../lib/paths'
import type { ProjectView } from '../../shared/types'

/** 非重点项目在下拉里最多列几个。重点全列,不占这个配额。 */
const RECENT_LIMIT = 5

interface ProjectSwitcherProps {
  projects: ProjectView[]
  /** 当前活跃项目路径(= state.workspace)。 */
  activePath: string
  /** turn 运行中:禁激活/添加。 */
  busy: boolean
  onActivate: (path: string) => void
  onAdd: () => void
  /** 进「项目」面板看全量(搜索 / 排序 / 整理 / 看会话都在那儿)。 */
  onOpenAllProjects: () => void
}

/**
 * 侧栏的项目快切下拉。**只负责切**:列重点 + 最近 5 个,不做改名/移出 ——
 * 那些搬进了「项目」面板,同一个操作不该有两套 UI 和两套代码路径。
 */
export default function ProjectSwitcher({
  projects, activePath, busy, onActivate, onAdd, onOpenAllProjects,
}: ProjectSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false)

  const displayName = (p: ProjectView): string => p.name || baseName(p.path)
  const active = projects.find(p => p.path === activePath)

  const starred = projects.filter(p => p.starred)
  const recent = projects.filter(p => !p.starred).slice(0, RECENT_LIMIT)
  const shown = [...starred, ...recent]

  const item = (p: ProjectView): JSX.Element => (
    <button
      key={p.path}
      data-testid="project-item"
      disabled={busy || !p.exists}
      title={p.exists ? p.path : '目录不存在'}
      onClick={() => {
        setOpen(false)
        if (p.path !== activePath) onActivate(p.path)   // 点当前项目=只收面板
      }}
      className={'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs disabled:opacity-60 ' +
        (p.path === activePath ? 'bg-surface text-fg' : 'text-fg-muted enabled:hover:bg-surface/60')}
    >
      {p.starred && <Star className="h-3 w-3 shrink-0 text-warn" strokeWidth={1.5} fill="currentColor" />}
      <span className="truncate">{displayName(p)}</span>
      {p.path === activePath && <span className="ml-auto shrink-0 text-fg-subtle">✓</span>}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid="project-switcher"
          title={activePath || '默认工作目录'}
          className="mx-3 mb-1 flex w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-lg bg-fg/5 px-3 py-2 text-left text-xs text-fg hover:bg-fg/10"
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.5} />
          <span className="truncate">{active ? displayName(active) : baseName(activePath)}</span>
          <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent>
        {shown.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-fg-subtle">还没有项目</div>
        )}
        {shown.map(item)}
        <div className="my-1 border-t border-border" />
        <button
          data-testid="project-view-all"
          onClick={() => {
            setOpen(false)
            onOpenAllProjects()
          }}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60"
        >
          <List className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />全部项目…
        </button>
        <button
          data-testid="project-add"
          disabled={busy}
          onClick={() => {
            setOpen(false)
            onAdd()
          }}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60 disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />添加项目…
        </button>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 5: 改 Sidebar 与 App 的接线**

`Sidebar.tsx:296` 的 `<ProjectSwitcher>`：去掉 `onRemove` / `onRename`，加 `onOpenAllProjects`：

```tsx
        <ProjectSwitcher
          projects={projects}
          activePath={workspace}
          busy={busy}
          onActivate={onActivateProject}
          onAdd={onAddProject}
          onOpenAllProjects={onOpenAllProjects}
        />
```

`Sidebar` 的 props 接口：删 `onRemoveProject` / `onRenameProject`，加 `onOpenAllProjects: () => void`。

`App.tsx` 传给 `<Sidebar>`：删那两个，加 `onOpenAllProjects={() => setView('projects')}`。
**`handleRemoveProject` / `handleRenameProject` 本身不删** —— 它们现在由 `ProjectsPanel` 用。

- [ ] **Step 6: 跑测试与 typecheck**

Run: `cd desktop && npx vitest run test/projectSwitcher.test.tsx`
Expected: PASS（12 个）

Run: `cd desktop && npm run typecheck`
Expected: 0 错误 —— 若报 `onRemoveProject` 未使用/缺失，说明 Sidebar 与 App 两侧没改齐

Run: `cd desktop && npm test 2>&1 | tail -10`
Expected: 单测全绿（e2e 不在 `npm test` 里）

- [ ] **Step 7: 真机手验（Task 12 推迟到这里的那部分）**

```bash
mvn -q clean package && cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar
cd desktop && npm run dev
```

逐条走：
1. 点侧栏项目 chip → 出下拉，重点在上、带 ✓ 标当前
2. 点「全部项目…」→ 落到项目面板，能看到会话数与相对时间
3. 搜索框输入路径片段 → 同名不同路径的项目被筛开
4. 点「已更新」表头 → 顺序翻转
5. 点某行 `⌄` → 展开出该项目最近 5 条会话；折叠再展开**不该有载入闪烁**（缓存生效）
6. 点某行 `☆` → 变实心，回下拉看它已置顶
7. 点某行 `✎` → 切到该项目并落在新对话
8. `···` → 编辑项目 → 改别名 → 面板与下拉都跟着变
9. `···` → 归档聊天 → 出确认框且写明数量 → 确认 → 侧栏会话列表空了（归档区 UI 在 Phase D，此刻只验侧栏消失）
10. `···` → 移除：当前项目那行该是禁用的

- [ ] **Step 8: 提交**

```bash
git add desktop/src/renderer/components/ProjectSwitcher.tsx \
        desktop/src/renderer/components/Sidebar.tsx \
        desktop/src/renderer/App.tsx \
        desktop/test/projectSwitcher.test.tsx
git commit -m "feat(desktop): 侧栏下拉瘦身成纯快切 —— 改名/移出搬进面板

删掉行内的 ✎ ✕:同一个操作有两套 UI 就有两套代码路径和两套 bug。下拉只答
一个问题「我刚才在哪儿」,所以排序仍用 lastUsedAt 而不是新拿到的
lastSessionAt —— 后者要等 RPC 回来,而这个下拉必须立刻可用。

重点项目全列、不占「最近 5 个」的配额:标了重点就是要它一直在眼前。"
```

---

## Phase D — 归档 UI

### Task 15: 侧栏会话行 🗑 → 🗄

**Files:**
- Modify: `desktop/src/renderer/components/Sidebar.tsx:19`–`:98`（`SessionRow`）、props 接口
- Modify: `desktop/src/renderer/App.tsx`（`onArchiveSession` handler；`onDeleteSession` 不再传给 Sidebar）
- Test: `desktop/test/sidebarSessionArchive.test.tsx`（新建）

**Interfaces:**
- Consumes: Task 7 的 `window.wraith.setSessionArchived`
- Produces:
  - `SessionRow` props：`onDelete` → **换成** `onArchive: (id: string) => void`
  - `Sidebar` props：`onDeleteSession` → **换成** `onArchiveSession: (id: string) => void`
  - App 的 `handleArchiveSession(sessionId)`
- data-testid：**删除** `session-delete`，**新增** `session-archive`

- [ ] **Step 1: 写失败测试**

新建 `desktop/test/sidebarSessionArchive.test.tsx`。**只测 `SessionRow` 那一行的行为**，不整页渲染 Sidebar（它依赖太多 props）。为此把 `SessionRow` 从 `Sidebar.tsx` 里 `export` 出来（具名导出，默认导出仍是 `Sidebar`）：

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionRow } from '../src/renderer/components/Sidebar'
import type { SessionMeta } from '../src/shared/types'

function meta(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 's1', cwd: '/a', createdAt: 'c', updatedAt: 'u',
    provider: 'p', model: 'm', title: '当前代码有多少分支', turns: 2, ...over,
  }
}

function props(over: Partial<React.ComponentProps<typeof SessionRow>> = {}) {
  return {
    s: meta(), active: false, running: false,
    onSelect: vi.fn(), onToggleStar: vi.fn(), onRename: vi.fn(), onArchive: vi.fn(),
    ...over,
  }
}

describe('SessionRow 归档', () => {
  it('有归档按钮', () => {
    render(<SessionRow {...props()} />)
    expect(screen.getByTestId('session-archive')).toBeTruthy()
  })

  it('单击即归档,不需要二次确认', () => {
    const p = props()
    render(<SessionRow {...p} />)
    fireEvent.click(screen.getByTestId('session-archive'))
    expect(p.onArchive).toHaveBeenCalledWith('s1')
  })

  it('删除按钮已从侧栏移除', () => {
    render(<SessionRow {...props()} />)
    expect(screen.queryByTestId('session-delete')).toBeNull()
  })

  it('运行中的会话不可归档', () => {
    render(<SessionRow {...props({ running: true })} />)
    expect((screen.getByTestId('session-archive') as HTMLButtonElement).disabled).toBe(true)
  })

  it('重点与改名按钮不受影响', () => {
    render(<SessionRow {...props()} />)
    expect(screen.getByTestId('session-star')).toBeTruthy()
    expect(screen.getByTestId('session-rename')).toBeTruthy()
  })

  it('改名仍是行内输入框', () => {
    const p = props()
    render(<SessionRow {...p} />)
    fireEvent.click(screen.getByTestId('session-rename'))
    expect(screen.getByTestId('session-rename-input')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/sidebarSessionArchive.test.tsx`
Expected: FAIL —— `SessionRow` 不是具名导出 / `session-archive` 找不到

- [ ] **Step 3: 改 `SessionRow`**

`Sidebar.tsx:19` —— 加 `export`，props 里 `onDelete` 换成 `onArchive`，删掉 `confirmDel` 状态：

```tsx
export function SessionRow({ s, active, running, onSelect, onToggleStar, onRename, onArchive }: {
  s: SessionMeta; active: boolean; running: boolean
  onSelect: (id: string) => void
  onToggleStar: (id: string, starred: boolean) => void
  onRename: (id: string, name: string) => void
  onArchive: (id: string) => void
}): JSX.Element {
  // 行内改名:Electron 渲染进程不支持 window.prompt,故用就地输入框
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const editRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)   // 防 Escape 后 onBlur 二次提交
```

删掉 `const [confirmDel, setConfirmDel] = useState(false)` 与外层 `<div>` 上的 `onMouseLeave={() => setConfirmDel(false)}`。

`:104`–`:112` 那个删除按钮整块替换成归档按钮：

```tsx
      <button data-testid="session-archive"
        title={running ? '会话进行中,不可归档' : '归档(从列表收起,可在设置 › 归档中找回)'}
        disabled={running}
        onClick={() => onArchive(s.id)}
        className={'shrink-0 px-1 opacity-0 group-hover:opacity-100 text-fg-subtle hover:text-fg ' +
          (running ? 'disabled:cursor-not-allowed disabled:opacity-40' : '')}>
        <Archive className="h-3 w-3" strokeWidth={1.5} />
      </button>
```

`Sidebar.tsx:9` 的 lucide import：加 `Archive`，删 `Trash2`（若 Sidebar 别处还在用 `Trash2` 就保留）。同理 `Check` 若只被 `confirmDel` 用则删。

> 归档**不做二次确认**：它可逆（设置里能 `↩`），加确认只是多一次点击。二次确认留给真正不可逆的永久删除（Task 17）。

- [ ] **Step 4: 改 Sidebar props 与 App 接线**

`Sidebar` 的 props 接口里 `onDeleteSession` 改成 `onArchiveSession: (id: string) => void`，所有 `<SessionRow ... onDelete={onDeleteSession}>` 改成 `onArchive={onArchiveSession}`（`grep -n "onDeleteSession" desktop/src/renderer/components/Sidebar.tsx` 找齐）。

`App.tsx` 加 handler（放在 `handleSelectSession` 附近）：

```tsx
  // ── 归档一条会话:从侧栏收起,收进「设置 › 归档」。可逆,故无二次确认 ────────────
  const handleArchiveSession = useCallback(async (sessionId: string) => {
    try {
      const { ok } = await window.wraith.setSessionArchived(sessionId, true)
      if (!ok) {
        console.error('[wraith] setSessionArchived returned ok:false for', sessionId)
        return
      }
      void fetchSessions()
      // 归档的正好是当前正在看的会话:不强行跳走 —— 用户可能正读着它。
      // 侧栏没有高亮项了,下一步点任何会话或「新对话」自然离开。
    } catch (err) {
      console.error('[wraith] setSessionArchived error:', err)
    }
  }, [fetchSessions])
```

`<Sidebar>` 那里 `onDeleteSession={handleDeleteSession}` 改成 `onArchiveSession={handleArchiveSession}`。
**`handleDeleteSession` 本身保留** —— Task 17 的归档区永久删除要用它（并加 `path` 参数）。

- [ ] **Step 5: 跑测试与 typecheck**

Run: `cd desktop && npx vitest run test/sidebarSessionArchive.test.tsx`
Expected: PASS（6 个）

Run: `cd desktop && npm run typecheck`
Expected: 0 错误

Run: `cd desktop && npm test 2>&1 | tail -15`
Expected: 单测全绿。**若有既有测试引用 `session-delete`，改到 `session-archive` 或移到 Task 17 覆盖 —— 不要为了让它绿而把删除按钮留着。**

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/components/Sidebar.tsx desktop/src/renderer/App.tsx \
        desktop/test/sidebarSessionArchive.test.tsx
git commit -m "feat(desktop): 侧栏会话行的删除换成归档 —— 手滑不该丢掉跟了三小时的会话

归档是可逆的(设置里能恢复),所以单击生效不做二次确认;二次确认留给真正不可逆的
永久删除(在设置 › 归档里)。这是有意的行为回归:真想删的人从两步变成三步。

归档当前正在看的会话时不强行跳走 —— 用户可能正读着它。侧栏没有高亮项,
下一步点任何会话自然离开。"
```

---

### Task 16: `archiveView.ts` 纯函数

**Files:**
- Create: `desktop/src/renderer/lib/archiveView.ts`
- Test: `desktop/test/archiveView.test.ts`

**Interfaces:**
- Consumes: Task 7 的 `SessionMeta.archivedAt`；Task 8 的 `shortRelativeTime`
- Produces:
  - `interface ArchiveRowData { meta: SessionMeta; displayName: string; projectLabel: string }`
  - `buildArchiveRows(sessions: SessionMeta[], projects: ProjectView[]): ArchiveRowData[]` —— `projectLabel` = 项目别名 ?? 目录名；`cwd` 不在已知项目里时回落目录名
  - `filterArchive(rows: ArchiveRowData[], query: string, projectPath: string | null): ArchiveRowData[]` —— `projectPath === null` = 全部
  - `archiveProjectOptions(rows: ArchiveRowData[]): { value: string; label: string }[]` —— 供筛选下拉，首项固定 `{ value: '', label: '全部' }`

- [ ] **Step 1: 写失败测试**

新建 `desktop/test/archiveView.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { buildArchiveRows, filterArchive, archiveProjectOptions } from '../src/renderer/lib/archiveView'
import type { SessionMeta, ProjectView } from '../src/shared/types'

function meta(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 's1', cwd: '/work/wraith', createdAt: 'c', updatedAt: 'u',
    provider: 'p', model: 'm', title: '当前代码有多少分支', turns: 2,
    archivedAt: '2026-08-05T09:00:00.000Z', ...over,
  }
}

const projects: ProjectView[] = [
  { path: '/work/wraith', name: '主仓', lastUsedAt: 2, exists: true },
  { path: '/work/api-server', lastUsedAt: 1, exists: true },
]

describe('buildArchiveRows', () => {
  it('项目标签取别名', () => {
    const rows = buildArchiveRows([meta()], projects)
    expect(rows[0]!.projectLabel).toBe('主仓')
  })

  it('无别名的项目取目录名', () => {
    const rows = buildArchiveRows([meta({ cwd: '/work/api-server' })], projects)
    expect(rows[0]!.projectLabel).toBe('api-server')
  })

  it('cwd 不在已知项目里也回落目录名,不显示空白', () => {
    const rows = buildArchiveRows([meta({ cwd: '/tmp/scratch' })], projects)
    expect(rows[0]!.projectLabel).toBe('scratch')
  })

  it('displayName 优先用自定义名', () => {
    const rows = buildArchiveRows([meta({ name: '分支排查' })], projects)
    expect(rows[0]!.displayName).toBe('分支排查')
  })

  it('无自定义名时用 title', () => {
    const rows = buildArchiveRows([meta()], projects)
    expect(rows[0]!.displayName).toBe('当前代码有多少分支')
  })

  it('保持传入顺序(后端已按 archivedAt 倒序)', () => {
    const rows = buildArchiveRows([meta({ id: 'a' }), meta({ id: 'b' })], projects)
    expect(rows.map(r => r.meta.id)).toEqual(['a', 'b'])
  })
})

describe('filterArchive', () => {
  const rows = buildArchiveRows([
    meta({ id: 'a', title: '登录报 500' }),
    meta({ id: 'b', title: '重构 Foo', cwd: '/work/api-server' }),
  ], projects)

  it('按标题搜索', () => {
    expect(filterArchive(rows, '登录', null).map(r => r.meta.id)).toEqual(['a'])
  })

  it('搜索不区分大小写', () => {
    expect(filterArchive(rows, 'FOO', null).map(r => r.meta.id)).toEqual(['b'])
  })

  it('按项目筛选', () => {
    expect(filterArchive(rows, '', '/work/api-server').map(r => r.meta.id)).toEqual(['b'])
  })

  it('项目筛选为 null 时回全部', () => {
    expect(filterArchive(rows, '', null)).toHaveLength(2)
  })

  it('搜索与项目筛选是与关系', () => {
    expect(filterArchive(rows, '登录', '/work/api-server')).toEqual([])
  })
})

describe('archiveProjectOptions', () => {
  it('首项是「全部」,值为空串', () => {
    const rows = buildArchiveRows([meta()], projects)
    expect(archiveProjectOptions(rows)[0]).toEqual({ value: '', label: '全部' })
  })

  it('只列出归档条目实际涉及的项目,不列全部已知项目', () => {
    const rows = buildArchiveRows([meta({ cwd: '/work/wraith' })], projects)
    const opts = archiveProjectOptions(rows)
    expect(opts).toHaveLength(2)   // 全部 + 主仓
    expect(opts[1]).toEqual({ value: '/work/wraith', label: '主仓' })
  })

  it('同一项目多条归档只出现一次', () => {
    const rows = buildArchiveRows([meta({ id: 'a' }), meta({ id: 'b' })], projects)
    expect(archiveProjectOptions(rows)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/archiveView.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

新建 `desktop/src/renderer/lib/archiveView.ts`：

```ts
import { baseName } from './paths'
import { sessionDisplayName } from './sessionView'
import type { SessionMeta, ProjectView } from '../../shared/types'

/** 归档列表一行的渲染数据。 */
export interface ArchiveRowData {
  meta: SessionMeta
  /** name ?? title */
  displayName: string
  /** 项目别名 ?? 目录名。cwd 不在已知项目里时也回落目录名,不留空 */
  projectLabel: string
}

/** 后端已按 archivedAt 倒序,这里只做标签解析,不重排。 */
export function buildArchiveRows(sessions: SessionMeta[], projects: ProjectView[]): ArchiveRowData[] {
  const nameByPath = new Map(projects.map(p => [p.path, p.name]))
  return sessions.map(meta => ({
    meta,
    displayName: sessionDisplayName(meta),
    // 归档可能来自一个已从列表移出的项目 —— 那也得显示得出来,所以回落目录名
    projectLabel: nameByPath.get(meta.cwd) || baseName(meta.cwd),
  }))
}

/** 标题子串 + 项目路径,两者是与关系。projectPath 为 null/空 = 不按项目筛。 */
export function filterArchive(
  rows: ArchiveRowData[],
  query: string,
  projectPath: string | null,
): ArchiveRowData[] {
  const q = query.trim().toLowerCase()
  return rows.filter(r => {
    if (projectPath && r.meta.cwd !== projectPath) return false
    if (!q) return true
    return r.displayName.toLowerCase().includes(q)
  })
}

/**
 * 项目筛选下拉的选项。只列**归档条目实际涉及**的项目 ——
 * 列出全部已知项目会让下拉里出现一堆选了必然为空的项。
 */
export function archiveProjectOptions(rows: ArchiveRowData[]): { value: string; label: string }[] {
  const seen = new Map<string, string>()
  for (const r of rows) {
    if (!seen.has(r.meta.cwd)) seen.set(r.meta.cwd, r.projectLabel)
  }
  return [
    { value: '', label: '全部' },
    ...[...seen.entries()].map(([value, label]) => ({ value, label })),
  ]
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/archiveView.test.ts`
Expected: PASS（14 个）

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/lib/archiveView.ts desktop/test/archiveView.test.ts
git commit -m "feat(desktop): archiveView 纯函数 —— 项目标签必须能回落目录名

归档条目可能来自一个已经从项目列表里移出的目录。那种情况下 nameByPath 查不到,
若直接用它会显示空白。回落 baseName(cwd) 保证任何归档都有个能认出来的名字。

筛选下拉只列归档实际涉及的项目,不列全部已知项目 —— 后者会让下拉里出现
一堆选了必然为空的项。"
```

---

### Task 17: `SettingsArchive` —— 设置 › 归档

**本 task 含 spec §5.2 那个洞的回归测试**：`↩` 和 `🗑` 作用在**非当前项目**的会话上，忘传 `path` 会静默失败（`path` 是可选参数，编译和类型都拦不住）。

**Files:**
- Create: `desktop/src/renderer/components/SettingsArchive.tsx`
- Modify: `desktop/src/renderer/components/SettingsPanel.tsx:9`–`:16`（`Section` + `NAV`）、`:45`（渲染分支）
- Test: `desktop/test/settingsArchive.test.tsx`（新建）

**Interfaces:**
- Consumes: Task 16 的全部纯函数；Task 8 的 `shortRelativeTime`；Task 7 的 `window.wraith.listArchivedSessions` / `setSessionArchived` / `deleteSession` / `listProjects`
- Produces:
  ```ts
  interface SettingsArchiveProps {
    /** 归档变化后让 App 重拉侧栏会话列表(恢复的可能是当前项目的) */
    onArchiveChanged: () => void
  }
  export default function SettingsArchive(props: SettingsArchiveProps): JSX.Element
  ```
- data-testid：`settings-archive` / `settings-nav-archive` / `archive-search` / `archive-project-filter` / `archive-row` / `archive-restore` / `archive-delete` / `archive-empty` / `archive-no-match`

- [ ] **Step 1: 写失败测试**

新建 `desktop/test/settingsArchive.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SettingsArchive from '../src/renderer/components/SettingsArchive'
import type { SessionMeta, ProjectView } from '../src/shared/types'

function meta(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 's1', cwd: '/work/wraith', createdAt: 'c', updatedAt: 'u',
    provider: 'p', model: 'm', title: '当前代码有多少分支', turns: 2,
    archivedAt: '2026-08-05T09:00:00.000Z', ...over,
  }
}

const projects: ProjectView[] = [
  { path: '/work/wraith', name: '主仓', lastUsedAt: 2, exists: true },
  { path: '/work/api-server', lastUsedAt: 1, exists: true },
]

let listArchived: ReturnType<typeof vi.fn>
let setArchived: ReturnType<typeof vi.fn>
let deleteSession: ReturnType<typeof vi.fn>
let onChanged: ReturnType<typeof vi.fn>

beforeEach(() => {
  listArchived = vi.fn().mockResolvedValue({
    sessions: [meta(), meta({ id: 's2', title: '重构 Foo', cwd: '/work/api-server' })],
  })
  setArchived = vi.fn().mockResolvedValue({ ok: true })
  deleteSession = vi.fn().mockResolvedValue({ ok: true })
  onChanged = vi.fn()
  ;(globalThis as unknown as { window: { wraith: unknown } }).window.wraith = {
    listProjects: vi.fn().mockResolvedValue({ projects }),
    listArchivedSessions: listArchived,
    setSessionArchived: setArchived,
    deleteSession,
  }
})

async function renderPanel(): Promise<void> {
  render(<SettingsArchive onArchiveChanged={onChanged} />)
  await waitFor(() => expect(screen.getAllByTestId('archive-row')).toHaveLength(2))
}

describe('SettingsArchive 拉取', () => {
  it('用全部已知项目路径拉跨项目归档', async () => {
    await renderPanel()
    expect(listArchived).toHaveBeenCalledWith(['/work/wraith', '/work/api-server'])
  })

  it('每行显示项目标签与归档相对时间', async () => {
    await renderPanel()
    expect(screen.getByText(/主仓/)).toBeTruthy()
    expect(screen.getByText(/api-server/)).toBeTruthy()
    expect(screen.getAllByText(/归档于/).length).toBeGreaterThan(0)
  })

  it('刚归档的显示「刚刚归档」而不是「归档于 刚刚前」', async () => {
    const justNow = new Date().toISOString()
    listArchived.mockResolvedValue({ sessions: [meta({ archivedAt: justNow })] })
    render(<SettingsArchive onArchiveChanged={onChanged} />)

    await waitFor(() => expect(screen.getByTestId('archive-row')).toBeTruthy())
    expect(screen.getByText(/刚刚归档/)).toBeTruthy()
    expect(screen.queryByText(/刚刚前/)).toBeNull()
  })

  it('一条都没有时出空态与引导', async () => {
    listArchived.mockResolvedValue({ sessions: [] })
    render(<SettingsArchive onArchiveChanged={onChanged} />)
    await waitFor(() => expect(screen.getByTestId('archive-empty')).toBeTruthy())
  })
})

describe('SettingsArchive 跨项目 path 参数(spec §5.2 回归)', () => {
  it('恢复时必须把该条的 cwd 作为第三个参数传出去', async () => {
    await renderPanel()

    fireEvent.click(screen.getAllByTestId('archive-restore')[1]!)

    await waitFor(() => expect(setArchived).toHaveBeenCalled())
    expect(setArchived).toHaveBeenCalledWith('s2', false, '/work/api-server')
  })

  it('永久删除时必须把该条的 cwd 作为第二个参数传出去', async () => {
    await renderPanel()

    fireEvent.click(screen.getAllByTestId('archive-delete')[1]!)   // 第一次点=进确认态
    fireEvent.click(screen.getAllByTestId('archive-delete')[1]!)   // 第二次点=真删

    await waitFor(() => expect(deleteSession).toHaveBeenCalled())
    expect(deleteSession).toHaveBeenCalledWith('s2', '/work/api-server')
  })
})

describe('SettingsArchive 二步确认', () => {
  it('第一次点删除不真删', async () => {
    await renderPanel()
    fireEvent.click(screen.getAllByTestId('archive-delete')[0]!)
    expect(deleteSession).not.toHaveBeenCalled()
  })

  it('恢复不需要二步确认', async () => {
    await renderPanel()
    fireEvent.click(screen.getAllByTestId('archive-restore')[0]!)
    await waitFor(() => expect(setArchived).toHaveBeenCalledTimes(1))
  })
})

describe('SettingsArchive 成功后的收尾', () => {
  it('恢复成功后该行消失并通知上层', async () => {
    await renderPanel()
    fireEvent.click(screen.getAllByTestId('archive-restore')[0]!)
    await waitFor(() => expect(screen.getAllByTestId('archive-row')).toHaveLength(1))
    expect(onChanged).toHaveBeenCalled()
  })

  it('删除成功后该行消失', async () => {
    await renderPanel()
    fireEvent.click(screen.getAllByTestId('archive-delete')[0]!)
    fireEvent.click(screen.getAllByTestId('archive-delete')[0]!)
    await waitFor(() => expect(screen.getAllByTestId('archive-row')).toHaveLength(1))
  })
})

describe('SettingsArchive 失败回滚', () => {
  it('恢复回 ok:false 时那一行要回到列表', async () => {
    setArchived.mockResolvedValue({ ok: false })
    await renderPanel()

    fireEvent.click(screen.getAllByTestId('archive-restore')[0]!)

    await waitFor(() => expect(setArchived).toHaveBeenCalled())
    // 乐观移除后必须回滚 —— 否则用户以为恢复成功了,刷新一下它又回到归档里
    await waitFor(() => expect(screen.getAllByTestId('archive-row')).toHaveLength(2))
  })

  it('恢复抛异常时那一行也要回到列表', async () => {
    setArchived.mockRejectedValue(new Error('backend down'))
    await renderPanel()

    fireEvent.click(screen.getAllByTestId('archive-restore')[0]!)

    await waitFor(() => expect(setArchived).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByTestId('archive-row')).toHaveLength(2))
  })
})

describe('SettingsArchive 搜索与筛选', () => {
  it('搜索只留命中的', async () => {
    await renderPanel()
    fireEvent.change(screen.getByTestId('archive-search'), { target: { value: '重构' } })
    expect(screen.getAllByTestId('archive-row')).toHaveLength(1)
  })

  it('都不命中出「没有匹配」而不是空白', async () => {
    await renderPanel()
    fireEvent.change(screen.getByTestId('archive-search'), { target: { value: 'zzzz' } })
    expect(screen.getByTestId('archive-no-match')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/settingsArchive.test.tsx`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

新建 `desktop/src/renderer/components/SettingsArchive.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { Search, Undo2, Trash2, Check, Archive } from 'lucide-react'
import Select from './ui/select'
import { buildArchiveRows, filterArchive, archiveProjectOptions, type ArchiveRowData } from '../lib/archiveView'
import { shortRelativeTime } from '../lib/projectsView'
import type { SessionMeta, ProjectView } from '../../shared/types'

export interface SettingsArchiveProps {
  /** 归档集合变了 → 让 App 重拉侧栏会话列表(恢复的可能是当前项目的会话) */
  onArchiveChanged: () => void
}

/**
 * 「归档于 3 小时前」/「刚刚归档」。
 * 不能直接写 `归档于 ${shortRelativeTime(...)}前` —— 那在「刚刚」档会渲染成
 * 「归档于 刚刚前」。分档拼句子,不是拼字符串。
 */
function archivedAgo(iso: string | null, now: number): string {
  const rel = shortRelativeTime(iso, now)
  if (rel === '—') return '归档时间未知'
  if (rel === '刚刚') return '刚刚归档'
  return `归档于 ${rel}前`
}

export default function SettingsArchive({ onArchiveChanged }: SettingsArchiveProps): JSX.Element {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [query, setQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const { projects: ps } = await window.wraith.listProjects()
        if (!alive) return
        setProjects(ps)
        const { sessions: ss } = await window.wraith.listArchivedSessions(ps.map(p => p.path))
        if (alive) setSessions(ss)
      } catch (err) {
        console.error('[wraith] listArchivedSessions error:', err)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const rows = buildArchiveRows(sessions, projects)
  const shown = filterArchive(rows, query, projectFilter || null)

  /** 乐观移除 + 失败回滚。归档区的写操作**必须传 path** —— 它是跨项目列表。 */
  const mutate = async (row: ArchiveRowData, op: 'restore' | 'delete'): Promise<void> => {
    const id = row.meta.id
    const path = row.meta.cwd
    const before = sessions
    setSessions(s => s.filter(x => x.id !== id))   // 乐观
    try {
      const { ok } = op === 'restore'
        ? await window.wraith.setSessionArchived(id, false, path)
        : await window.wraith.deleteSession(id, path)
      if (!ok) {
        setSessions(before)   // 回滚:不能让用户以为成了
        return
      }
      onArchiveChanged()
    } catch (err) {
      console.error('[wraith] archive mutate error:', err)
      setSessions(before)
    }
  }

  if (!loading && sessions.length === 0) {
    return (
      <div data-testid="settings-archive" className="flex flex-col items-center gap-3 py-16">
        <Archive className="h-10 w-10 text-fg-subtle" strokeWidth={1.25} />
        <p data-testid="archive-empty" className="text-sm text-fg-muted">还没有归档的聊天</p>
        <p className="text-xs text-fg-subtle">在侧栏的会话上点归档图标即可归档。</p>
      </div>
    )
  }

  return (
    <div data-testid="settings-archive">
      <h2 className="text-sm font-bold text-fg">归档的聊天</h2>
      <p className="mt-1 text-xs text-fg-subtle">
        归档的聊天不在侧栏显示，但内容都还在 —— 恢复后一切照旧。
      </p>

      <div className="mt-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" strokeWidth={1.5} />
          <input
            data-testid="archive-search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索"
            className="w-full rounded-lg border border-border bg-bg py-1.5 pl-8 pr-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
          />
        </div>
        <Select
          testId="archive-project-filter"
          options={archiveProjectOptions(rows)}
          value={projectFilter}
          onChange={setProjectFilter}
          className="w-40 shrink-0"
        />
      </div>

      {shown.length === 0 && (
        <p data-testid="archive-no-match" className="py-8 text-center text-xs text-fg-subtle">
          没有匹配的聊天
        </p>
      )}

      <div className="mt-3">
        {shown.map(r => (
          <div
            key={r.meta.id}
            data-testid="archive-row"
            className="group flex items-center gap-2 border-b border-border/60 py-2.5"
            onMouseLeave={() => setConfirmDel(null)}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-fg">{r.displayName}</div>
              <div className="mt-0.5 text-3xs text-fg-subtle">
                {r.projectLabel} · {r.meta.turns} 轮 · {archivedAgo(r.meta.archivedAt ?? null, now)}
              </div>
            </div>
            <button
              data-testid="archive-restore"
              title="恢复到侧栏"
              onClick={() => void mutate(r, 'restore')}
              className="shrink-0 rounded p-1 text-fg-subtle opacity-0 hover:text-accent group-hover:opacity-100"
            >
              <Undo2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <button
              data-testid="archive-delete"
              title={confirmDel === r.meta.id ? '确认永久删除?' : '永久删除'}
              onClick={() => {
                if (confirmDel !== r.meta.id) { setConfirmDel(r.meta.id); return }
                setConfirmDel(null)
                void mutate(r, 'delete')
              }}
              className={'shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 ' +
                (confirmDel === r.meta.id ? 'text-danger opacity-100' : 'text-fg-subtle hover:text-danger')}
            >
              {confirmDel === r.meta.id
                ? <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                : <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

> `Select` 的签名已核对过（`ui/select.tsx:23`）：`{ value, options, onChange, disabled?, placeholder?, testId?, className?, contentClassName? }`，且 `testId` 会落在触发按钮上 —— 所以不用额外包一层 div。

- [ ] **Step 4: 接进 SettingsPanel**

`SettingsPanel.tsx:9`–`:16`：

```tsx
type Section = 'me' | 'interface' | 'pets' | 'archive' | 'pricing' | 'about'
const NAV: { key: Section; label: string; Icon: LucideIcon }[] = [
  { key: 'me', label: '我', Icon: User },
  { key: 'interface', label: '界面', Icon: Palette },
  { key: 'pets', label: '宠物', Icon: Bot },
  { key: 'archive', label: '归档', Icon: Archive },
  { key: 'pricing', label: '计价', Icon: Coins },
  { key: 'about', label: '关于', Icon: Info },
]
```

`:2` 的 lucide import 加 `Archive`；`:7` 后加 `import SettingsArchive from './SettingsArchive'`。

props 加一个转发：

```tsx
export default function SettingsPanel({ onBack, onOpenProviders, onArchiveChanged }: {
  onBack: () => void
  onOpenProviders: () => void
  onArchiveChanged: () => void
}): JSX.Element {
```

`:45` 附近的渲染链加：

```tsx
          {active === 'archive' && <SettingsArchive onArchiveChanged={onArchiveChanged} />}
```

`App.tsx` 里 `<SettingsPanel>` 传 `onArchiveChanged={() => void fetchSessions()}`。

- [ ] **Step 5: 跑测试与 typecheck**

Run: `cd desktop && npx vitest run test/settingsArchive.test.tsx`
Expected: PASS（15 个）

Run: `cd desktop && npm run typecheck`
Expected: 0 错误

- [ ] **Step 6: 真机手验**

```bash
mvn -q clean package && cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar
cd desktop && npm run dev
```

**关键是验跨项目那条路**：
1. 在项目 A 归档一个会话
2. 切到项目 B
3. 进设置 › 归档 → 应该看到 A 的那条，带 A 的项目标签
4. 点 `↩` 恢复 → 那行消失
5. 切回项目 A → 侧栏里它回来了

若第 4 步「点了没反应」或「那行消失但重进设置又回来」，就是 `path` 没传到（spec §5.2 那个洞）。

- [ ] **Step 7: 提交**

```bash
git add desktop/src/renderer/components/SettingsArchive.tsx \
        desktop/src/renderer/components/SettingsPanel.tsx \
        desktop/src/renderer/App.tsx \
        desktop/test/settingsArchive.test.tsx
git commit -m "feat(desktop): 设置 › 归档 —— 跨项目列表,写操作必须带 path

这是 spec §5.2 那个洞的落地防线:归档区是跨项目的,而 setSessionArchived /
deleteSession 不传 path 就跑在活跃项目的 store 上,静默失败。path 是可选参数,
编译和类型都拦不住,所以留了两条测试专门断言「第三个参数是该条的 cwd」。

乐观移除失败必须回滚。否则用户看到那行消失、以为恢复成功了,重进设置它又在那儿。"
```

---

## Phase E — CLI `/archive`

### Task 18: `/archive` 六命令派发

解析层（`CliCommandParser`）与提示层（`Main.java:3429` 的 `SlashCommandHint`）**已在工作区里写好、未提交**。本 task 只补派发，实现走 `SessionStore` 而非独立存储 —— CLI 归档的东西桌面「设置 › 归档」里能看见，反之亦然。

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`（REPL 的 switch 加六个 `case`；新增 `handleArchiveCommand` 等私有方法）
- Test: `src/test/java/com/lyhn/wraith/cli/CliCommandParserArchiveTest.java`（新建）

**Interfaces:**
- Consumes: Task 2 的 `SessionStore.setArchived` / `listArchived` / `rename`；Task 3 的 `ProjectSessionReader`；已有的 `sessionStore.persist` / `resume` / `peek` / `deleteById` / `currentId`；已有的 `CliCommandParser.CommandType.ARCHIVE*`
- Produces: 六个可用命令。无新对外接口。

- [ ] **Step 1: 确认解析层还在工作区里**

Run: `git diff --stat src/main/java/com/lyhn/wraith/cli/CliCommandParser.java src/main/java/com/lyhn/wraith/cli/Main.java`
Expected: `CliCommandParser.java` 有约 33 行新增（六个 `CommandType` + 匹配），`Main.java` 有 6 行 `SlashCommandHint`。
**若 `CliCommandParser.java` 的改动不见了**（被谁 checkout 掉了），照 spec §2.8 的表重写：六个枚举值 + 匹配，且**子命令必须先于裸 `/archive` 匹配**，否则 `"/archive list"` 会被当成给 `/archive` 的参数。

- [ ] **Step 2: 写失败测试（解析层边界）**

新建 `src/test/java/com/lyhn/wraith/cli/CliCommandParserArchiveTest.java`：

```java
package com.lyhn.wraith.cli;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class CliCommandParserArchiveTest {

    private CliCommandParser.ParsedCommand parse(String input) {
        return CliCommandParser.parse(input);
    }

    @Test
    void bareArchiveHasNoPayload() {
        CliCommandParser.ParsedCommand c = parse("/archive");
        assertEquals(CliCommandParser.CommandType.ARCHIVE, c.type());
        assertNull(c.payload());
    }

    @Test
    void archiveWithTitleCarriesRemainderAsPayload() {
        CliCommandParser.ParsedCommand c = parse("/archive 修一下登录");
        assertEquals(CliCommandParser.CommandType.ARCHIVE, c.type());
        assertEquals("修一下登录", c.payload());
    }

    @Test
    void subcommandsWinOverBareArchive() {
        // 这条是关键:若裸 /archive 先匹配,"list" 会被当成自定义标题
        assertEquals(CliCommandParser.CommandType.ARCHIVE_LIST, parse("/archive list").type());
        assertEquals(CliCommandParser.CommandType.ARCHIVE_CLEAR, parse("/archive clear").type());
    }

    @Test
    void showRestoreDeleteCarryId() {
        assertEquals("20260805-101010-ab12", parse("/archive show 20260805-101010-ab12").payload());
        assertEquals(CliCommandParser.CommandType.ARCHIVE_SHOW, parse("/archive show x").type());
        assertEquals(CliCommandParser.CommandType.ARCHIVE_RESTORE, parse("/archive restore x").type());
        assertEquals(CliCommandParser.CommandType.ARCHIVE_DELETE, parse("/archive delete x").type());
    }

    @Test
    void caseInsensitive() {
        assertEquals(CliCommandParser.CommandType.ARCHIVE_LIST, parse("/ARCHIVE LIST").type());
    }

    @Test
    void archivedIsNotAnArchiveCommand() {
        // 前缀相近的输入不能被误吞
        assertNotEquals(CliCommandParser.CommandType.ARCHIVE, parse("/archived").type());
        assertNotEquals(CliCommandParser.CommandType.ARCHIVE_LIST, parse("/archived").type());
    }
}
```

> `CliCommandParser` 是 package-private（`final class`），所以测试放在同包 `com.lyhn.wraith.cli` 下。若 `parse` 的实际签名不是 `static ParsedCommand parse(String)`，先 `grep -n "ParsedCommand parse" src/main/java/com/lyhn/wraith/cli/CliCommandParser.java` 对齐。

- [ ] **Step 3: 跑测试确认通过或失败**

Run: `mvn test -Dtest=CliCommandParserArchiveTest -DskipTests=false`
Expected: **可能直接 PASS** —— 解析层已经写好了。若 `archivedIsNotAnArchiveCommand` 失败，说明匹配用的是 `startsWith("/archive")` 而不是 `equalsIgnoreCase("/archive")` + `regionMatches(..., "/archive ", ...)`，按后者修。

- [ ] **Step 4: 加六个 `case` 与派发方法**

`Main.java` 的 REPL switch 里，`case EXPORT`（`:905`）之后插入：

```java
                    case ARCHIVE -> {
                        handleArchiveCurrent(command.payload(), sessionStore, reactAgent, renderer, ui);
                        continue;
                    }
                    case ARCHIVE_LIST -> {
                        handleArchiveList(sessionStore, ui);
                        continue;
                    }
                    case ARCHIVE_SHOW -> {
                        handleArchiveShow(command.payload(), sessionStore, ui);
                        continue;
                    }
                    case ARCHIVE_RESTORE -> {
                        handleArchiveRestore(command.payload(), sessionStore, reactAgent, ui);
                        continue;
                    }
                    case ARCHIVE_DELETE -> {
                        handleArchiveDelete(command.payload(), sessionStore, ui);
                        continue;
                    }
                    case ARCHIVE_CLEAR -> {
                        archiveClearPending[0] = handleArchiveClear(sessionStore, ui, archiveClearPending[0]);
                        continue;
                    }
```

`archiveClearPending` 是 `/archive clear` 的二次确认状态，声明在 REPL 循环**之前**（和其他 `boolean[] ` 风格的循环外状态放一起）：

```java
            // /archive clear 的二次确认:第一次打印警告置 true,紧接着再输一次才真清
            boolean[] archiveClearPending = { false };
```

**并且**：任何**非** `ARCHIVE_CLEAR` 的输入都要把它复位（否则「clear → 别的命令 → clear」会被当成连续两次）。在 switch **之前**加一行：

```java
                    if (command.type() != CliCommandParser.CommandType.ARCHIVE_CLEAR) {
                        archiveClearPending[0] = false;
                    }
```

六个私有静态方法，放在 `handleExportCommand` 附近：

```java
    /**
     * /archive [标题]:落盘当前对话 → 标归档 → 清空。
     *
     * <p>不新建存储:先 persist 成正常会话再打 archivedAt 标记。这样 .cards.jsonl(动作卡)
     * 与 starred 都留在原文件里,恢复是无损的;桌面「设置 › 归档」看到的也是同一批东西。
     */
    private static void handleArchiveCurrent(String title, SessionStore sessionStore,
                                             Agent reactAgent, EventStreamRenderer renderer,
                                             ConsoleUi ui) {
        sessionStore.persist(reactAgent.getConversationHistory());
        String id = sessionStore.currentId();
        if (id == null) {
            ui.println("当前没有可归档的对话。\n");
            return;
        }
        if (title != null && !title.isBlank()) {
            sessionStore.rename(id, title.strip());
        }
        if (!sessionStore.setArchived(id, true)) {
            ui.println("❌ 归档失败（会话文件写入出错）\n");
            return;
        }
        // 与 /clear 同一套清空动作:归档 = 收起来 + 从干净状态继续
        reactAgent.clearHistory();
        sessionStore.startNew();
        renderer.renderTodos(java.util.List.of());
        ui.println("🗄️ 已归档并清空当前对话。用 /archive list 回看，或到桌面端「设置 › 归档」。\n");
    }

    /** /archive list:只列**当前项目**的归档(CLI 天生是项目内的工作台)。 */
    private static void handleArchiveList(SessionStore sessionStore, ConsoleUi ui) {
        java.util.List<com.lyhn.wraith.session.SessionMeta> metas = sessionStore.listArchived(0);
        if (metas.isEmpty()) {
            ui.println("当前项目还没有归档的聊天。\n");
            return;
        }
        ui.println("已归档的聊天（" + metas.size() + " 条）：");
        for (com.lyhn.wraith.session.SessionMeta m : metas) {
            String label = m.name() != null && !m.name().isBlank() ? m.name() : m.title();
            ui.println("  " + m.id() + "  " + label + "  （" + m.turns() + " 轮，归档于 " + m.archivedAt() + "）");
        }
        ui.println("\n只显示当前项目；全部归档见桌面端「设置 › 归档」。\n");
    }

    /** /archive show <id>:只读预览,不切活跃会话。 */
    private static void handleArchiveShow(String id, SessionStore sessionStore, ConsoleUi ui) {
        if (id == null || id.isBlank()) {
            ui.println("❌ 请提供归档 id，例如 /archive show 20260805-101010-ab12\n");
            return;
        }
        java.util.List<com.lyhn.wraith.llm.LlmClient.Message> msgs = sessionStore.peek(id.strip());
        if (msgs.isEmpty()) {
            ui.println("❌ 找不到这条归档：" + id.strip() + "\n");
            return;
        }
        for (com.lyhn.wraith.llm.LlmClient.Message m : msgs) {
            String content = m.content() == null ? "" : m.content();
            ui.println("[" + m.role() + "] " + (content.length() > 500 ? content.substring(0, 500) + "…" : content));
        }
        ui.println();
    }

    /** /archive restore <id>:取消归档 + 载回当前对话。 */
    private static void handleArchiveRestore(String id, SessionStore sessionStore,
                                             Agent reactAgent, ConsoleUi ui) {
        if (id == null || id.isBlank()) {
            ui.println("❌ 请提供归档 id，例如 /archive restore 20260805-101010-ab12\n");
            return;
        }
        String sid = id.strip();
        if (!sessionStore.setArchived(sid, false)) {
            ui.println("❌ 找不到这条归档：" + sid + "\n");
            return;
        }
        java.util.List<com.lyhn.wraith.llm.LlmClient.Message> msgs = sessionStore.resume(sid);
        reactAgent.restoreHistory(msgs);
        ui.println("↩️ 已恢复并载回当前对话（" + msgs.size() + " 条消息）。\n");
    }

    /** /archive delete <id>:永久删除。 */
    private static void handleArchiveDelete(String id, SessionStore sessionStore, ConsoleUi ui) {
        if (id == null || id.isBlank()) {
            ui.println("❌ 请提供归档 id，例如 /archive delete 20260805-101010-ab12\n");
            return;
        }
        boolean removed = sessionStore.deleteById(id.strip());
        ui.println(removed ? "🗑️ 已删除。\n" : "❌ 找不到这条归档：" + id.strip() + "\n");
    }

    /**
     * /archive clear:清空当前项目全部归档。二次确认 —— 返回新的 pending 态。
     * 第一次调用(pending=false)只打警告,返回 true;紧接着再来一次才真清。
     */
    private static boolean handleArchiveClear(SessionStore sessionStore, ConsoleUi ui, boolean pending) {
        java.util.List<com.lyhn.wraith.session.SessionMeta> metas = sessionStore.listArchived(0);
        if (metas.isEmpty()) {
            ui.println("当前项目没有归档可清。\n");
            return false;
        }
        if (!pending) {
            ui.println("⚠️ 这会永久删除当前项目的 " + metas.size() + " 条归档，不可恢复。"
                    + "确定就再输一次 /archive clear。\n");
            return true;
        }
        int n = 0;
        for (com.lyhn.wraith.session.SessionMeta m : metas) {
            if (sessionStore.deleteById(m.id())) {
                n++;
            }
        }
        ui.println("🗑️ 已删除 " + n + " 条归档。\n");
        return false;
    }
```

> **签名对齐**：`ConsoleUi` / `EventStreamRenderer` / `Agent` 的具体类型名按 `Main.java` 里 `handleExportCommand` 的实际参数抄（`grep -n "private static void handleExportCommand" -A 3 src/main/java/com/lyhn/wraith/cli/Main.java`）。上面用的 `ui.println` / `reactAgent.clearHistory()` / `reactAgent.restoreHistory(...)` / `renderer.renderTodos(...)` 都是 `/clear` 分支（`:536`–`:542`）与 `resume` 路径里现有的调用，不是新 API。

- [ ] **Step 5: 编译 + 全量回归**

Run: `mvn -q compile`
Expected: 成功

Run: `mvn test -DskipTests=false 2>&1 | tail -20`
Expected: 通过数 ≥ 1655 + 本计划新增，失败/错误 0

- [ ] **Step 6: 真机手验（交互 CLI）**

```bash
mvn -q clean package
java -jar target/wraith-1.0-SNAPSHOT.jar
```

逐条走：
1. 随便聊一句，然后 `/archive 试一下归档` → 提示已归档并清空，对话区空了
2. `/archive list` → 看到那条，标题是「试一下归档」（不是首条消息摘要）
3. `/archive show <id>` → 打出消息，**且当前对话仍是空的**（只读预览没切走）
4. `/archive restore <id>` → 提示载回 N 条，接着问一句能接上上下文
5. `/archive list` → 那条不见了（已取消归档）
6. `/archive clear` → 只打警告
7. 输 `/help` 再输 `/archive clear` → **应该又只打警告**（pending 被别的命令复位了）
8. `/archive clear` 连输两次 → 真清

**桌面互通**：回桌面端进「设置 › 归档」，第 1 步归档的那条应该在里面。

- [ ] **Step 7: 提交**

```bash
git add src/main/java/com/lyhn/wraith/cli/Main.java \
        src/main/java/com/lyhn/wraith/cli/CliCommandParser.java \
        src/test/java/com/lyhn/wraith/cli/CliCommandParserArchiveTest.java
git commit -m "feat(cli): /archive 六命令派发 —— 走 SessionStore,与桌面共用一个归档区

/archive 的实现是「先 persist 成正常会话,再打 archivedAt 标记,再照 /clear 清空」。
对用户的观感就是「归档并清空」,但存储统一到会话文件上:.cards.jsonl(动作卡)和
starred 都留在原文件里,恢复无损,桌面「设置 › 归档」看到的是同一批东西。

/archive clear 的二次确认状态在**任何别的命令**之后都要复位,否则
「clear → help → clear」会被当成连续两次确认,一下清光。"
```

---

## Phase F — e2e

### Task 19: e2e 改写与新增

**Files:**
- Modify: `desktop/test/shell.e2e.ts`（或 grep 出来的实际 e2e 文件）—— 改掉失效选择器
- Test: 同上，新增两条用例

**Interfaces:**
- Consumes: 全部前置 task
- Produces: 无（终点）

- [ ] **Step 1: 先跑两次基线（改动前）**

`shell.e2e` 有一小簇负载相关抖动（审批族）。**不先记基线，后面分不清是自己改坏的还是抖动。**

```bash
git stash
cd desktop && npm run e2e 2>&1 | tail -20      # 第一次
cd desktop && npm run e2e 2>&1 | tail -20      # 第二次
git stash pop
```

把两次的「通过/失败」数记在这里再往下走。

- [ ] **Step 2: 找出全部失效选择器**

Run:
```bash
grep -rn "project-rename\|project-rename-input\|project-remove\|session-delete" desktop/test/
```

预期命中三类，逐类处理：

| 失效选择器 | 现在在哪 | 怎么改 |
|---|---|---|
| `project-rename` / `project-rename-input` | 项目面板 `···` → 编辑项目 | 改成：`project-switcher` → `project-view-all` → `project-row-menu` → `project-menu-edit` → `project-edit-name` → `project-edit-save` |
| `project-remove` | 项目面板 `···` → 移除 | 改成 `project-row-menu` → `project-menu-remove` |
| `session-delete` | 已从侧栏移除 | 改成「`session-archive` 归档 → 进设置 › 归档 → `archive-delete` 点两次」 |

- [ ] **Step 3: 逐个改掉失效用例**

以「项目重命名」为例，改写后的形状（按你项目里 e2e 的实际 helper 调整 `page` 取法）：

```ts
test('在项目面板里给项目改别名', async () => {
  await page.getByTestId('project-switcher').click()
  await page.getByTestId('project-view-all').click()
  await expect(page.getByTestId('projects-panel')).toBeVisible()

  await page.getByTestId('project-row-menu').first().click()
  await page.getByTestId('project-menu-edit').click()
  await page.getByTestId('project-edit-name').fill('改过的名字')
  await page.getByTestId('project-edit-save').click()

  await expect(page.getByText('改过的名字')).toBeVisible()
})
```

- [ ] **Step 4: 加两条新用例**

```ts
test('项目面板:搜索后切项目,落回聊天页', async () => {
  await page.getByTestId('project-switcher').click()
  await page.getByTestId('project-view-all').click()
  await expect(page.getByTestId('projects-panel')).toBeVisible()

  await page.getByTestId('projects-search').fill('wraith')
  await page.getByTestId('project-row-open').first().click()

  // 回到聊天页 = 输入框可见
  await expect(page.getByTestId('composer-input')).toBeVisible()
})

test('归档往返:侧栏归档 → 设置里找到 → 恢复 → 侧栏又有', async () => {
  // 先确保至少有一个会话(照本文件既有的「发一句话」helper 造一个)
  const before = await page.getByTestId('conversation-item').count()
  expect(before).toBeGreaterThan(0)

  await page.getByTestId('conversation-item').first().hover()
  await page.getByTestId('session-archive').first().click()
  await expect(page.getByTestId('conversation-item')).toHaveCount(before - 1)

  // 进设置 › 归档
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('settings-nav-archive').click()
  await expect(page.getByTestId('archive-row').first()).toBeVisible()

  // 恢复
  await page.getByTestId('archive-restore').first().click()
  await page.getByTestId('settings-back').click()
  await expect(page.getByTestId('conversation-item')).toHaveCount(before)
})
```

> `composer-input` / `nav-settings` / `conversation-item` 这几个 testid 按本文件既有用例里实际用的名字对齐（`grep -n "getByTestId" desktop/test/shell.e2e.ts | head -40`）。

- [ ] **Step 5: 跑 e2e 两次，与 Step 1 的基线比**

```bash
cd desktop && npm run e2e 2>&1 | tail -20
cd desktop && npm run e2e 2>&1 | tail -20
```

Expected: 通过数 = 基线 + 2（新增两条），失败集合**与基线的失败集合相同**（那一簇审批族抖动允许出现，但不能出现新面孔）。

- [ ] **Step 6: 提交**

```bash
git add desktop/test/
git commit -m "test(desktop): e2e 跟上 —— 改名/移出搬进面板,删除变成归档往返

三类选择器失效:project-rename/project-remove 搬到面板的 ··· 菜单里,
session-delete 整个没了(侧栏改成归档)。后者的用例重写成一个真正的往返:
侧栏归档 → 设置里找到 → 恢复 → 侧栏又有。这条用例正好也覆盖了跨项目
path 参数那个洞在真机上的表现。

改动前先 stash 跑了两次基线 —— shell.e2e 有一簇负载相关的审批族抖动,
不记基线分不清是改坏的还是抖的。"
```

---

## 自查（写完计划后的核对）

### 1. spec 覆盖

| spec 章节 | 覆盖的 task |
|---|---|
| §1.1 项目面板搜索 / 排序 / 重点 / 展开 / 新建对话 / `···` | Task 8–11 |
| §1.1 侧栏快切下拉 | Task 14 |
| §1.1 会话归档 / 取消 / 永久删除 | Task 1、2、15、17 |
| §1.1 设置 › 归档跨项目列表 | Task 16、17 |
| §1.1 CLI `/archive` 六命令 | Task 18 |
| §1.2 不做 chip 行 / 不写 git | Global Constraints 第 2 条 |
| §1.3 三个概念划界（重点/归档，不用「收藏」） | Global Constraints 第 4 条 + Task 9/14 的 ☆ |
| §2.8 半成品处置（存储层已删、解析层保留） | Task 18 Step 1 |
| §3.1 布局（含 exists=false、空态、骨架态） | Task 9、11 |
| §3.2 行为矩阵（含「全部归档时落到新会话」） | Task 12（handler）+ 下方补充 |
| §3.3 侧栏快切下拉的 5 个配额与 `lastUsedAt` 排序 | Task 14 |
| §4.2 `archivedAt` 落盘与向后兼容 | Task 1、2 |
| §4.3 归档取代删除 | Task 15 |
| §4.4 批量归档（含确认+数量+0 禁用） | Task 10（菜单）+ Task 12（确认框） |
| §4.5 设置 › 归档 | Task 17 |
| §4.6 CLI `/archive`（含空对话、`/archive list` 范围提示） | Task 18 |
| §5.1 五条新 RPC + `session.delete` 扩参 | Task 4、5、7 |
| §5.2 跨项目 `path?`（易漏点） | Task 4（RPC 层测试）+ Task 17（UI 层测试）+ Task 19（e2e） |
| §5.3 settings / 类型改动 | Task 6、7 |
| §6.1 六处注册表 | Task 12（前三）+ Task 13（后三） |
| §6.2 快照 vs 活对象 | Task 12（`fetchProjects`）、15/17（`fetchSessions`） |
| §8.4 基线 | Global Constraints + Task 19 Step 1 |

§3.2 那条「项目全部会话都已归档时落到新会话」的断言已直接放进 Task 2 的测试文件（`projectWithAllSessionsArchivedListsEmpty`），不单开 task。

### 2. 占位符扫描

无 `TBD` / `TODO` / 「实现细节略」。三处「按实际签名对齐」都给了具体的 `grep` 命令与对齐对象（`handleExportCommand` 的参数、`Select` 的 props、e2e 既有 testid），不是模糊指示。

### 3. 类型一致性

| 符号 | 定义处 | 使用处 | 一致 |
|---|---|---|---|
| `SessionMeta` 12 参 | Task 1 | Task 3、4 测试、18 | ✅ |
| `ProjectSessionReader.Summary(path, sessionCount, lastSessionAt)` | Task 3 | Task 5 | ✅ |
| `setSessionArchived(id, archived, path)` 三参 | Task 4 | Task 5、7、15、17 | ✅ |
| `deleteSession(id, path?)` | Task 4 | Task 7、17 | ✅ |
| `ProjectSummary { path, sessionCount, lastSessionAt }` | Task 7 | Task 8、11 | ✅ |
| `ProjectRowData { view, displayName, sessionCount, lastSessionAt }` | Task 8 | Task 9、10、11 | ✅ |
| `shortRelativeTime(iso, now)` | Task 8 | Task 9、17 | ✅ |
| `ProjectRowProps.menu` 插槽 | Task 9 | Task 11 | ✅ |
| `onOpenAllProjects` | Task 14 | Task 12（App 传） | ✅ |
| `SessionRow` 具名导出 + `onArchive` | Task 15 | Task 15 测试 | ✅ |
| `ArchiveRowData { meta, displayName, projectLabel }` | Task 16 | Task 17 | ✅ |

**一处修掉的不一致**：Task 9 的实现代码里同时 import 了 `shortRelativeTime` 和别名 `rel`，已在该 step 下用引述块标明「只保留一个 import，两处都用 `shortRelativeTime`」。

**一处修掉的越界**：Task 12 的代码块里有一段关于 `window.confirm` 的自问自答注释，已标明不要抄进代码、只留一行说明。


