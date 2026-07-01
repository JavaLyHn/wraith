# Wraith 桌面端 P2(macOS Seatbelt 沙箱)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `wraith app-server` 模式的命令执行套上 macOS Seatbelt(`sandbox-exec`)沙箱——写限定 workspace+`$TMPDIR`、`.git` 只读、默认断网——并把既有的 in-process 文件路径限定(`PathGuard`)在工具边界补测锁定。

**Architecture:** 命令执行只有一个 spawn 点(`ToolRegistry.executeCommand` 的 `ProcessBuilder`,`ToolRegistry.java:1362`)。新增 `policy/sandbox/` 包,`SeatbeltProfile` 生成 SBPL profile 文本、`CommandSandbox` 把 `bash -c <cmd>` 包成 `sandbox-exec -D … -p <profile> bash -c <cmd>`。`ToolRegistry` 持有一个**可选** `CommandSandbox`(为 `null` 时行为与今天完全一致);仅 `wraith app-server` 启动时注入。非 macOS / 无 `sandbox-exec` 时 fail-open(裸跑 + 一条 WARN)。

**Tech Stack:** Java 17 / Maven / JUnit 5(Jupiter);macOS `sandbox-exec`(Seatbelt SBPL);slf4j+logback(既有)。无新增第三方依赖。

## Global Constraints

以下为项目级 / spec 级约束,**每个任务隐含包含本节**:

- 包根 `com.lyhn.wraith`;Java 17;Maven。
- **测试默认被 pom 跳过**。跑测试必须 `mvn test -DskipTests=false -Dtest=<Class>`,并确认输出里的 `Tests run: N, Failures: F, Errors: E` 行;不能只看 BUILD SUCCESS。
- **环境性基线**(见项目记忆 `testing_quirks`):JDK26+Mockito 下约 3F/38E 的既有失败/错误(InlineRenderer/BottomStatusBar/TerminalCapabilities/TuiBootstrap/CodeIndex/TerminalMarkdownRenderer 等),**与本改动无关**。本计划所有新测试**禁用 Mockito**,用手写 fake / 真实 `sandbox-exec`;跨平台不确定的用 `assumeTrue` 守护。跑完对照失败集,新代码必须 0 新增失败。
- **沙箱范围(已定):仅 `app-server` 模式**。交互式 CLI 不注入 `CommandSandbox`(保持裸跑 + `CommandGuard` 黑名单 + HITL 现状)。
- **平台(已定):仅 macOS**。非 macOS 或 `sandbox-exec` 不可用时 **fail-open**:命令裸跑 + 记一条 WARN 日志(不是 fail-closed)。
- **读权限(已定):宽松**。profile 以 `(allow default)` 打底,只收紧「写」与「网络」;安全边界 = 写限定 + 断网,不限制读。
- **网络(已定):默认断网**。全局开关 `-Dwraith.sandbox.network=on` 可整体放行(给测试/高级用户);**逐命令「本次放行网络」的审批 UI 交互推迟到 P4**,本阶段不做。
- **写限定**:仅允许写 workspace 根 + `$TMPDIR` + 少量必要设备节点(`/dev/null` 等);`.git` 目录即使在 workspace 内也标记**只读**;`~/.wraith` 在 workspace 外,天然被拒。
- 沙箱**只包 `execute_command` 的子进程**(`ToolRegistry.java:1362`)。MCP stdio(`StdioTransport`)、ripgrep(`RipgrepCodeSearchEngine`)、剪贴板(`ClipboardImage`)等基础设施子进程**明确不在 P2 范围**(它们非 LLM 直接驱动)。
- **保留既有防线**:`CommandGuard`(命令黑名单,`ToolRegistry.java:1347`)、HITL 审批、`AuditLog` 全部保持不动——沙箱是**叠加**的防御纵深,不替换它们。
- Seatbelt 路径匹配基于内核看到的**真实路径**(realpath)。传给 profile 的 workspace / TMPDIR / git-dir 必须先 `toRealPath` 解析(macOS `/var`→`/private/var`、`/tmp`→`/private/tmp` 软链)。

---

## 文件结构

**新建:**
- `src/main/java/com/lyhn/wraith/policy/sandbox/SeatbeltProfile.java` —— 纯函数:生成 SBPL profile 文本 + `-D` 参数列表。无状态、无 IO、无平台依赖。
- `src/main/java/com/lyhn/wraith/policy/sandbox/CommandSandbox.java` —— 把一条命令包成 `sandbox-exec …` 命令行;平台探测 + fail-open。持有 `networkAllowed`。
- `src/test/java/com/lyhn/wraith/tool/ToolRegistryFileConfinementTest.java` —— 工具边界锁:`write_file`/`read_file` 拒绝 workspace 外路径(§4.2 集成锁)。
- `src/test/java/com/lyhn/wraith/policy/sandbox/SeatbeltProfileTest.java` —— profile 文本/参数单测。
- `src/test/java/com/lyhn/wraith/policy/sandbox/CommandSandboxTest.java` —— `buildCommand` 两分支纯单测。
- `src/test/java/com/lyhn/wraith/policy/sandbox/SeatbeltSandboxTest.java` —— 真实 `sandbox-exec` 集成测试(`assumeTrue(mac)`):写/读/网络边界证明。
- `src/test/java/com/lyhn/wraith/tool/ToolRegistrySandboxWiringTest.java` —— `resolveProcessCommand` 接线单测。
- `src/test/java/com/lyhn/wraith/tool/ExecuteCommandSandboxIntegrationTest.java` —— 经真实 `execute_command` 工具路径的端到端限定(`assumeTrue(mac)`)。
- `src/test/java/com/lyhn/wraith/cli/MainAppServerSandboxTest.java` —— `buildAppServerSandbox()` 读全局网络开关。

