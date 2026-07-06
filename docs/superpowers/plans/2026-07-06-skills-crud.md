# 技能增删改查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面「技能」面板内完成技能的新建/编辑/删除,内置技能只读且可「复制为用户技能」,并把 `SKILL.md` 的读写打通到 app-server。

**Architecture:** 新增一个镜像现有 `SkillFrontmatterParser` YAML 子集的序列化器 `SkillFrontmatterWriter`;新增 `SkillStore` 收敛文件写/删(原子写 + 目录安全 name 校验);经 `skills.get/upsert/delete/fork` 四个 JSON-RPC 暴露给桌面;`SessionRunner` 用既有 `skillRegistry` + 新 `SkillStore` 实现;桌面新增纯逻辑 `skillEditor.ts`、编辑器组件 `SkillEditor.tsx`,并扩展 `SkillsPanel.tsx`。

**Tech Stack:** Java 17 / Maven / JUnit5;Electron + React + TypeScript + vitest。

## Global Constraints

- 序列化器**不引入 SnakeYAML**,镜像 `SkillFrontmatterParser` 的极简 YAML 子集;产物必须能被该解析器读回同样字段(round-trip)。
- name 目录安全:仅 `^[A-Za-z0-9_-]+$`;写/删仅限 `~/.wraith/skills`(user)或 `<root>/.wraith/skills`(project);内置(builtin scope)永不被 upsert/delete。
- name 校验单一真源在 `SkillStore.requireSafeName`(抛 `IllegalArgumentException`);RPC dispatch 把 `IllegalArgumentException` 映射为 `-32602`、`UnsupportedOperationException` 映射为 `-32000`(照既有 `skills.setEnabled` 模式)。
- body 仅随 `skills.get` 本机 IPC 回传,不外传、不入日志;本特性不涉密钥。
- 不改三层覆盖、`load_skill` 注入、启停(`skills.list`/`skills.setEnabled`)、frontmatter 解析等既有逻辑。
- 提交 trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- 门禁:Java `mvn -DskipTests=false test` 无新增失败(基线约 4F/38E 为 JDK/Mockito 噪声);桌面 `npm run typecheck` + `npx vitest run` + `npm run build` 全绿。

## File Structure

| 文件 | 职责 |
|---|---|
| `src/main/java/com/lyhn/wraith/skill/SkillFrontmatterWriter.java`(新) | 把字段 + body 序列化为 SKILL.md 文本 |
| `src/main/java/com/lyhn/wraith/skill/SkillStore.java`(新) | 文件写/删 + name/scope 校验 + 原子写 |
| `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` | SessionRunner 新 default 方法 + 4 个 dispatch case |
| `src/main/java/com/lyhn/wraith/cli/Main.java` | 构 `SkillStore` + 匿名 SessionRunner 实现 4 方法 |
| `src/test/java/com/lyhn/wraith/skill/SkillFrontmatterWriterTest.java`(新) | round-trip 测试 |
| `src/test/java/com/lyhn/wraith/skill/SkillStoreTest.java`(新) | 写/删/校验测试 |
| `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSkillsTest.java` | 加 get/upsert/delete/fork RPC 测试 |
| `desktop/src/shared/types.ts` | +`SkillDetail`/`SkillUpsertPayload` |
| `desktop/src/preload/index.ts` | WraithApi +4 方法 + 暴露对象 +4 实现 |
| `desktop/src/main/index.ts` | +4 IPC handler |
| `desktop/src/renderer/lib/skillEditor.ts`(新) | tags 解析 / name 校验 / 表单→载荷 |
| `desktop/test/skillEditor.test.ts`(新) | 纯函数 vitest |
| `desktop/src/renderer/components/SkillEditor.tsx`(新) | 编辑器表单组件 |
| `desktop/src/renderer/components/SkillsPanel.tsx` | ＋新建/编辑/删除/复制 + 列表⇄编辑器 |

---

### Task 1: SkillFrontmatterWriter(序列化器)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/skill/SkillFrontmatterWriter.java`
- Test: `src/test/java/com/lyhn/wraith/skill/SkillFrontmatterWriterTest.java`

**Interfaces:**
- Consumes: `SkillFrontmatterParser.parse(String)`(已存在,返回 `ParseResult(Map<String,Object> frontmatter, String body, List<String> warnings)`)。
- Produces: `SkillFrontmatterWriter.serialize(String name, String description, String version, String author, List<String> tags, String body) -> String`。

**背景**:解析器块标量 `|` 分支对内容做 `replaceAll("\\s+", " ").trim()`(折叠空白);数组用 `[a, b]`;`findKeyColonIndex` 跳过引号内冒号;body 取闭合 `---\n` 之后并 strip 一个前导 `\n`。序列化据此设计:description 用块标量单行、version/author 用引号、tags 用行内数组、body 前置 `---\n\n`。

- [ ] **Step 1: 写失败测试**

`src/test/java/com/lyhn/wraith/skill/SkillFrontmatterWriterTest.java`:

```java
package com.lyhn.wraith.skill;

import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class SkillFrontmatterWriterTest {

    private SkillFrontmatterParser.ParseResult roundTrip(
            String name, String desc, String version, String author, List<String> tags, String body) {
        String md = SkillFrontmatterWriter.serialize(name, desc, version, author, tags, body);
        return SkillFrontmatterParser.parse(md);
    }

    @Test void roundTripsAllFields() {
        var r = roundTrip("web-access", "联网访问手册", "1.0.0", "Wraith CLI",
                List.of("web", "browser"), "# 正文\n步骤一\n");
        Map<String, Object> fm = r.frontmatter();
        assertEquals("web-access", fm.get("name"));
        assertEquals("联网访问手册", fm.get("description"));
        assertEquals("1.0.0", fm.get("version"));
        assertEquals("Wraith CLI", fm.get("author"));
        assertEquals(List.of("web", "browser"), fm.get("tags"));
        assertEquals("# 正文\n步骤一\n", r.body());
        assertTrue(r.warnings().isEmpty());
    }

    @Test void descriptionWithColonAndBracketsRoundTrips() {
        var r = roundTrip("x", "用法: 见 [文档] 和 a:b", null, null, List.of(), "body");
        assertEquals("用法: 见 [文档] 和 a:b", r.frontmatter().get("description"));
    }

    @Test void authorWithSpacesAndColonRoundTrips() {
        var r = roundTrip("x", "d", "2", "Team: Wraith", List.of(), "b");
        assertEquals("Team: Wraith", r.frontmatter().get("author"));
        assertEquals("2", r.frontmatter().get("version"));
    }

    @Test void emptyOptionalFieldsAreOmitted() {
        String md = SkillFrontmatterWriter.serialize("x", "d", null, "", List.of(), "b");
        assertFalse(md.contains("version:"));
        assertFalse(md.contains("author:"));
        assertFalse(md.contains("tags:"));
        var r = SkillFrontmatterParser.parse(md);
        assertNull(r.frontmatter().get("version"));
        assertNull(r.frontmatter().get("author"));
    }

    @Test void bodyPreservedExactly() {
        var r = roundTrip("x", "d", null, null, List.of(), "line1\nline2\n");
        assertEquals("line1\nline2\n", r.body());
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=SkillFrontmatterWriterTest test`
Expected: 编译失败(`SkillFrontmatterWriter` 不存在)。

