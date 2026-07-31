# Phase E：高频三件套 agent 工具（自动化 / 后台任务 / 记忆）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在聊天里说一句,agent 就能**真的**操作三个高频面板的能力：定时任务（自动化）、后台任务、长期记忆 —— 而不是只能「打开面板让你自己点」。

**Architecture:** 在 `ToolRegistry` 新增 15 个内置工具，**直调既有 Java 服务**（不走 JSON-RPC 回环），与面板同源同一份数据。`DurableTaskManager` / `MemoryManager` 经既有注入范式（`setScopedMemorySaver` / `setTodoSink` 同款 setter）下发；`AutomationStore` / `RequestInbox` 无状态按需构造，目录解析统一到新的 `openDefault()` 工厂（消除 AppServer 里的重复解析，防「agent 写的文件面板读不到」）。高后果写操作进 HITL（`ApprovalPolicy.DANGEROUS_TOOLS`）+ 审计（`ToolRegistry.AUDIT_TOOLS`）。

**Tech Stack:** Java 17 / Maven（`com.lyhn.wraith`）。桌面（Electron/React）**不改代码**，仅跑回归。

## Global Constraints

- 中文回复用户；代码 / 命令 / 文件名 / 路径保留原文。
- 所有 git 提交信息**必须**以这两行结尾（逐字）：
  - `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  - `Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ`
- `git add` **只**加本任务列出的文件；**绝不** `git add .` / `git add -A`；**绝不**触碰 WIP 文件：`README.md`、`demo/pom.xml`、`.claude/settings.json`、`demo/src/Hello.java`、`progress.md`。
- push 需用户显式同意；只 push 当前分支 `feat/windows-parity-block1`。
- **测试跳过坑**：本仓库测试默认跳过，所有 `mvn` 命令**必须**带 `-DskipTests=false`。
- **守密钥红线**：本期**不**新增任何读写 API key / IM 密钥的工具。
- **不给 agent 批量摧毁能力**：**不**实现 `memory_clear` / `memory_pending_clear` / 清空自动化。
- **HITL 分级（必须落实）**：`task_add`、`memory_delete`、`automation_upsert`、`automation_remove`、`automation_run_now` 五个进 `ApprovalPolicy.DANGEROUS_TOOLS`（`hitl/ApprovalPolicy.java:18-23`）；所有**写**工具进 `ToolRegistry.AUDIT_TOOLS`（`tool/ToolRegistry.java:89`）。只读工具两个名单都不进。
- **未注入即诚实失败**：`DurableTaskManager` / `MemoryManager` 未注入时（CLI 精简路径 / 网关进程），对应工具返回 `<tool> 失败: …未初始化`，**绝不假装成功**。
- **与面板同一份数据**：自动化必须经 `AutomationStore.openDefault()`（Task 1 引入）解析目录，不得自己拼 `~/.wraith`。
- **桌面零改动**：不改 `desktop/` 下任何文件（仅跑回归证明零影响）。
- 每个新工具的失败串统一前缀 `<tool_name> 失败: `；成功串包含关键标识（id / 数量）。

---

## 文件结构

- Modify: `src/main/java/com/lyhn/wraith/automation/AutomationStore.java` —— 加 `defaultDir()` / `openDefault()` 静态工厂。
- Modify: `src/main/java/com/lyhn/wraith/automation/RequestInbox.java` —— 加 `openDefault()`。
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` —— 两个私有 helper 改为委托新工厂（去重）。
- Create: `src/test/java/com/lyhn/wraith/automation/AutomationDefaultDirTest.java`
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java` —— 3 组工具注册 + 2 个注入 setter + `AUDIT_TOOLS` 扩充。
- Modify: `src/main/java/com/lyhn/wraith/hitl/ApprovalPolicy.java` —— `DANGEROUS_TOOLS` 扩充 5 项。
- Modify: `src/main/java/com/lyhn/wraith/agent/Agent.java`、`agent/PlanExecuteAgent.java`、`agent/AgentOrchestrator.java` —— 各 1 行 `setMemoryManager`。
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java` —— 1 行 `setTaskManager`。
- Create: `src/test/java/com/lyhn/wraith/tool/TaskToolsTest.java`、`MemoryToolsTest.java`、`AutomationToolsTest.java`、`ToolGatingTest.java`
- Modify: `src/main/resources/prompts/base.md`、`src/main/resources/prompts/capabilities.md`
- Modify: `src/test/java/com/lyhn/wraith/prompt/PromptAssemblerTest.java`

---

### Task 1: 自动化目录解析统一到 `openDefault()`

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/automation/AutomationStore.java`（构造在 `:15`）
- Modify: `src/main/java/com/lyhn/wraith/automation/RequestInbox.java`（构造在 `:52`）
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java:1193-1211`
- Create: `src/test/java/com/lyhn/wraith/automation/AutomationDefaultDirTest.java`

**Interfaces:**
- Produces: `AutomationStore.defaultDir() : Path`、`AutomationStore.openDefault() : AutomationStore`、`RequestInbox.openDefault() : RequestInbox`。Task 4 的自动化工具消费之。
- 语义（与 `AppServer.java:1193-1199` 现行逐字一致）：`wraith.automation.dir` 系统属性非空则用它，否则 `<user.home>/.wraith`；requests 目录 = 该基目录下 `automation-requests` 子目录。

**为什么做这一步：** agent 工具若自己拼目录，与面板/守护解析口径一旦漂移，就会出现「agent 说建好了、面板里看不到」—— 正是本期要消灭的那类 bug。

- [ ] **Step 1: 写失败测试**

创建 `src/test/java/com/lyhn/wraith/automation/AutomationDefaultDirTest.java`:

```java
package com.lyhn.wraith.automation;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class AutomationDefaultDirTest {

    @Test
    void defaultDirHonoursSystemProperty(@TempDir Path tmp) {
        String old = System.getProperty("wraith.automation.dir");
        try {
            System.setProperty("wraith.automation.dir", tmp.toString());
            assertEquals(tmp, AutomationStore.defaultDir());
            assertNotNull(AutomationStore.openDefault());
            assertNotNull(RequestInbox.openDefault());
        } finally {
            if (old == null) System.clearProperty("wraith.automation.dir");
            else System.setProperty("wraith.automation.dir", old);
        }
    }

    @Test
    void defaultDirFallsBackToHomeWraith() {
        String old = System.getProperty("wraith.automation.dir");
        try {
            System.clearProperty("wraith.automation.dir");
            assertEquals(Path.of(System.getProperty("user.home"), ".wraith"), AutomationStore.defaultDir());
        } finally {
            if (old != null) System.setProperty("wraith.automation.dir", old);
        }
    }

    @Test
    void blankPropertyAlsoFallsBack() {
        String old = System.getProperty("wraith.automation.dir");
        try {
            System.setProperty("wraith.automation.dir", "   ");
            assertEquals(Path.of(System.getProperty("user.home"), ".wraith"), AutomationStore.defaultDir());
        } finally {
            if (old == null) System.clearProperty("wraith.automation.dir");
            else System.setProperty("wraith.automation.dir", old);
        }
    }

    @Test
    void requestsDirIsSubdirOfBase(@TempDir Path tmp) {
        String old = System.getProperty("wraith.automation.dir");
        try {
            System.setProperty("wraith.automation.dir", tmp.toString());
            assertEquals(tmp.resolve("automation-requests"), AutomationStore.defaultRequestsDir());
        } finally {
            if (old == null) System.clearProperty("wraith.automation.dir");
            else System.setProperty("wraith.automation.dir", old);
        }
    }
}
```

- [ ] **Step 2: 运行,确认失败**

Run: `mvn -q -DskipTests=false -Dtest=AutomationDefaultDirTest test`
Expected: FAIL —— 编译错误：`defaultDir` / `openDefault` / `defaultRequestsDir` 不存在。

- [ ] **Step 3: `AutomationStore` 加静态工厂**