**修改:**
- `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java` —— 加 slf4j logger、可选 `CommandSandbox` 字段 + setter、`resolveProcessCommand()`;`executeCommand` 的 `ProcessBuilder` 构造(1362)改用它。
- `src/main/java/com/lyhn/wraith/cli/Main.java` —— 加包级静态 `buildAppServerSandbox()`;`startAppServer()` 在 1130 后注入沙箱。

---

## Task 1: 文件工具路径限定的工具边界锁(spec §4.2)

**背景:** `PathGuard`(`policy/PathGuard.java`)已实现越界拒绝,且 `PathGuardTest` 已测过该原语。本任务不重造轮子,只在**工具边界**补一个集成回归锁,证明 `write_file`/`read_file` 确实走了 `PathGuard`——这是 spec §4.2「edit/write 工具拒绝 workspace 外路径」的真正验收点。

**Files:**
- Test: `src/test/java/com/lyhn/wraith/tool/ToolRegistryFileConfinementTest.java`

**Interfaces:**
- Consumes: `ToolRegistry`(`com.lyhn.wraith.tool`);`ToolRegistry.setProjectPath(String)`;`ToolRegistry.executeToolOutput(String name, String argumentsJson) -> ToolOutput`;`ToolOutput.text() -> String`。
- Produces: 无(纯测试任务)。

- [ ] **Step 1: 写失败测试**

`ToolRegistryFileConfinementTest.java`:

```java
package com.lyhn.wraith.tool;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/** 工具边界锁:文件工具必须拒绝 workspace 外路径(spec §4.2)。 */
class ToolRegistryFileConfinementTest {

    private static final ObjectMapper M = new ObjectMapper();

    private static String args(String key, String value) {
        ObjectNode n = M.createObjectNode();
        n.put(key, value);
        return n.toString();
    }

    @Test
    void writeFileRejectsPathOutsideWorkspace() throws Exception {
        Path ws = Files.createTempDirectory("wraith-conf-ws-");
        ToolRegistry reg = new ToolRegistry();
        reg.setProjectPath(ws.toString());

        ObjectNode a = M.createObjectNode();
        a.put("path", "../escape-" + System.nanoTime() + ".txt");
        a.put("content", "should not be written");
        String out = reg.executeToolOutput("write_file", a.toString()).text();

        // PathGuard 抛 PolicyException,executeTool 统一格式化为拒绝消息
        assertTrue(out.contains("拒绝") || out.toLowerCase().contains("policy")
                        || out.contains("越界") || out.contains("失败"),
                "越界写入应被拒绝,实际输出: " + out);
        assertFalse(Files.exists(ws.getParent().resolve("escape-" + a.get("path"))),
                "越界文件不应被创建");
    }

    @Test
    void readFileRejectsAbsolutePathOutsideWorkspace() throws Exception {
        Path ws = Files.createTempDirectory("wraith-conf-ws2-");
        ToolRegistry reg = new ToolRegistry();
        reg.setProjectPath(ws.toString());

        String out = reg.executeToolOutput("read_file", args("path", "/etc/hosts")).text();
        assertTrue(out.contains("拒绝") || out.toLowerCase().contains("policy")
                        || out.contains("越界") || out.contains("失败"),
                "越界读取应被拒绝,实际输出: " + out);
    }

    @Test
    void writeFileAllowsPathInsideWorkspace() throws Exception {
        Path ws = Files.createTempDirectory("wraith-conf-ws3-");
        ToolRegistry reg = new ToolRegistry();
        reg.setProjectPath(ws.toString());

        ObjectNode a = M.createObjectNode();
        a.put("path", "inside.txt");
        a.put("content", "ok");
        String out = reg.executeToolOutput("write_file", a.toString()).text();

        assertTrue(Files.exists(ws.resolve("inside.txt")), "workspace 内写入应成功: " + out);
        assertEquals("ok", Files.readString(ws.resolve("inside.txt")));
    }
}
```

- [ ] **Step 2: 跑测试确认「拒绝」两条通过、「允许」一条也通过(若都过说明 PathGuard 已生效)**

Run: `mvn test -DskipTests=false -Dtest=ToolRegistryFileConfinementTest`
Expected: `Tests run: 3, Failures: 0, Errors: 0`。
若「拒绝」类断言失败(越界文件被创建),说明工具**没有**走 `PathGuard`——这是真实缺陷,STOP 并上报控制者,不要绕过。

- [ ] **Step 3: 无需实现**

`PathGuard` 已实现该行为。本任务是回归锁。若上一步全绿,直接提交;若有红,上报。

- [ ] **Step 4: 提交**

```bash
git add src/test/java/com/lyhn/wraith/tool/ToolRegistryFileConfinementTest.java
git commit -m "test(sandbox): 工具边界锁定文件路径限定(spec §4.2)"
```

---

## Task 2: `SeatbeltProfile` —— SBPL profile 生成(纯函数)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/policy/sandbox/SeatbeltProfile.java`
- Test: `src/test/java/com/lyhn/wraith/policy/sandbox/SeatbeltProfileTest.java`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `static String SeatbeltProfile.workspaceWrite(boolean networkAllowed)` —— 返回完整 SBPL profile 文本。
  - `static java.util.List<String> SeatbeltProfile.params(String workspaceRoot, String tmpDir, String gitDir)` —— 返回 `["-D","WORKSPACE=<root>","-D","TMPDIR=<tmp>","-D","GIT_DIR=<git>"]`。