- [ ] **Step 3: 实现序列化器**

`src/main/java/com/lyhn/wraith/skill/SkillFrontmatterWriter.java`:

```java
package com.lyhn.wraith.skill;

import java.util.List;

/**
 * SKILL.md 序列化(镜像 SkillFrontmatterParser 的极简 YAML 子集,不引入 SnakeYAML)。
 *
 * 产物保证能被 SkillFrontmatterParser.parse 读回同样字段:
 * - name    : inline(name 已过目录安全校验,无冒号/引号/特殊字符)
 * - description: 块标量 |,折成单行写在一条 2 空格缩进行上(解析器会折叠空白,round-trip 稳定;
 *                规避前导 [ / { / " / | 与冒号歧义)
 * - version/author: 引号包裹(允许含点/空格/冒号;findKeyColonIndex 跳过引号内冒号)
 * - tags    : 行内数组 [a, b];空则省略字段
 * - body    : 闭合 ---\n 后空一行再原样输出
 *
 * 已知不支持(与解析器一致):字段值含英文双引号、tag 含逗号、description 保留换行。
 */
public final class SkillFrontmatterWriter {

    private SkillFrontmatterWriter() {
    }

    public static String serialize(String name, String description, String version,
                                   String author, List<String> tags, String body) {
        StringBuilder sb = new StringBuilder();
        sb.append("---\n");
        sb.append("name: ").append(name).append('\n');
        String descOneLine = description == null ? "" : description.replaceAll("\\s+", " ").trim();
        sb.append("description: |\n");
        sb.append("  ").append(descOneLine).append('\n');
        if (version != null && !version.isBlank()) {
            sb.append("version: \"").append(version.trim()).append("\"\n");
        }
        if (author != null && !author.isBlank()) {
            sb.append("author: \"").append(author.trim()).append("\"\n");
        }
        List<String> cleanTags = tags == null ? List.of()
                : tags.stream().map(String::trim).filter(t -> !t.isEmpty()).toList();
        if (!cleanTags.isEmpty()) {
            sb.append("tags: [").append(String.join(", ", cleanTags)).append("]\n");
        }
        sb.append("---\n\n");
        sb.append(body == null ? "" : body);
        return sb.toString();
    }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `mvn -q -DskipTests=false -Dtest=SkillFrontmatterWriterTest test`
Expected: PASS(5 个测试全绿)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/skill/SkillFrontmatterWriter.java src/test/java/com/lyhn/wraith/skill/SkillFrontmatterWriterTest.java
git commit -m "feat(skill): SKILL.md 序列化器(镜像解析器 YAML 子集,round-trip)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 2: SkillStore(文件写/删 + 校验)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/skill/SkillStore.java`
- Test: `src/test/java/com/lyhn/wraith/skill/SkillStoreTest.java`

**Interfaces:**
- Consumes: `SkillFrontmatterWriter.serialize(...)`(Task 1);`SkillFrontmatterParser.parse(...)`(测试断言用)。
- Produces:
  - `new SkillStore(Path userSkillsDir, Path projectSkillsDir)`
  - `void upsert(String scope, String name, String description, String version, String author, List<String> tags, String body) throws IOException`
  - `void delete(String scope, String name) throws IOException`
  - 非法 name/scope → `IllegalArgumentException`。

- [ ] **Step 1: 写失败测试**

`src/test/java/com/lyhn/wraith/skill/SkillStoreTest.java`:

```java
package com.lyhn.wraith.skill;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class SkillStoreTest {

    @Test void upsertWritesParseableSkill(@TempDir Path tmp) throws Exception {
        Path user = tmp.resolve("user"), project = tmp.resolve("project");
        SkillStore store = new SkillStore(user, project);
        store.upsert("user", "my-skill", "我的技能", "1.0", "me", List.of("a", "b"), "正文");
        Path md = user.resolve("my-skill").resolve("SKILL.md");
        assertTrue(Files.exists(md));
        var r = SkillFrontmatterParser.parse(Files.readString(md));
        assertEquals("my-skill", r.frontmatter().get("name"));
        assertEquals("我的技能", r.frontmatter().get("description"));
        assertEquals(List.of("a", "b"), r.frontmatter().get("tags"));
        assertEquals("正文", r.body());
    }

    @Test void upsertOverwritesSameName(@TempDir Path tmp) throws Exception {
        SkillStore store = new SkillStore(tmp.resolve("user"), tmp.resolve("project"));
        store.upsert("user", "s", "old", null, null, List.of(), "old body");
        store.upsert("user", "s", "new", null, null, List.of(), "new body");
        var r = SkillFrontmatterParser.parse(
                Files.readString(tmp.resolve("user").resolve("s").resolve("SKILL.md")));
        assertEquals("new", r.frontmatter().get("description"));
        assertEquals("new body", r.body());
    }

    @Test void deleteRemovesSkillDirAndIsIdempotent(@TempDir Path tmp) throws Exception {
        SkillStore store = new SkillStore(tmp.resolve("user"), tmp.resolve("project"));
        store.upsert("user", "gone", "d", null, null, List.of(), "b");
        Path dir = tmp.resolve("user").resolve("gone");
        assertTrue(Files.exists(dir));
        store.delete("user", "gone");
        assertFalse(Files.exists(dir));
        store.delete("user", "gone"); // 幂等,不抛
    }

    @Test void rejectsUnsafeNames(@TempDir Path tmp) {
        SkillStore store = new SkillStore(tmp.resolve("user"), tmp.resolve("project"));
        for (String bad : List.of("..", "../x", "a/b", "", ".", "a b", "a.b")) {
            assertThrows(IllegalArgumentException.class,
                    () -> store.upsert("user", bad, "d", null, null, List.of(), "b"),
                    "应拒绝非法 name: " + bad);
        }
    }

    @Test void rejectsNonUserProjectScope(@TempDir Path tmp) {
        SkillStore store = new SkillStore(tmp.resolve("user"), tmp.resolve("project"));
        assertThrows(IllegalArgumentException.class,
                () -> store.upsert("builtin", "x", "d", null, null, List.of(), "b"));
        assertThrows(IllegalArgumentException.class,
                () -> store.delete("bogus", "x"));
    }

    @Test void projectScopeWritesToProjectDir(@TempDir Path tmp) throws Exception {
        SkillStore store = new SkillStore(tmp.resolve("user"), tmp.resolve("project"));
        store.upsert("project", "p", "d", null, null, List.of(), "b");
        assertTrue(Files.exists(tmp.resolve("project").resolve("p").resolve("SKILL.md")));
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -q -DskipTests=false -Dtest=SkillStoreTest test`
Expected: 编译失败(`SkillStore` 不存在)。