在 `AutomationStore` 类内（构造函数附近）加：

```java
    /**
     * 默认自动化数据目录:系统属性 wraith.automation.dir 优先,否则 <user.home>/.wraith。
     * app-server / 网关守护 / agent 工具三方共用同一解析口径 —— 口径漂移会导致
     * 「一边写、另一边读不到」的整类 bug。
     */
    public static Path defaultDir() {
        String prop = System.getProperty("wraith.automation.dir");
        return (prop != null && !prop.isBlank())
                ? Path.of(prop)
                : Path.of(System.getProperty("user.home"), ".wraith");
    }

    /** 默认 request inbox 目录(defaultDir() 下的 automation-requests 子目录)。 */
    public static Path defaultRequestsDir() {
        return defaultDir().resolve("automation-requests");
    }

    /** 按默认目录打开。 */
    public static AutomationStore openDefault() {
        return new AutomationStore(defaultDir());
    }
```

（确认文件已 `import java.nio.file.Path;`，未导入则补。）

- [ ] **Step 4: `RequestInbox` 加工厂**

在 `RequestInbox` 类内（构造 `:52` 附近）加：

```java
    /** 按默认目录打开(与 AutomationStore.openDefault() 同基目录)。 */
    public static RequestInbox openDefault() {
        return new RequestInbox(AutomationStore.defaultRequestsDir());
    }
```

- [ ] **Step 5: `AppServer` 两个 helper 改为委托（去重）**

把 `AppServer.java:1193-1211` 的两个私有方法体替换为委托，保持方法签名与调用点不变：

```java
    private static com.lyhn.wraith.automation.AutomationStore automationStore() {
        return com.lyhn.wraith.automation.AutomationStore.openDefault();
    }

    /**
     * 解析 automation-requests 目录（与 automationStore() 同基目录下的 automation-requests 子目录）。
     */
    private static java.nio.file.Path automationRequestsDir() {
        return com.lyhn.wraith.automation.AutomationStore.defaultRequestsDir();
    }
```

- [ ] **Step 6: 运行测试 + 全量回归**

Run: `mvn -q -DskipTests=false -Dtest=AutomationDefaultDirTest test`
Expected: PASS(4/4)。
Run: `mvn -q -DskipTests=false test`
Expected: 全绿（基线 1617 + 4）。

- [ ] **Step 7: 提交**

```bash
git add src/main/java/com/lyhn/wraith/automation/AutomationStore.java src/main/java/com/lyhn/wraith/automation/RequestInbox.java src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/test/java/com/lyhn/wraith/automation/AutomationDefaultDirTest.java
git commit -m "refactor(automation): 目录解析统一到 AutomationStore.openDefault/defaultRequestsDir + AppServer 委托(Phase E1)"
```

---

### Task 2: 后台任务工具（4 个）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`（字段区 `:111-120`；构造器注册序列 `:139-151`；`AUDIT_TOOLS` `:89`）
- Modify: `src/main/java/com/lyhn/wraith/hitl/ApprovalPolicy.java`（`DANGEROUS_TOOLS` `:18-23`）
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`（app-server 装配：`registry` 建于 `:1224`，`taskManager` 建于 `:1198-1209`）
- Create: `src/test/java/com/lyhn/wraith/tool/TaskToolsTest.java`

**Interfaces:**
- Consumes: `DurableTaskManager.enqueue(String):DurableTask`（`:86`）、`list(int):List<DurableTask>`（`:108`）、`find(String):Optional<DurableTask>`（`:128`）、`cancel(String):boolean`（`:142`）；`record DurableTask(String id, TaskStatus status, String prompt, String result, String error, Instant createdAt, Instant startedAt, Instant finishedAt, long durationMs)`。
- Produces: `ToolRegistry.setTaskManager(DurableTaskManager)`；工具 `task_add` / `task_list` / `task_get` / `task_cancel`。

- [ ] **Step 1: 写失败测试**

创建 `src/test/java/com/lyhn/wraith/tool/TaskToolsTest.java`:

```java
package com.lyhn.wraith.tool;

import com.lyhn.wraith.runtime.task.DurableTaskManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class TaskToolsTest {

    @Test
    void toolsFailHonestlyWhenManagerNotInjected() {
        ToolRegistry reg = new ToolRegistry();
        assertTrue(reg.executeTool("task_add", "{\"prompt\":\"跑测试\"}").startsWith("task_add 失败"));
        assertTrue(reg.executeTool("task_list", "{}").startsWith("task_list 失败"));
        assertTrue(reg.executeTool("task_get", "{\"id\":\"x\"}").startsWith("task_get 失败"));
        assertTrue(reg.executeTool("task_cancel", "{\"id\":\"x\"}").startsWith("task_cancel 失败"));
    }

    @Test
    void addThenListThenGetThenCancel(@TempDir Path tmp) throws Exception {
        try (DurableTaskManager mgr = DurableTaskManager.openDefault(tmp)) {
            ToolRegistry reg = new ToolRegistry();
            reg.setTaskManager(mgr);

            String added = reg.executeTool("task_add", "{\"prompt\":\"跑一遍单测\"}");
            assertFalse(added.startsWith("task_add 失败"), added);

            String id = mgr.list(10).get(0).id();
            assertTrue(added.contains(id), "成功串应含任务 id: " + added);

            String listed = reg.executeTool("task_list", "{}");
            assertTrue(listed.contains(id), listed);

            String got = reg.executeTool("task_get", "{\"id\":\"" + id + "\"}");
            assertTrue(got.contains(id), got);
            assertTrue(got.contains("跑一遍单测"), got);

            String cancelled = reg.executeTool("task_cancel", "{\"id\":\"" + id + "\"}");
            assertFalse(cancelled.startsWith("task_cancel 失败"), cancelled);
        }
    }

    @Test
    void addRejectsBlankPrompt(@TempDir Path tmp) throws Exception {
        try (DurableTaskManager mgr = DurableTaskManager.openDefault(tmp)) {
            ToolRegistry reg = new ToolRegistry();
            reg.setTaskManager(mgr);
            assertTrue(reg.executeTool("task_add", "{\"prompt\":\"  \"}").startsWith("task_add 失败"));
        }
    }

    @Test
    void getUnknownIdReportsNotFound(@TempDir Path tmp) throws Exception {
        try (DurableTaskManager mgr = DurableTaskManager.openDefault(tmp)) {
            ToolRegistry reg = new ToolRegistry();
            reg.setTaskManager(mgr);
            assertTrue(reg.executeTool("task_get", "{\"id\":\"no-such\"}").startsWith("task_get 失败"));
        }
    }
}
```

⚠ **先确认 `DurableTaskManager` 的可用构造/工厂**：`grep -n "public static DurableTaskManager\|public DurableTaskManager" src/main/java/com/lyhn/wraith/runtime/task/DurableTaskManager.java`。`Main.java:1198-1209` 用的是 `DurableTaskManager.openDefault(...)`；按其**真实参数**调整测试里的构造（若需要 `start()` 才能 enqueue，就在测试里调）。断言一律不改，只调构造方式，并在报告写明真实签名。

- [ ] **Step 2: 运行,确认失败**

Run: `mvn -q -DskipTests=false -Dtest=TaskToolsTest test`
Expected: FAIL —— `未知工具: task_add`（以及 `setTaskManager` 编译错误）。

- [ ] **Step 3: 注册工具 + 注入 setter**

在 `ToolRegistry` 字段区加：

```java
    private com.lyhn.wraith.runtime.task.DurableTaskManager taskManager;

    /** 注入持久后台任务管理器(app-server 装配时下发);未注入时相关工具诚实失败。 */
    public void setTaskManager(com.lyhn.wraith.runtime.task.DurableTaskManager taskManager) {
        this.taskManager = taskManager;
    }