**Profile 设计(SBPL,后匹配规则优先):** `(allow default)` 打底(宽松读)→ `(deny file-write*)` 全禁写 → 放行 workspace/`$TMPDIR`/必要设备 → `.git` 只读(覆盖前面的 workspace 放行)→ 断网(仅 `networkAllowed=false` 时写)。

- [ ] **Step 1: 写失败测试**

`SeatbeltProfileTest.java`:

```java
package com.lyhn.wraith.policy.sandbox;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SeatbeltProfileTest {

    @Test
    void networkOffProfileDeniesNetworkAndConfinesWrites() {
        String p = SeatbeltProfile.workspaceWrite(false);
        assertTrue(p.contains("(version 1)"), p);
        assertTrue(p.contains("(allow default)"), "宽松读:allow default 打底");
        assertTrue(p.contains("(deny file-write*)"), "先全禁写");
        assertTrue(p.contains("(subpath (param \"WORKSPACE\"))"), "放行 workspace 写");
        assertTrue(p.contains("(subpath (param \"TMPDIR\"))"), "放行 TMPDIR 写");
        assertTrue(p.contains("(deny file-write* (subpath (param \"GIT_DIR\")))"), ".git 只读");
        assertTrue(p.contains("(deny network*)"), "默认断网");
    }

    @Test
    void networkOnProfileOmitsNetworkDenyButKeepsWriteConfinement() {
        String p = SeatbeltProfile.workspaceWrite(true);
        assertFalse(p.contains("(deny network*)"), "放行网络时不加断网规则");
        assertTrue(p.contains("(deny file-write*)"), "写限定与网络无关,始终保留");
        assertTrue(p.contains("(subpath (param \"WORKSPACE\"))"));
    }

    @Test
    void paramsCarryAllThreeDefines() {
        List<String> ps = SeatbeltProfile.params("/ws", "/tmpd", "/ws/.git");
        assertEquals(List.of(
                "-D", "WORKSPACE=/ws",
                "-D", "TMPDIR=/tmpd",
                "-D", "GIT_DIR=/ws/.git"), ps);
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=SeatbeltProfileTest`
Expected: FAIL —— 编译错误 `cannot find symbol: SeatbeltProfile`(类未创建)。

- [ ] **Step 3: 实现 `SeatbeltProfile`**

`SeatbeltProfile.java`:

```java
package com.lyhn.wraith.policy.sandbox;

import java.util.List;

/**
 * 生成 macOS Seatbelt(sandbox-exec)的 SBPL profile 文本与 -D 参数。
 *
 * <p>workspace-write 语义:{@code (allow default)} 打底(宽松读)→ 收紧写与网络。
 * SBPL 后匹配规则优先,故 {@code .git} 的 deny 写在 workspace allow 之后以覆盖之。
 * 纯函数,无状态、无 IO、无平台依赖。
 */
public final class SeatbeltProfile {

    private SeatbeltProfile() {}

    /**
     * workspace-write profile:宽松读、写限定 workspace+$TMPDIR、.git 只读。
     *
     * @param networkAllowed true 则省略断网规则(全局放行);false 默认断网
     */
    public static String workspaceWrite(boolean networkAllowed) {
        StringBuilder sb = new StringBuilder(512);
        sb.append("(version 1)\n");
        // 宽松读 + 非文件/非网络操作放行;随后逐步收紧
        sb.append("(allow default)\n");
        // 写:先全禁,再放行 workspace / 临时目录
        sb.append("(deny file-write*)\n");
        sb.append("(allow file-write*\n");
        sb.append("    (subpath (param \"WORKSPACE\"))\n");
        sb.append("    (subpath (param \"TMPDIR\")))\n");
        // 常用设备/终端写(否则大量命令会崩)
        sb.append("(allow file-write*\n");
        sb.append("    (literal \"/dev/null\")\n");
        sb.append("    (literal \"/dev/zero\")\n");
        sb.append("    (literal \"/dev/stdout\")\n");
        sb.append("    (literal \"/dev/stderr\")\n");
        sb.append("    (literal \"/dev/tty\")\n");
        sb.append("    (subpath \"/dev/fd\"))\n");
        // .git 只读:覆盖上面的 workspace 放行(后匹配优先)
        sb.append("(deny file-write* (subpath (param \"GIT_DIR\")))\n");
        // 网络:默认全禁
        if (!networkAllowed) {
            sb.append("(deny network*)\n");
        }
        return sb.toString();
    }

    /** 构造 sandbox-exec 的 -D 参数(WORKSPACE / TMPDIR / GIT_DIR)。 */
    public static List<String> params(String workspaceRoot, String tmpDir, String gitDir) {
        return List.of(
                "-D", "WORKSPACE=" + workspaceRoot,
                "-D", "TMPDIR=" + tmpDir,
                "-D", "GIT_DIR=" + gitDir);
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=SeatbeltProfileTest`
Expected: `Tests run: 3, Failures: 0, Errors: 0`,输出无 warning。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/policy/sandbox/SeatbeltProfile.java \
        src/test/java/com/lyhn/wraith/policy/sandbox/SeatbeltProfileTest.java
