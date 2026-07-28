# wraith 自动记忆提取 — Phase B(CLI + RPC 复核入口)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Phase A 产生的待确认候选可被人工复核——加 CLI `/memory pending|approve|reject|pending clear` 与桌面用的 `memory.pending*` RPC,并把终审延后的两条(approve 可见性 + 领取原子性)在后端收口。

**Architecture:** 纯 Java 后端,无新数据/无新存储。Task 1 硬化 `MemoryManager` 的批准语义(仅批当前项目可见候选 + 领取式原子:先 `remove` 成功再 `storeFact`);Task 2 接 CLI(`CliCommandParser` 加命令 + `Main` REPL 分派 + `formatPendingFacts` 打印);Task 3 接 RPC(`SessionRunner` 加 default 方法 + `Main` 匿名 session 实现 + `AppServer` 分派 + `pendingFactJson`)。桌面 UI 在 Phase C。

**Tech Stack:** Java 17,Maven,JUnit 5 + Mockito;JSON-RPC(AppServer/SessionRunner 既有模式)。

## Global Constraints

- 纯 Java 后端;不改桌面 renderer(Phase C)。复用 Phase A 的 `MemoryManager` 候选 API(`listPending`/`approvePending`/`approvePendingReplacing`/`rejectPending`/`clearPending`/`getPendingStore`)。
- CLI 遵循既有 `CliCommandParser`(枚举 `CommandType` + `record ParsedCommand(type,payload)`)+ `Main` REPL `switch(command.type())` 打印+`continue` 模式;打印仿 `formatMemoryEntries`。
- RPC 遵循既有 `memory.*` 模式:`SessionRunner` 声明 `default` 方法(未实现抛 `UnsupportedOperationException`),`Main` 匿名 `SessionRunner` 实现返回 `Map<String,Object>`,`AppServer` 分派 `case "memory.xxx"` 校验参数→调 `session.memoryXxx()`→`writer.result`/`writer.error`。RPC 方法名沿 `memory.initProject` 的 camelCase:`memory.pendingList/pendingApprove/pendingApproveReplacing/pendingReject/pendingClear`。
- **收口终审延后项**:approve 只对**当前项目可见**候选生效(global 或 project==currentProject);批准采用**领取式原子**(先 `pendingStore.remove(id)` 拿到 true 再 `storeFact`,并发只一个胜出、杜绝重复入库)。
- 测试:JUnit5 + Mockito,`mvn -q -DskipTests=false -Dtest=<Class> test`。基线 1563/0F/0E(Phase A 后),不新增失败。
- `git add` 仅本任务文件;禁止 `git add .`/`-A`;不碰 WIP(README.md、demo/*、.claude/settings.json、progress.md)。

---

### Task 1: MemoryManager 批准硬化(可见性 + 领取原子)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/memory/MemoryManager.java`(`approvePending` / `approvePendingReplacing`,加私有 `isPendingVisible`)
- Test: `src/test/java/com/lyhn/wraith/memory/MemoryManagerPendingTest.java`(追加用例)

**Interfaces:**
- Consumes:现有 `pendingStore`(`get`/`remove` 同步)、`storeFact`、`longTermMemory.markSuperseded`、`currentProject`、`getPendingStore()`。
- Produces:行为收紧(签名不变):`approvePending(id)` / `approvePendingReplacing(id,oldId)` 仅当候选存在**且当前项目可见**且成功领取(remove)才落库;否则 false。

- [ ] **Step 1: 追加失败测试**

在 `MemoryManagerPendingTest` 追加(沿用文件既有 `managerWithTempMemory(dir)` 与 `getPendingStore().add(...)` 播种方式):

```java
    @Test
    void approveRejectedForCandidateNotVisibleInCurrentProject(@TempDir File dir) {
        MemoryManager m = managerWithTempMemory(dir); // currentProject = "/proj"
        // 一条属于别的项目的候选
        m.getPendingStore().add(new PendingFact("cx", "别项目的事实", "FACT", "project", null, "s1", "/other", "2026-07-23T00:00:00Z"));
        assertFalse(m.approvePending("cx"));                       // 不可见 → 拒批
        assertTrue(m.getLongTermMemory().getAll().isEmpty());       // 未落库
        assertTrue(m.getPendingStore().get("cx").isPresent());      // 仍在队列(未被误领取)
    }

    @Test
    void approveIsAtomicClaim_secondApproveOfSameIdFails(@TempDir File dir) {
        MemoryManager m = managerWithTempMemory(dir);
        m.getPendingStore().add(new PendingFact("c1", "用户偏好 Java 17", "FACT", "project", null, "s1", m.getCurrentProject(), "2026-07-23T00:00:00Z"));
        assertTrue(m.approvePending("c1"));                         // 第一次:领取+落库
        assertFalse(m.approvePending("c1"));                        // 第二次:已被领取 → false
        long count = m.getLongTermMemory().getAll().stream().filter(e -> e.getContent().equals("用户偏好 Java 17")).count();
        assertEquals(1, count);                                     // 只入库一次(无重复)
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=MemoryManagerPendingTest test`
Expected: 新用例失败——当前 `approvePending` 不校验可见性、`get`→`remove` 顺序使第二次批准仍会重复 `storeFact`。

- [ ] **Step 3: 写实现**

把 `MemoryManager` 的两个批准方法替换为(其余方法不动):

```java
    public boolean approvePending(String id) {
        PendingFact pf = pendingStore.get(id).orElse(null);
        if (pf == null || !isPendingVisible(pf)) {
            return false;
        }
        if (!pendingStore.remove(id)) {
            return false; // 领取失败(并发已被别处领走)→ 不重复落库
        }
        storeFact(pf.fact(), pf.scope());
        return true;
    }

    public boolean approvePendingReplacing(String id, String oldId) {
        PendingFact pf = pendingStore.get(id).orElse(null);
        if (pf == null || !isPendingVisible(pf)) {
            return false;
        }
        if (!pendingStore.remove(id)) {
            return false;
        }
        storeFact(pf.fact(), pf.scope());
        longTermMemory.markSuperseded(oldId);
        return true;
    }

    /** 候选是否对当前项目可见:global 恒可见;project 仅当 project==currentProject。 */
    private boolean isPendingVisible(PendingFact pf) {
        if ("global".equals(pf.scope())) {
            return true;
        }
        return currentProject != null && currentProject.equals(pf.project());
    }
```

> 说明:领取式(remove 成功再 store)保证并发/重复批准只落库一次;代价是若 `storeFact` 抛异常则候选已出队(丢失)——`storeFact` 仅构造+入内存 Map+落盘,实际不抛,取舍可接受。

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=MemoryManagerPendingTest test`
Expected: 全通过(原 4 + 新 2 = 6)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/memory/MemoryManager.java src/test/java/com/lyhn/wraith/memory/MemoryManagerPendingTest.java
git commit -m "feat(memory): 候选批准硬化 — 仅批当前项目可见 + 领取式原子(杜绝重复入库)"
```

---

### Task 2: CLI `/memory pending|approve|reject|pending clear`

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/CliCommandParser.java`(枚举 + 解析)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(REPL 分派 + `formatPendingFacts` + `/memory` 帮助)
- Test: `src/test/java/com/lyhn/wraith/cli/CliCommandParserTest.java`(追加解析用例)

**Interfaces:**
- Consumes:Task 1 硬化后的 `MemoryManager.listPending/approvePending/approvePendingReplacing/rejectPending/clearPending`;`PendingFact`。
- Produces:`CommandType` 新增 `MEMORY_PENDING`、`MEMORY_APPROVE`、`MEMORY_REJECT`、`MEMORY_PENDING_CLEAR`;`/memory approve <id>` payload=`<id>`,`/memory approve <id> replace <oldId>` payload=`<id> replace <oldId>`。

- [ ] **Step 1: 追加解析失败测试**

在 `CliCommandParserTest` 追加:

```java
    @Test
    void parsesMemoryPendingCommands() {
        assertEquals(CliCommandParser.CommandType.MEMORY_PENDING, CliCommandParser.parse("/memory pending").type());
        assertEquals(CliCommandParser.CommandType.MEMORY_PENDING_CLEAR, CliCommandParser.parse("/memory pending clear").type());

        CliCommandParser.ParsedCommand approve = CliCommandParser.parse("/memory approve cand-abc123");
        assertEquals(CliCommandParser.CommandType.MEMORY_APPROVE, approve.type());
        assertEquals("cand-abc123", approve.payload());

        CliCommandParser.ParsedCommand replace = CliCommandParser.parse("/memory approve cand-abc123 replace fact-old99");
        assertEquals(CliCommandParser.CommandType.MEMORY_APPROVE, replace.type());
        assertEquals("cand-abc123 replace fact-old99", replace.payload());

        CliCommandParser.ParsedCommand reject = CliCommandParser.parse("/memory reject cand-abc123");
        assertEquals(CliCommandParser.CommandType.MEMORY_REJECT, reject.type());
        assertEquals("cand-abc123", reject.payload());
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=CliCommandParserTest test`
Expected: 编译失败——枚举值 `MEMORY_PENDING` 等不存在。

- [ ] **Step 3: 写实现(解析)**

在 `CliCommandParser.CommandType` 枚举里 `MEMORY_SAVE,` 之后加:

```java
        MEMORY_PENDING,
        MEMORY_APPROVE,
        MEMORY_REJECT,
        MEMORY_PENDING_CLEAR,
```

在 `parse(...)` 里,**紧接** `/memory search` 那组(约现第 164 行之后)、`/save` 之前插入(注意 `pending clear` 放在 `pending` 之前,精确匹配二者顺序无关但保持清晰):

```java
        if (trimmed.equalsIgnoreCase("/memory pending clear") || trimmed.equalsIgnoreCase("/mem pending clear")) {
            return new ParsedCommand(CommandType.MEMORY_PENDING_CLEAR, null);
        }

        if (trimmed.equalsIgnoreCase("/memory pending") || trimmed.equalsIgnoreCase("/mem pending")) {
            return new ParsedCommand(CommandType.MEMORY_PENDING, null);
        }

        if (trimmed.regionMatches(true, 0, "/memory approve ", 0, 16)) {
            return new ParsedCommand(CommandType.MEMORY_APPROVE, trimmed.substring(16).trim());
        }

        if (trimmed.regionMatches(true, 0, "/mem approve ", 0, 13)) {
            return new ParsedCommand(CommandType.MEMORY_APPROVE, trimmed.substring(13).trim());
        }

        if (trimmed.regionMatches(true, 0, "/memory reject ", 0, 15)) {
            return new ParsedCommand(CommandType.MEMORY_REJECT, trimmed.substring(15).trim());
        }

        if (trimmed.regionMatches(true, 0, "/mem reject ", 0, 12)) {
            return new ParsedCommand(CommandType.MEMORY_REJECT, trimmed.substring(12).trim());
        }
```

- [ ] **Step 4: 跑解析测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=CliCommandParserTest test`
Expected: 全通过(含新 `parsesMemoryPendingCommands`)。

- [ ] **Step 5: 写实现(Main REPL 分派 + 打印助手 + 帮助文案)**

(a) `Main.java` 顶部 import 区,`MemoryEntry` import 旁加:
```java
import com.lyhn.wraith.memory.PendingFact;
```

(b) 在 `formatMemoryEntries(...)` 方法附近新增打印助手(签名参照 `formatMemoryEntries` 返回 String):
```java
    private static String formatPendingFacts(java.util.List<PendingFact> pending) {
        if (pending == null || pending.isEmpty()) {
            return "📭 暂无待确认候选记忆。会话结束/清空时会自动抽取,批准后才进长期记忆。";
        }
        StringBuilder sb = new StringBuilder("🕵 待确认候选记忆 (" + pending.size() + " 条)：\n");
        for (PendingFact f : pending) {
            sb.append("  • [").append(f.id()).append("] (").append(f.scope()).append(") ").append(f.fact());
            if (f.nearestExistingId() != null && !f.nearestExistingId().isBlank()) {
                sb.append("  ↔ 相似既有: ").append(f.nearestExistingId());
            }
            sb.append('\n');
        }
        sb.append("  批准: /memory approve <id>   替换旧条: /memory approve <id> replace <oldId>\n");
        sb.append("  驳回: /memory reject <id>    清空: /memory pending clear");
        return sb.toString();
    }
```

(c) 在 REPL `switch` 里 `case MEMORY_SAVE -> {...}` 之后加四个 case:
```java
                    case MEMORY_PENDING -> {
                        ui.println(formatPendingFacts(reactAgent.getMemoryManager().listPending()));
                        ui.println();
                        continue;
                    }
                    case MEMORY_APPROVE -> {
                        String payload = command.payload();
                        if (payload == null || payload.isBlank()) {
                            ui.println("❌ 请提供候选 id,例如 /memory approve cand-abc123\n");
                            continue;
                        }
                        String[] parts = payload.trim().split("\\s+");
                        boolean ok;
                        String verb;
                        if (parts.length >= 3 && "replace".equalsIgnoreCase(parts[1])) {
                            ok = reactAgent.getMemoryManager().approvePendingReplacing(parts[0], parts[2]);
                            verb = "批准并替换 " + parts[2];
                        } else {
                            ok = reactAgent.getMemoryManager().approvePending(parts[0]);
                            verb = "批准";
                        }
                        ui.println(ok ? ("✅ 已" + verb + ": " + parts[0] + "\n")
                                      : ("📭 未找到或不可批准(可能已处理/非当前项目): " + parts[0] + "\n"));
                        continue;
                    }
                    case MEMORY_REJECT -> {
                        String id = command.payload();
                        if (id == null || id.isBlank()) {
                            ui.println("❌ 请提供候选 id,例如 /memory reject cand-abc123\n");
                        } else {
                            ui.println(reactAgent.getMemoryManager().rejectPending(id)
                                    ? ("🗑️ 已驳回候选: " + id + "\n") : ("📭 未找到候选: " + id + "\n"));
                        }
                        continue;
                    }
                    case MEMORY_PENDING_CLEAR -> {
                        reactAgent.getMemoryManager().clearPending();
                        ui.println("🧹 待确认候选已清空\n");
                        ui.println();
                        continue;
                    }
```

(d) 在 `case MEMORY_STATUS -> {...}` 的帮助文案里(现约 :546 `/save` 那行之后)加一行:
```java
                        ui.println("   /memory pending - 查看待确认候选;/memory approve|reject <id> - 批准/驳回");
```

- [ ] **Step 6: 全量编译 + 相关测试**

Run: `mvn -q -DskipTests=false -Dtest=CliCommandParserTest,MemoryManagerPendingTest test && mvn -q -DskipTests=false compile`
Expected: 测试全绿;编译无告警(注意 `PendingFact` import 已加、`formatPendingFacts` 为 `static` 与 `formatMemoryEntries` 一致)。

> 说明:REPL 分派逻辑位于 `Main.main(...)` 的大循环内,与既有 `/memory list|search|delete` 分派同处、**同样无独立单元测试**(该层靠解析单测 + 编译 + Phase C 桌面 e2e/手验覆盖);本任务的自动化保证在解析单测(Step 1)+ Task 1 的 MemoryManager 行为单测。

- [ ] **Step 7: Commit**

```bash
git add src/main/java/com/lyhn/wraith/cli/CliCommandParser.java src/main/java/com/lyhn/wraith/cli/Main.java src/test/java/com/lyhn/wraith/cli/CliCommandParserTest.java
git commit -m "feat(cli): /memory pending|approve|reject|pending clear 候选复核命令"
```

---

### Task 3: RPC `memory.pending*`(供桌面 Phase C)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(`SessionRunner` 加 default 方法 + `handle` 分派 case)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(匿名 `SessionRunner` 实现 5 个方法 + `pendingFactJson` 助手)

**Interfaces:**
- Consumes:Task 1 硬化后的 MemoryManager 候选 API;`PendingFact`。
- Produces:RPC 方法 `memory.pendingList`(→`{project, pending:[{id,fact,type,scope,nearestExistingId,sourceSessionId,project,createdAt}]}`)、`memory.pendingApprove{id}`、`memory.pendingApproveReplacing{id,oldId}`、`memory.pendingReject{id}`、`memory.pendingClear`(后四者→`{ok:boolean}`)。

- [ ] **Step 1: 写实现(SessionRunner 接口 default 方法)**

在 `AppServer.SessionRunner` 接口里、现有 `memory*` default 方法声明附近(与 `memoryList`/`memorySearch`/... 同处)加:

```java
        /** 待确认候选列表。默认抛出。 */
        default java.util.Map<String, Object> memoryPendingList() {
            throw new UnsupportedOperationException("memoryPendingList not implemented");
        }
        /** 批准候选(ADD)。默认抛出。 */
        default java.util.Map<String, Object> memoryPendingApprove(String id) {
            throw new UnsupportedOperationException("memoryPendingApprove not implemented");
        }
        /** 批准候选并替换旧条(SUPERSEDE)。默认抛出。 */
        default java.util.Map<String, Object> memoryPendingApproveReplacing(String id, String oldId) {
            throw new UnsupportedOperationException("memoryPendingApproveReplacing not implemented");
        }
        /** 驳回候选。默认抛出。 */
        default java.util.Map<String, Object> memoryPendingReject(String id) {
            throw new UnsupportedOperationException("memoryPendingReject not implemented");
        }
        /** 清空当前项目可见候选。默认抛出。 */
        default java.util.Map<String, Object> memoryPendingClear() {
            throw new UnsupportedOperationException("memoryPendingClear not implemented");
        }
```

- [ ] **Step 2: 写实现(AppServer 分派 case)**

在 `handle(...)` 的 `case "memory.initProject" -> {...}`(现约 :621-628)之后加:

```java
            case "memory.pendingList" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.memoryPendingList()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.pendingApprove" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                String id = textParam(msg.params(), "id");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                try { writer.result(msg.id(), session.memoryPendingApprove(id)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.pendingApproveReplacing" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String id = textParam(p, "id");
                String oldId = textParam(p, "oldId");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                if (oldId == null || oldId.isBlank()) { writer.error(msg.id(), -32602, "缺 oldId"); return true; }
                try { writer.result(msg.id(), session.memoryPendingApproveReplacing(id, oldId)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.pendingReject" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                String id = textParam(msg.params(), "id");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                try { writer.result(msg.id(), session.memoryPendingReject(id)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.pendingClear" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.memoryPendingClear()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
```

- [ ] **Step 3: 写实现(Main 匿名 session 实现 + JSON 助手)**

在 `Main.java` 匿名 `SessionRunner` 里、`memoryClear()`(现约 :1481-1484)之后加实现 + 一个私有 JSON 助手(仿 `memoryEntryJson`):

```java
                    public java.util.Map<String, Object> memoryPendingList() {
                        java.util.List<java.util.Map<String, Object>> items = new java.util.ArrayList<>();
                        for (com.lyhn.wraith.memory.PendingFact f : agent.getMemoryManager().listPending()) items.add(pendingFactJson(f));
                        java.util.Map<String, Object> r = new java.util.LinkedHashMap<>();
                        r.put("project", agent.getMemoryManager().getCurrentProject());
                        r.put("pending", items);
                        return r;
                    }
                    public java.util.Map<String, Object> memoryPendingApprove(String id) {
                        return java.util.Map.of("ok", agent.getMemoryManager().approvePending(id));
                    }
                    public java.util.Map<String, Object> memoryPendingApproveReplacing(String id, String oldId) {
                        return java.util.Map.of("ok", agent.getMemoryManager().approvePendingReplacing(id, oldId));
                    }
                    public java.util.Map<String, Object> memoryPendingReject(String id) {
                        return java.util.Map.of("ok", agent.getMemoryManager().rejectPending(id));
                    }
                    public java.util.Map<String, Object> memoryPendingClear() {
                        agent.getMemoryManager().clearPending();
                        return java.util.Map.of("ok", true);
                    }
                    private java.util.Map<String, Object> pendingFactJson(com.lyhn.wraith.memory.PendingFact f) {
                        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                        m.put("id", f.id());
                        m.put("fact", f.fact());
                        m.put("type", f.type());
                        m.put("scope", f.scope());
                        m.put("nearestExistingId", f.nearestExistingId());
                        m.put("sourceSessionId", f.sourceSessionId());
                        m.put("project", f.project());
                        m.put("createdAt", f.createdAt());
                        return m;
                    }
```

- [ ] **Step 4: 编译 + 全量回归**

Run: `mvn -q -DskipTests=false compile && mvn -q -DskipTests=false test`
Expected: 编译净;全量回归无新失败(基线 1563/0F/0E ± 已知环境噪声);Phase A/B 相关测试类全绿。

> 说明:RPC 层是 `Main.main(...)` 内匿名 `SessionRunner` 的薄委托(逐调 MemoryManager),与既有 `memory.list/search/...` 一样**无独立单元测试**——真实验证在 Phase C 桌面链路 e2e + 手动 RPC 调用;本任务保证 = 编译 + 全量回归不破 + 委托目标(MemoryManager)已在 Task 1 单测覆盖。这是本仓既有该层的一致做法,非本计划疏漏。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/main/java/com/lyhn/wraith/cli/Main.java
git commit -m "feat(rpc): memory.pending* 候选复核 RPC(供桌面 Phase C)"
```

---

## Self-Review(写完对照 spec + 终审延后项)

**1. Spec/终审覆盖**:
- CLI `/memory pending|approve|reject|pending clear`(spec 含 `approve <id> replace <oldId>`)→ Task 2。
- RPC `memory.pendingList/pendingApprove/pendingApproveReplacing/pendingReject/pendingClear`(spec 命名 camelCase)→ Task 3。
- 终审-新1(approve 只批可见 id / 用可见性而非盲 currentProject)→ Task 1 `isPendingVisible` 守卫 + `approveRejectedForCandidateNotVisibleInCurrentProject` 测试。
- T5-a(get→remove TOCTOU)→ Task 1 领取式原子(remove 先行 + 布尔门)+ `approveIsAtomicClaim_*` 测试。
- 桌面「待确认」区 = Phase C,不在本计划。

**2. Placeholder scan**:无 TBD;可测部分(解析、MemoryManager 行为、JSON 字段)给全代码;REPL/RPC 薄委托层明确标注"沿既有无单测层 + 编译/回归/Task1 单测/Phase C e2e 兜底",非模糊占位。

**3. Type consistency**:`PendingFact` 8 字段构造(id,fact,type,scope,nearestExistingId,sourceSessionId,project,createdAt)与 Phase A 一致;`MemoryManager` 方法签名(approvePending/approvePendingReplacing/rejectPending/listPending/clearPending/getPendingStore/getCurrentProject/getLongTermMemory)与 Phase A 一致;RPC 方法名与 AppServer case 字符串一一对应;`ParsedCommand(type,payload)` 与既有一致。

## 后续(不在本计划)

- **Phase C**:桌面 `MemoryPanel`「待确认(N)」区 —— 列候选(fact/scope + `nearestExistingId` 对照旧条)、批准/替换/编辑/驳回、可选侧栏红点;preload/IPC 走 `memory.pending*`。A+B 合入后出计划。