```

构造器注册序列末尾加 `registerTaskTools();`，并新增方法：

```java
    /** 后台任务工具:与「后台任务」面板同一个 DurableTaskManager,聊天里直接发后即走。 */
    private void registerTaskTools() {
        tools.put("task_add", new Tool(
                "task_add",
                "把一个较长的任务丢到后台异步执行(发后即走,不占当前对话)。用户说「后台跑/挂后台/发后即走」时用。"
                        + "返回任务 id,可用 task_get 查进度。",
                createParameters(new Param("prompt", "string", "要后台执行的完整任务描述", true)),
                args -> {
                    if (taskManager == null) return "task_add 失败: 后台任务管理器未初始化(仅桌面/app-server 可用)";
                    String prompt = args.get("prompt");
                    if (prompt == null || prompt.isBlank()) return "task_add 失败: prompt 不能为空";
                    var t = taskManager.enqueue(prompt.trim());
                    return "已提交后台任务 " + t.id() + "(状态 " + t.status() + "),可用 task_get 查询进度。";
                }
        ));

        tools.put("task_list", new Tool(
                "task_list",
                "列出后台任务(最近若干条,含状态)。用户问「后台任务怎么样了/有哪些在跑」时用。",
                createParameters(new Param("limit", "integer", "最多返回多少条,默认 20", false)),
                args -> {
                    if (taskManager == null) return "task_list 失败: 后台任务管理器未初始化(仅桌面/app-server 可用)";
                    int limit = clamp(parseInt(args.get("limit"), 20), 1, 100);
                    var list = taskManager.list(limit);
                    if (list.isEmpty()) return "当前没有后台任务。";
                    StringBuilder sb = new StringBuilder("后台任务 " + list.size() + " 条:\n");
                    for (var t : list) {
                        sb.append("- ").append(t.id()).append(" [").append(t.status()).append("] ")
                                .append(t.prompt() == null ? "" : t.prompt().strip()).append('\n');
                    }
                    return sb.toString().trim();
                }
        ));

        tools.put("task_get", new Tool(
                "task_get",
                "查一个后台任务的状态与结果(按 id)。",
                createParameters(new Param("id", "string", "任务 id", true)),
                args -> {
                    if (taskManager == null) return "task_get 失败: 后台任务管理器未初始化(仅桌面/app-server 可用)";
                    String id = args.get("id");
                    if (id == null || id.isBlank()) return "task_get 失败: id 不能为空";
                    var found = taskManager.find(id.trim());
                    if (found.isEmpty()) return "task_get 失败: 没有 id 为 '" + id.trim() + "' 的后台任务";
                    var t = found.get();
                    StringBuilder sb = new StringBuilder();
                    sb.append("任务 ").append(t.id()).append(" [").append(t.status()).append("]\n");
                    sb.append("请求: ").append(t.prompt() == null ? "" : t.prompt().strip()).append('\n');
                    if (t.result() != null && !t.result().isBlank()) sb.append("结果: ").append(t.result().strip()).append('\n');
                    if (t.error() != null && !t.error().isBlank()) sb.append("错误: ").append(t.error().strip()).append('\n');
                    return sb.toString().trim();
                }
        ));

        tools.put("task_cancel", new Tool(
                "task_cancel",
                "取消一个尚未完成的后台任务(按 id)。",
                createParameters(new Param("id", "string", "任务 id", true)),
                args -> {
                    if (taskManager == null) return "task_cancel 失败: 后台任务管理器未初始化(仅桌面/app-server 可用)";
                    String id = args.get("id");
                    if (id == null || id.isBlank()) return "task_cancel 失败: id 不能为空";
                    boolean ok = taskManager.cancel(id.trim());
                    return ok ? "已取消后台任务 " + id.trim()
                              : "task_cancel 失败: 任务 '" + id.trim() + "' 不存在或已结束";
                }
        ));
    }
```

- [ ] **Step 4: HITL + 审计名单**

`ToolRegistry.java:89` 的 `AUDIT_TOOLS` 加入 `"task_add"`, `"task_cancel"`：

```java
    private static final Set<String> AUDIT_TOOLS = Set.of("write_file", "execute_command", "create_project", "revert_turn",
            "task_add", "task_cancel");
```

`hitl/ApprovalPolicy.java` 的 `DANGEROUS_TOOLS` 加入 `"task_add"`（后台自主跑完整 agent 回合，高后果）：

```java
    private static final Set<String> DANGEROUS_TOOLS = Set.of(
            "write_file",
            "execute_command",
            "create_project",
            "revert_turn",
            "task_add"
    );
```

- [ ] **Step 5: Main 注入**

在 `Main.java` app-server 装配处（`registry` 创建之后、`taskManager` 已在作用域）加一行：

```java
                registry.setTaskManager(taskManager);
```

⚠ 变量名以现场为准（`registry` 在 `:1224` 附近、`taskManager` 在 `:1198-1209`）；若 `taskManager` 是别名（如 `taskManagerTmp`），用真实名字并在报告说明。放在 `registry` 构造之后、`new Agent(...)` 之前均可。

- [ ] **Step 6: 运行测试 + 全量回归**

Run: `mvn -q -DskipTests=false -Dtest=TaskToolsTest test` → PASS
Run: `mvn -q -DskipTests=false test` → 全绿

- [ ] **Step 7: 提交**

```bash
git add src/main/java/com/lyhn/wraith/tool/ToolRegistry.java src/main/java/com/lyhn/wraith/hitl/ApprovalPolicy.java src/main/java/com/lyhn/wraith/cli/Main.java src/test/java/com/lyhn/wraith/tool/TaskToolsTest.java
git commit -m "feat(tool): 后台任务工具 task_add/list/get/cancel + HITL/审计名单 + Main 注入(Phase E2)"
```

---

### Task 3: 记忆工具（6 个）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`
- Modify: `src/main/java/com/lyhn/wraith/hitl/ApprovalPolicy.java`
- Modify: `src/main/java/com/lyhn/wraith/agent/Agent.java`（`:93` 处已有 `setScopedMemorySaver`）
- Modify: `src/main/java/com/lyhn/wraith/agent/PlanExecuteAgent.java`（`:171` 处已有 `setScopedMemorySaver`）
- Modify: `src/main/java/com/lyhn/wraith/agent/AgentOrchestrator.java`（`:115` 处已有 `setScopedMemorySaver`）
- Create: `src/test/java/com/lyhn/wraith/tool/MemoryToolsTest.java`

**Interfaces:**
- Consumes: `MemoryManager.listLongTerm():List<MemoryEntry>`（`:164`）、`searchLongTerm(String,int):List<MemoryEntry>`（`:168`）、`deleteLongTerm(String):boolean`（`:172`）、`listPending():List<PendingFact>`（`:232`）、`approvePending(String):boolean`（`:236`）、`rejectPending(String):boolean`（`:274`）；`MemoryEntry.getId()/getContent()`（`:38-39`）；`record PendingFact(String id, String fact, String type, String scope, String nearestExistingId, String sourceSessionId, String project, String createdAt)`。
- Produces: `ToolRegistry.setMemoryManager(MemoryManager)`；工具 `memory_list` / `memory_search` / `memory_delete` / `memory_pending_list` / `memory_pending_approve` / `memory_pending_reject`。

- [ ] **Step 1: 写失败测试**

创建 `src/test/java/com/lyhn/wraith/tool/MemoryToolsTest.java`:

```java
package com.lyhn.wraith.tool;

import com.lyhn.wraith.memory.LongTermMemory;
import com.lyhn.wraith.memory.MemoryManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class MemoryToolsTest {

    private static MemoryManager manager(Path tmp) {
        return new MemoryManager(null, 4096, 128000, new LongTermMemory(tmp.resolve("memory-store").toFile()));
    }

    @Test
    void toolsFailHonestlyWhenManagerNotInjected() {
        ToolRegistry reg = new ToolRegistry();
        assertTrue(reg.executeTool("memory_list", "{}").startsWith("memory_list 失败"));
        assertTrue(reg.executeTool("memory_search", "{\"query\":\"x\"}").startsWith("memory_search 失败"));
        assertTrue(reg.executeTool("memory_delete", "{\"id\":\"x\"}").startsWith("memory_delete 失败"));
        assertTrue(reg.executeTool("memory_pending_list", "{}").startsWith("memory_pending_list 失败"));
    }

    @Test
    void listAndSearchAndDeleteRoundTrip(@TempDir Path tmp) {
        MemoryManager mm = manager(tmp);
        ToolRegistry reg = new ToolRegistry();
        reg.setMemoryManager(mm);
        assertTrue(mm.storeFact("用户偏好中文回复", "project"));

        String listed = reg.executeTool("memory_list", "{}");
        assertTrue(listed.contains("用户偏好中文回复"), listed);

        String found = reg.executeTool("memory_search", "{\"query\":\"中文\"}");
        assertTrue(found.contains("用户偏好中文回复"), found);

        String id = mm.listLongTerm().get(0).getId();
        String deleted = reg.executeTool("memory_delete", "{\"id\":\"" + id + "\"}");
        assertFalse(deleted.startsWith("memory_delete 失败"), deleted);
        assertTrue(mm.listLongTerm().isEmpty(), "删除后长期记忆应为空");
    }

    @Test
    void deleteUnknownIdFails(@TempDir Path tmp) {
        ToolRegistry reg = new ToolRegistry();
        reg.setMemoryManager(manager(tmp));
        assertTrue(reg.executeTool("memory_delete", "{\"id\":\"no-such\"}").startsWith("memory_delete 失败"));
    }

    @Test
    void searchRejectsBlankQuery(@TempDir Path tmp) {
        ToolRegistry reg = new ToolRegistry();
        reg.setMemoryManager(manager(tmp));
        assertTrue(reg.executeTool("memory_search", "{\"query\":\"  \"}").startsWith("memory_search 失败"));
    }

    @Test
    void pendingListEmptyIsNotAFailure(@TempDir Path tmp) {
        ToolRegistry reg = new ToolRegistry();
        reg.setMemoryManager(manager(tmp));
        String out = reg.executeTool("memory_pending_list", "{}");
        assertFalse(out.startsWith("memory_pending_list 失败"), out);
    }

    @Test
    void approveAndRejectUnknownIdFail(@TempDir Path tmp) {
        ToolRegistry reg = new ToolRegistry();
        reg.setMemoryManager(manager(tmp));
        assertTrue(reg.executeTool("memory_pending_approve", "{\"id\":\"x\"}").startsWith("memory_pending_approve 失败"));
        assertTrue(reg.executeTool("memory_pending_reject", "{\"id\":\"x\"}").startsWith("memory_pending_reject 失败"));
    }
}
```

⚠ **先确认 `MemoryManager` 的可用构造**：`grep -n "public MemoryManager" src/main/java/com/lyhn/wraith/memory/MemoryManager.java`。上面用的 4 参式来自 `PlanExecuteAgentTest.java:55-60` 的既有范式（`llmClient` 传 `null` 只要不触发抽取即可）；若 `null` client 会 NPE，就按既有测试的做法传一个最小 stub。断言不改，只调构造，并在报告写明。

- [ ] **Step 2: 运行,确认失败**

Run: `mvn -q -DskipTests=false -Dtest=MemoryToolsTest test`
Expected: FAIL —— `未知工具: memory_list` + `setMemoryManager` 编译错误。

- [ ] **Step 3: 注册工具 + 注入 setter**

`ToolRegistry` 字段区加：

```java
    private com.lyhn.wraith.memory.MemoryManager memoryManagerRef;

    /** 注入记忆管理器(读/删/候选审批用;写事实仍走既有 memorySaver 以保留凭证硬拦)。 */
    public void setMemoryManager(com.lyhn.wraith.memory.MemoryManager memoryManager) {
        this.memoryManagerRef = memoryManager;
    }
```

构造器注册序列末尾加 `registerMemoryQueryTools();`，并新增方法：

```java
    /** 记忆读/删/候选审批工具:与「记忆」面板同一个 MemoryManager。 */
    private void registerMemoryQueryTools() {
        tools.put("memory_list", new Tool(
                "memory_list",
                "列出已保存的长期记忆。用户问「你记得什么/我让你记过什么」时用。",
                createParameters(new Param("limit", "integer", "最多返回多少条,默认 30", false)),
                args -> {
                    if (memoryManagerRef == null) return "memory_list 失败: 记忆系统未初始化";
                    int limit = clamp(parseInt(args.get("limit"), 30), 1, 200);
                    var all = memoryManagerRef.listLongTerm();
                    if (all.isEmpty()) return "长期记忆为空。";
                    StringBuilder sb = new StringBuilder("长期记忆 " + all.size() + " 条(显示前 " + Math.min(limit, all.size()) + "):\n");
                    all.stream().limit(limit).forEach(e ->
                            sb.append("- [").append(e.getId()).append("] ").append(e.getContent()).append('\n'));
                    return sb.toString().trim();
                }
        ));

        tools.put("memory_search", new Tool(
                "memory_search",
                "按关键词搜索长期记忆。",
                createParameters(
                        new Param("query", "string", "搜索关键词", true),
                        new Param("limit", "integer", "最多返回多少条,默认 20", false)),
                args -> {
                    if (memoryManagerRef == null) return "memory_search 失败: 记忆系统未初始化";
                    String q = args.get("query");
                    if (q == null || q.isBlank()) return "memory_search 失败: query 不能为空";
                    int limit = clamp(parseInt(args.get("limit"), 20), 1, 100);
                    var hits = memoryManagerRef.searchLongTerm(q.trim(), limit);
                    if (hits.isEmpty()) return "没有匹配「" + q.trim() + "」的长期记忆。";
                    StringBuilder sb = new StringBuilder("匹配 " + hits.size() + " 条:\n");
                    hits.forEach(e -> sb.append("- [").append(e.getId()).append("] ").append(e.getContent()).append('\n'));
                    return sb.toString().trim();
                }
        ));

        tools.put("memory_delete", new Tool(
                "memory_delete",
                "删除一条长期记忆(按 id;先用 memory_list / memory_search 拿 id)。用户说「忘掉这条/别记了」时用。",
                createParameters(new Param("id", "string", "记忆条目 id", true)),
                args -> {
                    if (memoryManagerRef == null) return "memory_delete 失败: 记忆系统未初始化";
                    String id = args.get("id");
                    if (id == null || id.isBlank()) return "memory_delete 失败: id 不能为空";
                    boolean ok = memoryManagerRef.deleteLongTerm(id.trim());
                    return ok ? "已删除长期记忆 " + id.trim()
                              : "memory_delete 失败: 没有 id 为 '" + id.trim() + "' 的记忆";
                }
        ));

        tools.put("memory_pending_list", new Tool(
                "memory_pending_list",
                "列出「待确认」的记忆候选(系统自动从对话里提取、等你批准的)。",
                createParameters(),
                args -> {
                    if (memoryManagerRef == null) return "memory_pending_list 失败: 记忆系统未初始化";
                    var pending = memoryManagerRef.listPending();
                    if (pending.isEmpty()) return "没有待确认的记忆候选。";
                    StringBuilder sb = new StringBuilder("待确认候选 " + pending.size() + " 条:\n");
                    pending.forEach(p -> sb.append("- [").append(p.id()).append("] (")
                            .append(p.scope()).append(") ").append(p.fact()).append('\n'));
                    return sb.toString().trim();
                }
        ));

        tools.put("memory_pending_approve", new Tool(
                "memory_pending_approve",
                "批准一条待确认候选,把它正式存进长期记忆(按 id;先用 memory_pending_list 拿 id)。",
                createParameters(new Param("id", "string", "候选 id", true)),
                args -> {
                    if (memoryManagerRef == null) return "memory_pending_approve 失败: 记忆系统未初始化";
                    String id = args.get("id");
                    if (id == null || id.isBlank()) return "memory_pending_approve 失败: id 不能为空";
                    boolean ok = memoryManagerRef.approvePending(id.trim());
                    return ok ? "已批准候选 " + id.trim() + ",已存入长期记忆。"
                              : "memory_pending_approve 失败: 没有 id 为 '" + id.trim() + "' 的候选";
                }
        ));

        tools.put("memory_pending_reject", new Tool(
                "memory_pending_reject",
                "驳回一条待确认候选(按 id)。",
                createParameters(new Param("id", "string", "候选 id", true)),
                args -> {
                    if (memoryManagerRef == null) return "memory_pending_reject 失败: 记忆系统未初始化";
                    String id = args.get("id");
                    if (id == null || id.isBlank()) return "memory_pending_reject 失败: id 不能为空";
                    boolean ok = memoryManagerRef.rejectPending(id.trim());
                    return ok ? "已驳回候选 " + id.trim()
                              : "memory_pending_reject 失败: 没有 id 为 '" + id.trim() + "' 的候选";
                }
        ));
    }
```