- [ ] **Step 3: 实现 SkillStore**

`src/main/java/com/lyhn/wraith/skill/SkillStore.java`:

```java
package com.lyhn.wraith.skill;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Skill 文件写/删。仅作用于用户层(~/.wraith/skills)与项目层(&lt;root&gt;/.wraith/skills);
 * 内置层只读,不在此列。name 经目录安全校验,杜绝路径穿越。写用同目录 temp + 原子 move。
 */
public final class SkillStore {

    private static final Pattern SAFE_NAME = Pattern.compile("^[A-Za-z0-9_-]+$");

    private final Path userSkillsDir;
    private final Path projectSkillsDir;

    public SkillStore(Path userSkillsDir, Path projectSkillsDir) {
        this.userSkillsDir = userSkillsDir;
        this.projectSkillsDir = projectSkillsDir;
    }

    /** scope: "user" | "project"。建/改一个技能(同名覆盖)。 */
    public void upsert(String scope, String name, String description, String version,
                       String author, List<String> tags, String body) throws IOException {
        Path dir = resolveScopeDir(scope);
        String safe = requireSafeName(name);
        Path skillDir = dir.resolve(safe);
        Files.createDirectories(skillDir);
        String content = SkillFrontmatterWriter.serialize(safe, description, version, author, tags, body);
        Path target = skillDir.resolve("SKILL.md");
        Path tmp = skillDir.resolve("SKILL.md.tmp");
        Files.writeString(tmp, content);
        try {
            Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (java.nio.file.AtomicMoveNotSupportedException e) {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /** 删除 &lt;scopeDir&gt;/&lt;name&gt;/ 整个目录,幂等(不存在即 no-op)。 */
    public void delete(String scope, String name) throws IOException {
        Path dir = resolveScopeDir(scope);
        String safe = requireSafeName(name);
        Path skillDir = dir.resolve(safe);
        if (!Files.exists(skillDir)) {
            return;
        }
        List<Path> paths;
        try (var walk = Files.walk(skillDir)) {
            paths = walk.sorted(Comparator.reverseOrder()).toList();
        }
        for (Path p : paths) {
            Files.deleteIfExists(p);
        }
    }

    private Path resolveScopeDir(String scope) {
        return switch (scope == null ? "" : scope) {
            case "user" -> userSkillsDir;
            case "project" -> projectSkillsDir;
            default -> throw new IllegalArgumentException("非法 scope(仅 user/project): " + scope);
        };
    }

    private static String requireSafeName(String name) {
        if (name == null || !SAFE_NAME.matcher(name).matches()) {
            throw new IllegalArgumentException("非法技能名(仅允许字母/数字/下划线/连字符): " + name);
        }
        return name;
    }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `mvn -q -DskipTests=false -Dtest=SkillStoreTest test`
Expected: PASS(6 个测试全绿)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/skill/SkillStore.java src/test/java/com/lyhn/wraith/skill/SkillStoreTest.java
git commit -m "feat(skill): SkillStore 文件写/删 + 目录安全 name 校验 + 原子写

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 3: RPC 面(get/upsert/delete/fork)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(SessionRunner 接口 `~102-108`;dispatch `~270-279`)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(工厂 `~1177` 处构 SkillStore;匿名类 `~1378` 处加 4 方法)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSkillsTest.java`(追加测试)

**Interfaces:**
- Consumes: `SkillStore`(Task 2);既有 `skillRegistry`(`SkillRegistry`,有 `findAnySkill(String)`/`allSkills()`/`stateStore().disabled()`/`reload()`);既有 `skUserDir`/`skProjectDir`(工厂作用域 Path)。
- Produces(SessionRunner 新方法):
  - `Map<String,Object> skillsGet(String name)` → `{name,description,version,author,tags,source,enabled,body}`
  - `Map<String,Object> skillsUpsert(String scope, String name, String description, String version, String author, List<String> tags, String body)` → `{ok:true}`
  - `Map<String,Object> skillsDelete(String scope, String name)` → `{ok:true}`
  - `Map<String,Object> skillsFork(String name)` → `{ok:true, name}`
  - RPC 方法名:`skills.get` / `skills.upsert` / `skills.delete` / `skills.fork`。

- [ ] **Step 1: 写失败测试**

在 `AppServerSkillsTest.java` 顶部 import 补充(若缺):`import org.junit.jupiter.api.io.TempDir;`、`import java.nio.file.Path;`、`import java.util.LinkedHashMap;`(`java.io.*`/`java.util.*` 已 import,但 `java.nio.file.Path` 需显式加)。追加一个 `runWithStore` 帮手 + 测试方法:

```java
    private List<JsonNode> runWithStore(Path tmp, String... requests) throws Exception {
        Path cache = tmp.resolve("cache"), user = tmp.resolve("user"), project = tmp.resolve("project");
        com.lyhn.wraith.skill.SkillStateStore stateStore =
                new com.lyhn.wraith.skill.SkillStateStore(tmp.resolve("skills.json"));
        com.lyhn.wraith.skill.SkillRegistry registry =
                new com.lyhn.wraith.skill.SkillRegistry(cache, user, project, stateStore);
        registry.reload();
        com.lyhn.wraith.skill.SkillStore store = new com.lyhn.wraith.skill.SkillStore(user, project);
        AppServer.SessionRunnerFactory f = (writer, sessionId, ws) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            public Map<String,Object> skillsList() {
                List<Map<String,Object>> list = new ArrayList<>();
                var disabled = registry.stateStore().disabled();
                for (var s : registry.allSkills()) list.add(Map.of(
                    "name", s.name(), "description", s.description(),
                    "version", s.version()==null?"":s.version(), "author", s.author()==null?"":s.author(),
                    "tags", s.tags(), "source", s.displaySource(), "enabled", !disabled.contains(s.name())));
                return Map.of("skills", list);
            }
            public Map<String,Object> skillsGet(String name) {
                var s = registry.findAnySkill(name);
                if (s == null) throw new IllegalArgumentException("技能不存在: " + name);
                Map<String,Object> v = new LinkedHashMap<>();
                v.put("name", s.name()); v.put("description", s.description());
                v.put("version", s.version()==null?"":s.version()); v.put("author", s.author()==null?"":s.author());
                v.put("tags", s.tags()); v.put("source", s.displaySource());
                v.put("enabled", !registry.stateStore().disabled().contains(s.name())); v.put("body", s.body());
                return v;
            }
            public Map<String,Object> skillsUpsert(String scope, String name, String description,
                    String version, String author, List<String> tags, String body) {
                try { store.upsert(scope, name, description, version, author, tags, body); }
                catch (java.io.IOException e) { throw new RuntimeException(e); }
                registry.reload();
                return Map.of("ok", true);
            }
            public Map<String,Object> skillsDelete(String scope, String name) {
                try { store.delete(scope, name); } catch (java.io.IOException e) { throw new RuntimeException(e); }
                registry.reload();
                return Map.of("ok", true);
            }
            public Map<String,Object> skillsFork(String name) {
                var s = registry.findAnySkill(name);
                if (s == null) throw new IllegalArgumentException("技能不存在: " + name);
                try { store.upsert("user", s.name(), s.description(), s.version(), s.author(), s.tags(), s.body()); }
                catch (java.io.IOException e) { throw new RuntimeException(e); }
                registry.reload();
                return Map.of("ok", true, "name", s.name());
            }
        };
        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        int id = 2;
        for (String r : requests) lines.add(r.replace("__ID__", String.valueOf(id++)));
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)), out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n")) if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }

    @Test void upsertThenListShowsUserSkill(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"scope\":\"user\",\"name\":\"mine\",\"description\":\"D\",\"tags\":[\"t1\"],\"body\":\"B\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.list\",\"params\":{}}");
        assertTrue(byId(r, 2).path("result").path("ok").asBoolean());
        JsonNode skills = byId(r, 3).path("result").path("skills");
        assertEquals(1, skills.size());
        assertEquals("mine", skills.get(0).path("name").asText());
        assertEquals("user", skills.get(0).path("source").asText());
    }

    @Test void getReturnsBody(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"scope\":\"user\",\"name\":\"mine\",\"description\":\"D\",\"body\":\"正文内容\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.get\",\"params\":{\"name\":\"mine\"}}");
        assertEquals("正文内容", byId(r, 3).path("result").path("body").asText());
    }

    @Test void deleteRemovesSkill(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"scope\":\"user\",\"name\":\"mine\",\"description\":\"D\",\"body\":\"B\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.delete\",\"params\":{\"scope\":\"user\",\"name\":\"mine\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.list\",\"params\":{}}");
        assertTrue(byId(r, 3).path("result").path("ok").asBoolean());
        assertEquals(0, byId(r, 4).path("result").path("skills").size());
    }

    @Test void forkCreatesUserCopyOverridingProject(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"scope\":\"project\",\"name\":\"base\",\"description\":\"orig\",\"body\":\"X\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.fork\",\"params\":{\"name\":\"base\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.list\",\"params\":{}}");
        assertTrue(byId(r, 3).path("result").path("ok").asBoolean());
        assertEquals("base", byId(r, 3).path("result").path("name").asText());
        JsonNode skills = byId(r, 4).path("result").path("skills");
        assertEquals(1, skills.size());
        assertEquals("user", skills.get(0).path("source").asText());
    }

    @Test void getMissingSkillIsParamError(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.get\",\"params\":{\"name\":\"nope\"}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }

    @Test void upsertUnsafeNameIsParamError(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"scope\":\"user\",\"name\":\"../evil\",\"body\":\"x\"}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }

    @Test void upsertBuiltinScopeIsParamError(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"scope\":\"builtin\",\"name\":\"x\",\"body\":\"y\"}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }

    @Test void upsertMissingScopeIsParamError() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"name\":\"x\",\"body\":\"y\"}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }

    @Test void deleteMissingNameIsParamError() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.delete\",\"params\":{\"scope\":\"user\"}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }
```

> 说明:`upsertMissingScopeIsParamError`/`deleteMissingNameIsParamError` 用既有 `run()`(其测试双未实现新方法),因为缺参守卫在 dispatch 层触发,先于 session 方法调用,永不落到未实现的默认方法。

- [ ] **Step 2: 运行确认失败**

Run: `mvn -q -DskipTests=false -Dtest=AppServerSkillsTest test`
Expected: 编译失败(`skillsGet` 等接口方法与 `skills.get` dispatch 尚不存在)。

- [ ] **Step 3: AppServer 接口 + dispatch**

在 `AppServer.java` 的 SessionRunner 接口内,`skillsSetEnabled` default 方法(`~108` 行 `}` 之后、接口 `}` 之前)追加 4 个 default 方法:

```java
        /** 取单个技能全字段(含 body,供编辑回填)。默认抛出。 */
        default java.util.Map<String, Object> skillsGet(String name) {
            throw new UnsupportedOperationException("skillsGet not implemented");
        }
        /** 建/改一个用户或项目技能。默认抛出。 */
        default java.util.Map<String, Object> skillsUpsert(String scope, String name, String description,
                String version, String author, java.util.List<String> tags, String body) {
            throw new UnsupportedOperationException("skillsUpsert not implemented");
        }
        /** 删除一个用户或项目技能。默认抛出。 */
        default java.util.Map<String, Object> skillsDelete(String scope, String name) {
            throw new UnsupportedOperationException("skillsDelete not implemented");
        }
        /** 复制任意技能为用户技能(内置定制)。默认抛出。 */
        default java.util.Map<String, Object> skillsFork(String name) {
            throw new UnsupportedOperationException("skillsFork not implemented");
        }
```