git commit -m "feat(sandbox): SeatbeltProfile 生成 workspace-write SBPL"
```

---

## Task 3: `CommandSandbox` —— 命令包裹 + 平台探测 + fail-open

**Files:**
- Create: `src/main/java/com/lyhn/wraith/policy/sandbox/CommandSandbox.java`
- Test: `src/test/java/com/lyhn/wraith/policy/sandbox/CommandSandboxTest.java`

**Interfaces:**
- Consumes: `SeatbeltProfile.workspaceWrite(boolean)`、`SeatbeltProfile.params(String,String,String)`。
- Produces:
  - `new CommandSandbox(boolean networkAllowed)`
  - `boolean CommandSandbox.networkAllowed()`
  - `static boolean CommandSandbox.available()` —— macOS 且 `/usr/bin/sandbox-exec` 可执行
  - `CommandSandbox.Wrapped CommandSandbox.wrap(String workspaceRoot, String command)`
  - `record Wrapped(java.util.List<String> command, boolean sandboxed, String warning)`
  - `static Wrapped CommandSandbox.buildCommand(boolean sandboxAvailable, boolean networkAllowed, String root, String tmpDir, String gitDir, String command)`(包级,可测)

- [ ] **Step 1: 写失败测试(纯 `buildCommand` 两分支,无平台依赖)**

`CommandSandboxTest.java`:

```java
package com.lyhn.wraith.policy.sandbox;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class CommandSandboxTest {

    @Test
    void sandboxAvailable_wrapsWithSandboxExecAndProfile() {
        CommandSandbox.Wrapped w = CommandSandbox.buildCommand(
                true, false, "/ws", "/tmpd", "/ws/.git", "echo hi");

        assertTrue(w.sandboxed());
        assertNull(w.warning());
        List<String> c = w.command();
        assertEquals("/usr/bin/sandbox-exec", c.get(0));
        assertTrue(c.contains("WORKSPACE=/ws"));
        assertTrue(c.contains("GIT_DIR=/ws/.git"));
        assertEquals("-p", c.get(c.size() - 4));
        assertTrue(c.get(c.size() - 3).contains("(deny network*)"), "断网 profile 内联在 -p");
        assertEquals(List.of("bash", "-c", "echo hi"),
                c.subList(c.size() - 3, c.size()), "真实命令走 bash -c 尾部");
    }

    @Test
    void networkAllowed_profileHasNoNetworkDeny() {
        CommandSandbox.Wrapped w = CommandSandbox.buildCommand(
                true, true, "/ws", "/tmpd", "/ws/.git", "curl example.com");
        String profile = w.command().get(w.command().size() - 3);
        assertFalse(profile.contains("(deny network*)"));
    }

    @Test
    void notAvailable_failsOpenToPlainBashWithWarning() {
        CommandSandbox.Wrapped w = CommandSandbox.buildCommand(
                false, false, "/ws", "/tmpd", "/ws/.git", "echo hi");

        assertFalse(w.sandboxed());
        assertEquals(List.of("bash", "-c", "echo hi"), w.command());
        assertNotNull(w.warning());
        assertTrue(w.warning().contains("沙箱"), "fail-open 应带警告: " + w.warning());
    }

    @Test
    void constructorRemembersNetworkFlag() {
        assertTrue(new CommandSandbox(true).networkAllowed());
        assertFalse(new CommandSandbox(false).networkAllowed());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=CommandSandboxTest`
Expected: FAIL —— `cannot find symbol: CommandSandbox`。

- [ ] **Step 3: 实现 `CommandSandbox`**

`CommandSandbox.java`:

```java
package com.lyhn.wraith.policy.sandbox;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * 把 agent 触发的 shell 命令包进 macOS Seatbelt(sandbox-exec)。
 *
 * <p>仅 {@code wraith app-server} 注入;交互式 CLI 不使用(ToolRegistry 的 sandbox 为 null)。
 * 非 macOS 或 {@code sandbox-exec} 不可用时 fail-open:裸跑并带回一条 warning。
 */
public final class CommandSandbox {

    private static final Path SANDBOX_EXEC = Path.of("/usr/bin/sandbox-exec");

    private final boolean networkAllowed;

    public CommandSandbox(boolean networkAllowed) {
        this.networkAllowed = networkAllowed;
    }

    public boolean networkAllowed() {
        return networkAllowed;
    }

    /** 命令构造结果。sandboxed=false 时 warning 非空(fail-open 原因)。 */
    public record Wrapped(List<String> command, boolean sandboxed, String warning) {}

    /** 当前平台是否支持 Seatbelt(macOS 且 sandbox-exec 可执行)。 */
    public static boolean available() {
        String os = System.getProperty("os.name", "").toLowerCase();
        return os.contains("mac") && Files.isExecutable(SANDBOX_EXEC);
    }

    /**
     * 包裹一条命令。workspaceRoot 为当前 project 根,调用时实时传入以避免陈旧根。
     */
    public Wrapped wrap(String workspaceRoot, String command) {
        String tmp = System.getenv("TMPDIR");
        if (tmp == null || tmp.isBlank()) {
            tmp = "/tmp";
        }
        String root = realPath(workspaceRoot);
        String tmpDir = realPath(tmp);
        String gitDir = root.endsWith("/") ? root + ".git" : root + "/.git";
        return buildCommand(available(), networkAllowed, root, tmpDir, gitDir, command);
    }

    /** 纯函数,便于两分支单测;不读环境、不探测平台。 */
    static Wrapped buildCommand(boolean sandboxAvailable, boolean networkAllowed,
                                String root, String tmpDir, String gitDir, String command) {
        if (!sandboxAvailable) {
            return new Wrapped(
                    List.of("bash", "-c", command),
                    false,
                    "当前平台不支持 Seatbelt 沙箱,命令未沙箱化裸跑(仅 CommandGuard 黑名单生效)");
        }
        List<String> cmd = new ArrayList<>();
        cmd.add(SANDBOX_EXEC.toString());
        cmd.addAll(SeatbeltProfile.params(root, tmpDir, gitDir));
        cmd.add("-p");
        cmd.add(SeatbeltProfile.workspaceWrite(networkAllowed));
        cmd.add("bash");
        cmd.add("-c");
        cmd.add(command);
        return new Wrapped(List.copyOf(cmd), true, null);
    }

    private static String realPath(String p) {
        Path path = Path.of(p);
        try {
            if (Files.exists(path)) {
                return path.toRealPath().toString();
            }
        } catch (Exception ignored) {
            // 落到 normalize 分支
        }
        return path.toAbsolutePath().normalize().toString();
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=CommandSandboxTest`
Expected: `Tests run: 4, Failures: 0, Errors: 0`,输出无 warning。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/policy/sandbox/CommandSandbox.java \
        src/test/java/com/lyhn/wraith/policy/sandbox/CommandSandboxTest.java
git commit -m "feat(sandbox): CommandSandbox 包裹命令 + 平台探测 + fail-open"
```

---

## Task 4: 接线 `CommandSandbox` 进 `ToolRegistry.executeCommand`

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`(imports 段 ~1-56;字段段 ~84-95;方法插入;`executeCommand` 的 1362 行)
- Test: `src/test/java/com/lyhn/wraith/tool/ToolRegistrySandboxWiringTest.java`

**Interfaces:**
- Consumes: `CommandSandbox`(`com.lyhn.wraith.policy.sandbox`)、`CommandSandbox.wrap(String,String)`、`CommandSandbox.Wrapped`。
- Produces:
  - `void ToolRegistry.setCommandSandbox(CommandSandbox)`
  - `List<String> ToolRegistry.resolveProcessCommand(String normalized)`(包级,可测)—— sandbox 为 null 时返回 `["bash","-c",normalized]`,否则返回沙箱化命令行。

- [ ] **Step 1: 写失败测试**

`ToolRegistrySandboxWiringTest.java`:

```java
package com.lyhn.wraith.tool;

import com.lyhn.wraith.policy.sandbox.CommandSandbox;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class ToolRegistrySandboxWiringTest {

    @Test
    void noSandbox_runsPlainBash() {
        ToolRegistry reg = new ToolRegistry();
        assertEquals(List.of("bash", "-c", "echo hi"), reg.resolveProcessCommand("echo hi"));
    }

    @Test
    void withSandbox_wrapsWithSandboxExec() {
        assumeTrue(CommandSandbox.available(), "仅 macOS + sandbox-exec 环境验证包裹路径");
        ToolRegistry reg = new ToolRegistry();
        reg.setCommandSandbox(new CommandSandbox(false));
        List<String> cmd = reg.resolveProcessCommand("echo hi");
        assertEquals("/usr/bin/sandbox-exec", cmd.get(0));
        assertEquals(List.of("bash", "-c", "echo hi"), cmd.subList(cmd.size() - 3, cmd.size()));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=ToolRegistrySandboxWiringTest`
Expected: FAIL —— `cannot find symbol: method resolveProcessCommand` / `setCommandSandbox`。

- [ ] **Step 3: 实现接线**

**(a) 加 imports**(`ToolRegistry.java`,与既有 import 同段):

```java
import com.lyhn.wraith.policy.sandbox.CommandSandbox;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
```

**(b) 加 logger + 字段**(类体内,`private final Map<String, Tool> tools ...` 附近):

```java
private static final Logger log = LoggerFactory.getLogger(ToolRegistry.class);
// null = 不沙箱(交互式 CLI 默认行为,与历史一致);仅 app-server 注入
private CommandSandbox commandSandbox;
private volatile boolean sandboxWarningLogged = false;
```

**(c) 加 setter + resolveProcessCommand**(放在 `executeCommand` 之前,类体内):

```java
public void setCommandSandbox(CommandSandbox commandSandbox) {
    this.commandSandbox = commandSandbox;
}

/** 决定 execute_command 子进程命令行:注入了 sandbox 则包裹,否则裸 bash -c。 */
List<String> resolveProcessCommand(String normalized) {
    CommandSandbox sandbox = this.commandSandbox;
    if (sandbox == null) {
        return List.of("bash", "-c", normalized);
    }
    CommandSandbox.Wrapped wrapped = sandbox.wrap(projectPath, normalized);
    if (!wrapped.sandboxed() && !sandboxWarningLogged) {
        log.warn("[sandbox] {}", wrapped.warning());
        sandboxWarningLogged = true;
    }
    return wrapped.command();
}
```

**(d) 改 `executeCommand` 的 ProcessBuilder 构造(1362 行):**

```java
// 原: ProcessBuilder pb = new ProcessBuilder("bash", "-c", normalized);
ProcessBuilder pb = new ProcessBuilder(resolveProcessCommand(normalized));
pb.directory(new File(projectPath));
pb.redirectErrorStream(true);
```

`CommandGuard.check`(1347)保持在前不动 —— 沙箱是叠加防线。

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=ToolRegistrySandboxWiringTest`
Expected: `Tests run: 2, Failures: 0, Errors: 0`(非 mac 上第二条被 `assumeTrue` 跳过,不计失败)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/tool/ToolRegistry.java \
        src/test/java/com/lyhn/wraith/tool/ToolRegistrySandboxWiringTest.java
git commit -m "feat(sandbox): ToolRegistry.executeCommand 走可选 CommandSandbox"
```

---

## Task 5: 真实 `sandbox-exec` 集成测试(安全证明,`assumeTrue(mac)`)

**背景:** SBPL 语义(后匹配优先、`network*` 通配、设备节点)靠字符串单测无法证明。本任务用**真实** `sandbox-exec` 跑命令,断言写/读/网络边界真实生效——这是 P2 的安全皇冠。开发机是 macOS,会真跑。

**Files:**
- Test: `src/test/java/com/lyhn/wraith/policy/sandbox/SeatbeltSandboxTest.java`

**Interfaces:**
- Consumes: `CommandSandbox.available()`、`CommandSandbox.wrap(String,String)`、`CommandSandbox.Wrapped.command()`。
- Produces: 无。

**测试根设计(关键):** workspace 建在 `/tmp`(=`/private/tmp`),**不在** `$TMPDIR`(macOS 下 = `/var/folders/...`),这样「写 workspace」与「写 $TMPDIR」是两个独立子树,能各自证明。「越界」目标是 workspace 的 sibling(同在 `/tmp` 下但不在 workspace、不在 $TMPDIR)。网络用本地 `ServerSocket` 做确定性对照(沙箱内连接失败 / 裸跑连接成功)。

- [ ] **Step 1: 写测试**

`SeatbeltSandboxTest.java`:

```java
package com.lyhn.wraith.policy.sandbox;

import org.junit.jupiter.api.Test;

import java.io.File;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/** 真实 sandbox-exec 边界证明。仅 macOS。 */
class SeatbeltSandboxTest {

    private final CommandSandbox sandbox = new CommandSandbox(false);

    /** 在 cwd 下跑一条命令(可为沙箱化或裸命令),返回退出码;-1 表示异常/超时。 */
    private int run(List<String> command, Path cwd) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(cwd.toFile());
        pb.redirectErrorStream(true);
        Process p = pb.start();
        // 排空输出,避免管道阻塞
        p.getInputStream().readAllBytes();
        if (!p.waitFor(20, TimeUnit.SECONDS)) {
            p.destroyForcibly();
            return -1;
        }
        return p.exitValue();
    }

    private int sandboxed(String shellCmd, Path ws) throws Exception {
        return run(sandbox.wrap(ws.toString(), shellCmd).command(), ws);
    }

    @Test
    void confinesWritesToWorkspaceAndTmpButNotOutsideNorGit() throws Exception {
        assumeTrue(CommandSandbox.available(), "仅 macOS + sandbox-exec");

        // workspace 放在 /tmp,刻意避开 $TMPDIR(/var/folders)
        Path base = Files.createTempDirectory(Path.of("/tmp"), "wraith-sbx-").toRealPath();
        try {
            Path ws = Files.createDirectory(base.resolve("ws"));
            Path outside = Files.createDirectory(base.resolve("outside"));
            Files.createDirectory(ws.resolve(".git"));

            // 1) workspace 内写:允许
            Path in = ws.resolve("in.txt");
            assertEquals(0, sandboxed("printf x > '" + in + "'", ws), "workspace 内写应成功");
            assertTrue(Files.exists(in));

            // 2) workspace 外写:拒绝(文件不应出现)
            Path out = outside.resolve("out.txt");
            assertNotEquals(0, sandboxed("printf x > '" + out + "'", ws), "workspace 外写应被拒");
            assertFalse(Files.exists(out), "越界文件不应被创建");

            // 3) .git 只读:拒绝
            Path gitProbe = ws.resolve(".git/probe");
            assertNotEquals(0, sandboxed("printf x > '" + gitProbe + "'", ws), ".git 写应被拒");
            assertFalse(Files.exists(gitProbe));

            // 4) $TMPDIR 内写:允许
            assertEquals(0, sandboxed(
                    "printf x > \"$TMPDIR/wraith_sbx_probe_$$\"", ws), "$TMPDIR 内写应成功");

            // 5) 宽松读:读 workspace 外文件应成功
            assertEquals(0, sandboxed("cat /etc/hosts > /dev/null", ws), "宽松读应允许读盘外");
        } finally {
            deleteRecursively(base);
        }
    }

    @Test
    void deniesNetworkWhileControlConnects() throws Exception {
        assumeTrue(CommandSandbox.available(), "仅 macOS + sandbox-exec");

        Path base = Files.createTempDirectory(Path.of("/tmp"), "wraith-sbx-net-").toRealPath();
        try {
            Path ws = Files.createDirectory(base.resolve("ws"));
            // 本地监听:内核会把连接放进 backlog,无需 accept 即可完成握手
            try (ServerSocket ss = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
                int port = ss.getLocalPort();
                String probe = "exec 3<>/dev/tcp/127.0.0.1/" + port;

                // 沙箱内:网络被拒 → 非 0
                assertNotEquals(0, sandboxed(probe, ws), "沙箱内网络连接应被拒");

                // 对照:裸 bash 同一探针 → 成功(证明目标可达,拦截来自沙箱而非环境)
                assertEquals(0, run(List.of("bash", "-c", probe), ws),
                        "裸跑同一探针应连通,反证拦截来自沙箱");
            }
        } finally {
            deleteRecursively(base);
        }
    }

    private static void deleteRecursively(Path root) throws Exception {
        if (!Files.exists(root)) return;
        try (var walk = Files.walk(root)) {
            walk.sorted((a, b) -> b.getNameCount() - a.getNameCount())
                .forEach(p -> { try { Files.deleteIfExists(p); } catch (Exception ignored) {} });
        }
    }
}
```

- [ ] **Step 2: 跑测试(mac 上真跑)**

Run: `mvn test -DskipTests=false -Dtest=SeatbeltSandboxTest`
Expected(macOS): `Tests run: 2, Failures: 0, Errors: 0`。
若 profile 有 SBPL 语法错误,`sandbox-exec` 会对**所有**命令非 0 退出 → 第 1 条的「workspace 内写应成功」会红,直接暴露 profile 问题。
若 `sandbox-exec` 打印 deprecation 提示污染输出:本测试只看退出码,不受影响;但**记录**该现象供 Task 7 核实工具输出。

- [ ] **Step 3: 无需实现**

纯验证任务。全绿即提交;任一边界断言红 → profile 有误,回到 Task 2 修正 `SeatbeltProfile`,STOP 并上报控制者(这是安全边界,不能猜)。

- [ ] **Step 4: 提交**

```bash
git add src/test/java/com/lyhn/wraith/policy/sandbox/SeatbeltSandboxTest.java
git commit -m "test(sandbox): 真实 sandbox-exec 证明写/读/网络边界"
```

---

## Task 6: `app-server` 启动注入沙箱 + 全局网络开关

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(新增包级静态 `buildAppServerSandbox()`;`startAppServer` 在 1130 后注入)
- Test: `src/test/java/com/lyhn/wraith/cli/MainAppServerSandboxTest.java`

**Interfaces:**
- Consumes: `CommandSandbox`;`ToolRegistry.setCommandSandbox(CommandSandbox)`(Task 4)。
- Produces: `static CommandSandbox Main.buildAppServerSandbox()`(包级)—— 读 `-Dwraith.sandbox.network`,`on`(忽略大小写)→ 放行网络,否则默认断网。

- [ ] **Step 1: 写失败测试**

`MainAppServerSandboxTest.java`:

```java
package com.lyhn.wraith.cli;

import com.lyhn.wraith.policy.sandbox.CommandSandbox;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class MainAppServerSandboxTest {

    private static final String KEY = "wraith.sandbox.network";

    @Test
    void defaultsToNetworkOff() {
        String prev = System.getProperty(KEY);
        System.clearProperty(KEY);
        try {
            CommandSandbox s = Main.buildAppServerSandbox();
            assertFalse(s.networkAllowed(), "默认断网");
        } finally {
            restore(prev);
        }
    }

    @Test
    void propertyOnEnablesNetwork() {
        String prev = System.getProperty(KEY);
        System.setProperty(KEY, "on");
        try {
            assertTrue(Main.buildAppServerSandbox().networkAllowed(), "-Dwraith.sandbox.network=on 放行");
        } finally {
            restore(prev);
        }
    }

    @Test
    void propertyOtherValueStaysOff() {
        String prev = System.getProperty(KEY);
        System.setProperty(KEY, "yes");
        try {
            assertFalse(Main.buildAppServerSandbox().networkAllowed(), "非 on 值一律断网");
        } finally {
            restore(prev);
        }
    }

    private static void restore(String prev) {
        if (prev == null) System.clearProperty(KEY);
        else System.setProperty(KEY, prev);
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=MainAppServerSandboxTest`
Expected: FAIL —— `cannot find symbol: method buildAppServerSandbox`。

- [ ] **Step 3: 实现**

**(a) 加包级静态方法**(`Main.java`,`startAppServer` 附近):

```java
/** app-server 沙箱工厂:默认断网,-Dwraith.sandbox.network=on 全局放行网络。 */
static com.lyhn.wraith.policy.sandbox.CommandSandbox buildAppServerSandbox() {
    boolean networkAllowed =
            "on".equalsIgnoreCase(System.getProperty("wraith.sandbox.network", "off"));
    return new com.lyhn.wraith.policy.sandbox.CommandSandbox(networkAllowed);
}
```

**(b) 在 `startAppServer` 的 SessionRunner 工厂里注入**(`Main.java:1130` `setWriteFileObserver` 之后、`new Agent` 之前插入一行):

```java
                registry.setWriteFileObserver((path, ba) -> renderer.appendDiff(path, ba[0], ba[1]));
                registry.setCommandSandbox(buildAppServerSandbox()); // ← 新增:命令走 Seatbelt 沙箱
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=MainAppServerSandboxTest`
Expected: `Tests run: 3, Failures: 0, Errors: 0`。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/cli/MainAppServerSandboxTest.java
git commit -m "feat(sandbox): app-server 启动注入 CommandSandbox + 全局网络开关"
```

---

## Task 7: 经真实 `execute_command` 工具的端到端限定 + 手动验收

**背景:** Task 5 证明沙箱原语;本任务证明**生产路径**(`executeToolOutput("execute_command",…)` → `CommandGuard` → `resolveProcessCommand` → `ProcessBuilder` → `readProcessOutput` → 截断 → 审计)在注入沙箱后仍正确、且确实限定。这里也核实 Task 5 记的「deprecation 输出污染」是否影响工具返回文本。

**Files:**
- Test: `src/test/java/com/lyhn/wraith/tool/ExecuteCommandSandboxIntegrationTest.java`

**Interfaces:**
- Consumes: `ToolRegistry`、`ToolRegistry.setProjectPath`、`ToolRegistry.setCommandSandbox`、`ToolRegistry.executeToolOutput`、`CommandSandbox.available()`。
- Produces: 无。

- [ ] **Step 1: 写测试**

`ExecuteCommandSandboxIntegrationTest.java`:

```java
package com.lyhn.wraith.tool;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.lyhn.wraith.policy.sandbox.CommandSandbox;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/** 经 execute_command 工具的端到端沙箱限定。仅 macOS。 */
class ExecuteCommandSandboxIntegrationTest {

    private static final ObjectMapper M = new ObjectMapper();

    private static String cmdArgs(String command) {
        ObjectNode n = M.createObjectNode();
        n.put("command", command);
        return n.toString();
    }

    @Test
    void executeCommandConfinesWritesThroughSandbox() throws Exception {
        assumeTrue(CommandSandbox.available(), "仅 macOS + sandbox-exec");

        Path base = Files.createTempDirectory(Path.of("/tmp"), "wraith-e2e-").toRealPath();
        try {
            Path ws = Files.createDirectory(base.resolve("ws"));
            Path outside = Files.createDirectory(base.resolve("outside"));

            ToolRegistry reg = new ToolRegistry();
            reg.setProjectPath(ws.toString());
            reg.setCommandSandbox(new CommandSandbox(false));

            // 1) workspace 内写:成功,文件落地
            Path in = ws.resolve("tool_in.txt");
            String okOut = reg.executeToolOutput(
                    "execute_command", cmdArgs("printf x > '" + in + "'")).text();
            assertTrue(Files.exists(in), "workspace 内写应落地: " + okOut);
            assertTrue(okOut.contains("exit code: 0"), "应报告 exit 0: " + okOut);

            // 2) workspace 外写:被沙箱拒,文件不落地
            Path out = outside.resolve("tool_out.txt");
            String denyOut = reg.executeToolOutput(
                    "execute_command", cmdArgs("printf x > '" + out + "'")).text();
            assertFalse(Files.exists(out), "越界文件不应被创建: " + denyOut);
            assertFalse(denyOut.contains("exit code: 0"), "越界写不应报告 exit 0: " + denyOut);
        } finally {
            deleteRecursively(base);
        }
    }

    private static void deleteRecursively(Path root) throws Exception {
        if (!Files.exists(root)) return;
        try (var walk = Files.walk(root)) {
            walk.sorted((a, b) -> b.getNameCount() - a.getNameCount())
                .forEach(p -> { try { Files.deleteIfExists(p); } catch (Exception ignored) {} });
        }
    }
}
```

- [ ] **Step 2: 跑测试(mac 上真跑)**

Run: `mvn test -DskipTests=false -Dtest=ExecuteCommandSandboxIntegrationTest`
Expected(macOS): `Tests run: 1, Failures: 0, Errors: 0`。
核实 `denyOut` / `okOut` 里没有 `sandbox-exec` deprecation 噪声混入(若有,在报告中记录,交控制者决定是否过滤)。

- [ ] **Step 3: 无需实现**

生产路径已由前置任务构成。全绿即提交。

- [ ] **Step 4: 提交**

```bash
git add src/test/java/com/lyhn/wraith/tool/ExecuteCommandSandboxIntegrationTest.java
git commit -m "test(sandbox): execute_command 端到端沙箱限定"
```

- [ ] **Step 5: 手动验收(记录到报告,非 JUnit)**

在 macOS 上:

1. 全量相关测试:
   ```bash
   mvn test -DskipTests=false \
     -Dtest='SeatbeltProfileTest,CommandSandboxTest,SeatbeltSandboxTest,ToolRegistrySandboxWiringTest,ToolRegistryFileConfinementTest,ExecuteCommandSandboxIntegrationTest,MainAppServerSandboxTest'
   ```
   期望全绿。
2. 重装 jar(`wraith-install` 或等价),`wraith app-server`,喂 `initialize`/`session.start`,提交一轮让模型执行「写 workspace 外文件」的命令(如 `echo hi > /etc/wraith_probe`),观察对应 `tool.result`/命令输出为失败,且 `/etc/wraith_probe` 不存在。
3. 提交一轮写 workspace 内文件,确认成功。
4. 确认 app-server 的 **stdout 仍是纯 JSON-RPC**(sandbox-exec 的任何 stderr 走 `System.err`,不污染 JSON-RPC stdout;命令输出本身是 JSON 内的字符串字段,合法)。
5. (可选)`-Dwraith.sandbox.network=on` 启动,确认联网命令可通(验证全局开关)。

---

## 分期收尾说明

- 本计划完成 = spec §4「沙箱」的 v1 落地:§4.1 命令 Seatbelt(Task 2-7)、§4.2 in-process 路径限定(Task 1 锁定既有 `PathGuard`)、§4.4 仅 macOS(fail-open)。
- **推迟到 P4**:§4.3 逐命令「本次放行网络」的审批 UI 交互(本阶段仅全局开关)。P4 有 UI 后,`approval.respond` 带 network 标志 → 换 `CommandSandbox(networkAllowed=true)` 的 profile 重跑;后端接缝已就位(`CommandSandbox` 已支持 network 分支、profile 已参数化)。
- 下一阶段 **P3(Electron 壳)** 不依赖 P2 的沙箱内部;P2 对 P3 透明(命令照常执行,只是被限定)。

## Self-Review(计划自查)

- **spec 覆盖**:§4.1 命令沙箱→Task 2/3/4/5/7;§4.2 路径限定→Task 1(锁定既有实现);§4.3 网络放行→全局开关(Task 6)+ 逐命令显式推迟 P4;§4.4 平台→fail-open(Task 3,Global Constraints)。§3.5(`X-Wraith-API-Key`)已在 P1 修复,不重复。
- **占位扫描**:无 TODO/TBD;每个改码步骤含完整代码与期望输出。
- **类型一致性**:`Wrapped(command, sandboxed, warning)` 三处一致;`buildCommand` 六参签名在 Task 3 定义、Task 3 测试消费;`resolveProcessCommand`/`setCommandSandbox`/`buildAppServerSandbox`/`networkAllowed()` 跨任务签名一致;profile 的 `WORKSPACE`/`TMPDIR`/`GIT_DIR` 三参在 `SeatbeltProfile.params` 与 `workspaceWrite` 引用一致。
- **测试真实性**:Task 5/7 用真实 `sandbox-exec`(非 mock);Task 2/3/6 为纯函数/属性单测;全程无 Mockito;跨平台分支用 `assumeTrue` 守护。