- [ ] **Step 4: HITL + 审计名单**

`AUDIT_TOOLS` 追加 `"memory_delete"`, `"memory_pending_approve"`, `"memory_pending_reject"`；`DANGEROUS_TOOLS` 追加 `"memory_delete"`。

- [ ] **Step 5: 三处注入**

在下列三处**紧跟**既有 `setScopedMemorySaver(...)` 行各加一行（保证 ReAct / Plan / Team 三条路径都注入）：

- `src/main/java/com/lyhn/wraith/agent/Agent.java:93` 附近
- `src/main/java/com/lyhn/wraith/agent/PlanExecuteAgent.java:171` 附近
- `src/main/java/com/lyhn/wraith/agent/AgentOrchestrator.java:115` 附近

```java
        this.toolRegistry.setMemoryManager(this.memoryManager);
```

⚠ 各文件的字段名/`this.` 前缀以现场为准（`AgentOrchestrator:115` 写作 `this.toolRegistry.setScopedMemorySaver(memoryManager::storeFact)`，则同样写 `this.toolRegistry.setMemoryManager(memoryManager)`）。

- [ ] **Step 6: 运行测试 + 全量回归**

Run: `mvn -q -DskipTests=false -Dtest=MemoryToolsTest test` → PASS
Run: `mvn -q -DskipTests=false test` → 全绿

- [ ] **Step 7: 提交**

```bash
git add src/main/java/com/lyhn/wraith/tool/ToolRegistry.java src/main/java/com/lyhn/wraith/hitl/ApprovalPolicy.java src/main/java/com/lyhn/wraith/agent/Agent.java src/main/java/com/lyhn/wraith/agent/PlanExecuteAgent.java src/main/java/com/lyhn/wraith/agent/AgentOrchestrator.java src/test/java/com/lyhn/wraith/tool/MemoryToolsTest.java
git commit -m "feat(tool): 记忆工具 list/search/delete/pending-list/approve/reject + HITL/审计 + 三路径注入(Phase E3)"
```

---

### Task 4: 自动化工具（5 个）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`
- Modify: `src/main/java/com/lyhn/wraith/hitl/ApprovalPolicy.java`
- Create: `src/test/java/com/lyhn/wraith/tool/AutomationToolsTest.java`

**Interfaces:**
- Consumes: `AutomationStore.openDefault()` / `defaultRequestsDir()`（Task 1）、`loadTasks()` / `saveTasks(List)` / `loadRuns()`；`NextRun.isValidCron(String)`；`RequestInbox.openDefault()` + `write(new RequestInbox.Request(String type, String id, String payload))`；`AutomationTask`（public 字段 `id,name,prompt,workspace,schedule,enabled,deliverTo,approval,createdAt,enabledAt`）、`Schedule`（public 字段 `kind,everyMinutes,time,weekday,expr`）、`ScheduleKind.{INTERVAL,DAILY,WEEKLY,CRON}`、`AutomationRun`。
- Produces: 工具 `automation_list` / `automation_upsert` / `automation_remove` / `automation_run_now` / `automation_runs`。
- **载荷口径必须与面板一致**（`desktop/src/renderer/components/AutomationForm.tsx:130-142`）：新建时 `id = UUID.randomUUID().toString()`、`createdAt = enabledAt = System.currentTimeMillis()`、`enabled` 默认 true、`workspace` 默认取 `getProjectPath()`；编辑时保留原 `createdAt` / `deliverTo` / `approval`。

- [ ] **Step 1: 写失败测试**

创建 `src/test/java/com/lyhn/wraith/tool/AutomationToolsTest.java`:

```java
package com.lyhn.wraith.tool;

import com.lyhn.wraith.automation.AutomationStore;
import com.lyhn.wraith.automation.ScheduleKind;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class AutomationToolsTest {

    @TempDir Path tmp;
    private String old;

    @BeforeEach
    void redirectDir() {
        old = System.getProperty("wraith.automation.dir");
        System.setProperty("wraith.automation.dir", tmp.toString());
    }

    @AfterEach
    void restoreDir() {
        if (old == null) System.clearProperty("wraith.automation.dir");
        else System.setProperty("wraith.automation.dir", old);
    }

    @Test
    void upsertCronThenListThenRemove() {
        ToolRegistry reg = new ToolRegistry();
        String created = reg.executeTool("automation_upsert",
                "{\"name\":\"每日巡检\",\"prompt\":\"跑一遍测试\",\"cron\":\"0 9 * * *\"}");
        assertFalse(created.startsWith("automation_upsert 失败"), created);

        var tasks = AutomationStore.openDefault().loadTasks();
        assertEquals(1, tasks.size());
        assertEquals("每日巡检", tasks.get(0).name);
        assertEquals(ScheduleKind.CRON, tasks.get(0).schedule.kind);
        assertEquals("0 9 * * *", tasks.get(0).schedule.expr);
        assertTrue(tasks.get(0).enabled);
        assertTrue(tasks.get(0).createdAt > 0);
        String id = tasks.get(0).id;
        assertTrue(created.contains(id), "成功串应含任务 id: " + created);

        String listed = reg.executeTool("automation_list", "{}");
        assertTrue(listed.contains("每日巡检"), listed);

        String removed = reg.executeTool("automation_remove", "{\"id\":\"" + id + "\"}");
        assertFalse(removed.startsWith("automation_remove 失败"), removed);
        assertTrue(AutomationStore.openDefault().loadTasks().isEmpty());
    }

    @Test
    void upsertRejectsInvalidCron() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("automation_upsert",
                "{\"name\":\"坏\",\"prompt\":\"x\",\"cron\":\"不是 cron\"}");
        assertTrue(out.startsWith("automation_upsert 失败"), out);
        assertTrue(AutomationStore.openDefault().loadTasks().isEmpty(), "非法 cron 不得落盘");
    }

    @Test
    void upsertSupportsIntervalAndDaily() {
        ToolRegistry reg = new ToolRegistry();
        assertFalse(reg.executeTool("automation_upsert",
                "{\"name\":\"间隔\",\"prompt\":\"x\",\"every_minutes\":30}").startsWith("automation_upsert 失败"));
        assertFalse(reg.executeTool("automation_upsert",
                "{\"name\":\"每天\",\"prompt\":\"x\",\"daily_time\":\"08:30\"}").startsWith("automation_upsert 失败"));
        var kinds = AutomationStore.openDefault().loadTasks().stream().map(t -> t.schedule.kind).toList();
        assertTrue(kinds.contains(ScheduleKind.INTERVAL), kinds.toString());
        assertTrue(kinds.contains(ScheduleKind.DAILY), kinds.toString());
    }

    @Test
    void upsertRequiresNamePromptAndExactlyOneSchedule() {
        ToolRegistry reg = new ToolRegistry();
        assertTrue(reg.executeTool("automation_upsert", "{\"prompt\":\"x\",\"cron\":\"0 9 * * *\"}")
                .startsWith("automation_upsert 失败"));
        assertTrue(reg.executeTool("automation_upsert", "{\"name\":\"n\",\"cron\":\"0 9 * * *\"}")
                .startsWith("automation_upsert 失败"));
        assertTrue(reg.executeTool("automation_upsert", "{\"name\":\"n\",\"prompt\":\"x\"}")
                .startsWith("automation_upsert 失败"), "无 schedule 应失败");
        assertTrue(reg.executeTool("automation_upsert",
                "{\"name\":\"n\",\"prompt\":\"x\",\"cron\":\"0 9 * * *\",\"every_minutes\":5}")
                .startsWith("automation_upsert 失败"), "多个 schedule 应失败");
    }

    @Test
    void upsertWithExistingIdUpdatesInPlaceAndKeepsCreatedAt() {
        ToolRegistry reg = new ToolRegistry();
        reg.executeTool("automation_upsert", "{\"name\":\"原名\",\"prompt\":\"x\",\"cron\":\"0 9 * * *\"}");
        var before = AutomationStore.openDefault().loadTasks().get(0);
        String out = reg.executeTool("automation_upsert",
                "{\"id\":\"" + before.id + "\",\"name\":\"改名\",\"prompt\":\"y\",\"cron\":\"0 10 * * *\"}");
        assertFalse(out.startsWith("automation_upsert 失败"), out);
        var after = AutomationStore.openDefault().loadTasks();
        assertEquals(1, after.size(), "同 id 应就地更新而非新增");
        assertEquals("改名", after.get(0).name);
        assertEquals(before.createdAt, after.get(0).createdAt, "createdAt 应保留");
    }

    @Test
    void removeAndRunNowRejectUnknownId() {
        ToolRegistry reg = new ToolRegistry();
        assertTrue(reg.executeTool("automation_remove", "{\"id\":\"no-such\"}").startsWith("automation_remove 失败"));
        assertTrue(reg.executeTool("automation_run_now", "{\"id\":\"no-such\"}").startsWith("automation_run_now 失败"));
    }

    @Test
    void runNowQueuesRequestAndSaysItNeedsDaemon() {
        ToolRegistry reg = new ToolRegistry();
        reg.executeTool("automation_upsert", "{\"name\":\"n\",\"prompt\":\"x\",\"cron\":\"0 9 * * *\"}");
        String id = AutomationStore.openDefault().loadTasks().get(0).id;
        String out = reg.executeTool("automation_run_now", "{\"id\":\"" + id + "\"}");
        assertFalse(out.startsWith("automation_run_now 失败"), out);
        assertTrue(out.contains("守护"), "必须说明需要守护进程运行才会真的执行,实际: " + out);
        assertTrue(java.nio.file.Files.isDirectory(AutomationStore.defaultRequestsDir()), "应写出 request inbox 目录");
    }

    @Test
    void runsListingWorksOnEmptyStore() {
        ToolRegistry reg = new ToolRegistry();
        assertFalse(reg.executeTool("automation_runs", "{}").startsWith("automation_runs 失败"));
    }
}
```

- [ ] **Step 2: 运行,确认失败**

Run: `mvn -q -DskipTests=false -Dtest=AutomationToolsTest test`
Expected: FAIL —— `未知工具: automation_upsert`。

- [ ] **Step 3: 注册工具**

构造器注册序列末尾加 `registerAutomationTools();`，并新增方法：