在 dispatch 的 `case "skills.setEnabled" -> { ... }`(`~270-279`)之后追加 4 个 case:

```java
            case "skills.get" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String name = textParam(p, "name");
                if (name == null || name.isBlank()) { writer.error(msg.id(), -32602, "缺 name"); return true; }
                try { writer.result(msg.id(), session.skillsGet(name)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "skills.upsert" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String scope = textParam(p, "scope");
                String name = textParam(p, "name");
                if (scope == null || scope.isBlank()) { writer.error(msg.id(), -32602, "缺 scope"); return true; }
                if (name == null || name.isBlank()) { writer.error(msg.id(), -32602, "缺 name"); return true; }
                String description = p != null && p.hasNonNull("description") ? p.get("description").asText() : "";
                String version = p != null && p.hasNonNull("version") ? p.get("version").asText() : "";
                String author = p != null && p.hasNonNull("author") ? p.get("author").asText() : "";
                String body = p != null && p.hasNonNull("body") ? p.get("body").asText() : "";
                java.util.List<String> tags = new java.util.ArrayList<>();
                if (p != null && p.has("tags") && p.get("tags").isArray()) {
                    p.get("tags").forEach(n -> { if (n.isTextual()) tags.add(n.asText()); });
                }
                try { writer.result(msg.id(), session.skillsUpsert(scope, name, description, version, author, tags, body)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "skills.delete" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String scope = textParam(p, "scope");
                String name = textParam(p, "name");
                if (scope == null || scope.isBlank()) { writer.error(msg.id(), -32602, "缺 scope"); return true; }
                if (name == null || name.isBlank()) { writer.error(msg.id(), -32602, "缺 name"); return true; }
                try { writer.result(msg.id(), session.skillsDelete(scope, name)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "skills.fork" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String name = textParam(p, "name");
                if (name == null || name.isBlank()) { writer.error(msg.id(), -32602, "缺 name"); return true; }
                try { writer.result(msg.id(), session.skillsFork(name)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
```

- [ ] **Step 4: Main SessionRunner 实现**

在 `Main.java` 工厂内 `skillRegistry.reload();`(`~1177`)之后、`registry.setSkillRegistry(...)` 之前(或紧随其后,只要在匿名类之前)插入:

```java
                com.lyhn.wraith.skill.SkillStore skillStore =
                        new com.lyhn.wraith.skill.SkillStore(skUserDir, skProjectDir);
```

在匿名 SessionRunner 类内 `skillsSetEnabled(...)`(`~1373-1378`)方法之后追加 4 个方法:

```java
                    public java.util.Map<String,Object> skillsGet(String name) {
                        com.lyhn.wraith.skill.Skill s = skillRegistry.findAnySkill(name);
                        if (s == null) throw new IllegalArgumentException("技能不存在: " + name);
                        java.util.Map<String,Object> v = new java.util.LinkedHashMap<>();
                        v.put("name", s.name());
                        v.put("description", s.description());
                        v.put("version", s.version() != null ? s.version() : "");
                        v.put("author", s.author() != null ? s.author() : "");
                        v.put("tags", s.tags());
                        v.put("source", s.displaySource());
                        v.put("enabled", !skillRegistry.stateStore().disabled().contains(s.name()));
                        v.put("body", s.body());
                        return v;
                    }
                    public java.util.Map<String,Object> skillsUpsert(String scope, String name, String description,
                            String version, String author, java.util.List<String> tags, String body) {
                        try { skillStore.upsert(scope, name, description, version, author, tags, body); }
                        catch (java.io.IOException e) { throw new RuntimeException("写入技能失败: " + e.getMessage(), e); }
                        skillRegistry.reload();
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String,Object> skillsDelete(String scope, String name) {
                        try { skillStore.delete(scope, name); }
                        catch (java.io.IOException e) { throw new RuntimeException("删除技能失败: " + e.getMessage(), e); }
                        skillRegistry.reload();
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String,Object> skillsFork(String name) {
                        com.lyhn.wraith.skill.Skill s = skillRegistry.findAnySkill(name);
                        if (s == null) throw new IllegalArgumentException("技能不存在: " + name);
                        try { skillStore.upsert("user", s.name(), s.description(), s.version(), s.author(), s.tags(), s.body()); }
                        catch (java.io.IOException e) { throw new RuntimeException("复制技能失败: " + e.getMessage(), e); }
                        skillRegistry.reload();
                        return java.util.Map.of("ok", true, "name", s.name());
                    }
```

- [ ] **Step 5: 运行确认通过**

Run: `mvn -q -DskipTests=false -Dtest=AppServerSkillsTest test`
Expected: PASS(原 3 + 新 9 = 12 个测试全绿)。

- [ ] **Step 6: 全量 Java 测试(无新增失败)**

Run: `mvn -q -DskipTests=false test 2>&1 | tail -20`
Expected: 仅基线噪声(约 4F/38E 的 JDK/Mockito 相关),skill/appserver 相关全绿。

- [ ] **Step 7: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/main/java/com/lyhn/wraith/cli/Main.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSkillsTest.java
git commit -m "feat(skill): skills.get/upsert/delete/fork RPC + SessionRunner 实现

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 4: 桥 + 类型(TS 侧 RPC 面)

**Files:**
- Modify: `desktop/src/shared/types.ts`(`SkillListResult` 之后,`~255`)
- Modify: `desktop/src/preload/index.ts`(import `~2`;WraithApi 接口 `~69`;暴露对象 `~299`)
- Modify: `desktop/src/main/index.ts`(shared-types import `~28`;IPC handler `~492`)

**Interfaces:**
- Consumes: RPC 方法 `skills.get`/`skills.upsert`/`skills.delete`/`skills.fork`(Task 3)。
- Produces:
  - `SkillDetail extends SkillView { body: string }`
  - `SkillUpsertPayload { scope, name, description, version, author, tags, body }`
  - WraithApi:`getSkill(name)`、`upsertSkill(payload)`、`deleteSkill(scope, name)`、`forkSkill(name)`。

- [ ] **Step 1: 加类型**

`desktop/src/shared/types.ts`,在 `SkillListResult` 接口(`~253-255`)之后插入:

```ts
export interface SkillDetail extends SkillView {
  body: string
}

export interface SkillUpsertPayload {
  scope: 'user' | 'project'
  name: string
  description: string
  version: string
  author: string
  tags: string[]
  body: string
}
```

- [ ] **Step 2: preload — import + 接口 + 实现**

`desktop/src/preload/index.ts` 第 2 行 import,末尾追加 `SkillDetail, SkillUpsertPayload`:

```ts
import type { BackendEvent, SessionMeta, ResumedMessage, ProjectView, McpListResult, McpResourceView, McpUpsertPayload, AutomationTask, AutomationRun, AutomationEvent, ModelListResult, SkillListResult, SkillDetail, SkillUpsertPayload } from '../shared/types'
```

WraithApi 接口内 `setSkillEnabled(...)`(`~69`)之后追加:

```ts
  getSkill(name: string): Promise<SkillDetail>
  upsertSkill(payload: SkillUpsertPayload): Promise<{ ok: boolean }>
  deleteSkill(scope: 'user' | 'project', name: string): Promise<{ ok: boolean }>
  forkSkill(name: string): Promise<{ ok: boolean; name: string }>
```

暴露对象内 `setSkillEnabled(name, enabled) { ... },`(`~298-300`)之后追加:

```ts
  getSkill(name) {
    return ipcRenderer.invoke('wraith:getSkill', name) as Promise<SkillDetail>
  },
  upsertSkill(payload) {
    return ipcRenderer.invoke('wraith:upsertSkill', payload) as Promise<{ ok: boolean }>
  },
  deleteSkill(scope, name) {
    return ipcRenderer.invoke('wraith:deleteSkill', scope, name) as Promise<{ ok: boolean }>
  },
  forkSkill(name) {
    return ipcRenderer.invoke('wraith:forkSkill', name) as Promise<{ ok: boolean; name: string }>
  },
```

- [ ] **Step 3: main — import + handlers**

`desktop/src/main/index.ts`,在 `import type { AutomationTask, AutomationRun, AutomationEvent } from '../shared/types'`(`~28`)之后新增一行:

```ts
import type { SkillUpsertPayload } from '../shared/types'
```

在 `wraith:setSkillEnabled` handler(`~488-491`)之后追加:

```ts
ipcMain.handle('wraith:getSkill', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('skills.get', { name })
})

ipcMain.handle('wraith:upsertSkill', async (_e, payload: SkillUpsertPayload) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('skills.upsert', payload)
})

ipcMain.handle('wraith:deleteSkill', async (_e, scope: 'user' | 'project', name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('skills.delete', { scope, name })
})

ipcMain.handle('wraith:forkSkill', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('skills.fork', { name })
})
```

- [ ] **Step 4: typecheck**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck`
Expected: 0 error。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/shared/types.ts desktop/src/preload/index.ts desktop/src/main/index.ts
git commit -m "feat(desktop): skills get/upsert/delete/fork 桥接 + 类型

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 5: skillEditor 纯逻辑

**Files:**
- Create: `desktop/src/renderer/lib/skillEditor.ts`
- Test: `desktop/test/skillEditor.test.ts`

**Interfaces:**
- Consumes: `SkillUpsertPayload`(Task 4)。
- Produces:
  - `parseTagsInput(raw: string): string[]`
  - `validateSkillName(name: string): string | null`
  - `interface SkillFormState { scope: 'user'|'project'; name; description; version; author; tagsInput; body }`
  - `toUpsertPayload(form: SkillFormState): SkillUpsertPayload`

- [ ] **Step 1: 写失败测试**

`desktop/test/skillEditor.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseTagsInput, validateSkillName, toUpsertPayload } from '../src/renderer/lib/skillEditor'

describe('parseTagsInput', () => {
  it('逗号/换行分隔,trim,去空,去重保序', () => {
    expect(parseTagsInput('a, b\n c ,a,')).toEqual(['a', 'b', 'c'])
  })
  it('空输入返回空数组', () => {
    expect(parseTagsInput('  ')).toEqual([])
  })
})

describe('validateSkillName', () => {
  it('合法名返回 null', () => {
    expect(validateSkillName('web-access_1')).toBeNull()
  })
  it('空名报错', () => {
    expect(validateSkillName('')).not.toBeNull()
    expect(validateSkillName('   ')).not.toBeNull()
  })
  it.each(['../x', 'a/b', 'a b', 'a.b', '中文'])('拒非法名 %s', (bad) => {
    expect(validateSkillName(bad)).not.toBeNull()
  })
})