```java
    /**
     * 自动化(定时任务)工具:与「自动化」面板共用 ~/.wraith/automations.json(经 AutomationStore.openDefault)。
     * ⚠ 已知限制:load-modify-save,与面板并发写为 last-writer-wins(既有风险,未引入新锁)。
     */
    private void registerAutomationTools() {
        tools.put("automation_list", new Tool(
                "automation_list",
                "列出定时/cron 自动化任务。用户问「有哪些定时任务」时用。",
                createParameters(),
                args -> {
                    try {
                        var tasks = com.lyhn.wraith.automation.AutomationStore.openDefault().loadTasks();
                        if (tasks.isEmpty()) return "当前没有自动化任务。";
                        StringBuilder sb = new StringBuilder("自动化任务 " + tasks.size() + " 个:\n");
                        for (var t : tasks) {
                            sb.append("- [").append(t.id).append("] ").append(t.name)
                                    .append(t.enabled ? "(启用)" : "(停用)")
                                    .append(" 计划: ").append(describeSchedule(t.schedule)).append('\n');
                        }
                        return sb.toString().trim();
                    } catch (Exception e) {
                        return "automation_list 失败: " + e.getMessage();
                    }
                }
        ));

        tools.put("automation_upsert", new Tool(
                "automation_upsert",
                "新建或修改一个定时自动化任务(到点自动跑给定 prompt)。三种排程二选一:cron 表达式(5 段)、"
                        + "every_minutes(每 N 分钟)、daily_time(每天 HH:mm)。不传 id 为新建,传已有 id 为修改。"
                        + "投递目标(发到 IM)与审批策略本工具不设置,需要时请到「自动化」面板配置(可用 open_panel(automations))。",
                createParameters(
                        new Param("name", "string", "任务名", true),
                        new Param("prompt", "string", "到点要执行的任务描述", true),
                        new Param("cron", "string", "标准 5 段 cron 表达式,如 0 9 * * *", false),
                        new Param("every_minutes", "integer", "每 N 分钟执行一次", false),
                        new Param("daily_time", "string", "每天固定时刻 HH:mm", false),
                        new Param("id", "string", "要修改的既有任务 id;省略则新建", false),
                        new Param("enabled", "boolean", "是否启用,默认 true", false),
                        new Param("workspace", "string", "工作目录,默认当前项目", false)),
                args -> upsertAutomation(args)
        ));

        tools.put("automation_remove", new Tool(
                "automation_remove",
                "删除一个自动化任务(按 id)。",
                createParameters(new Param("id", "string", "任务 id", true)),
                args -> {
                    String id = args.get("id");
                    if (id == null || id.isBlank()) return "automation_remove 失败: id 不能为空";
                    try {
                        var store = com.lyhn.wraith.automation.AutomationStore.openDefault();
                        var tasks = new java.util.ArrayList<>(store.loadTasks());
                        boolean removed = tasks.removeIf(t -> id.trim().equals(t.id));
                        if (!removed) return "automation_remove 失败: 没有 id 为 '" + id.trim() + "' 的任务";
                        store.saveTasks(tasks);
                        return "已删除自动化任务 " + id.trim();
                    } catch (Exception e) {
                        return "automation_remove 失败: " + e.getMessage();
                    }
                }
        ));

        tools.put("automation_run_now", new Tool(
                "automation_run_now",
                "立刻触发一个自动化任务(按 id)。注意:这只是把「立刻运行」请求排入队列,"
                        + "真正执行由自动化/网关守护进程完成;守护未运行时请求会一直排队。",
                createParameters(new Param("id", "string", "任务 id", true)),
                args -> {
                    String id = args.get("id");
                    if (id == null || id.isBlank()) return "automation_run_now 失败: id 不能为空";
                    try {
                        var tasks = com.lyhn.wraith.automation.AutomationStore.openDefault().loadTasks();
                        boolean exists = tasks.stream().anyMatch(t -> id.trim().equals(t.id));
                        if (!exists) return "automation_run_now 失败: 没有 id 为 '" + id.trim() + "' 的任务";
                        com.lyhn.wraith.automation.RequestInbox.openDefault().write(
                                new com.lyhn.wraith.automation.RequestInbox.Request("run-now", id.trim(), null));
                        return "已把任务 " + id.trim() + " 的「立刻运行」请求排入队列。"
                                + "需自动化/网关守护进程正在运行才会真正执行(未运行则一直排队)。";
                    } catch (Exception e) {
                        return "automation_run_now 失败: " + e.getMessage();
                    }
                }
        ));

        tools.put("automation_runs", new Tool(
                "automation_runs",
                "查看自动化任务的历史运行记录。",
                createParameters(
                        new Param("task_id", "string", "只看某个任务的记录;省略则看全部", false),
                        new Param("limit", "integer", "最多返回多少条,默认 20", false)),
                args -> {
                    try {
                        String taskId = args.get("task_id");
                        int limit = clamp(parseInt(args.get("limit"), 20), 1, 100);
                        var runs = com.lyhn.wraith.automation.AutomationStore.openDefault().loadRuns();
                        var filtered = runs.stream()
                                .filter(r -> taskId == null || taskId.isBlank() || taskId.trim().equals(r.taskId))
                                .limit(limit)
                                .toList();
                        if (filtered.isEmpty()) return "没有运行记录。";
                        StringBuilder sb = new StringBuilder("运行记录 " + filtered.size() + " 条:\n");
                        for (var r : filtered) {
                            sb.append("- ").append(r.runId).append(" task=").append(r.taskId)
                                    .append(" status=").append(r.status).append('\n');
                        }
                        return sb.toString().trim();
                    } catch (Exception e) {
                        return "automation_runs 失败: " + e.getMessage();
                    }
                }
        ));
    }

    /** 排程可读描述(仅用于列表输出)。 */
    private static String describeSchedule(com.lyhn.wraith.automation.Schedule s) {
        if (s == null || s.kind == null) return "未设置";
        return switch (s.kind) {
            case CRON -> "cron " + s.expr;
            case INTERVAL -> "每 " + s.everyMinutes + " 分钟";
            case DAILY -> "每天 " + s.time;
            case WEEKLY -> "每周 " + s.weekday + " " + s.time;
        };
    }

    /** automation_upsert 主体:校验 → 组装 AutomationTask(与面板同口径)→ load-modify-save。 */
    private String upsertAutomation(Map<String, String> args) {
        String name = args.get("name");
        String prompt = args.get("prompt");
        if (name == null || name.isBlank()) return "automation_upsert 失败: name 不能为空";
        if (prompt == null || prompt.isBlank()) return "automation_upsert 失败: prompt 不能为空";

        String cron = args.get("cron");
        String everyRaw = args.get("every_minutes");
        String daily = args.get("daily_time");
        int provided = 0;
        if (cron != null && !cron.isBlank()) provided++;
        if (everyRaw != null && !everyRaw.isBlank()) provided++;
        if (daily != null && !daily.isBlank()) provided++;
        if (provided != 1) {
            return "automation_upsert 失败: cron / every_minutes / daily_time 三者必须且只能提供一个";
        }

        com.lyhn.wraith.automation.Schedule schedule = new com.lyhn.wraith.automation.Schedule();
        if (cron != null && !cron.isBlank()) {
            if (!com.lyhn.wraith.automation.NextRun.isValidCron(cron.trim())) {
                return "automation_upsert 失败: 非法 cron 表达式 '" + cron.trim() + "'(需标准 5 段)";
            }
            schedule.kind = com.lyhn.wraith.automation.ScheduleKind.CRON;
            schedule.expr = cron.trim();
        } else if (everyRaw != null && !everyRaw.isBlank()) {
            int every = parseInt(everyRaw, -1);
            if (every <= 0) return "automation_upsert 失败: every_minutes 必须为正整数";
            schedule.kind = com.lyhn.wraith.automation.ScheduleKind.INTERVAL;
            schedule.everyMinutes = every;
        } else {
            String t = daily.trim();
            if (!t.matches("^([01]\\d|2[0-3]):[0-5]\\d$")) {
                return "automation_upsert 失败: daily_time 必须是 HH:mm(24 小时制)";
            }
            schedule.kind = com.lyhn.wraith.automation.ScheduleKind.DAILY;
            schedule.time = t;
        }

        try {
            var store = com.lyhn.wraith.automation.AutomationStore.openDefault();
            var tasks = new java.util.ArrayList<>(store.loadTasks());
            String id = args.get("id");
            com.lyhn.wraith.automation.AutomationTask existing = null;
            if (id != null && !id.isBlank()) {
                for (var t : tasks) {
                    if (id.trim().equals(t.id)) { existing = t; break; }
                }
                if (existing == null) return "automation_upsert 失败: 没有 id 为 '" + id.trim() + "' 的任务";
            }

            long now = System.currentTimeMillis();
            var task = new com.lyhn.wraith.automation.AutomationTask();
            task.id = existing != null ? existing.id : java.util.UUID.randomUUID().toString();
            task.name = name.trim();
            task.prompt = prompt.trim();
            String ws = args.get("workspace");
            task.workspace = (ws != null && !ws.isBlank()) ? ws.trim()
                    : (existing != null && existing.workspace != null ? existing.workspace : projectPath);
            task.schedule = schedule;
            task.enabled = args.containsKey("enabled")
                    ? parseBoolean(args.get("enabled"), true)
                    : (existing == null || existing.enabled);
            task.deliverTo = existing != null ? existing.deliverTo : null;
            task.approval = existing != null ? existing.approval : null;
            task.createdAt = existing != null && existing.createdAt > 0 ? existing.createdAt : now;
            task.enabledAt = existing != null && existing.enabledAt > 0 ? existing.enabledAt : now;

            tasks.removeIf(t -> task.id.equals(t.id));
            tasks.add(task);
            store.saveTasks(tasks);
            return (existing != null ? "已更新" : "已创建") + "自动化任务 " + task.id
                    + "(" + task.name + ",计划 " + describeSchedule(schedule) + ")。"
                    + "投递目标与审批策略如需设置,请打开「自动化」面板。";
        } catch (Exception e) {
            return "automation_upsert 失败: " + e.getMessage();
        }
    }
```

⚠ `AutomationRun` 的字段名以现场为准（`grep -n "public String" src/main/java/com/lyhn/wraith/automation/AutomationRun.java`）；若不是 `runId/taskId/status` 三个 public 字段，按真实字段调整 `automation_runs` 的输出拼接并在报告说明。

- [ ] **Step 4: HITL + 审计名单**

`AUDIT_TOOLS` 追加 `"automation_upsert"`, `"automation_remove"`, `"automation_run_now"`；`DANGEROUS_TOOLS` 追加同样这三个。

- [ ] **Step 5: 运行测试 + 全量回归**

Run: `mvn -q -DskipTests=false -Dtest=AutomationToolsTest test` → PASS
Run: `mvn -q -DskipTests=false test` → 全绿

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/tool/ToolRegistry.java src/main/java/com/lyhn/wraith/hitl/ApprovalPolicy.java src/test/java/com/lyhn/wraith/tool/AutomationToolsTest.java
git commit -m "feat(tool): 自动化工具 list/upsert/remove/run_now/runs(与面板同口径 + 排队诚实说明)+ HITL/审计(Phase E4)"
```

---

### Task 5: 闸门断言 + prompt 登记

**Files:**
- Create: `src/test/java/com/lyhn/wraith/tool/ToolGatingTest.java`
- Modify: `src/main/resources/prompts/base.md`（`## Tools` 列表；`## Browser Policy`）
- Modify: `src/main/resources/prompts/capabilities.md`（三件套行改写）
- Modify: `src/test/java/com/lyhn/wraith/prompt/PromptAssemblerTest.java`

**Interfaces:**
- Consumes: 前四个任务注册的 15 个工具名；`ToolRegistry.hasTool(String)`（`:1470`）；`ApprovalPolicy`（判定入口以现场为准，见下）。
- Produces: 无新生产符号 —— 锁死「工具已注册 + 高危工具确实进 HITL」+ 让模型知道这些工具存在。

- [ ] **Step 1: 写闸门测试**

创建 `src/test/java/com/lyhn/wraith/tool/ToolGatingTest.java`:

```java
package com.lyhn.wraith.tool;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** 三件套工具的注册与闸门:防「工具没注册」「高危工具漏进 HITL」两类静默失效。 */
class ToolGatingTest {

    private static final List<String> ALL_NEW = List.of(
            "task_add", "task_list", "task_get", "task_cancel",
            "memory_list", "memory_search", "memory_delete",
            "memory_pending_list", "memory_pending_approve", "memory_pending_reject",
            "automation_list", "automation_upsert", "automation_remove",
            "automation_run_now", "automation_runs");

    private static final List<String> MUST_BE_HITL = List.of(
            "task_add", "memory_delete",
            "automation_upsert", "automation_remove", "automation_run_now");

    @Test
    void allNewToolsAreRegisteredAndExposedToLlm() {
        ToolRegistry reg = new ToolRegistry();
        var exposed = reg.getToolDefinitions().stream().map(t -> t.name()).toList();
        for (String name : ALL_NEW) {
            assertTrue(reg.hasTool(name), name + " 应已注册");
            assertTrue(exposed.contains(name), name + " 应暴露给 LLM");
        }
    }

    @Test
    void highConsequenceWritesRequireApproval() {
        for (String name : MUST_BE_HITL) {
            assertTrue(com.lyhn.wraith.hitl.ApprovalPolicy.requiresApproval(name),
                    name + " 必须走 HITL 审批");
        }
    }

    @Test
    void readOnlyToolsDoNotRequireApproval() {
        for (String name : List.of("task_list", "task_get", "memory_list", "memory_search",
                "memory_pending_list", "automation_list", "automation_runs")) {
            assertFalse(com.lyhn.wraith.hitl.ApprovalPolicy.requiresApproval(name),
                    name + " 是只读工具,不该设审批闸");
        }
    }
}
```

⚠ **先确认 `ApprovalPolicy` 的公开判定方法名**：`grep -n "public static" src/main/java/com/lyhn/wraith/hitl/ApprovalPolicy.java`。若不是 `requiresApproval(String)`，改用真实方法（必要时按其签名补参数），断言语义不变，并在报告写明。

- [ ] **Step 2: 运行,确认通过或暴露漏网**

Run: `mvn -q -DskipTests=false -Dtest=ToolGatingTest test`
Expected: PASS（Task 2-4 若名单填全就应直接绿）。**若红**，说明前面任务漏了某个名单项 —— 补上对应名单，不要改测试期望。

- [ ] **Step 3: base.md 登记 15 个工具 + 补 browser 两条**

在 `## Tools` 列表 `16. im_connect` 之后追加：

```markdown
17. `task_add` / `task_list` / `task_get` / `task_cancel` - 后台异步任务（发后即走），参数：`{"prompt": "..."}` / `{"limit": 20}` / `{"id": "..."}`
18. `memory_list` / `memory_search` / `memory_delete` - 查看、搜索、删除长期记忆，参数：`{"limit": 30}` / `{"query": "关键词"}` / `{"id": "..."}`
19. `memory_pending_list` / `memory_pending_approve` / `memory_pending_reject` - 待确认记忆候选的查看与批准/驳回，参数：`{}` / `{"id": "..."}`
20. `automation_list` / `automation_upsert` / `automation_remove` / `automation_run_now` / `automation_runs` - 定时（cron）自动化任务的增删改查与立即触发，参数：`{"name": "...", "prompt": "...", "cron": "0 9 * * *"}`（或 `every_minutes` / `daily_time` 之一）
```

在 `## Browser Policy` 段末追加一条（补审计发现的「注册了但从未在 prompt 里出现」）：

```markdown
- 登录态任务做完可用 `browser_disconnect` 切回 isolated 模式；不确定当前浏览器状态时用 `browser_status` 查看。
```

- [ ] **Step 4: capabilities.md 三件套行改写**

把这三行的「怎么用 / 指路」列改成「聊天里能直接做」（其余 8 行不动）：

- **自动化** 行 →
  `聊天里可直接 automation_list / automation_upsert（cron、every_minutes、daily_time 三选一）/ automation_remove / automation_run_now / automation_runs。⚠ run_now 只是排队，需自动化/网关守护进程运行才会真的执行；投递目标与审批策略仍需到面板配置。open_panel(automations)`
- **记忆** 行 →
  `聊天里可直接 memory_list / memory_search / memory_delete，以及 memory_pending_list / memory_pending_approve / memory_pending_reject 处理待确认候选；保存新事实仍用 save_memory。open_panel(memory)`
- **后台任务** 行 →
  `聊天里可直接 task_add（发后即走）/ task_list / task_get / task_cancel。open_panel(tasks)`

- [ ] **Step 5: 追加 prompt 断言**

在 `PromptAssemblerTest.java` 追加：

```java
    @Test
    void advertisesChatPanelParityTools() {
        // 防回归:三件套工具必须在系统提示词里登记,否则模型不知道能用(等于白做)
        String prompt = PromptAssembler.createDefault().assemble(PromptMode.AGENT, PromptContext.empty());
        for (String name : java.util.List.of("task_add", "memory_search", "memory_pending_approve",
                "automation_upsert", "automation_run_now", "browser_disconnect")) {
            assertTrue(prompt.contains(name), "系统提示词应登记 " + name);
        }
    }
```

- [ ] **Step 6: 全量回归（Java + 桌面零改动确认）**

Run: `mvn -q -DskipTests=false test` → 全绿
Run: `cd desktop && npm test && npm run typecheck` → 全绿（桌面本期无代码改动；顺带 `git status --short desktop/` 应为空）

- [ ] **Step 7: 提交**

```bash
git add src/test/java/com/lyhn/wraith/tool/ToolGatingTest.java src/main/resources/prompts/base.md src/main/resources/prompts/capabilities.md src/test/java/com/lyhn/wraith/prompt/PromptAssemblerTest.java
git commit -m "feat(prompt): 登记三件套 15 工具 + 补 browser_disconnect/status + 闸门断言(Phase E5)"
```

---

## Self-Review（写完计划的自查）

**1. Spec 覆盖** —— spec §4 各节 → 任务映射：
- §4.1 统一原则（直调服务 / 注入范式 / 写操作分级 / 扁平参数）→ 贯穿 Task 2-4，闸门由 Task 5 锁 ✓
- §4.2 后台任务（4 工具 + 注入 + HITL task_add）→ Task 2 ✓
- §4.3 记忆（6 工具 + 注入 + HITL memory_delete；不做 clear 类）→ Task 3 ✓
- §4.4 自动化（5 工具 + cron 校验 + 三种 schedule + 两条诚实边界）→ Task 4；目录同源前置 → Task 1 ✓
- §4.5 prompt 更新（base.md + capabilities.md + browser 两条）→ Task 5 ✓
- §4.6 测试（每家族参数校验 / 成功路径真副作用 / 失败串前缀 / HITL 名单断言）→ Task 2-5 ✓

**2. 无占位** —— 15 个工具全部给出可粘贴实现；4 处「⚠ 先确认真实签名」都给了核验命令 + 偏离时的处置（调构造/字段名，不改断言），非让实现者猜。

**3. 类型一致** —— `setTaskManager` / `setMemoryManager` 命名与既有 `setTodoSink` / `setScopedMemorySaver` 同风格；字段 `memoryManagerRef` 避免与既有 `memorySaver` 混淆；`describeSchedule` / `upsertAutomation` 为私有辅助，仅 Task 4 使用；工具名在 Task 5 的 `ALL_NEW` / `MUST_BE_HITL` 里与 Task 2-4 注册名逐字一致。

**4. 关键风险已固化** —— 目录同源（Task 1，防「agent 写了面板看不到」）、`run_now` 排队诚实说明（Task 4 测试断言含「守护」二字）、HITL 名单由 Task 5 独立断言（防漏网）、未注入时诚实失败（Task 2/3 首个测试）。