describe('toUpsertPayload', () => {
  it('表单态映射为载荷,tags 解析,name trim', () => {
    const payload = toUpsertPayload({
      scope: 'user', name: '  mine  ', description: 'd', version: '1',
      author: 'me', tagsInput: 'x, y, x', body: 'B',
    })
    expect(payload).toEqual({
      scope: 'user', name: 'mine', description: 'd', version: '1',
      author: 'me', tags: ['x', 'y'], body: 'B',
    })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run skillEditor`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现纯逻辑**

`desktop/src/renderer/lib/skillEditor.ts`:

```ts
import type { SkillUpsertPayload } from '../../shared/types'

const SAFE_NAME = /^[A-Za-z0-9_-]+$/

/** 逗号或换行分隔 → trim → 去空 → 去重(保序)。 */
export function parseTagsInput(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(/[,\n]/)) {
    const t = part.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** 校验技能名。合法返回 null,否则返回中文错误串(镜像后端 ^[A-Za-z0-9_-]+$)。 */
export function validateSkillName(name: string): string | null {
  if (!name || !name.trim()) return '技能名不能为空'
  if (!SAFE_NAME.test(name)) return '技能名只能包含字母、数字、下划线、连字符'
  return null
}

export interface SkillFormState {
  scope: 'user' | 'project'
  name: string
  description: string
  version: string
  author: string
  tagsInput: string
  body: string
}

/** 表单态 → RPC 载荷(tags 经 parseTagsInput,name trim)。 */
export function toUpsertPayload(form: SkillFormState): SkillUpsertPayload {
  return {
    scope: form.scope,
    name: form.name.trim(),
    description: form.description,
    version: form.version,
    author: form.author,
    tags: parseTagsInput(form.tagsInput),
    body: form.body,
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run skillEditor`
Expected: PASS(全部用例)。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/lib/skillEditor.ts desktop/test/skillEditor.test.ts
git commit -m "feat(desktop): skillEditor 纯逻辑(tags 解析 / name 校验 / 载荷映射)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 6: SkillEditor 组件 + SkillsPanel 扩展

**Files:**
- Create: `desktop/src/renderer/components/SkillEditor.tsx`
- Modify: `desktop/src/renderer/components/SkillsPanel.tsx`(整文件替换)

**Interfaces:**
- Consumes: `window.wraith.getSkill/upsertSkill/deleteSkill/forkSkill`(Task 4);`validateSkillName/toUpsertPayload/SkillFormState`(Task 5);`SkillDetail`/`SkillView`(types);`groupSkillsBySource`(既有)。
- Produces: 桌面「技能」面板内的新建/编辑/删除/复制交互。无单元测试(项目无 RTL);门禁为 typecheck + build。

- [ ] **Step 1: 新建 SkillEditor 组件**

`desktop/src/renderer/components/SkillEditor.tsx`:

```tsx
import { useState } from 'react'
import type { SkillDetail } from '../../shared/types'
import { validateSkillName, toUpsertPayload, type SkillFormState } from '../lib/skillEditor'

interface Props {
  initial?: SkillDetail     // 编辑时预填;新建为 undefined
  lockName: boolean         // 编辑时锁 name
  lockScope: boolean        // 编辑时锁 scope
  onSaved: () => void
  onCancel: () => void
}

function initForm(initial?: SkillDetail): SkillFormState {
  return {
    scope: initial && initial.source !== 'builtin' ? initial.source : 'user',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    version: initial?.version ?? '',
    author: initial?.author ?? '',
    tagsInput: (initial?.tags ?? []).join(', '),
    body: initial?.body ?? '',
  }
}

export default function SkillEditor({ initial, lockName, lockScope, onSaved, onCancel }: Props): JSX.Element {
  const [form, setForm] = useState<SkillFormState>(() => initForm(initial))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof SkillFormState>(k: K, v: SkillFormState[K]): void =>
    setForm(prev => ({ ...prev, [k]: v }))
  const nameError = validateSkillName(form.name)

  const save = async (): Promise<void> => {
    if (nameError) { setError(nameError); return }
    setSaving(true)
    try {
      await window.wraith.upsertSkill(toUpsertPayload(form))
      onSaved()
    } catch (err) { setError((err as Error).message); setSaving(false) }
  }

  const inputCls = 'w-full rounded-lg border border-border bg-surface/40 px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button onClick={onCancel} className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 取消</button>
        <span className="text-sm font-bold text-fg">{lockName ? '编辑技能' : '新建技能'}</span>
        <button data-testid="skill-save" onClick={() => void save()} disabled={saving || !!nameError}
          className="ml-auto rounded-lg border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-50">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && <div data-testid="skill-editor-error" className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-fg-subtle">名称(目录名,字母/数字/_/-)</span>
            <input className={inputCls} value={form.name} disabled={lockName}
              onChange={e => set('name', e.target.value)} placeholder="my-skill" />
            {!lockName && form.name.length > 0 && nameError && <span className="text-[10px] text-danger">{nameError}</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-fg-subtle">来源</span>
            <select className={inputCls} value={form.scope} disabled={lockScope}
              onChange={e => set('scope', e.target.value as 'user' | 'project')}>
              <option value="user">用户(~/.wraith/skills)</option>
              <option value="project">项目(&lt;项目&gt;/.wraith/skills)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-fg-subtle">描述</span>
            <textarea className={inputCls} rows={2} value={form.description}
              onChange={e => set('description', e.target.value)} placeholder="一句话说明这个技能做什么" />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[11px] text-fg-subtle">版本</span>
              <input className={inputCls} value={form.version} onChange={e => set('version', e.target.value)} placeholder="1.0.0" />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[11px] text-fg-subtle">作者</span>
              <input className={inputCls} value={form.author} onChange={e => set('author', e.target.value)} placeholder="me" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-fg-subtle">标签(逗号分隔)</span>
            <input className={inputCls} value={form.tagsInput} onChange={e => set('tagsInput', e.target.value)} placeholder="web, browser" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-fg-subtle">正文(load_skill 注入的内容)</span>
            <textarea className={inputCls + ' font-mono'} rows={14} value={form.body}
              onChange={e => set('body', e.target.value)} placeholder="# 技能正文…" />
          </label>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 整文件替换 SkillsPanel**

`desktop/src/renderer/components/SkillsPanel.tsx`(整文件替换为):

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { SkillView, SkillDetail } from '../../shared/types'
import { groupSkillsBySource } from '../lib/skillsView'
import SkillEditor from './SkillEditor'

const SOURCE_BADGE: Record<SkillView['source'], string> = { builtin: '内置', user: '用户', project: '项目' }
const EMPTY_HINT: Record<SkillView['source'], string> = {
  builtin: '(无内置技能)',
  user: '把 SKILL.md 放到 ~/.wraith/skills/<名>/ 即可被加载',
  project: '把 SKILL.md 放到 <项目>/.wraith/skills/<名>/ 即可被加载',
}

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; detail: SkillDetail }

export default function SkillsPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [skills, setSkills] = useState<SkillView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<Mode>({ kind: 'list' })

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true)
    try { const r = await window.wraith.skillsList(); setSkills(r.skills); setError(null) }
    catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const toggle = useCallback(async (name: string, enabled: boolean): Promise<void> => {
    setSkills(prev => prev.map(s => (s.name === name ? { ...s, enabled } : s)))  // 乐观更新
    try { await window.wraith.setSkillEnabled(name, enabled); void refresh() }
    catch (err) { setError((err as Error).message); void refresh() }
  }, [refresh])

  const openEdit = useCallback(async (name: string): Promise<void> => {
    try { const detail = await window.wraith.getSkill(name); setMode({ kind: 'edit', detail }) }
    catch (err) { setError((err as Error).message) }
  }, [])

  const doDelete = useCallback(async (s: SkillView): Promise<void> => {
    if (s.source === 'builtin') return
    if (!window.confirm(`删除技能「${s.name}」?此操作不可撤销。`)) return
    try { await window.wraith.deleteSkill(s.source, s.name); void refresh() }
    catch (err) { setError((err as Error).message) }
  }, [refresh])

  const doFork = useCallback(async (s: SkillView): Promise<void> => {
    const exists = skills.some(x => x.source === 'user' && x.name === s.name)
    if (exists && !window.confirm(`用户技能「${s.name}」已存在,覆盖?`)) return
    try { await window.wraith.forkSkill(s.name); void refresh() }
    catch (err) { setError((err as Error).message) }
  }, [refresh, skills])

  if (mode.kind === 'new') {
    return <SkillEditor lockName={false} lockScope={false}
      onSaved={() => { setMode({ kind: 'list' }); void refresh() }}
      onCancel={() => setMode({ kind: 'list' })} />
  }
  if (mode.kind === 'edit') {
    return <SkillEditor initial={mode.detail} lockName lockScope
      onSaved={() => { setMode({ kind: 'list' }); void refresh() }}
      onCancel={() => setMode({ kind: 'list' })} />
  }

  const groups = groupSkillsBySource(skills)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="skills-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="text-sm font-bold text-fg">技能</span>
        <span className="text-xs text-fg-subtle">SKILL.md 决策手册 · load_skill 注入</span>
        <div className="ml-auto flex items-center gap-2">
          <button data-testid="skills-new" onClick={() => setMode({ kind: 'new' })}
            className="rounded-lg border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10">＋ 新建技能</button>
          <button data-testid="skills-refresh" onClick={() => void refresh()} disabled={busy}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:border-accent disabled:opacity-60">
            {busy ? '扫描中…' : '⟳ 重新扫描'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && <div data-testid="skills-error" className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        {skills.length === 0 && !busy && !error && (
          <div className="text-xs text-fg-subtle">还没有技能。点「＋ 新建技能」或把 SKILL.md 放到 ~/.wraith/skills/&lt;名&gt;/。</div>
        )}
        {groups.map(g => (
          <section key={g.source} className="mb-4">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-subtle">{g.label}</div>
            <div className="flex flex-col gap-1.5">
              {g.skills.map(s => (
                <div key={s.name} data-testid="skill-row"
                  className={'rounded-lg border border-border p-3 ' + (s.enabled ? '' : 'opacity-50')}>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-fg">{s.name}</span>
                    <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[9px] text-fg-subtle">{SOURCE_BADGE[s.source]}</span>
                    {(s.version || s.author) && (
                      <span className="shrink-0 text-[10px] text-fg-subtle">{[s.version, s.author].filter(Boolean).join(' · ')}</span>
                    )}
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      {s.source === 'builtin' ? (
                        <button data-testid="skill-fork" onClick={() => void doFork(s)}
                          className="rounded-lg border border-border px-2 py-1 text-[11px] text-fg-muted hover:border-accent hover:text-accent">复制为用户技能</button>
                      ) : (
                        <>
                          <button data-testid="skill-edit" onClick={() => void openEdit(s.name)}
                            className="rounded-lg border border-border px-2 py-1 text-[11px] text-fg-muted hover:border-accent hover:text-accent">编辑</button>
                          <button data-testid="skill-delete" onClick={() => void doDelete(s)}
                            className="rounded-lg border border-border px-2 py-1 text-[11px] text-fg-muted hover:border-danger hover:text-danger">删除</button>
                        </>
                      )}
                      <button data-testid="skill-toggle" onClick={() => void toggle(s.name, !s.enabled)}
                        className="rounded-lg border border-border px-2 py-1 text-[11px] text-fg-muted hover:border-accent hover:text-accent">
                        {s.enabled ? '停用' : '启用'}
                      </button>
                    </div>
                  </div>
                  {s.description && <div className="mt-1 line-clamp-3 text-[11px] text-fg-muted">{s.description}</div>}
                  {s.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.tags.map(t => <span key={t} className="rounded bg-surface/60 px-1.5 py-0.5 text-[10px] text-fg-subtle">{t}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
        {skills.length > 0 && (['user', 'project'] as const).map(src =>
          groups.some(g => g.source === src) ? null : (
            <div key={src} className="mb-2 text-[11px] text-fg-subtle">{SOURCE_BADGE[src]}:{EMPTY_HINT[src]}</div>
          ),
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: typecheck**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck`
Expected: 0 error。

- [ ] **Step 4: 全量桌面测试(不回归)**

Run: `npx vitest run`
Expected: 全绿(含 Task 5 的 skillEditor 与既有 skillsView 等)。

- [ ] **Step 5: build**

Run: `npm run build`
Expected: 成功(renderer + preload + main 全部产出)。

- [ ] **Step 6: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/components/SkillEditor.tsx desktop/src/renderer/components/SkillsPanel.tsx
git commit -m "feat(desktop): 技能面板内建/改/删 + 内置复制为用户技能

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

## 落地后手动验证(合并前,重建 jar)

1. `mvn -q -DskipTests package` 重建 → 覆盖机器上的 `~/.wraith/wraith.jar`(与既有部署方式一致)。
2. 全量重启桌面 app(preload 改动不热更)。
3. 眼验清单:
   - 「技能」面板顶部有「＋ 新建技能」→ 填 name=`test-skill`/描述/正文 → 保存 → 出现在「用户」组。
   - 编辑该技能 → body 正确回填 → 改正文保存 → 对话里 `load_skill test-skill` 注入的是新正文。
   - 删除该技能(二次确认)→ 从列表消失,`~/.wraith/skills/test-skill/` 目录被删。
   - 内置 `web-access`「复制为用户技能」→「用户」组出现同名可编辑副本(user 覆盖 builtin)。
   - 非法 name(如 `a/b`)在编辑器内即时红字提示,保存按钮禁用。

## Self-Review

**1. Spec coverage** — spec 各节 → 任务映射:序列化器(§3)=T1;文件写删+校验(§4)=T2;RPC(§5)=T3;桥+类型(§6)=T4;纯逻辑(§7 纯函数)=T5;编辑器+面板(§7 UI)=T6;测试策略(§8)分散在各任务 TDD 步;门禁(§10)= T3 Step6 / T6 Step4-5 + 落地验证。无遗漏。

**2. Placeholder scan** — 无 TBD/TODO;每个改码步骤含完整代码;测试步骤含完整断言;命令含预期输出。通过。

**3. Type consistency** — `SkillFrontmatterWriter.serialize(name,description,version,author,tags,body)` 在 T1 定义、T2 调用一致;`SkillStore.upsert/delete` 签名 T2 定义、T3 调用一致;`skillsGet/Upsert/Delete/Fork` 接口签名 T3 接口=T3 实现=T3 测试双一致;`SkillDetail`/`SkillUpsertPayload` T4 定义、T5/T6 消费一致;`SkillFormState`/`toUpsertPayload`/`validateSkillName` T5 定义、T6 消费一致;RPC 方法名 `skills.get/upsert/delete/fork` 三处(dispatch/桥/handler)一致。通过。
